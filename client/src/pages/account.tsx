import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/use-seo";
import { IMAGE_COST, MEMBERSHIP, MIN_TOPUP, SIGNUP_CREDITS, VIDEO_COST_PER_SECOND, WATERMARK_REMOVAL_COST } from "@shared/pricing";
import { ADULT_AGE, NSFW_TERMS_OF_USE, ageFromBirthDate } from "@shared/safety";
// The header is shared by every page; it lives in components/AppNav.tsx.
// Re-exported here because older pages import it from this module.
export { NavigationHeader } from "@/components/AppNav";
import { NavigationHeader } from "@/components/AppNav";

// 帳戶：餘額、會員開通、加購積分、安全與隱私、計價。
//
// 收費規則（數字都在 shared/pricing.ts）：
//   註冊並完成信箱驗證送 SIGNUP_CREDITS 積分。
//   第一次付費是一次性的「開通會員」，付 MEMBERSHIP.priceUsd 美金拿 MEMBERSHIP.credits 積分。
//   開通後才能加購積分（1 積分 = 1 元新台幣）。
// 安全與隱私：生日只能設定一次；成人內容要年滿 ADULT_AGE 並同意條款才能開。

const PRESET_AMOUNTS = [100, 300, 500, 1000];

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\{[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (typeof j.error === "string") return j.error; } catch { /* fall through */ }
  }
  return msg;
}

function Card({ title, icon, children, id }: { title: string; icon: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="bg-white border border-indigo-100 rounded-3xl p-5 md:p-6 scroll-mt-20">
      <h2 className="flex items-center gap-2.5 text-base font-bold text-slate-900 mb-4">
        <span className="w-8 h-8 rounded-xl bg-brand-soft text-indigo-600 flex items-center justify-center text-sm"><i className={`fas ${icon}`} /></span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function AccountPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<number>(PRESET_AMOUNTS[1]);
  const [customAmount, setCustomAmount] = useState("");
  const [paying, setPaying] = useState<"" | "membership" | "topup">("");
  const [birthDraft, setBirthDraft] = useState("");
  const [savingSafety, setSavingSafety] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useSeo({
    title: "我的帳戶 - 積分、會員與安全設定 | AI 創意工坊",
    description: `管理 AI 創意工坊帳戶：積分餘額、開通會員、加購積分與安全隱私設定。圖片生成 ${IMAGE_COST} 積分／張，去浮水印 +${WATERMARK_REMOVAL_COST} 積分。`,
    keywords: "帳戶管理,積分充值,會員,安全隱私",
  });

  // Coming back from Stripe: confirm the payment and refresh the balance.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const sessionId = params.get("session_id");
    if (payment === "success" && sessionId) {
      window.history.replaceState({}, "", "/account");
      (async () => {
        try {
          const res = await apiRequest("POST", "/api/stripe/verify-session", { sessionId });
          const data = await res.json();
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          queryClient.invalidateQueries({ queryKey: ["/api/credits/transactions"] });
          toast({ title: data.membership ? "會員已開通" : "積分已到帳", description: `${data.credits} 積分已加入帳戶。` });
        } catch (e) {
          toast({ title: "付款確認中", description: `${errorText(e)}。請稍後重新整理頁面。`, variant: "destructive" });
        }
      })();
    } else if (payment === "cancelled") {
      toast({ title: "付款已取消", description: "沒有扣款，隨時可以再試一次。" });
      window.history.replaceState({}, "", "/account");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;

  const isMember = !!user.isMember || !!user.isAdmin;
  const finalAmount = customAmount ? parseInt(customAmount, 10) || 0 : amount;
  const age = ageFromBirthDate(user.birthDate);
  const draftAge = ageFromBirthDate(birthDraft);
  const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" }) : "";

  const checkout = async (kind: "membership" | "topup") => {
    setPaying(kind);
    try {
      const res = await apiRequest("POST", "/api/stripe/create-checkout", kind === "membership" ? { kind } : { amount: finalAmount });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else throw new Error("無法建立付款頁面");
    } catch (e) {
      toast({ title: "無法前往付款", description: errorText(e), variant: "destructive" });
      setPaying("");
    }
  };

  const saveSafety = async (body: Record<string, unknown>, done: string) => {
    setSavingSafety(true);
    try {
      await apiRequest("PATCH", "/api/account/safety", body);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: done });
      setShowTerms(false); setAccepted(false);
    } catch (e) {
      toast({ title: "設定沒有儲存", description: errorText(e), variant: "destructive" });
    } finally {
      setSavingSafety(false);
    }
  };

  const priceRows: Array<[string, string, string]> = [
    ["fa-image", "圖片生成（文字生圖、編輯、寫真、漫劇分鏡）", `${IMAGE_COST} 積分／張`],
    ["fa-stamp", "去除浮水印", `+${WATERMARK_REMOVAL_COST} 積分／張`],
    ["fa-clapperboard", "影片生成 720p", `${VIDEO_COST_PER_SECOND["720p"]} 積分／秒`],
    ["fa-clapperboard", "影片生成 1080p", `${VIDEO_COST_PER_SECOND["1080p"]} 積分／秒`],
  ];

  return (
    <div className="min-h-screen pb-10">
      <NavigationHeader />
      <div className="max-w-3xl mx-auto px-4 py-5 md:py-8 space-y-5">
        {/* 摘要 */}
        <section className="relative overflow-hidden bg-brand-night text-white rounded-3xl">
          <div className="absolute inset-0 tech-grid" />
          <div className="absolute -top-20 -right-10 w-64 h-64 rounded-full bg-sky-400/30 blur-3xl" />
          <div className="relative p-5 md:p-7 flex items-end justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm text-indigo-200">
                <span className="truncate">{user.username}</span>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${isMember ? "bg-amber-400 text-amber-950" : "bg-white/15 text-white"}`} data-testid="badge-member">
                  {isMember ? "會員" : "尚未開通會員"}
                </span>
              </p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-bold tabular-nums" data-testid="account-credits">{(user.credits ?? 0).toLocaleString()}</span>
                <span className="text-sm text-indigo-200">積分</span>
              </p>
              <p className="text-xs text-indigo-300 mt-1 truncate">{user.email}{joined ? `・${joined} 加入` : ""}</p>
            </div>
            <Link href="/transactions"><span className="text-sm text-indigo-100 underline underline-offset-4 cursor-pointer">交易記錄</span></Link>
          </div>
        </section>

        {/* 開通會員 */}
        {!isMember && (
          <section className="relative overflow-hidden rounded-3xl border border-sky-200 bg-brand-soft p-5 md:p-6" data-testid="card-membership">
            <p className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/80 border border-fuchsia-200 text-[11px] font-semibold text-fuchsia-600"><i className="fas fa-crown" />一次性開通</p>
            <div className="mt-3 flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-xl font-bold text-slate-900">開通會員 <span className="text-brand">US${MEMBERSHIP.priceUsd}</span></h2>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  <li><i className="fas fa-check text-emerald-500 mr-2" />立即獲得 <b className="text-slate-900">{MEMBERSHIP.credits}</b> 積分（約 {Math.floor(MEMBERSHIP.credits / IMAGE_COST)} 張圖）</li>
                  <li><i className="fas fa-check text-emerald-500 mr-2" />只付一次，沒有月費，不會自動續扣</li>
                  <li><i className="fas fa-check text-emerald-500 mr-2" />開通後積分用完，可以隨時加購</li>
                </ul>
              </div>
              <button onClick={() => checkout("membership")} disabled={!!paying}
                className="h-12 px-6 rounded-full bg-indigo-600 text-white text-sm font-semibold shadow-glow disabled:opacity-50" data-testid="button-membership">
                {paying === "membership" ? "前往付款中…" : `開通會員 US$${MEMBERSHIP.priceUsd}`}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-3">註冊並完成信箱驗證已送你 {SIGNUP_CREDITS} 積分，可以先試用。付款由 Stripe 處理。</p>
          </section>
        )}

        {/* 加購積分 */}
        {isMember && (
          <Card title="加購積分" icon="fa-coins">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRESET_AMOUNTS.map(a => (
                <button key={a} onClick={() => { setAmount(a); setCustomAmount(""); }}
                  className={`h-16 rounded-2xl border-2 transition-colors ${!customAmount && amount === a ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-700 hover:border-indigo-300"}`}>
                  <span className="block text-lg font-bold tabular-nums">{a}</span>
                  <span className="block text-[11px] text-slate-500">NT${a}</span>
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <input type="number" inputMode="numeric" min={MIN_TOPUP} value={customAmount} onChange={e => setCustomAmount(e.target.value)} placeholder={`自訂數量，最少 ${MIN_TOPUP}`}
                className="flex-1 min-w-0 h-12 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-topup-custom" />
              <button onClick={() => checkout("topup")} disabled={!!paying || finalAmount < MIN_TOPUP}
                className="h-12 px-5 rounded-xl bg-indigo-600 text-white text-sm font-semibold whitespace-nowrap disabled:opacity-40" data-testid="button-topup">
                {paying === "topup" ? "前往付款中…" : `付款 NT$${finalAmount || 0}`}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">1 積分 = 1 元新台幣，最少 {MIN_TOPUP} 積分。付款由 Stripe 處理。</p>
          </Card>
        )}

        {/* 安全與隱私 */}
        <Card title="安全與隱私" icon="fa-shield-halved" id="safety">
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-slate-800">生日</p>
              {user.birthDate ? (
                <p className="text-sm text-slate-600 mt-1" data-testid="text-birthdate">{user.birthDate}（{age} 歲）<span className="text-xs text-slate-400 ml-2">設定後無法自行修改</span></p>
              ) : (
                <>
                  <div className="flex gap-2 mt-2">
                    <input type="date" value={birthDraft} max={new Date().toISOString().slice(0, 10)} onChange={e => setBirthDraft(e.target.value)}
                      className="flex-1 min-w-0 h-11 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-birthdate" />
                    <button onClick={() => saveSafety({ birthDate: birthDraft }, "生日已儲存")} disabled={savingSafety || draftAge === null}
                      className="h-11 px-5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-save-birthdate">儲存</button>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">用來確認年齡，不會公開。生日只能設定一次，請填寫正確。</p>
                </>
              )}
            </div>

            <div className="border-t border-slate-100 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">成人內容（NSFW）</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    預設關閉：含成人內容的提示詞會被擋下，不扣積分。啟用後才能使用，成品會先以模糊顯示，按「顯示圖片」才看得到。
                  </p>
                </div>
                <button role="switch" aria-checked={!!user.nsfwEnabled} disabled={savingSafety}
                  onClick={() => (user.nsfwEnabled ? saveSafety({ nsfwEnabled: false }, "已關閉成人內容") : setShowTerms(true))}
                  className={`shrink-0 w-12 h-7 rounded-full p-0.5 transition-colors ${user.nsfwEnabled ? "bg-indigo-600" : "bg-slate-300"}`} data-testid="switch-nsfw">
                  <span className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${user.nsfwEnabled ? "translate-x-5" : ""}`} />
                </button>
              </div>
              {!user.nsfwEnabled && age === null && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">要啟用請先設定生日。</p>}
              {!user.nsfwEnabled && age !== null && age < ADULT_AGE && <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mt-3">未滿 {ADULT_AGE} 歲無法啟用。</p>}
            </div>
          </div>
        </Card>

        {/* 計價 */}
        <Card title="計價" icon="fa-tag">
          <ul className="divide-y divide-slate-100">
            {priceRows.map(([icon, label, price]) => (
              <li key={label} className="flex items-center gap-3 py-3 text-sm">
                <i className={`fas ${icon} w-5 text-center text-slate-400`} />
                <span className="flex-1 text-slate-700">{label}</span>
                <span className="font-semibold text-slate-900 whitespace-nowrap">{price}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-400 mt-2">生成失敗會自動退還該次扣的積分。</p>
        </Card>
      </div>

      {showTerms && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-end md:items-center justify-center md:p-4" onClick={() => setShowTerms(false)}>
          <div className="bg-white w-full md:max-w-lg max-h-[90vh] overflow-auto rounded-t-3xl md:rounded-3xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid="dialog-nsfw-terms">
            <h3 className="text-lg font-bold text-slate-900"><i className="fas fa-triangle-exclamation text-amber-500 mr-2" />啟用成人內容前請閱讀</h3>
            {age === null ? (
              <p className="text-sm text-slate-600 mt-3">請先在上方設定生日，才能啟用成人內容。</p>
            ) : age < ADULT_AGE ? (
              <p className="text-sm text-slate-600 mt-3">你未滿 {ADULT_AGE} 歲，無法啟用成人內容。</p>
            ) : (
              <>
                <ol className="mt-3 space-y-2 text-sm text-slate-700 list-decimal pl-5 leading-relaxed">
                  {NSFW_TERMS_OF_USE.map(t => <li key={t}>{t}</li>)}
                </ol>
                <label className="flex items-start gap-2 mt-4 text-sm text-slate-800 cursor-pointer">
                  <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1 accent-indigo-600" data-testid="checkbox-nsfw-accept" />
                  <span>我已閱讀並同意以上全部內容，違法或違規使用的後果由我自行承擔。</span>
                </label>
              </>
            )}
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={() => setShowTerms(false)} className="h-11 rounded-xl border border-slate-200 text-sm text-slate-600">取消</button>
              <button onClick={() => saveSafety({ nsfwEnabled: true, acceptTerms: true }, "已啟用成人內容")}
                disabled={savingSafety || !accepted || age === null || age < ADULT_AGE}
                className="h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-nsfw-enable">同意並啟用</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

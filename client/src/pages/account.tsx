import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/use-seo";
import { IMAGE_COST, VIDEO_COST_PER_SECOND, VIDEO_MODELS, WATERMARK_REMOVAL_COST } from "@shared/pricing";
import { ADULT_AGE, ageFromBirthDate } from "@shared/safety";
// The header is shared by every page; it lives in components/AppNav.tsx.
// Re-exported here because older pages import it from this module.
export { NavigationHeader } from "@/components/AppNav";
import { NavigationHeader } from "@/components/AppNav";
import { hasGoldAccess } from "@/lib/zone";
import { GoldApplyDialog } from "@/components/GoldApplyDialog";

// 帳戶設定：餘額摘要、安全與隱私（生日）、計價。
// 所有付費（小試身手、開通會員、儲值包、黃金會員）都在會員商城 /store。
// 生日只能設定一次。存了年滿 ADULT_AGE 的生日之後，生日上方才會多出「內容審查限制」這一列；
// 點開是一個開關，打開就跳出黃金會員的申請視窗（GoldApplyDialog）。申請完成後，會員商城才會出現黃金會員。
// 除了那個開關的名稱，這一頁不出現內容分級的字眼。

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
  const [birthDraft, setBirthDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showModeration, setShowModeration] = useState(false);
  const [showApply, setShowApply] = useState(false);

  useSeo({
    title: "帳戶設定 - 積分與安全設定 | AI 創意工坊",
    description: `管理 AI 創意工坊帳戶：積分餘額與安全隱私設定。圖片生成 ${IMAGE_COST} 積分／張，去浮水印 +${WATERMARK_REMOVAL_COST} 積分。`,
    keywords: "帳戶管理,積分,會員,安全隱私",
  });

  if (!user) return null;

  const isMember = !!user.isMember || !!user.isAdmin;
  const age = ageFromBirthDate(user.birthDate);
  const draftAge = ageFromBirthDate(birthDraft);
  const joined = user.createdAt ? new Date(user.createdAt).toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" }) : "";

  const isAdultAge = age !== null && age >= ADULT_AGE;
  const modeOn = hasGoldAccess(user);

  const saveBirthDate = async () => {
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/account/safety", { birthDate: birthDraft });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "生日已儲存" });
    } catch (e) {
      toast({ title: "設定沒有儲存", description: errorText(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // The switch: off → the gold application dialog; on → turn it off (the gold zone is hidden again).
  const toggleMode = async () => {
    if (!modeOn) { setShowApply(true); return; }
    if (user.isAdmin) { toast({ title: "管理員帳號不受這項限制" }); return; }
    setSaving(true);
    try {
      await apiRequest("PATCH", "/api/account/safety", { nsfwEnabled: false });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "已關閉", description: "隨時可以再打開。" });
    } catch (e) {
      toast({ title: "設定沒有儲存", description: errorText(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const priceRows: Array<[string, string, string]> = [
    ["fa-image", "圖片生成（文字生圖、編輯、寫真、漫劇分鏡）", `${IMAGE_COST} 積分／張`],
    ["fa-stamp", "去除浮水印", `+${WATERMARK_REMOVAL_COST} 積分／張`],
    ["fa-clapperboard", "影片生成 720p", `${VIDEO_COST_PER_SECOND["720p"]} 積分／秒`],
    ["fa-clapperboard", "影片生成 1080p", `${VIDEO_COST_PER_SECOND["1080p"]} 積分／秒`],
    ["fa-clapperboard", `影片生成 ${VIDEO_MODELS.kling.label} 720p`, `${VIDEO_MODELS.kling.perSecond["720p"]} 積分／秒`],
    ["fa-clapperboard", `影片生成 ${VIDEO_MODELS.kling.label} 1080p`, `${VIDEO_MODELS.kling.perSecond["1080p"]} 積分／秒`],
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
                  {user.isGold ? "黃金會員" : isMember ? "會員" : "尚未開通會員"}
                </span>
              </p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-bold tabular-nums" data-testid="account-credits">{(user.credits ?? 0).toLocaleString()}</span>
                <span className="text-sm text-indigo-200">積分</span>
              </p>
              <p className="text-xs text-indigo-300 mt-1 truncate">{user.email}{joined ? `・${joined} 加入` : ""}</p>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/transactions"><span className="text-sm text-indigo-100 underline underline-offset-4 cursor-pointer">交易記錄</span></Link>
              <Link href="/store">
                <span className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-white text-indigo-700 text-sm font-semibold cursor-pointer hover:bg-indigo-50" data-testid="link-store">
                  <i className="fas fa-store text-xs" />{isMember ? "儲值積分" : "開通會員"}
                </span>
              </Link>
            </div>
          </div>
        </section>

        {hasGoldAccess(user) && (
          <section className="rounded-3xl border border-amber-300 bg-amber-50 p-5 md:p-6 flex items-center justify-between gap-4 flex-wrap" data-testid="card-gold-active">
            <div>
              <p className="text-base font-bold text-slate-900"><i className="fas fa-crown text-amber-500 mr-2" />黃金會員</p>
              <p className="text-sm text-slate-600 mt-1">更多生成服務已開啟。</p>
            </div>
            <Link href="/gold"><span className="h-11 px-5 rounded-full bg-amber-400 text-amber-950 text-sm font-bold flex items-center cursor-pointer" data-testid="link-gold-zone">進入黃金專區</span></Link>
          </section>
        )}

        {/* 安全與隱私 */}
        <Card title="安全與隱私" icon="fa-shield-halved" id="safety">
          {(isAdultAge || modeOn) && (
            <div className="mb-4 pb-4 border-b border-slate-100" data-testid="row-moderation">
              <button onClick={() => setShowModeration(v => !v)} aria-expanded={showModeration}
                className="w-full min-h-11 flex items-center justify-between gap-3 text-left" data-testid="button-moderation">
                <span className="text-sm font-semibold text-slate-800">內容審查限制</span>
                <i className={`fas fa-chevron-${showModeration ? "up" : "right"} text-xs text-slate-400`} />
              </button>
              {showModeration && (
                <div className="mt-2 flex items-center justify-between gap-4 rounded-2xl bg-slate-50 px-4 py-3">
                  <span id="mode-label" className="text-sm text-slate-700">開啟敏感內容</span>
                  <button role="switch" aria-checked={modeOn} aria-labelledby="mode-label" onClick={toggleMode} disabled={saving}
                    className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-50 ${modeOn ? "bg-amber-400" : "bg-slate-300"}`} data-testid="switch-mode">
                    <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${modeOn ? "translate-x-5" : ""}`} />
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="text-sm font-semibold text-slate-800">生日</p>
          {user.birthDate ? (
            <p className="text-sm text-slate-600 mt-1" data-testid="text-birthdate">{user.birthDate}（{age} 歲）<span className="text-xs text-slate-400 ml-2">設定後無法自行修改</span></p>
          ) : (
            <>
              <div className="flex gap-2 mt-2">
                <input type="date" value={birthDraft} max={new Date().toISOString().slice(0, 10)} onChange={e => setBirthDraft(e.target.value)}
                  className="flex-1 min-w-0 h-11 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-birthdate" />
                <button onClick={saveBirthDate} disabled={saving || draftAge === null}
                  className="h-11 px-5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-save-birthdate">確定</button>
              </div>
              <p className="text-[11px] text-slate-400 mt-1.5">用來確認年齡，不會公開。生日只能設定一次，請填寫正確。</p>
            </>
          )}
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
      {showApply && <GoldApplyDialog onClose={() => setShowApply(false)} />}
    </div>
  );
}

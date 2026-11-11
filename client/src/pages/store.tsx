import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/use-seo";
import { NavigationHeader } from "@/components/AppNav";
import { hasGoldAccess } from "@/lib/zone";
import { GOLD_MEMBERSHIP, IMAGE_COST, MEMBERSHIP, MIN_TOPUP, SIGNUP_CREDITS, TOPUP_PACKS, TRIAL, topupCredits } from "@shared/pricing";
import { ADULT_AGE, NSFW_TERMS_OF_USE, ageFromBirthDate } from "@shared/safety";

// 會員商城（/store）：所有付費都在這一頁。數字都在 shared/pricing.ts。
//
// 三個階段，畫面只顯示目前階段該看到的東西：
//   1. 還不是會員   小試身手（TRIAL，每個帳號一次）與正式會員（MEMBERSHIP）；儲值包看得到但上鎖。
//   2. 正式會員     儲值包（TOPUP_PACKS，金額越大加贈越多）與自訂金額。
//   3. 正式會員、已填生日且年滿 ADULT_AGE   才會出現黃金會員（GOLD_MEMBERSHIP）；升級前要同意條款。
// 帳戶頁存完生日會帶 ?gold=1 過來，直接打開升級視窗。

type Kind = "trial" | "membership" | "topup" | "gold";
const POPULAR_PACK = 500;

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\{[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (typeof j.error === "string") return j.error; } catch { /* fall through */ }
  }
  return msg;
}

const images = (credits: number) => Math.floor(credits / IMAGE_COST);
const bonusPercent = (twd: number, credits: number) => Math.round((credits / twd - 1) * 100);

export default function StorePage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState<number>(POPULAR_PACK);
  const [customAmount, setCustomAmount] = useState("");
  const [paying, setPaying] = useState<"" | Kind>("");
  const [showTerms, setShowTerms] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useSeo({
    title: "會員商城 - 開通會員與儲值積分 | AI 創意工坊",
    description: `AI 創意工坊會員商城：小試身手 US$${TRIAL.priceUsd}、開通會員 US$${MEMBERSHIP.priceUsd}，會員可加購積分，金額越大加贈越多。`,
    keywords: "會員,積分,儲值,AI 圖片生成",
  });

  // Coming back from Stripe: confirm the payment and refresh the balance.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const sessionId = params.get("session_id");
    if (payment === "success" && sessionId) {
      window.history.replaceState({}, "", "/store");
      (async () => {
        try {
          const res = await apiRequest("POST", "/api/stripe/verify-session", { sessionId });
          const data = await res.json();
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          queryClient.invalidateQueries({ queryKey: ["/api/credits/transactions"] });
          const title = data.gold ? "黃金會員已開通" : data.membership ? "會員已開通" : "積分已到帳";
          toast({ title, description: `${data.credits} 積分已加入帳戶。${data.gold ? "可以從選單進入黃金專區了。" : ""}` });
        } catch (e) {
          toast({ title: "付款確認中", description: `${errorText(e)}。請稍後重新整理頁面。`, variant: "destructive" });
        }
      })();
    } else if (payment === "cancelled") {
      toast({ title: "付款已取消", description: "沒有扣款，隨時可以再試一次。" });
      window.history.replaceState({}, "", "/store");
    } else if (params.get("gold") === "1") {
      window.history.replaceState({}, "", "/store");
      setShowTerms(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;

  const isMember = !!user.isMember || !!user.isAdmin;
  const goldReady = hasGoldAccess(user);
  const age = ageFromBirthDate(user.birthDate);
  const isAdultAge = age !== null && age >= ADULT_AGE;
  // Stage 3 only: nothing about the gold tier is shown before this.
  const showGoldOffer = isMember && isAdultAge && !goldReady;
  const canBuyTrial = !isMember && !user.trialUsedAt;
  const finalAmount = customAmount ? parseInt(customAmount, 10) || 0 : amount;
  const finalCredits = finalAmount >= MIN_TOPUP ? topupCredits(finalAmount) : 0;

  const checkout = async (kind: Kind) => {
    setPaying(kind);
    try {
      const res = await apiRequest("POST", "/api/stripe/create-checkout", kind === "topup" ? { amount: finalAmount } : { kind });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else throw new Error("無法建立付款頁面");
    } catch (e) {
      toast({ title: "無法前往付款", description: errorText(e), variant: "destructive" });
      setPaying("");
    }
  };

  // Record the 18+ confirmation, then pay. An account an admin already made
  // gold only needs the confirmation.
  const confirmGold = async () => {
    setConfirming(true);
    try {
      await apiRequest("PATCH", "/api/account/safety", { nsfwEnabled: true, acceptTerms: true });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      setShowTerms(false); setAccepted(false);
      if (user.isGold || user.isAdmin) toast({ title: "黃金專區已開啟", description: "可以從選單進入黃金專區了。" });
      else await checkout("gold");
    } catch (e) {
      toast({ title: "沒有完成", description: errorText(e), variant: "destructive" });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="min-h-screen pb-10">
      <NavigationHeader />
      <div className="max-w-4xl mx-auto px-4 py-5 md:py-8 space-y-5">
        {/* 餘額 */}
        <section className="relative overflow-hidden bg-brand-night text-white rounded-3xl">
          <div className="absolute inset-0 tech-grid" />
          <div className="absolute -top-20 -right-10 w-64 h-64 rounded-full bg-sky-400/30 blur-3xl" />
          <div className="relative p-5 md:p-7 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <p className="flex items-center gap-2 text-sm text-indigo-200">
                會員商城
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${isMember ? "bg-amber-400 text-amber-950" : "bg-white/15 text-white"}`} data-testid="store-badge">
                  {user.isGold ? "黃金會員" : isMember ? "會員" : "尚未開通會員"}
                </span>
              </p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-bold tabular-nums" data-testid="store-credits">{(user.credits ?? 0).toLocaleString()}</span>
                <span className="text-sm text-indigo-200">積分・約可生成 {images(user.credits ?? 0)} 張圖</span>
              </p>
            </div>
            <Link href="/transactions"><span className="text-sm text-indigo-100 underline underline-offset-4 cursor-pointer">交易記錄</span></Link>
          </div>
        </section>

        {/* 階段一：還不是會員 */}
        {!isMember && (
          <section data-testid="store-stage-1">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">選一個方案繼續創作</h2>
            <div className={`grid grid-cols-1 gap-3 ${canBuyTrial ? "md:grid-cols-2" : ""}`}>
              {canBuyTrial && (
                <div className="bg-white border border-slate-200 rounded-3xl p-5 flex flex-col" data-testid="card-trial">
                  <p className="text-xs font-semibold text-slate-500">小試身手</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">US${TRIAL.priceUsd}</p>
                  <ul className="mt-3 space-y-1.5 text-sm text-slate-600 flex-1">
                    <li><i className="fas fa-check text-emerald-500 mr-2" /><b className="text-slate-900">{TRIAL.credits}</b> 積分（約 {images(TRIAL.credits)} 張圖）</li>
                    <li><i className="fas fa-check text-emerald-500 mr-2" />只付一次，不會自動續扣</li>
                    <li><i className="fas fa-minus text-slate-300 mr-2" />每個帳號限購一次，用完需開通會員才能加購</li>
                  </ul>
                  <button onClick={() => checkout("trial")} disabled={!!paying}
                    className="mt-4 h-12 rounded-full border-2 border-indigo-200 text-indigo-700 text-sm font-semibold hover:border-indigo-400 disabled:opacity-50" data-testid="button-trial">
                    {paying === "trial" ? "前往付款中…" : `先試試看 US$${TRIAL.priceUsd}`}
                  </button>
                </div>
              )}
              <div className="relative bg-brand-soft border-2 border-indigo-400 rounded-3xl p-5 flex flex-col shadow-glow" data-testid="card-membership">
                <span className="absolute -top-3 left-5 px-3 py-1 rounded-full bg-fuchsia-500 text-white text-[11px] font-bold">最划算</span>
                <p className="text-xs font-semibold text-indigo-600"><i className="fas fa-crown mr-1" />正式會員</p>
                <p className="mt-1 text-3xl font-bold text-slate-900">US${MEMBERSHIP.priceUsd}</p>
                <ul className="mt-3 space-y-1.5 text-sm text-slate-600 flex-1">
                  <li><i className="fas fa-check text-emerald-500 mr-2" /><b className="text-slate-900">{MEMBERSHIP.credits}</b> 積分（約 {images(MEMBERSHIP.credits)} 張圖）</li>
                  <li><i className="fas fa-check text-emerald-500 mr-2" />每張圖比小試身手便宜 {Math.round((1 - (MEMBERSHIP.priceUsd / MEMBERSHIP.credits) / (TRIAL.priceUsd / TRIAL.credits)) * 100)}%</li>
                  <li><i className="fas fa-check text-emerald-500 mr-2" />開通後可加購儲值包，金額越大加贈越多</li>
                  <li><i className="fas fa-check text-emerald-500 mr-2" />只付一次，沒有月費，不會自動續扣</li>
                </ul>
                <button onClick={() => checkout("membership")} disabled={!!paying}
                  className="mt-4 h-12 rounded-full bg-indigo-600 text-white text-sm font-semibold shadow-glow disabled:opacity-50" data-testid="button-membership">
                  {paying === "membership" ? "前往付款中…" : `開通會員 US$${MEMBERSHIP.priceUsd}`}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 mt-3">註冊並完成信箱驗證已送你 {SIGNUP_CREDITS} 積分。付款由 Stripe 處理。</p>
          </section>
        )}

        {/* 階段二：儲值包（非會員看得到但上鎖） */}
        <section className="bg-white border border-indigo-100 rounded-3xl p-5 md:p-6" data-testid="store-packs">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="flex items-center gap-2.5 text-base font-bold text-slate-900">
              <span className="w-8 h-8 rounded-xl bg-brand-soft text-indigo-600 flex items-center justify-center text-sm"><i className="fas fa-coins" /></span>
              儲值包
            </h2>
            {!isMember && <span className="text-xs text-slate-500"><i className="fas fa-lock mr-1" />開通會員後可購買</span>}
          </div>
          <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 ${isMember ? "" : "opacity-60"}`}>
            {TOPUP_PACKS.map(p => {
              const selected = isMember && !customAmount && amount === p.twd;
              const bonus = bonusPercent(p.twd, p.credits);
              return (
                <button key={p.twd} disabled={!isMember} onClick={() => { setAmount(p.twd); setCustomAmount(""); }}
                  className={`relative rounded-2xl border-2 px-2 py-3 text-center transition-colors ${selected ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300"} disabled:cursor-not-allowed disabled:hover:border-slate-200`}
                  data-testid={`pack-${p.twd}`}>
                  {p.twd === POPULAR_PACK && <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-fuchsia-500 text-white text-[10px] font-bold whitespace-nowrap">最多人選</span>}
                  <span className="block text-xl font-bold text-slate-900 tabular-nums">{p.credits.toLocaleString()}</span>
                  <span className="block text-[11px] text-slate-500">積分</span>
                  <span className="block text-sm font-semibold text-slate-700 mt-1.5">NT${p.twd.toLocaleString()}</span>
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${bonus > 0 ? "bg-emerald-50 text-emerald-700" : "text-transparent"}`}>加贈 {bonus}%</span>
                </button>
              );
            })}
          </div>
          {isMember && (
            <>
              <div className="flex gap-2 mt-4">
                <input type="number" inputMode="numeric" min={MIN_TOPUP} value={customAmount} onChange={e => setCustomAmount(e.target.value)} placeholder={`自訂金額，最少 NT$${MIN_TOPUP}`}
                  className="flex-1 min-w-0 h-12 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-topup-custom" />
                <button onClick={() => checkout("topup")} disabled={!!paying || finalAmount < MIN_TOPUP}
                  className="h-12 px-5 rounded-xl bg-indigo-600 text-white text-sm font-semibold whitespace-nowrap disabled:opacity-40" data-testid="button-topup">
                  {paying === "topup" ? "前往付款中…" : `付款 NT$${(finalAmount || 0).toLocaleString()}`}
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-2" data-testid="text-topup-credits">
                {finalCredits > 0 ? `可獲得 ${finalCredits.toLocaleString()} 積分（約 ${images(finalCredits)} 張圖）。` : `最少 NT$${MIN_TOPUP}。`}付款由 Stripe 處理。
              </p>
            </>
          )}
        </section>

        {/* 階段三：正式會員、已填生日且年滿 18 歲才出現 */}
        {goldReady ? (
          <section className="rounded-3xl border border-amber-300 bg-amber-50 p-5 md:p-6 flex items-center justify-between gap-4 flex-wrap" data-testid="card-gold-active">
            <div>
              <p className="text-base font-bold text-slate-900"><i className="fas fa-crown text-amber-500 mr-2" />黃金會員</p>
              <p className="text-sm text-slate-600 mt-1">更多生成服務已開啟。</p>
            </div>
            <Link href="/gold"><span className="h-11 px-5 rounded-full bg-amber-400 text-amber-950 text-sm font-bold flex items-center cursor-pointer" data-testid="link-gold-zone">進入黃金專區</span></Link>
          </section>
        ) : showGoldOffer && (
          <section className="rounded-3xl border border-amber-300 bg-amber-50 p-5 md:p-6" data-testid="card-gold">
            <p className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400 text-amber-950 text-[11px] font-bold"><i className="fas fa-crown" />會員升級</p>
            <div className="mt-3 flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-xl font-bold text-slate-900">黃金會員 <span className="text-amber-600">US${GOLD_MEMBERSHIP.priceUsd}</span></h2>
                <ul className="mt-2 space-y-1 text-sm text-slate-600">
                  <li><i className="fas fa-check text-emerald-500 mr-2" />立即獲得 <b className="text-slate-900">{GOLD_MEMBERSHIP.credits}</b> 積分</li>
                  <li><i className="fas fa-check text-emerald-500 mr-2" />更多生成服務：搶先使用最新無審核模型</li>
                  <li><i className="fas fa-check text-emerald-500 mr-2" />專屬黃金專區：圖片、影片、寫真與專屬素材圖庫</li>
                  <li><i className="fas fa-check text-emerald-500 mr-2" />只付一次，沒有月費，不會自動續扣</li>
                  <li><i className="fas fa-check text-emerald-500 mr-2" />須確認年滿 {ADULT_AGE} 歲</li>
                </ul>
              </div>
              <button onClick={() => setShowTerms(true)} disabled={!!paying}
                className="h-12 px-6 rounded-full bg-amber-400 text-amber-950 text-sm font-bold disabled:opacity-50" data-testid="button-gold">
                {paying === "gold" ? "前往付款中…" : user.isGold ? "確認年齡並開啟" : `升級黃金會員 US$${GOLD_MEMBERSHIP.priceUsd}`}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-3">積分與一般區共用，用完可以隨時加購。付款由 Stripe 處理。</p>
          </section>
        )}

        <p className="text-[11px] text-slate-400 text-center">積分沒有使用期限。生成失敗會自動退還該次扣的積分。</p>
      </div>

      {showTerms && showGoldOffer && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-end md:items-center justify-center md:p-4" onClick={() => setShowTerms(false)}>
          <div className="bg-white w-full md:max-w-lg max-h-[90vh] overflow-auto rounded-t-3xl md:rounded-3xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid="dialog-gold-terms">
            <h3 className="text-lg font-bold text-slate-900"><i className="fas fa-crown text-amber-500 mr-2" />升級黃金會員前請確認</h3>
            <ol className="mt-3 space-y-2 text-sm text-slate-700 list-decimal pl-5 leading-relaxed">
              {NSFW_TERMS_OF_USE.map(t => <li key={t}>{t}</li>)}
            </ol>
            <label className="flex items-start gap-2 mt-4 text-sm text-slate-800 cursor-pointer">
              <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1 accent-amber-500" data-testid="checkbox-gold-accept" />
              <span>我已閱讀並同意以上全部內容，違法或違規使用的後果由我自行承擔。</span>
            </label>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={() => setShowTerms(false)} className="h-11 rounded-xl border border-slate-200 text-sm text-slate-600">取消</button>
              <button onClick={confirmGold} disabled={confirming || !!paying || !accepted}
                className="h-11 rounded-xl bg-amber-400 text-amber-950 text-sm font-bold disabled:opacity-40" data-testid="button-gold-confirm">
                {user.isGold ? "同意並開啟" : `同意並付款 US$${GOLD_MEMBERSHIP.priceUsd}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

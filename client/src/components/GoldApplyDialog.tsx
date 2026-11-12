import { tr } from "@/lib/i18n";
import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { GOLD_MEMBERSHIP } from "@shared/pricing";
import { GOLD_TERMS_OF_USE } from "@shared/safety";

// 帳戶設定「內容審查限制」的開關打開時跳出的視窗。一步一步：
//   1. 說明   本項目需要加入黃金會員；還不是正式會員的話先帶去會員商城。
//   2. 資料   認證 Email（寄驗證碼到帳號信箱）與真實姓名。
//   3. 條款   AI 生成內容的法律風險說明，全部同意才能繼續。
//   4. 加入   問要不要加入黃金會員（GOLD_MEMBERSHIP）。選「先不要」也沒關係：
//             前三步完成後，會員商城就會一直有黃金會員的選項。
// 管理員直接設成黃金會員的帳號不用付款，同意條款後就開啟。
// 這個視窗的文字不提開關以外的內容分級字眼。

type Step = "intro" | "identity" | "terms" | "join";

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\{[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (typeof j.error === "string") return j.error; } catch { /* fall through */ }
  }
  return msg;
}

export function GoldApplyDialog({ onClose }: { onClose: () => void }) {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("intro");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [name, setName] = useState(user?.realName ?? "");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return null;
  const isMember = !!user.isMember || !!user.isAdmin;
  const emailVerified = !!user.emailVerifiedAt;
  const nameOk = name.trim().length >= 2;

  const run = async (fn: () => Promise<void>, failTitle: string) => {
    setBusy(true);
    try { await fn(); }
    catch (e) { toast({ title: failTitle, description: errorText(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const sendCode = () => run(async () => {
    await apiRequest("POST", "/api/account/email-code", {});
    setCodeSent(true);
    toast({ title: tr("驗證碼已寄出"), description: tr("請到 {0} 收信，10 分鐘內有效。", { 0: user.email }) });
  }, tr("驗證碼沒有寄出"));

  const verifyCode = () => run(async () => {
    await apiRequest("POST", "/api/account/verify-email", { code });
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    setCode("");
  }, tr("驗證沒有成功"));

  const acceptTerms = () => run(async () => {
    await apiRequest("PATCH", "/api/account/safety", { nsfwEnabled: true, acceptTerms: true, realName: name.trim() });
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    if (user.isGold) {
      toast({ title: tr("已開啟"), description: tr("可以在「我的」選單進入黃金專區。") });
      onClose();
    } else {
      setStep("join");
    }
  }, tr("沒有完成"));

  const pay = () => run(async () => {
    const res = await apiRequest("POST", "/api/stripe/create-checkout", { kind: "gold" });
    const data = await res.json();
    if (!data.url) throw new Error(tr("無法建立付款頁面"));
    window.location.href = data.url;
  }, tr("無法前往付款"));

  const later = () => {
    toast({ title: tr("之後隨時可以加入"), description: tr("會員商城現在有黃金會員的選項了。") });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-end md:items-center justify-center md:p-4" onClick={onClose}>
      <div className="bg-white w-full md:max-w-lg max-h-[90vh] overflow-auto rounded-t-3xl md:rounded-3xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid="dialog-gold-apply">
        {step === "intro" && (
          <>
            <h3 className="text-lg font-bold text-slate-900"><i className="fas fa-crown text-amber-500 mr-2" />{tr("本項目需要加入黃金會員")}</h3>
            <p className="text-sm text-slate-600 mt-2">{tr("加入黃金會員才可以開啟這個項目。")}</p>
            {isMember ? (
              <>
                <p className="text-sm font-semibold text-slate-800 mt-4">{tr("加入黃金會員需要：")}</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  <li><i className={`fas ${emailVerified ? "fa-circle-check text-emerald-500" : "fa-envelope text-slate-400"} w-5 mr-1.5`} />{tr("認證 Email")}{emailVerified && <span className="text-xs text-emerald-600 ml-2">{tr("已完成")}</span>}</li>
                  <li><i className="fas fa-id-card text-slate-400 w-5 mr-1.5" />{tr("填寫真實姓名")}</li>
                  <li><i className="fas fa-file-signature text-slate-400 w-5 mr-1.5" />{tr("確認 AI 生成內容使用條款")}</li>
                </ul>
                <div className="grid grid-cols-2 gap-2 mt-5">
                  <button onClick={onClose} className="h-11 rounded-xl border border-slate-200 text-sm text-slate-600">{tr("取消")}</button>
                  <button onClick={() => setStep("identity")} className="h-11 rounded-xl bg-amber-400 text-amber-950 text-sm font-bold" data-testid="button-gold-apply-start">{tr("下一步")}</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600 mt-3">{tr("黃金會員是正式會員的升級，請先開通正式會員，再回到這裡。")}</p>
                <div className="grid grid-cols-2 gap-2 mt-5">
                  <button onClick={onClose} className="h-11 rounded-xl border border-slate-200 text-sm text-slate-600">{tr("取消")}</button>
                  <Link href="/store"><span className="h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold flex items-center justify-center cursor-pointer" data-testid="button-gold-apply-store">{tr("前往會員商城")}</span></Link>
                </div>
              </>
            )}
          </>
        )}

        {step === "identity" && (
          <>
            <h3 className="text-lg font-bold text-slate-900">{tr("認證 Email 與真實姓名")}</h3>
            <p className="text-xs text-slate-500 mt-1">{tr("只用來確認會員資格，不會公開。")}</p>

            <p className="text-sm font-semibold text-slate-800 mt-4">Email</p>
            <p className="text-sm text-slate-600 mt-1 break-all">{user.email}</p>
            {emailVerified ? (
              <p className="text-sm text-emerald-600 mt-2" data-testid="text-email-verified"><i className="fas fa-circle-check mr-1.5" />{tr("Email 已認證")}</p>
            ) : (
              <>
                <div className="flex gap-2 mt-2">
                  <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder={tr("6 位數驗證碼")} aria-label={tr("Email 驗證碼")}
                    className="flex-1 min-w-0 h-11 px-3 border border-slate-200 rounded-xl text-sm tracking-widest" data-testid="input-email-code" />
                  {codeSent && code.length === 6 ? (
                    <button onClick={verifyCode} disabled={busy} className="h-11 px-5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-verify-email">{tr("驗證")}</button>
                  ) : (
                    <button onClick={sendCode} disabled={busy} className="h-11 px-4 rounded-xl border border-indigo-300 text-indigo-700 text-sm font-semibold disabled:opacity-40 whitespace-nowrap" data-testid="button-send-email-code">{codeSent ? tr("重新寄送") : tr("寄送驗證碼")}</button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">{tr("驗證碼會寄到上面的信箱，10 分鐘內有效。沒收到請看垃圾信件匣。")}</p>
              </>
            )}

            <label className="block mt-4">
              <span className="text-sm font-semibold text-slate-800">{tr("真實姓名")}</span>
              <input value={name} onChange={e => setName(e.target.value.slice(0, 40))} placeholder={tr("請填寫與證件相同的姓名")} autoComplete="name"
                className="mt-2 w-full h-11 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-real-name" />
            </label>

            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={() => setStep("intro")} className="h-11 rounded-xl border border-slate-200 text-sm text-slate-600">{tr("上一步")}</button>
              <button onClick={() => setStep("terms")} disabled={!emailVerified || !nameOk} className="h-11 rounded-xl bg-amber-400 text-amber-950 text-sm font-bold disabled:opacity-40" data-testid="button-gold-apply-identity">{tr("下一步")}</button>
            </div>
          </>
        )}

        {step === "terms" && (
          <>
            <h3 className="text-lg font-bold text-slate-900">{tr("AI 生成內容使用條款")}</h3>
            <p className="text-xs text-slate-500 mt-1">{tr("加入黃金會員前，請逐條閱讀並確認。")}</p>
            <ol className="mt-3 space-y-2 text-sm text-slate-700 list-decimal pl-5 leading-relaxed" data-testid="gold-terms">
              {GOLD_TERMS_OF_USE.map(term => <li key={term}>{term}</li>)}
            </ol>
            <label className="flex items-start gap-2 mt-4 text-sm text-slate-800 cursor-pointer">
              <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} className="mt-1 accent-amber-500" data-testid="checkbox-gold-accept" />
              <span>{tr("我（{0}）已閱讀並同意以上全部內容，違法或違規使用的後果由我自行承擔。", { 0: name.trim() })}</span>
            </label>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={() => setStep("identity")} className="h-11 rounded-xl border border-slate-200 text-sm text-slate-600">{tr("上一步")}</button>
              <button onClick={acceptTerms} disabled={busy || !accepted} className="h-11 rounded-xl bg-amber-400 text-amber-950 text-sm font-bold disabled:opacity-40" data-testid="button-gold-apply-terms">{tr("同意")}</button>
            </div>
          </>
        )}

        {step === "join" && (
          <>
            <h3 className="text-lg font-bold text-slate-900"><i className="fas fa-crown text-amber-500 mr-2" />{tr("要加入黃金會員嗎？")}</h3>
            <p className="mt-3 text-3xl font-bold text-slate-900">US${GOLD_MEMBERSHIP.priceUsd}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
              <li><i className="fas fa-check text-emerald-500 mr-2" />{tr("立即獲得")} <b className="text-slate-900">{GOLD_MEMBERSHIP.credits}</b> {tr("積分")}</li>
              <li><i className="fas fa-check text-emerald-500 mr-2" />{tr("開啟黃金專區")}</li>
              <li><i className="fas fa-check text-emerald-500 mr-2" />{tr("只付一次，沒有月費，不會自動續扣")}</li>
            </ul>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={later} className="h-11 rounded-xl border border-slate-200 text-sm text-slate-600" data-testid="button-gold-apply-later">{tr("先不要")}</button>
              <button onClick={pay} disabled={busy} className="h-11 rounded-xl bg-amber-400 text-amber-950 text-sm font-bold disabled:opacity-40" data-testid="button-gold-apply-pay">{busy ? tr("前往付款中…") : tr("加入 US${0}", { 0: GOLD_MEMBERSHIP.priceUsd })}</button>
            </div>
            <p className="text-[11px] text-slate-400 mt-3 text-center">{tr("付款由 Stripe 處理。")}</p>
          </>
        )}
      </div>
    </div>
  );
}

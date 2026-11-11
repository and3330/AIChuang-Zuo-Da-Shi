import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { IMAGE_COST, MEMBERSHIP, SIGNUP_CREDITS } from "@shared/pricing";

// 第一次登入的引導（users.onboardedAt 是空的才出現）。三頁：
//   1. 歡迎：你有多少積分、可以做幾張圖
//   2. 選第一件要做的事：直接帶到那個功能
//   3. 之後會用到的：開通會員、安全與隱私
// 做完或按「略過」都會記錄，之後不再出現。

const STARTS = [
  { href: "/photoset?mode=kit", icon: "fa-layer-group", title: "素材套圖", desc: "選人物、服裝、姿勢，一次出整組寫真。最快看到成果。", tag: "推薦" },
  { href: "/photoset?mode=scene", icon: "fa-panorama", title: "情境寫真", desc: "寫下場景，或放一張想模仿的照片。", tag: "" },
  { href: "/create/image", icon: "fa-image", title: "圖片生成", desc: "用一句話畫一張圖，或請 AI 修改你的照片。", tag: "" },
  { href: "/library", icon: "fa-images", title: "先逛素材圖庫", desc: "6,162 個人像、服裝、姿勢，免費瀏覽。", tag: "" },
];

export function Onboarding() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [page, setPage] = useState(0);
  const [closed, setClosed] = useState(false);
  const [start, setStart] = useState(STARTS[0].href);

  if (!user || user.onboardedAt || closed) return null;

  const finish = async (go?: string) => {
    setClosed(true);
    try {
      await apiRequest("POST", "/api/account/onboarded", {});
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch { /* it will simply show again next time */ }
    if (go) navigate(go);
  };
  const credits = user.credits ?? 0;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-end md:items-center justify-center md:p-4" data-testid="onboarding">
      <div className="bg-white w-full md:max-w-md max-h-[92vh] overflow-auto rounded-t-3xl md:rounded-3xl pb-[env(safe-area-inset-bottom)]">
        <div className="relative overflow-hidden bg-brand-night text-white px-6 pt-7 pb-6 rounded-t-3xl">
          <div className="absolute inset-0 tech-grid" />
          <div className="absolute -top-16 -right-8 w-48 h-48 rounded-full bg-sky-400/30 blur-3xl" />
          <div className="relative">
            <div className="flex gap-1.5 mb-4">
              {[0, 1, 2].map(i => <span key={i} className={`h-1 flex-1 rounded-full ${i <= page ? "bg-white" : "bg-white/25"}`} />)}
            </div>
            <h2 className="text-xl font-bold">
              {page === 0 ? `歡迎，${user.username}` : page === 1 ? "第一件事想做什麼？" : "之後會用到的兩件事"}
            </h2>
            <p className="text-sm text-indigo-200 mt-1">
              {page === 0 ? "三十秒帶你認識這裡。" : page === 1 ? "選一個，我們直接帶你過去。" : "現在不用處理，知道在哪裡就好。"}
            </p>
          </div>
        </div>

        <div className="p-5">
          {page === 0 && (
            <div className="space-y-4">
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-center gap-3">
                <i className="fas fa-coins text-2xl text-amber-500" />
                <div>
                  <p className="text-sm font-bold text-slate-900">你有 {credits} 積分</p>
                  <p className="text-xs text-slate-600">註冊完成信箱驗證送 {SIGNUP_CREDITS} 積分。一張圖 {IMAGE_COST} 積分，現在可以做 {Math.floor(credits / IMAGE_COST)} 張。</p>
                </div>
              </div>
              <ul className="space-y-2.5 text-sm text-slate-700">
                <li className="flex gap-3"><i className="fas fa-wand-magic-sparkles w-5 text-center text-indigo-500 mt-0.5" /><span><b>創作</b>：一句話生成圖片或短影片。</span></li>
                <li className="flex gap-3"><i className="fas fa-camera-retro w-5 text-center text-indigo-500 mt-0.5" /><span><b>寫真工作室</b>：一次生成整組可貼社群的寫真。</span></li>
                <li className="flex gap-3"><i className="fas fa-film w-5 text-center text-indigo-500 mt-0.5" /><span><b>漫劇工作室</b>：從劇情到分鏡、動畫、整集短劇。</span></li>
                <li className="flex gap-3"><i className="fas fa-rotate-left w-5 text-center text-emerald-500 mt-0.5" /><span>生成失敗會自動退還積分，不用擔心白扣。</span></li>
              </ul>
            </div>
          )}

          {page === 1 && (
            <div className="space-y-2">
              {STARTS.map(s => (
                <button key={s.href} onClick={() => setStart(s.href)}
                  className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 text-left transition-colors ${start === s.href ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-200"}`} data-testid={`onboarding-start-${s.href}`}>
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${start === s.href ? "bg-brand text-white" : "bg-slate-100 text-slate-500"}`}><i className={`fas ${s.icon}`} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-900">{s.title}{s.tag && <span className="ml-2 px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 text-[10px] font-semibold align-middle">{s.tag}</span>}</span>
                    <span className="block text-xs text-slate-500">{s.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {page === 2 && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-sky-200 bg-brand-soft p-4">
                <p className="text-sm font-bold text-slate-900"><i className="fas fa-crown text-fuchsia-500 mr-2" />積分用完時：開通會員 US${MEMBERSHIP.priceUsd}</p>
                <p className="text-xs text-slate-600 mt-1">只付一次，拿 {MEMBERSHIP.credits} 積分，沒有月費。開通後可以隨時加購積分。位置：我的 → 帳戶與儲值。</p>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-bold text-slate-900"><i className="fas fa-shield-halved text-indigo-500 mr-2" />安全與隱私</p>
                <p className="text-xs text-slate-600 mt-1">成人內容預設關閉。需要的話，到帳戶頁設定生日並同意條款後才能啟用；啟用後的成品會先模糊顯示。</p>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mt-5">
            {page === 0
              ? <button onClick={() => finish()} className="h-12 px-4 rounded-xl text-sm text-slate-500" data-testid="onboarding-skip">略過</button>
              : <button onClick={() => setPage(p => p - 1)} className="h-12 px-4 rounded-xl text-sm text-slate-500">上一步</button>}
            {page < 2
              ? <button onClick={() => setPage(p => p + 1)} className="flex-1 h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold" data-testid="onboarding-next">下一步</button>
              : <button onClick={() => finish(start)} className="flex-1 h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold" data-testid="onboarding-finish">開始：{STARTS.find(s => s.href === start)?.title}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

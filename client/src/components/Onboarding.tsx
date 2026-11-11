import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { IMAGE_COST, SIGNUP_CREDITS } from "@shared/pricing";

// 第一次登入的引導（users.onboardedAt 是空的才出現）。
// 主線只有一條：帶新客人做出第一組寫真。這一頁先說清楚接下來的四步，按「開始」就進寫真工作室，
// 那裡會照同樣的順序一步一步出現（沒有角色會先跳出建立角色）。做完之後由寫真工作室邀請去會員商城。
// 想先做別的可以按「我想先做別的」，換成選單。做完、選了別的或按「略過」都會記錄，之後不再出現。

const STEPS: Array<{ icon: string; title: string; desc: string }> = [
  { icon: "fa-user-plus", title: "上傳照片，建立你的角色", desc: "準備 6 到 10 張自己的清楚照片。第一次會免費幫你生成角色四視圖。" },
  { icon: "fa-shirt", title: "選一套服裝", desc: "從上千套穿搭裡點一套，也可以按「隨機」。" },
  { icon: "fa-person-walking", title: "選一個姿勢", desc: "不選也可以，AI 會幫你安排。" },
  { icon: "fa-images", title: "生成你的第一組寫真", desc: "AI 先免費規劃鏡頭，確認後才扣積分。" },
];

const OTHERS: Array<{ href: string; icon: string; title: string; desc: string }> = [
  { href: "/character-library", icon: "fa-user-plus", title: "先建立我的角色", desc: "上傳照片建立角色，第一個角色免費生成四視圖，之後每個功能都能用。" },
  { href: "/photoset?mode=scene", icon: "fa-panorama", title: "照片同款", desc: "放一張喜歡的照片，換成你的角色和服裝。" },
  { href: "/product", icon: "fa-bag-shopping", title: "商品帶貨圖", desc: "給一件商品，用你的角色生成帶貨照與貼文文案。" },
  { href: "/create/image", icon: "fa-image", title: "圖片生成", desc: "用一句話畫一張圖，或請 AI 修改你的照片。" },
  { href: "/wall", icon: "fa-globe", title: "先看看別人的作品", desc: "作品牆上的作品可以看提示詞、做同款。" },
  { href: "/library", icon: "fa-images", title: "先逛素材圖庫", desc: "人像、服裝、姿勢，免費瀏覽。" },
];

export function Onboarding() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [showOthers, setShowOthers] = useState(false);
  const [closed, setClosed] = useState(false);

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
  const shots = Math.floor(credits / IMAGE_COST);

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/70 flex items-end md:items-center justify-center md:p-4" data-testid="onboarding">
      <div className="bg-white w-full md:max-w-md max-h-[92vh] overflow-auto rounded-t-3xl md:rounded-3xl pb-[env(safe-area-inset-bottom)]">
        <div className="relative overflow-hidden bg-brand-night text-white px-6 pt-7 pb-6 rounded-t-3xl">
          <div className="absolute inset-0 tech-grid" />
          <div className="absolute -top-16 -right-8 w-48 h-48 rounded-full bg-sky-400/30 blur-3xl" />
          <div className="relative">
            <h2 className="text-xl font-bold">{showOthers ? "想先做什麼？" : `歡迎，${user.username}`}</h2>
            <p className="text-sm text-indigo-200 mt-1">
              {showOthers ? "選一個，直接帶你過去。" : "跟著四個步驟，做出你的第一組社群寫真。"}
            </p>
          </div>
        </div>

        <div className="p-5">
          {!showOthers ? (
            <>
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-center gap-3">
                <i className="fas fa-gift text-2xl text-amber-500" />
                <div>
                  <p className="text-sm font-bold text-slate-900">送你 {credits} 積分</p>
                  <p className="text-xs text-slate-600">
                    {shots > 0 ? `一張寫真 ${IMAGE_COST} 積分，剛好可以做 ${shots} 張。不用綁卡。` : `完成信箱驗證會送 ${SIGNUP_CREDITS} 積分，一張寫真 ${IMAGE_COST} 積分。`}
                  </p>
                </div>
              </div>

              <ol className="mt-4 space-y-3" data-testid="onboarding-steps">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-3">
                    <span className="shrink-0 w-9 h-9 rounded-xl bg-brand text-white text-sm font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-slate-900"><i className={`fas ${s.icon} text-indigo-500 mr-1.5 text-xs`} />{s.title}</span>
                      <span className="block text-xs text-slate-500 mt-0.5">{s.desc}</span>
                    </span>
                  </li>
                ))}
              </ol>

              <button onClick={() => finish("/photoset?mode=kit")} className="mt-5 w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold" data-testid="onboarding-start">
                開始做我的第一組寫真<i className="fas fa-arrow-right ml-2 text-xs" />
              </button>
              <div className="flex items-center justify-between mt-2">
                <button onClick={() => setShowOthers(true)} className="h-11 px-2 text-sm text-indigo-600" data-testid="onboarding-others">我想先做別的</button>
                <button onClick={() => finish()} className="h-11 px-2 text-sm text-slate-400" data-testid="onboarding-skip">略過</button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                {OTHERS.map(o => (
                  <button key={o.href} onClick={() => finish(o.href)}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl border-2 border-slate-200 text-left transition-colors hover:border-indigo-300" data-testid={`onboarding-go-${o.href}`}>
                    <span className="w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><i className={`fas ${o.icon}`} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-slate-900">{o.title}</span>
                      <span className="block text-xs text-slate-500">{o.desc}</span>
                    </span>
                    <i className="fas fa-chevron-right text-xs text-slate-300" />
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-3">不管先做哪一個，第一次建立角色的四視圖都是免費的。</p>
              <button onClick={() => setShowOthers(false)} className="mt-1 h-11 px-2 text-sm text-slate-500">← 回到寫真步驟</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

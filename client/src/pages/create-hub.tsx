import { IMAGE_COST } from "@shared/pricing";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/components/AppNav";
import { Onboarding } from "@/components/Onboarding";

// 創作中心：登入後的首頁。一眼看到三個主要模組與素材圖庫，一次點擊就進到要用的功能。
//
//   主要模組   創作（圖片／影片）、寫真工作室（素材套圖／照片同款）、商品帶貨圖、漫劇工作室
//   素材圖庫   賣點：選好人像、服裝、姿勢就能直接生成
//   個人專區   作品庫、編輯器、帳戶
//   次要素材   角色庫（含上傳照片建立角色）、場景庫

type Stats = { totalGenerations: number; totalCreditsUsed: number; credits: number };
type Action = { href: string; label: string; icon: string };
type Module = { href: string; icon: string; title: string; desc: string; meta: string; tile: string; actions: Action[] };

const MODULES: Module[] = [
  {
    href: "/create/image", icon: "fa-wand-magic-sparkles", title: "創作", meta: `圖片 ${IMAGE_COST} 積分・影片 8 積分／秒起`,
    desc: "用文字或一張圖，生成圖片與短影片。", tile: "from-violet-500 to-indigo-600",
    actions: [
      { href: "/create/image", label: "圖片生成", icon: "fa-image" },
      { href: "/create/video", label: "影片生成", icon: "fa-clapperboard" },
    ],
  },
  {
    href: "/photoset", icon: "fa-camera-retro", title: "寫真工作室", meta: `${IMAGE_COST} 積分／張`,
    desc: "一次生成整組可貼社群的寫真。", tile: "from-indigo-500 to-blue-600",
    actions: [
      { href: "/photoset?mode=kit", label: "素材套圖", icon: "fa-layer-group" },
      { href: "/photoset?mode=scene", label: "照片同款", icon: "fa-panorama" },
    ],
  },
  {
    href: "/product", icon: "fa-bag-shopping", title: "商品帶貨圖", meta: `${IMAGE_COST} 積分／張`,
    desc: "給一件商品，用你的角色生成帶貨照與貼文文案。", tile: "from-fuchsia-500 to-indigo-600",
    actions: [{ href: "/product", label: "開始製作", icon: "fa-arrow-right" }],
  },
  {
    href: "/drama", icon: "fa-film", title: "漫劇工作室", meta: "依幕數計費",
    desc: "從一句劇情，到分鏡、出圖、動畫與整集短劇。", tile: "from-blue-500 to-sky-500",
    actions: [{ href: "/drama", label: "進入工作室", icon: "fa-arrow-right" }],
  },
];

const LIBRARY_TABS = [
  { tab: "portrait", label: "人像", n: "1,499", icon: "fa-face-smile" },
  { tab: "costume", label: "服裝", n: "3,392", icon: "fa-shirt" },
  { tab: "pose", label: "姿勢", n: "2,034", icon: "fa-person-walking" },
];

const ME: Action[] = [
  { href: "/vault", label: "作品庫", icon: "fa-photo-film" },
  { href: "/edit", label: "編輯器", icon: "fa-pen-ruler" },
  { href: "/store", label: "會員商城", icon: "fa-store" },
];
const SECONDARY: Array<Action & { desc: string }> = [
  { href: "/character-library", label: "角色庫", icon: "fa-user-group", desc: "上傳照片建立角色，寫真與漫劇直接套用" },
  { href: "/scene-library", label: "場景庫", icon: "fa-mountain-sun", desc: "保存常用場景，寫真與漫劇直接套用" },
];

function ModuleCard({ m }: { m: Module }) {
  return (
    <div className="group relative bg-white border border-indigo-100 rounded-3xl p-4 sm:p-5 flex flex-col gap-3 transition-all hover:border-indigo-300 hover:shadow-glow" data-testid={`hub-module-${m.href}`}>
      <Link href={m.href}>
        <span className="flex items-start gap-3 cursor-pointer">
          <span className={`shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br ${m.tile} text-white text-lg flex items-center justify-center shadow-glow`}>
            <i className={`fas ${m.icon}`} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-bold text-slate-900">{m.title}</span>
            <span className="block text-sm text-slate-500 leading-snug mt-0.5">{m.desc}</span>
          </span>
        </span>
      </Link>
      <div className={`grid gap-2 mt-auto ${m.actions.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {m.actions.map(a => (
          <Link key={a.href} href={a.href}>
            <span className="flex items-center justify-center gap-2 h-11 rounded-xl bg-indigo-50 text-indigo-700 text-sm font-semibold cursor-pointer transition-colors hover:bg-indigo-100 active:scale-[0.98]" data-testid={`hub-${a.href}`}>
              <i className={`fas ${a.icon} text-xs`} />{a.label}
            </span>
          </Link>
        ))}
      </div>
      <span className="text-[11px] text-slate-400">{m.meta}</span>
    </div>
  );
}

export default function CreateHub() {
  const { user } = useUser();
  const { data: stats } = useQuery<Stats>({ queryKey: ["/api/stats"] });
  const credits = user?.credits ?? 0;

  return (
    <div className="min-h-screen">
      <NavigationHeader />
      <Onboarding />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-5 md:py-8 space-y-6">
        {/* 帳戶摘要 */}
        <section className="relative overflow-hidden bg-brand-night text-white rounded-3xl">
          <div className="absolute inset-0 tech-grid" />
          <div className="absolute -top-20 -right-10 w-64 h-64 rounded-full bg-sky-400/30 blur-3xl" />
          <div className="absolute -bottom-24 left-10 w-64 h-64 rounded-full bg-fuchsia-500/25 blur-3xl" />
          <div className="relative p-5 md:p-7 flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm text-indigo-200 truncate">嗨，{user?.username}，今天想做什麼？</p>
              <p className="mt-1 flex items-baseline gap-2">
                <span className="text-4xl font-bold tabular-nums" data-testid="hub-credits">{credits.toLocaleString()}</span>
                <span className="text-sm text-indigo-200">積分</span>
              </p>
              <p className="text-xs text-indigo-300 mt-1">
                已生成 {(stats?.totalGenerations ?? 0).toLocaleString()} 次・已使用 {(stats?.totalCreditsUsed ?? 0).toLocaleString()} 積分
              </p>
            </div>
            <Link href="/store">
              <span className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-white text-indigo-700 text-sm font-semibold cursor-pointer hover:bg-indigo-50 active:scale-[0.98]" data-testid="hub-topup">
                <i className="fas fa-plus text-xs" />儲值積分
              </span>
            </Link>
          </div>
        </section>

        {credits < IMAGE_COST * 2 && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            積分快用完了，生成一張圖片需要 {IMAGE_COST} 積分。
            <Link href="/store"><span className="ml-2 font-semibold underline underline-offset-4 cursor-pointer" data-testid="hub-low-credits-store">前往會員商城</span></Link>
          </p>
        )}

        <section>
          <h2 className="text-sm font-semibold text-slate-900 mb-3">主要模組</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {MODULES.map(m => <ModuleCard key={m.title} m={m} />)}
          </div>
        </section>

        {/* 素材圖庫：選好就生成 */}
        <section className="relative overflow-hidden rounded-3xl border border-sky-200 bg-brand-soft p-5 md:p-6" data-testid="hub-library">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/80 border border-fuchsia-200 text-[11px] font-semibold text-fuchsia-600">
                <i className="fas fa-bolt" />選好就生成
              </p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">素材圖庫 <span className="text-brand">6,925</span> 個素材</h2>
              <p className="text-sm text-slate-600 mt-1">挑一張人像、一套服裝、幾個姿勢，直接帶進寫真工作室生成整組寫真，不用寫提示詞。</p>
            </div>
            <Link href="/library">
              <span className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-indigo-600 text-white text-sm font-semibold cursor-pointer shadow-glow active:scale-[0.98]" data-testid="hub-/library">
                開啟圖庫<i className="fas fa-arrow-right text-xs" />
              </span>
            </Link>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-4">
            {LIBRARY_TABS.map(t => (
              <Link key={t.tab} href={`/library?tab=${t.tab}`}>
                <span className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/85 border border-white cursor-pointer transition-colors hover:border-indigo-300" data-testid={`hub-library-${t.tab}`}>
                  <span className="hidden sm:flex w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 items-center justify-center"><i className={`fas ${t.icon}`} /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{t.label}</span>
                    <span className="block text-[11px] text-slate-500 tabular-nums">{t.n} 張</span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* 作品牆：看別人做了什麼，一鍵做同款 */}
        <Link href="/wall">
          <span className="group flex items-center gap-4 p-4 sm:p-5 bg-white border border-indigo-100 rounded-3xl cursor-pointer transition-all hover:border-indigo-300 hover:shadow-glow" data-testid="hub-/wall">
            <span className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-fuchsia-500 to-indigo-600 text-white text-lg flex items-center justify-center"><i className="fas fa-globe" /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-base font-bold text-slate-900">作品牆</span>
              <span className="block text-sm text-slate-500">看看大家做了什麼，喜歡的可以看提示詞、一鍵做同款；也可以公開自己的作品。</span>
            </span>
            <i className="fas fa-chevron-right text-xs text-slate-300 group-hover:text-indigo-400" />
          </span>
        </Link>

        <section>
          <h2 className="text-sm font-semibold text-slate-900 mb-3">個人專區</h2>
          <div className="grid grid-cols-3 gap-3">
            {ME.map(a => (
              <Link key={a.href} href={a.href}>
                <span className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 p-3 sm:p-4 bg-white border border-slate-200 rounded-2xl cursor-pointer transition-colors hover:border-indigo-300" data-testid={`hub-${a.href}`}>
                  <span className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center"><i className={`fas ${a.icon}`} /></span>
                  <span className="text-sm font-semibold text-slate-900 text-center">{a.label}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-900 mb-3">角色與場景</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {SECONDARY.map(a => (
              <Link key={a.href} href={a.href}>
                <span className="group flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-2xl cursor-pointer transition-colors hover:border-indigo-300" data-testid={`hub-${a.href}`}>
                  <span className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center"><i className={`fas ${a.icon}`} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{a.label}</span>
                    <span className="block text-xs text-slate-500 truncate">{a.desc}</span>
                  </span>
                  <i className="fas fa-chevron-right text-xs text-slate-300 group-hover:text-indigo-400" />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <p className="text-xs text-slate-400 text-center pt-2">圖片使用 Seedream 5.5，影片使用 WAN 3.0。生成失敗會自動退還積分。</p>
      </main>
    </div>
  );
}

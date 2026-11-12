import { IMAGE_COST, VIDEO_COST_PER_SECOND } from "@shared/pricing";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/components/AppNav";
import { Onboarding } from "@/components/Onboarding";

// 創作中心：登入後的首頁。由上到下：
//
//   範本牆     給不知道要做什麼的人：看圖選一個想要的成果，點了就進到已經選好設定的流程
//              （寫真工作室、UGC 實拍短片、圖生影片、漫劇）。TEMPLATES 的 href 帶著該流程的參數。
//   自由創作   圖片生成、影片生成：給已經知道要打什麼提示詞的人，頁面本身不變。
//   素材圖庫   賣點：選好人像、服裝、姿勢就能直接生成
//   我的       一排小格：作品庫、角色庫、場景庫、編輯器、作品牆、會員商城
//
// 範本牆在手機與平板是一排可以左右滑的卡片（固定寬度），寬螢幕才排成一列五格；
// 卡片的標題疊在圖片下緣，卡片本身不佔太多高度，往下還看得到自由創作。
//
// 範本卡的封面圖與小動畫都是靜態檔（client/public/landing/*.webp、*.mp4）：動畫是用封面圖生成一次的 4 秒無聲循環，
// 壓成小檔放進專案，不會在使用者瀏覽時才生成。沒有圖的範本用漸層加圖示。

type Stats = { totalGenerations: number; totalCreditsUsed: number; credits: number };
type Action = { href: string; label: string; icon: string };
type Template = { href: string; title: string; desc: string; tag: string; icon: string; image?: string; video?: string; tile: string };

const TEMPLATES: Template[] = [
  { href: "/photoset?mode=kit", title: "寫真套圖", desc: "選服裝和姿勢，一次生成整組可以貼的寫真。", tag: "寫真", icon: "fa-camera-retro", image: "/landing/cafe-selfie.webp", video: "/landing/cafe-selfie.mp4", tile: "from-indigo-500 to-blue-600" },
  { href: "/photoset?mode=scene", title: "照片同款", desc: "放一張喜歡的照片，換成你的角色和服裝。", tag: "寫真", icon: "fa-panorama", image: "/landing/street-walk.webp", video: "/landing/street-walk.mp4", tile: "from-indigo-500 to-sky-500" },
  { href: "/ugc", title: "UGC 實拍", desc: "給一件商品，AI 寫腳本，用你的角色拍成帶貨短片。", tag: "影片", icon: "fa-mobile-screen", image: "/landing/tpl-ugc.webp", video: "/landing/tpl-ugc.mp4", tile: "from-fuchsia-500 to-indigo-600" },
  { href: "/create/video", title: "讓照片動起來", desc: "上傳一張圖，變成 4 到 12 秒的短影片。", tag: "影片", icon: "fa-clapperboard", image: "/landing/autumn-selfie.webp", video: "/landing/autumn-selfie.mp4", tile: "from-violet-500 to-indigo-600" },
  { href: "/drama", title: "一句話做短劇", desc: "從一句劇情，到分鏡、出圖、動畫與整集短劇。", tag: "漫劇", icon: "fa-film", image: "/landing/tpl-drama.webp", video: "/landing/tpl-drama.mp4", tile: "from-blue-500 to-sky-500" },
];

const FREE: Array<Action & { desc: string; meta: string }> = [
  { href: "/create/image", label: "圖片生成", icon: "fa-image", desc: "用一句話畫一張圖，或請 AI 修改你的照片。", meta: `${IMAGE_COST} 積分／張` },
  { href: "/create/video", label: "影片生成", icon: "fa-clapperboard", desc: "用文字或一張圖生成短影片，可選 WAN 3.0 或 Kling 4.0。", meta: `${VIDEO_COST_PER_SECOND["720p"]} 積分／秒起` },
];

const LIBRARY_TABS = [
  { tab: "portrait", label: "人像", n: "1,499", icon: "fa-face-smile" },
  { tab: "costume", label: "服裝", n: "3,392", icon: "fa-shirt" },
  { tab: "pose", label: "姿勢", n: "2,034", icon: "fa-person-walking" },
];

const ME: Action[] = [
  { href: "/vault", label: "作品庫", icon: "fa-photo-film" },
  { href: "/character-library", label: "角色庫", icon: "fa-user-group" },
  { href: "/scene-library", label: "場景庫", icon: "fa-mountain-sun" },
  { href: "/edit", label: "編輯器", icon: "fa-pen-ruler" },
  { href: "/wall", label: "作品牆", icon: "fa-globe" },
  { href: "/store", label: "會員商城", icon: "fa-store" },
];

function TemplateCard({ t }: { t: Template }) {
  return (
    <Link href={t.href}>
      <span className="group block w-36 sm:w-44 lg:w-auto shrink-0 snap-start cursor-pointer" data-testid={`hub-template-${t.href}`}>
        <span className="relative block rounded-2xl overflow-hidden border border-indigo-100 transition-all group-hover:border-indigo-300 group-hover:shadow-glow" style={{ aspectRatio: "3 / 4" }}>
          {t.image
            ? <img src={t.image} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
            : <span className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${t.tile} text-white text-4xl`}><i className={`fas ${t.icon}`} aria-hidden="true" /></span>}
          {/* A short silent loop made once from the cover and shipped as a static file; the cover stays underneath
              as the poster and is all that shows when the visitor prefers reduced motion. */}
          {t.video && (
            <video src={t.video} poster={t.image} muted loop playsInline autoPlay preload="metadata" aria-hidden="true" tabIndex={-1}
              className="absolute inset-0 w-full h-full object-cover motion-reduce:hidden" />
          )}
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/55 text-white text-[10px] font-semibold">{t.tag}</span>
          <span className="absolute inset-x-0 bottom-0 pt-10 pb-2.5 px-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
            <span className="block text-sm font-bold text-white leading-tight">{t.title}</span>
          </span>
        </span>
        <span className="block text-[11px] text-slate-500 leading-snug mt-1.5 line-clamp-2">{t.desc}</span>
      </span>
    </Link>
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

        <section data-testid="hub-templates">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-lg font-bold text-slate-900">熱門範本</h2>
            <span className="text-xs text-slate-500">選一個想要的成果，直接開始</span>
          </div>
          <div className="flex gap-3 overflow-x-auto snap-x scroll-pl-4 sm:scroll-pl-6 pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 lg:grid lg:grid-cols-5 lg:overflow-visible">
            {TEMPLATES.map(t => <TemplateCard key={t.href + t.title} t={t} />)}
          </div>
        </section>

        <section data-testid="hub-free">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-lg font-bold text-slate-900">自由創作</h2>
            <span className="text-xs text-slate-500">自己寫提示詞</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FREE.map(a => (
              <Link key={a.href} href={a.href}>
                <span className="group flex items-center gap-4 p-4 sm:p-5 bg-white border border-indigo-100 rounded-3xl cursor-pointer transition-all hover:border-indigo-300 hover:shadow-glow active:scale-[0.99]" data-testid={`hub-${a.href}`}>
                  <span className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white text-lg flex items-center justify-center"><i className={`fas ${a.icon}`} /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-base font-bold text-slate-900">{a.label}</span>
                    <span className="block text-sm text-slate-500 leading-snug">{a.desc}</span>
                    <span className="block text-[11px] text-slate-400 mt-1">{a.meta}</span>
                  </span>
                  <i className="fas fa-chevron-right text-xs text-slate-300 group-hover:text-indigo-400" />
                </span>
              </Link>
            ))}
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

        <section data-testid="hub-me">
          <h2 className="text-lg font-bold text-slate-900 mb-3">我的</h2>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {ME.map(a => (
              <Link key={a.href} href={a.href}>
                <span className="flex flex-col items-center gap-2 p-3 bg-white border border-slate-200 rounded-2xl cursor-pointer transition-colors hover:border-indigo-300" data-testid={`hub-${a.href}`}>
                  <span className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><i className={`fas ${a.icon}`} /></span>
                  <span className="text-xs font-semibold text-slate-900 text-center">{a.label}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <p className="text-xs text-slate-400 text-center pt-2">圖片使用 Seedream 5.5，影片使用 WAN 3.0 或 Kling 4.0。生成失敗會自動退還積分。</p>
      </main>
    </div>
  );
}

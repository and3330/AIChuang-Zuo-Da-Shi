import { tr } from "@/lib/i18n";
import { LangSwitch } from "@/components/LangSwitch";
import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { useSeo } from "@/hooks/use-seo";
import { IMAGE_COST, MEMBERSHIP, SIGNUP_CREDITS, TOPUP_PACKS, TRIAL, VIDEO_COST_PER_SECOND, WATERMARK_REMOVAL_COST } from "@shared/pricing";
import { LIBRARY_TARGETS } from "@shared/libraryCatalog";
import type { PostList } from "@/components/Showcase";

// 首頁（未登入看到的行銷頁）。主打一件事：用自己的照片，一次生成整組能上社群的寫真。
//
// 設計方向（ui-ux-pro-max 產出的設計系統：AI 紫 #7C3AED＋生成粉 #EC4899、粗體大字、大區塊、寬鬆留白、
// 進場用 stagger）：深色電影感畫布、極光漸層、超大標題，內容由上到下是
//   主視覺（真實生成的寫真）→ 數字 → 三步驟（人物、服裝、姿勢）→ 成果 → 其他功能 → 作品牆 → 定價 → 行動呼籲。
// 主視覺與成果區的照片是站內實際生成的作品（client/public/landing/*.webp），保留原本的 AI 浮水印。
// 這一頁不出現黃金會員。動效在「減少動態效果」設定下全部關閉（見 index.css 的 .lp-*）。

const LIBRARY_TOTAL = LIBRARY_TARGETS.pose + LIBRARY_TARGETS.costume + LIBRARY_TARGETS.portrait;
const TOP_PACK = TOPUP_PACKS[TOPUP_PACKS.length - 1];
const TOP_BONUS = Math.round((TOP_PACK.credits / TOP_PACK.twd - 1) * 100);

/** Real results made on the site. `alt` describes the picture for screen readers. */
const SHOTS: Array<{ src: string; alt: string; label: string }> = [
  { src: "/landing/street-walk.webp", alt: tr("AI 生成的寫真：粉色帽T與灰色短裙的女生走在紅磚街道上回頭微笑"), label: tr("街拍・回眸") },
  { src: "/landing/street-laugh.webp", alt: tr("AI 生成的寫真：粉色帽T的女生在紅磚牆邊撥頭髮大笑"), label: tr("街拍・半身") },
  { src: "/landing/autumn-selfie.webp", alt: tr("AI 生成的寫真：橘色大衣與米色圍巾的短髮女生在街上自拍"), label: tr("秋冬穿搭・自拍") },
  { src: "/landing/cafe-stand.webp", alt: tr("AI 生成的寫真：綠色針織外套與白色百褶裙的女生在咖啡廳拿著咖啡"), label: tr("咖啡廳・全身") },
  { src: "/landing/cafe-selfie.webp", alt: tr("AI 生成的寫真：綠色針織外套的女生俯拍大頭自拍"), label: tr("咖啡廳・俯拍") },
];
/** Hero collage: three columns, each scrolling on its own. */
const HERO_COLUMNS = [[0, 3, 2], [1, 4, 0], [2, 3, 1]];

const STEPS: Array<{ n: string; icon: string; title: string; desc: string; library: "portrait" | "costume" | "pose" }> = [
  { n: "01", icon: "fa-user", title: tr("選人物"), desc: tr("上傳你的照片，或從圖庫挑一張人像。之後每一張都是同一張臉。"), library: "portrait" },
  { n: "02", icon: "fa-shirt", title: tr("選服裝"), desc: tr("春夏秋冬 {n} 套穿搭，點一下就換上。", { n: LIBRARY_TARGETS.costume.toLocaleString() }), library: "costume" },
  { n: "03", icon: "fa-person-walking", title: tr("選姿勢"), desc: tr("{n} 個姿勢。場景、鏡頭、表情都能設定，AI 免費幫你規劃鏡頭。", { n: LIBRARY_TARGETS.pose.toLocaleString() }), library: "pose" },
];

/** Why it matters to someone running a social account. */
const REASONS: Array<{ icon: string; title: string; desc: string }> = [
  { icon: "fa-house", title: tr("沒時間出門也沒關係"), desc: tr("在家就能做。不用約攝影師、不用找場地、不用等天氣。") },
  { icon: "fa-calendar-check", title: tr("天天有新照片可以發"), desc: tr("換一套服裝、換一個場景再生成一組，一次備好一整週的貼文。") },
  { icon: "fa-face-smile", title: tr("每一張都是你"), desc: tr("用你的照片當參考，同一張臉，不同穿搭、不同場景。") },
];

type Samples = Partial<Record<"portrait" | "costume" | "pose", Array<{ id: string; name: string; url: string }>>>;

const MORE: Array<{ icon: string; title: string; desc: string }> = [
  { icon: "fa-image", title: tr("圖片生成"), desc: tr("一句話出圖，或上傳照片請 AI 修改。") },
  { icon: "fa-clapperboard", title: tr("影片生成"), desc: tr("讓寫真動起來：一張圖生成 4 到 12 秒短影片。") },
  { icon: "fa-film", title: tr("漫劇工作室"), desc: tr("從一句劇情到分鏡、出圖、動畫。") },
  { icon: "fa-globe", title: tr("作品牆"), desc: tr("看別人的作品與提示詞，一鍵做同款。") },
];

/** Adds .lp-in to every .lp-reveal inside the page as it scrolls into view. */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>(".lp-reveal") ?? []);
    if (!("IntersectionObserver" in window)) { nodes.forEach(n => n.classList.add("lp-in")); return; }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("lp-in"); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    nodes.forEach(n => io.observe(n));
    return () => io.disconnect();
  });
  return root;
}

function Cta({ children, big = false, testid }: { children: React.ReactNode; big?: boolean; testid: string }) {
  return (
    <Link href="/login">
      <span className={`lp-cta inline-flex items-center justify-center gap-2 rounded-full font-bold text-white cursor-pointer whitespace-nowrap ${big ? "h-14 px-9 text-base sm:text-lg" : "h-11 px-6 text-sm"}`} data-testid={testid}>
        {children}<i className="fas fa-arrow-right text-xs" aria-hidden="true" />
      </span>
    </Link>
  );
}

export default function LandingPage() {
  useSeo({
    title: tr("AI 創意工坊 - AI 寫真生成｜上傳照片，一次生成整組社群寫真"),
    description: tr("用自己的照片，一鍵生成整組能上社群的 AI 寫真。{costumes} 套服裝、{poses} 個姿勢任你搭。註冊送 {signup} 積分，每張 {cost} 積分。", { costumes: LIBRARY_TARGETS.costume.toLocaleString(), poses: LIBRARY_TARGETS.pose.toLocaleString(), signup: SIGNUP_CREDITS, cost: IMAGE_COST }),
    keywords: tr("AI寫真,AI網美照,AI換裝,AI形象照,社群寫真,AI圖片生成,AI創意工坊"),
  });

  const root = useReveal();
  const { data: wall } = useQuery<PostList>({ queryKey: ["/api/showcase/posts?sort=hot&page=1"], queryFn: getQueryFn({ on401: "throw" }), retry: false });
  const works = (wall?.items ?? []).filter(p => p.kind === "image");
  const hasWorks = works.length >= 6;
  // Real thumbnails from the asset library, shown inside the three steps when available.
  const { data: samples } = useQuery<Samples>({ queryKey: ["/api/library/samples"], queryFn: getQueryFn({ on401: "throw" }), retry: false });

  const stats: Array<[string, string]> = [
    [LIBRARY_TARGETS.costume.toLocaleString(), tr("套服裝")],
    [LIBRARY_TARGETS.pose.toLocaleString(), tr("個姿勢")],
    [tr("{n} 積分", { n: IMAGE_COST }), tr("一張寫真")],
    [tr("{n} 積分", { n: SIGNUP_CREDITS }), tr("註冊就送")],
  ];

  return (
    <div ref={root} className="lp min-h-screen bg-[#fff7fb] text-slate-900 overflow-x-hidden">
      {/* ── 導覽 ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-fuchsia-200/70 bg-white/80 backdrop-blur-md" aria-label={tr("主要導覽")}>
        <div className="max-w-7xl mx-auto h-16 px-4 sm:px-6 lg:px-8 flex items-center gap-6">
          <Link href="/">
            <span className="flex items-center gap-2.5 cursor-pointer">
              <span className="w-9 h-9 rounded-xl lp-cta text-white flex items-center justify-center"><i className="fas fa-wand-magic-sparkles text-sm" aria-hidden="true" /></span>
              <span className="text-lg font-bold tracking-tight whitespace-nowrap">{tr("AI 創意工坊")}</span>
            </span>
          </Link>
          <div className="hidden lg:flex items-center gap-6 text-sm text-slate-600 whitespace-nowrap">
            <a href="#how" className="hover:text-fuchsia-700 transition-colors">{tr("怎麼做")}</a>
            <a href="#results" className="hover:text-fuchsia-700 transition-colors">{tr("成果")}</a>
            <Link href="/wall"><span className="hover:text-fuchsia-700 transition-colors cursor-pointer">{tr("作品牆")}</span></Link>
            <a href="#pricing" className="hover:text-fuchsia-700 transition-colors">{tr("定價")}</a>
          </div>
          <span className="flex-1" />
          <LangSwitch className="hidden sm:inline-flex text-slate-600 hover:text-fuchsia-700" />
          <Link href="/login"><span className="hidden sm:inline text-sm text-slate-600 hover:text-fuchsia-700 cursor-pointer transition-colors whitespace-nowrap" data-testid="landing-login">{tr("登入")}</span></Link>
          <Cta testid="landing-nav-cta">{tr("免費開始")}</Cta>
        </div>
      </nav>

      {/* ── 主視覺 ── */}
      <header className="relative min-h-[100svh] flex items-center pt-16">
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="lp-aurora lp-aurora-a" />
          <div className="lp-aurora lp-aurora-b" />
          <div className="lp-aurora lp-aurora-c" />
          <div className="absolute inset-0 lp-grid" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#fff7fb] to-transparent" />
        </div>

        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
          <div>
            <p className="lp-rise inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-fuchsia-200 bg-white/70 text-xs sm:text-sm text-slate-700">
              <span className="w-2 h-2 rounded-full bg-emerald-400 lp-pulse" aria-hidden="true" />
              {tr("AI 寫真工作室")}
            </p>
            <h1 className="lp-rise lp-delay-1 mt-6 font-black tracking-tight leading-[1.02] text-[clamp(2.9rem,9vw,6.5rem)]">
              {tr("一鍵生成，")}<br />
              <span className="lp-gradient-text">{tr("人人都是網美。")}</span>
            </h1>
            <p className="lp-rise lp-delay-2 mt-6 max-w-xl text-base sm:text-xl text-slate-600 leading-relaxed">
              {tr("沒時間出門拍照也沒關係。上傳一張照片，選服裝、選姿勢，一次生成整組寫真，直接貼到 IG、Threads、小紅書經營你的社群。")}
            </p>
            <div className="lp-rise lp-delay-3 mt-9 flex flex-wrap items-center gap-4">
              <Cta big testid="landing-hero-cta">{tr("免費做第一組寫真")}</Cta>
              <Link href="/wall">
                <span className="inline-flex items-center gap-2 h-14 px-7 rounded-full border border-fuchsia-300 text-base font-semibold text-slate-900 hover:bg-fuchsia-50 transition-colors cursor-pointer" data-testid="landing-hero-wall">
                  <i className="fas fa-globe text-sm" aria-hidden="true" />{tr("看看大家的作品")}
                </span>
              </Link>
            </div>
            <ul className="lp-rise lp-delay-4 mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
              <li><i className="fas fa-gift text-fuchsia-600 mr-2" aria-hidden="true" />{tr("註冊送 {n} 積分，剛好做 {shots} 張", { n: SIGNUP_CREDITS, shots: Math.floor(SIGNUP_CREDITS / IMAGE_COST) })}</li>
              <li><i className="fas fa-credit-card text-fuchsia-600 mr-2" aria-hidden="true" />{tr("不用綁卡")}</li>
              <li><i className="fas fa-rotate-left text-fuchsia-600 mr-2" aria-hidden="true" />{tr("生成失敗自動退積分")}</li>
            </ul>
          </div>

          {/* 寫真拼貼：站內實際生成的作品 */}
          <div className="relative h-[440px] sm:h-[520px] lg:h-[640px] lp-mosaic" aria-hidden="true">
            <div className="absolute inset-0 grid grid-cols-3 gap-3 sm:gap-4 lp-tilt">
              {HERO_COLUMNS.map((col, c) => (
                <div key={c} className={`flex flex-col gap-3 sm:gap-4 ${c === 1 ? "lp-col-down" : "lp-col-up"}`}>
                  {[...col, ...col].map((n, i) => (
                    <img key={i} src={SHOTS[n].src} alt="" loading={i < 2 ? "eager" : "lazy"} className="w-full rounded-2xl object-cover bg-white/70" />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* ── 三步驟 ── */}
      <section id="how" className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 scroll-mt-16" aria-labelledby="lp-steps">
        <div className="max-w-7xl mx-auto">
          <div className="lp-reveal max-w-3xl">
            <p className="text-sm font-semibold tracking-[0.2em] text-fuchsia-600">{tr("怎麼做")}</p>
            <h2 id="lp-steps" className="mt-3 text-4xl sm:text-6xl font-black tracking-tight leading-tight">{tr("選三樣，")}<br className="sm:hidden" />{tr("就有一整組。")}</h2>
            <p className="mt-5 text-lg text-slate-600">{tr("全部用點的。{n} 個人像、服裝、姿勢素材，怎麼搭都有。", { n: LIBRARY_TOTAL.toLocaleString() })}</p>
          </div>
          <ol className="mt-12 sm:mt-16 grid md:grid-cols-3 gap-5">
            {STEPS.map((s, i) => (
              <li key={s.n} className="lp-reveal lp-card relative overflow-hidden rounded-3xl border border-fuchsia-200/70 bg-white/80 p-8" style={{ transitionDelay: `${i * 90}ms` }}>
                <i className={`fas ${s.icon} absolute top-7 right-8 text-5xl text-fuchsia-600/40`} aria-hidden="true" />
                <span className="block text-7xl font-black tracking-tighter lp-outline-text" aria-hidden="true">{s.n}</span>
                <h3 className="mt-5 text-3xl font-black tracking-tight">{s.title}</h3>
                <p className="mt-3 text-slate-600 leading-relaxed">{s.desc}</p>
                {(samples?.[s.library]?.length ?? 0) >= 4 && (
                  <div className="mt-5 grid grid-cols-4 gap-2" aria-hidden="true">
                    {samples![s.library]!.slice(0, 4).map(a => (
                      <img key={a.id} src={a.url} alt="" loading="lazy" className="w-full aspect-[3/4] object-cover rounded-xl bg-fuchsia-50" />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 為什麼：經營社群的人要的是什麼 ── */}
      <section className="relative px-4 sm:px-6 lg:px-8 pb-24 sm:pb-32" aria-labelledby="lp-why">
        <div className="max-w-7xl mx-auto">
          <h2 id="lp-why" className="lp-reveal text-3xl sm:text-5xl font-black tracking-tight">{tr("經營社群，不用再煩惱沒照片。")}</h2>
          <div className="mt-10 grid md:grid-cols-3 gap-8">
            {REASONS.map((r, i) => (
              <div key={r.title} className="lp-reveal flex gap-4" style={{ transitionDelay: `${i * 80}ms` }}>
                <span className="shrink-0 w-12 h-12 rounded-2xl lp-cta text-white flex items-center justify-center"><i className={`fas ${r.icon}`} aria-hidden="true" /></span>
                <div>
                  <h3 className="text-xl font-bold">{r.title}</h3>
                  <p className="mt-1.5 text-slate-600 leading-relaxed">{r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 數字 ── */}
      <section className="relative border-y border-fuchsia-200/70 bg-white/60" aria-label={tr("平台數字")}>
        <dl className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 md:grid-cols-4">
          {stats.map(([value, label], i) => (
            <div key={label} className={`lp-reveal py-9 md:py-12 text-center ${i % 2 === 1 ? "border-l border-fuchsia-200/70" : ""} ${i >= 2 ? "border-t md:border-t-0 border-fuchsia-200/70" : ""} ${i === 2 ? "md:border-l" : ""}`}>
              <dd className="text-3xl sm:text-5xl font-black tracking-tight tabular-nums">{value}</dd>
              <dt className="mt-2 text-sm text-slate-600">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* ── 成果：站內實際生成的寫真 ── */}
      <section id="results" className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 border-t border-fuchsia-200/70 scroll-mt-16" aria-labelledby="lp-results">
        <div className="max-w-7xl mx-auto">
          <div className="lp-reveal max-w-3xl">
            <p className="text-sm font-semibold tracking-[0.2em] text-fuchsia-600">{tr("成果")}</p>
            <h2 id="lp-results" className="mt-3 text-4xl sm:text-6xl font-black tracking-tight leading-tight">{tr("一出來，")}<br className="sm:hidden" />{tr("就是能發的照片。")}</h2>
            <p className="mt-5 text-lg text-slate-600">{tr("下面每一張都是在這裡生成的，沒有另外修圖。街拍、咖啡廳、自拍視角，下載就能貼上社群。")}</p>
          </div>
          <div className="mt-12 sm:mt-16 grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
            {SHOTS.map((shot, i) => (
              <figure key={shot.src} className={`lp-reveal group relative overflow-hidden rounded-2xl bg-white/70 aspect-[3/4] ${i === 0 ? "col-span-2 md:col-span-1" : ""}`} style={{ transitionDelay: `${i * 70}ms` }}>
                <img src={shot.src} alt={shot.alt} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <figcaption className="absolute inset-x-0 bottom-0 p-3 pt-8 bg-gradient-to-t from-black/75 to-transparent text-xs font-medium text-white">{shot.label}</figcaption>
              </figure>
            ))}
          </div>
          <div className="lp-reveal mt-10 flex justify-center"><Cta big testid="landing-results-cta">{tr("換你做一組")}</Cta></div>
        </div>
      </section>

      {/* ── 其他功能 ── */}
      <section className="relative py-24 sm:py-28 px-4 sm:px-6 lg:px-8 border-t border-fuchsia-200/70" aria-labelledby="lp-more">
        <div className="max-w-7xl mx-auto">
          <h2 id="lp-more" className="lp-reveal text-3xl sm:text-5xl font-black tracking-tight">{tr("寫真之外，還能做這些。")}</h2>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {MORE.map((f, i) => (
              <article key={f.title} className="lp-reveal lp-card rounded-3xl border border-fuchsia-200/70 bg-white/80 p-7" style={{ transitionDelay: `${i * 60}ms` }}>
                <i className={`fas ${f.icon} text-2xl text-fuchsia-600`} aria-hidden="true" />
                <h3 className="mt-4 text-xl font-bold">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── 作品牆：有作品才顯示 ── */}
      {hasWorks && (
        <section className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 border-t border-fuchsia-200/70" aria-labelledby="lp-wall" data-testid="landing-wall">
          <div className="max-w-7xl mx-auto">
            <div className="lp-reveal flex items-end justify-between gap-6 flex-wrap">
              <div>
                <p className="text-sm font-semibold tracking-[0.2em] text-fuchsia-600">{tr("作品牆")}</p>
                <h2 id="lp-wall" className="mt-3 text-4xl sm:text-6xl font-black tracking-tight">{tr("大家正在做這些。")}</h2>
              </div>
              <Link href="/wall"><span className="inline-flex items-center gap-2 h-12 px-6 rounded-full border border-fuchsia-300 text-sm font-semibold hover:bg-fuchsia-50 transition-colors cursor-pointer">{tr("看全部作品")}<i className="fas fa-arrow-right text-xs" aria-hidden="true" /></span></Link>
            </div>
            <div className="mt-12 columns-2 md:columns-3 lg:columns-4 gap-4">
              {works.slice(0, 12).map((p, i) => (
                <Link key={p.id} href={`/wall/${p.id}`}>
                  <span className="lp-reveal group relative block mb-4 break-inside-avoid overflow-hidden rounded-2xl bg-white/70 cursor-pointer" style={{ transitionDelay: `${(i % 4) * 60}ms` }}>
                    <img src={p.mediaUrl} alt={p.title || tr("{name} 的作品", { name: p.author.username })} loading="lazy" className="w-full block transition-transform duration-500 group-hover:scale-105" />
                    <span className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent text-xs text-white flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-300">
                      <span className="flex-1 min-w-0 truncate">{p.title || p.author.username}</span>
                      <span><i className="fas fa-heart text-rose-500 mr-1" aria-hidden="true" />{p.likeCount}</span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 定價 ── */}
      <section id="pricing" className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 border-t border-fuchsia-200/70 scroll-mt-16">
        <div className="max-w-7xl mx-auto">
          <div className="lp-reveal max-w-3xl">
            <p className="text-sm font-semibold tracking-[0.2em] text-fuchsia-600">{tr("定價")}</p>
            <h2 className="mt-3 text-4xl sm:text-6xl font-black tracking-tight">{tr("用多少，付多少。")}</h2>
            <p className="mt-5 text-lg text-slate-600">{tr("沒有月費，不會自動續扣，積分沒有使用期限。先用免費的 {n} 積分試試看。", { n: SIGNUP_CREDITS })}</p>
          </div>

          <div className="mt-12 sm:mt-16 grid lg:grid-cols-3 gap-5 items-stretch">
            <div className="lp-reveal rounded-3xl border border-fuchsia-200/70 bg-white/80 p-8 flex flex-col">
              <p className="text-sm font-semibold text-slate-600">{tr("小試身手")}</p>
              <p className="mt-3 text-5xl font-black tracking-tight">US${TRIAL.priceUsd}</p>
              <ul className="mt-6 space-y-3 text-slate-600 flex-1">
                <li><i className="fas fa-check text-emerald-600 mr-3" aria-hidden="true" />{tr("{n} 積分，約 {shots} 張寫真", { n: TRIAL.credits, shots: Math.floor(TRIAL.credits / IMAGE_COST) })}</li>
                <li><i className="fas fa-check text-emerald-600 mr-3" aria-hidden="true" />{tr("只付一次")}</li>
                <li><i className="fas fa-check text-emerald-600 mr-3" aria-hidden="true" />{tr("每個帳號限購一次")}</li>
              </ul>
            </div>

            <div className="lp-reveal relative rounded-3xl p-[1.5px] lp-border-glow" style={{ transitionDelay: "80ms" }}>
              <div className="h-full rounded-[calc(1.5rem-1.5px)] bg-white p-8 flex flex-col">
                <span className="absolute -top-3 left-8 px-3 py-1 rounded-full lp-cta text-white text-xs font-bold">{tr("最划算")}</span>
                <p className="text-sm font-semibold text-fuchsia-600">{tr("正式會員")}</p>
                <p className="mt-3 text-6xl font-black tracking-tight">US${MEMBERSHIP.priceUsd}</p>
                <ul className="mt-6 space-y-3 text-slate-700 flex-1">
                  <li><i className="fas fa-check text-emerald-600 mr-3" aria-hidden="true" />{tr("{n} 積分，約 {shots} 張寫真", { n: MEMBERSHIP.credits, shots: Math.floor(MEMBERSHIP.credits / IMAGE_COST) })}</li>
                  <li><i className="fas fa-check text-emerald-600 mr-3" aria-hidden="true" />{tr("開通後可以加購儲值包")}</li>
                  <li><i className="fas fa-check text-emerald-600 mr-3" aria-hidden="true" />{tr("只付一次，沒有月費")}</li>
                </ul>
                <div className="mt-8"><Cta big testid="landing-pricing-cta">{tr("先免費試用")}</Cta></div>
              </div>
            </div>

            <div className="lp-reveal rounded-3xl border border-fuchsia-200/70 bg-white/80 p-8 flex flex-col" style={{ transitionDelay: "160ms" }}>
              <p className="text-sm font-semibold text-slate-600">{tr("會員儲值包")}</p>
              <p className="mt-3 text-5xl font-black tracking-tight">NT${TOPUP_PACKS[0].twd}<span className="text-xl font-bold text-slate-600"> {tr("起")}</span></p>
              <ul className="mt-6 space-y-3 text-slate-600 flex-1">
                <li><i className="fas fa-check text-emerald-600 mr-3" aria-hidden="true" />{tr("1 積分 = NT$1")}</li>
                <li><i className="fas fa-check text-emerald-600 mr-3" aria-hidden="true" />{tr("金額越大加贈越多，最高加贈 {n}%", { n: TOP_BONUS })}</li>
                <li><i className="fas fa-check text-emerald-600 mr-3" aria-hidden="true" />{tr("積分沒有使用期限")}</li>
              </ul>
            </div>
          </div>

          <dl className="lp-reveal mt-6 grid sm:grid-cols-3 rounded-3xl border border-fuchsia-200/70 bg-white/60 divide-y sm:divide-y-0 sm:divide-x divide-fuchsia-200/70">
            {[
              [tr("寫真與圖片"), tr("{n} 積分／張", { n: IMAGE_COST }), tr("去浮水印 +{n} 積分", { n: WATERMARK_REMOVAL_COST })],
              [tr("影片 720p"), tr("{n} 積分／秒", { n: VIDEO_COST_PER_SECOND["720p"] }), tr("4 到 12 秒")],
              [tr("影片 1080p"), tr("{n} 積分／秒", { n: VIDEO_COST_PER_SECOND["1080p"] }), tr("4 到 12 秒")],
            ].map(([label, price, note]) => (
              <div key={label} className="p-6">
                <dt className="text-sm text-slate-600">{label}</dt>
                <dd className="mt-1 text-2xl font-black tracking-tight">{price}</dd>
                <dd className="text-xs text-slate-500 mt-1">{note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── 最後一次行動呼籲 ── */}
      <section className="relative py-28 sm:py-40 px-4 sm:px-6 lg:px-8 overflow-hidden border-t border-fuchsia-200/70">
        <div className="absolute inset-0" aria-hidden="true">
          <div className="lp-aurora lp-aurora-d" />
        </div>
        <div className="lp-reveal relative max-w-4xl mx-auto text-center">
          <h2 className="font-black tracking-tight leading-[1.05] text-[clamp(2.4rem,7vw,5rem)]">{tr("你的第一組寫真，")}<br /><span className="lp-gradient-text">{tr("現在就可以開始。")}</span></h2>
          <p className="mt-6 text-lg text-slate-600">{tr("註冊送 {n} 積分，剛好做 {shots} 張，不用綁卡。", { n: SIGNUP_CREDITS, shots: Math.floor(SIGNUP_CREDITS / IMAGE_COST) })}</p>
          <div className="mt-10"><Cta big testid="landing-final-cta">{tr("免費做第一組寫真")}</Cta></div>
        </div>
      </section>

      {/* ── 頁尾 ── */}
      <footer className="border-t border-fuchsia-200/70 px-4 sm:px-6 lg:px-8 py-12 pb-28 sm:pb-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-8 md:items-end md:justify-between text-sm text-slate-600">
          <div>
            <p className="flex items-center gap-2.5 text-slate-900 font-bold text-base">
              <span className="w-8 h-8 rounded-xl lp-cta text-white flex items-center justify-center"><i className="fas fa-wand-magic-sparkles text-xs" aria-hidden="true" /></span>
              {tr("AI 創意工坊")}
            </p>
            <p className="mt-3">{tr("極電行銷整合")}</p>
            <p className="mt-1 text-xs text-slate-500">{tr("使用模型：Seedream 5.5・WAN 3.0・Kling 4.0")}</p>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <p className="flex flex-wrap gap-x-5 gap-y-1">
              <a href="mailto:Service@cms-edu.com" className="hover:text-fuchsia-700 transition-colors">Service@cms-edu.com</a>
              <a href="https://line.me/R/ti/p/@558icnoi" target="_blank" rel="noopener noreferrer" className="hover:text-fuchsia-700 transition-colors">LINE @558icnoi</a>
              <a href="https://www.facebook.com/profile.php?id=61569836876332" target="_blank" rel="noopener noreferrer" className="hover:text-fuchsia-700 transition-colors">{tr("Facebook 粉絲專頁")}</a>
            </p>
            <p className="flex gap-5">
              <Link href="/wall"><span className="hover:text-fuchsia-700 transition-colors cursor-pointer">{tr("作品牆")}</span></Link>
              <LangSwitch className="sm:hidden" />
              <a href="/privacy" className="hover:text-fuchsia-700 transition-colors">{tr("隱私政策")}</a>
              <a href="/terms" className="hover:text-fuchsia-700 transition-colors">{tr("服務條款")}</a>
            </p>
          </div>
        </div>
      </footer>

      {/* ── 手機：固定在底部的開始按鈕 ── */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 p-3 pb-[calc(12px+env(safe-area-inset-bottom))] bg-white/90 backdrop-blur-md border-t border-fuchsia-200/70">
        <Link href="/login">
          <span className="lp-cta flex items-center justify-center gap-2 h-12 rounded-full text-base font-bold text-white cursor-pointer" data-testid="landing-sticky-cta">
            {tr("免費做寫真・送 {n} 積分", { n: SIGNUP_CREDITS })}<i className="fas fa-arrow-right text-xs" aria-hidden="true" />
          </span>
        </Link>
      </div>
    </div>
  );
}

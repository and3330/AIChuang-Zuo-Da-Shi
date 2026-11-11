import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { useSeo } from "@/hooks/use-seo";
import { IMAGE_COST, MEMBERSHIP, SIGNUP_CREDITS, TOPUP_PACKS, TRIAL, VIDEO_COST_PER_SECOND, WATERMARK_REMOVAL_COST } from "@shared/pricing";
import { LIBRARY_TARGETS } from "@shared/libraryCatalog";
import type { PostList } from "@/components/Showcase";

// 首頁（未登入看到的行銷頁）。
//
// 設計方向（ui-ux-pro-max 產出的設計系統：AI 紫 #7C3AED＋生成粉 #EC4899、粗體大字、大區塊、寬鬆留白、
// 進場用 stagger）：深色電影感畫布、極光漸層、超大標題，內容由上到下是
//   主視覺 → 數字 → 功能（不對稱方格）→ 三步驟 → 作品牆的真實作品 → 定價 → 最後一次行動呼籲。
// 作品牆有通過審核的作品時，主視覺與作品區會直接用那些作品；沒有時用漸層色塊，不放假圖。
// 這一頁不出現黃金會員。動效在「減少動態效果」設定下全部關閉（見 index.css 的 .lp-*）。

const LIBRARY_TOTAL = LIBRARY_TARGETS.pose + LIBRARY_TARGETS.costume + LIBRARY_TARGETS.portrait;
const TOP_PACK = TOPUP_PACKS[TOPUP_PACKS.length - 1];
const TOP_BONUS = Math.round((TOP_PACK.credits / TOP_PACK.twd - 1) * 100);

const FEATURES: Array<{ icon: string; title: string; desc: string; span: string; tone: string }> = [
  { icon: "fa-image", title: "圖片生成", desc: "一句話出圖，或上傳照片請 AI 修改。最多帶 10 張參考圖，人物長相不跑掉。", span: "md:col-span-4 md:row-span-2", tone: "from-violet-600/40 via-fuchsia-600/20 to-transparent" },
  { icon: "fa-clapperboard", title: "影片生成", desc: "文字或一張圖，生成 4 到 12 秒的短影片。", span: "md:col-span-2", tone: "from-sky-500/30 to-transparent" },
  { icon: "fa-camera-retro", title: "寫真工作室", desc: "選人像、服裝、姿勢，一次生成整組寫真。", span: "md:col-span-2", tone: "from-pink-500/30 to-transparent" },
  { icon: "fa-film", title: "漫劇工作室", desc: "從一句劇情到分鏡、出圖、動畫。", span: "md:col-span-2", tone: "from-amber-500/25 to-transparent" },
  { icon: "fa-images", title: "素材圖庫", desc: `${LIBRARY_TOTAL.toLocaleString()} 個人像、服裝、姿勢，選好就生成，不用寫提示詞。`, span: "md:col-span-2", tone: "from-emerald-500/25 to-transparent" },
  { icon: "fa-globe", title: "作品牆", desc: "看別人的作品與提示詞，一鍵做同款。", span: "md:col-span-2", tone: "from-indigo-500/30 to-transparent" },
];

const STEPS: Array<{ n: string; title: string; desc: string }> = [
  { n: "01", title: "說出你想要的畫面", desc: "打一句話，或從素材圖庫挑人像、服裝、姿勢。" },
  { n: "02", title: "AI 幫你生成", desc: "圖片幾十秒完成，影片幾分鐘。失敗自動退回積分。" },
  { n: "03", title: "下載、修改、分享", desc: "直接下載，送進編輯器再改，或公開到作品牆。" },
];

/** Fallback tiles for the hero when the wall has no works yet: colour only, no fake pictures. */
const TILE_TONES = [
  "from-violet-500 to-fuchsia-500", "from-sky-500 to-indigo-600", "from-pink-500 to-rose-500", "from-amber-400 to-orange-500",
  "from-emerald-400 to-teal-600", "from-indigo-500 to-violet-700", "from-fuchsia-500 to-purple-700", "from-cyan-400 to-blue-600",
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
      <span className={`lp-cta inline-flex items-center justify-center gap-2 rounded-full font-bold text-white cursor-pointer ${big ? "h-14 px-9 text-base sm:text-lg" : "h-11 px-6 text-sm"}`} data-testid={testid}>
        {children}<i className="fas fa-arrow-right text-xs" aria-hidden="true" />
      </span>
    </Link>
  );
}

export default function LandingPage() {
  useSeo({
    title: "AI 創意工坊 - AI 圖片與影片生成平台 | 文字生圖、圖片編輯、AI 影片製作",
    description: `AI 創意工坊：一句話生成圖片與影片。文字生圖、圖片編輯、整組寫真、漫劇分鏡、${LIBRARY_TOTAL.toLocaleString()} 個素材圖庫。註冊送 ${SIGNUP_CREDITS} 積分，圖片 ${IMAGE_COST} 積分一張。`,
    keywords: "AI圖片生成,AI影片生成,文字生圖,圖片編輯,AI寫真,AI創作,AI繪圖,AI創意工坊",
  });

  const root = useReveal();
  const { data: wall } = useQuery<PostList>({ queryKey: ["/api/showcase/posts?sort=hot&page=1"], queryFn: getQueryFn({ on401: "throw" }), retry: false });
  const works = (wall?.items ?? []).filter(p => p.kind === "image");
  const hasWorks = works.length >= 6;
  // Three hero columns, each scrolling on its own.
  const columns = [0, 1, 2].map(c => (hasWorks ? works.filter((_, i) => i % 3 === c).slice(0, 5) : []));

  const stats: Array<[string, string]> = [
    [LIBRARY_TOTAL.toLocaleString(), "素材圖庫"],
    [`${IMAGE_COST} 積分`, "一張圖片"],
    ["4–12 秒", "AI 短影片"],
    ["10 張", "參考圖上限"],
  ];

  return (
    <div ref={root} className="lp min-h-screen bg-[#07060d] text-white overflow-x-hidden">
      {/* ── 導覽 ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/10 bg-[#07060d]/75 backdrop-blur-md" aria-label="主要導覽">
        <div className="max-w-7xl mx-auto h-16 px-4 sm:px-6 lg:px-8 flex items-center gap-6">
          <Link href="/">
            <span className="flex items-center gap-2.5 cursor-pointer">
              <span className="w-9 h-9 rounded-xl lp-cta text-white flex items-center justify-center"><i className="fas fa-wand-magic-sparkles text-sm" aria-hidden="true" /></span>
              <span className="text-lg font-bold tracking-tight">AI 創意工坊</span>
            </span>
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm text-slate-300">
            <a href="#features" className="hover:text-white transition-colors">功能</a>
            <Link href="/wall"><span className="hover:text-white transition-colors cursor-pointer">作品牆</span></Link>
            <a href="#pricing" className="hover:text-white transition-colors">定價</a>
          </div>
          <span className="flex-1" />
          <Link href="/login"><span className="hidden sm:inline text-sm text-slate-300 hover:text-white cursor-pointer transition-colors" data-testid="landing-login">登入</span></Link>
          <Cta testid="landing-nav-cta">免費開始</Cta>
        </div>
      </nav>

      {/* ── 主視覺 ── */}
      <header className="relative min-h-[100svh] flex items-center pt-16">
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="lp-aurora lp-aurora-a" />
          <div className="lp-aurora lp-aurora-b" />
          <div className="lp-aurora lp-aurora-c" />
          <div className="absolute inset-0 lp-grid" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#07060d] to-transparent" />
        </div>

        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 lg:py-20 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-center">
          <div>
            <p className="lp-rise inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/15 bg-white/5 text-xs sm:text-sm text-slate-200">
              <span className="w-2 h-2 rounded-full bg-emerald-400 lp-pulse" aria-hidden="true" />
              Seedream 5.5 圖片・WAN 3.0 影片
            </p>
            <h1 className="lp-rise lp-delay-1 mt-6 font-black tracking-tight leading-[1.02] text-[clamp(2.9rem,9vw,6.5rem)]">
              一句話，<br />
              <span className="lp-gradient-text">變成作品。</span>
            </h1>
            <p className="lp-rise lp-delay-2 mt-6 max-w-xl text-base sm:text-xl text-slate-300 leading-relaxed">
              圖片、影片、整組寫真、漫劇分鏡，都在同一個地方完成。不會寫提示詞也沒關係，從 {LIBRARY_TOTAL.toLocaleString()} 個素材裡挑，選好就生成。
            </p>
            <div className="lp-rise lp-delay-3 mt-9 flex flex-wrap items-center gap-4">
              <Cta big testid="landing-hero-cta">免費開始創作</Cta>
              <Link href="/wall">
                <span className="inline-flex items-center gap-2 h-14 px-7 rounded-full border border-white/20 text-base font-semibold text-white hover:bg-white/10 transition-colors cursor-pointer" data-testid="landing-hero-wall">
                  <i className="fas fa-globe text-sm" aria-hidden="true" />看看大家的作品
                </span>
              </Link>
            </div>
            <ul className="lp-rise lp-delay-4 mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
              <li><i className="fas fa-gift text-fuchsia-400 mr-2" aria-hidden="true" />註冊送 {SIGNUP_CREDITS} 積分</li>
              <li><i className="fas fa-credit-card text-fuchsia-400 mr-2" aria-hidden="true" />不用綁卡</li>
              <li><i className="fas fa-rotate-left text-fuchsia-400 mr-2" aria-hidden="true" />生成失敗自動退積分</li>
            </ul>
          </div>

          {/* 作品拼貼：有作品牆的作品就用真的，沒有就用色塊 */}
          <div className="relative h-[420px] sm:h-[520px] lg:h-[640px] lp-mosaic" aria-hidden="true">
            <div className="absolute inset-0 grid grid-cols-3 gap-3 sm:gap-4 lp-tilt">
              {columns.map((col, c) => (
                <div key={c} className={`flex flex-col gap-3 sm:gap-4 ${c === 1 ? "lp-col-down" : "lp-col-up"}`}>
                  {(hasWorks ? [...col, ...col] : Array.from({ length: 8 }, (_, i) => i)).map((item, i) => (
                    typeof item === "number" ? (
                      <div key={i} className={`rounded-2xl bg-gradient-to-br ${TILE_TONES[(item + c * 3) % TILE_TONES.length]} opacity-80`} style={{ aspectRatio: (item + c) % 3 === 0 ? "3 / 4" : (item + c) % 3 === 1 ? "1 / 1" : "4 / 5" }} />
                    ) : (
                      <img key={`${item.id}-${i}`} src={item.mediaUrl} alt="" loading={i < 3 ? "eager" : "lazy"} className="w-full rounded-2xl object-cover bg-white/5" />
                    )
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* ── 數字 ── */}
      <section className="relative border-y border-white/10 bg-white/[0.03]" aria-label="平台數字">
        <dl className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 md:grid-cols-4">
          {stats.map(([value, label], i) => (
            <div key={label} className={`lp-reveal py-9 md:py-12 text-center ${i % 2 === 1 ? "border-l border-white/10" : ""} ${i >= 2 ? "border-t md:border-t-0 border-white/10" : ""} ${i === 2 ? "md:border-l" : ""}`}>
              <dd className="text-3xl sm:text-5xl font-black tracking-tight tabular-nums">{value}</dd>
              <dt className="mt-2 text-sm text-slate-400">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* ── 功能：不對稱方格 ── */}
      <section id="features" className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 scroll-mt-16">
        <div className="max-w-7xl mx-auto">
          <div className="lp-reveal max-w-3xl">
            <p className="text-sm font-semibold tracking-[0.2em] text-fuchsia-400">功能</p>
            <h2 className="mt-3 text-4xl sm:text-6xl font-black tracking-tight leading-tight">一個地方，<br className="sm:hidden" />做完所有創作。</h2>
            <p className="mt-5 text-lg text-slate-400">從一張圖到一整集短劇，工具都接在一起：做好的角色可以直接拿去拍寫真、排分鏡、做影片。</p>
          </div>
          <div className="mt-12 sm:mt-16 grid grid-cols-1 md:grid-cols-6 md:auto-rows-[200px] gap-4">
            {FEATURES.map((f, i) => (
              <article key={f.title} className={`lp-reveal lp-card group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-7 flex flex-col justify-end min-h-[180px] ${f.span}`} style={{ transitionDelay: `${i * 60}ms` }}>
                <div className={`absolute inset-0 bg-gradient-to-br ${f.tone} opacity-70 group-hover:opacity-100 transition-opacity duration-300`} aria-hidden="true" />
                <i className={`fas ${f.icon} absolute top-6 right-7 text-white/15 group-hover:text-white/30 transition-colors duration-300 ${i === 0 ? "text-8xl" : "text-5xl"}`} aria-hidden="true" />
                <div className="relative">
                  <h3 className={`font-black tracking-tight ${i === 0 ? "text-3xl sm:text-5xl" : "text-2xl"}`}>{f.title}</h3>
                  <p className={`mt-2 text-slate-300 leading-relaxed ${i === 0 ? "text-base sm:text-lg max-w-md" : "text-sm"}`}>{f.desc}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── 三步驟 ── */}
      <section className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 border-t border-white/10" aria-labelledby="lp-steps">
        <div className="max-w-7xl mx-auto">
          <h2 id="lp-steps" className="lp-reveal text-4xl sm:text-6xl font-black tracking-tight">三步驟，沒有學習門檻。</h2>
          <ol className="mt-12 sm:mt-16 grid md:grid-cols-3 gap-10 md:gap-8">
            {STEPS.map((s, i) => (
              <li key={s.n} className="lp-reveal relative" style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="block text-7xl sm:text-8xl font-black tracking-tighter lp-outline-text" aria-hidden="true">{s.n}</span>
                <h3 className="mt-4 text-2xl font-bold">{s.title}</h3>
                <p className="mt-2 text-slate-400 leading-relaxed">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── 作品牆：有作品才顯示 ── */}
      {hasWorks && (
        <section className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 border-t border-white/10" aria-labelledby="lp-wall" data-testid="landing-wall">
          <div className="max-w-7xl mx-auto">
            <div className="lp-reveal flex items-end justify-between gap-6 flex-wrap">
              <div>
                <p className="text-sm font-semibold tracking-[0.2em] text-fuchsia-400">作品牆</p>
                <h2 id="lp-wall" className="mt-3 text-4xl sm:text-6xl font-black tracking-tight">大家正在做這些。</h2>
              </div>
              <Link href="/wall"><span className="inline-flex items-center gap-2 h-12 px-6 rounded-full border border-white/20 text-sm font-semibold hover:bg-white/10 transition-colors cursor-pointer">看全部作品<i className="fas fa-arrow-right text-xs" aria-hidden="true" /></span></Link>
            </div>
            <div className="mt-12 columns-2 md:columns-3 lg:columns-4 gap-4">
              {works.slice(0, 12).map((p, i) => (
                <Link key={p.id} href={`/wall/${p.id}`}>
                  <span className="lp-reveal group relative block mb-4 break-inside-avoid overflow-hidden rounded-2xl bg-white/5 cursor-pointer" style={{ transitionDelay: `${(i % 4) * 60}ms` }}>
                    <img src={p.mediaUrl} alt={p.title || `${p.author.username} 的作品`} loading="lazy" className="w-full block transition-transform duration-500 group-hover:scale-105" />
                    <span className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent text-xs text-white flex items-center gap-2 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-300">
                      <span className="flex-1 min-w-0 truncate">{p.title || p.author.username}</span>
                      <span><i className="fas fa-heart text-rose-400 mr-1" aria-hidden="true" />{p.likeCount}</span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 定價 ── */}
      <section id="pricing" className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 border-t border-white/10 scroll-mt-16">
        <div className="max-w-7xl mx-auto">
          <div className="lp-reveal max-w-3xl">
            <p className="text-sm font-semibold tracking-[0.2em] text-fuchsia-400">定價</p>
            <h2 className="mt-3 text-4xl sm:text-6xl font-black tracking-tight">用多少，付多少。</h2>
            <p className="mt-5 text-lg text-slate-400">沒有月費，不會自動續扣，積分沒有使用期限。先用免費的 {SIGNUP_CREDITS} 積分試試看。</p>
          </div>

          <div className="mt-12 sm:mt-16 grid lg:grid-cols-3 gap-5 items-stretch">
            <div className="lp-reveal rounded-3xl border border-white/10 bg-white/[0.04] p-8 flex flex-col">
              <p className="text-sm font-semibold text-slate-400">小試身手</p>
              <p className="mt-3 text-5xl font-black tracking-tight">US${TRIAL.priceUsd}</p>
              <ul className="mt-6 space-y-3 text-slate-300 flex-1">
                <li><i className="fas fa-check text-emerald-400 mr-3" aria-hidden="true" />{TRIAL.credits} 積分，約 {Math.floor(TRIAL.credits / IMAGE_COST)} 張圖</li>
                <li><i className="fas fa-check text-emerald-400 mr-3" aria-hidden="true" />只付一次</li>
                <li><i className="fas fa-check text-emerald-400 mr-3" aria-hidden="true" />每個帳號限購一次</li>
              </ul>
            </div>

            <div className="lp-reveal relative rounded-3xl p-[1.5px] lp-border-glow" style={{ transitionDelay: "80ms" }}>
              <div className="h-full rounded-[calc(1.5rem-1.5px)] bg-[#0d0a1a] p-8 flex flex-col">
                <span className="absolute -top-3 left-8 px-3 py-1 rounded-full lp-cta text-xs font-bold">最划算</span>
                <p className="text-sm font-semibold text-fuchsia-300">正式會員</p>
                <p className="mt-3 text-6xl font-black tracking-tight">US${MEMBERSHIP.priceUsd}</p>
                <ul className="mt-6 space-y-3 text-slate-200 flex-1">
                  <li><i className="fas fa-check text-emerald-400 mr-3" aria-hidden="true" />{MEMBERSHIP.credits} 積分，約 {Math.floor(MEMBERSHIP.credits / IMAGE_COST)} 張圖</li>
                  <li><i className="fas fa-check text-emerald-400 mr-3" aria-hidden="true" />開通後可以加購儲值包</li>
                  <li><i className="fas fa-check text-emerald-400 mr-3" aria-hidden="true" />只付一次，沒有月費</li>
                </ul>
                <div className="mt-8"><Cta big testid="landing-pricing-cta">先免費試用</Cta></div>
              </div>
            </div>

            <div className="lp-reveal rounded-3xl border border-white/10 bg-white/[0.04] p-8 flex flex-col" style={{ transitionDelay: "160ms" }}>
              <p className="text-sm font-semibold text-slate-400">會員儲值包</p>
              <p className="mt-3 text-5xl font-black tracking-tight">NT${TOPUP_PACKS[0].twd}<span className="text-xl font-bold text-slate-400"> 起</span></p>
              <ul className="mt-6 space-y-3 text-slate-300 flex-1">
                <li><i className="fas fa-check text-emerald-400 mr-3" aria-hidden="true" />1 積分 = NT$1</li>
                <li><i className="fas fa-check text-emerald-400 mr-3" aria-hidden="true" />金額越大加贈越多，最高加贈 {TOP_BONUS}%</li>
                <li><i className="fas fa-check text-emerald-400 mr-3" aria-hidden="true" />積分沒有使用期限</li>
              </ul>
            </div>
          </div>

          <dl className="lp-reveal mt-6 grid sm:grid-cols-3 rounded-3xl border border-white/10 bg-white/[0.03] divide-y sm:divide-y-0 sm:divide-x divide-white/10">
            {[
              ["圖片", `${IMAGE_COST} 積分／張`, `去浮水印 +${WATERMARK_REMOVAL_COST} 積分`],
              ["影片 720p", `${VIDEO_COST_PER_SECOND["720p"]} 積分／秒`, "4 到 12 秒"],
              ["影片 1080p", `${VIDEO_COST_PER_SECOND["1080p"]} 積分／秒`, "4 到 12 秒"],
            ].map(([label, price, note]) => (
              <div key={label} className="p-6">
                <dt className="text-sm text-slate-400">{label}</dt>
                <dd className="mt-1 text-2xl font-black tracking-tight">{price}</dd>
                <dd className="text-xs text-slate-500 mt-1">{note}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ── 最後一次行動呼籲 ── */}
      <section className="relative py-28 sm:py-40 px-4 sm:px-6 lg:px-8 overflow-hidden border-t border-white/10">
        <div className="absolute inset-0" aria-hidden="true">
          <div className="lp-aurora lp-aurora-d" />
        </div>
        <div className="lp-reveal relative max-w-4xl mx-auto text-center">
          <h2 className="font-black tracking-tight leading-[1.05] text-[clamp(2.4rem,7vw,5rem)]">你的第一張作品，<br /><span className="lp-gradient-text">現在就可以開始。</span></h2>
          <p className="mt-6 text-lg text-slate-300">註冊送 {SIGNUP_CREDITS} 積分，不用綁卡。</p>
          <div className="mt-10"><Cta big testid="landing-final-cta">免費開始創作</Cta></div>
        </div>
      </section>

      {/* ── 頁尾 ── */}
      <footer className="border-t border-white/10 px-4 sm:px-6 lg:px-8 py-12 pb-28 sm:pb-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-8 md:items-end md:justify-between text-sm text-slate-400">
          <div>
            <p className="flex items-center gap-2.5 text-white font-bold text-base">
              <span className="w-8 h-8 rounded-xl lp-cta flex items-center justify-center"><i className="fas fa-wand-magic-sparkles text-xs" aria-hidden="true" /></span>
              AI 創意工坊
            </p>
            <p className="mt-3">極電行銷整合</p>
            <p className="mt-1 text-xs text-slate-500">使用模型：Seedream 5.5・WAN 3.0</p>
          </div>
          <div className="flex flex-col gap-2 md:items-end">
            <p className="flex flex-wrap gap-x-5 gap-y-1">
              <a href="mailto:Service@cms-edu.com" className="hover:text-white transition-colors">Service@cms-edu.com</a>
              <a href="https://line.me/R/ti/p/@558icnoi" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">LINE @558icnoi</a>
              <a href="https://www.facebook.com/profile.php?id=61569836876332" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Facebook 粉絲專頁</a>
            </p>
            <p className="flex gap-5">
              <Link href="/wall"><span className="hover:text-white transition-colors cursor-pointer">作品牆</span></Link>
              <a href="/privacy" className="hover:text-white transition-colors">隱私政策</a>
              <a href="/terms" className="hover:text-white transition-colors">服務條款</a>
            </p>
          </div>
        </div>
      </footer>

      {/* ── 手機：固定在底部的開始按鈕 ── */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 p-3 pb-[calc(12px+env(safe-area-inset-bottom))] bg-[#07060d]/90 backdrop-blur-md border-t border-white/10">
        <Link href="/login">
          <span className="lp-cta flex items-center justify-center gap-2 h-12 rounded-full text-base font-bold cursor-pointer" data-testid="landing-sticky-cta">
            免費開始・送 {SIGNUP_CREDITS} 積分<i className="fas fa-arrow-right text-xs" aria-hidden="true" />
          </span>
        </Link>
      </div>
    </div>
  );
}

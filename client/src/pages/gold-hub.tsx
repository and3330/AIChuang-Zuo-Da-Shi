import { tr } from "@/lib/i18n";
import { Link } from "wouter";
import { GOLD_WATERMARK_REMOVAL_COST, IMAGE_COST } from "@shared/pricing";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/components/AppNav";

// 黃金專區首頁（/gold）。只有黃金會員進得來（App.tsx 的 GoldOnly，伺服器另外再檢查）。
// 這裡的功能和一般區是同一套頁面與同一個模型，只是網址在 /gold 底下：
// 從這些頁面送出的請求才會被伺服器當成黃金專區的請求。

type Tile = { href: string; icon: string; title: string; desc: string; meta: string };

const TILES: Tile[] = [
  { href: "/gold/image", icon: "fa-image", title: tr("圖片生成"), desc: tr("用文字或參考圖生成圖片。"), meta: tr("{0} 積分／張，去浮水印 {1} 積分", { 0: IMAGE_COST, 1: IMAGE_COST + GOLD_WATERMARK_REMOVAL_COST }) },
  { href: "/gold/video", icon: "fa-clapperboard", title: tr("影片生成"), desc: tr("用文字或一張圖生成短影片。"), meta: tr("8 積分／秒起") },
  { href: "/gold/photoset", icon: "fa-camera-retro", title: tr("寫真工作室"), desc: tr("一次生成整組寫真。"), meta: tr("{0} 積分／張，去浮水印 {1} 積分", { 0: IMAGE_COST, 1: IMAGE_COST + GOLD_WATERMARK_REMOVAL_COST }) },
  { href: "/gold/library", icon: "fa-images", title: tr("素材圖庫"), desc: tr("含黃金會員專屬的服裝素材，選好直接帶進寫真。"), meta: tr("免費瀏覽") },
];

export default function GoldHub() {
  const { user } = useUser();
  return (
    <div className="min-h-screen">
      <NavigationHeader />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-5 md:py-8 space-y-6">
        <section className="relative overflow-hidden rounded-3xl bg-brand-night text-white">
          <div className="absolute inset-0 tech-grid" />
          <div className="absolute -top-20 -right-10 w-64 h-64 rounded-full bg-amber-400/30 blur-3xl" />
          <div className="relative p-5 md:p-7">
            <p className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400 text-amber-950 text-[11px] font-bold">
              <i className="fas fa-crown" />{tr("黃金會員")}
            </p>
            <h1 className="mt-3 text-2xl font-bold">{tr("黃金專區")}</h1>
            <p className="mt-1 text-sm text-indigo-200">{tr("更多生成服務。目前積分 {0}，與一般區共用。", { 0: (user?.credits ?? 0).toLocaleString() })}</p>
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TILES.map(t => (
            <Link key={t.href} href={t.href}>
              <span className="group flex items-start gap-3 p-4 sm:p-5 bg-white border border-amber-200 rounded-3xl cursor-pointer transition-all hover:border-amber-400 hover:shadow-glow" data-testid={`gold-${t.href}`}>
                <span className="shrink-0 w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white text-lg flex items-center justify-center">
                  <i className={`fas ${t.icon}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-slate-900">{t.title}</span>
                  <span className="block text-sm text-slate-500 leading-snug mt-0.5">{t.desc}</span>
                  <span className="block text-[11px] text-slate-400 mt-2">{t.meta}</span>
                </span>
                <i className="fas fa-chevron-right text-xs text-slate-300 group-hover:text-amber-500 mt-1" />
              </span>
            </Link>
          ))}
        </section>

        <ul className="text-xs text-slate-500 space-y-1.5 bg-white border border-slate-200 rounded-2xl p-4">
          <li><i className="fas fa-eye-slash text-slate-400 mr-2" />{tr("這裡做出的作品在作品庫會先模糊顯示，按了才看得到。")}</li>
          <li><i className="fas fa-ban text-slate-400 mr-2" />{tr("不接受任何與未成年人或學生相關的內容，也不可使用未經同意的真人肖像。")}</li>
          <li><i className="fas fa-rotate-left text-slate-400 mr-2" />{tr("生成失敗會自動退還積分。")}</li>
        </ul>
      </main>
    </div>
  );
}

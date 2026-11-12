import { tr } from "@/lib/i18n";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

// 參考圖拼合卡片：把這次要用的人像、服裝、姿勢並排成一張圖，
// 每格上方標示「圖1・人像」這樣的編號與名稱。可以下載成一張 PNG，
// 方便存檔、給別人看這組配方，或拿去其他工具當參考。

export type CollageTile = { label: string; name: string; url: string };

const TILE_W = 600, HEAD_H = 76, IMG_H = 800, PAD = 16, GAP = 14;

/** CDN images must come through our proxy so the canvas can be read back. */
function canvasSafeSrc(url: string): string {
  return /^https?:\/\//i.test(url) ? `/api/vault/proxy?url=${encodeURIComponent(url)}` : url;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(tr("圖片讀取失敗")));
    img.src = src;
  });
}

async function renderCollage(tiles: CollageTile[]): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = PAD * 2 + tiles.length * TILE_W + (tiles.length - 1) * GAP;
  canvas.height = PAD * 2 + HEAD_H + IMG_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(tr("瀏覽器不支援"));
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const images = await Promise.all(tiles.map(t => loadImage(canvasSafeSrc(t.url))));
  tiles.forEach((t, i) => {
    const x = PAD + i * (TILE_W + GAP);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(x, PAD, TILE_W, HEAD_H);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "22px sans-serif";
    ctx.fillText(t.label, x + 16, PAD + 30);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px sans-serif";
    let name = t.name;
    while (name.length > 1 && ctx.measureText(name).width > TILE_W - 32) name = name.slice(0, -2) + "…";
    ctx.fillText(name, x + 16, PAD + 62);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(x, PAD + HEAD_H, TILE_W, IMG_H);
    const img = images[i];
    const scale = Math.min(TILE_W / img.width, IMG_H / img.height);
    const w = img.width * scale, h = img.height * scale;
    ctx.drawImage(img, x + (TILE_W - w) / 2, PAD + HEAD_H + (IMG_H - h) / 2, w, h);
  });
  return canvas.toDataURL("image/png");
}

export function ReferenceCollage({ tiles, onClose }: { tiles: CollageTile[]; onClose: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const a = document.createElement("a");
      a.href = await renderCollage(tiles);
      a.download = `reference-collage-${Date.now()}.png`;
      a.click();
    } catch (e) {
      toast({ title: tr("無法產生拼圖"), description: e instanceof Error ? e.message : tr("請稍後再試。"), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-end md:items-center justify-center md:p-6" onClick={onClose}>
      <div className="bg-white w-full md:max-w-3xl max-h-[90vh] overflow-auto rounded-t-3xl md:rounded-3xl p-4 md:p-5 pb-[calc(16px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid="reference-collage">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-base font-bold text-slate-900">{tr("參考圖拼合卡片")}</h3>
          <div className="flex items-center gap-2">
            <button onClick={download} disabled={busy} className="h-9 px-3 rounded-lg border border-slate-200 text-sm text-slate-700 hover:border-indigo-300 disabled:opacity-50" data-testid="button-collage-download">
              <i className="fas fa-download mr-1.5 text-xs" />{busy ? tr("產生中…") : tr("下載拼圖")}
            </button>
            <button onClick={onClose} className="w-9 h-9 rounded-full text-slate-400 hover:bg-slate-100" aria-label={tr("關閉")}><i className="fas fa-xmark" /></button>
          </div>
        </div>
        <div className="bg-slate-900 rounded-2xl p-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }}>
          {tiles.map(t => (
            <div key={t.label} className="min-w-0 rounded-lg overflow-hidden">
              <div className="bg-slate-800 px-2 py-1.5">
                <p className="text-[10px] text-slate-400">{t.label}</p>
                <p className="text-xs font-semibold text-white truncate" title={t.name}>{t.name}</p>
              </div>
              <div className="bg-slate-200" style={{ aspectRatio: "3 / 4" }}>
                <img src={t.url} alt={t.name} className="w-full h-full object-contain" />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">{tr("生成時會依這個順序把圖交給模型：先人像，再服裝，最後是姿勢。")}</p>
      </div>
    </div>
  );
}

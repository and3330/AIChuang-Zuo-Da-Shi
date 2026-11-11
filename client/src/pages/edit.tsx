import { IMAGE_COST, WATERMARK_REMOVAL_COST, imageCost } from "@shared/pricing";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/components/AppNav";
import type { ImageGeneration } from "@shared/schema";
import { IMAGE_RATIOS } from "@shared/imageSizes";
import { EXPRESSIONS, PHOTO_LOOKS } from "@shared/photosetOptions";

// 編輯器：對一張圖做指定的修改，其餘保持不變。
//
//   局部修改 — 在圖上框出要改的地方，再描述要改成什麼
//   換表情   — 只改表情
//   加物件   — 在畫面中加入一樣東西
//   換顏色   — 把某個東西換成另一個顏色
//   質感     — 套用畫面質感
//   高清重製 — 內容不變，以 2K 重新輸出
//
// 每次修改都走既有的圖片編輯端點（Seedream 5.5 edit），所以計費、失敗退點、
// 作品庫都和其他圖片一致。修改的結果可以當成下一次修改的起點，一步一步疊上去。

type Tool = "region" | "expression" | "object" | "recolor" | "look" | "upscale";
type Box = { x: number; y: number; w: number; h: number }; // fractions of the image, 0–1
type Version = { url: string; label: string };

const TOOLS: Array<{ id: Tool; label: string; icon: string; hint: string }> = [
  { id: "region", label: "局部修改", icon: "fa-vector-square", hint: "在圖上拖曳框出要改的地方，再描述要改成什麼。" },
  { id: "expression", label: "換表情", icon: "fa-face-smile", hint: "只改人物的表情，其他都不動。" },
  { id: "object", label: "加物件", icon: "fa-plus", hint: "在畫面中自然地加入一樣東西。" },
  { id: "recolor", label: "換顏色", icon: "fa-palette", hint: "把畫面中的某樣東西換成另一個顏色。" },
  { id: "look", label: "質感", icon: "fa-film", hint: "套用一種畫面質感，內容不變。" },
  { id: "upscale", label: "高清重製", icon: "fa-up-right-and-down-left-from-center", hint: "內容不變，以 2K 解析度重新輸出，補上細節。" },
];

const KEEP = "除此之外，人物的臉部五官、髮型、身形、服裝、姿勢、背景、構圖與光線全部保持完全不變。";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

async function uploadToObjectStorage(file: Blob, type: string): Promise<string> {
  const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
  const { uploadURL } = await uploadRes.json();
  const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": type } });
  if (!putRes.ok) throw new Error("上傳失敗");
  const pathRes = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
  const { objectPath } = await pathRes.json();
  return objectPath as string;
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\{[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (typeof j.error === "string") return j.error; } catch { /* fall through */ }
  }
  return msg;
}

/** A same-origin address for an image, so it can be drawn on a canvas and read back. */
function sameOrigin(url: string): string {
  return /^https?:\/\//i.test(url) ? `/api/vault/proxy?url=${encodeURIComponent(url)}` : url;
}

/** The 2K preset whose shape is closest to the image, as "WIDTHxHEIGHT". */
function nearestSize(width: number, height: number): string {
  const r = width / height;
  let best = IMAGE_RATIOS[0].sizes["2k"];
  let bestDiff = Infinity;
  for (const ratio of IMAGE_RATIOS) {
    const [w, h] = ratio.sizes["2k"];
    const diff = Math.abs(Math.log(w / h / r));
    if (diff < bestDiff) { bestDiff = diff; best = [w, h]; }
  }
  return `${best[0]}x${best[1]}`;
}

export default function EditPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const initial = useMemo(() => new URLSearchParams(window.location.search).get("image") || "", []);
  const [versions, setVersions] = useState<Version[]>(initial ? [{ url: initial, label: "原圖" }] : []);
  const [current, setCurrent] = useState(0);
  const [tool, setTool] = useState<Tool>("region");
  const [box, setBox] = useState<Box | null>(null);
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [color, setColor] = useState("");
  const [expressionId, setExpressionId] = useState(EXPRESSIONS[1].id);
  const [lookId, setLookId] = useState(PHOTO_LOOKS[0].id);
  const [watermark, setWatermark] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [pendingId, setPendingId] = useState("");
  const [pendingLabel, setPendingLabel] = useState("");
  const [uploading, setUploading] = useState(false);

  const source = versions[current]?.url ?? "";
  const cost = imageCost(watermark);
  const credits = user?.credits ?? 0;

  // A new source image invalidates the selection and its measured size.
  useEffect(() => { setBox(null); setNatural(null); }, [source]);

  const { data: pending } = useQuery<ImageGeneration>({
    queryKey: ["/api/image-generations", pendingId],
    queryFn: async () => (await apiRequest("GET", `/api/image-generations/${pendingId}`)).json(),
    enabled: !!pendingId,
    refetchInterval: (q) => (q.state.data?.status === "completed" || q.state.data?.status === "failed" ? false : 2500),
  });

  // Fold a finished edit into the version list.
  useEffect(() => {
    if (!pending || !pendingId) return;
    if (pending.status === "completed") {
      const url = pending.bunnyImageUrl || pending.generatedImageUrl;
      if (url) {
        setVersions(prev => { setCurrent(prev.length); return [...prev, { url, label: pendingLabel }]; });
        setText("");
      }
      setPendingId("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } else if (pending.status === "failed") {
      toast({ title: "修改失敗，積分已退回", description: pending.errorMessage?.slice(0, 120) || "請調整描述後再試一次。", variant: "destructive" });
      setPendingId("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    }
  }, [pending, pendingId, pendingLabel, queryClient, toast]);

  const working = !!pendingId;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > MAX_UPLOAD_BYTES) {
      toast({ title: "無法使用這個檔案", description: "請上傳 20MB 以內的 JPG、PNG 或 WEBP。", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const path = await uploadToObjectStorage(file, file.type);
      setVersions([{ url: path, label: "原圖" }]);
      setCurrent(0);
    } catch (e) {
      toast({ title: "上傳失敗", description: errorText(e), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* ── region selection: drag a rectangle over the image ── */
  const point = (e: React.PointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e: React.PointerEvent) => {
    if (tool !== "region" || working) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragStart.current = point(e);
    setBox(null);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const p = point(e);
    const s = dragStart.current;
    setBox({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = () => {
    dragStart.current = null;
    setBox(b => (b && b.w > 0.03 && b.h > 0.03 ? b : null)); // ignore accidental taps
  };

  /** Copy of the source with the selected region outlined in red. */
  async function markedCopy(b: Box): Promise<string> {
    const img = new Image();
    img.src = sameOrigin(source);
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = Math.max(6, Math.round(Math.max(canvas.width, canvas.height) * 0.006));
    ctx.strokeRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.92));
    if (!blob) throw new Error("無法處理這張圖片");
    return uploadToObjectStorage(blob, "image/jpeg");
  }

  const editMutation = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("請先選擇或上傳一張圖片");
      let prompt = "";
      let label = "";
      let originalImageUrl = source;
      let additionalImageUrls: string[] | undefined;
      const t = text.trim();

      if (tool === "region") {
        if (!box) throw new Error("請先在圖上拖曳，框出要修改的地方");
        if (!t) throw new Error("請描述框內要改成什麼");
        originalImageUrl = await markedCopy(box);
        additionalImageUrls = [source];
        prompt = `第 1 張圖用紅色方框標出了要修改的位置，第 2 張圖是沒有標記的原圖。請以第 2 張原圖為基礎，只在紅框標示的區域做以下修改：${t}。輸出的圖片中不可以出現紅色方框。紅框以外的所有內容保持完全不變。`;
        label = `局部：${t.slice(0, 12)}`;
      } else if (tool === "expression") {
        const exp = EXPRESSIONS.find(e => e.id === expressionId)!;
        prompt = `只修改人物的臉部表情，改為：${exp.text}。${KEEP}`;
        label = `表情：${exp.label}`;
      } else if (tool === "object") {
        if (!t) throw new Error("請描述要加入什麼");
        prompt = `在畫面中自然地加入：${t}。新加入的物件要符合原圖的透視、光線與陰影。${KEEP}`;
        label = `加入：${t.slice(0, 12)}`;
      } else if (tool === "recolor") {
        if (!target.trim() || !color.trim()) throw new Error("請填寫要換色的東西和新的顏色");
        prompt = `把畫面中的「${target.trim()}」的顏色改成${color.trim()}，材質與形狀不變。${KEEP}`;
        label = `換色：${target.trim().slice(0, 8)}`;
      } else if (tool === "look") {
        const look = PHOTO_LOOKS.find(l => l.id === lookId)!;
        prompt = `保持畫面的人物、服裝、姿勢、背景與構圖完全不變，只調整整體的畫面質感。${look.suffix}`;
        label = `質感：${look.label}`;
      } else {
        prompt = "保持畫面的所有內容、構圖、色彩與光線完全不變，以更高的解析度重新輸出，補上皮膚、髮絲、布料與背景的細節，不要改變任何東西的形狀或位置。";
        label = "高清重製";
      }

      const size = natural ? nearestSize(natural.w, natural.h) : "2048x2048";
      const res = await apiRequest("POST", "/api/image-generations", {
        type: "image-to-image", originalImageUrl, additionalImageUrls, prompt, watermark, size,
      });
      const row = await res.json() as ImageGeneration;
      return { id: row.id, label };
    },
    onSuccess: ({ id, label }) => {
      setPendingLabel(label);
      setPendingId(id);
      setBox(null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (e) => toast({ title: "無法送出", description: errorText(e), variant: "destructive" }),
  });

  const busy = working || editMutation.isPending;
  const activeTool = TOOLS.find(t => t.id === tool)!;
  const chip = (on: boolean) => `px-2.5 py-1 rounded-lg border text-xs ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-indigo-300"}`;
  const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent";

  return (
    <div className="min-h-screen bg-slate-50">
      <NavigationHeader />
      <main className="max-w-6xl mx-auto px-4 py-5 md:py-8">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div>
            <h1 className="hidden md:block text-2xl font-bold text-slate-900">編輯器</h1>
            <p className="text-sm text-slate-500 md:mt-1">指定要改的地方，其餘保持不變。每次修改的結果都可以再接著改。</p>
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => handleFile(e.target.files?.[0])} data-testid="input-edit-file" />
            <button onClick={() => fileRef.current?.click()} disabled={uploading || busy} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:border-indigo-300 disabled:opacity-50">
              {uploading ? "上傳中…" : "上傳圖片"}
            </button>
            <Link href="/vault"><span className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 hover:border-indigo-300 cursor-pointer">從作品庫選</span></Link>
          </div>
        </div>

        {!source ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
            <i className="fas fa-wand-magic-sparkles text-3xl text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">上傳一張圖片，或從作品庫選一張開始編輯。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
            {/* ── 圖片 ── */}
            <div className="bg-white border border-slate-200 rounded-2xl p-3">
              <div className="relative flex items-center justify-center bg-slate-100 rounded-xl overflow-hidden min-h-[240px]">
                <div className="relative inline-block touch-none select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                  style={{ cursor: tool === "region" && !busy ? "crosshair" : "default" }}>
                  <img ref={imgRef} src={source} alt="編輯中的圖片" draggable={false}
                    onLoad={e => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    className="block max-w-full max-h-[70vh] object-contain" data-testid="img-edit-source" />
                  {tool === "region" && box && (
                    <div className="absolute border-2 border-red-500 bg-red-500/10 pointer-events-none"
                      style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} data-testid="edit-selection" />
                  )}
                </div>
                {busy && (
                  <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center gap-2">
                    <div className="w-9 h-9 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-slate-600">修改中，約需 1–3 分鐘…</p>
                  </div>
                )}
              </div>

              {versions.length > 1 && (
                <div className="flex gap-2 mt-3 overflow-x-auto pb-1" data-testid="edit-versions">
                  {versions.map((v, i) => (
                    <button key={i} onClick={() => !busy && setCurrent(i)} title={v.label}
                      className={`shrink-0 w-16 rounded-lg border-2 overflow-hidden ${i === current ? "border-indigo-600" : "border-transparent hover:border-slate-300"}`}>
                      <img src={v.url} alt={v.label} className="w-full h-16 object-cover" />
                      <span className="block text-[10px] text-slate-500 truncate px-1 py-0.5">{i === 0 ? "原圖" : `${i}. ${v.label}`}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-3 mt-2 text-xs">
                <a href={source} download target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">下載這一版</a>
                {current > 0 && <span className="text-slate-400">已自動存進作品庫</span>}
              </div>
            </div>

            {/* ── 工具 ── */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {TOOLS.map(t => (
                  <button key={t.id} onClick={() => setTool(t.id)} disabled={busy}
                    className={`p-2 rounded-xl border text-center transition-colors ${tool === t.id ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-indigo-300"}`}
                    data-testid={`tool-${t.id}`}>
                    <i className={`fas ${t.icon} text-sm`} />
                    <span className="block text-xs mt-1">{t.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">{activeTool.hint}</p>

              {tool === "region" && (
                <div className="space-y-2">
                  <p className={`text-xs ${box ? "text-green-600" : "text-amber-600"}`}>{box ? "✓ 已框選範圍，可以重新拖曳調整。" : "① 先在左邊的圖上拖曳出一個方框。"}</p>
                  <textarea value={text} onChange={e => setText(e.target.value.slice(0, 300))} rows={3} disabled={busy}
                    placeholder="② 框內要改成什麼？例如：換成一杯冰拿鐵、把標誌拿掉、改成短袖" className={inputCls} data-testid="input-edit-text" />
                </div>
              )}
              {tool === "expression" && (
                <div className="flex flex-wrap gap-1.5">
                  {EXPRESSIONS.map(e => <button key={e.id} onClick={() => setExpressionId(e.id)} disabled={busy} title={e.text} className={chip(expressionId === e.id)}>{e.label}</button>)}
                </div>
              )}
              {tool === "object" && (
                <textarea value={text} onChange={e => setText(e.target.value.slice(0, 300))} rows={3} disabled={busy}
                  placeholder="要加入什麼？放在哪裡？例如：右手拿著一束白色鬱金香" className={inputCls} data-testid="input-edit-text" />
              )}
              {tool === "recolor" && (
                <div className="grid grid-cols-2 gap-2">
                  <input value={target} onChange={e => setTarget(e.target.value.slice(0, 30))} placeholder="要換色的東西，例如：洋裝" disabled={busy} className={inputCls} data-testid="input-edit-target" />
                  <input value={color} onChange={e => setColor(e.target.value.slice(0, 30))} placeholder="新的顏色，例如：酒紅色" disabled={busy} className={inputCls} data-testid="input-edit-color" />
                </div>
              )}
              {tool === "look" && (
                <div className="grid grid-cols-2 gap-2">
                  {PHOTO_LOOKS.map(l => (
                    <button key={l.id} onClick={() => setLookId(l.id)} disabled={busy} className={`p-2 rounded-lg border text-left ${lookId === l.id ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300"}`}>
                      <span className="block text-sm font-medium text-slate-900">{l.label}</span>
                      <span className="block text-[11px] text-slate-500">{l.hint}</span>
                    </button>
                  ))}
                </div>
              )}
              {tool === "upscale" && (
                <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                  這是用模型以 2K 重新繪製，不是單純放大，所以細節會更清楚，但極細微的地方可能和原圖略有不同。目前最高輸出是 2K。
                </p>
              )}

              <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input type="checkbox" checked={watermark} onChange={e => setWatermark(e.target.checked)} disabled={busy} className="accent-indigo-600" />
                加上浮水印（取消會去除浮水印，+{WATERMARK_REMOVAL_COST} 積分）
              </label>

              <button onClick={() => editMutation.mutate()} disabled={busy || credits < cost}
                className="w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40" data-testid="button-edit-apply">
                {busy ? "修改中…" : `套用修改（${cost} 積分）`}
              </button>
              {credits < cost && <p className="text-xs text-red-500">積分不足，請先儲值。</p>}
              <p className="text-[11px] text-slate-400">修改失敗會自動退還積分。模型有時會連帶改到其他地方，不滿意可以回到上一版重試。</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

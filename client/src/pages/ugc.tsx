import { appearanceNote } from "@shared/photosetPrompt";
import { tr, getLang } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/components/AppNav";
import { CharacterWizard } from "@/components/CharacterWizard";
import { EnhancePromptButton } from "@/components/EnhancePromptButton";
import type { CharacterLibraryItem, FourViewUrls, ImageGeneration, VideoGeneration } from "@shared/schema";
import { imageSizeFor } from "@shared/imageSizes";
import { VIDEO_MODELS, VIDEO_MODEL_KEYS, imageCost, videoCostPerSecond, type VideoModelKey } from "@shared/pricing";
import { photoLookSuffix } from "@shared/photosetOptions";

/** Keyframes are made without the watermark: it would be baked into the video. */
const FRAME_COST = imageCost(false);

// UGC 實拍短片（/ugc）：給一件商品，用自己的角色做一支直式的帶貨短片。
//
//   ① 商品  ② 角色  ③ 片長、鏡頭數與影片模型
//   → AI 寫商品腳本（免費）：導演意圖＋分鏡總表（每鏡的時間、景別、角度、運鏡、畫面、聲音、字幕、敘事目的），
//     寫法取自「AI 短劇導演」skill 的分鏡與 Clip 組裝方式
//   → 生成關鍵幀（Kling 4.0 每個鏡頭一張；WAN、Seedance 每段只有首幀）
//     先生第一張當基準，其餘幾張把它也當參考圖（放在最後一張），服裝、髮型、場景色調才會一致。
//     每張可以單獨重生。「一鍵全部生成」會在關鍵幀都好了之後自動接著生成影片，有一張失敗就停下來。
//   → 每個 Clip 一次影片生成。三個模型一次都能做到 30 秒，所以 30 秒內的片「一次做完」，
//     鏡頭切換寫在影片提示詞裡，不需要自己剪接。
//
// 規劃走 POST /api/photosets/plan（mode "ugc"），關鍵幀走寫真的批次端點，影片走 POST /api/video-generations
// （圖生影片；Kling 的其餘關鍵幀放在 additionalImageUrls）。扣積分、失敗退款、轉存都和原本一樣。
// 字幕是給使用者後製疊上去的文字（可以複製成 SRT）；人物不開口說話。
// 每個可以寫字的地方旁邊都有「強化提示詞」按鈕（POST /api/prompts/enhance）。
// 送給圖片模型的圖片順序固定為 [...角色參考圖, ...商品圖]。

type Shot = {
  title: string; prompt: string; subtitle?: string; seconds?: number; start?: number;
  framing?: string; angle?: string; camera?: string; action?: string; sound?: string; purpose?: string;
  keyframe?: boolean;
};
type Clip = { shots: number[]; seconds: number; motion: string };
type Plan = { analysis: string; intent?: string; shots: Shot[]; clips?: Clip[]; caption?: string; hashtags?: string[] };
type BatchStatus = { batchId: string; generations: ImageGeneration[]; totalCount: number; completedCount: number; failedCount: number };

const MAX_PRODUCT_IMAGES = 3;
const MAX_CHARACTER_IMAGES = 6;
const LENGTHS = [10, 15, 20, 30];
const SHOT_COUNTS = [3, 4, 5, 6];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const RESOLUTION = "720p";

async function uploadToObjectStorage(file: File): Promise<string> {
  const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
  const { uploadURL } = await uploadRes.json();
  const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!putRes.ok) throw new Error(tr("上傳失敗"));
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

function characterImages(c: CharacterLibraryItem | null): string[] {
  if (!c) return [];
  const v = (c.fourViewUrls ?? {}) as FourViewUrls;
  const views = [v.front, v.threeQuarter, v.side, v.back].filter((u): u is string => !!u);
  return Array.from(new Set([...(c.refImageUrls ?? []), ...views])).slice(0, MAX_CHARACTER_IMAGES);
}

function imageNote(personCount: number, productCount: number): string {
  const person = personCount > 1 ? tr("第 1 到 {0} 張圖是同一位人物的參考", { 0: personCount }) : tr("第 1 張圖是人物的參考");
  const first = personCount + 1;
  const product = productCount > 1 ? tr("第 {0} 到 {1} 張圖是同一件商品", { 0: first, 1: personCount + productCount }) : tr("第 {0} 張圖是商品", { 0: first });
  return tr("（{0}，請保持臉部五官、髮型髮色與身形一致，服裝依照提示詞；{1}，畫面中的商品必須與商品圖一致：形狀、顏色、材質、比例與包裝上的圖案文字都不要改變，也不要出現其他商品。）", { 0: person, 1: product });
}

/** 12.5 → "00:12.5" */
function tc(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = Number.isInteger(s) ? String(s).padStart(2, "0") : s.toFixed(1).padStart(4, "0");
  return `${String(m).padStart(2, "0")}:${ss}`;
}
/** 12.5 → "00:00:12,500" (SRT) */
function srtTime(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}

/** One clip: one image-to-video job from its keyframes, followed until it is done. */
function ClipVideo({ frames, clip, model, disabled, autoStart, onAutoStarted }: { frames: string[]; clip: Clip; model: VideoModelKey; disabled: boolean; autoStart?: boolean; onAutoStarted?: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [videoId, setVideoId] = useState("");
  const cost = Math.round(clip.seconds * videoCostPerSecond(model, RESOLUTION));
  const autoFired = useRef(false);

  const start = useMutation({
    mutationFn: async () => {
      const [first, ...rest] = frames;
      const res = await apiRequest("POST", "/api/video-generations", {
        type: "image-to-video", originalImageUrl: first,
        additionalImageUrls: model === "kling" && rest.length > 0 ? rest : undefined,
        prompt: clip.motion.trim(), duration: clip.seconds, resolution: RESOLUTION, videoModel: model,
      });
      return res.json() as Promise<VideoGeneration>;
    },
    onSuccess: (v) => { setVideoId(v.id); queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }); },
    onError: (e) => toast({ title: tr("影片沒有開始"), description: errorText(e), variant: "destructive" }),
  });

  const { data: video } = useQuery<VideoGeneration>({
    queryKey: ["/api/video-generations", videoId],
    queryFn: async () => (await apiRequest("GET", `/api/video-generations/${videoId}`)).json(),
    enabled: !!videoId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "completed" || s === "failed" ? false : 5000;
    },
  });
  // 「一鍵全部生成」：關鍵幀齊了就自己開始，只開始一次。
  useEffect(() => {
    if (!autoStart || autoFired.current || videoId || frames.length === 0 || !clip.motion.trim()) return;
    autoFired.current = true;
    onAutoStarted?.();
    start.mutate();
  }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const url = video?.bunnyVideoUrl || video?.generatedVideoUrl || "";
  const running = start.isPending || (!!videoId && video?.status !== "completed" && video?.status !== "failed");

  if (video?.status === "completed" && url) {
    return (
      <div>
        <video src={url} controls playsInline loop className="w-full max-w-[320px] mx-auto rounded-xl bg-black" style={{ aspectRatio: "9 / 16" }} />
        <div className="flex gap-2 mt-2">
          <a href={url} download target="_blank" rel="noreferrer" className="flex-1 h-10 rounded-xl bg-indigo-600 text-white text-xs font-semibold flex items-center justify-center"><i className="fas fa-download mr-1.5" />{tr("下載")}</a>
          <button onClick={() => start.mutate()} disabled={disabled} className="flex-1 h-10 rounded-xl border border-slate-200 text-xs text-slate-600 disabled:opacity-40">{tr("重做（{0} 積分）", { 0: cost })}</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      {video?.status === "failed" && <p className="text-xs text-red-600 mb-2">{tr("影片生成失敗，積分已退回。可以再試一次。")}</p>}
      <button onClick={() => start.mutate()} disabled={disabled || running || frames.length === 0 || !clip.motion.trim()}
        className="w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-glow disabled:opacity-40 disabled:shadow-none" data-testid="button-ugc-clip">
        {running ? <><i className="fas fa-spinner fa-spin mr-2" />{tr("影片生成中，約 2 到 6 分鐘")}</> : tr("生成影片（{0} 秒・{1} 積分）", { 0: clip.seconds, 1: cost })}
      </button>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-indigo-100 rounded-3xl p-4 md:p-5" data-testid={`ugc-step-${n}`}>
      <h2 className="flex items-center gap-2.5 text-sm font-bold text-slate-900 mb-3">
        <span className="w-7 h-7 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function UgcPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [productImages, setProductImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const [extra, setExtra] = useState("");
  const [seconds, setSeconds] = useState(15);
  const [count, setCount] = useState(4);
  const [model, setModel] = useState<VideoModelKey>("kling");
  const [plan, setPlan] = useState<Plan | null>(null);
  /** 鏡頭 index → 它的關鍵幀在哪一個批次的第幾張。每次生成或重生都是一個批次。 */
  const [frameRefs, setFrameRefs] = useState<Record<number, { batchId: string; pos: number }>>({});
  /** 一鍵全部生成：關鍵幀都好了就自動開始影片。 */
  const [auto, setAuto] = useState(false);
  const restStarted = useRef(false);
  const autoStartedClips = useRef(0);

  const { data: characters = [] } = useQuery<CharacterLibraryItem[]>({ queryKey: ["/api/character-library"] });
  const character = characters.find(c => c.id === characterId) ?? null;
  const personRefs = characterImages(character);
  const credits = user?.credits ?? 0;
  const spec = VIDEO_MODELS[model];
  const perShotFrames = spec.keyframes > 1;
  const clipCount = Math.ceil(seconds / spec.maxSeconds);
  const shots = plan?.shots ?? [];
  const clips = plan?.clips ?? [];
  const keyIdx = shots.map((s, i) => (s.keyframe ? i : -1)).filter(i => i >= 0);
  const framesPlanned = plan ? keyIdx.length : perShotFrames ? count : clipCount;
  const videoCost = Math.round(seconds * videoCostPerSecond(model, RESOLUTION));
  const inputsReady = productImages.length > 0 && personRefs.length > 0;
  const facts = [productName.trim() && `${tr("商品名稱")}：${productName.trim()}`, sellingPoints.trim() && `${tr("賣點")}：${sellingPoints.trim()}`].filter(Boolean).join("\n");
  const resetFrames = () => { setFrameRefs({}); setAuto(false); restStarted.current = false; autoStartedClips.current = 0; };
  const resetPlan = () => { setPlan(null); resetFrames(); };
  const pickSeconds = (s: number) => { setSeconds(s); setCount(c => Math.min(c, Math.floor(s / 1.5))); resetPlan(); };

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter(f => f.type.startsWith("image/") && f.size <= MAX_UPLOAD_BYTES)
      .slice(0, MAX_PRODUCT_IMAGES - productImages.length);
    if (fileRef.current) fileRef.current.value = "";
    if (files.length === 0) { toast({ title: tr("沒有加入照片"), description: tr("請上傳 20MB 以內的 JPG、PNG 或 WEBP。"), variant: "destructive" }); return; }
    setUploading(true);
    try {
      for (const f of files) {
        const path = await uploadToObjectStorage(f);
        setProductImages(prev => (prev.length < MAX_PRODUCT_IMAGES ? [...prev, path] : prev));
      }
      resetPlan();
    } catch (e) {
      toast({ title: tr("上傳失敗"), description: errorText(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const planMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/photosets/plan", {
        lang: getLang(),
        mode: "ugc",
        productImageUrls: productImages,
        referenceImageUrls: personRefs,
        productName: productName.trim() || undefined,
        sellingPoints: sellingPoints.trim() || undefined,
        characterName: character?.name,
        characterDescription: character?.description || undefined,
        direction: extra.trim() || undefined,
        look: "phone",
        aspectRatio: "9:16",
        count,
        totalSeconds: seconds,
        videoModel: model,
      });
      return res.json() as Promise<Plan>;
    },
    onSuccess: (p) => { setPlan(p); resetFrames(); },
    onError: (e) => toast({ title: tr("腳本沒有寫成"), description: errorText(e), variant: "destructive" }),
  });

  const framesMutation = useMutation({
    // anchorUrl：已經生好的第一張關鍵幀。有給的話放在參考圖最後一張，要求服裝、髮型、場景色調照它。
    mutationFn: async ({ indices, anchorUrl }: { indices: number[]; anchorUrl?: string }) => {
      const [first, ...rest] = [...personRefs, ...productImages];
      const extra = [...rest, ...(anchorUrl ? [anchorUrl] : [])];
      const note = imageNote(personRefs.length, productImages.length)
        + (anchorUrl ? tr("（最後一張圖是同一支影片的第一個鏡頭：人物的服裝、髮型、妝容要和它完全一樣；在同一個場景時，環境、光線與色調也要一致。只改變景別、角度與動作，不要照抄它的構圖。）") : "");
      const res = await apiRequest("POST", "/api/image-generations", {
        type: "image-to-image",
        originalImageUrl: first,
        additionalImageUrls: extra.length > 0 ? extra : undefined,
        prompts: indices.map(i => `${shots[i].prompt.trim()}${appearanceNote(character?.description)}${note}${photoLookSuffix("phone")}`),
        watermark: false,
        size: imageSizeFor("9:16", "1.5k"),
      });
      const d = await res.json() as { batchId: string };
      return { batchId: d.batchId, indices };
    },
    onSuccess: ({ batchId, indices }) => {
      setFrameRefs(prev => ({ ...prev, ...Object.fromEntries(indices.map((i, pos) => [i, { batchId, pos }])) }));
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (e) => { setAuto(false); toast({ title: tr("關鍵幀沒有開始生成"), description: errorText(e), variant: "destructive" }); },
  });

  const batchIds = Array.from(new Set(Object.values(frameRefs).map(f => f.batchId)));
  const batchQueries = useQueries({
    queries: batchIds.map(id => ({
      queryKey: ["/api/batch-generations", id],
      queryFn: async () => (await apiRequest("GET", `/api/batch-generations/${id}`)).json() as Promise<BatchStatus>,
      refetchInterval: (query: { state: { data?: BatchStatus } }) => {
        const d = query.state.data;
        return d && d.completedCount + d.failedCount >= d.totalCount ? false : 3000;
      },
    })),
  });
  /** Shot index → its keyframe generation (keyframe shots only). */
  const frameOf = (i: number) => { const f = frameRefs[i]; return f ? batchQueries[batchIds.indexOf(f.batchId)]?.data?.generations[f.pos] : undefined; };
  const frameUrl = (i: number) => { const g = frameOf(i); return g?.status === "completed" ? (g.bunnyImageUrl || g.generatedImageUrl || "") : ""; };
  const frameState = (i: number): "none" | "running" | "done" | "failed" =>
    !frameRefs[i] ? "none" : frameUrl(i) ? "done" : frameOf(i)?.status === "failed" ? "failed" : "running";
  const anchor = keyIdx[0];
  const anchorUrl = anchor === undefined ? "" : frameUrl(anchor);
  const framesStarted = Object.keys(frameRefs).length > 0;
  const framesDone = keyIdx.length > 0 && keyIdx.every(i => frameState(i) === "done");
  const framesFailed = keyIdx.some(i => frameState(i) === "failed");
  const framesReadyCount = keyIdx.filter(i => frameState(i) === "done").length;
  const makingFrames = framesMutation.isPending || keyIdx.some(i => frameState(i) === "running");
  const busy = makingFrames || planMutation.isPending || uploading;
  const framePrice = keyIdx.length * FRAME_COST;
  const allPrice = framePrice + clips.reduce((t, c) => t + Math.round(c.seconds * videoCostPerSecond(model, RESOLUTION)), 0);

  // 第一張好了，其餘的才開始（把第一張當參考）。只自動開始一次；之後缺的、失敗的在各鏡頭自己重生。
  useEffect(() => {
    if (restStarted.current || !anchorUrl) return;
    restStarted.current = true;
    const rest = keyIdx.slice(1).filter(i => !frameRefs[i]);
    if (rest.length > 0) framesMutation.mutate({ indices: rest, anchorUrl });
  }, [anchorUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // 一鍵全部生成遇到失敗的關鍵幀就停下來，不會拿缺圖的分鏡去生成影片。
  useEffect(() => {
    if (!auto || !framesFailed) return;
    setAuto(false);
    toast({ title: tr("自動生成停下來了"), description: tr("有關鍵幀沒有生成成功，積分已退回。重生那一張之後，再按生成影片。"), variant: "destructive" });
  }, [auto, framesFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  const startFrames = (withVideo: boolean) => {
    if (anchor === undefined) return;
    resetFrames();
    setAuto(withVideo);
    framesMutation.mutate({ indices: [anchor] });
  };
  const redoFrame = (i: number) => framesMutation.mutate({ indices: [i], anchorUrl: i === anchor ? undefined : anchorUrl || undefined });

  const postText = plan?.caption ? `${plan.caption}${plan.hashtags?.length ? `\n\n${plan.hashtags.map(h => `#${h}`).join(" ")}` : ""}` : "";
  const srt = shots.map((s, i) => `${i + 1}\n${srtTime(s.start ?? 0)} --> ${srtTime((s.start ?? 0) + (s.seconds ?? 0))}\n${s.subtitle ?? ""}\n`).join("\n");
  const shotLine = (s: Shot, i: number) => `${tr("鏡 {0}", { 0: i + 1 })}｜${tc(s.start ?? 0)}–${tc((s.start ?? 0) + (s.seconds ?? 0))}｜${[s.framing, s.angle, s.camera].filter(Boolean).join("・")}｜${s.action ?? s.title}｜${tr("聲音")}：${s.sound ?? ""}｜${tr("字幕")}：${s.subtitle ?? ""}｜${s.purpose ?? ""}`;
  const fullScript = plan ? [
    `【${tr("導演意圖")}】`, plan.intent ?? plan.analysis, "",
    `【${tr("商品腳本")}】（${tr("{0} 秒・{1} 個鏡頭", { 0: seconds, 1: shots.length })}）`, ...shots.map(shotLine), "",
    ...clips.flatMap((c, k) => [`【${tr("影片提示詞")} ${clips.length > 1 ? `Clip ${k + 1}` : ""}（${tr("{0} 秒", { 0: c.seconds })}）】`, c.motion, ""]),
  ].join("\n") : "";

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: tr("{0}已複製", { 0: what }) }); }
    catch { toast({ title: tr("無法複製"), description: tr("請手動選取文字。"), variant: "destructive" }); }
  };
  const updateShot = (i: number, patch: Partial<Shot>) => setPlan(p => (p ? { ...p, shots: p.shots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) } : p));
  const updateClip = (k: number, motion: string) => setPlan(p => (p?.clips ? { ...p, clips: p.clips.map((c, idx) => (idx === k ? { ...c, motion } : c)) } : p));
  const chip = (on: boolean) => `rounded-xl border-2 text-left transition-colors ${on ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300"}`;

  if (!user) return null;

  return (
    <div className="min-h-screen pb-10">
      <NavigationHeader />
      <div className="max-w-3xl mx-auto px-4 py-5 md:py-8 space-y-4">
        <header>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">{tr("UGC 實拍短片")}</h1>
          <p className="text-sm text-slate-500 mt-1">{tr("給一件商品，AI 幫你寫一支直式帶貨短片的商品腳本與分鏡，再用你的角色一次拍完整支，不用自己剪接。寫腳本免費，每一步都會先顯示要花多少積分。")}</p>
        </header>

        <Section n={1} title={tr("商品")}>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => onFiles(e.target.files)} data-testid="input-ugc-file" />
          <div className="flex flex-wrap gap-2">
            {productImages.map((url, i) => (
              <div key={url} className="relative w-24 h-24 rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                <img src={url} alt={tr("商品照 {0}", { 0: i + 1 })} className="w-full h-full object-cover" />
                <button onClick={() => { setProductImages(prev => prev.filter(u => u !== url)); resetPlan(); }} disabled={busy}
                  className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white text-sm rounded-bl-lg" aria-label={tr("移除商品照 {0}", { 0: i + 1 })}>×</button>
              </div>
            ))}
            {productImages.length < MAX_PRODUCT_IMAGES && (
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 text-slate-400 hover:text-indigo-500 flex flex-col items-center justify-center gap-1 disabled:opacity-50" data-testid="button-ugc-add">
                <i className={`fas ${uploading ? "fa-spinner fa-spin" : "fa-plus"} text-lg`} />
                <span className="text-[11px] font-medium">{productImages.length === 0 ? tr("上傳商品照") : tr("再加一張")}</span>
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">{tr("最多 {0} 張。背景乾淨、商品完整清楚的照片效果最好。", { 0: MAX_PRODUCT_IMAGES })}</p>
          <label className="block mt-3">
            <span className="text-xs text-slate-600">{tr("商品名稱（選填）")}</span>
            <input value={productName} onChange={e => setProductName(e.target.value.slice(0, 80))} placeholder={tr("例如：玫瑰保濕精華 30ml")}
              className="mt-1 w-full h-11 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-ugc-name" />
          </label>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600">{tr("賣點或想說的話（建議填，字幕會照這個寫）")}</span>
              <EnhancePromptButton value={sellingPoints} onChange={v => setSellingPoints(v.slice(0, 800))} kind="copy" context={productName} disabled={busy} testId="enhance-ugc-points" />
            </div>
            <textarea value={sellingPoints} onChange={e => setSellingPoints(e.target.value.slice(0, 800))} rows={3} placeholder={tr("例如：質地清爽不黏、早晚都能用、這週免運")}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none" data-testid="input-ugc-points" aria-label={tr("賣點")} />
          </div>
        </Section>

        <Section n={2} title={tr("角色")}>
          {characters.length === 0 ? (
            <button onClick={() => setShowWizard(true)} className="w-full p-4 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 text-left" data-testid="button-ugc-new-character">
              <span className="block text-sm font-bold text-indigo-700"><i className="fas fa-user-plus mr-2" />{tr("先建立你的角色")}</span>
              <span className="block text-xs text-slate-600 mt-1">{tr("上傳自己的照片，之後每一支影片都是你。第一個角色免費。")}</span>
            </button>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {characters.map(c => {
                const cover = characterImages(c)[0];
                return (
                  <button key={c.id} onClick={() => { setCharacterId(c.id); resetPlan(); }} disabled={busy}
                    className={`shrink-0 w-24 p-1.5 ${chip(characterId === c.id)}`} data-testid={`ugc-character-${c.id}`}>
                    <span className="block w-full rounded-lg overflow-hidden bg-slate-100" style={{ aspectRatio: "3 / 4" }}>
                      {cover && <img src={cover} alt={c.name} className="w-full h-full object-cover" />}
                    </span>
                    <span className="block text-xs font-semibold text-slate-800 mt-1 truncate text-center">{c.name}</span>
                  </button>
                );
              })}
              <button onClick={() => setShowWizard(true)} disabled={busy} className="shrink-0 w-24 rounded-xl border-2 border-dashed border-slate-300 text-slate-400 hover:text-indigo-500 hover:border-indigo-400 flex flex-col items-center justify-center gap-1">
                <i className="fas fa-plus" /><span className="text-[11px]">{tr("新角色")}</span>
              </button>
            </div>
          )}
        </Section>

        <Section n={3} title={tr("影片模型、片長與鏡頭數")}>
          <span className="block text-xs text-slate-600 mb-1.5">{tr("影片模型（整支片用同一個）")}</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {VIDEO_MODEL_KEYS.map(k => {
              const m = VIDEO_MODELS[k];
              return (
                <button key={k} onClick={() => { setModel(k); resetPlan(); }} disabled={busy} className={`p-3 ${chip(model === k)}`} data-testid={`ugc-model-${k}`}>
                  <span className="block text-sm font-bold text-slate-900">{m.label}</span>
                  <span className="block text-[11px] text-slate-500">{tr("{0} 積分／秒・一次最長 {1} 秒", { 0: m.perSecond[RESOLUTION], 1: m.maxSeconds })}</span>
                  <span className="block text-[11px] text-slate-500">{m.keyframes > 1 ? tr("每個鏡頭都有關鍵幀，最穩定") : tr("只有首幀，其餘鏡頭靠提示詞")}{m.audio ? tr("・有現場音") : tr("・無聲")}</span>
                </button>
              );
            })}
          </div>
          <span className="block text-xs text-slate-600 mt-3 mb-1.5">{tr("片長")}</span>
          <div className="grid grid-cols-4 gap-2">
            {LENGTHS.map(s => (
              <button key={s} onClick={() => pickSeconds(s)} disabled={busy} className={`p-2.5 text-center ${chip(seconds === s)}`} data-testid={`ugc-length-${s}`}>
                <span className="block text-sm font-bold text-slate-900">{tr("{0} 秒", { 0: s })}</span>
              </button>
            ))}
          </div>
          <span className="block text-xs text-slate-600 mt-3 mb-1.5">{tr("鏡頭數（在同一支影片裡切換）")}</span>
          <div className="grid grid-cols-4 gap-2">
            {SHOT_COUNTS.map(n => (
              <button key={n} onClick={() => { setCount(n); resetPlan(); }} disabled={busy || n * 1.5 > seconds} className={`p-2.5 text-center disabled:opacity-40 ${chip(count === n)}`} data-testid={`ugc-count-${n}`}>
                <span className="block text-sm font-bold text-slate-900">{tr("{0} 個鏡頭", { 0: n })}</span>
                <span className="block text-[11px] text-slate-500">{tr("每鏡約 {0} 秒", { 0: Math.round((seconds / n) * 2) / 2 })}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-indigo-700 mt-2">
            {clipCount === 1
              ? tr("{0} 一次可以做 {1} 秒，這支 {2} 秒的片會一次生成完，鏡頭切換寫在提示詞裡，不用剪接。", { 0: spec.label, 1: spec.maxSeconds, 2: seconds })
              : tr("{0} 一次最長 {1} 秒，這支片會分成 {2} 段生成。", { 0: spec.label, 1: spec.maxSeconds, 2: clipCount })}
          </p>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-600">{tr("其他要求（選填）")}</span>
              <EnhancePromptButton value={extra} onChange={v => setExtra(v.slice(0, 300))} kind="copy" context={facts} disabled={busy} testId="enhance-ugc-extra" />
            </div>
            <input value={extra} onChange={e => setExtra(e.target.value.slice(0, 300))} placeholder={tr("例如：在房間的梳妝台前、穿居家服")}
              className="mt-1 w-full h-11 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-ugc-extra" aria-label={tr("其他要求")} />
          </div>
          <p className="text-xs text-slate-600 mt-3 rounded-xl bg-slate-50 px-3 py-2.5" data-testid="ugc-estimate">
            {tr("整支大約")}<b className="text-slate-900">{tr("{0} 積分", { 0: framesPlanned * FRAME_COST + videoCost })}</b>{tr("：關鍵幀 {0} 張 {1} 積分，影片 {2} 秒 {3} 積分。先寫腳本不用錢。", { 0: framesPlanned, 1: framesPlanned * FRAME_COST, 2: seconds, 3: videoCost })}
          </p>
          <button onClick={() => planMutation.mutate()} disabled={!inputsReady || busy}
            className="mt-3 w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-ugc-plan">
            {planMutation.isPending ? tr("AI 寫商品腳本中…") : plan ? tr("重新寫腳本") : tr("寫商品腳本（免費）")}
          </button>
          {!inputsReady && <p className="text-[11px] text-slate-400 mt-2 text-center">{productImages.length === 0 ? tr("先上傳商品照。") : tr("再選一個角色。")}</p>}
        </Section>

        {plan && (
          <section className="bg-white border border-indigo-300 rounded-3xl p-4 md:p-5 shadow-glow" data-testid="ugc-plan">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">{tr("商品腳本")}<span className="ml-2 text-xs font-normal text-slate-500">{tr("{0} 秒・{1} 個鏡頭・{2}", { 0: seconds, 1: shots.length, 2: spec.label })}</span></h2>
              <button onClick={() => copy(fullScript, tr("完整腳本"))} className="h-8 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700" data-testid="button-ugc-copy-script">{tr("複製完整腳本")}</button>
            </div>
            {plan.analysis && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{plan.analysis}</p>}
            {plan.intent && (
              <div className="mt-3 rounded-2xl bg-indigo-50 border border-indigo-100 p-3">
                <span className="text-xs font-bold text-indigo-900"><i className="fas fa-clapperboard mr-1.5" />{tr("導演意圖")}</span>
                <p className="text-xs text-slate-700 mt-1 whitespace-pre-wrap leading-relaxed">{plan.intent}</p>
              </div>
            )}

            <h3 className="text-xs font-bold text-slate-900 mt-4">{tr("分鏡")}</h3>
            <ol className="mt-2 space-y-3">
              {shots.map((s, i) => {
                const fs = frameState(i);
                const url = frameUrl(i);
                const canRedo = framesStarted && fs !== "running" && (i === anchor || !!anchorUrl);
                return (
                  <li key={i} className="rounded-2xl border border-slate-200 p-3" data-testid={`ugc-shot-${i}`}>
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="text-xs font-bold text-slate-900">{tr("鏡 {0}・{1}", { 0: i + 1, 1: s.title })}</span>
                      <span className="text-[11px] font-mono text-slate-500">{tc(s.start ?? 0)}–{tc((s.start ?? 0) + (s.seconds ?? 0))}・{tr("{0} 秒", { 0: s.seconds ?? 0 })}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {[s.framing, s.angle, s.camera].filter(Boolean).map((t, k) => <span key={k} className="text-[11px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{t}</span>)}
                      {s.purpose && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">{s.purpose}</span>}
                    </div>
                    {s.action && <p className="text-xs text-slate-700 mt-2"><b className="text-slate-500 font-medium">{tr("畫面")}：</b>{s.action}</p>}
                    {s.sound && <p className="text-xs text-slate-600 mt-1"><b className="text-slate-500 font-medium">{tr("聲音")}：</b>{s.sound}</p>}
                    <div className="mt-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500">{tr("字幕")}</span>
                        <EnhancePromptButton value={s.subtitle ?? ""} onChange={v => updateShot(i, { subtitle: v.slice(0, 60) })} kind="subtitle" context={facts} disabled={busy} />
                      </div>
                      <input value={s.subtitle ?? ""} onChange={e => updateShot(i, { subtitle: e.target.value.slice(0, 60) })} aria-label={tr("鏡 {0} 的字幕", { 0: i + 1 })}
                        className="mt-0.5 w-full h-10 px-2.5 border border-amber-200 bg-amber-50 rounded-lg text-sm font-semibold text-slate-900" />
                    </div>
                    {s.keyframe ? (
                      <div className={`mt-2 grid gap-3 ${fs !== "none" ? "sm:grid-cols-[120px_1fr]" : ""}`}>
                        {fs !== "none" && (
                          <div className="rounded-xl overflow-hidden bg-slate-100 border border-slate-200 mx-auto w-[120px]" style={{ aspectRatio: "9 / 16" }}>
                            {url ? <img src={url} alt={tr("鏡 {0} 的關鍵幀", { 0: i + 1 })} className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-xs text-slate-400">
                                  {fs === "failed" ? <><i className="fas fa-circle-exclamation text-red-400" />{tr("關鍵幀失敗")}</> : <><i className="fas fa-spinner fa-spin" />{tr("生成中")}</>}
                                </div>}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-500">{tr("關鍵幀畫面")}{i === anchor && keyIdx.length > 1 && <span className="ml-1.5 text-indigo-600">{tr("基準：其他鏡頭照這張的服裝與場景")}</span>}</span>
                            <EnhancePromptButton value={s.prompt} onChange={v => updateShot(i, { prompt: v })} kind="image" context={facts} disabled={busy} />
                          </div>
                          <textarea value={s.prompt} onChange={e => updateShot(i, { prompt: e.target.value })} rows={3} disabled={busy} aria-label={tr("鏡 {0} 的關鍵幀畫面", { 0: i + 1 })}
                            className="mt-0.5 w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs leading-relaxed resize-none disabled:bg-slate-50" />
                          {canRedo && (
                            <button onClick={() => redoFrame(i)} disabled={busy || credits < FRAME_COST || !s.prompt.trim()}
                              className="mt-1 h-9 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 disabled:opacity-40" data-testid={`button-ugc-redo-frame-${i}`}>
                              <i className="fas fa-rotate mr-1.5" />{fs === "done" ? tr("重生這張（{0} 積分）", { 0: FRAME_COST }) : tr("生成這張（{0} 積分）", { 0: FRAME_COST })}
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-400 mt-2">{tr("這個鏡頭由影片模型接著拍，畫面寫在下方的影片提示詞裡。")}</p>
                    )}
                  </li>
                );
              })}
            </ol>

            {!framesStarted ? (
              <>
                <button onClick={() => startFrames(true)} disabled={busy || keyIdx.length === 0 || credits < allPrice}
                  className="mt-4 w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-glow disabled:opacity-40 disabled:shadow-none" data-testid="button-ugc-all">
                  <i className="fas fa-wand-magic-sparkles mr-2" />{tr("一鍵全部生成：關鍵幀＋影片（{0} 積分）", { 0: allPrice })}
                </button>
                <button onClick={() => startFrames(false)} disabled={busy || keyIdx.length === 0 || credits < framePrice}
                  className="mt-2 w-full h-11 rounded-xl border border-indigo-200 text-indigo-700 text-sm font-semibold disabled:opacity-40" data-testid="button-ugc-frames">
                  {tr("先只生成 {0} 張關鍵幀，看過再決定（{1} 積分）", { 0: keyIdx.length, 1: framePrice })}
                </button>
                <p className="text-[11px] text-slate-500 mt-2 text-center">{keyIdx.length > 1 ? tr("會先生成第一張當基準，其餘幾張照它的服裝與場景，人物才不會每個鏡頭都不一樣。關鍵幀不含浮水印。") : tr("關鍵幀不含浮水印。")}</p>
                {credits < framePrice && (
                  <p className="text-xs text-red-600 mt-2 text-center">{tr("需要 {0} 積分，目前剩 {1}。", { 0: framePrice, 1: credits })}<Link href="/store"><span className="underline cursor-pointer font-semibold">{tr("前往會員商城")}</span></Link></p>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500 mt-4" data-testid="ugc-frames-status">
                {framesDone ? tr("關鍵幀好了。滿意就往下生成影片；不滿意可以改畫面描述後重生那一張。")
                  : framesFailed && !makingFrames ? tr("有關鍵幀沒有生成成功，積分已退回。請在那個鏡頭按「生成這張」。")
                  : tr("關鍵幀生成中 {0}／{1}", { 0: framesReadyCount, 1: keyIdx.length })}
                {auto && !framesDone && <span className="ml-1 text-indigo-700">{tr("好了會自動接著生成影片。")}<button onClick={() => setAuto(false)} className="ml-1 underline">{tr("改成我自己按")}</button></span>}
                {!makingFrames && <button onClick={() => resetFrames()} className="ml-2 underline text-indigo-600">{tr("全部重新生成")}</button>}
              </p>
            )}

            {clips.map((c, k) => {
              const frames = c.shots.filter(i => shots[i]?.keyframe).map(frameUrl);
              const ready = frames.length > 0 && frames.every(Boolean);
              return (
                <div key={k} className="mt-4 rounded-2xl border border-indigo-200 p-3" data-testid={`ugc-clip-${k}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      <i className="fas fa-film text-indigo-500 mr-1.5" />
                      {clips.length > 1 ? tr("第 {0} 段影片（鏡 {1}–{2}・{3} 秒）", { 0: k + 1, 1: c.shots[0] + 1, 2: c.shots[c.shots.length - 1] + 1, 3: c.seconds }) : tr("整支影片（{0} 秒・一次生成）", { 0: c.seconds })}
                    </span>
                    <EnhancePromptButton value={c.motion} onChange={v => updateClip(k, v)} kind="video" context={facts} disabled={busy} />
                  </div>
                  <span className="block text-[11px] text-slate-500 mt-1">{tr("影片提示詞（英文，給影片模型；鏡頭切換與時間都寫在裡面）")}</span>
                  <textarea value={c.motion} onChange={e => updateClip(k, e.target.value)} rows={7} aria-label={tr("影片提示詞")}
                    className="mt-0.5 w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs font-mono leading-relaxed" />
                  <div className="mt-2">
                    {ready ? <ClipVideo frames={frames} clip={c} model={model} disabled={busy} autoStart={auto && framesDone}
                        onAutoStarted={() => { autoStartedClips.current += 1; if (autoStartedClips.current >= clips.length) setAuto(false); }} />
                      : <p className="text-[11px] text-slate-400 text-center">{tr("先生成關鍵幀，才能生成影片。")}</p>}
                  </div>
                </div>
              );
            })}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900"><i className="fas fa-closed-captioning text-amber-500 mr-1.5" />{tr("字幕檔（SRT）")}</span>
                  <button onClick={() => copy(srt, tr("字幕"))} className="h-8 px-3 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-amber-800">{tr("複製")}</button>
                </div>
                <p className="text-xs text-slate-700 mt-2 whitespace-pre-wrap leading-relaxed font-mono max-h-48 overflow-y-auto">{srt}</p>
              </div>
              {postText && (
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3" data-testid="ugc-caption">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900"><i className="fas fa-pen-nib text-amber-500 mr-1.5" />{tr("貼文文案")}</span>
                    <button onClick={() => copy(postText, tr("文案"))} className="h-8 px-3 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-amber-800">{tr("複製")}</button>
                  </div>
                  <p className="text-xs text-slate-700 mt-2 whitespace-pre-wrap leading-relaxed">{postText}</p>
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-3">{tr("影片本身不含字幕，字幕檔可以直接匯入剪映、CapCut 等軟體。字幕與文案由 AI 撰寫，發布前請確認內容符合商品實際情況與平台的廣告規範。")}</p>
          </section>
        )}
      </div>
      {showWizard && <CharacterWizard onClose={() => setShowWizard(false)} onCreated={(id) => { setCharacterId(id); resetPlan(); }} />}
    </div>
  );
}

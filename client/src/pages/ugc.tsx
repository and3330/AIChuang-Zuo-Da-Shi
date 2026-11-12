import { tr, getLang } from "@/lib/i18n";
import { useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/components/AppNav";
import { CharacterWizard } from "@/components/CharacterWizard";
import type { CharacterLibraryItem, FourViewUrls, ImageGeneration, VideoGeneration } from "@shared/schema";
import { imageSizeFor } from "@shared/imageSizes";
import { VIDEO_MODELS, VIDEO_MODEL_KEYS, imageCost, videoCostPerSecond, type VideoModelKey } from "@shared/pricing";

/** First frames are made without the watermark: it would be baked into the video. */
const FRAME_COST = imageCost(false);
import { photoLookSuffix } from "@shared/photosetOptions";

// UGC 實拍短片（/ugc）：給一件商品，用自己的角色做一支直式的帶貨短片。這是一條「影片腳本流」：
//
//   ① 商品  ② 角色  ③ 鏡頭數與影片模型
//   → AI 寫腳本（免費）：每個鏡頭有首幀圖描述、動態描述、字幕、秒數；另附貼文文案
//   → 生成首幀圖（一次全部，不含浮水印的價格 FRAME_COST／張）
//   → 每個鏡頭各自把首幀變成影片（依影片模型每秒計價），可以單獨重做
//
// 規劃走 POST /api/photosets/plan（mode "ugc"），首幀走寫真的批次端點，影片走 POST /api/video-generations
// （圖生影片，首幀已經是 CDN 網址）。所以扣積分、失敗退款、轉存都和原本的圖片、影片一樣。
// 字幕是給使用者後製疊在畫面上的文字；影片本身不會讓人物開口說話，也不會自動接成一支。
// 送給圖片模型的圖片順序固定為 [...角色參考圖, ...商品圖]。

type Shot = { title: string; prompt: string; motion?: string; subtitle?: string; seconds?: number };
type Plan = { analysis: string; shots: Shot[]; caption?: string; hashtags?: string[] };
type BatchStatus = { batchId: string; generations: ImageGeneration[]; totalCount: number; completedCount: number; failedCount: number };

const MAX_PRODUCT_IMAGES = 3;
const MAX_CHARACTER_IMAGES = 6;
const SHOT_COUNTS = [3, 4, 5];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const RESOLUTION = "720p";
const DEFAULT_MOTION = "The person holds the product toward the camera and smiles slightly, handheld phone footage with a gentle natural sway. The product keeps its exact shape, color and label. Natural phone-video look, no text overlay.";

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

/** One shot's clip: starts the image-to-video job for its first frame and follows it until it is done. */
function ShotClip({ frameUrl, shot, model, disabled }: { frameUrl: string; shot: Shot; model: VideoModelKey; disabled: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [videoId, setVideoId] = useState("");
  const seconds = shot.seconds ?? 5;
  const cost = Math.round(seconds * videoCostPerSecond(model, RESOLUTION));

  const start = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/video-generations", {
        type: "image-to-video", originalImageUrl: frameUrl, prompt: (shot.motion || DEFAULT_MOTION).trim(),
        duration: seconds, resolution: RESOLUTION, videoModel: model,
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
  const url = video?.bunnyVideoUrl || video?.generatedVideoUrl || "";
  const running = start.isPending || (!!videoId && video?.status !== "completed" && video?.status !== "failed");

  if (video?.status === "completed" && url) {
    return (
      <div>
        <video src={url} controls playsInline loop className="w-full rounded-xl bg-black" style={{ aspectRatio: "9 / 16" }} />
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
      <button onClick={() => start.mutate()} disabled={disabled || running}
        className="w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40">
        {running ? <><i className="fas fa-spinner fa-spin mr-2" />{tr("影片生成中，約 1 到 3 分鐘")}</> : tr("把這一格變成影片（{0} 秒・{1} 積分）", { 0: seconds, 1: cost })}
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
  const [count, setCount] = useState(4);
  const [model, setModel] = useState<VideoModelKey>("wan");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [batchId, setBatchId] = useState("");

  const { data: characters = [] } = useQuery<CharacterLibraryItem[]>({ queryKey: ["/api/character-library"] });
  const character = characters.find(c => c.id === characterId) ?? null;
  const personRefs = characterImages(character);
  const credits = user?.credits ?? 0;
  const shots = (plan?.shots ?? []).filter(s => s.prompt.trim().length > 0);
  const perSecond = videoCostPerSecond(model, RESOLUTION);
  const clipsCost = (plan ? shots : Array.from({ length: count }, () => ({ seconds: 5 }))).reduce((t, s) => t + Math.round((s.seconds ?? 5) * perSecond), 0);
  const inputsReady = productImages.length > 0 && personRefs.length > 0;
  const resetPlan = () => { setPlan(null); setBatchId(""); };

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
        direction: extra.trim() || undefined,
        look: "phone",
        aspectRatio: "9:16",
        count,
      });
      return res.json() as Promise<Plan>;
    },
    onSuccess: (p) => { setPlan(p); setBatchId(""); },
    onError: (e) => toast({ title: tr("腳本沒有寫成"), description: errorText(e), variant: "destructive" }),
  });

  const framesMutation = useMutation({
    mutationFn: async () => {
      const [first, ...rest] = [...personRefs, ...productImages];
      const note = imageNote(personRefs.length, productImages.length);
      const res = await apiRequest("POST", "/api/image-generations", {
        type: "image-to-image",
        originalImageUrl: first,
        additionalImageUrls: rest.length > 0 ? rest : undefined,
        prompts: shots.map(s => `${s.prompt.trim()}${note}${photoLookSuffix("phone")}`),
        watermark: false,
        size: imageSizeFor("9:16", "1.5k"),
      });
      return res.json() as Promise<{ batchId: string }>;
    },
    onSuccess: (d) => { setBatchId(d.batchId); queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }); },
    onError: (e) => toast({ title: tr("首幀沒有開始生成"), description: errorText(e), variant: "destructive" }),
  });

  const { data: batch } = useQuery<BatchStatus>({
    queryKey: ["/api/batch-generations", batchId],
    queryFn: async () => (await apiRequest("GET", `/api/batch-generations/${batchId}`)).json(),
    enabled: !!batchId,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 3000;
      return d.completedCount + d.failedCount >= d.totalCount ? false : 3000;
    },
  });
  const batchDone = !!batch && batch.completedCount + batch.failedCount >= batch.totalCount;
  const makingFrames = framesMutation.isPending || (!!batchId && !batchDone);
  const busy = makingFrames || planMutation.isPending || uploading;
  const framePrice = shots.length * FRAME_COST;
  const postText = plan?.caption ? `${plan.caption}${plan.hashtags?.length ? `\n\n${plan.hashtags.map(h => `#${h}`).join(" ")}` : ""}` : "";
  const subtitles = shots.map((s, i) => `${i + 1}. ${s.subtitle ?? ""}`).join("\n");

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: tr("{0}已複製", { 0: what }) }); }
    catch { toast({ title: tr("無法複製"), description: tr("請手動選取文字。"), variant: "destructive" }); }
  };
  const updateShot = (i: number, patch: Partial<Shot>) => setPlan(p => (p ? { ...p, shots: p.shots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) } : p));
  const chip = (on: boolean) => `rounded-xl border-2 text-left transition-colors ${on ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300"}`;

  if (!user) return null;

  return (
    <div className="min-h-screen pb-10">
      <NavigationHeader />
      <div className="max-w-3xl mx-auto px-4 py-5 md:py-8 space-y-4">
        <header>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">{tr("UGC 實拍短片")}</h1>
          <p className="text-sm text-slate-500 mt-1">{tr("給一件商品，AI 幫你寫一支直式帶貨短片的腳本，再用你的角色一個鏡頭一個鏡頭拍出來。寫腳本免費，每一步都會先顯示要花多少積分。")}</p>
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
          <label className="block mt-3">
            <span className="text-xs text-slate-600">{tr("賣點或想說的話（建議填，字幕會照這個寫）")}</span>
            <textarea value={sellingPoints} onChange={e => setSellingPoints(e.target.value.slice(0, 800))} rows={3} placeholder={tr("例如：質地清爽不黏、早晚都能用、這週免運")}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none" data-testid="input-ugc-points" />
          </label>
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

        <Section n={3} title={tr("鏡頭數與影片模型")}>
          <div className="grid grid-cols-3 gap-2">
            {SHOT_COUNTS.map(n => (
              <button key={n} onClick={() => { setCount(n); resetPlan(); }} disabled={busy} className={`p-3 text-center ${chip(count === n)}`} data-testid={`ugc-count-${n}`}>
                <span className="block text-sm font-bold text-slate-900">{tr("{0} 個鏡頭", { 0: n })}</span>
                <span className="block text-[11px] text-slate-500">{tr("約 {0} 秒", { 0: n * 5 })}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {VIDEO_MODEL_KEYS.map(k => (
              <button key={k} onClick={() => setModel(k)} disabled={busy} className={`p-3 ${chip(model === k)}`} data-testid={`ugc-model-${k}`}>
                <span className="block text-sm font-bold text-slate-900">{VIDEO_MODELS[k].label}</span>
                <span className="block text-[11px] text-slate-500">{tr("{0} 積分／秒・720p", { 0: VIDEO_MODELS[k].perSecond[RESOLUTION] })}</span>
              </button>
            ))}
          </div>
          <label className="block mt-3">
            <span className="text-xs text-slate-600">{tr("其他要求（選填）")}</span>
            <input value={extra} onChange={e => setExtra(e.target.value.slice(0, 300))} placeholder={tr("例如：在房間的梳妝台前、穿居家服")}
              className="mt-1 w-full h-11 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-ugc-extra" />
          </label>
          <p className="text-xs text-slate-600 mt-3 rounded-xl bg-slate-50 px-3 py-2.5" data-testid="ugc-estimate">
            {tr("整支大約")}<b className="text-slate-900">{tr("{0} 積分", { 0: count * FRAME_COST + clipsCost })}</b>{tr("：首幀圖 {0} 張 {1} 積分，影片 {2} 積分。先寫腳本不用錢，影片可以一個鏡頭一個鏡頭做。", { 0: count, 1: count * FRAME_COST, 2: clipsCost })}
          </p>
          <button onClick={() => planMutation.mutate()} disabled={!inputsReady || busy}
            className="mt-3 w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-ugc-plan">
            {planMutation.isPending ? tr("AI 寫腳本中…") : plan ? tr("重新寫腳本") : tr("寫腳本（免費）")}
          </button>
          {!inputsReady && <p className="text-[11px] text-slate-400 mt-2 text-center">{productImages.length === 0 ? tr("先上傳商品照。") : tr("再選一個角色。")}</p>}
        </Section>

        {plan && (
          <section className="bg-white border border-indigo-300 rounded-3xl p-4 md:p-5 shadow-glow" data-testid="ugc-plan">
            <h2 className="text-sm font-bold text-slate-900">{tr("腳本")}</h2>
            {plan.analysis && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{plan.analysis}</p>}

            <ol className="mt-3 space-y-3">
              {plan.shots.map((s, i) => {
                const g = batch?.generations[i];
                const frameUrl = g?.status === "completed" ? (g.bunnyImageUrl || g.generatedImageUrl || "") : "";
                return (
                  <li key={i} className="rounded-2xl border border-slate-200 p-3" data-testid={`ugc-shot-${i}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">{tr("鏡頭 {0}・{1}", { 0: i + 1, 1: s.title })}</span>
                      <span className="text-[11px] text-slate-500">{tr("{0} 秒", { 0: s.seconds ?? 5 })}</span>
                    </div>
                    <label className="block mt-2">
                      <span className="text-[11px] text-slate-500">{tr("字幕")}</span>
                      <input value={s.subtitle ?? ""} onChange={e => updateShot(i, { subtitle: e.target.value.slice(0, 60) })}
                        className="mt-0.5 w-full h-10 px-2.5 border border-amber-200 bg-amber-50 rounded-lg text-sm font-semibold text-slate-900" />
                    </label>
                    <div className={`mt-2 grid gap-3 ${g ? "sm:grid-cols-[150px_1fr]" : ""}`}>
                      {g && (
                        <div className="rounded-xl overflow-hidden bg-slate-100 border border-slate-200 mx-auto w-[150px]" style={{ aspectRatio: "9 / 16" }}>
                          {frameUrl ? <img src={frameUrl} alt={tr("鏡頭 {0} 的首幀", { 0: i + 1 })} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-xs text-slate-400">
                                {g.status === "failed" ? <><i className="fas fa-circle-exclamation text-red-400" />{tr("首幀失敗")}</> : <><i className="fas fa-spinner fa-spin" />{tr("首幀生成中")}</>}
                              </div>}
                        </div>
                      )}
                      <div className="min-w-0">
                        <label className="block">
                          <span className="text-[11px] text-slate-500">{tr("畫面（首幀）")}</span>
                          <textarea value={s.prompt} onChange={e => updateShot(i, { prompt: e.target.value })} rows={3} disabled={busy || !!batchId}
                            className="mt-0.5 w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs leading-relaxed resize-none disabled:bg-slate-50" />
                        </label>
                        <label className="block mt-2">
                          <span className="text-[11px] text-slate-500">{tr("動作（給影片模型，英文）")}</span>
                          <textarea value={s.motion ?? ""} onChange={e => updateShot(i, { motion: e.target.value })} rows={3}
                            className="mt-0.5 w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs leading-relaxed resize-none" />
                        </label>
                        {frameUrl && <div className="mt-2"><ShotClip frameUrl={frameUrl} shot={s} model={model} disabled={busy} /></div>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            {!batchId ? (
              <>
                <button onClick={() => framesMutation.mutate()} disabled={busy || shots.length < 2 || credits < framePrice}
                  className="mt-4 w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-glow disabled:opacity-40 disabled:shadow-none" data-testid="button-ugc-frames">
                  {makingFrames ? tr("首幀生成中…") : tr("生成 {0} 張首幀圖（{1} 積分，不含浮水印）", { 0: shots.length, 1: framePrice })}
                </button>
                {credits < framePrice && (
                  <p className="text-xs text-red-600 mt-2 text-center">{tr("需要 {0} 積分，目前剩 {1}。", { 0: framePrice, 1: credits })}<Link href="/store"><span className="underline cursor-pointer font-semibold">{tr("前往會員商城")}</span></Link></p>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500 mt-4">
                {batchDone ? tr("首幀好了。滿意的鏡頭按「把這一格變成影片」；不滿意可以先改畫面描述，再重新寫腳本。") : tr("首幀生成中 {0}／{1}", { 0: batch?.completedCount ?? 0, 1: batch?.totalCount ?? shots.length })}
                {batchDone && <button onClick={() => setBatchId("")} disabled={busy} className="ml-2 underline text-indigo-600">{tr("重新生成首幀")}</button>}
              </p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900"><i className="fas fa-closed-captioning text-amber-500 mr-1.5" />{tr("字幕稿")}</span>
                  <button onClick={() => copy(subtitles, tr("字幕"))} className="h-8 px-3 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-amber-800">{tr("複製")}</button>
                </div>
                <p className="text-xs text-slate-700 mt-2 whitespace-pre-wrap leading-relaxed">{subtitles}</p>
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
            <p className="text-[11px] text-slate-500 mt-3">{tr("影片是一段一段的，字幕需要自己在剪輯軟體疊上去並把各段接起來。字幕與文案由 AI 撰寫，發布前請確認內容符合商品實際情況與平台的廣告規範。")}</p>
          </section>
        )}
      </div>
      {showWizard && <CharacterWizard onClose={() => setShowWizard(false)} onCreated={(id) => { setCharacterId(id); resetPlan(); }} />}
    </div>
  );
}

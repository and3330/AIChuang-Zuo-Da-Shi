import { tr, getLang } from "@/lib/i18n";
import { useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/components/AppNav";
import { CharacterWizard } from "@/components/CharacterWizard";
import type { CharacterLibraryItem, FourViewUrls, ImageGeneration } from "@shared/schema";
import { IMAGE_RATIOS, imageSizeFor, type ImageRatioId } from "@shared/imageSizes";
import { IMAGE_COST, WATERMARK_REMOVAL_COST, imageCost } from "@shared/pricing";
import { photoLookSuffix, type PhotoLookId } from "@shared/photosetOptions";

// 商品帶貨圖（/product）：給一件商品，用自己的角色生成一組「拿著／穿著／使用商品」的照片，
// 同時拿到一則可以直接貼的文案與標籤。三步：① 商品 ② 角色 ③ 範本與張數 → AI 規劃（免費）→ 生成。
//
// 規劃走 POST /api/photosets/plan（mode "product"），生成走寫真工作室同一個批次端點
// （POST /api/image-generations 帶 prompts），所以扣積分、失敗退款、轉存、輪詢都和寫真一樣。
// 送給圖片模型的圖片順序固定為 [...角色參考圖, ...商品圖]，與提示詞後面的圖片說明（imageNote）一致。
// 範本（TEMPLATES）只是幫使用者寫好的拍法說明，會當成「額外要求」交給規劃。

type Shot = { title: string; prompt: string };
type Plan = { analysis: string; shots: Shot[]; caption?: string; hashtags?: string[] };
type BatchStatus = { batchId: string; generations: ImageGeneration[]; totalCount: number; completedCount: number; failedCount: number };

const MAX_PRODUCT_IMAGES = 3;
/** The image model takes 10 images: up to 6 of the person, up to 3 of the product. */
const MAX_CHARACTER_IMAGES = 6;
const MIN_SHOTS = 2;
const MAX_SHOTS = 8;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const TEMPLATES: Array<{ id: string; label: string; icon: string; desc: string; look: PhotoLookId; direction: string }> = [
  { id: "ugc", label: tr("UGC 實拍"), icon: "fa-mobile-screen", desc: tr("像自己用手機拍的開箱與使用心得"), look: "phone",
    direction: tr("風格是創作者自己用手機拍的真實分享：居家或日常場景、自然光、構圖隨性，包含開箱、拿在手上對鏡頭展示、實際使用中的畫面。") },
  { id: "lifestyle", label: tr("生活情境"), icon: "fa-mug-hot", desc: tr("把商品放進日常生活的畫面"), look: "natural",
    direction: tr("風格是生活情境照：選一個這件商品實際會出現的日常場景，人物自然地使用商品，畫面有生活感與環境細節。") },
  { id: "fashion", label: tr("服飾商拍"), icon: "fa-shirt", desc: tr("衣服、鞋包、飾品穿戴在身上"), look: "natural",
    direction: tr("這是穿戴類商品的商拍：商品必須穿戴在人物身上，包含全身、半身與材質細節特寫，場景簡潔不搶戲，姿勢要能展示版型與垂墜感。") },
  { id: "listing", label: tr("Listing 套圖"), icon: "fa-table-cells", desc: tr("電商商品頁用的整組圖"), look: "studio",
    direction: tr("這是電商商品頁的整組圖：乾淨的淺色背景或簡單棚景，包含人物手持商品的主圖、商品細節特寫、使用示範、尺寸比例對照（商品在手上或身旁）。") },
  { id: "ad", label: tr("圖片廣告"), icon: "fa-rectangle-ad", desc: tr("質感主視覺，適合投放廣告"), look: "studio",
    direction: tr("這是廣告主視覺：打光講究、構圖乾淨有留白，人物與商品都是畫面焦點，色調與商品的顏色呼應，質感高級。") },
  { id: "food", label: tr("美食飲品"), icon: "fa-utensils", desc: tr("吃的喝的，拍出想吃的感覺"), look: "natural",
    direction: tr("這是食品或飲品：包含人物拿著、正要吃或喝的瞬間、桌面擺盤的近景，光線明亮溫暖，食物看起來新鮮有食慾。") },
];

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

/** Real photos first (the first is the face), then the AI-made four views. */
function characterImages(c: CharacterLibraryItem | null): string[] {
  if (!c) return [];
  const v = (c.fourViewUrls ?? {}) as FourViewUrls;
  const views = [v.front, v.threeQuarter, v.side, v.back].filter((u): u is string => !!u);
  return Array.from(new Set([...(c.refImageUrls ?? []), ...views])).slice(0, MAX_CHARACTER_IMAGES);
}

/** Tells the image model which pictures are the person and which are the product. */
function imageNote(personCount: number, productCount: number): string {
  const person = personCount > 1 ? tr("第 1 到 {0} 張圖是同一位人物的參考", { 0: personCount }) : tr("第 1 張圖是人物的參考");
  const first = personCount + 1;
  const product = productCount > 1 ? tr("第 {0} 到 {1} 張圖是同一件商品", { 0: first, 1: personCount + productCount }) : tr("第 {0} 張圖是商品", { 0: first });
  return tr("（{0}，請保持臉部五官、髮型髮色與身形一致，服裝依照提示詞；{1}，畫面中的商品必須與商品圖一致：形狀、顏色、材質、比例與包裝上的圖案文字都不要改變，也不要出現其他商品。）", { 0: person, 1: product });
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-indigo-100 rounded-3xl p-4 md:p-5" data-testid={`product-step-${n}`}>
      <h2 className="flex items-center gap-2.5 text-sm font-bold text-slate-900 mb-3">
        <span className="w-7 h-7 rounded-full bg-brand text-white text-xs font-bold flex items-center justify-center">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function ProductPage() {
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
  // A 範本 card on the 創作中心 arrives with ?template=<id>.
  const [templateId, setTemplateId] = useState(() => {
    const wanted = new URLSearchParams(window.location.search).get("template");
    return TEMPLATES.some(t => t.id === wanted) ? (wanted as string) : TEMPLATES[0].id;
  });
  const [extra, setExtra] = useState("");
  const [ratioId, setRatioId] = useState<ImageRatioId>("3:4");
  const [watermark, setWatermark] = useState(true);
  const [count, setCount] = useState(4);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [batchId, setBatchId] = useState("");
  const [preview, setPreview] = useState("");

  const { data: characters = [] } = useQuery<CharacterLibraryItem[]>({ queryKey: ["/api/character-library"] });
  const character = characters.find(c => c.id === characterId) ?? null;
  const personRefs = characterImages(character);
  const template = TEMPLATES.find(t => t.id === templateId) ?? TEMPLATES[0];

  const credits = user?.credits ?? 0;
  const perImage = imageCost(watermark);
  const shots = (plan?.shots ?? []).filter(s => s.prompt.trim().length > 0);
  const totalCost = (plan ? shots.length : count) * perImage;
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
        mode: "product",
        productImageUrls: productImages,
        referenceImageUrls: personRefs,
        productName: productName.trim() || undefined,
        sellingPoints: sellingPoints.trim() || undefined,
        characterName: character?.name,
        direction: `${template.direction}${extra.trim() ? ` ${extra.trim()}` : ""}`,
        look: template.look,
        aspectRatio: ratioId,
        count,
      });
      return res.json() as Promise<Plan>;
    },
    onSuccess: (p) => { setPlan(p); setBatchId(""); },
    onError: (e) => toast({ title: tr("規劃失敗"), description: errorText(e), variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const images = [...personRefs, ...productImages];
      const [first, ...rest] = images;
      const note = imageNote(personRefs.length, productImages.length);
      const res = await apiRequest("POST", "/api/image-generations", {
        type: "image-to-image",
        originalImageUrl: first,
        additionalImageUrls: rest.length > 0 ? rest : undefined,
        prompts: shots.map(s => `${s.prompt.trim()}${note}${photoLookSuffix(template.look)}`),
        watermark,
        size: imageSizeFor(ratioId, "2k"),
      });
      return res.json() as Promise<{ batchId: string }>;
    },
    onSuccess: (d) => { setBatchId(d.batchId); queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }); },
    onError: (e) => toast({ title: tr("生成失敗"), description: errorText(e), variant: "destructive" }),
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
  const generating = generateMutation.isPending || (!!batchId && !batchDone);
  const busy = generating || planMutation.isPending || uploading;
  const postText = plan?.caption ? `${plan.caption}${plan.hashtags?.length ? `\n\n${plan.hashtags.map(h => `#${h}`).join(" ")}` : ""}` : "";

  const copyPost = async () => {
    try { await navigator.clipboard.writeText(postText); toast({ title: tr("文案已複製") }); }
    catch { toast({ title: tr("無法複製"), description: tr("請手動選取文字。"), variant: "destructive" }); }
  };
  const updateShot = (i: number, prompt: string) => setPlan(p => (p ? { ...p, shots: p.shots.map((s, idx) => (idx === i ? { ...s, prompt } : s)) } : p));
  const chip = (on: boolean) => `rounded-xl border-2 text-left transition-colors ${on ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:border-indigo-300"}`;

  if (!user) return null;

  return (
    <div className="min-h-screen pb-10">
      <NavigationHeader />
      <div className="max-w-3xl mx-auto px-4 py-5 md:py-8 space-y-4">
        <header>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">{tr("商品帶貨圖")}</h1>
          <p className="text-sm text-slate-500 mt-1">{tr("給一件商品，用你的角色生成一組拿著、穿著、使用商品的照片，附上可以直接貼的文案。{0} 積分／張，規劃免費。", { 0: IMAGE_COST })}</p>
        </header>

        <Section n={1} title={tr("商品")}>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => onFiles(e.target.files)} data-testid="input-product-file" />
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
                className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 text-slate-400 hover:text-indigo-500 flex flex-col items-center justify-center gap-1 disabled:opacity-50" data-testid="button-product-add">
                <i className={`fas ${uploading ? "fa-spinner fa-spin" : "fa-plus"} text-lg`} />
                <span className="text-[11px] font-medium">{productImages.length === 0 ? tr("上傳商品照") : tr("再加一張")}</span>
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">{tr("最多 {0} 張。背景乾淨、商品完整清楚的照片效果最好；有不同角度可以一起放。", { 0: MAX_PRODUCT_IMAGES })}</p>
          <label className="block mt-3">
            <span className="text-xs text-slate-600">{tr("商品名稱（選填）")}</span>
            <input value={productName} onChange={e => { setProductName(e.target.value.slice(0, 80)); }} placeholder={tr("例如：玫瑰保濕精華 30ml")}
              className="mt-1 w-full h-11 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-product-name" />
          </label>
          <label className="block mt-3">
            <span className="text-xs text-slate-600">{tr("賣點或想說的話（選填，文案會照這個寫）")}</span>
            <textarea value={sellingPoints} onChange={e => setSellingPoints(e.target.value.slice(0, 800))} rows={3} placeholder={tr("例如：質地清爽不黏、早晚都能用、這週免運")}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none" data-testid="input-product-points" />
          </label>
        </Section>

        <Section n={2} title={tr("角色")}>
          {characters.length === 0 ? (
            <button onClick={() => setShowWizard(true)} className="w-full p-4 rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 text-left" data-testid="button-product-new-character">
              <span className="block text-sm font-bold text-indigo-700"><i className="fas fa-user-plus mr-2" />{tr("先建立你的角色")}</span>
              <span className="block text-xs text-slate-600 mt-1">{tr("上傳自己的照片，之後每一組圖都是你。第一個角色免費。")}</span>
            </button>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {characters.map(c => {
                const cover = characterImages(c)[0];
                return (
                  <button key={c.id} onClick={() => { setCharacterId(c.id); resetPlan(); }} disabled={busy}
                    className={`shrink-0 w-24 p-1.5 ${chip(characterId === c.id)}`} data-testid={`product-character-${c.id}`}>
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
          {character && personRefs.length === 0 && <p className="text-xs text-red-600 mt-2">{tr("這個角色還沒有照片，請先到角色庫補上。")}</p>}
        </Section>

        <Section n={3} title={tr("範本與張數")}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TEMPLATES.map(t => (
              <button key={t.id} onClick={() => { setTemplateId(t.id); resetPlan(); }} disabled={busy} className={`p-3 ${chip(templateId === t.id)}`} data-testid={`product-template-${t.id}`}>
                <span className="block text-sm font-bold text-slate-900"><i className={`fas ${t.icon} text-indigo-500 mr-1.5 text-xs`} />{t.label}</span>
                <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">{t.desc}</span>
              </button>
            ))}
          </div>
          <label className="block mt-3">
            <span className="text-xs text-slate-600">{tr("其他要求（選填）")}</span>
            <input value={extra} onChange={e => setExtra(e.target.value.slice(0, 300))} placeholder={tr("例如：在咖啡店、穿白色襯衫、多一點特寫")}
              className="mt-1 w-full h-11 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-product-extra" />
          </label>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="block">
              <span className="text-xs text-slate-600">{tr("張數")}</span>
              <select value={count} onChange={e => { setCount(Number(e.target.value)); resetPlan(); }} disabled={busy} className="mt-1 w-full h-11 px-2 border border-slate-200 rounded-xl text-sm bg-white" data-testid="select-product-count">
                {Array.from({ length: MAX_SHOTS - MIN_SHOTS + 1 }, (_, i) => MIN_SHOTS + i).map(n => <option key={n} value={n}>{tr("{0} 張", { 0: n })}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-600">{tr("比例")}</span>
              <select value={ratioId} onChange={e => setRatioId(e.target.value as ImageRatioId)} disabled={busy} className="mt-1 w-full h-11 px-2 border border-slate-200 rounded-xl text-sm bg-white" data-testid="select-product-ratio">
                {IMAGE_RATIOS.map(r => <option key={r.id} value={r.id}>{r.label}・{r.hint}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={!watermark} onChange={e => setWatermark(!e.target.checked)} className="accent-indigo-600" data-testid="checkbox-product-watermark" />
            {tr("去除浮水印（每張 +{0} 積分）", { 0: WATERMARK_REMOVAL_COST })}
          </label>
          <button onClick={() => planMutation.mutate()} disabled={!inputsReady || busy}
            className="mt-4 w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-product-plan">
            {planMutation.isPending ? tr("AI 規劃中…") : plan ? tr("重新規劃") : tr("規劃 {0} 個鏡頭與文案（免費）", { 0: count })}
          </button>
          {!inputsReady && <p className="text-[11px] text-slate-400 mt-2 text-center">{productImages.length === 0 ? tr("先上傳商品照。") : tr("再選一個角色。")}</p>}
        </Section>

        {plan && (
          <section className="bg-white border border-indigo-300 rounded-3xl p-4 md:p-5 shadow-glow" data-testid="product-plan">
            <h2 className="text-sm font-bold text-slate-900">{tr("規劃結果")}</h2>
            {plan.analysis && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{plan.analysis}</p>}

            {postText && (
              <div className="mt-3 rounded-2xl bg-amber-50 border border-amber-200 p-3" data-testid="product-caption">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900"><i className="fas fa-pen-nib text-amber-500 mr-1.5" />{tr("貼文文案")}</span>
                  <button onClick={copyPost} className="h-8 px-3 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-amber-800" data-testid="button-product-copy">{tr("複製")}</button>
                </div>
                <p className="text-sm text-slate-800 mt-2 whitespace-pre-wrap leading-relaxed">{postText}</p>
                <p className="text-[11px] text-slate-500 mt-2">{tr("文案由 AI 撰寫，發布前請自己確認內容是否符合商品實際情況與平台的廣告規範。")}</p>
              </div>
            )}

            <ol className="mt-3 space-y-2">
              {plan.shots.map((s, i) => (
                <li key={i} className="rounded-2xl border border-slate-200 p-3">
                  <span className="text-xs font-bold text-slate-900">{i + 1}. {s.title}</span>
                  <textarea value={s.prompt} onChange={e => updateShot(i, e.target.value)} rows={3} disabled={busy} aria-label={tr("鏡頭 {0} 的提示詞", { 0: i + 1 })}
                    className="mt-1.5 w-full px-2.5 py-2 border border-slate-200 rounded-lg text-xs leading-relaxed resize-none" data-testid={`product-shot-${i}`} />
                </li>
              ))}
            </ol>

            <button onClick={() => generateMutation.mutate()} disabled={busy || shots.length < MIN_SHOTS || credits < totalCost}
              className="mt-4 w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-glow disabled:opacity-40 disabled:shadow-none" data-testid="button-product-generate">
              {generating ? tr("生成中…") : tr("生成 {0} 張（{1} 積分）", { 0: shots.length, 1: totalCost })}
            </button>
            {credits < totalCost && (
              <p className="text-xs text-red-600 mt-2 text-center">
                {tr("需要 {0} 積分，目前剩 {1}。", { 0: totalCost, 1: credits })}<Link href="/store"><span className="underline cursor-pointer font-semibold">{tr("前往會員商城")}</span></Link>
              </p>
            )}
          </section>
        )}

        {batch && (
          <section className="bg-white border border-indigo-100 rounded-3xl p-4 md:p-5" data-testid="product-results">
            <h2 className="text-sm font-bold text-slate-900">
              {batchDone ? tr("完成 {0} 張{1}", { 0: batch.completedCount, 1: batch.failedCount ? tr("，{0} 張失敗（積分已退回）", { 0: batch.failedCount }) : "" }) : tr("生成中 {0}／{1}", { 0: batch.completedCount, 1: batch.totalCount })}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
              {batch.generations.map((g, i) => {
                const url = g.bunnyImageUrl || g.generatedImageUrl || "";
                return (
                  <div key={g.id} className="relative rounded-xl overflow-hidden bg-slate-100 border border-slate-200" style={{ aspectRatio: ratioId.replace(":", " / ") }}>
                    {g.status === "completed" && url ? (
                      <button onClick={() => setPreview(url)} className="block w-full h-full" aria-label={tr("放大第 {0} 張", { 0: i + 1 })}>
                        <img src={url} alt={shots[i]?.title ?? tr("第 {0} 張", { 0: i + 1 })} loading="lazy" className="w-full h-full object-cover" />
                      </button>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-400 text-xs p-2 text-center">
                        {g.status === "failed" ? <><i className="fas fa-circle-exclamation text-red-400" /><span>{tr("失敗")}</span></> : <><i className="fas fa-spinner fa-spin" /><span>{tr("生成中")}</span></>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {batchDone && batch.completedCount > 0 && (
              <p className="text-xs text-slate-500 mt-3">{tr("作品已存到")}<Link href="/vault"><span className="text-indigo-600 underline cursor-pointer mx-0.5">{tr("作品庫")}</span></Link>{tr("，可以在那裡下載或公開到作品牆。")}</p>
            )}
          </section>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4" onClick={() => setPreview("")}>
          <img src={preview} alt={tr("放大檢視")} className="max-w-full max-h-full rounded-xl" />
          <a href={preview} download target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            className="absolute bottom-6 h-11 px-5 rounded-full bg-white text-slate-900 text-sm font-semibold flex items-center"><i className="fas fa-download mr-2 text-xs" />{tr("下載")}</a>
        </div>
      )}
      {showWizard && <CharacterWizard onClose={() => setShowWizard(false)} onCreated={(id) => { setCharacterId(id); resetPlan(); }} />}
    </div>
  );
}

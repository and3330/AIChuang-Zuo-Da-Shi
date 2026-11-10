import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/components/AppNav";
import { LibraryPicker } from "@/components/LibraryPicker";
import { CHARACTER_PACK_MAX_IMAGES, type CharacterLibraryItem, type ImageGeneration, type SceneLibraryItem } from "@shared/schema";
import { IMAGE_RATIOS, IMAGE_TIERS, imageSizeFor, type ImageRatioId, type ImageTierId } from "@shared/imageSizes";
import type { LibraryId } from "@shared/libraryCatalog";
import { loadRecipe, type Recipe, type RecipeItem } from "@/lib/recipe";
import {
  EXPRESSIONS, MAX_PROPS, PHOTO_LOOKS, PROP_PRESETS, REF_BUDGET, SETTINGS, SHOT_STYLES,
  photoLookSuffix, poseRefNote, referenceNote, shootControlText, studioReferenceNote,
  type PhotoLookId, type ShootControl,
} from "@shared/photosetOptions";

// 寫真工作室（/photoset）與角色九宮格（/character-library/sheet）共用這個頁面。
//
// 寫真工作室有兩個區域：
//   情境寫真  一張情境圖決定場景、光線與氛圍；人物、服裝、姿勢可以再指定。
//   素材套圖  不需要情境圖。人物＋素材圖庫的服裝與姿勢，AI 自己挑一個拍攝地點。
// 角色九宮格（variant="sheet"）：從角色庫進來，用角色參考圖生成一組定裝圖並存回角色圖庫。
//   沒有比例、質感、姿勢這些設定 —— 定裝圖用固定規格。
//
// 人像、服裝、姿勢都從素材圖庫挑（LibraryPicker），和 /library 是同一份資料。
//
// 圖片模型一次最多吃 10 張圖，分配見 REF_BUDGET：
//   情境圖 1 ＋ 角色最多 6 ＋ 服裝圖 1 ＋ 該鏡頭的姿勢圖 1。
// 送出順序固定為 [情境圖?, ...角色參考圖, 服裝圖?, (姿勢圖)]，與提示詞後面的圖片說明一致。
//
// 生成走既有的批次端點 (/api/image-generations + prompts)，扣點、失敗退點、CDN 轉存都一致。

type Variant = "studio" | "sheet";
type Mode = "scene" | "kit" | "sheet";
/** poseRef: optional pose reference image for this shot only. */
type Shot = { title: string; prompt: string; poseRef?: string };
type Plan = { analysis: string; shots: Shot[] };
type BatchStatus = { batchId: string; generations: ImageGeneration[]; totalCount: number; completedCount: number; failedCount: number };
type Picker = { library: LibraryId; purpose: "portrait" | "costume" | "poses" | "shotPose" | "addShot"; idx?: number };

const MIN_SHOTS = 2;
const MAX_SHOTS = 10;
/** The character sheet sends nothing but the character, so it may use more. */
const SHEET_MAX_REFS = 9;
const COUNT_OPTIONS = [4, 6, 9];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

async function uploadToObjectStorage(file: File): Promise<string> {
  const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
  const { uploadURL } = await uploadRes.json();
  const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!putRes.ok) throw new Error("上傳失敗");
  const pathRes = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
  const { objectPath } = await pathRes.json();
  return objectPath as string;
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // apiRequest throws "<status>: <body>"; surface the server's error field.
  const m = msg.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (typeof j.error === "string") return j.error;
    } catch { /* fall through */ }
  }
  return msg;
}

function checkImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) return "請上傳 JPG、PNG 或 WEBP 圖片。";
  if (file.size > MAX_UPLOAD_BYTES) return "請上傳 20MB 以內的圖片。";
  return null;
}

function Section({ step, title, hint, action, children }: { step?: number; title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          {step !== undefined && <span className="w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">{step}</span>}
          {title}
          {hint && <span className="text-xs font-normal text-slate-400">{hint}</span>}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A picked library item, or the button that opens the picker. */
function LibrarySlot({ label, icon, item, onPick, onClear, disabled }: { label: string; icon: string; item?: RecipeItem; onPick: () => void; onClear: () => void; disabled?: boolean }) {
  if (!item) {
    return (
      <button onClick={onPick} disabled={disabled}
        className="w-full h-14 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 text-indigo-700 text-sm font-medium flex items-center justify-center gap-2 hover:bg-indigo-50 disabled:opacity-50">
        <i className={`fas ${icon} text-xs`} />從素材圖庫選{label}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-2">
      <img src={item.thumbUrl || item.imageUrl || ""} alt={item.name} className="w-12 h-12 rounded-lg object-contain bg-white shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-indigo-600">{label}</p>
        <p className="text-sm text-slate-900 truncate" title={item.name}>{item.name}</p>
      </div>
      <button onClick={onPick} disabled={disabled} className="text-xs text-indigo-600 hover:underline disabled:opacity-40">更換</button>
      <button onClick={onClear} disabled={disabled} className="w-7 h-7 rounded-full text-slate-400 hover:text-red-500 disabled:opacity-40" title="移除"><i className="fas fa-xmark" /></button>
    </div>
  );
}

export default function PhotosetPage({ variant = "studio" }: { variant?: Variant }) {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const situationInputRef = useRef<HTMLInputElement>(null);
  const poseRefInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const [poseRefTarget, setPoseRefTarget] = useState<number | null>(null);
  const isSheet = variant === "sheet";

  // Deep links: /photoset?mode=scene|kit&character=<id>, /photoset?recipe=1 (from the
  // asset library) and /character-library/sheet?character=<id>.
  const initial = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const recipe: Recipe = !isSheet && q.get("recipe") === "1" ? loadRecipe() : {};
    const hasRecipe = Object.keys(recipe).length > 0;
    const asked = q.get("mode");
    const mode: Mode = isSheet ? "sheet" : asked === "kit" || asked === "character" || (hasRecipe && asked !== "scene") ? "kit" : "scene";
    return { mode, characterId: q.get("character") || "", recipe };
  }, [isSheet]);

  const [mode, setMode] = useState<Mode>(initial.mode);
  const [situationPath, setSituationPath] = useState("");
  const [characterId, setCharacterId] = useState(initial.recipe.portrait ? "" : initial.characterId);
  const [portrait, setPortrait] = useState<RecipeItem | undefined>(initial.recipe.portrait);
  const [costume, setCostume] = useState<RecipeItem | undefined>(initial.recipe.costume);
  const [poses, setPoses] = useState<RecipeItem[]>(initial.recipe.pose ? [initial.recipe.pose] : []);
  const [extraRefs, setExtraRefs] = useState<string[]>([]);
  const [outfitFrom, setOutfitFrom] = useState<"character" | "scene">("character");
  const [uploading, setUploading] = useState<"" | "situation" | "refs">("");
  const [count, setCount] = useState(isSheet ? 9 : 6);
  const [ratioId, setRatioId] = useState<ImageRatioId>("3:4");
  const [tierId, setTierId] = useState<ImageTierId>("2k");
  const [lookId, setLookId] = useState<PhotoLookId>("natural");
  const [control, setControl] = useState<ShootControl>({ props: [] });
  const [propDraft, setPropDraft] = useState("");
  const [direction, setDirection] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  // A character sheet is reference material: a watermark would leak into later images.
  const [watermark, setWatermark] = useState(!isSheet);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [batchId, setBatchId] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [savedUrls, setSavedUrls] = useState<string[]>([]);
  const [picker, setPicker] = useState<Picker | null>(null);

  const { data: savedScenes = [] } = useQuery<SceneLibraryItem[]>({ queryKey: ["/api/scene-library"], enabled: !isSheet });
  const { data: characters = [] } = useQuery<CharacterLibraryItem[]>({ queryKey: ["/api/character-library"] });
  const character = characters.find(c => c.id === characterId) ?? null;
  const characterRefs = character?.refImageUrls ?? [];

  // Who is in the pictures: the library portrait or the character's pack, then ad-hoc uploads.
  const refCap = isSheet ? SHEET_MAX_REFS : REF_BUDGET.character;
  const wantedRefs = useMemo(
    () => [...(portrait?.imageUrl ? [portrait.imageUrl] : []), ...characterRefs, ...extraRefs],
    [portrait, characterRefs, extraRefs],
  );
  const personRefs = useMemo(() => wantedRefs.slice(0, refCap), [wantedRefs, refCap]);
  const droppedRefs = wantedRefs.length - personRefs.length;
  const costumeImage = !isSheet ? costume?.imageUrl ?? "" : "";

  const ratio = IMAGE_RATIOS.find(r => r.id === ratioId) ?? IMAGE_RATIOS[0];
  const outputSize = imageSizeFor(ratioId, tierId);
  const shots = plan?.shots ?? [];
  const validShots = shots.filter(s => s.prompt.trim().length > 0);
  const perImage = watermark ? 3 : 8;
  const totalCost = validShots.length * perImage;
  const credits = user?.credits ?? 0;
  const anyPoseRef = validShots.some(s => !!s.poseRef) || (!plan && poses.length > 0);

  // Images every shot shares, in the order the prompt note describes them.
  const sharedImages = [
    ...(mode === "scene" && situationPath ? [situationPath] : []),
    ...personRefs,
    ...(costumeImage ? [costumeImage] : []),
  ];
  const usedSlots = sharedImages.length + (anyPoseRef ? REF_BUDGET.pose : 0);
  const inputsReady = mode === "scene" ? !!situationPath : personRefs.length > 0;
  const shotCount = poses.length >= MIN_SHOTS ? poses.length : count;

  // Any change to what the shots are based on makes the current plan stale.
  const resetPlan = () => { setPlan(null); setBatchId(""); setSavedUrls([]); };
  useEffect(() => { resetPlan(); }, [mode, characterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSituationFile = async (file: File | undefined) => {
    if (!file) return;
    const problem = checkImageFile(file);
    if (problem) { toast({ title: "無法使用這個檔案", description: problem, variant: "destructive" }); return; }
    setUploading("situation");
    try {
      setSituationPath(await uploadToObjectStorage(file));
      resetPlan();
    } catch (e) {
      toast({ title: "上傳失敗", description: errorText(e), variant: "destructive" });
    } finally {
      setUploading("");
      if (situationInputRef.current) situationInputRef.current.value = "";
    }
  };

  const handleRefFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = refCap - wantedRefs.length;
    if (room <= 0) {
      toast({ title: "人物參考圖已達上限", description: `這裡最多使用 ${refCap} 張。`, variant: "destructive" });
      return;
    }
    setUploading("refs");
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const problem = checkImageFile(file);
        if (problem) { toast({ title: `略過 ${file.name}`, description: problem, variant: "destructive" }); continue; }
        const path = await uploadToObjectStorage(file);
        setExtraRefs(prev => [...prev, path]);
      }
      resetPlan();
    } catch (e) {
      toast({ title: "上傳失敗", description: errorText(e), variant: "destructive" });
    } finally {
      setUploading("");
      if (refInputRef.current) refInputRef.current.value = "";
    }
  };

  const planMutation = useMutation({
    mutationFn: async (planner: "ai" | "preset"): Promise<Plan> => {
      const directionParts = [
        costume ? `服裝：讓人物穿上這套穿搭——${costume.usage}` : "",
        poses.length === 1 ? `姿勢：每一張都以這個姿勢為主——${poses[0].usage}` : "",
        isSheet ? "" : shootControlText(control, { hasSceneImage: mode === "scene" }),
        direction.trim(),
      ].filter(Boolean);
      const res = await apiRequest("POST", "/api/photosets/plan", {
        mode: mode === "scene" ? "scene" : "character",
        planner,
        situationImageUrl: mode === "scene" ? situationPath : undefined,
        referenceImageUrls: personRefs,
        characterName: character?.name,
        characterDescription: character?.description || undefined,
        outfitFrom,
        characterGoal: mode === "kit" ? "shoot" : "sheet",
        count: shotCount,
        customPoses: planner === "ai" && poses.length >= MIN_SHOTS
          ? poses.map(p => ({ name: p.name.slice(0, 80), description: p.usage.slice(0, 600) }))
          : [],
        look: lookId,
        direction: directionParts.join("。").slice(0, 1200) || undefined,
        aspectRatio: ratio.id,
      });
      return res.json();
    },
    onSuccess: (data) => {
      // One picked pose: every shot follows it. Several: shot i follows pose i.
      const poseFor = (i: number) => (poses.length >= MIN_SHOTS ? poses[i] : poses[0])?.imageUrl || undefined;
      setPlan({ ...data, shots: data.shots.map((s, i) => ({ ...s, poseRef: poseFor(i) })) });
      setBatchId(""); setSavedUrls([]);
    },
    onError: (e) => toast({ title: "規劃失敗", description: errorText(e), variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const note = isSheet
        ? referenceNote("character", personRefs.length, "character")
        : studioReferenceNote({
            hasSituation: mode === "scene",
            characterCount: personRefs.length,
            hasCostumeImage: !!costumeImage,
            outfit: costume ? (costumeImage ? "costume" : "prompt") : mode === "scene" ? outfitFrom : portrait ? "prompt" : "character",
          });
      const [first, ...rest] = sharedImages;
      const poseImageNumber = sharedImages.length + 1;
      const hasPoseRefs = validShots.some(s => !!s.poseRef);
      const res = await apiRequest("POST", "/api/image-generations", {
        type: "image-to-image",
        originalImageUrl: first,
        additionalImageUrls: rest.length > 0 ? rest : undefined,
        // Each prompt = the shot + what each input image is for + the look.
        prompts: validShots.map(s =>
          `${s.prompt.trim()}${note}${s.poseRef ? poseRefNote(poseImageNumber) : ""}${photoLookSuffix(lookId)}`),
        promptImageUrls: hasPoseRefs ? validShots.map(s => s.poseRef ?? null) : undefined,
        watermark,
        size: outputSize,
      });
      return res.json() as Promise<{ batchId: string }>;
    },
    onSuccess: (data) => {
      setBatchId(data.batchId);
      setSavedUrls([]);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (e) => toast({ title: "生成失敗", description: errorText(e), variant: "destructive" }),
  });

  const { data: batch } = useQuery<BatchStatus>({
    queryKey: ["/api/batch-generations", batchId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/batch-generations/${batchId}`);
      return res.json();
    },
    enabled: !!batchId,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 3000;
      return d.completedCount + d.failedCount >= d.totalCount ? false : 3000;
    },
  });

  const batchDone = !!batch && batch.completedCount + batch.failedCount >= batch.totalCount;
  const isGenerating = generateMutation.isPending || (!!batchId && !batchDone);
  const busy = isGenerating || planMutation.isPending;

  // Only images already re-hosted on our CDN are permanent enough to keep in
  // a character pack (provider URLs expire).
  const savableUrls = (batch?.generations ?? [])
    .filter(g => g.status === "completed" && !!g.bunnyImageUrl)
    .map(g => g.bunnyImageUrl as string);
  const packRoom = CHARACTER_PACK_MAX_IMAGES - characterRefs.length;

  const saveToPackMutation = useMutation({
    mutationFn: async (urls: string[]) => {
      if (!character) throw new Error("請先選擇角色");
      const fresh = urls.filter(u => !characterRefs.includes(u)).slice(0, Math.max(0, packRoom));
      if (fresh.length === 0) throw new Error(packRoom <= 0 ? `角色圖庫已滿（${CHARACTER_PACK_MAX_IMAGES} 張）` : "這些圖已經在圖庫裡了");
      await apiRequest("PATCH", `/api/character-library/${character.id}`, { refImageUrls: [...characterRefs, ...fresh] });
      return fresh;
    },
    onSuccess: (fresh) => {
      setSavedUrls(prev => [...prev, ...fresh]);
      queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
      toast({ title: `已加入「${character?.name}」的圖庫`, description: `新增 ${fresh.length} 張。` });
    },
    onError: (e) => toast({ title: "加入圖庫失敗", description: errorText(e), variant: "destructive" }),
  });

  const updateShot = (idx: number, patch: Partial<Shot>) => {
    setPlan(p => p ? { ...p, shots: p.shots.map((s, i) => (i === idx ? { ...s, ...patch } : s)) } : p);
  };
  const removeShot = (idx: number) => {
    setPlan(p => p ? { ...p, shots: p.shots.filter((_, i) => i !== idx) } : p);
  };
  const addShot = (shot: Shot) => {
    setPlan(p => p && p.shots.length < MAX_SHOTS ? { ...p, shots: [...p.shots, shot] } : p);
  };
  const handlePoseRefFile = async (file: File | undefined) => {
    const idx = poseRefTarget;
    if (!file || idx === null) return;
    const problem = checkImageFile(file);
    if (problem) { toast({ title: "無法使用這個檔案", description: problem, variant: "destructive" }); return; }
    try {
      updateShot(idx, { poseRef: await uploadToObjectStorage(file) });
    } catch (e) {
      toast({ title: "上傳失敗", description: errorText(e), variant: "destructive" });
    } finally {
      setPoseRefTarget(null);
      if (poseRefInputRef.current) poseRefInputRef.current.value = "";
    }
  };

  const onPicked = (items: RecipeItem[]) => {
    const p = picker;
    setPicker(null);
    if (!p) return;
    const first = items[0];
    if (p.purpose === "poses") { setPoses(items); resetPlan(); return; }
    if (!first) return;
    if (p.purpose === "portrait") { setPortrait(first); setCharacterId(""); resetPlan(); }
    else if (p.purpose === "costume") { setCostume(first); resetPlan(); }
    else if (p.purpose === "shotPose" && p.idx !== undefined) updateShot(p.idx, { poseRef: first.imageUrl ?? undefined });
    else if (p.purpose === "addShot") addShot({ title: first.name.slice(0, 30), prompt: `人物擺出這個姿勢：${first.usage}`, poseRef: first.imageUrl ?? undefined });
  };

  const setControlField = (patch: Partial<ShootControl>) => { setControl(prev => ({ ...prev, ...patch })); };
  const toggleProp = (name: string) => {
    const p = name.trim().slice(0, 20);
    if (!p) return;
    setControl(prev => prev.props.includes(p)
      ? { ...prev, props: prev.props.filter(x => x !== p) }
      : prev.props.length >= MAX_PROPS ? prev : { ...prev, props: [...prev.props, p] });
  };

  const canGenerate = inputsReady && validShots.length >= MIN_SHOTS && validShots.length <= MAX_SHOTS && credits >= totalCost && !busy;
  const imageOf = (g: ImageGeneration) => g.bunnyImageUrl || g.generatedImageUrl || "";
  const isSaved = (url: string) => savedUrls.includes(url) || characterRefs.includes(url);
  const selectBtn = (active: boolean) =>
    `rounded-xl border transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-indigo-300"}`;
  const chipBtn = (active: boolean) => `px-2.5 h-8 text-xs ${selectBtn(active)}`;
  const advancedCount = [control.settingId, control.shotStyleId, control.expressionId].filter(Boolean).length + control.props.length + (direction.trim() ? 1 : 0);
  let step = 0;

  const MODES: Array<{ id: Mode; icon: string; title: string; desc: string }> = [
    { id: "scene", icon: "fa-panorama", title: "情境寫真", desc: "上傳一張情境圖，AI 依它的場景與氛圍拍一整組。" },
    { id: "kit", icon: "fa-layer-group", title: "素材套圖", desc: "不用情境圖。選人物，再從素材圖庫配服裝與姿勢。" },
  ];

  return (
    <div className="min-h-screen pb-24">
      <NavigationHeader />
      <div className="max-w-6xl mx-auto px-4 py-5 md:py-8">
        <div className="mb-5">
          {isSheet && <Link href="/character-library"><span className="hidden md:inline-block text-sm text-slate-500 hover:text-slate-800 cursor-pointer mb-1">← 回角色庫</span></Link>}
          <h1 className="hidden md:block text-2xl font-bold text-slate-900">{isSheet ? "角色九宮格" : "寫真工作室"}</h1>
          <p className="text-sm text-slate-500 md:mt-1">
            {isSheet
              ? "用角色參考圖生成正面、側面、背面、表情與姿勢的定裝圖，存回角色圖庫後，之後每次生成都更像同一個人。"
              : "一次生成整組可貼上社群的寫真。人像、服裝、姿勢都可以直接從素材圖庫挑。"}
          </p>
        </div>

        {/* ── 兩個區域 ─────────────────────────────────────────── */}
        {!isSheet && (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-5" role="tablist">
            {MODES.map(m => {
              const active = mode === m.id;
              return (
                <button key={m.id} role="tab" aria-selected={active} onClick={() => setMode(m.id)} disabled={busy}
                  className={`relative p-3 sm:p-4 text-left rounded-2xl border-2 transition-all ${active ? "border-indigo-500 bg-white shadow-glow" : "border-transparent bg-white/70 hover:border-indigo-200"}`}
                  data-testid={`button-mode-${m.id}`}>
                  <span className="flex items-center gap-2.5">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${active ? "bg-brand text-white" : "bg-slate-100 text-slate-500"}`}><i className={`fas ${m.icon}`} /></span>
                    <span className={`text-sm sm:text-base font-bold ${active ? "text-slate-900" : "text-slate-600"}`}>{m.title}</span>
                  </span>
                  <span className="hidden sm:block text-xs text-slate-500 mt-2">{m.desc}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-5 items-start">
          {/* ── 左：素材與設定 ─────────────────────────────── */}
          <div className="bg-white border border-indigo-100 rounded-3xl p-4 sm:p-5 space-y-5">
            {mode === "scene" && (
              <Section step={++step} title="情境圖" hint="決定場景、光線與氛圍">
                <input ref={situationInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={(e) => handleSituationFile(e.target.files?.[0])} data-testid="input-photoset-situation" />
                {savedScenes.some(sc => (sc.refImageUrls?.length ?? 0) > 0) && (
                  <select value="" disabled={busy}
                    onChange={(e) => {
                      const first = savedScenes.find(x => x.id === e.target.value)?.refImageUrls?.[0];
                      if (first) { setSituationPath(first); resetPlan(); }
                    }}
                    className="w-full mb-2 h-10 px-3 border border-slate-200 rounded-xl text-sm bg-white" data-testid="select-photoset-scene">
                    <option value="">從場景庫選一個已儲存的場景…</option>
                    {savedScenes.filter(sc => (sc.refImageUrls?.length ?? 0) > 0).map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                  </select>
                )}
                {situationPath ? (
                  <div className="space-y-2">
                    <img src={situationPath} alt="情境圖" className="w-full max-h-64 object-contain rounded-xl bg-slate-100" />
                    <button onClick={() => situationInputRef.current?.click()} disabled={!!uploading || busy} className="text-xs text-indigo-600 hover:underline disabled:opacity-50">
                      {uploading === "situation" ? "上傳中…" : "更換情境圖"}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => situationInputRef.current?.click()} disabled={!!uploading}
                    className="w-full h-36 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center gap-2 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
                    data-testid="button-photoset-upload-situation">
                    <i className="fas fa-cloud-arrow-up text-2xl" />
                    <span className="text-sm">{uploading === "situation" ? "上傳中…" : "點擊上傳情境圖"}</span>
                    <span className="text-[11px] text-slate-400">JPG／PNG／WEBP，20MB 以內</span>
                  </button>
                )}
              </Section>
            )}

            <Section step={++step} title={isSheet ? "角色" : "人物"} hint={mode === "scene" ? "選填，決定畫面裡是誰" : "必填"}>
              <div className="flex gap-2">
                <select value={characterId} onChange={(e) => { setCharacterId(e.target.value); if (e.target.value) setPortrait(undefined); }} disabled={busy}
                  className="flex-1 min-w-0 h-10 px-3 border border-slate-200 rounded-xl text-sm bg-white" data-testid="select-photoset-character">
                  <option value="">{mode === "scene" ? "不指定角色（沿用情境圖中的人物）" : "從角色庫選擇…"}</option>
                  {characters.map(c => <option key={c.id} value={c.id}>{c.name}（圖庫 {c.refImageUrls?.length ?? 0} 張）</option>)}
                </select>
                {!isSheet && (
                  <Link href="/character-library">
                    <span className="shrink-0 h-10 px-3 flex items-center border border-slate-200 rounded-xl text-xs text-slate-600 hover:border-indigo-300 cursor-pointer whitespace-nowrap">角色庫</span>
                  </Link>
                )}
              </div>
              {character && characterRefs.length === 0 && (
                <p className="text-xs text-red-500 mt-1">這個角色的圖庫還沒有圖片，請到角色庫上傳，或在下方直接上傳參考圖。</p>
              )}
              {!isSheet && (
                <div className="mt-2">
                  <LibrarySlot label="人像" icon="fa-face-smile" item={portrait} disabled={busy}
                    onPick={() => setPicker({ library: "portrait", purpose: "portrait" })}
                    onClear={() => { setPortrait(undefined); resetPlan(); }} />
                </div>
              )}

              <input ref={refInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
                onChange={(e) => handleRefFiles(e.target.files)} data-testid="input-photoset-refs" />
              <div className="flex flex-wrap gap-2 mt-3">
                {characterRefs.slice(0, Math.max(0, refCap - (portrait?.imageUrl ? 1 : 0))).map((url, i) => (
                  <div key={`c-${i}`} className="relative w-14 h-14 rounded-lg overflow-hidden border border-indigo-200 bg-slate-50" title="來自角色圖庫">
                    <img src={url} alt={`角色圖 ${i + 1}`} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 bg-indigo-600/80 text-white text-[9px] text-center">圖庫</span>
                  </div>
                ))}
                {extraRefs.map((url, i) => (
                  <div key={`x-${i}`} className="relative w-14 h-14 rounded-lg overflow-hidden border border-slate-300 bg-slate-50">
                    <img src={url} alt={`參考圖 ${i + 1}`} className="w-full h-full object-cover" />
                    <button onClick={() => { setExtraRefs(prev => prev.filter((_, idx) => idx !== i)); resetPlan(); }} disabled={busy}
                      className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs rounded-bl-lg flex items-center justify-center" title="移除">×</button>
                  </div>
                ))}
                {wantedRefs.length < refCap && (
                  <button onClick={() => refInputRef.current?.click()} disabled={!!uploading || busy}
                    className="w-14 h-14 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
                    data-testid="button-photoset-upload-refs">
                    {uploading === "refs" ? <span className="text-xs">…</span> : <><span className="text-xl leading-none">+</span><span className="text-[9px]">上傳</span></>}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                人物參考圖 {personRefs.length}／{refCap} 張。
                {droppedRefs > 0 && ` 超過上限，只取前 ${refCap} 張。`}
                {" "}臉部清楚的正面照效果最好。
              </p>

              {mode === "scene" && personRefs.length > 0 && !costume && (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button onClick={() => { setOutfitFrom("character"); resetPlan(); }} disabled={busy} className={`h-10 text-sm ${selectBtn(outfitFrom === "character")}`}>穿角色圖的服裝</button>
                  <button onClick={() => { setOutfitFrom("scene"); resetPlan(); }} disabled={busy} className={`h-10 text-sm ${selectBtn(outfitFrom === "scene")}`}>穿情境圖的服裝</button>
                </div>
              )}
            </Section>

            {!isSheet && (
              <Section step={++step} title="服裝" hint="選填">
                <LibrarySlot label="服裝" icon="fa-shirt" item={costume} disabled={busy}
                  onPick={() => setPicker({ library: "costume", purpose: "costume" })}
                  onClear={() => { setCostume(undefined); resetPlan(); }} />
              </Section>
            )}

            {!isSheet && (
              <Section step={++step} title="姿勢" hint={`選填，最多 ${MAX_SHOTS} 個`}
                action={poses.length > 0 ? <button onClick={() => { setPoses([]); resetPlan(); }} disabled={busy} className="text-xs text-slate-400 hover:text-red-500">清除</button> : undefined}>
                {poses.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
                    {poses.map((p, i) => (
                      <div key={p.id} className="relative shrink-0 w-14">
                        <img src={p.thumbUrl || p.imageUrl || ""} alt={p.name} title={p.name} className="w-14 h-20 rounded-lg object-contain bg-slate-50 border border-indigo-200" />
                        <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center">{i + 1}</span>
                        <button onClick={() => { setPoses(prev => prev.filter(x => x.id !== p.id)); resetPlan(); }} disabled={busy}
                          className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-[10px] rounded-bl-md rounded-tr-lg flex items-center justify-center" title="移除">×</button>
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={() => setPicker({ library: "pose", purpose: "poses" })} disabled={busy}
                  className="w-full h-11 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 text-indigo-700 text-sm font-medium flex items-center justify-center gap-2 hover:bg-indigo-50 disabled:opacity-50"
                  data-testid="button-photoset-pick-poses">
                  <i className="fas fa-person-walking text-xs" />{poses.length > 0 ? "修改姿勢" : "從素材圖庫選姿勢"}
                </button>
                <p className="text-[11px] text-slate-400 mt-2">
                  {poses.length >= MIN_SHOTS ? `每個姿勢各出一張，共 ${poses.length} 張。`
                    : poses.length === 1 ? "整組都以這個姿勢為主，只變化景別與角度。"
                    : "不選則由 AI 自行安排姿勢。"}
                </p>
              </Section>
            )}

            <Section step={++step} title="張數" hint={poses.length >= MIN_SHOTS ? "依姿勢數" : undefined}>
              <div className="flex gap-2">
                {COUNT_OPTIONS.map(n => (
                  <button key={n} onClick={() => setCount(n)} disabled={busy || poses.length >= MIN_SHOTS}
                    className={`flex-1 h-10 text-sm font-medium ${selectBtn(poses.length < MIN_SHOTS && count === n)} disabled:opacity-40`}>
                    {n} 張{isSheet && n === 9 ? "（九宮格）" : ""}
                  </button>
                ))}
              </div>
            </Section>

            {!isSheet && (
              <Section step={++step} title="輸出">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-[11px] text-slate-500">比例</span>
                    <select value={ratioId} onChange={e => setRatioId(e.target.value as ImageRatioId)} disabled={busy}
                      className="mt-0.5 w-full h-10 px-2 border border-slate-200 rounded-xl text-sm bg-white" data-testid="select-photoset-ratio">
                      {IMAGE_RATIOS.map(r => <option key={r.id} value={r.id}>{r.label}・{r.hint}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-slate-500">畫質</span>
                    <select value={tierId} onChange={e => setTierId(e.target.value as ImageTierId)} disabled={busy}
                      className="mt-0.5 w-full h-10 px-2 border border-slate-200 rounded-xl text-sm bg-white" data-testid="select-photoset-tier">
                      {IMAGE_TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  {PHOTO_LOOKS.map(l => (
                    <button key={l.id} onClick={() => setLookId(l.id)} disabled={busy} title={l.hint} className={`h-10 px-2 text-sm ${selectBtn(lookId === l.id)}`} data-testid={`button-photoset-look-${l.id}`}>{l.label}</button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-2">輸出 {outputSize.replace("x", " × ")} px，各畫質積分相同。想降低 AI 感請選「自然寫實」或「手機隨拍」。</p>
              </Section>
            )}

            {!isSheet && (
              <div className="border border-slate-200 rounded-2xl" data-testid="panel-shoot-control">
                <button onClick={() => setShowAdvanced(v => !v)} className="w-full h-11 px-3 flex items-center justify-between text-sm font-semibold text-slate-800">
                  <span>拍攝控制 <span className="text-xs font-normal text-slate-400">鏡頭、表情、道具{advancedCount > 0 ? `・已設定 ${advancedCount} 項` : "・選填"}</span></span>
                  <i className={`fas fa-chevron-down text-xs text-slate-400 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                </button>
                {showAdvanced && (
                  <div className="px-3 pb-3 space-y-3">
                    {mode === "kit" && (
                      <div>
                        <label className="text-xs text-slate-500 block mb-1">場景</label>
                        <div className="flex flex-wrap gap-1.5">
                          {SETTINGS.map(o => <button key={o.id} onClick={() => setControlField({ settingId: control.settingId === o.id ? undefined : o.id })} disabled={busy} title={o.text} className={chipBtn(control.settingId === o.id)}>{o.label}</button>)}
                        </div>
                      </div>
                    )}
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">鏡頭風格</label>
                      <div className="flex flex-wrap gap-1.5">
                        {SHOT_STYLES.map(o => <button key={o.id} onClick={() => setControlField({ shotStyleId: control.shotStyleId === o.id ? undefined : o.id })} disabled={busy} title={o.text} className={chipBtn(control.shotStyleId === o.id)}>{o.label}</button>)}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">表情</label>
                      <div className="flex flex-wrap gap-1.5">
                        {EXPRESSIONS.map(o => <button key={o.id} onClick={() => setControlField({ expressionId: control.expressionId === o.id ? undefined : o.id })} disabled={busy} title={o.text} className={chipBtn(control.expressionId === o.id)}>{o.label}</button>)}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">道具（最多 {MAX_PROPS} 個）</label>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from(new Set([...PROP_PRESETS, ...control.props])).map(name => (
                          <button key={name} onClick={() => toggleProp(name)} disabled={busy || (!control.props.includes(name) && control.props.length >= MAX_PROPS)}
                            className={`${chipBtn(control.props.includes(name))} disabled:opacity-40`}>{name}</button>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-2">
                        <input value={propDraft} onChange={e => setPropDraft(e.target.value.slice(0, 20))} placeholder="自訂道具，例如：你的產品名稱" disabled={busy}
                          onKeyDown={e => { if (e.key === "Enter" && propDraft.trim()) { toggleProp(propDraft); setPropDraft(""); } }}
                          className="flex-1 min-w-0 h-9 px-3 border border-slate-200 rounded-lg text-sm" data-testid="input-photoset-prop" />
                        <button onClick={() => { toggleProp(propDraft); setPropDraft(""); }} disabled={busy || !propDraft.trim() || control.props.length >= MAX_PROPS}
                          className="px-3 h-9 rounded-lg border border-slate-200 text-xs text-slate-600 disabled:opacity-40">加入</button>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">其他要求</label>
                      <textarea value={direction} onChange={(e) => setDirection(e.target.value.slice(0, 500))} rows={2} disabled={busy}
                        placeholder="例如：日系清新、多一點臉部特寫、加入逆光"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" data-testid="input-photoset-direction" />
                    </div>
                    <p className="text-[11px] text-slate-400">這些選擇會在按下規劃時交給 AI，改了之後請重新規劃。</p>
                  </div>
                )}
              </div>
            )}

            {/* 模型一次最多 10 張圖：讓使用者看得到怎麼分配 */}
            {!isSheet && (
              <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3" data-testid="ref-budget">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">參考圖配額</span>
                  <span className="tabular-nums text-slate-500">{usedSlots}／{REF_BUDGET.total}</span>
                </div>
                <div className="flex gap-0.5 mt-2">
                  {Array.from({ length: REF_BUDGET.total }, (_, i) => {
                    const s = mode === "scene" && situationPath ? 1 : 0;
                    const kind = i < s ? "bg-sky-400" : i < s + personRefs.length ? "bg-indigo-500" : i < sharedImages.length ? "bg-fuchsia-400" : i < usedSlots ? "bg-amber-400" : "bg-slate-200";
                    return <span key={i} className={`flex-1 h-1.5 rounded-full ${kind}`} />;
                  })}
                </div>
                <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 mt-2">
                  {mode === "scene" && <span><i className="fas fa-circle text-[6px] text-sky-400 mr-1 align-middle" />情境 {situationPath ? 1 : 0}／1</span>}
                  <span><i className="fas fa-circle text-[6px] text-indigo-500 mr-1 align-middle" />人物 {personRefs.length}／{REF_BUDGET.character}</span>
                  <span><i className="fas fa-circle text-[6px] text-fuchsia-400 mr-1 align-middle" />服裝 {costumeImage ? 1 : 0}／1</span>
                  <span><i className="fas fa-circle text-[6px] text-amber-400 mr-1 align-middle" />姿勢 {anyPoseRef ? 1 : 0}／1（每張各自）</span>
                </p>
              </div>
            )}

            <div className="space-y-2">
              {isSheet && (
                <button onClick={() => planMutation.mutate("preset")} disabled={!inputsReady || busy}
                  className="w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed" data-testid="button-photoset-preset">
                  使用標準九宮格（立即產生）
                </button>
              )}
              <button onClick={() => planMutation.mutate("ai")} disabled={!inputsReady || busy}
                className={`w-full h-12 rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${isSheet ? "border border-slate-300 text-slate-800 hover:bg-slate-50" : "bg-indigo-600 text-white"}`}
                data-testid="button-photoset-plan">
                {planMutation.isPending ? "AI 規劃中…" : plan ? "重新規劃鏡頭" : isSheet ? "請 AI 依角色規劃（免費）" : `規劃 ${shotCount} 個鏡頭（免費）`}
              </button>
              {!inputsReady && (
                <p className="text-[11px] text-slate-400">{mode === "scene" ? "請先上傳情境圖。" : isSheet ? "請先選擇有圖的角色，或上傳至少一張角色參考圖。" : "請先選擇角色、從素材圖庫選人像，或上傳一張人物照。"}</p>
              )}
            </div>
          </div>

          {/* ── 右：鏡頭規劃與成果 ─────────────────────────── */}
          <div className="space-y-5 min-w-0">
            {!plan && (
              <div className="bg-white/70 border border-dashed border-indigo-200 rounded-3xl p-8 sm:p-10 text-center">
                <span className="inline-flex w-14 h-14 rounded-2xl bg-brand-soft text-indigo-500 text-2xl items-center justify-center mb-3"><i className="fas fa-images" /></span>
                <p className="text-sm text-slate-500 max-w-sm mx-auto">
                  {mode === "scene" ? "上傳情境圖後按下規劃，這裡會出現整組鏡頭清單，可以逐條修改再生成。"
                    : isSheet ? "選好角色後按下標準九宮格，這裡會出現九個鏡頭，確認後一次生成。"
                    : "選好人物，再配上服裝與姿勢，按下規劃，這裡會出現整組鏡頭清單。"}
                </p>
                {mode === "kit" && (
                  <Link href="/library"><span className="inline-flex items-center gap-2 mt-4 text-sm text-indigo-600 hover:underline cursor-pointer">先逛逛素材圖庫<i className="fas fa-arrow-right text-xs" /></span></Link>
                )}
              </div>
            )}

            {plan && (
              <div className="bg-white border border-indigo-100 rounded-3xl p-4 sm:p-5 space-y-4">
                {plan.analysis && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <p className="text-xs font-semibold text-slate-600 mb-1">{mode === "scene" ? "AI 的分析" : "規劃說明"}</p>
                    <p className="text-sm text-slate-700 leading-relaxed">{plan.analysis}</p>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-900">鏡頭清單（{shots.length} 張，可修改）</p>
                  <div className="flex items-center gap-3">
                    {!isSheet && (
                      <button onClick={() => setPicker({ library: "pose", purpose: "addShot" })} disabled={shots.length >= MAX_SHOTS || busy}
                        className="text-xs text-indigo-600 hover:underline disabled:opacity-40" data-testid="button-add-pose-shot">＋ 從圖庫加姿勢</button>
                    )}
                    <button onClick={() => addShot({ title: `鏡頭 ${shots.length + 1}`, prompt: "" })} disabled={shots.length >= MAX_SHOTS || busy} className="text-xs text-indigo-600 hover:underline disabled:opacity-40">＋ 空白鏡頭</button>
                  </div>
                </div>

                <input ref={poseRefInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={(e) => handlePoseRefFile(e.target.files?.[0])} data-testid="input-photoset-pose-ref" />

                <div className="space-y-3">
                  {shots.map((shot, idx) => (
                    <div key={idx} className="border border-slate-200 rounded-2xl p-3 space-y-2" data-testid={`card-shot-${idx}`}>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                        <input value={shot.title} onChange={(e) => updateShot(idx, { title: e.target.value.slice(0, 30) })} disabled={busy}
                          className="flex-1 min-w-0 text-sm font-semibold text-slate-900 bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none" />
                        <button onClick={() => removeShot(idx)} disabled={shots.length <= MIN_SHOTS || busy} className="text-xs text-red-500 hover:underline disabled:opacity-30">移除</button>
                      </div>
                      <textarea value={shot.prompt} onChange={(e) => updateShot(idx, { prompt: e.target.value })} disabled={busy} rows={3}
                        placeholder="描述這張的景別、角度、姿勢、表情與光線"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm leading-relaxed focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50" />
                      {!isSheet && (
                        <div className="flex items-center gap-3 flex-wrap">
                          {shot.poseRef && <img src={shot.poseRef} alt="姿勢參考" className="w-10 h-12 rounded-md object-contain border border-slate-200 bg-slate-50" />}
                          <span className="text-xs text-slate-500">{shot.poseRef ? "已附姿勢圖" : "姿勢圖（選填）"}</span>
                          <button onClick={() => setPicker({ library: "pose", purpose: "shotPose", idx })} disabled={busy} className="text-xs text-indigo-600 hover:underline disabled:opacity-40" data-testid={`button-shot-pose-library-${idx}`}>{shot.poseRef ? "從圖庫更換" : "從圖庫選"}</button>
                          <button onClick={() => { setPoseRefTarget(idx); poseRefInputRef.current?.click(); }} disabled={busy} className="text-xs text-indigo-600 hover:underline disabled:opacity-40" data-testid={`button-shot-pose-ref-${idx}`}>{poseRefTarget === idx ? "上傳中…" : "自己上傳"}</button>
                          {shot.poseRef && <button onClick={() => updateShot(idx, { poseRef: undefined })} disabled={busy} className="text-xs text-red-500 hover:underline disabled:opacity-40">移除</button>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-slate-200">
                  <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} disabled={busy} className="accent-indigo-600" />
                    加上浮水印（3 積分／張；取消為 8 積分／張）
                  </label>
                  <div className="text-sm text-slate-600">
                    共 <b className="text-slate-900">{validShots.length}</b> 張 × {perImage} ＝ <b className="text-indigo-700">{totalCost} 積分</b>
                    <span className="text-xs text-slate-400 ml-2">（餘額 {credits.toLocaleString()}）</span>
                  </div>
                </div>

                {isSheet && watermark && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    定裝圖會存進角色圖庫當參考圖，建議不要加浮水印，否則浮水印可能被帶進之後生成的圖。
                  </p>
                )}
                {credits < totalCost && <p className="text-xs text-red-500">積分不足，請先儲值或減少張數。</p>}
                {validShots.length < MIN_SHOTS && <p className="text-xs text-red-500">至少需要 {MIN_SHOTS} 個有內容的鏡頭。</p>}

                <button onClick={() => generateMutation.mutate()} disabled={!canGenerate}
                  className="w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed" data-testid="button-photoset-generate">
                  {isGenerating
                    ? `生成中… ${batch ? `${batch.completedCount + batch.failedCount}/${batch.totalCount}` : ""}`
                    : batchDone ? `再生成一組（${totalCost} 積分）` : `生成整組（${totalCost} 積分）`}
                </button>
                <p className="text-[11px] text-slate-400">每張約需 1–3 分鐘，整組同時生成；失敗的張數會自動退還積分。每日圖片上限 50 張。</p>
              </div>
            )}

            {batch && (
              <div className="bg-white border border-indigo-100 rounded-3xl p-4 sm:p-5">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">成果</p>
                    <p className="text-xs text-slate-500">
                      完成 {batch.completedCount}／{batch.totalCount}
                      {batch.failedCount > 0 && <span className="text-red-500">，失敗 {batch.failedCount}（已退點）</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {batchDone && batch.completedCount > 0 && (
                      <Link href="/vault"><span className="px-3 h-9 flex items-center rounded-lg border border-slate-200 text-xs text-slate-600 hover:border-indigo-300 cursor-pointer">到作品庫看</span></Link>
                    )}
                    {character && savableUrls.length > 0 && (
                      <button onClick={() => saveToPackMutation.mutate(savableUrls)}
                        disabled={saveToPackMutation.isPending || savableUrls.every(isSaved) || packRoom <= 0}
                        className="px-3 h-9 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40" data-testid="button-photoset-save-all">
                        {savableUrls.every(isSaved) ? "✓ 已全部加入圖庫" : `全部加入「${character.name}」圖庫`}
                      </button>
                    )}
                  </div>
                </div>
                {isSheet && !character && batchDone && batch.completedCount > 0 && (
                  <p className="text-xs text-slate-500 mb-3">想把這些圖存成角色圖庫？請先到角色庫建立角色，再從角色卡片進來生成，就能一鍵加入。</p>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
                  {batch.generations.map((g, idx) => {
                    const url = imageOf(g);
                    const packable = !!character && !!g.bunnyImageUrl;
                    return (
                      <div key={g.id} className="relative rounded-xl overflow-hidden bg-slate-100 border border-slate-200" style={{ aspectRatio: ratio.id.replace(":", " / ") }} data-testid={`card-result-${idx}`}>
                        {g.status === "completed" && url ? (
                          <>
                            <img src={url} alt={`成果 ${idx + 1}`} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setLightbox(url)} />
                            <div className="absolute bottom-2 right-2 flex gap-1.5">
                              {packable && (
                                <button onClick={() => saveToPackMutation.mutate([g.bunnyImageUrl as string])}
                                  disabled={saveToPackMutation.isPending || isSaved(g.bunnyImageUrl as string) || packRoom <= 0}
                                  className="h-8 px-2 rounded-full bg-black/60 text-white text-[11px] hover:bg-black/80 disabled:opacity-70" title="加入角色圖庫">
                                  {isSaved(g.bunnyImageUrl as string) ? "✓ 已加入" : "＋圖庫"}
                                </button>
                              )}
                              <Link href={`/edit?image=${encodeURIComponent(url)}`}>
                                <span className="h-8 px-2 rounded-full bg-black/60 text-white text-[11px] flex items-center hover:bg-black/80 cursor-pointer" title="到編輯器修改這張圖">編輯</span>
                              </Link>
                              <a href={url} download={`photoset-${idx + 1}.jpg`} target="_blank" rel="noreferrer"
                                className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80" title="下載">
                                <i className="fas fa-download text-xs" />
                              </a>
                            </div>
                          </>
                        ) : g.status === "failed" ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
                            <i className="fas fa-triangle-exclamation text-red-500 mb-2" />
                            <p className="text-xs text-red-500 line-clamp-4">{g.errorMessage || "生成失敗"}</p>
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                            <i className="fas fa-spinner fa-spin mb-2" />
                            <p className="text-xs">生成中…</p>
                          </div>
                        )}
                        <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[11px]">{idx + 1}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {picker && (
        <LibraryPicker library={picker.library}
          max={picker.purpose === "poses" ? MAX_SHOTS : 1}
          initial={picker.purpose === "poses" ? poses : []}
          onConfirm={onPicked} onClose={() => setPicker(null)} />
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="預覽" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}

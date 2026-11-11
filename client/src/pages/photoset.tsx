import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/components/AppNav";
import { LibraryPicker } from "@/components/LibraryPicker";
import { CharacterWizard } from "@/components/CharacterWizard";
import { VaultPicker } from "@/components/VaultPicker";
import { ReferenceCollage, type CollageTile } from "@/components/ReferenceCollage";
import { SensitiveGate } from "@/components/SensitiveGate";
import { CHARACTER_PACK_MAX_IMAGES, type CharacterLibraryItem, type FourViewUrls, type ImageGeneration, type SceneLibraryItem } from "@shared/schema";
import { IMAGE_RATIOS, IMAGE_TIERS, imageSizeFor, type ImageRatioId, type ImageTierId } from "@shared/imageSizes";
import type { LibraryId } from "@shared/libraryCatalog";
import { loadRecipe, type Recipe, type RecipeItem } from "@/lib/recipe";
import { IMAGE_COST, MEMBERSHIP, TRIAL, WATERMARK_REMOVAL_COST, imageCost } from "@shared/pricing";
import { inGoldZone } from "@/lib/zone";
/** Price of one image on the page being shown (the gold zone costs more). */
const priceHere = (watermark: boolean) => imageCost(watermark, inGoldZone());
/** What removing the watermark adds on this page. */
const removalHere = () => priceHere(false) - priceHere(true);
import {
  EXPRESSIONS, MAX_PROPS, PHOTO_LOOKS, PROP_PRESETS, REF_BUDGET, SETTINGS, SHOT_STYLES,
  photoLookSuffix, poseRefNote, referenceNote, shootControlText, studioReferenceNote,
  type PhotoLookId, type ShootControl,
} from "@shared/photosetOptions";

// 寫真工作室（/photoset）與角色九宮格（/character-library/sheet）共用這個頁面。
// 畫面是一步一步的：一開始只看得到第一步，按「下一步」才出現下一步（還沒走到的步驟完全不顯示）；
// 做過的步驟收成一行摘要，點了可以回去改。全部走完才出現「規劃鏡頭」。從素材圖庫帶配方進來時直接全部顯示。
//
//   照片同款（mode "scene"）：有一張喜歡的照片，用同樣的場景與風格，換成自己的角色、也可以換服裝，生成一系列。
//             ① 要模仿的照片（沒有照片才改用文字描述場景）
//             ② 角色（選填，從角色庫帶入四視圖）③ 姿勢與服裝（各選一個，選填）④ 張數與輸出
//   素材套圖  ① 人物 ② 服裝 ③ 姿勢 ④ 張數與輸出 —— 人像／服裝／姿勢都可以隨機
//   角色九宮格（variant="sheet"） ① 角色 ② 張數，固定規格
//
// 姿勢與服裝都只選一個。選的姿勢用在第一張，其餘由 AI 依情境安排；
// 規劃完之後每個鏡頭可以再各自換姿勢，服裝也可以隨時更換（不用重新規劃）。
//
// 圖片模型一次最多 10 張圖，分配見 REF_BUDGET：情境 1 ＋ 人物最多 6 ＋ 服裝 1 ＋ 該鏡頭的姿勢 1。
// 送出順序固定為 [情境圖?, ...人物參考圖, 服裝圖?, (姿勢圖)]，與提示詞後面的圖片說明一致。

type Variant = "studio" | "sheet";
type Mode = "scene" | "kit" | "sheet";
type Shot = { title: string; prompt: string; poseRef?: string };
type Plan = { analysis: string; shots: Shot[] };
type BatchStatus = { batchId: string; generations: ImageGeneration[]; totalCount: number; completedCount: number; failedCount: number };
type Picker = { library: LibraryId; purpose: "portrait" | "costume" | "pose" | "shotPose"; idx?: number };
type VaultTarget = { purpose: "situation" | "ref" | "shotPose"; idx?: number };
type LibraryAsset = { id: string; name: string; usage: string; imageUrl: string | null; thumbUrl: string | null };

const MIN_SHOTS = 2;
const MAX_SHOTS = 10;
const SHEET_MAX_REFS = 9;
/** A library character brings its four views (front, 3/4, side, back). */
const CHARACTER_IMAGES = REF_BUDGET.character;
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
  const m = msg.match(/\{[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (typeof j.error === "string") return j.error; } catch { /* fall through */ }
  }
  return msg;
}

function checkImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) return "請上傳 JPG、PNG 或 WEBP 圖片。";
  if (file.size > MAX_UPLOAD_BYTES) return "請上傳 20MB 以內的圖片。";
  return null;
}

/**
 * The character's person references, most faithful first: the real photos it was
 * built from (the first one is the face), then its AI-made four views to fill
 * what is left. Real photos come first because a picture copied from an AI
 * picture drifts a little further from the person each time.
 */
function characterImages(c: CharacterLibraryItem | null): string[] {
  if (!c) return [];
  const v = (c.fourViewUrls ?? {}) as FourViewUrls;
  const views = [v.front, v.threeQuarter, v.side, v.back].filter((u): u is string => !!u);
  return Array.from(new Set([...(c.refImageUrls ?? []), ...views])).slice(0, CHARACTER_IMAGES);
}

/** One random ready-made asset from the library. */
async function randomFromLibrary(library: LibraryId): Promise<RecipeItem> {
  const PAGE = 60;
  const get = async (page: number) => {
    const res = await apiRequest("GET", `/api/library/assets?library=${library}&page=${page}&pageSize=${PAGE}`);
    return res.json() as Promise<{ items: LibraryAsset[]; total: number }>;
  };
  const first = await get(1);
  const pages = Math.min(1000, Math.max(1, Math.ceil(first.total / PAGE)));
  const page = 1 + Math.floor(Math.random() * pages);
  const pool = (page === 1 ? first : await get(page)).items.filter(a => !!a.imageUrl);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (!pick) throw new Error("圖庫裡還沒有可用的素材。");
  return { id: pick.id, name: pick.name, usage: pick.usage, imageUrl: pick.imageUrl, thumbUrl: pick.thumbUrl };
}

/* ───────────────────────── small building blocks ───────────────────────── */

function Step({ n, title, summary, open, done, locked, onOpen, children }: {
  n: number; title: string; summary: string; open: boolean; done: boolean; locked: boolean; onOpen: () => void; children: ReactNode;
}) {
  return (
    <section className={`rounded-3xl border transition-colors ${open ? "bg-white border-indigo-300 shadow-glow" : "bg-white/80 border-indigo-100"} ${locked ? "opacity-50" : ""}`} data-testid={`step-${n}`}>
      <button onClick={onOpen} disabled={locked || open} className="w-full flex items-center gap-3 p-4 text-left">
        <span className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${done && !open ? "bg-emerald-500 text-white" : open ? "bg-brand text-white" : "bg-slate-200 text-slate-500"}`}>
          {done && !open ? <i className="fas fa-check text-[10px]" /> : n}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">{title}</span>
          {!open && <span className="block text-xs text-slate-500 truncate">{summary}</span>}
        </span>
        {!open && !locked && <span className="text-xs text-indigo-600 shrink-0">修改</span>}
      </button>
      {open && <div className="px-4 pb-4 space-y-4">{children}</div>}
    </section>
  );
}

function NextButton({ onClick, disabled, label = "下一步" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-next-step">
      {label}<i className="fas fa-arrow-down ml-2 text-xs" />
    </button>
  );
}

/** A picked library item, or the buttons that pick one (choose / random). */
function LibrarySlot({ label, icon, item, onPick, onRandom, onClear, disabled, randomizing }: {
  label: string; icon: string; item?: RecipeItem; onPick: () => void; onRandom: () => void; onClear: () => void; disabled?: boolean; randomizing?: boolean;
}) {
  const random = (
    <button onClick={onRandom} disabled={disabled || randomizing} title={`隨機選一個${label}`}
      className="shrink-0 h-12 px-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 text-xs font-semibold hover:bg-fuchsia-100 disabled:opacity-50" data-testid={`button-random-${label}`}>
      <i className={`fas ${randomizing ? "fa-spinner fa-spin" : "fa-shuffle"} mr-1.5`} />隨機
    </button>
  );
  if (!item) {
    return (
      <div className="flex gap-2">
        <button onClick={onPick} disabled={disabled}
          className="flex-1 h-12 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/50 text-indigo-700 text-sm font-medium flex items-center justify-center gap-2 hover:bg-indigo-50 disabled:opacity-50" data-testid={`button-pick-${label}`}>
          <i className={`fas ${icon} text-xs`} />從素材圖庫選{label}
        </button>
        {random}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-1.5 pr-2">
        <img src={item.thumbUrl || item.imageUrl || ""} alt={item.name} className="w-9 h-9 rounded-lg object-contain bg-white shrink-0" />
        <p className="min-w-0 flex-1 text-sm text-slate-900 truncate" title={item.name}>{item.name}</p>
        <button onClick={onPick} disabled={disabled} className="text-xs text-indigo-600 hover:underline disabled:opacity-40">更換</button>
        <button onClick={onClear} disabled={disabled} className="w-6 h-6 rounded-full text-slate-400 hover:text-red-500 disabled:opacity-40" title="移除"><i className="fas fa-xmark" /></button>
      </div>
      {random}
    </div>
  );
}

/** Upload from the device, or take one of your own works. */
function SourceButtons({ onUpload, onVault, busy, disabled }: { onUpload: () => void; onVault: () => void; busy?: boolean; disabled?: boolean }) {
  const cls = "flex-1 h-11 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 hover:border-indigo-300 disabled:opacity-50";
  return (
    <div className="flex gap-2">
      <button onClick={onUpload} disabled={disabled || busy} className={cls}><i className="fas fa-cloud-arrow-up mr-2 text-xs text-slate-400" />{busy ? "上傳中…" : "上傳照片"}</button>
      <button onClick={onVault} disabled={disabled} className={cls} data-testid="button-from-vault"><i className="fas fa-photo-film mr-2 text-xs text-slate-400" />從作品選</button>
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */

export default function PhotosetPage({ variant = "studio" }: { variant?: Variant }) {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const situationInputRef = useRef<HTMLInputElement>(null);
  const poseRefInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [poseRefTarget, setPoseRefTarget] = useState<number | null>(null);
  const isSheet = variant === "sheet";

  // Deep links: /photoset?mode=scene|kit&character=<id>, /photoset?recipe=1 (from the
  // asset library) and /character-library/sheet?character=<id>.
  const initial = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    const recipe: Recipe = !isSheet && q.get("recipe") === "1" ? loadRecipe() : {};
    const hasRecipe = Object.keys(recipe).length > 0;
    const asked = q.get("mode");
    const mode: Mode = isSheet ? "sheet" : asked === "scene" ? "scene" : "kit";
    return { mode, characterId: q.get("character") || "", recipe };
  }, [isSheet]);

  const [mode, setMode] = useState<Mode>(initial.mode);
  const [active, setActive] = useState(0);
  // The furthest step shown so far. Steps beyond it stay hidden until "下一步" reaches them.
  const [reached, setReached] = useState(() => (Object.keys(initial.recipe).length > 0 ? 99 : 0));
  const goTo = (i: number) => { setActive(i); setReached(r => Math.max(r, i)); };
  const [sceneText, setSceneText] = useState("");
  const [situationPath, setSituationPath] = useState("");
  const [characterId, setCharacterId] = useState(initial.recipe.portrait ? "" : initial.characterId);
  const [portrait, setPortrait] = useState<RecipeItem | undefined>(initial.recipe.portrait);
  const [costume, setCostume] = useState<RecipeItem | undefined>(initial.recipe.costume);
  const [pose, setPose] = useState<RecipeItem | undefined>(initial.recipe.pose);
  const [extraRefs, setExtraRefs] = useState<string[]>([]);
  const [outfitFrom, setOutfitFrom] = useState<"character" | "scene">("character");
  const [uploading, setUploading] = useState<"" | "situation" | "refs">("");
  const [randomizing, setRandomizing] = useState<"" | LibraryId | "all">("");
  // Default number of shots: six, or fewer when the balance cannot pay for six (a new account has enough for two).
  const [count, setCount] = useState(() => {
    if (isSheet) return 9;
    const affordable = Math.floor((user?.credits ?? 0) / IMAGE_COST);
    return affordable >= MIN_SHOTS && affordable < 6 ? affordable : 6;
  });
  const [ratioId, setRatioId] = useState<ImageRatioId>("3:4");
  const [tierId, setTierId] = useState<ImageTierId>("2k");
  const [lookId, setLookId] = useState<PhotoLookId>("natural");
  const [control, setControl] = useState<ShootControl>({ props: [] });
  const [propDraft, setPropDraft] = useState("");
  const [direction, setDirection] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  // A character sheet is reference material: a watermark would leak into later images.
  const [removeWatermark, setRemoveWatermark] = useState(isSheet);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [batchId, setBatchId] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [savedUrls, setSavedUrls] = useState<string[]>([]);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [vaultTarget, setVaultTarget] = useState<VaultTarget | null>(null);
  const [showCollage, setShowCollage] = useState(false);

  const { data: savedScenes = [] } = useQuery<SceneLibraryItem[]>({ queryKey: ["/api/scene-library"], enabled: !isSheet });
  const { data: characters = [], isSuccess: charactersLoaded } = useQuery<CharacterLibraryItem[]>({ queryKey: ["/api/character-library"] });
  // Someone with no character yet starts by making one: the wizard opens by itself once.
  const [showWizard, setShowWizard] = useState(false);
  const wizardOffered = useRef(false);
  useEffect(() => {
    if (isSheet || wizardOffered.current || !charactersLoaded) return;
    wizardOffered.current = true;
    if (characters.length === 0 && !initial.recipe.portrait) setShowWizard(true);
  }, [isSheet, charactersLoaded, characters.length, initial.recipe.portrait]);
  const character = characters.find(c => c.id === characterId) ?? null;
  const characterRefs = character?.refImageUrls ?? [];
  // The sheet builds the pack, so it reads the whole pack; a shoot takes the four views.
  const characterShown = useMemo(() => (isSheet ? characterRefs : characterImages(character)), [isSheet, character, characterRefs]);

  const refCap = isSheet ? SHEET_MAX_REFS : REF_BUDGET.character;
  const wantedRefs = useMemo(
    () => [...(portrait?.imageUrl ? [portrait.imageUrl] : []), ...characterShown, ...extraRefs],
    [portrait, characterShown, extraRefs],
  );
  const personRefs = useMemo(() => wantedRefs.slice(0, refCap), [wantedRefs, refCap]);
  const costumeImage = !isSheet ? costume?.imageUrl ?? "" : "";
  const hasSituation = mode === "scene" && !!situationPath;

  const watermark = !removeWatermark;
  const ratio = IMAGE_RATIOS.find(r => r.id === ratioId) ?? IMAGE_RATIOS[0];
  const outputSize = imageSizeFor(ratioId, tierId);
  const shots = plan?.shots ?? [];
  const validShots = shots.filter(s => s.prompt.trim().length > 0);
  const perImage = priceHere(watermark);
  const totalCost = validShots.length * perImage;
  const credits = user?.credits ?? 0;
  const anyPoseRef = plan ? validShots.some(s => !!s.poseRef) : !!pose;

  // Images every shot shares, in the order the prompt note describes them.
  const sharedImages = [...(hasSituation ? [situationPath] : []), ...personRefs, ...(costumeImage ? [costumeImage] : [])];
  const usedSlots = sharedImages.length + (anyPoseRef ? REF_BUDGET.pose : 0);
  // A written scene has no picture of anyone, so it needs a person to put in it.
  const firstStepDone = mode === "scene" ? !!situationPath || (sceneText.trim().length > 0 && personRefs.length > 0) : personRefs.length > 0;
  const inputsReady = firstStepDone;

  const resetPlan = () => { setPlan(null); setBatchId(""); setSavedUrls([]); };
  useEffect(() => { resetPlan(); }, [mode, characterId]); // eslint-disable-line react-hooks/exhaustive-deps
  const switchMode = (m: Mode) => { if (m !== mode) { setMode(m); setActive(0); setReached(0); } };

  const collageTiles: CollageTile[] = [
    ...(personRefs[0] ? [{ label: "人像", name: portrait?.name ?? character?.name ?? "人物參考圖", url: personRefs[0] }] : []),
    ...(costume?.imageUrl ? [{ label: "服裝", name: costume.name, url: costume.imageUrl }] : []),
    ...(pose?.imageUrl ? [{ label: "姿勢", name: pose.name, url: pose.imageUrl }] : []),
  ].map((t, i) => ({ ...t, label: `圖${i + 1}・${t.label}` }));

  /* ── uploads and picks ── */

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

  const addRef = (url: string) => {
    if (wantedRefs.length >= refCap) {
      toast({ title: "人物參考圖已達上限", description: `這裡最多使用 ${refCap} 張。`, variant: "destructive" });
      return false;
    }
    setExtraRefs(prev => (prev.includes(url) ? prev : [...prev, url]));
    resetPlan();
    return true;
  };

  const handleRefFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = refCap - wantedRefs.length;
    if (room <= 0) { toast({ title: "人物參考圖已達上限", description: `這裡最多使用 ${refCap} 張。`, variant: "destructive" }); return; }
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

  const updateShot = (idx: number, patch: Partial<Shot>) => {
    setPlan(p => p ? { ...p, shots: p.shots.map((s, i) => (i === idx ? { ...s, ...patch } : s)) } : p);
  };
  const removeShot = (idx: number) => { setPlan(p => p ? { ...p, shots: p.shots.filter((_, i) => i !== idx) } : p); };
  const addShot = () => { setPlan(p => p && p.shots.length < MAX_SHOTS ? { ...p, shots: [...p.shots, { title: `鏡頭 ${p.shots.length + 1}`, prompt: "" }] } : p); };

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

  const applyPick = (purpose: Picker["purpose"], item: RecipeItem, idx?: number) => {
    if (purpose === "portrait") { setPortrait(item); setCharacterId(""); resetPlan(); }
    else if (purpose === "costume") setCostume(item); // the outfit is applied at generation time: no re-plan needed
    else if (purpose === "pose") { setPose(item); resetPlan(); }
    else if (purpose === "shotPose" && idx !== undefined) updateShot(idx, { poseRef: item.imageUrl ?? undefined });
  };
  const onPicked = (items: RecipeItem[]) => {
    const p = picker;
    setPicker(null);
    if (p && items[0]) applyPick(p.purpose, items[0], p.idx);
  };
  const onVaultPicked = (url: string) => {
    const t = vaultTarget;
    setVaultTarget(null);
    if (!t) return;
    if (t.purpose === "situation") { setSituationPath(url); resetPlan(); }
    else if (t.purpose === "ref") addRef(url);
    else if (t.purpose === "shotPose" && t.idx !== undefined) updateShot(t.idx, { poseRef: url });
  };
  const pickRandom = async (libraries: LibraryId[]) => {
    setRandomizing(libraries.length > 1 ? "all" : libraries[0]);
    try {
      const items = await Promise.all(libraries.map(randomFromLibrary));
      libraries.forEach((lib, i) => applyPick(lib, items[i]));
    } catch (e) {
      toast({ title: "隨機選擇失敗", description: errorText(e), variant: "destructive" });
    } finally {
      setRandomizing("");
    }
  };

  const setControlField = (patch: Partial<ShootControl>) => { setControl(prev => ({ ...prev, ...patch })); };
  const toggleProp = (name: string) => {
    const p = name.trim().slice(0, 20);
    if (!p) return;
    setControl(prev => prev.props.includes(p)
      ? { ...prev, props: prev.props.filter(x => x !== p) }
      : prev.props.length >= MAX_PROPS ? prev : { ...prev, props: [...prev.props, p] });
  };

  /* ── plan and generate ── */

  const planMutation = useMutation({
    mutationFn: async (planner: "ai" | "preset"): Promise<Plan> => {
      const scene = sceneText.trim();
      const directionParts = [
        scene ? (hasSituation ? `情境補充：${scene}` : mode === "scene" ? `拍攝情境（整組都在這個情境裡拍攝）：${scene}` : "") : "",
        pose ? `姿勢：第一張請使用這個姿勢——${pose.usage}；其餘各張請依情境自行安排不同的姿勢，不要重複` : "",
        costume ? "服裝會另外指定，提示詞不要描述服裝的款式與顏色" : "",
        isSheet ? "" : shootControlText(control, { hasSceneImage: hasSituation }),
        direction.trim(),
      ].filter(Boolean);
      const res = await apiRequest("POST", "/api/photosets/plan", {
        mode: hasSituation ? "scene" : "character",
        planner,
        situationImageUrl: hasSituation ? situationPath : undefined,
        referenceImageUrls: personRefs,
        characterName: character?.name,
        characterDescription: character?.description || undefined,
        outfitFrom,
        characterGoal: isSheet ? "sheet" : "shoot",
        count,
        look: lookId,
        direction: directionParts.join("。").slice(0, 1200) || undefined,
        aspectRatio: ratio.id,
      });
      return res.json();
    },
    onSuccess: (data) => {
      // The picked pose is for the opening shot; the rest are the planner's own.
      setPlan({ ...data, shots: data.shots.map((s, i) => ({ ...s, poseRef: i === 0 ? pose?.imageUrl || undefined : undefined })) });
      setBatchId(""); setSavedUrls([]);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    },
    onError: (e) => toast({ title: "規劃失敗", description: errorText(e), variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const note = isSheet
        ? referenceNote("character", personRefs.length, "character")
        : studioReferenceNote({
            hasSituation,
            characterCount: personRefs.length,
            hasCostumeImage: !!costumeImage,
            outfit: costume ? (costumeImage ? "costume" : "prompt") : hasSituation ? outfitFrom : portrait ? "prompt" : "character",
          });
      // The outfit is added here, not in the plan, so it can be swapped without re-planning.
      const outfitText = !isSheet && costume ? `（服裝：${costume.usage}）` : "";
      const [first, ...rest] = sharedImages;
      const poseImageNumber = sharedImages.length + 1;
      const hasPoseRefs = validShots.some(s => !!s.poseRef);
      const res = await apiRequest("POST", "/api/image-generations", {
        type: "image-to-image",
        originalImageUrl: first,
        additionalImageUrls: rest.length > 0 ? rest : undefined,
        prompts: validShots.map(s =>
          `${s.prompt.trim()}${outfitText}${note}${s.poseRef ? poseRefNote(poseImageNumber) : ""}${photoLookSuffix(lookId)}`),
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
    queryFn: async () => (await apiRequest("GET", `/api/batch-generations/${batchId}`)).json(),
    enabled: !!batchId,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 3000;
      return d.completedCount + d.failedCount >= d.totalCount ? false : 3000;
    },
  });

  const batchDone = !!batch && batch.completedCount + batch.failedCount >= batch.totalCount;
  // When a set is finished, invite the visitor to the 會員商城: always for non-members, and for
  // members whose balance can no longer pay for a set of the same size. Once per finished set.
  const [nudgedBatch, setNudgedBatch] = useState("");
  const [showStoreNudge, setShowStoreNudge] = useState(false);
  const isMember = !!user?.isMember || !!user?.isAdmin;
  useEffect(() => {
    if (isSheet || !batchDone || !batch || batch.completedCount === 0 || nudgedBatch === batch.batchId) return;
    setNudgedBatch(batch.batchId);
    if (inGoldZone()) return;
    if (!isMember || credits < totalCost) setShowStoreNudge(true);
  }, [isSheet, batchDone, batch, nudgedBatch, isMember, credits, totalCost]);
  const isGenerating = generateMutation.isPending || (!!batchId && !batchDone);
  const busy = isGenerating || planMutation.isPending;

  // Only images already re-hosted on our CDN are permanent enough to keep in a character pack.
  const savableUrls = (batch?.generations ?? []).filter(g => g.status === "completed" && !!g.bunnyImageUrl).map(g => g.bunnyImageUrl as string);
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

  const canGenerate = inputsReady && validShots.length >= MIN_SHOTS && validShots.length <= MAX_SHOTS && credits >= totalCost && !busy;
  const imageOf = (g: ImageGeneration) => g.bunnyImageUrl || g.generatedImageUrl || "";
  const isSaved = (url: string) => savedUrls.includes(url) || characterRefs.includes(url);
  const selectBtn = (on: boolean) => `rounded-xl border transition-colors ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-indigo-300"}`;
  const chipBtn = (on: boolean) => `px-2.5 h-8 text-xs ${selectBtn(on)}`;

  /* ── step bodies ── */

  const refThumbs = (
    <div className="flex flex-wrap gap-2">
      {portrait?.imageUrl && (
        <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-fuchsia-300 bg-slate-50" title={portrait.name}>
          <img src={portrait.thumbUrl || portrait.imageUrl} alt={portrait.name} className="w-full h-full object-cover" />
          <span className="absolute bottom-0 inset-x-0 bg-fuchsia-500/85 text-white text-[9px] text-center">圖庫人像</span>
        </div>
      )}
      {characterShown.slice(0, Math.max(0, refCap - (portrait?.imageUrl ? 1 : 0))).map((url, i) => (
        <div key={`c-${i}`} className="relative w-14 h-14 rounded-lg overflow-hidden border border-indigo-200 bg-slate-50" title={character?.name}>
          <img src={url} alt={`角色圖 ${i + 1}`} className="w-full h-full object-cover" />
          <span className="absolute bottom-0 inset-x-0 bg-indigo-600/80 text-white text-[9px] text-center">角色</span>
        </div>
      ))}
      {extraRefs.map((url, i) => (
        <div key={`x-${i}`} className="relative w-14 h-14 rounded-lg overflow-hidden border border-slate-300 bg-slate-50">
          <img src={url} alt={`參考圖 ${i + 1}`} className="w-full h-full object-cover" />
          <button onClick={() => { setExtraRefs(prev => prev.filter((_, idx) => idx !== i)); resetPlan(); }} disabled={busy}
            className="absolute top-0 right-0 w-5 h-5 bg-red-500 text-white text-xs rounded-bl-lg flex items-center justify-center" title="移除">×</button>
        </div>
      ))}
    </div>
  );

  const refUploader = (
    <>
      <input ref={refInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => handleRefFiles(e.target.files)} data-testid="input-photoset-refs" />
      <SourceButtons onUpload={() => refInputRef.current?.click()} onVault={() => setVaultTarget({ purpose: "ref" })} busy={uploading === "refs"} disabled={busy || wantedRefs.length >= refCap} />
    </>
  );

  const characterSelect = (
    <div className="flex gap-2">
      <select value={characterId} onChange={(e) => { setCharacterId(e.target.value); if (e.target.value) setPortrait(undefined); }} disabled={busy}
        className="flex-1 min-w-0 h-11 px-3 border border-slate-200 rounded-xl text-sm bg-white" data-testid="select-photoset-character">
        <option value="">{mode === "scene" ? "不指定角色" : "從角色庫選擇…"}</option>
        {characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {!isSheet && (
        <button onClick={() => setShowWizard(true)} disabled={busy}
          className="shrink-0 h-11 px-3 flex items-center gap-1.5 border border-indigo-300 bg-indigo-50 rounded-xl text-xs font-semibold text-indigo-700 hover:bg-indigo-100 whitespace-nowrap disabled:opacity-50" data-testid="button-new-character">
          <i className="fas fa-plus text-[10px]" />新角色
        </button>
      )}
    </div>
  );

  const sceneBody = (
    <>
      <div>
        <p className="text-sm font-semibold text-slate-800">放一張你喜歡的照片</p>
        <p className="text-xs text-slate-500 mt-1 mb-3 leading-relaxed">
          例如你在外面拍的、或在網路上看到想要同款的照片。AI 會照它的場景、光線和風格，換成你的角色，再生成一系列不同鏡頭。下一步選角色，再下一步可以換服裝。
        </p>
        <input ref={situationInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handleSituationFile(e.target.files?.[0])} data-testid="input-photoset-situation" />
        {situationPath && (
          <div className="relative mb-2">
            <img src={situationPath} alt="要模仿的照片" className="w-full max-h-56 object-contain rounded-xl bg-slate-100" />
            <button onClick={() => { setSituationPath(""); resetPlan(); }} disabled={busy} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white" title="移除"><i className="fas fa-xmark text-xs" /></button>
          </div>
        )}
        <SourceButtons onUpload={() => situationInputRef.current?.click()} onVault={() => setVaultTarget({ purpose: "situation" })} busy={uploading === "situation"} disabled={busy} />
        {savedScenes.some(sc => (sc.refImageUrls?.length ?? 0) > 0) && (
          <select value="" disabled={busy}
            onChange={(e) => { const first = savedScenes.find(x => x.id === e.target.value)?.refImageUrls?.[0]; if (first) { setSituationPath(first); resetPlan(); } }}
            className="w-full mt-2 h-11 px-3 border border-slate-200 rounded-xl text-sm bg-white" data-testid="select-photoset-scene">
            <option value="">從場景庫選一個已儲存的場景…</option>
            {savedScenes.filter(sc => (sc.refImageUrls?.length ?? 0) > 0).map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
          </select>
        )}
      </div>
      <div className="border-t border-slate-100 pt-4">
        <label className="text-xs font-semibold text-slate-600 block mb-1">
          {situationPath ? "想調整的地方" : "沒有照片？用文字描述場景"} <span className="font-normal text-slate-400">{situationPath ? "選填" : "二選一"}</span>
        </label>
        <textarea value={sceneText} onChange={e => { setSceneText(e.target.value.slice(0, 400)); if (plan) resetPlan(); }} rows={2} disabled={busy}
          placeholder={situationPath ? "例如：改成傍晚的光線、人少一點" : "例如：午後的老咖啡店，靠窗的位置，暖色的陽光斜照進來"}
          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" data-testid="input-scene-text" />
      </div>
    </>
  );

  const personBody = (
    <>
      {characterSelect}
      {character && characterShown.length === 0 && <p className="text-xs text-red-500">這個角色還沒有圖片，請到角色庫上傳照片。</p>}
      {mode === "kit" && (
        <LibrarySlot label="人像" icon="fa-face-smile" item={portrait} disabled={busy} randomizing={randomizing === "portrait" || randomizing === "all"}
          onPick={() => setPicker({ library: "portrait", purpose: "portrait" })} onRandom={() => pickRandom(["portrait"])} onClear={() => { setPortrait(undefined); resetPlan(); }} />
      )}
      {wantedRefs.length > 0 && refThumbs}
      {!isSheet && characters.length === 0 && !portrait && (
        <button onClick={() => setShowWizard(true)} disabled={busy}
          className="w-full text-left rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/60 p-4 hover:bg-indigo-50 disabled:opacity-50" data-testid="button-first-character">
          <span className="block text-sm font-bold text-indigo-800"><i className="fas fa-user-plus mr-2" />先建立你的角色</span>
          <span className="block text-xs text-slate-600 mt-1">上傳最多 10 張自己的照片，之後每一組寫真都是你。第一次建立會免費幫你生成四視圖。</span>
        </button>
      )}
      {wantedRefs.length < refCap && (
        <p className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-fuchsia-50 border border-fuchsia-200 text-xs font-semibold text-fuchsia-700" data-testid="hint-more-refs">
          <i className="fas fa-circle-plus" />再上傳幾張你的照片，會更像你自己
        </p>
      )}
      {refUploader}
      <p className="text-[11px] text-slate-400">
        人物參考圖 {personRefs.length}／{refCap} 張。{isSheet ? "" : `選角色會帶入它的照片（最多 ${CHARACTER_IMAGES} 張，本人照片優先）。`}臉部清楚的正面照效果最好。
      </p>
    </>
  );

  const costumeSlot = (
    <LibrarySlot label="服裝" icon="fa-shirt" item={costume} disabled={busy} randomizing={randomizing === "costume" || randomizing === "all"}
      onPick={() => setPicker({ library: "costume", purpose: "costume" })} onRandom={() => pickRandom(["costume"])} onClear={() => setCostume(undefined)} />
  );
  const poseSlot = (
    <>
      <LibrarySlot label="姿勢" icon="fa-person-walking" item={pose} disabled={busy} randomizing={randomizing === "pose" || randomizing === "all"}
        onPick={() => setPicker({ library: "pose", purpose: "pose" })} onRandom={() => pickRandom(["pose"])} onClear={() => { setPose(undefined); resetPlan(); }} />
      <p className="text-[11px] text-slate-400">{pose ? "這個姿勢用在第一張，其餘由 AI 依情境安排；規劃後每張都能再換。" : "不選就全部由 AI 依情境安排姿勢。"}</p>
    </>
  );
  const outfitSource = hasSituation && personRefs.length > 0 && !costume && (
    <div className="grid grid-cols-2 gap-2">
      <button onClick={() => { setOutfitFrom("character"); resetPlan(); }} disabled={busy} className={`h-10 text-sm ${selectBtn(outfitFrom === "character")}`}>穿人物照的服裝</button>
      <button onClick={() => { setOutfitFrom("scene"); resetPlan(); }} disabled={busy} className={`h-10 text-sm ${selectBtn(outfitFrom === "scene")}`}>穿情境照的服裝</button>
    </div>
  );

  const outputBody = (
    <>
      <div>
        <label className="text-xs font-semibold text-slate-600 block mb-1">張數</label>
        <div className="flex items-center gap-2">
          <button onClick={() => setCount(c => Math.max(MIN_SHOTS, c - 1))} disabled={busy || count <= MIN_SHOTS} className="w-11 h-11 rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40" aria-label="減少"><i className="fas fa-minus text-xs" /></button>
          <input type="number" inputMode="numeric" min={MIN_SHOTS} max={MAX_SHOTS} value={count} disabled={busy}
            onChange={e => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setCount(Math.max(MIN_SHOTS, Math.min(MAX_SHOTS, n))); }}
            className="w-20 h-11 text-center border border-slate-200 rounded-xl text-base font-semibold tabular-nums" data-testid="input-photoset-count" />
          <button onClick={() => setCount(c => Math.min(MAX_SHOTS, c + 1))} disabled={busy || count >= MAX_SHOTS} className="w-11 h-11 rounded-xl border border-slate-200 text-slate-600 disabled:opacity-40" aria-label="增加"><i className="fas fa-plus text-xs" /></button>
          <span className="text-xs text-slate-400">{MIN_SHOTS}–{MAX_SHOTS} 張{isSheet ? "，九宮格請選 9" : ""}</span>
        </div>
      </div>
      {!isSheet && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">比例</span>
              <select value={ratioId} onChange={e => setRatioId(e.target.value as ImageRatioId)} disabled={busy} className="mt-1 w-full h-11 px-2 border border-slate-200 rounded-xl text-sm bg-white" data-testid="select-photoset-ratio">
                {IMAGE_RATIOS.map(r => <option key={r.id} value={r.id}>{r.label}・{r.hint}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">畫質</span>
              <select value={tierId} onChange={e => setTierId(e.target.value as ImageTierId)} disabled={busy} className="mt-1 w-full h-11 px-2 border border-slate-200 rounded-xl text-sm bg-white" data-testid="select-photoset-tier">
                {IMAGE_TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 block mb-1">畫面質感</label>
            <div className="grid grid-cols-2 gap-2">
              {PHOTO_LOOKS.map(l => <button key={l.id} onClick={() => setLookId(l.id)} disabled={busy} title={l.hint} className={`h-10 px-2 text-sm ${selectBtn(lookId === l.id)}`} data-testid={`button-photoset-look-${l.id}`}>{l.label}</button>)}
            </div>
          </div>
          <div className="border border-slate-200 rounded-2xl" data-testid="panel-shoot-control">
            <button onClick={() => setShowAdvanced(v => !v)} className="w-full h-11 px-3 flex items-center justify-between text-sm font-semibold text-slate-800">
              <span>拍攝控制 <span className="text-xs font-normal text-slate-400">鏡頭、表情、道具・選填</span></span>
              <i className={`fas fa-chevron-down text-xs text-slate-400 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            </button>
            {showAdvanced && (
              <div className="px-3 pb-3 space-y-3">
                {!hasSituation && (
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">場景</label>
                    <div className="flex flex-wrap gap-1.5">{SETTINGS.map(o => <button key={o.id} onClick={() => setControlField({ settingId: control.settingId === o.id ? undefined : o.id })} disabled={busy} title={o.text} className={chipBtn(control.settingId === o.id)}>{o.label}</button>)}</div>
                  </div>
                )}
                <div>
                  <label className="text-xs text-slate-500 block mb-1">鏡頭風格</label>
                  <div className="flex flex-wrap gap-1.5">{SHOT_STYLES.map(o => <button key={o.id} onClick={() => setControlField({ shotStyleId: control.shotStyleId === o.id ? undefined : o.id })} disabled={busy} title={o.text} className={chipBtn(control.shotStyleId === o.id)}>{o.label}</button>)}</div>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">表情</label>
                  <div className="flex flex-wrap gap-1.5">{EXPRESSIONS.map(o => <button key={o.id} onClick={() => setControlField({ expressionId: control.expressionId === o.id ? undefined : o.id })} disabled={busy} title={o.text} className={chipBtn(control.expressionId === o.id)}>{o.label}</button>)}</div>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">道具（最多 {MAX_PROPS} 個）</label>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(new Set([...PROP_PRESETS, ...control.props])).map(name => (
                      <button key={name} onClick={() => toggleProp(name)} disabled={busy || (!control.props.includes(name) && control.props.length >= MAX_PROPS)} className={`${chipBtn(control.props.includes(name))} disabled:opacity-40`}>{name}</button>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <input value={propDraft} onChange={e => setPropDraft(e.target.value.slice(0, 20))} placeholder="自訂道具，例如：你的產品名稱" disabled={busy}
                      onKeyDown={e => { if (e.key === "Enter" && propDraft.trim()) { toggleProp(propDraft); setPropDraft(""); } }}
                      className="flex-1 min-w-0 h-9 px-3 border border-slate-200 rounded-lg text-sm" data-testid="input-photoset-prop" />
                    <button onClick={() => { toggleProp(propDraft); setPropDraft(""); }} disabled={busy || !propDraft.trim() || control.props.length >= MAX_PROPS} className="px-3 h-9 rounded-lg border border-slate-200 text-xs text-slate-600 disabled:opacity-40">加入</button>
                  </div>
                </div>
                <textarea value={direction} onChange={(e) => setDirection(e.target.value.slice(0, 500))} rows={2} disabled={busy} placeholder="其他要求，例如：日系清新、多一點臉部特寫"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" data-testid="input-photoset-direction" />
              </div>
            )}
          </div>
        </>
      )}
      <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3 cursor-pointer">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800">去除浮水印 <span className="text-xs font-normal text-fuchsia-600">+{removalHere()} 積分／張</span></span>
          <span className="block text-[11px] text-slate-500">{isSheet ? "定裝圖會當參考圖用，建議去除，否則浮水印可能被帶進之後的圖。" : `每張 ${priceHere(true)} 積分；去除浮水印為 ${priceHere(false)} 積分。`}</span>
        </span>
        <button role="switch" aria-checked={removeWatermark} onClick={() => setRemoveWatermark(v => !v)} disabled={busy}
          className={`shrink-0 w-12 h-7 rounded-full p-0.5 transition-colors ${removeWatermark ? "bg-indigo-600" : "bg-slate-300"}`} data-testid="switch-remove-watermark">
          <span className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${removeWatermark ? "translate-x-5" : ""}`} />
        </button>
      </label>
    </>
  );

  type StepDef = { title: string; summary: string; done: boolean; body: ReactNode };
  const personSummary = portrait ? `圖庫人像：${portrait.name}` : character ? `${character.name}（${personRefs.length} 張）` : personRefs.length > 0 ? `${personRefs.length} 張參考圖` : mode === "scene" ? "不指定，選填" : "尚未選擇";
  const outputSummary = isSheet ? `${count} 張${removeWatermark ? "・去浮水印" : ""}` : `${count} 張・${ratio.label}・${PHOTO_LOOKS.find(l => l.id === lookId)?.label ?? ""}${removeWatermark ? "・去浮水印" : ""}`;
  const steps: StepDef[] = isSheet
    ? [
        { title: "角色", summary: personSummary, done: personRefs.length > 0, body: personBody },
        { title: "張數", summary: outputSummary, done: true, body: outputBody },
      ]
    : mode === "scene"
      ? [
          { title: "要模仿的照片", summary: situationPath ? `已放照片${sceneText.trim() ? "＋調整說明" : ""}` : sceneText.trim() || "放一張喜歡的照片（沒有照片可以用文字描述）", done: !!situationPath || sceneText.trim().length > 0, body: sceneBody },
          { title: "角色", summary: personSummary, done: firstStepDone, body: personBody },
          { title: "姿勢與服裝", summary: [pose ? `姿勢：${pose.name}` : "姿勢由 AI 安排", costume ? `服裝：${costume.name}` : "服裝不指定"].join("・"), done: true, body: <>{poseSlot}{costumeSlot}{outfitSource}</> },
          { title: "張數與輸出", summary: outputSummary, done: true, body: outputBody },
        ]
      : [
          { title: "人物", summary: personSummary, done: personRefs.length > 0, body: personBody },
          { title: "服裝", summary: costume ? costume.name : "不指定，選填", done: true, body: costumeSlot },
          { title: "姿勢", summary: pose ? pose.name : "由 AI 安排，選填", done: true, body: poseSlot },
          { title: "張數與輸出", summary: outputSummary, done: true, body: outputBody },
        ];
  // A step opens once every step before it is done.
  const reachable = (i: number) => steps.slice(0, i).every(s => s.done);
  const lastStep = steps.length - 1;

  const MODES: Array<{ id: Mode; icon: string; title: string; desc: string }> = [
    { id: "kit", icon: "fa-layer-group", title: "素材套圖", desc: "選人物，配素材圖庫的服裝與姿勢。" },
    { id: "scene", icon: "fa-panorama", title: "照片同款", desc: "放一張喜歡的照片，換成你的角色和服裝，生成同風格的一系列。" },
  ];

  return (
    <div className="min-h-screen pb-24">
      <NavigationHeader />
      <div className="max-w-3xl mx-auto px-4 py-5 md:py-8">
        <div className="mb-5">
          {isSheet && <Link href="/character-library"><span className="hidden md:inline-block text-sm text-slate-500 hover:text-slate-800 cursor-pointer mb-1">← 回角色庫</span></Link>}
          <h1 className="hidden md:block text-2xl font-bold text-slate-900">{isSheet ? "角色九宮格" : "寫真工作室"}</h1>
          <p className="text-sm text-slate-500 md:mt-1">
            {isSheet ? "用角色參考圖生成正面、側面、背面、表情與姿勢的定裝圖，存回角色圖庫後，之後每次生成都更像同一個人。" : "照著步驟一步一步選，最後一次生成整組可貼上社群的寫真。"}
          </p>
        </div>

        {!isSheet && (
          <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-5" role="tablist">
            {MODES.map(m => {
              const on = mode === m.id;
              return (
                <button key={m.id} role="tab" aria-selected={on} onClick={() => switchMode(m.id)} disabled={busy}
                  className={`p-3 sm:p-4 text-left rounded-2xl border-2 transition-all ${on ? "border-indigo-500 bg-white shadow-glow" : "border-transparent bg-white/70 hover:border-indigo-200"}`} data-testid={`button-mode-${m.id}`}>
                  <span className="flex items-center gap-2.5">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${on ? "bg-brand text-white" : "bg-slate-100 text-slate-500"}`}><i className={`fas ${m.icon}`} /></span>
                    <span className={`text-sm sm:text-base font-bold ${on ? "text-slate-900" : "text-slate-600"}`}>{m.title}</span>
                  </span>
                  <span className="hidden sm:block text-xs text-slate-500 mt-2">{m.desc}</span>
                </button>
              );
            })}
          </div>
        )}

        {mode === "kit" && (
          <div className="flex gap-2 mb-3">
            <button onClick={() => pickRandom(["portrait", "costume", "pose"])} disabled={busy || !!randomizing}
              className="flex-1 h-11 rounded-xl bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 text-sm font-semibold hover:bg-fuchsia-100 disabled:opacity-50" data-testid="button-random-all">
              <i className={`fas ${randomizing === "all" ? "fa-spinner fa-spin" : "fa-shuffle"} mr-2`} />隨機配一組
            </button>
            <button onClick={() => setShowCollage(true)} disabled={collageTiles.length < 2}
              className="flex-1 h-11 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:border-indigo-300 disabled:opacity-40" data-testid="button-open-collage">
              <i className="fas fa-table-columns mr-2 text-slate-400" />參考圖拼圖
            </button>
          </div>
        )}

        {/* ── 步驟 ── */}
        <div className="space-y-3">
          {steps.map((s, i) => i > reached ? null : (
            <Step key={`${mode}-${i}`} n={i + 1} title={s.title} summary={s.summary} open={active === i} done={s.done && (active > i || !!plan)} locked={!reachable(i)} onOpen={() => setActive(i)}>
              {s.body}
              {i < lastStep
                ? <NextButton onClick={() => goTo(i + 1)} disabled={!s.done || !reachable(i + 1)} />
                : <NextButton onClick={() => goTo(steps.length)} label="設定完成" />}
              {i === 0 && mode === "scene" && !s.done && <p className="text-[11px] text-slate-400">請放一張照片；沒有照片的話，在下面用文字描述場景。</p>}
            </Step>
          ))}
        </div>

        {/* 參考圖配額：模型一次最多 10 張 */}
        {!isSheet && (
          <div className="rounded-2xl bg-white/80 border border-slate-200 p-3 mt-3" data-testid="ref-budget">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">參考圖配額</span>
              <span className="tabular-nums text-slate-500">{usedSlots}／{REF_BUDGET.total}</span>
            </div>
            <div className="flex gap-0.5 mt-2">
              {Array.from({ length: REF_BUDGET.total }, (_, i) => {
                const s = hasSituation ? 1 : 0;
                const kind = i < s ? "bg-sky-400" : i < s + personRefs.length ? "bg-indigo-500" : i < sharedImages.length ? "bg-fuchsia-400" : i < usedSlots ? "bg-amber-400" : "bg-slate-200";
                return <span key={i} className={`flex-1 h-1.5 rounded-full ${kind}`} />;
              })}
            </div>
            <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 mt-2">
              {mode === "scene" && <span><i className="fas fa-circle text-[6px] text-sky-400 mr-1 align-middle" />情境 {hasSituation ? 1 : 0}／1</span>}
              <span><i className="fas fa-circle text-[6px] text-indigo-500 mr-1 align-middle" />人物 {personRefs.length}／{REF_BUDGET.character}</span>
              <span><i className="fas fa-circle text-[6px] text-fuchsia-400 mr-1 align-middle" />服裝 {costumeImage ? 1 : 0}／1</span>
              <span><i className="fas fa-circle text-[6px] text-amber-400 mr-1 align-middle" />姿勢 {anyPoseRef ? 1 : 0}／1</span>
            </p>
          </div>
        )}

        {/* ── 規劃：所有步驟走完才出現 ── */}
        <div className={`mt-4 space-y-2 ${reached >= steps.length || plan ? "" : "hidden"}`} data-testid="plan-section">
          {isSheet && (
            <button onClick={() => planMutation.mutate("preset")} disabled={!inputsReady || busy} className="w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-photoset-preset">
              使用標準九宮格（立即產生）
            </button>
          )}
          <button onClick={() => planMutation.mutate("ai")} disabled={!inputsReady || busy}
            className={`w-full h-12 rounded-xl text-sm font-semibold disabled:opacity-40 ${isSheet ? "border border-slate-300 bg-white text-slate-800" : "bg-indigo-600 text-white shadow-glow"}`} data-testid="button-photoset-plan">
            {planMutation.isPending ? "AI 規劃中…" : plan ? "重新規劃鏡頭" : isSheet ? "請 AI 依角色規劃（免費）" : `規劃 ${count} 個鏡頭（免費）`}
          </button>
          {!inputsReady && (
            <p className="text-[11px] text-slate-400 text-center">
              {mode === "scene" ? (sceneText.trim() ? "只寫文字時，請再放一張人物照或選一個角色。" : "請先完成第 1 步：輸入場景或放一張照片。") : "請先完成第 1 步：選擇人物。"}
            </p>
          )}
        </div>

        {/* ── 鏡頭清單 ── */}
        <div ref={resultRef} className="scroll-mt-20 mt-5 space-y-5">
          {plan && (
            <div className="bg-white border border-indigo-100 rounded-3xl p-4 sm:p-5 space-y-4">
              {plan.analysis && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-slate-600 mb-1">規劃說明</p>
                  <p className="text-sm text-slate-700 leading-relaxed">{plan.analysis}</p>
                </div>
              )}
              {!isSheet && (
                <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                  <p className="text-xs font-semibold text-slate-600">服裝 <span className="font-normal text-slate-400">可以隨時更換，不用重新規劃</span></p>
                  {costumeSlot}
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">鏡頭清單（{shots.length} 張，可修改）</p>
                <button onClick={addShot} disabled={shots.length >= MAX_SHOTS || busy} className="text-xs text-indigo-600 hover:underline disabled:opacity-40">＋ 加一個鏡頭</button>
              </div>
              <input ref={poseRefInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => handlePoseRefFile(e.target.files?.[0])} data-testid="input-photoset-pose-ref" />

              <div className="space-y-3">
                {shots.map((shot, idx) => (
                  <div key={idx} className="border border-slate-200 rounded-2xl p-3 space-y-2" data-testid={`card-shot-${idx}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                      <input value={shot.title} onChange={(e) => updateShot(idx, { title: e.target.value.slice(0, 30) })} disabled={busy}
                        className="flex-1 min-w-0 text-sm font-semibold text-slate-900 bg-transparent border-b border-transparent focus:border-indigo-500 focus:outline-none" />
                      <button onClick={() => removeShot(idx)} disabled={shots.length <= MIN_SHOTS || busy} className="text-xs text-red-500 hover:underline disabled:opacity-30">移除</button>
                    </div>
                    <textarea value={shot.prompt} onChange={(e) => updateShot(idx, { prompt: e.target.value })} disabled={busy} rows={3} placeholder="描述這張的景別、角度、姿勢、表情與光線"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm leading-relaxed focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50" />
                    {!isSheet && (
                      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs">
                        {shot.poseRef && <img src={shot.poseRef} alt="姿勢參考" className="w-9 h-11 rounded-md object-contain border border-slate-200 bg-slate-50" />}
                        <span className="text-slate-500">{shot.poseRef ? "指定姿勢" : "姿勢：AI 依情境安排"}</span>
                        <button onClick={() => setPicker({ library: "pose", purpose: "shotPose", idx })} disabled={busy} className="text-indigo-600 hover:underline disabled:opacity-40" data-testid={`button-shot-pose-library-${idx}`}>{shot.poseRef ? "換姿勢" : "從圖庫指定"}</button>
                        <button onClick={() => { setPoseRefTarget(idx); poseRefInputRef.current?.click(); }} disabled={busy} className="text-indigo-600 hover:underline disabled:opacity-40">上傳</button>
                        <button onClick={() => setVaultTarget({ purpose: "shotPose", idx })} disabled={busy} className="text-indigo-600 hover:underline disabled:opacity-40">從作品選</button>
                        {shot.poseRef && <button onClick={() => updateShot(idx, { poseRef: undefined })} disabled={busy} className="text-slate-500 hover:underline disabled:opacity-40">交還 AI</button>}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between flex-wrap gap-2 pt-3 border-t border-slate-200 text-sm text-slate-600">
                <span>{removeWatermark ? "已去除浮水印" : "含浮水印"}（可在「張數{isSheet ? "" : "與輸出"}」步驟更改）</span>
                <span>共 <b className="text-slate-900">{validShots.length}</b> 張 × {perImage} ＝ <b className="text-indigo-700">{totalCost} 積分</b><span className="text-xs text-slate-400 ml-2">（餘額 {credits.toLocaleString()}）</span></span>
              </div>
              {credits < totalCost && <p className="text-xs text-red-500">積分不足，請先 <Link href="/store"><span className="underline cursor-pointer">加購積分</span></Link> 或減少張數。</p>}
              {validShots.length < MIN_SHOTS && <p className="text-xs text-red-500">至少需要 {MIN_SHOTS} 個有內容的鏡頭。</p>}

              <button onClick={() => generateMutation.mutate()} disabled={!canGenerate} className="w-full h-12 rounded-xl bg-indigo-600 text-white text-sm font-semibold shadow-glow disabled:opacity-40 disabled:shadow-none" data-testid="button-photoset-generate">
                {isGenerating ? `生成中… ${batch ? `${batch.completedCount + batch.failedCount}/${batch.totalCount}` : ""}` : batchDone ? `再生成一組（${totalCost} 積分）` : `生成整組（${totalCost} 積分）`}
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
                  {batchDone && batch.completedCount > 0 && <Link href="/vault"><span className="px-3 h-9 flex items-center rounded-lg border border-slate-200 text-xs text-slate-600 hover:border-indigo-300 cursor-pointer">到作品庫看</span></Link>}
                  {character && savableUrls.length > 0 && (
                    <button onClick={() => saveToPackMutation.mutate(savableUrls)} disabled={saveToPackMutation.isPending || savableUrls.every(isSaved) || packRoom <= 0}
                      className="px-3 h-9 rounded-lg bg-indigo-600 text-white text-xs font-semibold disabled:opacity-40" data-testid="button-photoset-save-all">
                      {savableUrls.every(isSaved) ? "✓ 已全部加入圖庫" : `全部加入「${character.name}」圖庫`}
                    </button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3">
                {batch.generations.map((g, idx) => {
                  const url = imageOf(g);
                  const packable = !!character && !!g.bunnyImageUrl;
                  return (
                    <div key={g.id} className="relative rounded-xl overflow-hidden bg-slate-100 border border-slate-200" style={{ aspectRatio: ratio.id.replace(":", " / ") }} data-testid={`card-result-${idx}`}>
                      {g.status === "completed" && url ? (
                        <SensitiveGate on={g.sensitive}>
                          <img src={url} alt={`成果 ${idx + 1}`} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setLightbox(url)} />
                          <div className="absolute bottom-2 right-2 flex gap-1.5">
                            {packable && (
                              <button onClick={() => saveToPackMutation.mutate([g.bunnyImageUrl as string])} disabled={saveToPackMutation.isPending || isSaved(g.bunnyImageUrl as string) || packRoom <= 0}
                                className="h-8 px-2 rounded-full bg-black/60 text-white text-[11px] hover:bg-black/80 disabled:opacity-70" title="加入角色圖庫">
                                {isSaved(g.bunnyImageUrl as string) ? "✓ 已加入" : "＋圖庫"}
                              </button>
                            )}
                            <Link href={`/edit?image=${encodeURIComponent(url)}`}><span className="h-8 px-2 rounded-full bg-black/60 text-white text-[11px] flex items-center hover:bg-black/80 cursor-pointer" title="到編輯器修改這張圖">編輯</span></Link>
                            <a href={url} download={`photoset-${idx + 1}.jpg`} target="_blank" rel="noreferrer" className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80" title="下載"><i className="fas fa-download text-xs" /></a>
                          </div>
                        </SensitiveGate>
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

      {picker && <LibraryPicker library={picker.library} onConfirm={onPicked} onClose={() => setPicker(null)} />}
      {showStoreNudge && (
        <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-end md:items-center justify-center md:p-4" onClick={() => setShowStoreNudge(false)}>
          <div className="bg-white w-full md:max-w-md rounded-t-3xl md:rounded-3xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid="dialog-store-nudge">
            <h3 className="text-lg font-bold text-slate-900"><i className="fas fa-champagne-glasses text-fuchsia-500 mr-2" />你的寫真完成了</h3>
            <p className="text-sm text-slate-600 mt-2">
              目前剩 <b className="text-slate-900">{credits.toLocaleString()}</b> 積分{credits < IMAGE_COST ? "，不夠再做一張了" : `，還能做 ${Math.floor(credits / IMAGE_COST)} 張`}。
              {isMember ? "加購積分就能繼續做下一組。" : "換一套服裝、換一個場景，再做一組？"}
            </p>
            {!isMember && (
              <ul className="mt-3 space-y-2">
                {!user?.trialUsedAt && (
                  <li className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-3 text-sm">
                    <span><b className="text-slate-900">小試身手</b><span className="block text-xs text-slate-500">{TRIAL.credits} 積分，約 {Math.floor(TRIAL.credits / IMAGE_COST)} 張</span></span>
                    <b className="text-slate-900">US${TRIAL.priceUsd}</b>
                  </li>
                )}
                <li className="flex items-center justify-between gap-3 rounded-2xl border-2 border-indigo-400 bg-indigo-50 p-3 text-sm">
                  <span><b className="text-slate-900">正式會員</b><span className="ml-2 px-1.5 py-0.5 rounded bg-fuchsia-500 text-white text-[10px] font-bold align-middle">最划算</span><span className="block text-xs text-slate-500">{MEMBERSHIP.credits} 積分，約 {Math.floor(MEMBERSHIP.credits / IMAGE_COST)} 張</span></span>
                  <b className="text-slate-900">US${MEMBERSHIP.priceUsd}</b>
                </li>
              </ul>
            )}
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={() => setShowStoreNudge(false)} className="h-11 rounded-xl border border-slate-200 text-sm text-slate-600" data-testid="button-store-nudge-later">先看作品</button>
              <Link href="/store">
                <span className="h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold flex items-center justify-center cursor-pointer" data-testid="button-store-nudge-go">
                  前往會員商城<i className="fas fa-arrow-right ml-2 text-xs" />
                </span>
              </Link>
            </div>
          </div>
        </div>
      )}
      {showWizard && <CharacterWizard onClose={() => setShowWizard(false)} onCreated={(id) => { setPortrait(undefined); setCharacterId(id); }} />}
      {vaultTarget && <VaultPicker onPick={onVaultPicked} onClose={() => setVaultTarget(null)} />}
      {showCollage && <ReferenceCollage tiles={collageTiles} onClose={() => setShowCollage(false)} />}
      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="預覽" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}

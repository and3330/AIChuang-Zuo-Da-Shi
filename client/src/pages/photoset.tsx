import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/App";
import { NavigationHeader } from "./account";
import { CHARACTER_PACK_MAX_IMAGES, type CharacterLibraryItem, type ImageGeneration } from "@shared/schema";
import { IMAGE_RATIOS, IMAGE_TIERS, imageSizeFor, type ImageRatioId, type ImageTierId } from "@shared/imageSizes";
import { RECIPE_SLOTS, loadRecipe, type Recipe } from "@/lib/recipe";
import { PHOTO_LOOKS, POSES, POSE_CATEGORIES, photoLookSuffix, poseById, poseRefNote, poseShotPrompt, referenceNote, type PhotoLookId } from "@shared/photosetOptions";

// 寫真套圖 / 角色九宮格
//
// 情境寫真：情境圖決定場景與氛圍；角色參考圖（角色庫的角色＋臨時上傳）決定
//           畫面裡是誰。沒有參考圖時，沿用情境圖裡的人物。
// 角色九宮格：不需要情境圖，用角色參考圖生成一組定裝圖（視角／表情／姿勢），
//           成果可以一鍵存回角色圖庫，之後直接拿來當參考。
//
// 兩種模式的生成都走既有的批次端點 (/api/image-generations + prompts)，
// 所以扣點、失敗退點、CDN 轉存都與首頁的批次編輯一致。

type Mode = "scene" | "character";
/** poseRef: optional pose reference image for this shot only (object path). */
type Shot = { title: string; prompt: string; poseRef?: string };
type Plan = { analysis: string; shots: Shot[] };
type BatchStatus = {
  batchId: string;
  generations: ImageGeneration[];
  totalCount: number;
  completedCount: number;
  failedCount: number;
};

const MIN_SHOTS = 2;
const MAX_SHOTS = 10;
/** The image model takes 10 images; one slot is kept for the 情境圖. */
const MAX_REFS = 9;
const COUNT_OPTIONS: Record<Mode, number[]> = { scene: [4, 6, 9], character: [4, 6, 9] };
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** The original pose gallery by ギア. Free to use one image at a time as a
 *  generation reference (commercial work included); bulk download and
 *  re-hosting are not allowed, so we link out instead of mirroring it. */
const POSE_GALLERY_URL = "https://ai-pose-gallery.pages.dev/";

async function uploadToObjectStorage(file: File): Promise<string> {
  const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
  const { uploadURL } = await uploadRes.json();
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
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

/** Art-direction text for the costume and pose picked in the asset library. */
function recipeDirection(recipe: Recipe): string {
  const parts: string[] = [];
  if (recipe.costume) parts.push(`服裝：讓人物穿上這套穿搭——${recipe.costume.usage}`);
  if (recipe.pose) parts.push(`姿勢：每一張都以這個姿勢為主——${recipe.pose.usage}`);
  return parts.join("。").slice(0, 500);
}

export default function PhotosetPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const situationInputRef = useRef<HTMLInputElement>(null);
  const poseRefInputRef = useRef<HTMLInputElement>(null);
  const [poseRefTarget, setPoseRefTarget] = useState<number | null>(null);
  const refInputRef = useRef<HTMLInputElement>(null);

  // Deep link from the character library: /photoset?mode=character&character=<id>
  const initial = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    // Arriving from the asset library with a recipe (/photoset?recipe=1).
    const recipe: Recipe = q.get("recipe") === "1" ? loadRecipe() : {};
    // A recipe with a face needs no 情境圖, so start in the mode that doesn't ask for one.
    const wantsCharacter = q.get("mode") === "character" || (q.get("mode") !== "scene" && !!recipe.portrait?.imageUrl);
    return {
      mode: (wantsCharacter ? "character" : "scene") as Mode,
      characterId: q.get("character") || "",
      recipe,
    };
  }, []);

  const [mode, setMode] = useState<Mode>(initial.mode);
  const [situationPath, setSituationPath] = useState("");
  const [characterId, setCharacterId] = useState(initial.characterId);
  const [recipe, setRecipe] = useState<Recipe>(initial.recipe);
  // The recipe's face goes in as a reference image; costume and pose as text.
  const [extraRefs, setExtraRefs] = useState<string[]>(() => (initial.recipe.portrait?.imageUrl ? [initial.recipe.portrait.imageUrl] : []));
  const [outfitFrom, setOutfitFrom] = useState<"character" | "scene">("character");
  const [uploading, setUploading] = useState<"" | "situation" | "refs">("");
  const [count, setCount] = useState(Object.keys(initial.recipe).length > 0 ? 4 : initial.mode === "character" ? 9 : 6);
  const [ratioId, setRatioId] = useState<ImageRatioId>("3:4");
  const [tierId, setTierId] = useState<ImageTierId>("2k");
  const [lookId, setLookId] = useState<PhotoLookId>("natural");
  const [poseIds, setPoseIds] = useState<string[]>([]);
  const [poseCategory, setPoseCategory] = useState<string>(POSE_CATEGORIES[0]);
  const [showPoses, setShowPoses] = useState(false);
  const [direction, setDirection] = useState(() => recipeDirection(initial.recipe));
  const [watermark, setWatermark] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [batchId, setBatchId] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [savedUrls, setSavedUrls] = useState<string[]>([]);

  const { data: characters = [] } = useQuery<CharacterLibraryItem[]>({
    queryKey: ["/api/character-library"],
  });
  const character = characters.find(c => c.id === characterId) ?? null;
  const characterRefs = character?.refImageUrls ?? [];

  // Reference images actually sent: the character's pack first, then ad-hoc
  // uploads, capped at what the model accepts.
  const allRefs = useMemo(
    () => [...characterRefs, ...extraRefs].slice(0, MAX_REFS),
    [characterRefs, extraRefs],
  );
  const droppedRefs = characterRefs.length + extraRefs.length - allRefs.length;

  const ratio = IMAGE_RATIOS.find(r => r.id === ratioId) ?? IMAGE_RATIOS[0];
  const outputSize = imageSizeFor(ratioId, tierId);
  const shots = plan?.shots ?? [];
  const validShots = shots.filter(s => s.prompt.trim().length > 0);
  const perImage = watermark ? 3 : 8;
  const totalCost = validShots.length * perImage;
  const credits = user?.credits ?? 0;

  const anyPoseRef = validShots.some(s => !!s.poseRef);
  // The model takes 10 images. A shot's pose reference needs one slot, so the
  // shared references are trimmed to 8 when any shot has one.
  const refsToSend = anyPoseRef ? allRefs.slice(0, MAX_REFS - 1) : allRefs;

  const hasRecipe = Object.keys(recipe).length > 0;

  const inputsReady = mode === "scene" ? !!situationPath : allRefs.length > 0;

  // Any change to what the shots are based on makes the current plan stale.
  const resetPlan = () => { setPlan(null); setBatchId(""); setSavedUrls([]); };
  useEffect(() => { resetPlan(); }, [mode, characterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearRecipe = () => {
    const face = recipe.portrait?.imageUrl;
    if (face) setExtraRefs(prev => prev.filter(u => u !== face));
    if (direction === recipeDirection(recipe)) setDirection("");
    setRecipe({});
    resetPlan();
  };

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setCount(m === "character" ? 9 : 6);
  };

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
    const room = MAX_REFS - characterRefs.length - extraRefs.length;
    if (room <= 0) {
      toast({ title: "參考圖已達上限", description: `一次最多使用 ${MAX_REFS} 張參考圖。`, variant: "destructive" });
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
      const res = await apiRequest("POST", "/api/photosets/plan", {
        mode,
        planner,
        situationImageUrl: mode === "scene" ? situationPath : undefined,
        referenceImageUrls: allRefs,
        characterName: character?.name,
        characterDescription: character?.description || undefined,
        outfitFrom,
        // With a library recipe the goal is photos of the character, not a turnaround sheet.
        characterGoal: hasRecipe ? "shoot" : "sheet",
        count,
        poseIds: planner === "ai" ? poseIds : [],
        look: lookId,
        direction: direction.trim() || undefined,
        aspectRatio: ratio.id,
      });
      return res.json();
    },
    onSuccess: (data) => {
      const poseImage = recipe.pose?.imageUrl;
      setPlan(poseImage ? { ...data, shots: data.shots.map(s => ({ ...s, poseRef: poseImage })) } : data);
      setBatchId(""); setSavedUrls([]);
    },
    onError: (e) => toast({ title: "規劃失敗", description: errorText(e), variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const note = referenceNote(mode, refsToSend.length, outfitFrom, !recipe.costume);
      // Image order must match referenceNote(): 情境圖 first in scene mode,
      // then the shared references, then that shot's own pose reference.
      const [first, ...rest] = mode === "scene" ? [situationPath, ...refsToSend] : refsToSend;
      const poseImageNumber = 1 + rest.length + 1;
      const res = await apiRequest("POST", "/api/image-generations", {
        type: "image-to-image",
        originalImageUrl: first,
        additionalImageUrls: rest.length > 0 ? rest : undefined,
        // Each prompt = the shot + what each input image is for + the look.
        prompts: validShots.map(s =>
          `${s.prompt.trim()}${note}${s.poseRef ? poseRefNote(poseImageNumber) : ""}${photoLookSuffix(lookId)}`),
        promptImageUrls: anyPoseRef ? validShots.map(s => s.poseRef ?? null) : undefined,
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
      await apiRequest("PATCH", `/api/character-library/${character.id}`, {
        refImageUrls: [...characterRefs, ...fresh],
      });
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
  const handlePoseRefFile = async (file: File | undefined) => {
    const idx = poseRefTarget;
    if (!file || idx === null) return;
    const problem = checkImageFile(file);
    if (problem) { toast({ title: "無法使用這個檔案", description: problem, variant: "destructive" }); return; }
    try {
      const path = await uploadToObjectStorage(file);
      updateShot(idx, { poseRef: path });
    } catch (e) {
      toast({ title: "上傳失敗", description: errorText(e), variant: "destructive" });
    } finally {
      setPoseRefTarget(null);
      if (poseRefInputRef.current) poseRefInputRef.current.value = "";
    }
  };

  const togglePose = (id: string) => {
    setPoseIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= MAX_SHOTS ? prev : [...prev, id]);
  };
  /** Add a library pose to the current plan as a ready-made shot (no AI). */
  const addPoseShot = (id: string) => {
    const pose = poseById(id);
    if (!pose) return;
    setPlan(p => p && p.shots.length < MAX_SHOTS
      ? { ...p, shots: [...p.shots, { title: pose.name, prompt: poseShotPrompt(pose) }] }
      : p);
  };
  const addShot = () => {
    setPlan(p => p && p.shots.length < MAX_SHOTS
      ? { ...p, shots: [...p.shots, { title: `鏡頭 ${p.shots.length + 1}`, prompt: "" }] }
      : p);
  };

  const canGenerate =
    inputsReady && validShots.length >= MIN_SHOTS && validShots.length <= MAX_SHOTS &&
    credits >= totalCost && !busy;

  const imageOf = (g: ImageGeneration) => g.bunnyImageUrl || g.generatedImageUrl || "";
  const isSaved = (url: string) => savedUrls.includes(url) || characterRefs.includes(url);

  const selectBtn = (active: boolean) =>
    `rounded-lg border transition-colors ${active ? "border-[#6366f1] bg-[#6366f1]/10" : "border-[#e2e8f0] hover:border-[#6366f1]/40"}`;

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-24">
      <NavigationHeader />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-[#0f172a]">📸 寫真套圖</h1>
            <Link href="/library"><span className="text-sm text-[#6366f1] hover:underline cursor-pointer">🗂 瀏覽素材圖庫（姿勢／服裝／人像）→</span></Link>
          </div>
          <p className="text-sm text-[#64748b] mt-1">
            用情境圖決定場景與氛圍、用角色參考圖決定畫面裡是誰，一次生成整組可貼上社群的套圖；也可以先替角色生成九宮格定裝圖，存進角色圖庫重複使用。
          </p>
        </div>

        {hasRecipe && (
          <div className="mb-5 bg-[#6366f1]/5 border border-[#6366f1]/30 rounded-2xl p-3 flex items-center gap-3 flex-wrap" data-testid="banner-recipe">
            <span className="text-sm font-semibold text-[#4f46e5]">已套用圖庫配方</span>
            {RECIPE_SLOTS.filter(slot => !!recipe[slot.id]).map(slot => (
              <span key={slot.id} className="inline-flex items-center gap-2 bg-white border border-[#e2e8f0] rounded-xl pl-1 pr-2 py-1">
                <img src={recipe[slot.id]!.thumbUrl || recipe[slot.id]!.imageUrl || ""} alt="" className="w-8 h-8 rounded-md object-contain bg-[#f8fafc]" />
                <span className="text-xs text-[#0f172a]"><span className="text-[#94a3b8]">{slot.label}：</span>{recipe[slot.id]!.name}</span>
              </span>
            ))}
            <span className="text-[11px] text-[#64748b] flex-1 min-w-[200px]">
              人像已放進參考圖；服裝與姿勢已寫進「風格方向」{recipe.pose ? "，規劃後每個鏡頭會自動附上姿勢參考圖" : ""}。直接按下方的規劃即可，也可以再上傳情境圖改用情境寫真。
            </span>
            <Link href="/library"><span className="text-xs text-[#6366f1] hover:underline cursor-pointer">回圖庫調整</span></Link>
            <button onClick={clearRecipe} disabled={busy} className="text-xs text-[#94a3b8] hover:text-[#ef4444] disabled:opacity-40">清除配方</button>
          </div>
        )}

        {/* ── 模式 ─────────────────────────────────────────── */}
        <div className="grid sm:grid-cols-2 gap-3 mb-6">
          <button onClick={() => switchMode("scene")} disabled={busy} className={`p-4 text-left ${selectBtn(mode === "scene")}`} data-testid="button-mode-scene">
            <div className="text-sm font-semibold text-[#0f172a]">📸 情境寫真</div>
            <div className="text-xs text-[#64748b] mt-1">上傳情境圖，AI 分析後規劃一組不同景別與姿勢的寫真。可指定角色，讓同一個人出現在這個情境裡。</div>
          </button>
          <button onClick={() => switchMode("character")} disabled={busy} className={`p-4 text-left ${selectBtn(mode === "character")}`} data-testid="button-mode-character">
            <div className="text-sm font-semibold text-[#0f172a]">🧩 角色九宮格</div>
            <div className="text-xs text-[#64748b] mt-1">不需要情境圖。用角色參考圖生成正面、側面、背面、各種表情與姿勢的定裝圖，把角色完整建立起來。</div>
          </button>
        </div>

        <div className="grid lg:grid-cols-[380px_1fr] gap-6 items-start">
          {/* ── 左：素材與設定 ─────────────────────────────── */}
          <div className="bg-white border border-[#e2e8f0] rounded-2xl p-5 space-y-5">
            {mode === "scene" && (
              <div>
                <p className="text-sm font-semibold text-[#0f172a] mb-2">① 情境圖 <span className="text-xs font-normal text-[#94a3b8]">決定場景、光線與氛圍</span></p>
                <input ref={situationInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={(e) => handleSituationFile(e.target.files?.[0])} data-testid="input-photoset-situation" />
                {situationPath ? (
                  <div className="space-y-2">
                    <img src={situationPath} alt="情境圖" className="w-full max-h-72 object-contain rounded-xl bg-[#f1f5f9]" />
                    <button onClick={() => situationInputRef.current?.click()} disabled={!!uploading || busy}
                      className="text-xs text-[#6366f1] hover:underline disabled:opacity-50">
                      {uploading === "situation" ? "上傳中…" : "更換情境圖"}
                    </button>
                  </div>
                ) : (
                  <button onClick={() => situationInputRef.current?.click()} disabled={!!uploading}
                    className="w-full h-40 border-2 border-dashed border-[#cbd5e1] rounded-xl flex flex-col items-center justify-center gap-2 text-[#64748b] hover:border-[#6366f1] hover:text-[#6366f1] transition-colors disabled:opacity-50"
                    data-testid="button-photoset-upload-situation">
                    <i className="fas fa-cloud-upload-alt text-2xl" />
                    <span className="text-sm">{uploading === "situation" ? "上傳中…" : "點擊上傳情境圖"}</span>
                    <span className="text-[11px] text-[#94a3b8]">JPG／PNG／WEBP，20MB 以內</span>
                  </button>
                )}
              </div>
            )}

            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">
                {mode === "scene" ? "② 角色／人物參考圖" : "① 角色參考圖"}{" "}
                <span className="text-xs font-normal text-[#94a3b8]">{mode === "scene" ? "選填，決定畫面裡是誰" : "必填，至少 1 張"}</span>
              </p>

              <label className="text-xs text-[#64748b] block mb-1">從角色庫選擇</label>
              <div className="flex gap-2">
                <select value={characterId} onChange={(e) => setCharacterId(e.target.value)} disabled={busy}
                  className="flex-1 min-w-0 px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm bg-white" data-testid="select-photoset-character">
                  <option value="">{mode === "scene" ? "不指定角色（沿用情境圖中的人物）" : "不使用角色庫（只用下方上傳的圖）"}</option>
                  {characters.map(c => (
                    <option key={c.id} value={c.id}>{c.name}（圖庫 {c.refImageUrls?.length ?? 0} 張）</option>
                  ))}
                </select>
                <Link href="/character-library">
                  <span className="shrink-0 px-3 py-2 border border-[#e2e8f0] rounded-lg text-xs text-[#475569] hover:border-[#6366f1] hover:text-[#4f46e5] cursor-pointer whitespace-nowrap">管理角色</span>
                </Link>
              </div>
              {character && characterRefs.length === 0 && (
                <p className="text-xs text-[#ef4444] mt-1">這個角色的圖庫還沒有圖片，請到角色庫上傳，或在下方直接上傳參考圖。</p>
              )}

              <input ref={refInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden"
                onChange={(e) => handleRefFiles(e.target.files)} data-testid="input-photoset-refs" />
              <div className="flex flex-wrap gap-2 mt-3">
                {characterRefs.slice(0, MAX_REFS).map((url, i) => (
                  <div key={`c-${i}`} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#6366f1]/40 bg-[#f8fafc]" title="來自角色圖庫">
                    <img src={url} alt={`角色圖 ${i + 1}`} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 bg-[#6366f1]/80 text-white text-[9px] text-center">圖庫</span>
                  </div>
                ))}
                {extraRefs.map((url, i) => (
                  <div key={`x-${i}`} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#cbd5e1] bg-[#f8fafc] group">
                    <img src={url} alt={`參考圖 ${i + 1}`} className="w-full h-full object-cover" />
                    <button onClick={() => { setExtraRefs(prev => prev.filter((_, idx) => idx !== i)); resetPlan(); }} disabled={busy}
                      className="absolute top-0 right-0 w-5 h-5 bg-[#ef4444] text-white text-xs rounded-bl-lg flex items-center justify-center" title="移除">×</button>
                  </div>
                ))}
                {characterRefs.length + extraRefs.length < MAX_REFS && (
                  <button onClick={() => refInputRef.current?.click()} disabled={!!uploading || busy}
                    className="w-16 h-16 rounded-lg border-2 border-dashed border-[#cbd5e1] flex flex-col items-center justify-center text-[#94a3b8] hover:border-[#6366f1] hover:text-[#6366f1] transition-colors disabled:opacity-50"
                    data-testid="button-photoset-upload-refs">
                    {uploading === "refs" ? <span className="text-xs">…</span> : <><span className="text-xl leading-none">+</span><span className="text-[9px]">上傳</span></>}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-[#94a3b8] mt-2">
                本次使用 {allRefs.length}／{MAX_REFS} 張參考圖。
                {droppedRefs > 0 && ` 角色圖庫超過上限，只取前 ${MAX_REFS} 張。`}
                {" "}臉部清楚的正面照效果最好；這裡上傳的圖只用在這一次，要長期保存請加到角色庫。
              </p>

              {mode === "scene" && allRefs.length > 0 && (
                <div className="mt-3">
                  <label className="text-xs text-[#64748b] block mb-1">服裝來源</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setOutfitFrom("character"); resetPlan(); }} disabled={busy}
                      className={`py-2 text-sm ${selectBtn(outfitFrom === "character")}`}>沿用角色圖的服裝</button>
                    <button onClick={() => { setOutfitFrom("scene"); resetPlan(); }} disabled={busy}
                      className={`py-2 text-sm ${selectBtn(outfitFrom === "scene")}`}>換上情境圖的服裝</button>
                  </div>
                </div>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">{mode === "scene" ? "③" : "②"} 張數</p>
              <div className="flex gap-2">
                {COUNT_OPTIONS[mode].map(n => (
                  <button key={n} onClick={() => setCount(n)} disabled={busy}
                    className={`flex-1 py-2 text-sm font-medium ${selectBtn(count === n)} ${count === n ? "text-[#4f46e5]" : "text-[#475569]"}`}>
                    {n} 張{mode === "character" && n === 9 ? "（九宮格）" : ""}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">{mode === "scene" ? "④" : "③"} 比例</p>
              <div className="grid grid-cols-2 gap-2">
                {IMAGE_RATIOS.map(r => (
                  <button key={r.id} onClick={() => setRatioId(r.id)} disabled={busy} className={`p-2 text-left ${selectBtn(ratioId === r.id)}`}>
                    <div className="text-sm font-medium text-[#0f172a]">{r.label}</div>
                    <div className="text-[11px] text-[#64748b]">{r.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">{mode === "scene" ? "⑤" : "④"} 畫質</p>
              <div className="space-y-2">
                {IMAGE_TIERS.map(t => {
                  const [w, h] = ratio.sizes[t.id];
                  return (
                    <button key={t.id} onClick={() => setTierId(t.id)} disabled={busy}
                      className={`w-full p-2 text-left flex items-center justify-between gap-2 ${selectBtn(tierId === t.id)}`}
                      data-testid={`button-photoset-tier-${t.id}`}>
                      <span>
                        <span className="text-sm font-medium text-[#0f172a]">{t.label}</span>
                        <span className="block text-[11px] text-[#64748b]">{t.hint}</span>
                      </span>
                      <span className="text-xs font-mono text-[#475569] shrink-0">{w} × {h}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-[#94a3b8] mt-2">輸出尺寸：{outputSize.replace("x", " × ")} px。各畫質的積分相同。</p>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">{mode === "scene" ? "⑥" : "⑤"} 畫面質感</p>
              <div className="grid grid-cols-2 gap-2">
                {PHOTO_LOOKS.map(l => (
                  <button key={l.id} onClick={() => setLookId(l.id)} disabled={busy} className={`p-2 text-left ${selectBtn(lookId === l.id)}`} data-testid={`button-photoset-look-${l.id}`}>
                    <div className="text-sm font-medium text-[#0f172a]">{l.label}</div>
                    <div className="text-[11px] text-[#64748b]">{l.hint}</div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-[#94a3b8] mt-2">質感設定會附加在每一張的提示詞後面，可隨時更換，不需要重新規劃。想降低 AI 感請選「自然寫實」或「手機隨拍」，並搭配 2K 畫質。</p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-[#0f172a]">{mode === "scene" ? "⑦" : "⑥"} 指定姿勢 <span className="text-xs font-normal text-[#94a3b8]">選填</span></p>
                <button onClick={() => setShowPoses(v => !v)} className="text-xs text-[#6366f1] hover:underline" data-testid="button-photoset-toggle-poses">
                  {showPoses ? "收合" : poseIds.length > 0 ? `已選 ${poseIds.length} 個，展開修改` : "展開姿勢庫"}
                </button>
              </div>
              {poseIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {poseIds.map((id, i) => (
                    <span key={id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-[#6366f1]/10 text-[#4f46e5] text-xs">
                      {i + 1}. {poseById(id)?.name}
                      <button onClick={() => togglePose(id)} disabled={busy} className="w-4 h-4 rounded-full hover:bg-[#6366f1]/20" title="移除">×</button>
                    </span>
                  ))}
                  <button onClick={() => setPoseIds([])} disabled={busy} className="text-xs text-[#94a3b8] hover:text-[#ef4444] px-1">全部清除</button>
                </div>
              )}
              {showPoses && (
                <div className="border border-[#e2e8f0] rounded-xl p-2 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    {POSE_CATEGORIES.map(cat => (
                      <button key={cat} onClick={() => setPoseCategory(cat)}
                        className={`px-2 py-1 rounded-md text-xs ${poseCategory === cat ? "bg-[#0f172a] text-white" : "bg-[#f1f5f9] text-[#475569] hover:bg-[#e2e8f0]"}`}>
                        {cat}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
                    {POSES.filter(p => p.category === poseCategory).map(p => {
                      const picked = poseIds.includes(p.id);
                      return (
                        <button key={p.id} onClick={() => togglePose(p.id)} disabled={busy || (!picked && poseIds.length >= MAX_SHOTS)}
                          title={p.description}
                          className={`p-2 text-left ${selectBtn(picked)} disabled:opacity-40`} data-testid={`button-pose-${p.id}`}>
                          <div className="text-xs font-medium text-[#0f172a]">{picked ? "✓ " : ""}{p.name}</div>
                          <div className="text-[10px] text-[#94a3b8]">{p.framing}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-[#94a3b8] mt-2">
                {poseIds.length >= MIN_SHOTS
                  ? `AI 規劃時會依序為這 ${poseIds.length} 個姿勢各出一張（張數設定改以姿勢數為準）。`
                  : poseIds.length === 1
                    ? `請至少選 ${MIN_SHOTS} 個姿勢，或清除後改用張數。`
                    : `不選則由 AI 自行安排姿勢。最多可選 ${MAX_SHOTS} 個。`}
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">{mode === "scene" ? "⑧" : "⑦"} 風格方向（選填）</p>
              <textarea value={direction} onChange={(e) => setDirection(e.target.value.slice(0, 500))} rows={3} disabled={busy}
                placeholder={mode === "scene" ? "例如：日系清新、多一點臉部特寫、加入逆光與走動的抓拍感" : "例如：加入戰鬥姿勢、多一點情緒表情、換成白色背景"}
                className="w-full px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#6366f1] focus:border-transparent"
                data-testid="input-photoset-direction" />
            </div>

            <div className="space-y-2">
              <button onClick={() => planMutation.mutate("ai")} disabled={!inputsReady || busy || poseIds.length === 1}
                className="w-full py-2.5 rounded-xl bg-[#0f172a] text-white text-sm font-semibold hover:bg-[#1e293b] disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="button-photoset-plan">
                {planMutation.isPending ? "AI 分析規劃中…" : plan ? "重新請 AI 分析並規劃" : mode === "scene" ? "AI 分析情境圖並規劃鏡頭（免費）" : hasRecipe ? "依配方規劃寫真鏡頭（免費）" : "AI 分析角色並規劃定裝圖（免費）"}
              </button>
              {mode === "character" && !hasRecipe && (
                <button onClick={() => planMutation.mutate("preset")} disabled={!inputsReady || busy}
                  className="w-full py-2.5 rounded-xl border border-[#0f172a] text-[#0f172a] text-sm font-semibold hover:bg-[#f1f5f9] disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="button-photoset-preset">
                  使用標準九宮格（不經 AI，立即產生）
                </button>
              )}
              {!inputsReady && (
                <p className="text-[11px] text-[#94a3b8]">{mode === "scene" ? "請先上傳情境圖。" : "請先選擇有圖的角色，或上傳至少一張角色參考圖。"}</p>
              )}
            </div>
          </div>

          {/* ── 右：鏡頭規劃與成果 ─────────────────────────── */}
          <div className="space-y-6">
            {!plan && (
              <div className="bg-white border border-[#e2e8f0] rounded-2xl p-10 text-center text-[#94a3b8]">
                <i className="fas fa-images text-3xl mb-3" />
                <p className="text-sm">
                  {mode === "scene"
                    ? "上傳情境圖（可再指定角色），按下規劃後，這裡會出現整組鏡頭清單，可逐條修改後再生成。"
                    : "選擇角色或上傳參考圖，按下規劃後，這裡會出現九宮格的鏡頭清單，可逐條修改後再生成。"}
                </p>
              </div>
            )}

            {plan && (
              <div className="bg-white border border-[#e2e8f0] rounded-2xl p-5 space-y-4">
                {plan.analysis && (
                  <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-xl p-3">
                    <p className="text-xs font-semibold text-[#475569] mb-1">{mode === "scene" ? "AI 的分析" : "規劃說明"}</p>
                    <p className="text-sm text-[#334155] leading-relaxed">{plan.analysis}</p>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-[#0f172a]">鏡頭清單（{shots.length} 張，可修改）</p>
                  <div className="flex items-center gap-3">
                    <select value="" onChange={(e) => { if (e.target.value) addPoseShot(e.target.value); }} disabled={shots.length >= MAX_SHOTS || busy}
                      className="text-xs border border-[#e2e8f0] rounded-md px-1.5 py-1 text-[#475569] bg-white disabled:opacity-40" data-testid="select-add-pose-shot">
                      <option value="">＋ 從姿勢庫新增</option>
                      {POSE_CATEGORIES.map(cat => (
                        <optgroup key={cat} label={cat}>
                          {POSES.filter(p => p.category === cat).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <button onClick={addShot} disabled={shots.length >= MAX_SHOTS || busy} className="text-xs text-[#6366f1] hover:underline disabled:opacity-40">＋ 空白鏡頭</button>
                  </div>
                </div>

                <input ref={poseRefInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={(e) => handlePoseRefFile(e.target.files?.[0])} data-testid="input-photoset-pose-ref" />
                <div className="text-xs text-[#475569] bg-[#f8fafc] border border-[#e2e8f0] rounded-xl p-3 leading-relaxed">
                  想更精準控制姿勢，可以替個別鏡頭附上一張<b>姿勢參考圖</b>（素體人偶、線稿或照片皆可），模型會模仿它的身體姿態與視角。
                  需要素材可到{" "}
                  <a href={POSE_GALLERY_URL} target="_blank" rel="noreferrer" className="text-[#4f46e5] underline">ギア 的姿勢圖庫</a>
                  {" "}挑選後下載，再回來上傳。該圖庫可免費用於創作（含商用），但請一次取用一張，不要批次下載或轉載圖片本身。
                  {anyPoseRef && allRefs.length > refsToSend.length && " 有鏡頭附了姿勢參考圖，本次角色參考圖會取前 8 張。"}
                </div>

                <div className="space-y-3">
                  {shots.map((shot, idx) => (
                    <div key={idx} className="border border-[#e2e8f0] rounded-xl p-3 space-y-2" data-testid={`card-shot-${idx}`}>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-[#6366f1]/10 text-[#4f46e5] text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                        <input value={shot.title} onChange={(e) => updateShot(idx, { title: e.target.value.slice(0, 30) })} disabled={busy}
                          className="flex-1 min-w-0 text-sm font-semibold text-[#0f172a] bg-transparent border-b border-transparent focus:border-[#6366f1] focus:outline-none" />
                        <button onClick={() => removeShot(idx)} disabled={shots.length <= MIN_SHOTS || busy} className="text-xs text-[#ef4444] hover:underline disabled:opacity-30">移除</button>
                      </div>
                      <textarea value={shot.prompt} onChange={(e) => updateShot(idx, { prompt: e.target.value })} disabled={busy} rows={3}
                        placeholder="描述這張的景別、角度、姿勢、表情與光線"
                        className="w-full px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm leading-relaxed focus:ring-2 focus:ring-[#6366f1] focus:border-transparent disabled:bg-[#f8fafc]" />
                      <div className="flex items-center gap-2">
                        {shot.poseRef ? (
                          <>
                            <img src={shot.poseRef} alt="姿勢參考" className="w-12 h-12 rounded-md object-cover border border-[#cbd5e1] bg-[#f8fafc]" />
                            <span className="text-xs text-[#475569]">已附姿勢參考圖</span>
                            <button onClick={() => updateShot(idx, { poseRef: undefined })} disabled={busy} className="text-xs text-[#ef4444] hover:underline disabled:opacity-40">移除</button>
                          </>
                        ) : (
                          <button onClick={() => { setPoseRefTarget(idx); poseRefInputRef.current?.click(); }} disabled={busy}
                            className="text-xs text-[#6366f1] hover:underline disabled:opacity-40" data-testid={`button-shot-pose-ref-${idx}`}>
                            {poseRefTarget === idx ? "上傳中…" : "＋ 附上姿勢參考圖（選填）"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-[#e2e8f0]">
                  <label className="flex items-center gap-2 text-sm text-[#475569] cursor-pointer">
                    <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} disabled={busy} className="accent-[#6366f1]" />
                    加上浮水印（3 積分／張；取消為 8 積分／張）
                  </label>
                  <div className="text-sm text-[#475569]">
                    共 <b className="text-[#0f172a]">{validShots.length}</b> 張 × {perImage} ＝ <b className="text-[#4f46e5]">{totalCost} 積分</b>
                    <span className="text-xs text-[#94a3b8] ml-2">（餘額 {credits}）</span>
                  </div>
                </div>

                {mode === "character" && watermark && (
                  <p className="text-xs text-[#a16207] bg-[#fefce8] border border-[#fde68a] rounded-lg px-3 py-2">
                    要把成果存進角色圖庫當參考圖時，建議取消浮水印，否則浮水印可能被帶進之後生成的圖。
                  </p>
                )}
                {credits < totalCost && <p className="text-xs text-[#ef4444]">積分不足，請先儲值或減少張數。</p>}
                {validShots.length < MIN_SHOTS && <p className="text-xs text-[#ef4444]">至少需要 {MIN_SHOTS} 個有內容的鏡頭。</p>}

                <button onClick={() => generateMutation.mutate()} disabled={!canGenerate}
                  className="w-full py-3 rounded-xl bg-[#6366f1] text-white text-sm font-semibold hover:bg-[#4f46e5] disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="button-photoset-generate">
                  {isGenerating
                    ? `生成中… ${batch ? `${batch.completedCount + batch.failedCount}/${batch.totalCount}` : ""}`
                    : batchDone ? `再生成一組（${totalCost} 積分）` : `生成整組（${totalCost} 積分）`}
                </button>
                <p className="text-[11px] text-[#94a3b8]">每張約需 1–3 分鐘，整組同時生成；失敗的張數會自動退還積分。每日圖片上限 50 張。</p>
              </div>
            )}

            {batch && (
              <div className="bg-white border border-[#e2e8f0] rounded-2xl p-5">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0f172a]">成果</p>
                    <p className="text-xs text-[#64748b]">
                      完成 {batch.completedCount}／{batch.totalCount}
                      {batch.failedCount > 0 && <span className="text-[#ef4444]">，失敗 {batch.failedCount}（已退點）</span>}
                    </p>
                  </div>
                  {character && savableUrls.length > 0 && (
                    <button onClick={() => saveToPackMutation.mutate(savableUrls)}
                      disabled={saveToPackMutation.isPending || savableUrls.every(isSaved) || packRoom <= 0}
                      className="px-3 py-2 rounded-lg bg-[#0f172a] text-white text-xs font-semibold hover:bg-[#1e293b] disabled:opacity-40"
                      data-testid="button-photoset-save-all">
                      {savableUrls.every(isSaved) ? "✓ 已全部加入圖庫" : `全部加入「${character.name}」圖庫`}
                    </button>
                  )}
                </div>
                {!character && batchDone && batch.completedCount > 0 && (
                  <p className="text-xs text-[#64748b] mb-3">想把這些圖存成角色圖庫？請先到角色庫建立角色，下次在這裡選擇該角色後生成，就能一鍵加入。</p>
                )}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {batch.generations.map((g, idx) => {
                    const url = imageOf(g);
                    const packable = !!character && !!g.bunnyImageUrl;
                    return (
                      <div key={g.id} className="relative rounded-xl overflow-hidden bg-[#f1f5f9] border border-[#e2e8f0]" style={{ aspectRatio: ratio.id.replace(":", " / ") }} data-testid={`card-result-${idx}`}>
                        {g.status === "completed" && url ? (
                          <>
                            <img src={url} alt={`成果 ${idx + 1}`} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setLightbox(url)} />
                            <div className="absolute bottom-2 right-2 flex gap-1.5">
                              {packable && (
                                <button onClick={() => saveToPackMutation.mutate([g.bunnyImageUrl as string])}
                                  disabled={saveToPackMutation.isPending || isSaved(g.bunnyImageUrl as string) || packRoom <= 0}
                                  className="h-8 px-2 rounded-full bg-black/60 text-white text-[11px] hover:bg-black/80 disabled:opacity-70"
                                  title="加入角色圖庫">
                                  {isSaved(g.bunnyImageUrl as string) ? "✓ 已加入" : "＋圖庫"}
                                </button>
                              )}
                              <a href={url} download={`photoset-${idx + 1}.jpg`} target="_blank" rel="noreferrer"
                                className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80" title="下載">
                                <i className="fas fa-download text-xs" />
                              </a>
                            </div>
                          </>
                        ) : g.status === "failed" ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
                            <i className="fas fa-exclamation-triangle text-[#ef4444] mb-2" />
                            <p className="text-xs text-[#ef4444] line-clamp-4">{g.errorMessage || "生成失敗"}</p>
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-[#94a3b8]">
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

      {lightbox && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="預覽" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}

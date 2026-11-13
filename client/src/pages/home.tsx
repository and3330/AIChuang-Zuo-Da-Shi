import { dateLocale, tr, trServer } from "@/lib/i18n";
import { VaultPicker } from "@/components/VaultPicker";
import { IMAGE_COST, VIDEO_MODELS, VIDEO_MODEL_KEYS, WATERMARK_REMOVAL_COST, imageCost, type VideoModelKey } from "@shared/pricing";
import { inGoldZone } from "@/lib/zone";
/** Price of one image on the page being shown (the gold zone costs more). */
const priceHere = (watermark: boolean) => imageCost(watermark, inGoldZone());
/** What removing the watermark adds on this page. */
const removalHere = () => priceHere(false) - priceHere(true);
import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { IMAGE_RATIOS, IMAGE_TIERS, imageSizeFor } from "@shared/imageSizes";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/pages/account";
import { UnifiedUploader } from "@/components/UnifiedUploader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/use-seo";
import type { UploadResult } from "@uppy/core";
import type { ImageGeneration, VideoGeneration, StoryGeneration, StoryScene } from "@shared/schema";

function InfoTooltip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex items-center ml-1">
      <i
        className="fas fa-info-circle text-gray-400 hover:text-blue-500 cursor-help text-xs"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={(e) => { e.stopPropagation(); setShow(!show); }}
      ></i>
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 px-3 py-2 text-xs text-white bg-gray-800 rounded-lg shadow-lg z-50 leading-relaxed pointer-events-none whitespace-normal">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800"></span>
        </span>
      )}
    </span>
  );
}

/**
 * Image / video workspace. The hub at "/" links here:
 *   /create/image → section "image" (text-to-image, image editing)
 *   /create/video → section "video" (text-to-video, image-to-video)
 */
export default function Home({ section = "image" }: { section?: "image" | "video" }) {
  const { user } = useUser();
  useSeo({
    title: tr("AI 創作工作台 - 圖片與影片生成 | AI 創意工坊"),
    description: tr("使用 AI 創意工坊生成高品質圖片和影片。支援文字生圖、圖片編輯、多圖融合、序列生成、批次處理、AI 影片生成等功能。"),
    keywords: tr("AI生成,文字生圖,圖片編輯,AI影片,批次生成,序列生成,多圖融合"),
  });
  const [mode, setMode] = useState<"image-to-image" | "text-to-image" | "image-to-video" | "text-to-video" | "story">(section === "video" ? "text-to-video" : "text-to-image");
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string>("");
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [uploadedImagePath, setUploadedImagePath] = useState<string>("");
  const [prompt, setPrompt] = useState(tr("把泡泡變成愛心形狀"));
  // 「做同款」from the 作品牆 leaves its prompt in sessionStorage (REMIX_KEY in components/Showcase.tsx).
  const [textPrompt, setTextPrompt] = useState(() => {
    const fallback = tr("一幅美麗的日落山水風景畫，有山脈和湖泊");
    if (section !== "image") return fallback;
    try {
      const remix = window.sessionStorage.getItem("remixPrompt");
      if (remix) { window.sessionStorage.removeItem("remixPrompt"); return remix; }
    } catch { /* storage blocked */ }
    return fallback;
  });
  const [guidanceScale, setGuidanceScale] = useState(5.5);
  const [seed, setSeed] = useState(21);
  const [watermark, setWatermark] = useState(true);
  const [showWatermarkDisclaimer, setShowWatermarkDisclaimer] = useState(false);
  const [disclaimerAgreed, setDisclaimerAgreed] = useState(false);
  const [size, setSize] = useState("2048x2048");
  const [currentGenerationId, setCurrentGenerationId] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchCount, setBatchCount] = useState(2);
  const [batchPrompts, setBatchPrompts] = useState<string[]>([tr("把泡泡變成愛心形狀"), tr("把天空改成日落顏色")]);
  const [currentBatchId, setCurrentBatchId] = useState<string>("");
  const [batchGenerations, setBatchGenerations] = useState<ImageGeneration[]>([]);
  const [isSequentialMode, setIsSequentialMode] = useState(false);
  const [sequentialCount, setSequentialCount] = useState(4);
  const [isI2ISequentialMode, setIsI2ISequentialMode] = useState(false);
  const [i2iSequentialCount, setI2ISequentialCount] = useState(4);
  const [additionalImages, setAdditionalImages] = useState<{url: string, path: string}[]>([]);
  const [isMultiImageMode, setIsMultiImageMode] = useState(false);
  
  const [videoPrompt, setVideoPrompt] = useState(tr("高速穿越障礙物或美麗的自然風景，帶來沉浸式的飛行體驗"));
  const [videoDuration, setVideoDuration] = useState(5);
  const [cameraFixed, setCameraFixed] = useState(false);
  const [videoAspectRatio, setVideoAspectRatio] = useState<string>("16:9");
  // Reference materials for image-to-video (omni mode): up to 3 extra images
  // (角色/風格/構圖) and an optional reference audio (driver track / 配音 / BGM
  // sample). NOTE: WAN 3.0 ignores these; they were used by the old SeedDance
  // 2.0 omni endpoint; otherwise the standard endpoint is used as before.
  const [videoReferenceImages, setVideoReferenceImages] = useState<{ url: string; path: string }[]>([]);
  const [videoReferenceAudio, setVideoReferenceAudio] = useState<{ path: string; name: string } | null>(null);
  // Text-to-video reference audio (BGM / 配音). Symmetric with the
  // image-to-video equivalent so users on the pure text path can still drive
  // the soundtrack via the omni endpoint.
  const [textToVideoRefAudio, setTextToVideoRefAudio] = useState<{ path: string; name: string } | null>(null);
  // Elapsed-time tick for the active video poll. Populated by an effect
  // below so the progress card can show "已生成 32s" instead of just a
  // spinner during the 1–3 minute video run.
  const [videoElapsedSec, setVideoElapsedSec] = useState(0);
  // "我的影片" history sheet open state.
  const [myVideosOpen, setMyVideosOpen] = useState(false);
  const [videoResolution, setVideoResolution] = useState<"720p" | "1080p">("1080p");
  const [currentVideoGenerationId, setCurrentVideoGenerationId] = useState<string>("");
  // Video model, shared by 文字生影片 and 圖生影片 (VIDEO_MODELS in shared/pricing.ts): WAN 3.0,
  // Kling 4.0 or Seedance 2.5. Prices and the options shown follow the chosen model. Both take one first frame only —
  // no extra reference images / audio — and image-to-video follows the uploaded image's ratio.
  const I2V_MODELS = VIDEO_MODEL_KEYS.map(k => ({
    id: k as string, label: VIDEO_MODELS[k].label as string, desc: VIDEO_MODELS[k].desc as string,
    per720: VIDEO_MODELS[k].perSecond["720p"] as number, per1080: VIDEO_MODELS[k].perSecond["1080p"] as number,
    ratios: VIDEO_MODELS[k].ratios as readonly string[], audio: VIDEO_MODELS[k].audio as boolean, supportsOmni: false as boolean,
  }));
  const [selectedI2VModel, setSelectedI2VModelRaw] = useState<string>("wan");
  const selectedI2VMeta = I2V_MODELS.find(m => m.id === selectedI2VModel) ?? I2V_MODELS[0];
  const videoPerSec = videoResolution === "720p" ? selectedI2VMeta.per720 : selectedI2VMeta.per1080;
  /** Switching model drops a ratio the new model cannot produce. */
  const setSelectedI2VModel = (id: string) => {
    setSelectedI2VModelRaw(id);
    const next = I2V_MODELS.find(m => m.id === id);
    if (next && !next.ratios.includes(videoAspectRatio)) setVideoAspectRatio("16:9");
  };
  const EXTRA_RATIO_LABEL: Record<string, string> = { "4:3": tr("橫向（傳統）"), "3:4": tr("直向（傳統）"), "21:9": tr("超寬螢幕") };
  const extraRatios = selectedI2VMeta.ratios.filter(r => !["16:9", "9:16", "1:1"].includes(r));

  const getNarrativeInfo = (idx: number, total: number): { label: string; short: string; color: string; bg: string; border: string; icon: string } => {
    const ratio = total <= 1 ? 0 : idx / (total - 1);
    if (idx === 0) return { label: tr("起（開場）"), short: tr("起"), color: "text-emerald-700", bg: "bg-emerald-100", border: "border-emerald-300", icon: "🌱" };
    if (idx === total - 1) return { label: tr("合（結局）"), short: tr("合"), color: "text-purple-700", bg: "bg-purple-100", border: "border-purple-300", icon: "✨" };
    if (total === 3) return { label: tr("轉（高潮）"), short: tr("轉"), color: "text-orange-700", bg: "bg-orange-100", border: "border-orange-300", icon: "⚡" };
    if (ratio < 0.4) return { label: tr("承（發展）"), short: tr("承"), color: "text-blue-700", bg: "bg-blue-100", border: "border-blue-300", icon: "🔗" };
    if (ratio < 0.72) return { label: tr("轉（高潮）"), short: tr("轉"), color: "text-orange-700", bg: "bg-orange-100", border: "border-orange-300", icon: "⚡" };
    return { label: tr("合（收尾）"), short: tr("合"), color: "text-purple-700", bg: "bg-purple-100", border: "border-purple-300", icon: "✨" };
  };

  const STORY_STYLES: { label: string; value: string }[] = [
    { label: tr("水彩插畫"), value: "Watercolor illustration style, soft colors, gentle brush strokes" },
    { label: tr("電影感寫實"), value: "Cinematic realistic photography, dramatic lighting, high detail" },
    { label: tr("日系動漫"), value: "Japanese anime style, clean lines, vibrant colors, expressive characters" },
    { label: tr("歐式油畫"), value: "European oil painting style, rich textures, classical composition" },
    { label: tr("簡約線條插畫"), value: "Minimalist line art illustration, clean vector style" },
    { label: tr("自訂畫風"), value: "custom" },
  ];
  const [storyTitle, setStoryTitle] = useState(tr("神秘森林的冒險"));
  const [storyContent, setStoryContent] = useState("");
  const [storyStyle, setStoryStyle] = useState(STORY_STYLES[0].value);
  const [storyCustomStyle, setStoryCustomStyle] = useState("");
  const [storySceneCount, setStorySceneCount] = useState(4);
  const [storySceneSize, setStorySceneSize] = useState<"1:1" | "9:16" | "16:9">("1:1");
  const [storyScenes, setStoryScenes] = useState<{ title: string; description: string; dialogue?: string; sceneReferenceImageUrl?: string }[]>([
    { title: tr("第一幕"), description: tr("主角在森林入口處發現一扇古老的神秘大門") },
    { title: tr("第二幕"), description: tr("大門緩緩開啟，出現一道閃爍的金色光芒") },
    { title: tr("第三幕"), description: tr("主角穿越大門，來到一片魔法花園") },
    { title: tr("第四幕"), description: tr("花園中心有一棵發光的神木，枝頭棲息著奇幻的生靈") },
    { title: tr("第五幕"), description: "" },
    { title: tr("第六幕"), description: "" },
    { title: tr("第七幕"), description: "" },
    { title: tr("第八幕"), description: "" },
  ]);
  const [storyCharacterImages, setStoryCharacterImages] = useState<{ url: string; path: string }[]>([]);
  const [storyCharacterBImages, setStoryCharacterBImages] = useState<{ url: string; path: string }[]>([]);
  const [storySceneRefImages, setStorySceneRefImages] = useState<{ url: string; path: string }[]>([]);
  const [storyStyleImages, setStoryStyleImages] = useState<{ url: string; path: string }[]>([]);
  const [storySeed, setStorySeed] = useState<number | "">("");
  const [currentStoryId, setCurrentStoryId] = useState<string>("");
  const [storyLightboxIdx, setStoryLightboxIdx] = useState<number | null>(null);
  const [storyAnimationJobs, setStoryAnimationJobs] = useState<{sceneIdx: number; sceneTitle: string; videoId: string}[]>([]);
  const [showAnimationSettings, setShowAnimationSettings] = useState(true);
  const [animDuration, setAnimDuration] = useState(5);
  const [animResolution, setAnimResolution] = useState<"720p" | "1080p">("720p");
  const [animAspectRatio, setAnimAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [animPrompt, setAnimPrompt] = useState("");
  // keyed by actual scene index (not completed-scene index)
  const [perSceneAnimPrompts, setPerSceneAnimPrompts] = useState<Record<number, string>>({});
  const [perSceneResolution, setPerSceneResolution] = useState<Record<number, "720p" | "1080p">>({});
  const [perSceneDuration, setPerSceneDuration] = useState<Record<number, number>>({});
  const [perSceneTailEnabled, setPerSceneTailEnabled] = useState<Record<number, boolean>>({});
  const [editingSceneIdx, setEditingSceneIdx] = useState<number | null>(null);
  const [editingSceneDesc, setEditingSceneDesc] = useState("");
  const [editingSceneDialogue, setEditingSceneDialogue] = useState("");
  const [editingSceneRefPath, setEditingSceneRefPath] = useState<string>("");
  const [editingSceneRefUploading, setEditingSceneRefUploading] = useState(false);
  const [editingUseCharA, setEditingUseCharA] = useState(true);
  const [editingUseCharB, setEditingUseCharB] = useState(true);
  const [editingNewSeed, setEditingNewSeed] = useState(false);
  const [replacingSceneIdx, setReplacingSceneIdx] = useState<number | null>(null);
  const [showStoryHistory, setShowStoryHistory] = useState(false);
  const [editingStoryTitle, setEditingStoryTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState("");
  const [dragSourceIdx, setDragSourceIdx] = useState<number | null>(null);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stats } = useQuery<{ totalGenerations: number; totalCost: number; totalCreditsUsed: number }>({
    queryKey: ["/api/stats"],
    refetchInterval: 5000,
  });

  const { data: generation, isLoading: isPolling } = useQuery<ImageGeneration>({
    queryKey: ["/api/image-generations", currentGenerationId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/image-generations/${currentGenerationId}`);
      return response.json();
    },
    enabled: !!currentGenerationId && !currentBatchId,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => {
      const gen = query.state.data as ImageGeneration | undefined;
      return (gen?.status === "pending" || gen?.status === "processing") ? 2000 : false;
    },
  });

  const { data: batchData, isLoading: isBatchPolling } = useQuery<{
    batchId: string;
    generations: ImageGeneration[];
    totalCount: number;
    completedCount: number;
    failedCount: number;
    totalCost: number;
  }>({
    queryKey: ["/api/batch-generations", currentBatchId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/batch-generations/${currentBatchId}`);
      return response.json();
    },
    enabled: !!currentBatchId,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasProcessing = data?.generations.some(g => g.status === "pending" || g.status === "processing");
      return hasProcessing ? 2000 : false;
    },
  });

  const { data: videoGeneration, isLoading: isVideoPolling } = useQuery<VideoGeneration>({
    queryKey: ["/api/video-generations", currentVideoGenerationId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/video-generations/${currentVideoGenerationId}`);
      return response.json();
    },
    enabled: !!currentVideoGenerationId,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => {
      const gen = query.state.data as VideoGeneration | undefined;
      return (gen?.status === "pending" || gen?.status === "processing") ? 3000 : false;
    },
  });

  // Tick once per second while a video is in flight so the progress card
  // can show a live "已生成 32s" stopwatch. We anchor the start time to
  // when currentVideoGenerationId is FIRST set (not on every status
  // transition) so the counter doesn't reset when pending → processing.
  useEffect(() => {
    if (!currentVideoGenerationId) {
      setVideoElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    setVideoElapsedSec(0);
    const t = window.setInterval(() => {
      setVideoElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [currentVideoGenerationId]);
  // Fetch the user's recent videos for the "我的影片" history sheet.
  // Only enabled when the sheet is opened so it does not hammer the API
  // for visitors who never use the feature.
  type MyVideosResponse = { videoGenerations: VideoGeneration[] };
  const { data: meVideosData, isLoading: meVideosLoading } = useQuery<MyVideosResponse>({
    queryKey: ["/api/my-videos"],
    enabled: myVideosOpen,
    staleTime: 30_000,
  });

  const { data: storyGeneration } = useQuery<StoryGeneration>({
    queryKey: ["/api/story-generations", currentStoryId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/story-generations/${currentStoryId}`);
      return response.json();
    },
    enabled: !!currentStoryId,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => {
      const gen = query.state.data as StoryGeneration | undefined;
      if (gen?.status === "pending" || gen?.status === "generating") return 3000;
      if (gen?.status === "completed") {
        const scenes: StoryScene[] = JSON.parse(gen.scenes || "[]");
        if (scenes.some(s => s.status === "generating")) return 3000;
      }
      return false;
    },
  });

  const claudeEnhanceMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/claude/enhance-story-prompts", {
        title: storyTitle,
        style: storyStyle,
        scenes: storyScenes.slice(0, storySceneCount),
        storyContent: storyContent.trim() || undefined,
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      const enhanced: Array<{ index: number; enhanced_prompt: string }> = data.scenes || [];
      if (enhanced.length === 0) {
        toast({ title: tr("Seed 優化失敗"), description: tr("未收到有效的提示詞"), variant: "destructive" });
        return;
      }
      setStoryScenes(prev => prev.map((scene, idx) => {
        const found = enhanced.find(e => e.index === idx);
        if (found) return { ...scene, description: found.enhanced_prompt };
        return scene;
      }));
      toast({ title: tr("✨ 提示詞優化完成"), description: tr("Seed 已為 {0} 幕場景生成專業英文提示詞", { 0: enhanced.length }) });
    },
    onError: (error: any) => {
      toast({ title: tr("Seed 優化失敗"), description: error?.message || tr("請稍後再試"), variant: "destructive" });
    },
  });

  const claudeOutlineMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/claude/generate-story-outline", {
        title: storyTitle,
        style: storyStyle === "custom" ? storyCustomStyle : storyStyle,
        sceneCount: storySceneCount,
        storyContent: storyContent.trim() || undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr("生成失敗"));
      return data;
    },
    onSuccess: (data: any) => {
      const scenes: Array<{ index: number; title: string; description: string }> = data.scenes || [];
      if (scenes.length === 0) return;
      setStoryScenes(prev => {
        const updated = [...prev];
        scenes.forEach(s => {
          if (s.index >= 0 && s.index < updated.length) {
            updated[s.index] = { ...updated[s.index], title: s.title, description: s.description };
          }
        });
        return updated;
      });
      toast({ title: tr("✨ 故事大綱已生成"), description: tr("Seed 已自動生成 {0} 幕起承轉合的場景大綱", { 0: scenes.length }) });
    },
    onError: (error: any) => {
      toast({ title: tr("大綱生成失敗"), description: error?.message || tr("請稍後再試"), variant: "destructive" });
    },
  });

  const enhanceVideoPromptAIMutation = useMutation({
    mutationFn: async (mode: "text-to-video" | "image-to-video") => {
      const response = await apiRequest("POST", "/api/claude/enhance-video-prompt", {
        prompt: videoPrompt,
        step: "ai",
        mode,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr("優化失敗"));
      return data;
    },
    onSuccess: (data: any) => {
      if (data.enhanced) {
        setVideoPrompt(data.enhanced);
        toast({ title: tr("✨ AI 優化完成"), description: tr("提示詞已豐富化，可再用 Seed 轉英文") });
      }
    },
    onError: (error: any) => {
      toast({ title: tr("AI 優化失敗"), description: error?.message || tr("請稍後再試"), variant: "destructive" });
    },
  });

  const enhanceVideoPromptClaudeMutation = useMutation({
    mutationFn: async (mode: "text-to-video" | "image-to-video") => {
      const response = await apiRequest("POST", "/api/claude/enhance-video-prompt", {
        prompt: videoPrompt,
        step: "claude",
        mode,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr("優化失敗"));
      return data;
    },
    onSuccess: (data: any) => {
      if (data.enhanced) {
        setVideoPrompt(data.enhanced);
        toast({ title: tr("✨ Seed 優化完成"), description: tr("已轉換為專業英文影片提示詞") });
      }
    },
    onError: (error: any) => {
      toast({ title: tr("Seed 優化失敗"), description: error?.message || tr("請稍後再試"), variant: "destructive" });
    },
  });

  const regenerateSceneMutation = useMutation({
    mutationFn: async ({ sceneIdx, description, dialogue, sceneReferenceImageUrl, useCharA, useCharB, newSeed }: { sceneIdx: number; description?: string; dialogue?: string; sceneReferenceImageUrl?: string; useCharA?: boolean; useCharB?: boolean; newSeed?: boolean }) => {
      const body: Record<string, unknown> = {};
      if (description) body.description = description;
      if (dialogue !== undefined) body.dialogue = dialogue;
      if (sceneReferenceImageUrl) body.sceneReferenceImageUrl = sceneReferenceImageUrl;
      if (useCharA === false) body.useCharA = false;
      if (useCharB === false) body.useCharB = false;
      if (newSeed) body.newSeed = true;
      const response = await apiRequest("POST", `/api/story-generations/${currentStoryId}/regenerate-scene/${sceneIdx}`, body);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr("重新生成失敗"));
      return data;
    },
    onSuccess: (_data, { sceneIdx }) => {
      setEditingSceneIdx(null);
      setEditingSceneRefPath("");
      setEditingUseCharA(true);
      setEditingUseCharB(true);
      setEditingNewSeed(false);
      queryClient.invalidateQueries({ queryKey: ["/api/story-generations", currentStoryId] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: tr("第 {0} 幕重新生成中", { 0: sceneIdx + 1 }), description: tr("請稍候，生成完成後自動更新...") });
    },
    onError: (error: any) => {
      toast({ title: tr("重新生成失敗"), description: error?.message, variant: "destructive" });
    },
  });

  const replaceSceneImageMutation = useMutation({
    mutationFn: async ({ sceneIdx, objectPath }: { sceneIdx: number; objectPath: string }) => {
      const response = await apiRequest("POST", `/api/story-generations/${currentStoryId}/replace-scene-image/${sceneIdx}`, { objectPath });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr("替換圖片失敗"));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/story-generations", currentStoryId] });
      toast({ title: tr("圖片替換成功") });
    },
    onError: (error: any) => {
      toast({ title: tr("替換圖片失敗"), description: error?.message, variant: "destructive" });
    },
  });

  const storyMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/story-generations", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      setCurrentStoryId(data.id);
      setStoryAnimationJobs([]);
      setPerSceneTailEnabled({});
      setPerSceneDuration({});
      setEditingStoryTitle(false);
      queryClient.invalidateQueries({ queryKey: ["/api/story-generations", data.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/story-generations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: tr("故事生成已開始"), description: tr("正在生成「{0}」，請稍候...", { 0: data.title }) });
    },
    onError: (error: any) => {
      const msg = error?.message || tr("無法開始故事生成。");
      const description = (msg.includes("積分不足") || msg.includes("Not enough credits")) ? msg : tr("故事生成請求失敗：{0}", { 0: msg });
      toast({ title: tr("故事生成失敗"), description, variant: "destructive" });
    },
  });

  const storyAnimateMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", `/api/story-generations/${currentStoryId}/animate`, data);
      return response.json();
    },
    onSuccess: (data: any) => {
      setStoryAnimationJobs(data.jobs || []);
      setShowAnimationSettings(false);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: tr("批量動畫生成已開始"), description: tr("正在生成 {0} 幕動畫，請耐心等待...", { 0: data.jobs?.length }) });
    },
    onError: (error: any) => {
      const msg = error?.message || tr("無法開始動畫生成。");
      toast({ title: tr("動畫生成失敗"), description: msg, variant: "destructive" });
    },
  });

  const generateAnimPromptsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/story-generations/${currentStoryId}/generate-animation-prompts`, { duration: animDuration });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr("生成失敗"));
      return data;
    },
    onSuccess: (data: any) => {
      const newPrompts: Record<number, string> = {};
      (data.scenes || []).forEach((s: any) => {
        if (typeof s.actualSceneIndex === "number") {
          newPrompts[s.actualSceneIndex] = s.animation_prompt || "";
        }
      });
      setPerSceneAnimPrompts(newPrompts);
      toast({ title: tr("✨ 分鏡動畫提示詞已生成"), description: tr("已為 {0} 幕各別生成動畫提示詞，可在各幕卡片中編輯調整。", { 0: Object.keys(newPrompts).length }) });
    },
    onError: (error: any) => {
      toast({ title: tr("生成失敗"), description: error.message || tr("無法生成動畫提示詞"), variant: "destructive" });
    },
  });

  const { data: storyHistory = [] } = useQuery<StoryGeneration[]>({
    queryKey: ["/api/story-generations"],
    enabled: mode === "story" && showStoryHistory,
    staleTime: 30000,
  });

  const singleSceneAnimateMutation = useMutation({
    mutationFn: async ({ sceneIdx, resolution, prompt, tailSceneIdx }: { sceneIdx: number; resolution?: "720p" | "1080p"; prompt?: string; tailSceneIdx?: number }) => {
      const res = resolution ?? perSceneResolution[sceneIdx] ?? "720p";
      const prm = prompt ?? perSceneAnimPrompts[sceneIdx] ?? "";
      const dur = perSceneDuration[sceneIdx] ?? animDuration;
      const response = await apiRequest("POST", `/api/story-generations/${currentStoryId}/animate-scene/${sceneIdx}`, {
        duration: dur,
        resolution: res,
        animationPrompt: prm,
        ...(tailSceneIdx !== undefined ? { tailSceneIdx } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr("動畫生成失敗"));
      return data;
    },
    onSuccess: (data: any) => {
      setStoryAnimationJobs(prev => {
        const filtered = prev.filter(j => j.sceneIdx !== data.sceneIdx);
        return [...filtered, { sceneIdx: data.sceneIdx, sceneTitle: data.sceneTitle, videoId: data.videoId }];
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: tr("第 {0} 幕動畫生成中", { 0: data.sceneIdx + 1 }), description: tr("扣除 {0} 積分，完成後自動顯示", { 0: data.credits }) });
    },
    onError: (error: any) => {
      toast({ title: tr("動畫生成失敗"), description: error.message, variant: "destructive" });
    },
  });

  const editStoryTitleMutation = useMutation({
    mutationFn: async (title: string) => {
      const response = await apiRequest("PATCH", `/api/story-generations/${currentStoryId}`, { title });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || tr("更新失敗"));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/story-generations", currentStoryId] });
      queryClient.invalidateQueries({ queryKey: ["/api/story-generations"] });
      setEditingStoryTitle(false);
    },
    onError: (error: any) => {
      toast({ title: tr("更新失敗"), description: error.message, variant: "destructive" });
    },
  });

  const animJobBySceneIdx = Object.fromEntries(storyAnimationJobs.map((job, i) => [job.sceneIdx, { job, queryIdx: i }]));

  // Rehydrate sequel prefill from localStorage when entering story input form
  useEffect(() => {
    if (mode !== "story" || currentStoryId !== "") return;
    let raw: string | null = null;
    try { raw = localStorage.getItem("story_sequel_prefill"); } catch {}
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as {
        characterImagePaths?: string[];
        characterBImagePaths?: string[];
        sceneRefImagePaths?: string[];
        styleImagePaths?: string[];
        globalSeed?: number | null;
        sceneSize?: "1:1" | "9:16" | "16:9";
        style?: string;
      };
      if (saved.characterImagePaths?.length) {
        setStoryCharacterImages(saved.characterImagePaths.map(p => ({ url: p, path: p })));
      }
      if (saved.characterBImagePaths?.length) {
        setStoryCharacterBImages(saved.characterBImagePaths.map(p => ({ url: p, path: p })));
      }
      if (saved.sceneRefImagePaths?.length) {
        setStorySceneRefImages(saved.sceneRefImagePaths.map(p => ({ url: p, path: p })));
      }
      if (saved.styleImagePaths?.length) {
        setStoryStyleImages(saved.styleImagePaths.map(p => ({ url: p, path: p })));
      }
      if (saved.globalSeed) setStorySeed(saved.globalSeed);
      if (saved.sceneSize) setStorySceneSize(saved.sceneSize);
      // Clear after reading so next new story doesn't inherit
      try { localStorage.removeItem("story_sequel_prefill"); } catch {}
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, currentStoryId]);

  const animationVideoQueries = useQueries({
    queries: storyAnimationJobs.map(job => ({
      queryKey: ["/api/video-generations", job.videoId],
      queryFn: async () => {
        const response = await apiRequest("GET", `/api/video-generations/${job.videoId}`);
        return response.json();
      },
      enabled: !!job.videoId,
      staleTime: 0,
      gcTime: 0,
      refetchInterval: (query: any) => {
        const gen = query.state.data as VideoGeneration | undefined;
        return (gen?.status === "pending" || gen?.status === "processing") ? 4000 : false;
      },
    })),
  });

  const handleGetUploadParameters = async () => {
    const response = await apiRequest("POST", "/api/objects/upload");
    const data = await response.json();
    return { method: "PUT" as const, url: data.uploadURL };
  };

  const handleUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (result.successful && result.successful[0]) {
      const uploadURL = result.successful[0].uploadURL;
      try {
        const response = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
        const data = await response.json();
        setUploadedImageUrl(data.objectPath);
        setUploadedImagePath(data.objectPath);
        toast({ title: tr("圖片上傳成功"), description: tr("現在可以開始 AI 編輯。") });
      } catch (error) {
        toast({ title: tr("上傳錯誤"), description: tr("處理上傳圖片失敗。"), variant: "destructive" });
      }
    } else {
      toast({ title: tr("上傳失敗"), description: tr("圖片上傳失敗。"), variant: "destructive" });
    }
  };

  const generateMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/image-generations", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.batchId) {
        setCurrentBatchId(data.batchId);
        setCurrentGenerationId("");
        setBatchGenerations(data.generations);
        queryClient.invalidateQueries({ queryKey: ["/api/batch-generations", data.batchId] });
        toast({ title: tr("批次生成已開始"), description: tr("正在處理 {0} 張圖片...", { 0: data.totalCount }) });
      } else {
        setCurrentGenerationId(data.id);
        setCurrentBatchId("");
        queryClient.invalidateQueries({ queryKey: ["/api/image-generations", data.id] });
        toast({ title: tr("生成已開始"), description: tr("正在處理您的圖片...") });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: any) => {
      const msg = error?.message || tr("無法開始圖片生成。");
      const description = msg.includes("402") ? tr("積分不足，請先充值。") :
                          msg.includes("401") ? tr("請先登入。") :
                          msg.includes("404") ? tr("用戶不存在。") :
                          tr("圖片生成請求失敗：{0}", { 0: msg });
      toast({ title: tr("生成失敗"), description, variant: "destructive" });
    },
  });

  const videoGenerateMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/video-generations", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      setCurrentVideoGenerationId(data.id);
      queryClient.invalidateQueries({ queryKey: ["/api/video-generations", data.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: tr("影片生成已開始"), description: tr("正在處理您的影片，這可能需要 1-3 分鐘...") });
    },
    onError: (error: any) => {
      const msg = error?.message || tr("無法開始影片生成。");
      const description = msg.includes("402") ? tr("積分不足，請先充值。") :
                          msg.includes("401") ? tr("請先登入。") :
                          tr("影片生成請求失敗：{0}", { 0: msg });
      toast({ title: tr("影片生成失敗"), description, variant: "destructive" });
    },
  });

  const updateBatchPrompt = (index: number, value: string) => {
    const newPrompts = [...batchPrompts];
    newPrompts[index] = value;
    setBatchPrompts(newPrompts);
  };

  const updateBatchCount = (count: number) => {
    setBatchCount(count);
    const newPrompts = [...batchPrompts];
    if (count > newPrompts.length) {
      for (let i = newPrompts.length; i < count; i++) {
        newPrompts.push(tr("變化 {0}", { 0: i + 1 }));
      }
    } else {
      newPrompts.splice(count);
    }
    setBatchPrompts(newPrompts);
  };

  const handleGenerate = () => {
    if (mode === "story") {
      if (!storyTitle.trim()) {
        toast({ title: tr("請填寫故事標題"), variant: "destructive" });
        return;
      }
      const activeScenes = storyScenes.slice(0, storySceneCount);
      const hasEmptyScenes = activeScenes.some(s => !s.description.trim());
      if (hasEmptyScenes) {
        toast({ title: tr("請填寫所有場景描述"), description: tr("每一幕都需要有描述才能生成。"), variant: "destructive" });
        return;
      }
      const effectiveStyle = storyStyle === "custom" ? storyCustomStyle.trim() : storyStyle;
      if (!effectiveStyle) {
        toast({ title: tr("請填寫自訂畫風描述"), variant: "destructive" });
        return;
      }
      storyMutation.mutate({
        title: storyTitle.trim(),
        style: effectiveStyle,
        scenes: activeScenes,
        storyContent: storyContent.trim() || undefined,
        sceneSize: storySceneSize,
        characterImageUrls: storyCharacterImages.map(r => r.path),
        characterBImageUrls: storyCharacterBImages.map(r => r.path),
        sceneRefImageUrls: storySceneRefImages.map(r => r.path),
        styleImageUrls: storyStyleImages.map(r => r.path),
        ...(storySeed !== "" ? { globalSeed: Number(storySeed) } : {}),
      });
      return;
    }
    if (mode === "image-to-image") {
      if (!uploadedImagePath) {
        toast({ title: tr("缺少圖片"), description: tr("請先上傳圖片。"), variant: "destructive" });
        return;
      }
      if (isBatchMode) {
        const validPrompts = batchPrompts.filter(p => p.trim());
        if (validPrompts.length < 2) {
          toast({ title: tr("缺少描述"), description: tr("批次生成需要至少輸入 2 個描述。"), variant: "destructive" });
          return;
        }
        generateMutation.mutate({
          type: "image-to-image",
          originalImageUrl: uploadedImagePath,
          prompts: validPrompts,
          guidanceScale, seed, watermark, size,
        });
      } else {
        if (!prompt.trim()) {
          toast({ title: tr("缺少描述"), description: tr("請輸入描述。"), variant: "destructive" });
          return;
        }
        const mutationData: any = {
          type: "image-to-image",
          originalImageUrl: uploadedImagePath,
          prompt: prompt.trim(),
          guidanceScale, seed, watermark, size,
        };
        if (isI2ISequentialMode) {
          mutationData.sequentialGeneration = true;
          mutationData.maxImages = i2iSequentialCount;
        }
        if (isMultiImageMode && additionalImages.length > 0) {
          mutationData.additionalImageUrls = additionalImages.map(img => img.path);
        }
        generateMutation.mutate(mutationData);
      }
    } else if (mode === "text-to-image") {
      if (!textPrompt.trim()) {
        toast({ title: tr("缺少描述"), description: tr("請輸入文字描述來生成圖片。"), variant: "destructive" });
        return;
      }
      generateMutation.mutate({
        type: "text-to-image",
        prompt: textPrompt.trim(),
        guidanceScale, seed, watermark, size,
        sequentialGeneration: isSequentialMode,
        maxImages: isSequentialMode ? sequentialCount : undefined,
      });
    } else if (mode === "text-to-video") {
      if (!videoPrompt.trim()) {
        toast({ title: tr("缺少描述"), description: tr("請輸入影片內容描述。"), variant: "destructive" });
        return;
      }
      const t2vData: any = {
        type: "text-to-video",
        prompt: videoPrompt.trim(),
        duration: videoDuration,
        cameraFixed,
        aspectRatio: videoAspectRatio,
        resolution: videoResolution,
        videoModel: selectedI2VModel as VideoModelKey,
      };
      if (textToVideoRefAudio) {
        t2vData.referenceAudioUrl = textToVideoRefAudio.path;
      }
      videoGenerateMutation.mutate(t2vData);
    } else if (mode === "image-to-video") {
      if (!uploadedImagePath) {
        toast({ title: tr("缺少圖片"), description: tr("請先上傳圖片。"), variant: "destructive" });
        return;
      }
      if (!videoPrompt.trim()) {
        toast({ title: tr("缺少描述"), description: tr("請輸入影片動態描述。"), variant: "destructive" });
        return;
      }
      const videoData: any = {
        type: "image-to-video",
        originalImageUrl: uploadedImagePath,
        prompt: videoPrompt.trim(),
        duration: videoDuration,
        cameraFixed,
        aspectRatio: videoAspectRatio,
        resolution: videoResolution,
        videoModel: selectedI2VModel as VideoModelKey,
      };
      // Extra reference images / audio are only sent for models that
      // support them (WAN 3.0 does not).
      if (selectedI2VMeta.supportsOmni) {
        if (videoReferenceImages.length > 0) {
          videoData.additionalImageUrls = videoReferenceImages.map(r => r.path);
        }
        if (videoReferenceAudio) {
          videoData.referenceAudioUrl = videoReferenceAudio.path;
        }
      }
      videoGenerateMutation.mutate(videoData);
    }
  };

  const handleUploadError = (error: Error) => {
    toast({ title: tr("上傳失敗"), description: error.message || tr("圖片上傳失敗。"), variant: "destructive" });
  };

  const removeImage = () => {
    setUploadedImageUrl("");
    setUploadedImagePath("");
    setCurrentGenerationId("");
    setCurrentBatchId("");
    setBatchGenerations([]);
    setAdditionalImages([]);
    setIsMultiImageMode(false);
    setVideoReferenceImages([]);
    setVideoReferenceAudio(null);
    setTextToVideoRefAudio(null);
  };

  const handleVideoRefImageUploadComplete = async (
    result: UploadResult<Record<string, unknown>, Record<string, unknown>>,
  ) => {
    if (!result.successful || result.successful.length === 0) return;
    try {
      const added: { url: string; path: string }[] = [];
      for (const f of result.successful) {
        const resp = await apiRequest("PUT", "/api/objects/set-path", { imageURL: f.uploadURL });
        const data = await resp.json();
        added.push({ url: data.objectPath, path: data.objectPath });
      }
      setVideoReferenceImages(prev => [...prev, ...added].slice(0, 3));
      toast({ title: tr("參考圖片上傳成功"), description: tr("已新增 {0} 張參考圖片。", { 0: added.length }) });
    } catch {
      toast({ title: tr("上傳錯誤"), description: tr("處理上傳圖片失敗。"), variant: "destructive" });
    }
  };

  const makeAudioUploadHandler = (
    setter: (v: { path: string; name: string }) => void,
  ) => async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    const f = result.successful?.[0];
    if (!f) return;
    try {
      const resp = await apiRequest("PUT", "/api/objects/set-path", { imageURL: f.uploadURL });
      const data = await resp.json();
      setter({ path: data.objectPath, name: f.name || tr("參考音訊") });
      toast({ title: tr("參考音訊上傳成功"), description: f.name || "" });
    } catch {
      toast({ title: tr("上傳錯誤"), description: tr("處理上傳音訊失敗。"), variant: "destructive" });
    }
  };
  const handleVideoRefAudioUploadComplete = makeAudioUploadHandler(setVideoReferenceAudio);
  const handleTextToVideoRefAudioUploadComplete = makeAudioUploadHandler(setTextToVideoRefAudio);

  const handleAdditionalUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (result.successful && result.successful[0]) {
      const uploadURL = result.successful[0].uploadURL;
      try {
        const response = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
        const data = await response.json();
        setAdditionalImages(prev => [...prev, { url: data.objectPath, path: data.objectPath }]);
        toast({ title: tr("參考圖片上傳成功"), description: tr("已新增第 {0} 張參考圖片。", { 0: additionalImages.length + 2 }) });
      } catch (error) {
        toast({ title: tr("上傳錯誤"), description: tr("處理上傳圖片失敗。"), variant: "destructive" });
      }
    }
  };

  const removeAdditionalImage = (index: number) => {
    setAdditionalImages(prev => prev.filter((_, i) => i !== index));
  };

  const makeStoryRefUploadHandler = (
    setter: React.Dispatch<React.SetStateAction<{ url: string; path: string }[]>>,
    max: number,
    label: string,
  ) => async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (!result.successful || result.successful.length === 0) return;
    try {
      const uploaded: { url: string; path: string }[] = [];
      for (const file of result.successful) {
        const uploadURL = file.uploadURL;
        const response = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
        const data = await response.json();
        uploaded.push({ url: data.objectPath, path: data.objectPath });
      }
      setter(prev => [...prev, ...uploaded].slice(0, max));
      toast({ title: tr("{0}上傳成功", { 0: label }), description: tr("已新增 {0} 張圖。", { 0: uploaded.length }) });
    } catch (error) {
      toast({ title: tr("上傳錯誤"), description: tr("處理上傳圖片失敗。"), variant: "destructive" });
    }
  };

  const handleCharacterImageUpload = makeStoryRefUploadHandler(setStoryCharacterImages, 2, tr("角色 A 長相參考"));
  const handleCharacterBImageUpload = makeStoryRefUploadHandler(setStoryCharacterBImages, 2, tr("角色 B 長相參考"));
  const handleSceneRefImageUpload = makeStoryRefUploadHandler(setStorySceneRefImages, 2, tr("場景參考圖"));
  const handleStyleImageUpload = makeStoryRefUploadHandler(setStoryStyleImages, 2, tr("畫風參考圖"));

  const updateStorySceneCount = (count: number) => {
    setStorySceneCount(count);
    setStoryScenes(prev => {
      const arr = [...prev];
      while (arr.length < 12) arr.push({ title: tr("第 {0} 幕", { 0: arr.length + 1 }), description: "" });
      return arr;
    });
  };

  const updateStoryScene = (idx: number, field: "title" | "description" | "dialogue" | "sceneReferenceImageUrl", value: string) => {
    setStoryScenes(prev => {
      const arr = [...prev];
      arr[idx] = { ...arr[idx], [field]: value };
      return arr;
    });
  };

  const [sceneUploadingIdx, setSceneUploadingIdx] = useState<number | null>(null);

  const handleSceneImageSelect = async (idx: number, file: File) => {
    setSceneUploadingIdx(idx);
    try {
      const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
      const { uploadURL } = await uploadRes.json();
      await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      const pathRes = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
      const { objectPath } = await pathRes.json();
      updateStoryScene(idx, "sceneReferenceImageUrl", objectPath);
      toast({ title: tr("第 {0} 幕場景圖上傳成功", { 0: idx + 1 }) });
    } catch {
      toast({ title: tr("場景圖上傳失敗"), variant: "destructive" });
    } finally {
      setSceneUploadingIdx(null);
    }
  };

  const isStoryGenerating = storyMutation.isPending ||
    (storyGeneration?.status === "pending" || storyGeneration?.status === "generating");

  const isGenerating = generateMutation.isPending || videoGenerateMutation.isPending ||
    (generation?.status === "pending" || generation?.status === "processing") ||
    (batchData?.generations.some(g => g.status === "pending" || g.status === "processing")) ||
    (videoGeneration?.status === "pending" || videoGeneration?.status === "processing");

  const getCreditsNeeded = () => {
    if (mode === "story") return storySceneCount * IMAGE_COST;
    if (mode === "image-to-video") {
      const per = videoResolution === "720p" ? selectedI2VMeta.per720 : selectedI2VMeta.per1080;
      return Math.round(videoDuration * per);
    }
    if (mode === "text-to-video") return Math.round(videoDuration * videoPerSec);
    const perImageCost = priceHere(watermark);
    if (mode === "text-to-image") return isSequentialMode ? perImageCost * sequentialCount : perImageCost;
    if (isBatchMode) return perImageCost * batchPrompts.filter(p => p.trim()).length;
    if (isI2ISequentialMode) return perImageCost * i2iSequentialCount;
    return perImageCost;
  };

  const creditsNeeded = getCreditsNeeded();
  const hasEnoughCredits = (user?.credits ?? 0) >= creditsNeeded;

  const isImageMode = mode === "image-to-image" || mode === "text-to-image";
  const isVideoMode = mode === "image-to-video" || mode === "text-to-video";
  const isStoryMode = mode === "story";

  // ── 我的影片 history sheet ─────────────────────────────────────────
  const myVideosSheet = (
    <Sheet open={myVideosOpen} onOpenChange={setMyVideosOpen}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <i className="fas fa-film text-purple-500"></i>{tr("我的影片")}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {meVideosLoading && (
            <div className="text-center py-10 text-gray-500 text-sm">
              <i className="fas fa-spinner fa-spin mr-2"></i>{tr("載入中...")}
            </div>
          )}
          {!meVideosLoading && (meVideosData?.videoGenerations?.length ?? 0) === 0 && (
            <div className="text-center py-10 text-gray-500 text-sm">
              {tr("還沒有影片，趕快開始生成吧！")}
            </div>
          )}
          {meVideosData?.videoGenerations?.slice(0, 30).map((v) => (
            <div
              key={v.id}
              className="border border-gray-200 rounded-lg p-3 bg-white space-y-2"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">
                  {v.type === "text-to-video" ? tr("文字生影片") : tr("圖片生影片")}
                </span>
                <span
                  className={
                    v.status === "completed"
                      ? "text-green-600"
                      : v.status === "failed"
                      ? "text-red-600"
                      : "text-amber-600"
                  }
                >
                  {v.status === "completed"
                    ? tr("✅ 完成")
                    : v.status === "failed"
                    ? tr("❌ 失敗")
                    : tr("⏳ 處理中")}
                </span>
              </div>
              {v.generatedVideoUrl && v.status === "completed" ? (
                <video
                  controls
                  className="w-full rounded bg-gray-900 max-h-56"
                  src={v.generatedVideoUrl}
                  preload="metadata"
                />
              ) : v.originalImageUrl ? (
                <img
                  src={v.originalImageUrl}
                  alt="source"
                  className="w-full max-h-40 object-cover rounded bg-gray-100"
                />
              ) : null}
              <p className="text-xs text-gray-700 line-clamp-2">{v.prompt}</p>
              <div className="flex items-center justify-between text-[11px] text-gray-500">
                <span>
                  {v.duration || 5}s · {v.resolution === "720p" ? "720P" : "1080P"} ·{" "}
                  {v.creditsUsed ?? Math.round((v.duration || 5) * (v.resolution === "720p" ? 8 : 15))} {tr("積分")}
                </span>
                {v.generatedVideoUrl && v.status === "completed" && (
                  <a
                    href={v.generatedVideoUrl}
                    download={`video-${v.id}.mp4`}
                    className="text-purple-600 hover:text-purple-800"
                  >
                    <i className="fas fa-download mr-1"></i>{tr("下載")}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <div className="min-h-screen pb-10">
      <NavigationHeader />
      {myVideosSheet}
      {vaultPickerOpen && <VaultPicker onPick={(url) => { setUploadedImageUrl(url); setUploadedImagePath(url); setVaultPickerOpen(false); }} onClose={() => setVaultPickerOpen(false)} />}
      {/* 我的影片 floating button — only shown for logged-in users on
          video modes, so visitors don't see a useless button. */}
      {user && isVideoMode && (
        <button
          type="button"
          onClick={() => setMyVideosOpen(true)}
          className="fixed bottom-[calc(128px+env(safe-area-inset-bottom))] md:bottom-24 right-4 z-30 px-4 py-2.5 rounded-full bg-purple-600 hover:bg-purple-700 text-white shadow-lg flex items-center gap-2 text-sm"
          data-testid="button-my-videos"
        >
          <i className="fas fa-film"></i>{tr("我的影片")}
        </button>
      )}

      <main className="max-w-4xl mx-auto px-4 py-5 md:py-8">
        <div className="mb-5">
          <h1 className="hidden md:block text-2xl font-bold text-slate-900">{section === "video" ? tr("影片生成") : tr("圖片生成")}</h1>
          <p className="text-sm text-slate-500 md:mt-1">
            {section === "video"
              ? tr("把一張圖變成會動的短片，或直接用文字生成影片。使用 WAN 3.0。")
              : tr("用文字畫圖，或上傳圖片請 AI 修改。每張 {0} 積分，去除浮水印 +{1} 積分。使用 Seedream 5.5。", { 0: priceHere(true), 1: removalHere() })}
          </p>
        </div>
        <div className="space-y-6">

          {/* Model & Mode Selection */}
          <div className="bg-white rounded-3xl border border-indigo-100 overflow-hidden">
            {/* Image sub-modes */}
            {isImageMode && (
              <div className="p-4">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setMode("text-to-image")}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      mode === "text-to-image"
                        ? "border-blue-500 bg-blue-50 shadow-sm"
                        : "border-gray-200 hover:border-blue-200 hover:bg-blue-50/30"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        mode === "text-to-image" ? "bg-blue-100" : "bg-gray-100"
                      }`}>
                        <i className={`fas fa-pencil-alt ${mode === "text-to-image" ? "text-blue-600" : "text-gray-400"}`}></i>
                      </div>
                      <div className="text-left">
                        <h3 className={`font-semibold text-sm ${mode === "text-to-image" ? "text-blue-700" : "text-gray-700"}`}>{tr("文字生圖")}<InfoTooltip text={tr("輸入文字描述，AI 直接生成一張全新的圖片。例如：「一隻貓在海灘上散步」")} /></h3>
                        <p className="text-xs text-gray-500 mt-0.5">{tr("用文字描述創建圖片")}</p>
                        <span className={`inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${!watermark ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>{tr("{0} 積分/張", { 0: priceHere(watermark) })}</span>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => setMode("image-to-image")}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      mode === "image-to-image"
                        ? "border-blue-500 bg-blue-50 shadow-sm"
                        : "border-gray-200 hover:border-blue-200 hover:bg-blue-50/30"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        mode === "image-to-image" ? "bg-blue-100" : "bg-gray-100"
                      }`}>
                        <i className={`fas fa-image ${mode === "image-to-image" ? "text-blue-600" : "text-gray-400"}`}></i>
                      </div>
                      <div className="text-left">
                        <h3 className={`font-semibold text-sm ${mode === "image-to-image" ? "text-blue-700" : "text-gray-700"}`}>{tr("圖片編輯")}<InfoTooltip text={tr("上傳一張現有圖片，搭配文字描述，AI 會根據指示修改圖片。例如：「把天空改成日落顏色」")} /></h3>
                        <p className="text-xs text-gray-500 mt-0.5">{tr("AI 編輯現有圖片")}</p>
                        <span className={`inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${!watermark ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>{tr("{0} 積分/張", { 0: priceHere(watermark) })}</span>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Feature Tags */}
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  {mode === "text-to-image" && (
                    <>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-layer-group mr-1"></i>{tr("序列生成")}<InfoTooltip text={tr("開啟後，AI 會依序生成多張圖片，每張都在前一張的基礎上繼續變化，產出連貫的漸變效果")} />
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-expand-arrows-alt mr-1"></i>{tr("多種尺寸")}<InfoTooltip text={tr("支援多種圖片比例，包含正方形、橫向、直向等多種尺寸選項")} />
                      </span>
                    </>
                  )}
                  {mode === "image-to-image" && (
                    <>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-clone mr-1"></i>{tr("批次生成")}<InfoTooltip text={tr("一次生成多張不同的圖片，每張可以輸入不同的描述")} />
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-object-group mr-1"></i>{tr("多圖融合")}<InfoTooltip text={tr("上傳多張圖片，AI 會把元素融合在一起，適合服裝替換、風格混合")} />
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-layer-group mr-1"></i>{tr("序列生成")}<InfoTooltip text={tr("以圖片為基礎，連續生成一系列逐步變化的圖片")} />
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Seedream Sub-modes */}
            {isVideoMode && (
              <div className="p-4">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setMode("text-to-video")}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      mode === "text-to-video"
                        ? "border-purple-500 bg-purple-50 shadow-sm"
                        : "border-gray-200 hover:border-purple-200 hover:bg-purple-50/30"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        mode === "text-to-video" ? "bg-purple-100" : "bg-gray-100"
                      }`}>
                        <i className={`fas fa-pencil-alt ${mode === "text-to-video" ? "text-purple-600" : "text-gray-400"}`}></i>
                      </div>
                      <div className="text-left">
                        <h3 className={`font-semibold text-sm ${mode === "text-to-video" ? "text-purple-700" : "text-gray-700"}`}>{tr("文字生影片")}<InfoTooltip text={tr("輸入文字描述，AI 直接生成一段影片。可選擇影片長度（4-12秒）和解析度（720P/1080P）")} /></h3>
                        <p className="text-xs text-gray-500 mt-0.5">{tr("用文字描述創建影片")}</p>
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{tr("8~15積分/秒")}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => setMode("image-to-video")}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      mode === "image-to-video"
                        ? "border-purple-500 bg-purple-50 shadow-sm"
                        : "border-gray-200 hover:border-purple-200 hover:bg-purple-50/30"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        mode === "image-to-video" ? "bg-purple-100" : "bg-gray-100"
                      }`}>
                        <i className={`fas fa-image ${mode === "image-to-video" ? "text-purple-600" : "text-gray-400"}`}></i>
                      </div>
                      <div className="text-left">
                        <h3 className={`font-semibold text-sm ${mode === "image-to-video" ? "text-purple-700" : "text-gray-700"}`}>{tr("圖片生影片")}<InfoTooltip text={tr("上傳一張圖片，AI 會讓它「動起來」變成影片。可選擇比例（16:9/9:16/1:1）、長度和解析度")} /></h3>
                        <p className="text-xs text-gray-500 mt-0.5">{tr("將靜態圖片轉為影片")}</p>
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{tr("8~15積分/秒")}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-text-width mr-1"></i>{tr("文字生影片")}
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-video mr-1"></i>{tr("動態鏡頭")}
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-crosshairs mr-1"></i>{tr("固定鏡頭")}
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-clock mr-1"></i>{tr("4-12 秒可選")}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ============ TEXT-TO-IMAGE INPUT ============ */}
          {mode === "text-to-image" && (
            <Card className="bg-white rounded-3xl border border-indigo-100">
              <CardContent className="p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                    <i className="fas fa-pencil-alt text-blue-500"></i>
                    {tr("文字生成圖片")}
                  </h2>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-sm text-gray-600">{tr("序列生成")}<InfoTooltip text={tr("開啟後，AI 會依序生成多張圖片，每張都在前一張的基礎上繼續變化，產出連貫的漸變效果")} /></span>
                    <div
                      role="switch"
                      aria-checked={isSequentialMode}
                      onClick={() => setIsSequentialMode(!isSequentialMode)}
                      className={`relative w-10 h-5 rounded-full transition-colors ${isSequentialMode ? 'bg-blue-500' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isSequentialMode ? 'translate-x-5' : ''}`} />
                    </div>
                  </label>
                </div>
                
                <div>
                  <Textarea 
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder={isSequentialMode 
                      ? tr("例如：生成一個四季變化的庭院角落系列...") 
                      : tr("例如：美麗的日落山水風景，寫實風格，高品質...")}
                    value={textPrompt}
                    onChange={(e) => setTextPrompt(e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    {isSequentialMode 
                      ? tr("描述系列圖片主題，AI 自動生成連貫的多張圖片") 
                      : tr("詳細描述您想在圖片中看到的內容")}
                  </p>
                </div>

                {isSequentialMode && (
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <div className="flex items-center gap-4">
                      <Label className="text-sm font-medium text-gray-700">{tr("生成數量")}</Label>
                      <Input
                        type="number" min="2" max="10"
                        value={sequentialCount}
                        onChange={(e) => setSequentialCount(Math.min(10, Math.max(2, parseInt(e.target.value) || 2)))}
                        className="w-20 px-3 py-1.5 border border-blue-200 rounded-lg"
                      />
                      <span className="text-sm text-gray-500">{tr("張 (2-10)")}</span>
                      <span className="ml-auto text-sm font-semibold text-blue-600">{tr("{0} 積分", { 0: sequentialCount * priceHere(watermark) })}</span>
                    </div>
                    <p className="text-xs text-blue-600 mt-2">
                      <i className="fas fa-info-circle mr-1"></i>
                      {tr("序列生成會創建一組連貫的圖片系列，適合四季變化、時間流逝等主題")}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-700">{tr("圖片尺寸")}</Label>
                    <select 
                      value={size} onChange={(e) => setSize(e.target.value)}
                      className="mt-1.5 w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    >
                      {IMAGE_TIERS.map(t => (
                        <optgroup key={t.id} label={t.label}>
                          {IMAGE_RATIOS.map(r => (
                            <option key={r.id} value={imageSizeFor(r.id, t.id)}>
                              {r.label}（{r.sizes[t.id][0]}×{r.sizes[t.id][1]}）
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">{tr("引導強度")}</Label>
                    <Input 
                      type="number" min="1" max="20" value={guidanceScale} step="0.5"
                      className="mt-1.5 w-full px-3 py-2 border border-gray-200 rounded-lg"
                      onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ============ IMAGE-TO-IMAGE INPUT ============ */}
          {mode === "image-to-image" && (
            <>
              {/* Upload */}
              <Card className="bg-white rounded-3xl border border-indigo-100">
                <CardContent className="p-6">
                  <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-4">
                    <i className="fas fa-upload text-blue-500"></i>
                    {tr("上傳您的圖片")}
                  </h2>
                  {!uploadedImageUrl ? (
                    <div className="space-y-2">
                      <UnifiedUploader
                      maxNumberOfFiles={1} maxFileSize={10485760}
                      onGetUploadParameters={handleGetUploadParameters}
                      onComplete={handleUploadComplete}
                      onError={handleUploadError}
                      className="w-full"
                    >
                      {tr("拖放圖片到此處或點擊瀏覽")}
                    </UnifiedUploader>
                      <button type="button" onClick={() => setVaultPickerOpen(true)} className="w-full h-11 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 hover:border-indigo-300" data-testid="button-from-vault">
                        <i className="fas fa-photo-film mr-2 text-xs text-slate-400"></i>{tr("從作品選")}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">{tr("已選擇的圖片：")}</span>
                        <button className="text-red-500 hover:text-red-700 text-sm flex items-center gap-1" onClick={removeImage}>
                          <i className="fas fa-times"></i>{tr("移除")}
                        </button>
                      </div>
                      <div className="bg-gray-100 rounded-lg overflow-hidden">
                        <img src={uploadedImageUrl} alt="Uploaded" className="w-full h-48 object-cover" />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Prompt & Options */}
              <Card className="bg-white rounded-3xl border border-indigo-100">
                <CardContent className="p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                      <i className="fas fa-edit text-blue-500"></i>
                      {tr("描述修改內容")}
                    </h2>
                  </div>

                  {/* Feature Toggles */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => { setIsMultiImageMode(!isMultiImageMode); if (isMultiImageMode) setAdditionalImages([]); if (!isMultiImageMode) setIsBatchMode(false); }}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${
                        isMultiImageMode ? "border-green-400 bg-green-50 text-green-700" : "border-gray-200 text-gray-500 hover:border-green-300"
                      }`}
                    >
                      <i className="fas fa-object-group"></i>{tr("多圖融合")}<InfoTooltip text={tr("上傳多張圖片（2-4張），AI 會把這些圖片的元素融合在一起。適合服裝替換、風格融合、角色一致性等效果")} />
                    </button>
                    <button
                      onClick={() => { setIsI2ISequentialMode(!isI2ISequentialMode); if (!isI2ISequentialMode) setIsBatchMode(false); }}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${
                        isI2ISequentialMode ? "border-purple-400 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-500 hover:border-purple-300"
                      }`}
                    >
                      <i className="fas fa-layer-group"></i>{tr("序列生成")}<InfoTooltip text={tr("以第一張圖為基礎，連續生成一系列逐步變化的圖片。適合做漸變效果，每張都在前一張的基礎上繼續修改")} />
                    </button>
                    <button
                      onClick={() => { setIsBatchMode(!isBatchMode); if (!isBatchMode) { updateBatchCount(batchCount); setIsI2ISequentialMode(false); setIsMultiImageMode(false); setAdditionalImages([]); } }}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${
                        isBatchMode ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:border-blue-300"
                      }`}
                    >
                      <i className="fas fa-clone"></i>{tr("批次生成")}<InfoTooltip text={tr("一次生成多張不同的圖片（最多6張），每張可以輸入不同的描述，AI 會各自獨立產出不同版本")} />
                    </button>
                  </div>
                  
                  {!isBatchMode ? (
                    <div className="space-y-4">
                      <Textarea 
                        rows={3}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                        placeholder={isMultiImageMode 
                          ? tr("例如：用圖片 2 的服裝替換圖片 1 中人物的衣服") 
                          : tr("例如：把泡泡變成愛心形狀、把天空改成日落顏色...")}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                      />

                      {isMultiImageMode && (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                          <Label className="text-sm font-medium text-gray-700 mb-3 block">
                            <i className="fas fa-images text-green-600 mr-2"></i>
                            {tr("參考圖片（圖片 2、3、4...）")}
                          </Label>
                          <p className="text-xs text-green-700 mb-3">
                            {tr("上傳額外的參考圖片，用於服裝替換、風格融合、角色一致性等效果")}
                          </p>
                          <div className="grid grid-cols-4 gap-3 mb-2">
                            {additionalImages.map((img, index) => (
                              <div key={index} className="relative">
                                <img src={img.path.startsWith('/') ? img.path : `/${img.path}`} alt={tr("參考圖片 {0}", { 0: index + 2 })} className="w-full aspect-square object-cover rounded-lg border border-green-300" />
                                <div className="absolute top-1 left-1 bg-green-600 text-white text-xs px-1.5 py-0.5 rounded-full">{index + 2}</div>
                                <button onClick={() => removeAdditionalImage(index)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600">×</button>
                              </div>
                            ))}
                            {additionalImages.length < 4 && (
                              <UnifiedUploader
                                onGetUploadParameters={handleGetUploadParameters}
                                onComplete={handleAdditionalUploadComplete}
                                onError={handleUploadError}
                                maxFileSize={10 * 1024 * 1024}
                                className="w-full aspect-square border-2 border-dashed border-green-300 rounded-lg flex items-center justify-center cursor-pointer hover:border-green-500 hover:bg-green-100 transition-colors"
                              />
                            )}
                          </div>
                          <p className="text-xs text-gray-500">{tr("最多 4 張（已上傳 {0} 張）", { 0: additionalImages.length })}</p>
                        </div>
                      )}

                      {isI2ISequentialMode && (
                        <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl">
                          <div className="flex items-center gap-4">
                            <Label className="text-sm font-medium text-gray-700">{tr("序列數量")}</Label>
                            <Input
                              type="number" min="2" max="10"
                              value={i2iSequentialCount}
                              onChange={(e) => setI2ISequentialCount(Math.min(10, Math.max(2, parseInt(e.target.value) || 2)))}
                              className="w-20 px-3 py-1.5 border border-purple-200 rounded-lg"
                            />
                            <span className="text-sm text-gray-500">{tr("張 (2-10)")}</span>
                            <span className="ml-auto text-sm font-semibold text-purple-600">{tr("{0} 積分", { 0: i2iSequentialCount * priceHere(watermark) })}</span>
                          </div>
                          <p className="text-xs text-purple-600 mt-2">
                            <i className="fas fa-info-circle mr-1"></i>
                            {isMultiImageMode 
                              ? tr("使用多張參考圖片生成一系列連貫的圖片") 
                              : tr("基於圖片生成一系列連貫的變化版本")}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <Label className="text-sm font-medium text-gray-700">{tr("批次數量")}</Label>
                        <select
                          value={batchCount}
                          onChange={(e) => updateBatchCount(parseInt(e.target.value))}
                          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                        >
                          {[2,3,4,5,6].map(n => <option key={n} value={n}>{tr("{0} 張", { 0: n })}</option>)}
                        </select>
                        <span className="ml-auto text-sm font-semibold text-blue-600">{batchPrompts.filter(p => p.trim()).length * priceHere(watermark)} {tr("積分")}</span>
                      </div>
                      <div className="space-y-3">
                        {batchPrompts.map((p, index) => (
                          <div key={index}>
                            <Label className="text-xs text-gray-500 mb-1 block">{tr("圖片 {0}", { 0: index + 1 })}</Label>
                            <Textarea
                              rows={2}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg resize-none text-sm"
                              placeholder={tr("第 {0} 張的描述...", { 0: index + 1 })}
                              value={p}
                              onChange={(e) => updateBatchPrompt(index, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400">{tr("每張圖片依照其特定描述生成，保持相同的基礎圖片和設定")}</p>
                    </div>
                  )}

                  {/* Advanced Settings */}
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-2">
                      <i className="fas fa-cog"></i>{tr("進階設定")}
                      <i className="fas fa-chevron-down text-xs transform group-open:rotate-180 transition-transform"></i>
                    </summary>
                    <div className="mt-3 grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl">
                      <div>
                        <Label className="text-sm text-gray-600">{tr("引導強度")}</Label>
                        <Input 
                          type="range" min="1" max="20" value={guidanceScale} step="0.5"
                          className="mt-1 w-full"
                          onChange={(e) => setGuidanceScale(parseFloat(e.target.value))}
                        />
                        <div className="flex justify-between text-xs text-gray-400 mt-0.5">
                          <span>1</span><span>{guidanceScale}</span><span>20</span>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm text-gray-600">{tr("種子值")}</Label>
                        <Input 
                          type="number" value={seed} min="0" max="999999"
                          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-lg"
                          onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                  </details>
                </CardContent>
              </Card>
            </>
          )}

          {/* ============ TEXT-TO-VIDEO INPUT ============ */}
          {mode === "text-to-video" && (
            <Card className="bg-white rounded-3xl border border-indigo-100">
              <CardContent className="p-6 space-y-5">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <i className="fas fa-pencil-alt text-purple-500"></i>
                  {tr("文字生影片")}
                </h2>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-sm font-medium text-gray-700">{tr("描述影片內容")}</Label>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => enhanceVideoPromptAIMutation.mutate("text-to-video")}
                        disabled={!videoPrompt.trim() || enhanceVideoPromptAIMutation.isPending || enhanceVideoPromptClaudeMutation.isPending}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {enhanceVideoPromptAIMutation.isPending ? (
                          <><i className="fas fa-spinner fa-spin text-xs"></i> {tr("優化中...")}</>
                        ) : (
                          <><i className="fas fa-magic text-xs"></i> {tr("①AI優化")}</>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => enhanceVideoPromptClaudeMutation.mutate("text-to-video")}
                        disabled={!videoPrompt.trim() || enhanceVideoPromptAIMutation.isPending || enhanceVideoPromptClaudeMutation.isPending}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {enhanceVideoPromptClaudeMutation.isPending ? (
                          <><i className="fas fa-spinner fa-spin text-xs"></i> {tr("優化中...")}</>
                        ) : (
                          <><i className="fas fa-robot text-xs"></i> {tr("②Seed優化")}</>
                        )}
                      </button>
                    </div>
                  </div>
                  <Textarea 
                    placeholder={tr("例如：一隻橘貓在陽光下的草地上追蝴蝶，鏡頭緩慢環繞")}
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    className="w-full min-h-[100px] px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">{tr("詳細描述您想要的影片畫面和動態效果 ・先①AI優化讓描述更豐富，再②Seed優化轉為英文專業格式")}</p>
                </div>

                <div className="border border-purple-200 bg-purple-50/40 rounded-xl p-4 space-y-2" data-testid="t2v-model-picker">
                  <Label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                    <i className="fas fa-robot text-purple-500"></i>
                    {tr("AI 影片模型")}
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {I2V_MODELS.map(m => (
                      <button key={m.id} onClick={() => setSelectedI2VModel(m.id)} aria-pressed={selectedI2VModel === m.id}
                        className={`p-3 rounded-lg border-2 text-left transition-all ${selectedI2VModel === m.id ? "border-purple-500 bg-purple-50 text-purple-700" : "border-gray-200 bg-white text-gray-600 hover:border-purple-200"}`}
                        data-testid={`t2v-model-${m.id}`}>
                        <div className="font-semibold text-sm">{m.label}</div>
                        <div className="text-xs mt-0.5">{tr("720P {0}・1080P {1} 積分/秒", { 0: m.per720, 1: m.per1080 })}</div>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">{selectedI2VMeta.desc}{selectedI2VMeta.audio ? "" : tr("（沒有音訊開關，以實際輸出為準）")}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-700">{tr("影片長度")}</Label>
                    <div className="mt-2 space-y-2">
                      <input
                        type="range"
                        min={4}
                        max={12}
                        step={1}
                        value={videoDuration}
                        onChange={(e) => setVideoDuration(parseInt(e.target.value))}
                        className="w-full h-2 bg-purple-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">{tr("4秒")}</span>
                        <span className="text-lg font-bold text-purple-700">{tr("{0} 秒", { 0: videoDuration })}</span>
                        <span className="text-sm text-gray-500">{tr("12秒")}</span>
                      </div>
                      <div className="text-center text-sm font-medium text-purple-600 bg-purple-50 rounded-lg py-1.5">
                        {Math.round(videoDuration * videoPerSec)} {tr("積分（")}{videoDuration}{tr("秒 ×")} {videoPerSec}{tr("積分/秒）")}
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">{tr("鏡頭模式")}</Label>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setCameraFixed(false)}
                        className={`p-3 rounded-lg border-2 text-center transition-all ${
                          !cameraFixed 
                            ? "border-purple-500 bg-purple-50 text-purple-700" 
                            : "border-gray-200 text-gray-600 hover:border-purple-200"
                        }`}
                      >
                        <div className="font-semibold text-sm">{tr("動態鏡頭")}</div>
                        <div className="text-xs mt-0.5">{tr("自動運鏡")}</div>
                      </button>
                      <button
                        onClick={() => setCameraFixed(true)}
                        className={`p-3 rounded-lg border-2 text-center transition-all ${
                          cameraFixed 
                            ? "border-purple-500 bg-purple-50 text-purple-700" 
                            : "border-gray-200 text-gray-600 hover:border-purple-200"
                        }`}
                      >
                        <div className="font-semibold text-sm">{tr("固定鏡頭")}</div>
                        <div className="text-xs mt-0.5">{tr("穩定畫面")}</div>
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">{tr("影片解析度")}</Label>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setVideoResolution("720p")}
                      className={`p-3 rounded-lg border-2 text-center transition-all ${
                        videoResolution === "720p"
                          ? "border-purple-500 bg-purple-50 text-purple-700"
                          : "border-gray-200 text-gray-600 hover:border-purple-200"
                      }`}
                    >
                      <div className="font-semibold text-sm">720P</div>
                      <div className="text-xs mt-0.5 text-green-600 font-medium">{tr("{0} 積分/秒", { 0: selectedI2VMeta.per720 })}</div>
                    </button>
                    <button
                      onClick={() => setVideoResolution("1080p")}
                      className={`p-3 rounded-lg border-2 text-center transition-all ${
                        videoResolution === "1080p"
                          ? "border-purple-500 bg-purple-50 text-purple-700"
                          : "border-gray-200 text-gray-600 hover:border-purple-200"
                      }`}
                    >
                      <div className="font-semibold text-sm">1080P</div>
                      <div className="text-xs mt-0.5 text-orange-600 font-medium">{tr("{0} 積分/秒", { 0: selectedI2VMeta.per1080 })}</div>
                    </button>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">{tr("畫面比例")}</Label>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setVideoAspectRatio("16:9")}
                      className={`p-3 rounded-lg border-2 text-center transition-all ${
                        videoAspectRatio === "16:9"
                          ? "border-purple-500 bg-purple-50 text-purple-700"
                          : "border-gray-200 text-gray-600 hover:border-purple-200"
                      }`}
                    >
                      <div className="text-lg mb-1">▬</div>
                      <div className="font-semibold text-sm">16:9</div>
                      <div className="text-xs mt-0.5">{tr("橫向")}</div>
                    </button>
                    <button
                      onClick={() => setVideoAspectRatio("9:16")}
                      className={`p-3 rounded-lg border-2 text-center transition-all ${
                        videoAspectRatio === "9:16"
                          ? "border-purple-500 bg-purple-50 text-purple-700"
                          : "border-gray-200 text-gray-600 hover:border-purple-200"
                      }`}
                    >
                      <div className="text-lg mb-1">▮</div>
                      <div className="font-semibold text-sm">9:16</div>
                      <div className="text-xs mt-0.5">{tr("直向")}</div>
                    </button>
                    <button
                      onClick={() => setVideoAspectRatio("1:1")}
                      className={`p-3 rounded-lg border-2 text-center transition-all ${
                        videoAspectRatio === "1:1"
                          ? "border-purple-500 bg-purple-50 text-purple-700"
                          : "border-gray-200 text-gray-600 hover:border-purple-200"
                      }`}
                    >
                      <div className="text-lg mb-1">■</div>
                      <div className="font-semibold text-sm">1:1</div>
                      <div className="text-xs mt-0.5">{tr("方形")}</div>
                    </button>
                  </div>
                </div>

                {extraRatios.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 -mt-2" data-testid="t2v-extra-ratios">
                    {extraRatios.map(r => (
                      <button key={r} onClick={() => setVideoAspectRatio(r)}
                        className={`p-2.5 rounded-lg border-2 text-center transition-all ${videoAspectRatio === r ? "border-purple-500 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-600 hover:border-purple-200"}`}>
                        <div className="font-semibold text-sm">{r}</div>
                        <div className="text-xs mt-0.5">{EXTRA_RATIO_LABEL[r] ?? ""}</div>
                      </button>
                    ))}
                  </div>
                )}

                <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-sm text-purple-700 flex items-center gap-2">
                  <i className="fas fa-info-circle"></i>
                  {tr("影片生成需要 1-3 分鐘，費用：{0} 積分", { 0: Math.round(videoDuration * videoPerSec) })}
                </div>

                <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl">
                  <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                    <i className="fas fa-coins text-yellow-500"></i>
                    {tr("影片生成費用說明")}
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                      <div className="font-semibold text-gray-700">{tr("720P 標準畫質")}</div>
                      <div className="text-green-600 font-bold text-base mt-1">{tr("{0} 積分/秒", { 0: selectedI2VMeta.per720 })}</div>
                      <div className="text-gray-400 mt-0.5">{tr("適合一般用途、社群分享")}</div>
                    </div>
                    <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                      <div className="font-semibold text-gray-700">{tr("1080P 高畫質")}</div>
                      <div className="text-orange-600 font-bold text-base mt-1">{tr("{0} 積分/秒", { 0: selectedI2VMeta.per1080 })}</div>
                      <div className="text-gray-400 mt-0.5">{tr("適合專業製作、高品質需求")}</div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                    <i className="fas fa-calculator"></i>
                    {tr("計算方式：影片秒數 × 每秒積分 = 總費用（支援 4-12 秒）")}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ============ IMAGE-TO-VIDEO INPUT ============ */}
          {mode === "image-to-video" && (
            <Card className="bg-white rounded-3xl border border-indigo-100">
              <CardContent className="p-6 space-y-5">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <i className="fas fa-video text-purple-500"></i>
                  {tr("圖片生影片")}
                </h2>
              
                {!uploadedImageUrl ? (
                  <div className="space-y-2">
                    <UnifiedUploader
                    maxNumberOfFiles={1} maxFileSize={10485760}
                    onGetUploadParameters={handleGetUploadParameters}
                    onComplete={handleUploadComplete}
                    onError={handleUploadError}
                    className="w-full"
                  >
                    {tr("拖放圖片到此處或點擊瀏覽")}
                  </UnifiedUploader>
                    <button type="button" onClick={() => setVaultPickerOpen(true)} className="w-full h-11 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 hover:border-indigo-300" data-testid="button-from-vault">
                      <i className="fas fa-photo-film mr-2 text-xs text-slate-400"></i>{tr("從作品選")}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">{tr("來源圖片")}</span>
                        <button className="text-red-500 hover:text-red-700 text-sm flex items-center gap-1" onClick={removeImage}>
                          <i className="fas fa-times"></i>{tr("移除")}
                        </button>
                      </div>
                      <div className="bg-gray-100 rounded-lg overflow-hidden">
                        <img src={uploadedImageUrl} alt="Video source" className="w-full h-48 object-cover" />
                      </div>
                    </div>

                    {/* ── AI 影片模型選擇 ─────────────────────────────── */}
                    <div className="border border-purple-200 bg-purple-50/40 rounded-xl p-4 space-y-2">
                      <Label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                        <i className="fas fa-robot text-purple-500"></i>
                        {tr("AI 影片模型")}
                      </Label>
                      <select
                        value={selectedI2VModel}
                        onChange={(e) => setSelectedI2VModel(e.target.value)}
                        className="w-full px-3 py-2 border border-purple-200 rounded-lg bg-white text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        {I2V_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}（720P {m.per720} {tr("積分/秒 · 1080P")} {m.per1080} {tr("積分/秒）")}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500">{selectedI2VMeta.desc}</p>
                      {!selectedI2VMeta.supportsOmni && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1.5">
                          <i className="fas fa-info-circle mt-0.5"></i>
                          <span>{tr("{0} 以上傳圖片作為首幀生成影片，不支援額外的參考圖片與參考音訊；影片比例會跟隨上傳圖片。{1}", { 0: selectedI2VMeta.label, 1: selectedI2VMeta.audio ? tr("影片自帶音訊。") : "" })}</span>
                        </p>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <Label className="text-sm font-medium text-gray-700">{tr("描述影片動態效果")}</Label>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => enhanceVideoPromptAIMutation.mutate("image-to-video")}
                            disabled={!videoPrompt.trim() || enhanceVideoPromptAIMutation.isPending || enhanceVideoPromptClaudeMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {enhanceVideoPromptAIMutation.isPending ? (
                              <><i className="fas fa-spinner fa-spin text-xs"></i> {tr("優化中...")}</>
                            ) : (
                              <><i className="fas fa-magic text-xs"></i> {tr("①AI優化")}</>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => enhanceVideoPromptClaudeMutation.mutate("image-to-video")}
                            disabled={!videoPrompt.trim() || enhanceVideoPromptAIMutation.isPending || enhanceVideoPromptClaudeMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {enhanceVideoPromptClaudeMutation.isPending ? (
                              <><i className="fas fa-spinner fa-spin text-xs"></i> {tr("優化中...")}</>
                            ) : (
                              <><i className="fas fa-robot text-xs"></i> {tr("②Seed優化")}</>
                            )}
                          </button>
                        </div>
                      </div>
                      <Textarea 
                        placeholder={tr("例如：高速穿越障礙物，帶來沉浸式的飛行體驗")}
                        value={videoPrompt}
                        onChange={(e) => setVideoPrompt(e.target.value)}
                        className="w-full min-h-[100px] px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                      />
                      <p className="text-xs text-gray-400 mt-1">{tr("描述您希望圖片如何變成動態影片 ・先①AI優化讓描述更豐富，再②Seed優化轉為英文專業格式")}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium text-gray-700">{tr("影片長度")}</Label>
                        <div className="mt-2 space-y-2">
                          <input
                            type="range"
                            min={4}
                            max={12}
                            step={1}
                            value={videoDuration}
                            onChange={(e) => setVideoDuration(parseInt(e.target.value))}
                            className="w-full h-2 bg-purple-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                          />
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-500">{tr("4秒")}</span>
                            <span className="text-lg font-bold text-purple-700">{tr("{0} 秒", { 0: videoDuration })}</span>
                            <span className="text-sm text-gray-500">{tr("12秒")}</span>
                          </div>
                          <div className="text-center text-sm font-medium text-purple-600 bg-purple-50 rounded-lg py-1.5">
                            {Math.round(videoDuration * videoPerSec)} {tr("積分（")}{videoDuration}{tr("秒 ×")} {videoPerSec}{tr("積分/秒）")}
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-gray-700">{tr("鏡頭模式")}</Label>
                        <div className="mt-1.5 grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setCameraFixed(false)}
                            className={`p-3 rounded-lg border-2 text-center transition-all ${
                              !cameraFixed 
                                ? "border-purple-500 bg-purple-50 text-purple-700" 
                                : "border-gray-200 text-gray-600 hover:border-purple-200"
                            }`}
                          >
                            <div className="font-semibold text-sm">{tr("動態鏡頭")}</div>
                            <div className="text-xs mt-0.5">{tr("自動運鏡")}</div>
                          </button>
                          <button
                            onClick={() => setCameraFixed(true)}
                            className={`p-3 rounded-lg border-2 text-center transition-all ${
                              cameraFixed 
                                ? "border-purple-500 bg-purple-50 text-purple-700" 
                                : "border-gray-200 text-gray-600 hover:border-purple-200"
                            }`}
                          >
                            <div className="font-semibold text-sm">{tr("固定鏡頭")}</div>
                            <div className="text-xs mt-0.5">{tr("穩定畫面")}</div>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-medium text-gray-700">{tr("影片解析度")}</Label>
                      <div className="mt-1.5 grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setVideoResolution("720p")}
                          className={`p-3 rounded-lg border-2 text-center transition-all ${
                            videoResolution === "720p"
                              ? "border-purple-500 bg-purple-50 text-purple-700"
                              : "border-gray-200 text-gray-600 hover:border-purple-200"
                          }`}
                        >
                          <div className="font-semibold text-sm">720P</div>
                          <div className="text-xs mt-0.5 text-green-600 font-medium">{tr("{0} 積分/秒", { 0: selectedI2VMeta.per720 })}</div>
                        </button>
                        <button
                          onClick={() => setVideoResolution("1080p")}
                          className={`p-3 rounded-lg border-2 text-center transition-all ${
                            videoResolution === "1080p"
                              ? "border-purple-500 bg-purple-50 text-purple-700"
                              : "border-gray-200 text-gray-600 hover:border-purple-200"
                          }`}
                        >
                          <div className="font-semibold text-sm">1080P</div>
                          <div className="text-xs mt-0.5 text-orange-600 font-medium">{tr("{0} 積分/秒", { 0: selectedI2VMeta.per1080 })}</div>
                        </button>
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-medium text-gray-700">{tr("畫面比例")}</Label>
                      <div className="mt-1.5 grid grid-cols-3 gap-2">
                        <button
                          onClick={() => setVideoAspectRatio("16:9")}
                          className={`p-3 rounded-lg border-2 text-center transition-all ${
                            videoAspectRatio === "16:9"
                              ? "border-purple-500 bg-purple-50 text-purple-700"
                              : "border-gray-200 text-gray-600 hover:border-purple-200"
                          }`}
                        >
                          <div className="text-lg mb-1">▬</div>
                          <div className="font-semibold text-sm">16:9</div>
                          <div className="text-xs mt-0.5">{tr("橫向")}</div>
                        </button>
                        <button
                          onClick={() => setVideoAspectRatio("9:16")}
                          className={`p-3 rounded-lg border-2 text-center transition-all ${
                            videoAspectRatio === "9:16"
                              ? "border-purple-500 bg-purple-50 text-purple-700"
                              : "border-gray-200 text-gray-600 hover:border-purple-200"
                          }`}
                        >
                          <div className="text-lg mb-1">▮</div>
                          <div className="font-semibold text-sm">9:16</div>
                          <div className="text-xs mt-0.5">{tr("直向")}</div>
                        </button>
                        <button
                          onClick={() => setVideoAspectRatio("1:1")}
                          className={`p-3 rounded-lg border-2 text-center transition-all ${
                            videoAspectRatio === "1:1"
                              ? "border-purple-500 bg-purple-50 text-purple-700"
                              : "border-gray-200 text-gray-600 hover:border-purple-200"
                          }`}
                        >
                          <div className="text-lg mb-1">■</div>
                          <div className="font-semibold text-sm">1:1</div>
                          <div className="text-xs mt-0.5">{tr("方形")}</div>
                        </button>
                      </div>
                    </div>

                    <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-sm text-purple-700 flex items-center gap-2">
                      <i className="fas fa-info-circle"></i>
                      {tr("影片生成需要 1-3 分鐘，費用：{0} 積分", { 0: Math.round(videoDuration * (videoResolution === "720p" ? selectedI2VMeta.per720 : selectedI2VMeta.per1080)) })}
                    </div>

                    <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl">
                      <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                        <i className="fas fa-coins text-yellow-500"></i>
                        {tr("影片生成費用說明（依當前模型）")}
                      </h4>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                          <div className="font-semibold text-gray-700">{tr("720P 標準畫質")}</div>
                          <div className="text-green-600 font-bold text-base mt-1">{tr("{0} 積分/秒", { 0: selectedI2VMeta.per720 })}</div>
                          <div className="text-gray-400 mt-0.5">{tr("適合一般用途、社群分享")}</div>
                        </div>
                        <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                          <div className="font-semibold text-gray-700">{tr("1080P 高畫質")}</div>
                          <div className="text-orange-600 font-bold text-base mt-1">{tr("{0} 積分/秒", { 0: selectedI2VMeta.per1080 })}</div>
                          <div className="text-gray-400 mt-0.5">{tr("適合專業製作、高品質需求")}</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                        <i className="fas fa-calculator"></i>
                        {tr("計算方式：影片秒數 × 每秒積分 = 總費用（支援 4-12 秒）")}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Watermark Toggle */}
          {!isVideoMode && (
          <div className={`bg-white rounded-xl border p-4 ${!watermark ? "border-orange-300 bg-orange-50/30" : "border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <i className={`fas fa-stamp ${!watermark ? "text-orange-500" : "text-gray-400"}`}></i>
                <div>
                  <span className="text-sm font-medium text-gray-700">{tr("浮水印")}</span>
                  <p className="text-xs text-gray-400">
                    {watermark ? tr("生成圖片會包含浮水印") : tr("已移除浮水印（每張 +5 積分）")}
                  </p>
                </div>
              </div>
              <button
                role="switch" aria-checked={watermark}
                onClick={() => {
                  if (watermark) {
                    setDisclaimerAgreed(false);
                    setShowWatermarkDisclaimer(true);
                  } else {
                    setWatermark(true);
                  }
                }}
                className={`relative w-11 h-6 rounded-full transition-colors ${watermark ? 'bg-blue-500' : 'bg-orange-500'}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${watermark ? 'translate-x-5' : ''}`} />
              </button>
            </div>
            {!watermark && (
              <div className="mt-2 text-xs text-orange-600 bg-orange-100 rounded-lg px-3 py-1.5 flex items-center gap-1.5">
                <i className="fas fa-coins"></i>
                {tr("去除浮水印：每張圖片額外 +{0} 積分（共 {1} 積分/張）", { 0: removalHere(), 1: priceHere(false) })}
              </div>
            )}
          </div>
          )}

          {/* Watermark Removal Disclaimer Dialog */}
          <Dialog open={showWatermarkDisclaimer} onOpenChange={setShowWatermarkDisclaimer}>
            <DialogContent className="sm:max-w-md">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                    <i className="fas fa-exclamation-triangle text-orange-500"></i>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{tr("去除浮水印 — 免責聲明")}</h3>
                    <p className="text-xs text-gray-500">{tr("請詳閱以下條款後勾選同意")}</p>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 space-y-2 max-h-48 overflow-y-auto border">
                  <p><strong>{tr("1. 額外費用：")}</strong>{tr("去除浮水印將對每張圖片額外收取 {0} 積分（原價 {1} 積分 + 去浮水印 {2} 積分 = 每張 {3} 積分）。", { 0: removalHere(), 1: priceHere(true), 2: removalHere(), 3: priceHere(false) })}</p>
                  <p><strong>{tr("2. 版權責任：")}</strong>{tr("去除浮水印後的圖片，使用者須自行承擔所有版權及法律責任。本平台不對去除浮水印後圖片的使用方式及其衍生之任何法律糾紛負責。")}</p>
                  <p><strong>{tr("3. 商業使用：")}</strong>{tr("使用者將去浮水印圖片用於商業用途時，應確保內容不侵犯第三方權益，並遵守相關法律法規。")}</p>
                  <p><strong>{tr("4. 禁止濫用：")}</strong>{tr("嚴禁將去浮水印圖片用於任何違法、侵權、詐騙、冒名或損害他人名譽之用途。")}</p>
                  <p><strong>{tr("5. 免責範圍：")}</strong>{tr("本平台（極電行銷整合）僅提供 AI 圖片生成技術服務，對生成內容之後續使用不承擔任何直接或間接責任。")}</p>
                </div>

                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <Checkbox
                    checked={disclaimerAgreed}
                    onCheckedChange={(checked) => setDisclaimerAgreed(checked === true)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-gray-700">{tr("我已閱讀並同意上述免責聲明條款，了解去除浮水印的額外費用及相關責任。")}</span>
                </label>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setShowWatermarkDisclaimer(false);
                      setDisclaimerAgreed(false);
                    }}
                  >
                    {tr("取消")}
                  </Button>
                  <Button
                    className="flex-1 bg-orange-500 hover:bg-orange-600 text-white"
                    disabled={!disclaimerAgreed}
                    onClick={() => {
                      setWatermark(false);
                      setShowWatermarkDisclaimer(false);
                    }}
                  >
                    <i className="fas fa-check mr-2"></i>
                    {tr("確認去除浮水印")}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* ============ STORY HISTORY + FORM ============ */}
          {isStoryMode && !isStoryGenerating && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => { setShowStoryHistory(v => !v); }}
                className="flex items-center gap-2 text-sm text-emerald-700 hover:text-emerald-900 font-medium transition-colors"
              >
                <i className={`fas fa-${showStoryHistory ? "chevron-up" : "history"}`}></i>
                {showStoryHistory ? tr("收起歷史記錄") : tr("我的故事歷史")}
              </button>
            </div>
          )}
          {isStoryMode && showStoryHistory && !isStoryGenerating && (
            <Card className="bg-white rounded-3xl border border-indigo-100">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <i className="fas fa-history text-emerald-600"></i>{tr("故事歷史紀錄")}
                  <span className="text-xs font-normal text-gray-400">{tr("（點擊可重新載入查看）")}</span>
                </h3>
                {storyHistory.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">{tr("尚無故事紀錄")}</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {storyHistory.map(story => {
                      const scenes: StoryScene[] = (() => { try { return JSON.parse(story.scenes || "[]"); } catch { return []; } })();
                      const thumb = scenes.find(s => s.bunnyUrl || s.imageUrl);
                      const doneCount = scenes.filter(s => s.status === "completed").length;
                      return (
                        <div
                          key={story.id}
                          className={`rounded-xl overflow-hidden border cursor-pointer hover:shadow-md transition-shadow ${
                            story.id === currentStoryId ? "border-emerald-400 ring-2 ring-emerald-200" : "border-gray-200"
                          }`}
                          onClick={() => {
                            setCurrentStoryId(story.id);
                            setStoryAnimationJobs([]);
                            setShowStoryHistory(false);
                          }}
                        >
                          {thumb ? (
                            <img src={thumb.bunnyUrl || thumb.imageUrl} className="w-full aspect-square object-cover" alt={story.title} />
                          ) : (
                            <div className="w-full aspect-square bg-emerald-50 flex items-center justify-center">
                              <i className="fas fa-book-open text-emerald-300 text-2xl"></i>
                            </div>
                          )}
                          <div className="p-2">
                            <p className="text-xs font-semibold text-gray-700 truncate">{story.title}</p>
                            <div className="flex items-center justify-between mt-0.5">
                              <span className={`text-xs ${
                                story.status === "completed" ? "text-emerald-600" :
                                story.status === "generating" ? "text-blue-500" :
                                story.status === "failed" ? "text-red-500" : "text-gray-400"
                              }`}>
                                {story.status === "completed" ? tr("✓ {0}幕完成", { 0: doneCount }) :
                                 story.status === "generating" ? tr("生成中...") :
                                 story.status === "failed" ? tr("失敗") : tr("等待中")}
                              </span>
                              <span className="text-xs text-gray-400">{new Date(story.createdAt!).toLocaleDateString(dateLocale())}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {isStoryMode && !isStoryGenerating && storyGeneration?.status !== "completed" && (
            <Card className="bg-white rounded-3xl border border-indigo-100">
              <CardContent className="p-6 space-y-5">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <span className="text-xl">📖</span>
                  {tr("故事分鏡設定")}
                </h2>

                {/* Story Title */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">{tr("故事標題")}</Label>
                  <Input
                    placeholder={tr("例如：神秘森林的冒險")}
                    value={storyTitle}
                    onChange={e => setStoryTitle(e.target.value)}
                    className="rounded-xl border-gray-200 focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Story Full Content */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    {tr("故事內容（選填）")}
                    <InfoTooltip text={tr("貼上已寫好的故事全文，Seed 會根據內容自動生成更精準的場景描述與圖片提示詞")} />
                  </Label>
                  <Textarea
                    rows={4}
                    placeholder={tr("貼上你已經寫好的故事內容（例如劇本、腳本、故事大綱），Seed 優化提示詞時會參考此內容...")}
                    value={storyContent}
                    onChange={e => setStoryContent(e.target.value)}
                    className="resize-y text-sm border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Style Selection */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    {tr("畫風選擇")}
                    <InfoTooltip text={tr("選擇整個故事的統一畫面風格，每幕圖片都會套用此風格")} />
                  </Label>
                  <div className="grid grid-cols-3 gap-2">
                    {STORY_STYLES.map(s => (
                      <button
                        key={s.value}
                        onClick={() => setStoryStyle(s.value)}
                        className={`p-2.5 rounded-xl border-2 text-xs font-medium transition-all text-left ${
                          storyStyle === s.value
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/30 text-gray-600"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {storyStyle === "custom" && (
                    <Input
                      className="mt-2 rounded-xl border-gray-200 focus:ring-2 focus:ring-emerald-500"
                      placeholder={tr("請描述自訂畫風（英文效果最佳）")}
                      value={storyCustomStyle}
                      onChange={e => setStoryCustomStyle(e.target.value)}
                    />
                  )}
                </div>

                {/* Scene Count */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    {tr("場景數量（{0} 幕，共 {1} 積分）", { 0: storySceneCount, 1: storySceneCount * IMAGE_COST })}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                      <button
                        key={n}
                        onClick={() => updateStorySceneCount(n)}
                        className={`w-9 h-9 rounded-lg border-2 text-sm font-semibold transition-all ${
                          storySceneCount === n
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-gray-200 hover:border-emerald-200 text-gray-600"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scene Size */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    {tr("場景圖比例")}
                    <InfoTooltip text={tr("選擇生成圖片的尺寸比例，手機直向適合短影音、IG 限時動態；正方形適合社群貼文；橫向適合桌面或影片截圖")} />
                  </Label>
                  <div className="flex gap-2">
                    {[
                      { value: "1:1" as const, label: "1:1", sub: tr("正方形"), icon: "⬜" },
                      { value: "9:16" as const, label: "9:16", sub: tr("手機直向"), icon: "📱" },
                      { value: "16:9" as const, label: "16:9", sub: tr("橫向寬屏"), icon: "🖥️" },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setStorySceneSize(opt.value)}
                        className={`flex-1 py-2.5 px-2 rounded-xl border-2 text-xs font-medium transition-all text-center ${
                          storySceneSize === opt.value
                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                            : "border-gray-200 hover:border-emerald-200 hover:bg-emerald-50/30 text-gray-600"
                        }`}
                      >
                        <div className="text-base mb-0.5">{opt.icon}</div>
                        <div className="font-semibold">{opt.label}</div>
                        <div className="text-[10px] opacity-70">{opt.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Global Seed */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1">
                    {tr("角色種子（選填）")}
                    <InfoTooltip text={tr("鎖定同一個種子數字，讓所有幕的角色外觀更加一致。可手動輸入或隨機產生，建議記下來供下集使用。")} />
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder={tr("1000 – 999999（空白 = 隨機）")}
                      value={storySeed}
                      min={1000}
                      max={999999}
                      onChange={e => {
                        const v = e.target.value;
                        if (v === "") setStorySeed("");
                        else {
                          const n = parseInt(v);
                          if (!isNaN(n) && n >= 1000 && n <= 999999) setStorySeed(n);
                        }
                      }}
                      className="flex-1 rounded-xl border-gray-200 focus:ring-2 focus:ring-emerald-500 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setStorySeed(Math.floor(Math.random() * 999000) + 1000)}
                      className="px-3 py-2 rounded-xl border-2 border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 transition-all whitespace-nowrap"
                    >
                      {tr("🎲 隨機")}
                    </button>
                    {storySeed !== "" && (
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(String(storySeed)); toast({ title: tr("已複製種子"), description: tr("種子 {0} 已複製到剪貼簿", { 0: storySeed }) }); }}
                        className="px-3 py-2 rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-600 text-xs font-medium hover:bg-gray-100 transition-all whitespace-nowrap"
                      >
                        {tr("📋 複製")}
                      </button>
                    )}
                    {storySeed !== "" && (
                      <button
                        type="button"
                        onClick={() => setStorySeed("")}
                        className="px-2 py-2 rounded-xl border-2 border-gray-200 text-gray-400 text-xs hover:bg-gray-50 transition-all"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Reference Images - three categories */}
                {(
                  [
                    { label: tr("角色 A 外貌"), sub: tr("保持每幕角色 A 外貌一致"), icon: "🧑", images: storyCharacterImages, setter: setStoryCharacterImages, handler: handleCharacterImageUpload, color: "violet" },
                    { label: tr("角色 B 外貌"), sub: tr("保持每幕角色 B 外貌一致（選填）"), icon: "🧑‍🦱", images: storyCharacterBImages, setter: setStoryCharacterBImages, handler: handleCharacterBImageUpload, color: "orange" },
                    { label: tr("場景參考圖"), sub: tr("構圖、場景、環境風格"), icon: "🏞️", images: storySceneRefImages, setter: setStorySceneRefImages, handler: handleSceneRefImageUpload, color: "blue" },
                    { label: tr("畫風參考圖"), sub: tr("整體美術風格與質感"), icon: "🎨", images: storyStyleImages, setter: setStoryStyleImages, handler: handleStyleImageUpload, color: "pink" },
                  ] as const
                ).map(({ label, sub, icon, images, setter, handler, color }) => (
                  <div key={label} className={`p-3 rounded-xl border-2 ${
                    images.length > 0
                      ? color === "violet" ? "border-violet-200 bg-violet-50/40"
                        : color === "orange" ? "border-orange-200 bg-orange-50/40"
                        : color === "blue" ? "border-blue-200 bg-blue-50/40"
                        : "border-pink-200 bg-pink-50/40"
                      : "border-gray-100 bg-gray-50/50"
                  }`}>
                    <Label className="text-sm font-medium text-gray-700 mb-1.5 flex items-center gap-1.5">
                      <span>{icon}</span>
                      <span>{label}</span>
                      <span className="text-xs text-gray-400 font-normal">{tr("（選填，最多 2 張）")}</span>
                      <InfoTooltip text={tr("上傳「{0}」參考圖，AI 將在生成每幕時參考此圖的{1}", { 0: label, 1: sub })} />
                    </Label>
                    {images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {images.map((img, idx) => (
                          <div key={idx} className="relative group">
                            <img
                              src={img.url.startsWith("/objects/") ? img.url : `/objects/${img.url.replace(/^\//, "")}`}
                              alt={`${label} ${idx + 1}`}
                              className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                              onError={e => { (e.target as HTMLImageElement).src = "https://placehold.co/64?text=%E5%9C%96" }}
                            />
                            <button
                              onClick={() => setter(prev => prev.filter((_, i) => i !== idx))}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}
                    {images.length < 2 && (
                      <UnifiedUploader
                        maxNumberOfFiles={2 - images.length}
                        maxFileSize={10485760}
                        onGetUploadParameters={handleGetUploadParameters}
                        onComplete={handler}
                        className="w-full"
                      >
                        {tr("點擊上傳{0}（{1}/2）", { 0: label, 1: images.length })}
                      </UnifiedUploader>
                    )}
                  </div>
                ))}

                {/* Scene Cards */}
                <div>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <Label className="text-sm font-medium text-gray-700">
                      {tr("各幕場景描述")}
                    </Label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Step indicator */}
                      <span className="hidden sm:flex items-center gap-1 text-[10px] text-gray-400 mr-1">
                        <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold flex items-center justify-center">1</span>
                        {tr("AI 中文大綱")}
                        <span className="text-gray-300">→</span>
                        <span className="w-4 h-4 rounded-full bg-violet-100 text-violet-700 text-[9px] font-bold flex items-center justify-center">2</span>
                        {tr("Seed 加強")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (!storyTitle.trim()) {
                            toast({ title: tr("請先填寫故事標題"), variant: "destructive" });
                            return;
                          }
                          claudeOutlineMutation.mutate();
                        }}
                        disabled={claudeOutlineMutation.isPending || claudeEnhanceMutation.isPending}
                        title={tr("第一步：AI 依起承轉合結構自動生成中文分鏡大綱")}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {claudeOutlineMutation.isPending ? (
                          <><div className="w-3 h-3 border border-emerald-600 border-t-transparent rounded-full animate-spin" />{tr("生成中...")}</>
                        ) : (
                          <><span className="text-emerald-500 mr-0.5">①</span> {tr("AI 生成大綱")}</>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!storyTitle.trim()) {
                            toast({ title: tr("請先填寫故事標題"), variant: "destructive" });
                            return;
                          }
                          if (storyScenes.slice(0, storySceneCount).some(s => !s.title.trim() && !s.description.trim())) {
                            toast({ title: tr("請至少填寫場景標題或描述"), variant: "destructive" });
                            return;
                          }
                          claudeEnhanceMutation.mutate();
                        }}
                        disabled={claudeEnhanceMutation.isPending || claudeOutlineMutation.isPending}
                        title={tr("第二步：Seed 將中文大綱加強為專業英文提示詞，保留起承轉合節奏")}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 hover:border-violet-300 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {claudeEnhanceMutation.isPending ? (
                          <>
                            <div className="w-3 h-3 border border-violet-600 border-t-transparent rounded-full animate-spin" />
                            {tr("Seed 生成中...")}
                          </>
                        ) : (
                          <><span className="text-violet-400 mr-0.5">②</span> {tr("Seed 加強提示詞")}</>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {storyScenes.slice(0, storySceneCount).map((scene, idx) => {
                      const nInfo = getNarrativeInfo(idx, storySceneCount);
                      return (
                      <div
                        key={idx}
                        draggable
                        onDragStart={() => setDragSourceIdx(idx)}
                        onDragOver={e => { e.preventDefault(); }}
                        onDrop={e => {
                          e.preventDefault();
                          if (dragSourceIdx === null || dragSourceIdx === idx) return;
                          setStoryScenes(prev => {
                            const arr = [...prev];
                            const [removed] = arr.splice(dragSourceIdx, 1);
                            arr.splice(idx, 0, removed);
                            return arr;
                          });
                          setDragSourceIdx(null);
                        }}
                        onDragEnd={() => setDragSourceIdx(null)}
                        className={`border rounded-xl p-4 space-y-2 transition-all cursor-grab active:cursor-grabbing ${
                          dragSourceIdx === idx
                            ? `opacity-50 ${nInfo.border} ${nInfo.bg}`
                            : `border-gray-200 hover:${nInfo.border}`
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <i className="fas fa-grip-vertical text-gray-300 text-sm flex-shrink-0 cursor-grab" />
                          <span className="w-7 h-7 bg-emerald-100 text-emerald-700 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {idx + 1}
                          </span>
                          <span
                            title={nInfo.label}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0 border ${nInfo.bg} ${nInfo.color} ${nInfo.border}`}
                          >
                            <span>{nInfo.icon}</span>
                            <span>{nInfo.short}</span>
                          </span>
                          <Input
                            value={scene.title}
                            onChange={e => updateStoryScene(idx, "title", e.target.value)}
                            className="text-sm font-medium border-none p-0 h-auto focus:ring-0 shadow-none text-gray-700"
                            placeholder={tr("第 {0} 幕標題", { 0: idx + 1 })}
                          />
                        </div>
                        <div className="flex gap-2">
                          <div className="flex flex-col gap-1.5 flex-1">
                            <Textarea
                              rows={2}
                              value={scene.description}
                              onChange={e => updateStoryScene(idx, "description", e.target.value)}
                              placeholder={tr("描述第 {0} 幕的場景內容（例如：主角站在山頂俯瞰整個城市，夕陽西下）", { 0: idx + 1 })}
                              className="resize-none text-sm border-gray-100 bg-gray-50 rounded-lg focus:ring-2 focus:ring-emerald-500"
                            />
                            <div className="relative">
                              <span className="absolute left-2 top-1.5 text-[10px] text-amber-500 font-semibold pointer-events-none">💬</span>
                              <input
                                type="text"
                                value={scene.dialogue || ""}
                                onChange={e => updateStoryScene(idx, "dialogue", e.target.value)}
                                placeholder={tr("台詞（選填）：角色說的話...")}
                                className="w-full pl-6 pr-2 py-1.5 text-xs border border-amber-100 bg-amber-50/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-300 placeholder:text-gray-300 text-gray-700"
                              />
                            </div>
                          </div>
                          <div className="flex-shrink-0">
                            {scene.sceneReferenceImageUrl ? (
                              <div className="relative group w-16 h-16">
                                <img
                                  src={scene.sceneReferenceImageUrl.startsWith("/objects/") ? scene.sceneReferenceImageUrl : `/objects/${scene.sceneReferenceImageUrl.replace(/^\//, "")}`}
                                  alt={tr("場景參考")}
                                  className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                                  onError={e => { (e.target as HTMLImageElement).src = "https://placehold.co/64?text=%E5%9C%96" }}
                                />
                                <button
                                  onClick={() => updateStoryScene(idx, "sceneReferenceImageUrl", "")}
                                  className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >×</button>
                              </div>
                            ) : (
                              <label className="w-16 h-16 border-2 border-dashed border-gray-200 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-colors group">
                                {sceneUploadingIdx === idx ? (
                                  <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <>
                                    <svg className="w-5 h-5 text-gray-300 group-hover:text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                                    <span className="text-[9px] text-gray-400 group-hover:text-emerald-600 mt-0.5">{tr("上傳")}</span>
                                  </>
                                )}
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png"
                                  className="hidden"
                                  onChange={e => {
                                    const file = e.target.files?.[0];
                                    if (file) handleSceneImageSelect(idx, file);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      </div>
                    ); })}
                  </div>
                </div>

                <p className="text-xs text-gray-400">
                  <i className="fas fa-info-circle mr-1"></i>
                  {tr("故事生成按順序逐幕進行，共需 {0} 積分（每幕 {1} 積分）。生成中可即時看到各幕進度。", { 0: storySceneCount * IMAGE_COST, 1: IMAGE_COST })}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Generate Button */}
          <div className="flex flex-col items-center gap-3">
            <Button
              onClick={handleGenerate}
              disabled={
                isStoryMode ? (isStoryGenerating || !hasEnoughCredits || storyScenes.slice(0, storySceneCount).some(s => !s.description.trim()) || !storyTitle.trim()) :
                (mode === "image-to-image" && !uploadedImagePath) ||
                (mode === "image-to-image" && !isBatchMode && !prompt.trim()) ||
                (mode === "image-to-image" && isBatchMode && batchPrompts.filter(p => p.trim()).length < 2) ||
                (mode === "text-to-image" && !textPrompt.trim()) ||
                (mode === "text-to-video" && !videoPrompt.trim()) ||
                (mode === "image-to-video" && (!uploadedImagePath || !videoPrompt.trim())) ||
                isGenerating || !hasEnoughCredits
              }
              className={`${isStoryMode ? "bg-emerald-600 hover:bg-emerald-700" : isVideoMode ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700"} text-white font-semibold px-10 py-4 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3 text-base`}
            >
              {isStoryMode ? (
                isStoryGenerating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>{tr("正在生成故事...")}</span>
                  </>
                ) : storyGeneration?.status === "completed" ? (
                  <>
                    <i className="fas fa-redo"></i>
                    <span>{tr("重新生成故事")}</span>
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    <span>{tr("生成故事（{0} 幕）", { 0: storySceneCount })}</span>
                    <span className="text-sm bg-emerald-500 px-2.5 py-0.5 rounded-full">{tr("{0} 積分", { 0: creditsNeeded })}</span>
                  </>
                )
              ) : isGenerating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>
                    {isVideoMode ? tr("正在生成影片...") 
                      : isBatchMode ? tr("正在生成 {0} 張圖片...", { 0: batchCount })
                      : isSequentialMode ? tr("正在生成 {0} 張圖片...", { 0: sequentialCount })
                      : isI2ISequentialMode ? tr("正在生成 {0} 張圖片...", { 0: i2iSequentialCount })
                      : tr("生成中...")}
                  </span>
                </>
              ) : (
                <>
                  <i className={`fas ${isVideoMode ? "fa-video" : "fa-magic"}`}></i>
                  <span>
                    {isVideoMode ? tr("生成影片")
                      : mode === "text-to-image" 
                        ? isSequentialMode ? tr("生成 {0} 張序列圖片", { 0: sequentialCount }) : tr("生成圖片") 
                        : isBatchMode ? tr("批次生成 {0} 張", { 0: batchCount })
                        : isI2ISequentialMode && isMultiImageMode ? tr("多圖序列生成 {0} 張", { 0: i2iSequentialCount })
                        : isI2ISequentialMode ? tr("序列生成 {0} 張", { 0: i2iSequentialCount })
                        : isMultiImageMode ? tr("多圖融合生成")
                        : tr("生成 AI 編輯")}
                  </span>
                  <span className={`text-sm ${isVideoMode ? "bg-purple-500" : "bg-blue-500"} px-2.5 py-0.5 rounded-full`}>
                    {creditsNeeded} {tr("積分")}
                  </span>
                </>
              )}
            </Button>
            {!hasEnoughCredits && (
              <p className="text-red-500 text-sm flex items-center gap-1">
                <i className="fas fa-exclamation-triangle"></i>
                {tr("積分不足！需要 {0} 積分，目前餘額 {1} 積分。", { 0: creditsNeeded, 1: user?.credits ?? 0 })}
                <a href="/store" className="text-blue-600 underline ml-1">{tr("前往儲值")}</a>
              </p>
            )}
            <p className="text-xs text-gray-400 text-center max-w-md">
              <i className="fas fa-info-circle mr-1"></i>
              {tr("AI 生成為技術交流，如有任何產生社會道德問題，請協尋專業法律諮詢")}
            </p>
          </div>

          {/* Loading State */}
          {isGenerating && (
            <Card className={`rounded-3xl border ${isVideoMode ? "border-indigo-200 bg-indigo-50/40" : "border-indigo-200 bg-indigo-50/40"}`}>
              <CardContent className="p-8">
                <div className="text-center space-y-4">
                  <div className={`w-14 h-14 mx-auto border-4 ${isVideoMode ? "border-purple-500" : "border-blue-500"} border-t-transparent rounded-full animate-spin`} />
                  <h3 className="text-lg font-semibold text-gray-800">
                    {isVideoMode ? tr("正在生成影片") : tr("正在處理您的圖片")}
                  </h3>
                  <p className="text-gray-500 text-sm">
                    {isVideoMode ? tr("影片生成需要 1-3 分鐘，請耐心等待...") : tr("這可能需要一些時間...")}
                  </p>
                  {isVideoMode && videoElapsedSec > 0 && (
                    <p className="text-purple-700 text-sm font-medium">
                      <i className="fas fa-stopwatch mr-1"></i>
                      {tr("已生成 {0}:{1}", { 0: Math.floor(videoElapsedSec / 60), 1: String(videoElapsedSec % 60).padStart(2, "0") })}
                      <span className="text-gray-400 ml-2">{tr("（一般 60–180 秒）")}</span>
                    </p>
                  )}
                  <div className="w-full bg-gray-200 rounded-full h-1.5 max-w-sm mx-auto">
                    <div
                      className={`${isVideoMode ? "bg-purple-500" : "bg-blue-500"} h-1.5 rounded-full transition-all`}
                      style={{
                        width: isVideoMode
                          ? `${Math.min(95, 10 + (videoElapsedSec / 180) * 85)}%`
                          : "45%",
                      }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Error States */}
          {generation?.status === "failed" && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
              <i className="fas fa-exclamation-circle text-red-500 mt-0.5"></i>
              <div className="flex-1">
                <h3 className="text-red-800 font-semibold">{tr("生成失敗")}</h3>
                <p className="text-red-700 text-sm mt-1">{trServer(generation.errorMessage) || tr("無法處理您的圖片，請重試。")}</p>
                <Button variant="ghost" className="text-blue-600 hover:text-blue-800 text-sm p-0 h-auto mt-2" onClick={handleGenerate}>
                  <i className="fas fa-redo mr-1"></i>{tr("重試")}
                </Button>
              </div>
            </div>
          )}

          {videoGeneration?.status === "failed" && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
              <i className="fas fa-exclamation-circle text-red-500 mt-0.5"></i>
              <div className="flex-1">
                <h3 className="text-red-800 font-semibold">{tr("影片生成失敗")}</h3>
                <p className="text-red-700 text-sm mt-1">{trServer(videoGeneration.errorMessage) || tr("無法生成影片，請重試。")}</p>
                <Button variant="ghost" className="text-purple-600 hover:text-purple-800 text-sm p-0 h-auto mt-2" onClick={handleGenerate}>
                  <i className="fas fa-redo mr-1"></i>{tr("重試")}
                </Button>
              </div>
            </div>
          )}

          {/* Video Result */}
          {videoGeneration?.status === "completed" && videoGeneration.generatedVideoUrl && (
            <Card className="bg-white rounded-3xl border border-indigo-100">
              <CardContent className="p-6 space-y-4">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <i className="fas fa-video text-purple-500"></i>
                  {tr("影片生成結果")}
                </h2>
                <div className="bg-gray-900 rounded-lg overflow-hidden">
                  <video controls className="w-full max-h-96" src={videoGeneration.generatedVideoUrl}>
                    {tr("您的瀏覽器不支援影片播放。")}
                  </video>
                </div>
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg text-sm text-purple-700">
                  <span><i className="fas fa-clock mr-1"></i>{tr("影片長度：{0} 秒", { 0: videoGeneration.duration || 5 })}</span>
                  <span className="font-semibold">{tr("費用：{0} 積分（{1}）", { 0: videoGeneration.creditsUsed || Math.round((videoGeneration.duration || 5) * 15), 1: videoGeneration.resolution === "720p" ? "720P" : "1080P" })}</span>
                </div>
                <div className="flex justify-center gap-3">
                  <Button className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg" onClick={() => {
                    const link = document.createElement('a');
                    link.href = videoGeneration.generatedVideoUrl!;
                    link.download = `generated-video-${videoGeneration.id}.mp4`;
                    link.click();
                  }}>
                    <i className="fas fa-download mr-2"></i>{tr("下載影片")}
                  </Button>
                  <Button variant="outline" className="border-purple-300 text-purple-600 hover:bg-purple-50 rounded-lg" onClick={() => {
                    setCurrentVideoGenerationId("");
                    setVideoPrompt("");
                  }}>
                    <i className="fas fa-plus mr-2"></i>{tr("生成新影片")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Single Image Result */}
          {generation?.status === "completed" && generation.generatedImageUrl && !currentBatchId && (
            <Card className="bg-white rounded-3xl border border-indigo-100">
              <CardContent className="p-6">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-4">
                  <i className="fas fa-images text-blue-500"></i>
                  {generation.type === "text-to-image" ? tr("生成結果") : tr("修改前後對比")}
                </h2>
                
                {generation.type === "text-to-image" ? (
                  generation.generatedImageUrls && generation.generatedImageUrls.length > 1 ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">{tr("序列生成結果 ({0} 張)", { 0: generation.generatedImageUrls.length })}</span>
                        <span className="text-sm font-semibold text-blue-600">{tr("{0} 積分", { 0: generation.generatedImageUrls.length * priceHere(generation.watermark !== false) })}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {generation.generatedImageUrls.map((url, index) => (
                          <div key={index} className="space-y-2">
                            <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative group">
                              <img src={url} alt={tr("序列圖片 {0}", { 0: index + 1 })} className="w-full h-full object-cover hover:scale-105 transition-transform" />
                              <span className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">{index + 1}</span>
                            </div>
                            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => {
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = `sequential-image-${index + 1}.png`;
                              link.click();
                            }}>
                              <i className="fas fa-download mr-1"></i>{tr("下載")}
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-center gap-3 pt-3">
                        <Button className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg" onClick={() => {
                          generation.generatedImageUrls?.forEach((url, index) => {
                            setTimeout(() => {
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = `sequential-image-${index + 1}.png`;
                              link.click();
                            }, index * 300);
                          });
                        }}>
                          <i className="fas fa-download mr-2"></i>{tr("下載全部 ({0} 張)", { 0: generation.generatedImageUrls.length })}
                        </Button>
                        <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={handleGenerate}>
                          <i className="fas fa-redo mr-2"></i>{tr("再次生成")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-center">
                      <div className="w-full max-w-2xl space-y-3">
                        <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative group">
                          <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
                            <DialogTrigger asChild>
                              <div className="relative cursor-pointer hover:scale-[1.02] transition-transform" onClick={() => setIsLightboxOpen(true)}>
                                <img src={generation.generatedImageUrl} alt="AI generated" className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-3">
                                    <i className="fas fa-search-plus text-gray-700"></i>
                                  </div>
                                </div>
                              </div>
                            </DialogTrigger>
                            <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 bg-transparent border-0 shadow-none">
                              <div className="relative flex items-center justify-center">
                                <img src={generation.generatedImageUrl} alt="Full size" className="max-w-full max-h-[95vh] object-contain rounded-lg shadow-2xl" />
                                <button onClick={() => setIsLightboxOpen(false)} className="absolute top-4 right-4 bg-white/90 hover:bg-white text-gray-700 rounded-full p-2 shadow-lg">
                                  <i className="fas fa-times"></i>
                                </button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                    </div>
                  )
                ) : (
                  generation.generatedImageUrls && generation.generatedImageUrls.length > 1 ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">{tr("序列生成結果 ({0} 張)", { 0: generation.generatedImageUrls.length })}</span>
                        <span className="text-sm font-semibold text-purple-600">{tr("{0} 積分", { 0: generation.generatedImageUrls.length * priceHere(watermark) })}</span>
                      </div>
                      <div className="mb-3 space-y-1">
                        <h3 className="text-sm font-medium text-gray-600">{tr("原始圖片")}</h3>
                        <div className="bg-gray-100 rounded-lg overflow-hidden w-32 h-32">
                          <img src={uploadedImageUrl} alt="Original" className="w-full h-full object-cover" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {generation.generatedImageUrls.map((url, index) => (
                          <div key={index} className="space-y-2">
                            <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative group">
                              <img src={url} alt={tr("序列圖片 {0}", { 0: index + 1 })} className="w-full h-full object-cover hover:scale-105 transition-transform" />
                              <span className="absolute top-2 left-2 bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">{index + 1}</span>
                            </div>
                            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => {
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = `sequential-image-${index + 1}.png`;
                              link.click();
                            }}>
                              <i className="fas fa-download mr-1"></i>{tr("下載")}
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-center gap-3 pt-3">
                        <Button className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg" onClick={() => {
                          generation.generatedImageUrls?.forEach((url, index) => {
                            setTimeout(() => {
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = `sequential-image-${index + 1}.png`;
                              link.click();
                            }, index * 300);
                          });
                        }}>
                          <i className="fas fa-download mr-2"></i>{tr("下載全部 ({0} 張)", { 0: generation.generatedImageUrls.length })}
                        </Button>
                        <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={handleGenerate}>
                          <i className="fas fa-redo mr-2"></i>{tr("再次生成")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-600 text-center">{tr("原始圖片")}</h3>
                        <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square">
                          <img src={uploadedImageUrl} alt="Original" className="w-full h-full object-cover" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-600 text-center flex items-center justify-center gap-1">
                          {tr("AI 生成結果")}<span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">NEW</span>
                        </h3>
                        <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative group">
                          <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
                            <DialogTrigger asChild>
                              <div className="relative cursor-pointer hover:scale-[1.02] transition-transform" onClick={() => setIsLightboxOpen(true)}>
                                <img src={generation.generatedImageUrl} alt="AI generated" className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-3">
                                    <i className="fas fa-search-plus text-gray-700"></i>
                                  </div>
                                </div>
                              </div>
                            </DialogTrigger>
                            <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 bg-transparent border-0 shadow-none">
                              <div className="relative flex items-center justify-center">
                                <img src={generation.generatedImageUrl} alt="Full size" className="max-w-full max-h-[95vh] object-contain rounded-lg shadow-2xl" />
                                <button onClick={() => setIsLightboxOpen(false)} className="absolute top-4 right-4 bg-white/90 hover:bg-white text-gray-700 rounded-full p-2 shadow-lg">
                                  <i className="fas fa-times"></i>
                                </button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                    </div>
                  )
                )}

                {/* Action Buttons */}
                <div className="mt-5 flex flex-wrap gap-3 justify-center">
                  <Button className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg" onClick={() => {
                    const link = document.createElement('a');
                    link.href = generation.generatedImageUrl!;
                    link.download = `ai-generated-${generation.id}.jpg`;
                    link.click();
                  }}>
                    <i className="fas fa-download mr-2"></i>{tr("下載結果")}
                  </Button>
                  <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={handleGenerate}>
                    <i className="fas fa-redo mr-2"></i>{tr("再次生成")}
                  </Button>
                  <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => {
                    if (navigator.share) {
                      navigator.share({ title: tr("AI 生成的圖片"), url: generation.generatedImageUrl! });
                    }
                  }}>
                    <i className="fas fa-share-alt mr-2"></i>{tr("分享")}
                  </Button>
                </div>

                {/* Generation Details */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <details className="group">
                    <summary className="cursor-pointer text-sm text-gray-500 hover:text-blue-600 flex items-center gap-2">
                      <i className="fas fa-info-circle"></i>
                      {tr("生成詳情")}
                      <i className="fas fa-chevron-down text-xs transform group-open:rotate-180 transition-transform"></i>
                    </summary>
                    <div className="mt-3 text-sm text-gray-600 space-y-1.5 bg-gray-50 rounded-lg p-3">
                      <div className="flex justify-between"><span>{tr("模型")}</span><span className="font-mono text-xs">Seedream 5.5</span></div>
                      <div className="flex justify-between"><span>{tr("描述")}</span><span className="text-xs max-w-[60%] text-right truncate">"{generation.prompt}"</span></div>
                      <div className="flex justify-between"><span>{tr("引導強度")}</span><span>{generation.guidanceScale}</span></div>
                      <div className="flex justify-between"><span>{tr("種子值")}</span><span>{generation.seed}</span></div>
                      <div className="flex justify-between"><span>{tr("處理時間")}</span><span>{generation.processingTime?.toFixed(1)}s</span></div>
                      <div className="flex justify-between"><span>{tr("費用")}</span><span className="font-semibold">{generation.watermark === false ? tr("{0} 積分（含去浮水印）", { 0: priceHere(false) }) : tr("{0} 積分", { 0: priceHere(true) })}</span></div>
                    </div>
                  </details>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Batch Results */}
          {batchData && batchData.generations.some(g => g.status === "completed" && g.generatedImageUrl) && (
            <Card className="bg-white rounded-3xl border border-indigo-100">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                    <i className="fas fa-images text-blue-500"></i>
                    {tr("批次生成結果")}
                  </h2>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">{tr("已完成 {0}/{1}", { 0: batchData.completedCount, 1: batchData.totalCount })}</span>
                    <span className="text-sm font-semibold text-blue-600">{tr("{0} 積分", { 0: batchData.completedCount * priceHere(watermark) })}</span>
                  </div>
                </div>

                {batchData.completedCount < batchData.totalCount && (
                  <div className="mb-4">
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{width: `${(batchData.completedCount / batchData.totalCount) * 100}%`}} />
                    </div>
                  </div>
                )}

                <div className="mb-4 p-3 bg-gray-50 rounded-lg flex items-center gap-3">
                  <div className="w-16 h-16 bg-gray-100 rounded-lg overflow-hidden flex-shrink-0">
                    <img src={uploadedImageUrl} alt="Base" className="w-full h-full object-cover" />
                  </div>
                  <span className="text-sm text-gray-500">{tr("基礎圖片")}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {batchData.generations.map((gen, index) => (
                    <div key={gen.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">{tr("圖片 {0}", { 0: index + 1 })}</span>
                        {gen.status === "completed" && <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><i className="fas fa-check mr-1"></i>{tr("完成")}</span>}
                        {gen.status === "processing" && <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full"><i className="fas fa-spinner fa-spin mr-1"></i>{tr("處理中")}</span>}
                        {gen.status === "failed" && <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">{tr("失敗")}</span>}
                      </div>
                      <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative group">
                        {gen.status === "completed" && gen.generatedImageUrl ? (
                          <Dialog>
                            <DialogTrigger asChild>
                              <div className="relative cursor-pointer hover:scale-[1.02] transition-transform">
                                <img src={gen.generatedImageUrl} alt={`Variation ${index + 1}`} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center">
                                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-2">
                                    <i className="fas fa-search-plus text-gray-700 text-sm"></i>
                                  </div>
                                </div>
                              </div>
                            </DialogTrigger>
                            <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto p-0 bg-transparent border-0 shadow-none">
                              <img src={gen.generatedImageUrl} alt={`Full size ${index + 1}`} className="max-w-full max-h-[95vh] object-contain rounded-lg shadow-2xl" />
                            </DialogContent>
                          </Dialog>
                        ) : gen.status === "processing" ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                          </div>
                        ) : gen.status === "failed" ? (
                          <div className="w-full h-full flex items-center justify-center text-red-400">
                            <i className="fas fa-exclamation-triangle text-2xl"></i>
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300">
                            <i className="fas fa-clock text-2xl"></i>
                          </div>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 p-2 bg-gray-50 rounded-lg truncate">"{gen.prompt}"</p>
                      {gen.status === "completed" && gen.generatedImageUrl && (
                        <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => {
                          const link = document.createElement('a');
                          link.href = gen.generatedImageUrl!;
                          link.download = `ai-batch-${index + 1}.jpg`;
                          link.click();
                        }}>
                          <i className="fas fa-download mr-1"></i>{tr("下載")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                {batchData.completedCount > 0 && (
                  <div className="mt-5 pt-4 border-t border-gray-100 flex flex-wrap gap-3 justify-center">
                    <Button className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg" onClick={() => {
                      batchData.generations.filter(g => g.status === "completed" && g.generatedImageUrl).forEach((gen, idx) => {
                        setTimeout(() => {
                          const link = document.createElement('a');
                          link.href = gen.generatedImageUrl!;
                          link.download = `ai-batch-${idx + 1}.jpg`;
                          link.click();
                        }, idx * 100);
                      });
                    }}>
                      <i className="fas fa-download mr-2"></i>{tr("下載全部 ({0} 張)", { 0: batchData.completedCount })}
                    </Button>
                    <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={handleGenerate}>
                      <i className="fas fa-redo mr-2"></i>{tr("再次生成")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ============ STORY PROGRESS ============ */}
          {isStoryMode && isStoryGenerating && currentStoryId && (
            <Card className="bg-white rounded-3xl border border-indigo-100">
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderWidth: 3 }} />
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-800">{tr("正在生成故事分鏡")}</h3>
                      <p className="text-sm text-gray-500">
                        {(() => {
                          if (!storyGeneration) return tr("初始化中...");
                          const scenes: StoryScene[] = JSON.parse(storyGeneration.scenes || "[]");
                          const done = scenes.filter(s => s.status === "completed").length;
                          const failed = scenes.filter(s => s.status === "failed").length;
                          const total = scenes.length;
                          const generating = scenes.find(s => s.status === "generating");
                          const remaining = total - done - failed;
                          const estSec = remaining * 25;
                          const estText = estSec >= 60 ? tr("約 {0} 分鐘", { 0: Math.ceil(estSec / 60) }) : tr("約 {0} 秒", { 0: estSec });
                          return <>
                            {tr("第")}<span className="font-semibold text-emerald-600">{done + 1}</span> {tr("/ {0} 幕", { 0: total })}
                            {generating ? `「${generating.title}」` : ""}{tr("生成中")}
                            {done > 0 && <span className="text-xs text-gray-400 ml-1">{tr("· 預估剩餘 {0}", { 0: estText })}</span>}
                          </>;
                        })()}
                      </p>
                    </div>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div
                      className="bg-emerald-500 h-2.5 rounded-full transition-all duration-500"
                      style={{
                        width: (() => {
                          if (!storyGeneration) return "5%";
                          const scenes: StoryScene[] = JSON.parse(storyGeneration.scenes || "[]");
                          const done = scenes.filter(s => s.status === "completed").length;
                          return `${Math.max(5, Math.round((done / scenes.length) * 100))}%`;
                        })()
                      }}
                    />
                  </div>
                  {storyGeneration && (() => {
                    const scenes: StoryScene[] = JSON.parse(storyGeneration.scenes || "[]");
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                        {scenes.map((scene, idx) => (
                          <div key={idx} className="rounded-xl overflow-hidden border border-gray-200">
                            {scene.status === "completed" && (scene.bunnyUrl || scene.imageUrl) ? (
                              <img
                                src={scene.bunnyUrl || scene.imageUrl}
                                alt={scene.title}
                                className="w-full aspect-square object-cover"
                              />
                            ) : (
                              <div className="w-full aspect-square bg-gray-100 flex items-center justify-center">
                                {scene.status === "generating" ? (
                                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                                ) : scene.status === "failed" ? (
                                  <i className="fas fa-times-circle text-red-400 text-xl"></i>
                                ) : (
                                  <span className="text-gray-400 text-xs">{tr("第 {0} 幕", { 0: idx + 1 })}</span>
                                )}
                              </div>
                            )}
                            <div className="p-2 bg-white">
                              <p className="text-xs font-medium text-gray-700 truncate">{scene.title || tr("第 {0} 幕", { 0: idx + 1 })}</p>
                              <span className={`text-xs ${
                                scene.status === "completed" ? "text-emerald-600" :
                                scene.status === "generating" ? "text-blue-500" :
                                scene.status === "failed" ? "text-red-500" : "text-gray-400"
                              }`}>
                                {scene.status === "completed" ? tr("✓ 完成") :
                                 scene.status === "generating" ? tr("生成中...") :
                                 scene.status === "failed" ? tr("失敗") : tr("等待中")}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ============ STORY RESULT ============ */}
          {isStoryMode && (storyGeneration?.status === "completed" || (storyGeneration?.status === "generating" && (() => { const s: StoryScene[] = JSON.parse(storyGeneration?.scenes || "[]"); return s.some(x => x.status === "completed" || x.status === "failed"); })())) && (
            <Card className="bg-white rounded-3xl border border-indigo-100">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xl flex-shrink-0">📖</span>
                    {editingStoryTitle ? (
                      <form className="flex items-center gap-2 flex-1" onSubmit={e => { e.preventDefault(); editStoryTitleMutation.mutate(editingTitleValue); }}>
                        <input
                          autoFocus
                          value={editingTitleValue}
                          onChange={e => setEditingTitleValue(e.target.value)}
                          className="flex-1 text-lg font-bold border-b-2 border-emerald-400 bg-transparent outline-none text-gray-800"
                          onBlur={() => { if (editingTitleValue.trim()) editStoryTitleMutation.mutate(editingTitleValue); else setEditingStoryTitle(false); }}
                        />
                        <button type="submit" className="text-emerald-600 hover:text-emerald-800 text-sm"><i className="fas fa-check"></i></button>
                        <button type="button" onClick={() => setEditingStoryTitle(false)} className="text-gray-400 hover:text-gray-600 text-sm"><i className="fas fa-times"></i></button>
                      </form>
                    ) : (
                      <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2 truncate">
                        {storyGeneration.title}
                        <button
                          onClick={() => { setEditingTitleValue(storyGeneration.title); setEditingStoryTitle(true); }}
                          className="text-gray-300 hover:text-emerald-500 transition-colors flex-shrink-0"
                          title={tr("編輯標題")}
                        >
                          <i className="fas fa-pencil-alt text-sm"></i>
                        </button>
                      </h2>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-lg text-xs"
                      onClick={() => { setShowStoryHistory(true); setCurrentStoryId(""); setPerSceneTailEnabled({}); }}
                    >
                      <i className="fas fa-history mr-1.5"></i>{tr("歷史")}
                    </Button>
                  <Button
                    variant="outline"
                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-lg text-sm"
                    onClick={() => {
                      setCurrentStoryId("");
                      setPerSceneTailEnabled({});
                    }}
                  >
                    <i className="fas fa-plus mr-2"></i>{tr("新故事")}
                  </Button>
                  </div>
                </div>

                {/* Seed display */}
                {storyGeneration.globalSeed && (
                  <div className="flex items-center gap-2 px-1 py-0.5">
                    <span className="text-xs text-gray-500">{tr("🎲 角色種子：")}</span>
                    <span className="text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">{storyGeneration.globalSeed}</span>
                    <button
                      className="text-xs text-gray-400 hover:text-emerald-600 transition-colors"
                      title={tr("複製種子")}
                      onClick={() => { navigator.clipboard.writeText(String(storyGeneration.globalSeed)); toast({ title: tr("已複製種子"), description: tr("種子 {0} 已複製", { 0: storyGeneration.globalSeed }) }); }}
                    >
                      <i className="fas fa-copy"></i>
                    </button>
                  </div>
                )}

                {(() => {
                  const scenes: StoryScene[] = JSON.parse(storyGeneration.scenes || "[]");
                  return (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                        {scenes.map((scene, idx) => {
                          const imgUrl = scene.bunnyUrl || scene.imageUrl;
                          const isRegenerating = scene.status === "generating";
                          const isFailed = scene.status === "failed";
                          const nInfo = getNarrativeInfo(idx, scenes.length);
                          const sceneRes = perSceneResolution[idx] ?? "720p";
                          const sceneDur = perSceneDuration[idx] ?? animDuration;
                          const sceneCost = Math.round(sceneDur * (sceneRes === "720p" ? 8 : 15));
                          const animEntry = animJobBySceneIdx[idx];
                          const vidData = animEntry ? animationVideoQueries[animEntry.queryIdx]?.data as VideoGeneration | undefined : undefined;
                          const videoUrl = vidData?.bunnyVideoUrl || vidData?.generatedVideoUrl;
                          const vidAspect = vidData?.aspectRatio || "16:9";
                          const videoPad: Record<string, string> = { "16:9": "aspect-video", "9:16": "aspect-[9/16]", "1:1": "aspect-square" };
                          return (
                            <div key={idx} className={`rounded-xl overflow-hidden border shadow-sm transition-shadow ${isFailed ? "border-red-200" : `border ${nInfo.border}`}`}>
                              {/* ── Image area ── */}
                              {isRegenerating ? (
                                <div className="w-full aspect-square bg-emerald-50 flex flex-col items-center justify-center gap-2">
                                  <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                                  <span className="text-xs text-emerald-600">{tr("重新生成中...")}</span>
                                </div>
                              ) : imgUrl ? (
                                <div className="relative group cursor-pointer" onClick={() => setStoryLightboxIdx(idx)}>
                                  <img src={imgUrl} alt={scene.title} className="w-full aspect-square object-cover group-hover:scale-105 transition-transform duration-300" />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <i className="fas fa-search-plus text-white text-xl"></i>
                                  </div>
                                  {/* Narrative + scene badge */}
                                  <span className="absolute top-2 left-2 flex items-center gap-1">
                                    <span className="bg-emerald-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">{tr("第 {0} 幕", { 0: idx + 1 })}</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${nInfo.bg} ${nInfo.color} ${nInfo.border}`}>{nInfo.icon}{nInfo.short}</span>
                                  </span>
                                  {/* Image controls */}
                                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <a href={imgUrl} download={`scene-${idx + 1}.jpg`} target="_blank" onClick={e => e.stopPropagation()}
                                      className="w-7 h-7 bg-black/50 hover:bg-emerald-600 text-white rounded-full text-xs flex items-center justify-center" title={tr("下載圖片")}>
                                      <i className="fas fa-download text-xs"></i>
                                    </a>
                                    <label
                                      title={tr("上傳圖片替換此幕（免費）")}
                                      onClick={e => e.stopPropagation()}
                                      className={`w-7 h-7 bg-black/50 hover:bg-blue-600 text-white rounded-full text-xs flex items-center justify-center cursor-pointer ${replacingSceneIdx === idx ? "animate-pulse bg-blue-600" : ""}`}>
                                      <input type="file" accept="image/*" className="hidden" disabled={replacingSceneIdx !== null} onChange={async e => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        setReplacingSceneIdx(idx);
                                        try {
                                          const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
                                          const { uploadURL } = await uploadRes.json();
                                          await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
                                          const pathRes = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
                                          const { objectPath } = await pathRes.json();
                                          await replaceSceneImageMutation.mutateAsync({ sceneIdx: idx, objectPath });
                                        } catch {
                                          toast({ title: tr("替換圖片失敗"), variant: "destructive" });
                                        } finally {
                                          setReplacingSceneIdx(null);
                                          e.target.value = "";
                                        }
                                      }} />
                                      {replacingSceneIdx === idx
                                        ? <i className="fas fa-spinner fa-spin text-xs"></i>
                                        : <i className="fas fa-image text-xs"></i>}
                                    </label>
                                    <button className="w-7 h-7 bg-black/50 hover:bg-black/70 text-white rounded-full text-xs flex items-center justify-center"
                                      title={tr("重新生成此幕（{0} 積分）", { 0: IMAGE_COST })}
                                      onClick={e => { e.stopPropagation(); regenerateSceneMutation.mutate({ sceneIdx: idx }); }}
                                      disabled={regenerateSceneMutation.isPending}>
                                      <i className="fas fa-redo text-xs"></i>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="w-full aspect-square bg-red-50 flex flex-col items-center justify-center gap-2">
                                  <i className="fas fa-times-circle text-red-400 text-xl"></i>
                                  <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 text-red-700 border border-red-200 hover:bg-red-200 transition-all disabled:opacity-60"
                                    onClick={() => regenerateSceneMutation.mutate({ sceneIdx: idx })} disabled={regenerateSceneMutation.isPending}>
                                    <i className="fas fa-redo"></i>{tr("重新生成（3積分）")}
                                  </button>
                                </div>
                              )}

                              {/* ── Card body: title + description ── */}
                              <div className="px-3 pt-2.5 pb-2 bg-white">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${nInfo.bg} ${nInfo.color} ${nInfo.border}`}>{nInfo.icon} {nInfo.label}</span>
                                  <span className="flex-1" />
                                  {scene.status === "completed" && (
                                    <button
                                      title={tr("編輯描述後重新生成")}
                                      onClick={() => {
                                        if (editingSceneIdx === idx) {
                                          setEditingSceneIdx(null);
                                        } else {
                                          setEditingSceneIdx(idx);
                                          setEditingSceneDesc(scene.description);
                                          setEditingSceneDialogue(scene.dialogue || "");
                                          setEditingSceneRefPath("");
                                          setEditingUseCharA(true);
                                          setEditingUseCharB(true);
                                          setEditingNewSeed(false);
                                        }
                                      }}
                                      className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${editingSceneIdx === idx ? "bg-emerald-100 text-emerald-600" : "hover:bg-gray-100 text-gray-400"}`}
                                    >
                                      <i className="fas fa-pencil-alt text-[9px]"></i>
                                    </button>
                                  )}
                                </div>
                                <p className="text-xs font-semibold text-gray-700">{scene.title || tr("第 {0} 幕", { 0: idx + 1 })}</p>

                                {editingSceneIdx === idx ? (
                                  <div className="mt-1.5 space-y-1.5">
                                    <textarea
                                      rows={3}
                                      value={editingSceneDesc}
                                      onChange={e => setEditingSceneDesc(e.target.value)}
                                      className="w-full text-[11px] border border-emerald-200 bg-emerald-50/40 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                      placeholder={tr("修改場景描述...")}
                                    />
                                    <div className="relative">
                                      <span className="absolute left-2 top-1.5 text-[10px] text-amber-500 pointer-events-none">💬</span>
                                      <input
                                        type="text"
                                        value={editingSceneDialogue}
                                        onChange={e => setEditingSceneDialogue(e.target.value)}
                                        placeholder={tr("台詞（選填）...")}
                                        className="w-full pl-6 pr-2 py-1.5 text-[11px] border border-amber-100 bg-amber-50/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-300 placeholder:text-gray-300"
                                      />
                                    </div>
                                    {/* Character reference toggles */}
                                    {((storyGeneration?.characterImageUrls?.length ?? 0) > 0 || (storyGeneration?.characterBImageUrls?.length ?? 0) > 0) && (
                                      <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg border border-gray-100">
                                        <span className="text-[10px] text-gray-400 flex-shrink-0">{tr("角色參考：")}</span>
                                        {(storyGeneration?.characterImageUrls?.length ?? 0) > 0 && (
                                          <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={editingUseCharA}
                                              onChange={e => setEditingUseCharA(e.target.checked)}
                                              className="w-3 h-3 accent-emerald-600"
                                            />
                                            <span className="text-[10px] text-gray-600 font-medium">{tr("角色A")}</span>
                                          </label>
                                        )}
                                        {(storyGeneration?.characterBImageUrls?.length ?? 0) > 0 && (
                                          <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={editingUseCharB}
                                              onChange={e => setEditingUseCharB(e.target.checked)}
                                              className="w-3 h-3 accent-orange-500"
                                            />
                                            <span className="text-[10px] text-gray-600 font-medium">{tr("角色B")}</span>
                                          </label>
                                        )}
                                      </div>
                                    )}
                                    {/* Per-scene reference image upload */}
                                    <div className="flex items-center gap-1.5">
                                      <label className={`flex items-center gap-1 px-2 py-1 text-[10px] border rounded-lg cursor-pointer transition-colors ${editingSceneRefPath ? "border-blue-300 bg-blue-50 text-blue-600" : "border-gray-200 text-gray-400 hover:bg-gray-50"} ${editingSceneRefUploading ? "opacity-50 pointer-events-none" : ""}`}>
                                        <input type="file" accept="image/*" className="hidden" onChange={async e => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;
                                          setEditingSceneRefUploading(true);
                                          try {
                                            const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
                                            const { uploadURL } = await uploadRes.json();
                                            await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
                                            const pathRes = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
                                            const { objectPath } = await pathRes.json();
                                            setEditingSceneRefPath(objectPath);
                                            toast({ title: tr("參考圖上傳成功") });
                                          } catch {
                                            toast({ title: tr("參考圖上傳失敗"), variant: "destructive" });
                                          } finally {
                                            setEditingSceneRefUploading(false);
                                          }
                                        }} />
                                        {editingSceneRefUploading ? tr("上傳中...") : editingSceneRefPath ? tr("✓ 參考圖已替換") : tr("🖼 上傳此幕參考圖")}
                                      </label>
                                      {editingSceneRefPath && (
                                        <button onClick={() => setEditingSceneRefPath("")} className="text-[10px] text-gray-400 hover:text-gray-600">✕</button>
                                      )}
                                    </div>
                                    {/* New seed toggle */}
                                    <label className="flex items-center gap-1.5 cursor-pointer px-1">
                                      <input
                                        type="checkbox"
                                        checked={editingNewSeed}
                                        onChange={e => setEditingNewSeed(e.target.checked)}
                                        className="w-3 h-3 accent-purple-600"
                                      />
                                      <span className="text-[10px] text-purple-700 font-medium">{tr("🎲 換個種子（生成不同結果）")}</span>
                                    </label>
                                    <div className="flex gap-1.5">
                                      <button
                                        onClick={() => { setEditingSceneIdx(null); setEditingSceneRefPath(""); setEditingUseCharA(true); setEditingUseCharB(true); setEditingNewSeed(false); }}
                                        className="flex-1 py-1 text-[11px] border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50"
                                      >{tr("取消")}</button>
                                      <button
                                        onClick={() => {
                                          regenerateSceneMutation.mutate({
                                            sceneIdx: idx,
                                            description: editingSceneDesc,
                                            dialogue: editingSceneDialogue,
                                            sceneReferenceImageUrl: editingSceneRefPath || undefined,
                                            useCharA: editingUseCharA,
                                            useCharB: editingUseCharB,
                                            newSeed: editingNewSeed,
                                          });
                                        }}
                                        disabled={!editingSceneDesc.trim() || regenerateSceneMutation.isPending || editingSceneRefUploading}
                                        className="flex-1 py-1 text-[11px] bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-semibold"
                                      >{tr("重新生成（3積分）")}</button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <p className="text-[11px] text-gray-400 line-clamp-2 mt-0.5">{scene.description}</p>
                                    {scene.dialogue && (
                                      <p className="text-[11px] text-amber-600 mt-1 flex items-start gap-1">
                                        <span className="flex-shrink-0">💬</span>
                                        <span className="line-clamp-2 italic">「{scene.dialogue}」</span>
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>

                              {/* ── Animation section ── */}
                              {imgUrl && (
                                <div className="px-3 pb-3 bg-white border-t border-dashed border-purple-100 pt-2 space-y-2">
                                  {/* Prompt textarea */}
                                  <div>
                                    <div className="flex items-center justify-between mb-1">
                                      <span className="text-[10px] font-semibold text-purple-600 uppercase tracking-wide">{tr("🎬 動畫提示詞")}</span>
                                      {!perSceneAnimPrompts[idx] && (
                                        <span className="text-[9px] text-gray-400">{tr("← AI 生成後自動填入")}</span>
                                      )}
                                    </div>
                                    <textarea
                                      rows={2}
                                      value={perSceneAnimPrompts[idx] || ""}
                                      onChange={e => setPerSceneAnimPrompts(prev => ({ ...prev, [idx]: e.target.value }))}
                                      placeholder={tr("此幕動畫描述，例：slow push in, golden light flows, {0}", { 0: nInfo.short === "起" ? "gentle establishing shot" : nInfo.short === "轉" ? "dramatic zoom, dynamic movement" : "slow fade out, peaceful ending" })}
                                      className="w-full text-[11px] border border-gray-200 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-purple-400 placeholder:text-gray-300"
                                    />
                                  </div>
                                  {/* Tail image toggle */}
                                  {(() => {
                                    const tailEnabled = !!perSceneTailEnabled[idx];
                                    const nextScene = scenes[idx + 1] ?? scenes[0];
                                    const isLast = idx === scenes.length - 1;
                                    const nextHasImg = nextScene && (nextScene.bunnyUrl || nextScene.imageUrl) && nextScene.status === "completed";
                                    if (!nextHasImg) return null;
                                    return (
                                      <div className="flex items-center gap-2 py-1 px-2 rounded-lg bg-indigo-50 border border-indigo-100">
                                        <button
                                          type="button"
                                          onClick={() => setPerSceneTailEnabled(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                          className={`w-8 h-4 rounded-full transition-colors flex-shrink-0 relative ${tailEnabled ? "bg-indigo-500" : "bg-gray-300"}`}
                                        >
                                          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${tailEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                                        </button>
                                        <span className="text-[10px] text-indigo-700 font-medium">{isLast ? tr("循環回第一幕") : tr("銜接下一幕")}</span>
                                        <span className="text-[9px] text-indigo-400 font-normal">{tr("（結尾幀過渡）")}</span>
                                      </div>
                                    );
                                  })()}
                                  {/* Per-scene duration selector */}
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] text-gray-500 flex-shrink-0">{tr("秒數")}</span>
                                    {[4, 5, 6, 8, 10, 12].map(sec => {
                                      const active = (perSceneDuration[idx] ?? animDuration) === sec;
                                      return (
                                        <button key={sec}
                                          onClick={() => setPerSceneDuration(prev => ({ ...prev, [idx]: sec }))}
                                          className={`w-8 h-6 rounded border text-[10px] font-semibold transition-all ${active ? "border-purple-500 bg-purple-100 text-purple-700" : "border-gray-200 text-gray-500 hover:border-purple-300"}`}>
                                          {sec}s
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {/* Resolution + Generate */}
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-500 flex-shrink-0">{tr("解析度")}</span>
                                    {(["720p", "1080p"] as const).map(r => {
                                      const sd = perSceneDuration[idx] ?? animDuration;
                                      return (
                                        <button key={r}
                                          onClick={() => setPerSceneResolution(prev => ({ ...prev, [idx]: r }))}
                                          className={`flex-1 py-1 rounded-lg border text-[11px] font-medium transition-all ${sceneRes === r ? "border-purple-500 bg-purple-100 text-purple-700" : "border-gray-200 text-gray-500 hover:border-purple-300"}`}>
                                          {r} <span className="text-[9px] opacity-70">{tr("({0}積)", { 0: Math.round(sd * (r === "720p" ? 8 : 15)) })}</span>
                                        </button>
                                      );
                                    })}
                                    <button
                                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1 ${
                                        (singleSceneAnimateMutation.isPending && singleSceneAnimateMutation.variables?.sceneIdx === idx)
                                          ? "bg-purple-200 text-purple-500 cursor-not-allowed"
                                          : vidData?.status === "completed" && videoUrl
                                          ? "bg-gray-100 text-gray-600 hover:bg-purple-100 hover:text-purple-700 border border-gray-200"
                                          : "bg-purple-600 text-white hover:bg-purple-700"
                                      }`}
                                      onClick={() => {
                                        const tailEnabled = !!perSceneTailEnabled[idx];
                                        const nextSceneIdx = (idx + 1) % scenes.length;
                                        const tailSceneIdx = tailEnabled ? nextSceneIdx : undefined;
                                        singleSceneAnimateMutation.mutate({ sceneIdx: idx, tailSceneIdx });
                                      }}
                                      disabled={singleSceneAnimateMutation.isPending && singleSceneAnimateMutation.variables?.sceneIdx === idx}
                                      title={tr("生成 {0}秒 {1} 動畫，需 {2} 積分", { 0: perSceneDuration[idx] ?? animDuration, 1: sceneRes, 2: sceneCost })}
                                    >
                                      {(singleSceneAnimateMutation.isPending && singleSceneAnimateMutation.variables?.sceneIdx === idx) ? (
                                        <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                                      ) : vidData?.status === "completed" && videoUrl ? (
                                        <><i className="fas fa-redo text-[9px]"></i>{tr("重生")}</>
                                      ) : (
                                        <><i className="fas fa-film text-[9px]"></i>{tr("生成")}</>
                                      )}
                                    </button>
                                  </div>
                                  {/* Video preview */}
                                  {vidData && (
                                    <div className="rounded-lg overflow-hidden border border-purple-100 mt-1">
                                      {vidData.status === "completed" && videoUrl ? (
                                        <div className="relative">
                                          <video src={videoUrl} muted autoPlay loop playsInline className={`w-full ${videoPad[vidAspect] || "aspect-video"} object-cover`} />
                                          <span className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-medium">{vidAspect}</span>
                                          <a href={videoUrl} download={`scene-anim-${idx + 1}.mp4`} target="_blank"
                                            className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/60 hover:bg-emerald-600 text-white rounded text-[9px] flex items-center justify-center" title={tr("下載動畫")}>
                                            <i className="fas fa-download"></i>
                                          </a>
                                        </div>
                                      ) : vidData.status === "failed" ? (
                                        <div className="py-2 flex flex-col items-center gap-1 bg-red-50">
                                          <span className="text-[10px] text-red-500"><i className="fas fa-times-circle mr-1"></i>{tr("動畫失敗")}</span>
                                          <button className="text-[9px] px-2 py-0.5 bg-red-100 text-red-600 rounded hover:bg-red-200"
                                            onClick={() => singleSceneAnimateMutation.mutate({ sceneIdx: idx })}>{tr("重試")}</button>
                                        </div>
                                      ) : (
                                        <div className="py-2 flex items-center justify-center gap-2 bg-purple-50">
                                          <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                                          <span className="text-[10px] text-purple-500">{tr("動畫生成中…")}</span>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-5 pt-4 border-t border-gray-100 flex flex-wrap gap-3 justify-center">
                        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg" onClick={() => {
                          scenes.filter(s => s.bunnyUrl || s.imageUrl).forEach((scene, idx) => {
                            const url = scene.bunnyUrl || scene.imageUrl;
                            if (!url) return;
                            setTimeout(() => {
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = `story-${idx + 1}.jpg`;
                              link.target = "_blank";
                              link.click();
                            }, idx * 150);
                          });
                        }}>
                          <i className="fas fa-download mr-2"></i>{tr("下載全部圖片")}
                        </Button>
                        <Button
                          className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
                          onClick={() => setShowAnimationSettings(v => !v)}
                          disabled={storyAnimateMutation.isPending}
                        >
                          <i className="fas fa-video mr-2"></i>
                          {storyAnimationJobs.length > 0 ? tr("重新生成動畫") : tr("批量生成動畫")}
                        </Button>
                        {storyGeneration.status === "completed" && (
                          <Button
                            variant="outline"
                            className="border-emerald-400 text-emerald-700 hover:bg-emerald-50 rounded-lg"
                            onClick={() => {
                              const seedVal = storyGeneration.globalSeed ?? (storySeed !== "" ? Number(storySeed) : undefined);
                              const sequel = {
                                characterImagePaths: (storyGeneration.characterImageUrls ?? []) as string[],
                                characterBImagePaths: (storyGeneration.characterBImageUrls ?? []) as string[],
                                sceneRefImagePaths: (storyGeneration.sceneRefImageUrls ?? []) as string[],
                                styleImagePaths: (storyGeneration.styleImageUrls ?? []) as string[],
                                globalSeed: seedVal ?? null,
                                sceneSize: storyGeneration.sceneSize ?? "1:1",
                                style: storyGeneration.style,
                              };
                              try { localStorage.setItem("story_sequel_prefill", JSON.stringify(sequel)); } catch {}
                              const baseTitle = storyGeneration.title.replace(/^（第\d+集）/, "");
                              setCurrentStoryId("");
                              setStoryTitle(tr("（第二集）{0}", { 0: baseTitle }));
                              setStorySeed(seedVal ?? "");
                              toast({ title: tr("✨ 已預填設定"), description: tr("種子與角色參考圖已繼承，請填入新集數的場景描述") });
                            }}
                          >
                            <i className="fas fa-book-open mr-2"></i>{tr("建立第二集")}
                          </Button>
                        )}
                        <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => { setCurrentStoryId(""); setPerSceneTailEnabled({}); }}>
                          <i className="fas fa-redo mr-2"></i>{tr("重新生成故事")}
                        </Button>
                      </div>

                      {/* Note: animation aspect ratio is auto-detected from each scene image */}
                      <div className="mt-2 text-center text-xs text-gray-400">
                        <i className="fas fa-info-circle mr-1"></i>{tr("動畫比例自動對齊各幕圖片尺寸，無需手動設定")}
                      </div>

                      {/* Animation Global Settings Panel */}
                      {showAnimationSettings && (
                        <div className="mt-4 p-5 bg-purple-50 rounded-xl border border-purple-200 space-y-4">
                          <h3 className="font-semibold text-purple-800 flex items-center gap-2">
                            <i className="fas fa-sliders-h"></i>{tr("批量動畫設定")}
                            <span className="text-xs font-normal text-purple-600">{tr("（各幕可在卡片中個別選解析度與提示詞）")}</span>
                          </h3>

                          {/* Duration */}
                          <div>
                            <Label className="text-sm font-medium text-gray-700 mb-2 block">
                              {tr("各幕影片時長：")}<span className="text-purple-700 font-bold">{tr("{0} 秒", { 0: animDuration })}</span>
                            </Label>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-500">4s</span>
                              <input type="range" min={4} max={12} step={1} value={animDuration}
                                onChange={e => setAnimDuration(Number(e.target.value))}
                                className="flex-1 accent-purple-600" />
                              <span className="text-xs text-gray-500">12s</span>
                            </div>
                          </div>

                          {/* AI generate all prompts */}
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-700">{tr("AI 自動生成所有分鏡提示詞")}</p>
                              <p className="text-xs text-gray-500">{tr("Seed 依起承轉合節奏，為每幕生成對應的動畫提示詞")}</p>
                            </div>
                            <button
                              onClick={() => generateAnimPromptsMutation.mutate()}
                              disabled={generateAnimPromptsMutation.isPending}
                              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
                            >
                              {generateAnimPromptsMutation.isPending ? (
                                <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />{tr("生成中...")}</>
                              ) : (
                                <>{tr("✨ AI 生成提示詞")}</>
                              )}
                            </button>
                          </div>

                          <div className="text-xs text-gray-500 bg-white/60 rounded-lg px-3 py-2 border border-gray-100">
                            <i className="fas fa-info-circle mr-1 text-purple-400"></i>
                            {tr("動畫比例自動依各幕圖片尺寸決定；各幕的解析度和提示詞請在上方分鏡卡片中設定")}
                          </div>

                          {/* Batch Cost + Confirm */}
                          {(() => {
                            const completedScenes = scenes.filter(s => s.status === "completed" && (s.bunnyUrl || s.imageUrl));
                            const totalCost = completedScenes.reduce((sum, s) => {
                              const si = scenes.indexOf(s);
                              const res = perSceneResolution[si] ?? "720p";
                              const dur = perSceneDuration[si] ?? animDuration;
                              return sum + Math.round(dur * (res === "720p" ? 8 : 15));
                            }, 0);
                            const hasEnough = (user?.credits ?? 0) >= totalCost;
                            return (
                              <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-purple-200">
                                <div className="text-sm">
                                  <span className="text-gray-600">{tr("{0} 幕合計", { 0: completedScenes.length })} </span>
                                  <span className="font-bold text-purple-700">{tr("{0} 積分", { 0: totalCost })}</span>
                                  <span className="text-gray-400 text-xs ml-1">{tr("（依各幕個別解析度與秒數計算）")}</span>
                                  {!hasEnough && (
                                    <span className="ml-2 text-red-500 text-xs"><i className="fas fa-exclamation-triangle mr-1"></i>{tr("積分不足（餘額 {0}）", { 0: user?.credits ?? 0 })}</span>
                                  )}
                                </div>
                                <Button
                                  className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
                                  disabled={!hasEnough || storyAnimateMutation.isPending}
                                  onClick={() => storyAnimateMutation.mutate({
                                    duration: animDuration,
                                    resolution: animResolution,
                                    perScenePromptsByActual: perSceneAnimPrompts,
                                    perSceneResolutions: perSceneResolution,
                                    perSceneDurations: perSceneDuration,
                                  })}
                                >
                                  {storyAnimateMutation.isPending ? (
                                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />{tr("送出中...")}</>
                                  ) : (
                                    <><i className="fas fa-play mr-2"></i>{tr("批量生成全部動畫")}</>
                                  )}
                                </Button>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Animation Progress / Result */}
                      {storyAnimationJobs.length > 0 && (
                        <div className="mt-5 space-y-4">
                          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                            <i className="fas fa-video text-purple-500"></i>{tr("動畫生成進度")}
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                            {storyAnimationJobs.map((job, jobIdx) => {
                              const vidData = animationVideoQueries[jobIdx]?.data as VideoGeneration | undefined;
                              const videoUrl = vidData?.bunnyVideoUrl || vidData?.generatedVideoUrl;
                              const status = vidData?.status || "pending";
                              return (
                                <div key={job.videoId} className="rounded-xl overflow-hidden border border-gray-200 shadow-sm">
                                  {status === "completed" && videoUrl ? (
                                    <video
                                      src={videoUrl} muted autoPlay loop playsInline
                                      className="w-full aspect-video object-cover bg-black"
                                    />
                                  ) : (
                                    <div className={`w-full aspect-video flex items-center justify-center ${
                                      status === "failed" ? "bg-red-50" : "bg-gray-100"
                                    }`}>
                                      {status === "processing" || status === "pending" ? (
                                        <div className="text-center space-y-2">
                                          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
                                          <p className="text-xs text-gray-500">{tr("生成中")}</p>
                                        </div>
                                      ) : status === "failed" ? (
                                        <div className="text-center">
                                          <i className="fas fa-times-circle text-red-400 text-2xl"></i>
                                          <p className="text-xs text-red-500 mt-1">{tr("失敗")}</p>
                                        </div>
                                      ) : (
                                        <i className="fas fa-hourglass-half text-gray-400 text-2xl"></i>
                                      )}
                                    </div>
                                  )}
                                  <div className="p-2 bg-white">
                                    <p className="text-xs font-medium text-gray-700 truncate">{job.sceneTitle}</p>
                                    <div className="flex items-center justify-between mt-1">
                                      <span className={`text-xs ${
                                        status === "completed" ? "text-emerald-600" :
                                        status === "processing" ? "text-blue-500" :
                                        status === "failed" ? "text-red-500" : "text-gray-400"
                                      }`}>
                                        {status === "completed" ? tr("✓ 完成") :
                                         status === "processing" ? tr("生成中...") :
                                         status === "failed" ? tr("失敗") : tr("等待中")}
                                      </span>
                                      {status === "completed" && videoUrl && (
                                        <a href={videoUrl} download={`scene-anim-${job.sceneIdx + 1}.mp4`} target="_blank"
                                          className="text-xs text-purple-600 hover:text-purple-800"
                                          onClick={e => e.stopPropagation()}>
                                          <i className="fas fa-download"></i>
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {animationVideoQueries.every(q => (q.data as VideoGeneration | undefined)?.status === "completed") && animationVideoQueries.length > 0 && (
                            <div className="flex justify-center pt-2">
                              <Button className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg" onClick={() => {
                                storyAnimationJobs.forEach((job, jobIdx) => {
                                  const vidData = animationVideoQueries[jobIdx]?.data as VideoGeneration | undefined;
                                  const videoUrl = vidData?.bunnyVideoUrl || vidData?.generatedVideoUrl;
                                  if (!videoUrl) return;
                                  setTimeout(() => {
                                    const a = document.createElement("a");
                                    a.href = videoUrl;
                                    a.download = `story-anim-${job.sceneIdx + 1}.mp4`;
                                    a.target = "_blank";
                                    a.click();
                                  }, jobIdx * 200);
                                });
                              }}>
                                <i className="fas fa-download mr-2"></i>{tr("下載全部動畫（{0} 幕）", { 0: storyAnimationJobs.length })}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Story Lightbox */}
                      {storyLightboxIdx !== null && (
                        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setStoryLightboxIdx(null)}>
                          <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
                            <button className="absolute -top-10 right-0 text-white text-sm hover:text-gray-300" onClick={() => setStoryLightboxIdx(null)}>
                              <i className="fas fa-times mr-1"></i>{tr("關閉")}
                            </button>
                            <div className="flex items-center gap-3">
                              <button
                                className="text-white text-2xl hover:text-emerald-400 flex-shrink-0"
                                onClick={() => setStoryLightboxIdx(Math.max(0, storyLightboxIdx - 1))}
                                disabled={storyLightboxIdx === 0}
                              >
                                <i className="fas fa-chevron-left"></i>
                              </button>
                              <div className="flex-1">
                                {(() => {
                                  const s = scenes[storyLightboxIdx];
                                  const url = s?.bunnyUrl || s?.imageUrl;
                                  return url ? (
                                    <img src={url} alt={s.title} className="w-full rounded-xl" />
                                  ) : null;
                                })()}
                                <div className="mt-3 text-center">
                                  <p className="text-white font-semibold">{scenes[storyLightboxIdx]?.title || tr("第 {0} 幕", { 0: storyLightboxIdx + 1 })}</p>
                                  <p className="text-gray-300 text-sm mt-1">{scenes[storyLightboxIdx]?.description}</p>
                                </div>
                              </div>
                              <button
                                className="text-white text-2xl hover:text-emerald-400 flex-shrink-0"
                                onClick={() => setStoryLightboxIdx(Math.min(scenes.length - 1, storyLightboxIdx + 1))}
                                disabled={storyLightboxIdx === scenes.length - 1}
                              >
                                <i className="fas fa-chevron-right"></i>
                              </button>
                            </div>
                            <p className="text-center text-gray-400 text-xs mt-3">{storyLightboxIdx + 1} / {scenes.length}</p>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      <footer className="mt-12 border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="text-center space-y-4">
            <p className="text-sm font-medium text-gray-600">{tr("極電行銷整合")}</p>
            <div className="flex justify-center items-center gap-4 text-sm text-gray-500">
              <span>{tr("客服信箱：")}<a href="mailto:Service@cms-edu.com" className="text-purple-600 hover:underline">Service@cms-edu.com</a></span>
              <span className="text-gray-300">|</span>
              <span>LINE：<a href="https://line.me/R/ti/p/@558icnoi" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">@558icnoi</a></span>
              <span className="text-gray-300">|</span>
              <span>Facebook：<a href="https://www.facebook.com/profile.php?id=61569836876332" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">{tr("粉絲專頁")}</a></span>
            </div>
            <div className="flex justify-center items-center gap-6 text-sm text-gray-400">
              <a href="/privacy" className="hover:text-blue-600 transition-colors">{tr("隱私政策")}</a>
              <a href="/terms" className="hover:text-blue-600 transition-colors">{tr("服務條款")}</a>
            </div>
            <p className="text-xs text-gray-300">
              {tr("使用模型：WAN 3.0 · Seedream 5.5")}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

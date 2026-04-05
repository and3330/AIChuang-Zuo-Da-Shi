import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/App";
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

export default function Home() {
  const { user } = useUser();
  useSeo({
    title: "AI 創作工作台 - 圖片與影片生成 | AI 創意工坊",
    description: "使用 AI 創意工坊生成高品質圖片和影片。支援文字生圖、圖片編輯、多圖融合、序列生成、批次處理、AI 影片生成等功能。",
    keywords: "AI生成,文字生圖,圖片編輯,AI影片,批次生成,序列生成,多圖融合",
  });
  const [mode, setMode] = useState<"image-to-image" | "text-to-image" | "image-to-video" | "text-to-video" | "story">("text-to-image");
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string>("");
  const [uploadedImagePath, setUploadedImagePath] = useState<string>("");
  const [prompt, setPrompt] = useState("把泡泡變成愛心形狀");
  const [textPrompt, setTextPrompt] = useState("一幅美麗的日落山水風景畫，有山脈和湖泊");
  const [guidanceScale, setGuidanceScale] = useState(5.5);
  const [seed, setSeed] = useState(21);
  const [watermark, setWatermark] = useState(true);
  const [showWatermarkDisclaimer, setShowWatermarkDisclaimer] = useState(false);
  const [disclaimerAgreed, setDisclaimerAgreed] = useState(false);
  const [size, setSize] = useState("2K");
  const [currentGenerationId, setCurrentGenerationId] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [batchCount, setBatchCount] = useState(2);
  const [batchPrompts, setBatchPrompts] = useState<string[]>(["把泡泡變成愛心形狀", "把天空改成日落顏色"]);
  const [currentBatchId, setCurrentBatchId] = useState<string>("");
  const [batchGenerations, setBatchGenerations] = useState<ImageGeneration[]>([]);
  const [isSequentialMode, setIsSequentialMode] = useState(false);
  const [sequentialCount, setSequentialCount] = useState(4);
  const [isI2ISequentialMode, setIsI2ISequentialMode] = useState(false);
  const [i2iSequentialCount, setI2ISequentialCount] = useState(4);
  const [additionalImages, setAdditionalImages] = useState<{url: string, path: string}[]>([]);
  const [isMultiImageMode, setIsMultiImageMode] = useState(false);
  
  const [videoPrompt, setVideoPrompt] = useState("高速穿越障礙物或美麗的自然風景，帶來沉浸式的飛行體驗");
  const [videoDuration, setVideoDuration] = useState(5);
  const [cameraFixed, setCameraFixed] = useState(false);
  const [videoAspectRatio, setVideoAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [videoResolution, setVideoResolution] = useState<"720p" | "1080p">("1080p");
  const [currentVideoGenerationId, setCurrentVideoGenerationId] = useState<string>("");

  const getNarrativeInfo = (idx: number, total: number): { label: string; short: string; color: string; bg: string; border: string; icon: string } => {
    const ratio = total <= 1 ? 0 : idx / (total - 1);
    if (idx === 0) return { label: "起（開場）", short: "起", color: "text-emerald-700", bg: "bg-emerald-100", border: "border-emerald-300", icon: "🌱" };
    if (idx === total - 1) return { label: "合（結局）", short: "合", color: "text-purple-700", bg: "bg-purple-100", border: "border-purple-300", icon: "✨" };
    if (total === 3) return { label: "轉（高潮）", short: "轉", color: "text-orange-700", bg: "bg-orange-100", border: "border-orange-300", icon: "⚡" };
    if (ratio < 0.4) return { label: "承（發展）", short: "承", color: "text-blue-700", bg: "bg-blue-100", border: "border-blue-300", icon: "🔗" };
    if (ratio < 0.72) return { label: "轉（高潮）", short: "轉", color: "text-orange-700", bg: "bg-orange-100", border: "border-orange-300", icon: "⚡" };
    return { label: "合（收尾）", short: "合", color: "text-purple-700", bg: "bg-purple-100", border: "border-purple-300", icon: "✨" };
  };

  const STORY_STYLES: { label: string; value: string }[] = [
    { label: "水彩插畫", value: "Watercolor illustration style, soft colors, gentle brush strokes" },
    { label: "電影感寫實", value: "Cinematic realistic photography, dramatic lighting, high detail" },
    { label: "日系動漫", value: "Japanese anime style, clean lines, vibrant colors, expressive characters" },
    { label: "歐式油畫", value: "European oil painting style, rich textures, classical composition" },
    { label: "簡約線條插畫", value: "Minimalist line art illustration, clean vector style" },
    { label: "自訂畫風", value: "custom" },
  ];
  const [storyTitle, setStoryTitle] = useState("神秘森林的冒險");
  const [storyContent, setStoryContent] = useState("");
  const [storyStyle, setStoryStyle] = useState(STORY_STYLES[0].value);
  const [storyCustomStyle, setStoryCustomStyle] = useState("");
  const [storySceneCount, setStorySceneCount] = useState(4);
  const [storySceneSize, setStorySceneSize] = useState<"1:1" | "9:16" | "16:9">("1:1");
  const [storyScenes, setStoryScenes] = useState<{ title: string; description: string; dialogue?: string; sceneReferenceImageUrl?: string }[]>([
    { title: "第一幕", description: "主角在森林入口處發現一扇古老的神秘大門" },
    { title: "第二幕", description: "大門緩緩開啟，出現一道閃爍的金色光芒" },
    { title: "第三幕", description: "主角穿越大門，來到一片魔法花園" },
    { title: "第四幕", description: "花園中心有一棵發光的神木，枝頭棲息著奇幻的生靈" },
    { title: "第五幕", description: "" },
    { title: "第六幕", description: "" },
    { title: "第七幕", description: "" },
    { title: "第八幕", description: "" },
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
        toast({ title: "Claude 優化失敗", description: "未收到有效的提示詞", variant: "destructive" });
        return;
      }
      setStoryScenes(prev => prev.map((scene, idx) => {
        const found = enhanced.find(e => e.index === idx);
        if (found) return { ...scene, description: found.enhanced_prompt };
        return scene;
      }));
      toast({ title: "✨ 提示詞優化完成", description: `Claude 已為 ${enhanced.length} 幕場景生成專業英文提示詞` });
    },
    onError: (error: any) => {
      toast({ title: "Claude 優化失敗", description: error?.message || "請稍後再試", variant: "destructive" });
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
      if (!response.ok) throw new Error(data.error || "生成失敗");
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
      toast({ title: "✨ 故事大綱已生成", description: `Claude 已自動生成 ${scenes.length} 幕起承轉合的場景大綱` });
    },
    onError: (error: any) => {
      toast({ title: "大綱生成失敗", description: error?.message || "請稍後再試", variant: "destructive" });
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
      if (!response.ok) throw new Error(data.error || "優化失敗");
      return data;
    },
    onSuccess: (data: any) => {
      if (data.enhanced) {
        setVideoPrompt(data.enhanced);
        toast({ title: "✨ AI 優化完成", description: "提示詞已豐富化，可再用 Claude 轉英文" });
      }
    },
    onError: (error: any) => {
      toast({ title: "AI 優化失敗", description: error?.message || "請稍後再試", variant: "destructive" });
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
      if (!response.ok) throw new Error(data.error || "優化失敗");
      return data;
    },
    onSuccess: (data: any) => {
      if (data.enhanced) {
        setVideoPrompt(data.enhanced);
        toast({ title: "✨ Claude 優化完成", description: "已轉換為專業英文影片提示詞" });
      }
    },
    onError: (error: any) => {
      toast({ title: "Claude 優化失敗", description: error?.message || "請稍後再試", variant: "destructive" });
    },
  });

  const regenerateSceneMutation = useMutation({
    mutationFn: async ({ sceneIdx, description, dialogue, sceneReferenceImageUrl, useCharA, useCharB }: { sceneIdx: number; description?: string; dialogue?: string; sceneReferenceImageUrl?: string; useCharA?: boolean; useCharB?: boolean }) => {
      const body: Record<string, unknown> = {};
      if (description) body.description = description;
      if (dialogue !== undefined) body.dialogue = dialogue;
      if (sceneReferenceImageUrl) body.sceneReferenceImageUrl = sceneReferenceImageUrl;
      if (useCharA === false) body.useCharA = false;
      if (useCharB === false) body.useCharB = false;
      const response = await apiRequest("POST", `/api/story-generations/${currentStoryId}/regenerate-scene/${sceneIdx}`, body);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "重新生成失敗");
      return data;
    },
    onSuccess: (_data, { sceneIdx }) => {
      setEditingSceneIdx(null);
      setEditingSceneRefPath("");
      setEditingUseCharA(true);
      setEditingUseCharB(true);
      queryClient.invalidateQueries({ queryKey: ["/api/story-generations", currentStoryId] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: `第 ${sceneIdx + 1} 幕重新生成中`, description: "請稍候，生成完成後自動更新..." });
    },
    onError: (error: any) => {
      toast({ title: "重新生成失敗", description: error?.message, variant: "destructive" });
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
      toast({ title: "故事生成已開始", description: `正在生成「${data.title}」，請稍候...` });
    },
    onError: (error: any) => {
      const msg = error?.message || "無法開始故事生成。";
      const description = msg.includes("積分不足") ? msg : `故事生成請求失敗：${msg}`;
      toast({ title: "故事生成失敗", description, variant: "destructive" });
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
      toast({ title: "批量動畫生成已開始", description: `正在生成 ${data.jobs?.length} 幕動畫，請耐心等待...` });
    },
    onError: (error: any) => {
      const msg = error?.message || "無法開始動畫生成。";
      toast({ title: "動畫生成失敗", description: msg, variant: "destructive" });
    },
  });

  const generateAnimPromptsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/story-generations/${currentStoryId}/generate-animation-prompts`, { duration: animDuration });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "生成失敗");
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
      toast({ title: "✨ 分鏡動畫提示詞已生成", description: `已為 ${Object.keys(newPrompts).length} 幕各別生成動畫提示詞，可在各幕卡片中編輯調整。` });
    },
    onError: (error: any) => {
      toast({ title: "生成失敗", description: error.message || "無法生成動畫提示詞", variant: "destructive" });
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
      if (!response.ok) throw new Error(data.error || "動畫生成失敗");
      return data;
    },
    onSuccess: (data: any) => {
      setStoryAnimationJobs(prev => {
        const filtered = prev.filter(j => j.sceneIdx !== data.sceneIdx);
        return [...filtered, { sceneIdx: data.sceneIdx, sceneTitle: data.sceneTitle, videoId: data.videoId }];
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: `第 ${data.sceneIdx + 1} 幕動畫生成中`, description: `扣除 ${data.credits} 積分，完成後自動顯示` });
    },
    onError: (error: any) => {
      toast({ title: "動畫生成失敗", description: error.message, variant: "destructive" });
    },
  });

  const editStoryTitleMutation = useMutation({
    mutationFn: async (title: string) => {
      const response = await apiRequest("PATCH", `/api/story-generations/${currentStoryId}`, { title });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "更新失敗");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/story-generations", currentStoryId] });
      queryClient.invalidateQueries({ queryKey: ["/api/story-generations"] });
      setEditingStoryTitle(false);
    },
    onError: (error: any) => {
      toast({ title: "更新失敗", description: error.message, variant: "destructive" });
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
        toast({ title: "圖片上傳成功", description: "現在可以開始 AI 編輯。" });
      } catch (error) {
        toast({ title: "上傳錯誤", description: "處理上傳圖片失敗。", variant: "destructive" });
      }
    } else {
      toast({ title: "上傳失敗", description: "圖片上傳失敗。", variant: "destructive" });
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
        toast({ title: "批次生成已開始", description: `正在處理 ${data.totalCount} 張圖片...` });
      } else {
        setCurrentGenerationId(data.id);
        setCurrentBatchId("");
        queryClient.invalidateQueries({ queryKey: ["/api/image-generations", data.id] });
        toast({ title: "生成已開始", description: "正在處理您的圖片..." });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (error: any) => {
      const msg = error?.message || "無法開始圖片生成。";
      const description = msg.includes("402") ? "積分不足，請先充值。" :
                          msg.includes("401") ? "請先登入。" :
                          msg.includes("404") ? "用戶不存在。" :
                          `圖片生成請求失敗：${msg}`;
      toast({ title: "生成失敗", description, variant: "destructive" });
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
      toast({ title: "影片生成已開始", description: "正在處理您的影片，這可能需要 1-3 分鐘..." });
    },
    onError: (error: any) => {
      const msg = error?.message || "無法開始影片生成。";
      const description = msg.includes("402") ? "積分不足，請先充值。" :
                          msg.includes("401") ? "請先登入。" :
                          `影片生成請求失敗：${msg}`;
      toast({ title: "影片生成失敗", description, variant: "destructive" });
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
        newPrompts.push(`變化 ${i + 1}`);
      }
    } else {
      newPrompts.splice(count);
    }
    setBatchPrompts(newPrompts);
  };

  const handleGenerate = () => {
    if (mode === "story") {
      if (!storyTitle.trim()) {
        toast({ title: "請填寫故事標題", variant: "destructive" });
        return;
      }
      const activeScenes = storyScenes.slice(0, storySceneCount);
      const hasEmptyScenes = activeScenes.some(s => !s.description.trim());
      if (hasEmptyScenes) {
        toast({ title: "請填寫所有場景描述", description: "每一幕都需要有描述才能生成。", variant: "destructive" });
        return;
      }
      const effectiveStyle = storyStyle === "custom" ? storyCustomStyle.trim() : storyStyle;
      if (!effectiveStyle) {
        toast({ title: "請填寫自訂畫風描述", variant: "destructive" });
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
        toast({ title: "缺少圖片", description: "請先上傳圖片。", variant: "destructive" });
        return;
      }
      if (isBatchMode) {
        const validPrompts = batchPrompts.filter(p => p.trim());
        if (validPrompts.length < 2) {
          toast({ title: "缺少描述", description: "批次生成需要至少輸入 2 個描述。", variant: "destructive" });
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
          toast({ title: "缺少描述", description: "請輸入描述。", variant: "destructive" });
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
        toast({ title: "缺少描述", description: "請輸入文字描述來生成圖片。", variant: "destructive" });
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
        toast({ title: "缺少描述", description: "請輸入影片內容描述。", variant: "destructive" });
        return;
      }
      videoGenerateMutation.mutate({
        type: "text-to-video",
        prompt: videoPrompt.trim(),
        duration: videoDuration,
        cameraFixed,
        aspectRatio: videoAspectRatio,
        resolution: videoResolution,
      });
    } else if (mode === "image-to-video") {
      if (!uploadedImagePath) {
        toast({ title: "缺少圖片", description: "請先上傳圖片。", variant: "destructive" });
        return;
      }
      if (!videoPrompt.trim()) {
        toast({ title: "缺少描述", description: "請輸入影片動態描述。", variant: "destructive" });
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
      };
      videoGenerateMutation.mutate(videoData);
    }
  };

  const handleUploadError = (error: Error) => {
    toast({ title: "上傳失敗", description: error.message || "圖片上傳失敗。", variant: "destructive" });
  };

  const removeImage = () => {
    setUploadedImageUrl("");
    setUploadedImagePath("");
    setCurrentGenerationId("");
    setCurrentBatchId("");
    setBatchGenerations([]);
    setAdditionalImages([]);
    setIsMultiImageMode(false);
  };

  const handleAdditionalUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (result.successful && result.successful[0]) {
      const uploadURL = result.successful[0].uploadURL;
      try {
        const response = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
        const data = await response.json();
        setAdditionalImages(prev => [...prev, { url: data.objectPath, path: data.objectPath }]);
        toast({ title: "參考圖片上傳成功", description: `已新增第 ${additionalImages.length + 2} 張參考圖片。` });
      } catch (error) {
        toast({ title: "上傳錯誤", description: "處理上傳圖片失敗。", variant: "destructive" });
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
      toast({ title: `${label}上傳成功`, description: `已新增 ${uploaded.length} 張圖。` });
    } catch (error) {
      toast({ title: "上傳錯誤", description: "處理上傳圖片失敗。", variant: "destructive" });
    }
  };

  const handleCharacterImageUpload = makeStoryRefUploadHandler(setStoryCharacterImages, 2, "角色 A 長相參考");
  const handleCharacterBImageUpload = makeStoryRefUploadHandler(setStoryCharacterBImages, 2, "角色 B 長相參考");
  const handleSceneRefImageUpload = makeStoryRefUploadHandler(setStorySceneRefImages, 2, "場景參考圖");
  const handleStyleImageUpload = makeStoryRefUploadHandler(setStoryStyleImages, 2, "畫風參考圖");

  const updateStorySceneCount = (count: number) => {
    setStorySceneCount(count);
    setStoryScenes(prev => {
      const arr = [...prev];
      while (arr.length < 12) arr.push({ title: `第 ${arr.length + 1} 幕`, description: "" });
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
      toast({ title: `第 ${idx + 1} 幕場景圖上傳成功` });
    } catch {
      toast({ title: "場景圖上傳失敗", variant: "destructive" });
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

  const WATERMARK_REMOVAL_COST = 5;
  const getCreditsNeeded = () => {
    if (mode === "story") return storySceneCount * 3;
    if (mode === "image-to-video" || mode === "text-to-video") return Math.round(videoDuration * (videoResolution === "720p" ? 3.4 : 6.8));
    const perImageCost = watermark ? 3 : 3 + WATERMARK_REMOVAL_COST;
    if (mode === "text-to-image") return isSequentialMode ? perImageCost * sequentialCount : perImageCost;
    if (isBatchMode) return perImageCost * batchPrompts.filter(p => p.trim()).length;
    if (isI2ISequentialMode) return perImageCost * i2iSequentialCount;
    return perImageCost;
  };

  const creditsNeeded = getCreditsNeeded();
  const hasEnoughCredits = (user?.credits ?? 0) >= creditsNeeded;

  const isSeedDanceMode = mode === "image-to-image" || mode === "text-to-image";
  const isVideoMode = mode === "image-to-video" || mode === "text-to-video";
  const isStoryMode = mode === "story";

  return (
    <div className="bg-gray-50 min-h-screen font-inter">
      <NavigationHeader />

      <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 text-white py-2 overflow-hidden">
        <div className="animate-marquee whitespace-nowrap text-sm font-medium">
          <span className="mx-8">📢 圖片生影片、文字生影片功能正在更新中，預計 2/24 更新至 SeedDance 2.0，敬請期待！</span>
          <span className="mx-8">📢 圖片生影片、文字生影片功能正在更新中，預計 2/24 更新至 SeedDance 2.0，敬請期待！</span>
          <span className="mx-8">📢 圖片生影片、文字生影片功能正在更新中，預計 2/24 更新至 SeedDance 2.0，敬請期待！</span>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-6">

          {/* Stats Bar */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-yellow-50 rounded-lg flex items-center justify-center">
                <i className="fas fa-coins text-yellow-500"></i>
              </div>
              <div>
                <p className="text-xs text-gray-500">積分餘額</p>
                <p className="text-xl font-bold text-gray-900">{user?.credits ?? 0}</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                <i className="fas fa-images text-blue-500"></i>
              </div>
              <div>
                <p className="text-xs text-gray-500">已生成</p>
                <p className="text-xl font-bold text-gray-900">{stats?.totalGenerations ?? 0} 次</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                <i className="fas fa-receipt text-green-500"></i>
              </div>
              <div>
                <p className="text-xs text-gray-500">已消費</p>
                <p className="text-xl font-bold text-gray-900">{stats?.totalCreditsUsed ?? 0} 積分</p>
              </div>
            </div>
          </div>

          {/* Model & Mode Selection */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Model Tabs */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => { if (isVideoMode) setMode("text-to-image"); }}
                className={`flex-1 py-3 px-6 text-sm font-medium transition-all relative ${
                  isSeedDanceMode 
                    ? "text-blue-700 bg-blue-50"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <span className="text-lg">🎨</span>
                  <span className="font-semibold">Seedream 5.0</span>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">圖片</span>
                </div>
                {isSeedDanceMode && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600" />}
              </button>
              <button
                onClick={() => { if (!isVideoMode) setMode("text-to-video"); }}
                className={`flex-1 py-3 px-6 text-sm font-medium transition-all relative ${
                  isVideoMode
                    ? "text-purple-700 bg-purple-50"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <span className="text-lg">🎬</span>
                  <span className="font-semibold">SeedDance 2.0</span>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">影片</span>
                </div>
                {isVideoMode && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600" />}
              </button>
              <button
                onClick={() => setMode("story")}
                className={`flex-1 py-3 px-6 text-sm font-medium transition-all relative ${
                  isStoryMode
                    ? "text-emerald-700 bg-emerald-50"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <span className="text-lg">📖</span>
                  <span className="font-semibold">故事模式</span>
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">分鏡</span>
                </div>
                {isStoryMode && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600" />}
              </button>
            </div>

            {/* SeedDance Sub-modes */}
            {isSeedDanceMode && (
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
                        <h3 className={`font-semibold text-sm ${mode === "text-to-image" ? "text-blue-700" : "text-gray-700"}`}>文字生圖<InfoTooltip text="輸入文字描述，AI 直接生成一張全新的圖片。例如：「一隻貓在海灘上散步」" /></h3>
                        <p className="text-xs text-gray-500 mt-0.5">用文字描述創建圖片</p>
                        <span className={`inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${!watermark ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>{watermark ? "3" : "8"} 積分/張</span>
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
                        <h3 className={`font-semibold text-sm ${mode === "image-to-image" ? "text-blue-700" : "text-gray-700"}`}>圖片編輯<InfoTooltip text="上傳一張現有圖片，搭配文字描述，AI 會根據指示修改圖片。例如：「把天空改成日落顏色」" /></h3>
                        <p className="text-xs text-gray-500 mt-0.5">AI 編輯現有圖片</p>
                        <span className={`inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${!watermark ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>{watermark ? "3" : "8"} 積分/張</span>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Feature Tags */}
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  {mode === "text-to-image" && (
                    <>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-layer-group mr-1"></i>序列生成<InfoTooltip text="開啟後，AI 會依序生成多張圖片，每張都在前一張的基礎上繼續變化，產出連貫的漸變效果" />
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-expand-arrows-alt mr-1"></i>多種尺寸<InfoTooltip text="支援多種圖片比例，包含正方形、橫向、直向等多種尺寸選項" />
                      </span>
                    </>
                  )}
                  {mode === "image-to-image" && (
                    <>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-clone mr-1"></i>批次生成<InfoTooltip text="一次生成多張不同的圖片，每張可以輸入不同的描述" />
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-object-group mr-1"></i>多圖融合<InfoTooltip text="上傳多張圖片，AI 會把元素融合在一起，適合服裝替換、風格混合" />
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-layer-group mr-1"></i>序列生成<InfoTooltip text="以圖片為基礎，連續生成一系列逐步變化的圖片" />
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
                        <h3 className={`font-semibold text-sm ${mode === "text-to-video" ? "text-purple-700" : "text-gray-700"}`}>文字生影片<InfoTooltip text="輸入文字描述，AI 直接生成一段影片。可選擇影片長度（4-12秒）和解析度（720P/1080P）" /></h3>
                        <p className="text-xs text-gray-500 mt-0.5">用文字描述創建影片</p>
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">3.4~6.8積分/秒</span>
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
                        <h3 className={`font-semibold text-sm ${mode === "image-to-video" ? "text-purple-700" : "text-gray-700"}`}>圖片生影片<InfoTooltip text="上傳一張圖片，AI 會讓它「動起來」變成影片。可選擇比例（16:9/9:16/1:1）、長度和解析度" /></h3>
                        <p className="text-xs text-gray-500 mt-0.5">將靜態圖片轉為影片</p>
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">3.4~6.8積分/秒</span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-text-width mr-1"></i>文字生影片
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-video mr-1"></i>動態鏡頭
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-crosshairs mr-1"></i>固定鏡頭
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-clock mr-1"></i>4-12 秒可選
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ============ TEXT-TO-IMAGE INPUT ============ */}
          {mode === "text-to-image" && (
            <Card className="bg-white rounded-xl shadow-sm border border-gray-200">
              <CardContent className="p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                    <i className="fas fa-pencil-alt text-blue-500"></i>
                    文字生成圖片
                  </h2>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-sm text-gray-600">序列生成<InfoTooltip text="開啟後，AI 會依序生成多張圖片，每張都在前一張的基礎上繼續變化，產出連貫的漸變效果" /></span>
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
                      ? "例如：生成一個四季變化的庭院角落系列..." 
                      : "例如：美麗的日落山水風景，寫實風格，高品質..."}
                    value={textPrompt}
                    onChange={(e) => setTextPrompt(e.target.value)}
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    {isSequentialMode 
                      ? "描述系列圖片主題，AI 自動生成連貫的多張圖片" 
                      : "詳細描述您想在圖片中看到的內容"}
                  </p>
                </div>

                {isSequentialMode && (
                  <div className="p-4 bg-blue-50 rounded-xl border border-blue-100">
                    <div className="flex items-center gap-4">
                      <Label className="text-sm font-medium text-gray-700">生成數量</Label>
                      <Input
                        type="number" min="2" max="10"
                        value={sequentialCount}
                        onChange={(e) => setSequentialCount(Math.min(10, Math.max(2, parseInt(e.target.value) || 2)))}
                        className="w-20 px-3 py-1.5 border border-blue-200 rounded-lg"
                      />
                      <span className="text-sm text-gray-500">張 (2-10)</span>
                      <span className="ml-auto text-sm font-semibold text-blue-600">{sequentialCount * (watermark ? 3 : 8)} 積分</span>
                    </div>
                    <p className="text-xs text-blue-600 mt-2">
                      <i className="fas fa-info-circle mr-1"></i>
                      序列生成會創建一組連貫的圖片系列，適合四季變化、時間流逝等主題
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-700">圖片尺寸</Label>
                    <select 
                      value={size} onChange={(e) => setSize(e.target.value)}
                      className="mt-1.5 w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    >
                      <option value="2K">2K 高清 (推薦)</option>
                      <option value="4K">4K 超高清</option>
                      <option value="1920x1920">1:1 正方形</option>
                      <option value="2560x1440">16:9 橫向</option>
                      <option value="1440x2560">9:16 直向</option>
                      <option value="2048x1536">4:3 橫向</option>
                      <option value="1536x2048">3:4 直向</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">引導強度</Label>
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
              <Card className="bg-white rounded-xl shadow-sm border border-gray-200">
                <CardContent className="p-6">
                  <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-4">
                    <i className="fas fa-upload text-blue-500"></i>
                    上傳您的圖片
                  </h2>
                  {!uploadedImageUrl ? (
                    <UnifiedUploader
                      maxNumberOfFiles={1} maxFileSize={10485760}
                      onGetUploadParameters={handleGetUploadParameters}
                      onComplete={handleUploadComplete}
                      onError={handleUploadError}
                      className="w-full"
                    >
                      拖放圖片到此處或點擊瀏覽
                    </UnifiedUploader>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">已選擇的圖片：</span>
                        <button className="text-red-500 hover:text-red-700 text-sm flex items-center gap-1" onClick={removeImage}>
                          <i className="fas fa-times"></i>移除
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
              <Card className="bg-white rounded-xl shadow-sm border border-gray-200">
                <CardContent className="p-6 space-y-5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                      <i className="fas fa-edit text-blue-500"></i>
                      描述修改內容
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
                      <i className="fas fa-object-group"></i>多圖融合<InfoTooltip text="上傳多張圖片（2-4張），AI 會把這些圖片的元素融合在一起。適合服裝替換、風格融合、角色一致性等效果" />
                    </button>
                    <button
                      onClick={() => { setIsI2ISequentialMode(!isI2ISequentialMode); if (!isI2ISequentialMode) setIsBatchMode(false); }}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${
                        isI2ISequentialMode ? "border-purple-400 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-500 hover:border-purple-300"
                      }`}
                    >
                      <i className="fas fa-layer-group"></i>序列生成<InfoTooltip text="以第一張圖為基礎，連續生成一系列逐步變化的圖片。適合做漸變效果，每張都在前一張的基礎上繼續修改" />
                    </button>
                    <button
                      onClick={() => { setIsBatchMode(!isBatchMode); if (!isBatchMode) { updateBatchCount(batchCount); setIsI2ISequentialMode(false); setIsMultiImageMode(false); setAdditionalImages([]); } }}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${
                        isBatchMode ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:border-blue-300"
                      }`}
                    >
                      <i className="fas fa-clone"></i>批次生成<InfoTooltip text="一次生成多張不同的圖片（最多6張），每張可以輸入不同的描述，AI 會各自獨立產出不同版本" />
                    </button>
                  </div>
                  
                  {!isBatchMode ? (
                    <div className="space-y-4">
                      <Textarea 
                        rows={3}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                        placeholder={isMultiImageMode 
                          ? "例如：用圖片 2 的服裝替換圖片 1 中人物的衣服" 
                          : "例如：把泡泡變成愛心形狀、把天空改成日落顏色..."}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                      />

                      {isMultiImageMode && (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                          <Label className="text-sm font-medium text-gray-700 mb-3 block">
                            <i className="fas fa-images text-green-600 mr-2"></i>
                            參考圖片（圖片 2、3、4...）
                          </Label>
                          <p className="text-xs text-green-700 mb-3">
                            上傳額外的參考圖片，用於服裝替換、風格融合、角色一致性等效果
                          </p>
                          <div className="grid grid-cols-4 gap-3 mb-2">
                            {additionalImages.map((img, index) => (
                              <div key={index} className="relative">
                                <img src={img.path.startsWith('/') ? img.path : `/${img.path}`} alt={`參考圖片 ${index + 2}`} className="w-full aspect-square object-cover rounded-lg border border-green-300" />
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
                          <p className="text-xs text-gray-500">最多 4 張（已上傳 {additionalImages.length} 張）</p>
                        </div>
                      )}

                      {isI2ISequentialMode && (
                        <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl">
                          <div className="flex items-center gap-4">
                            <Label className="text-sm font-medium text-gray-700">序列數量</Label>
                            <Input
                              type="number" min="2" max="10"
                              value={i2iSequentialCount}
                              onChange={(e) => setI2ISequentialCount(Math.min(10, Math.max(2, parseInt(e.target.value) || 2)))}
                              className="w-20 px-3 py-1.5 border border-purple-200 rounded-lg"
                            />
                            <span className="text-sm text-gray-500">張 (2-10)</span>
                            <span className="ml-auto text-sm font-semibold text-purple-600">{i2iSequentialCount * (watermark ? 3 : 8)} 積分</span>
                          </div>
                          <p className="text-xs text-purple-600 mt-2">
                            <i className="fas fa-info-circle mr-1"></i>
                            {isMultiImageMode 
                              ? "使用多張參考圖片生成一系列連貫的圖片" 
                              : "基於圖片生成一系列連貫的變化版本"}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center gap-4">
                        <Label className="text-sm font-medium text-gray-700">批次數量</Label>
                        <select
                          value={batchCount}
                          onChange={(e) => updateBatchCount(parseInt(e.target.value))}
                          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm"
                        >
                          {[2,3,4,5,6].map(n => <option key={n} value={n}>{n} 張</option>)}
                        </select>
                        <span className="ml-auto text-sm font-semibold text-blue-600">{batchPrompts.filter(p => p.trim()).length * (watermark ? 3 : 8)} 積分</span>
                      </div>
                      <div className="space-y-3">
                        {batchPrompts.map((p, index) => (
                          <div key={index}>
                            <Label className="text-xs text-gray-500 mb-1 block">圖片 {index + 1}</Label>
                            <Textarea
                              rows={2}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg resize-none text-sm"
                              placeholder={`第 ${index + 1} 張的描述...`}
                              value={p}
                              onChange={(e) => updateBatchPrompt(index, e.target.value)}
                            />
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400">每張圖片依照其特定描述生成，保持相同的基礎圖片和設定</p>
                    </div>
                  )}

                  {/* Advanced Settings */}
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-2">
                      <i className="fas fa-cog"></i>進階設定
                      <i className="fas fa-chevron-down text-xs transform group-open:rotate-180 transition-transform"></i>
                    </summary>
                    <div className="mt-3 grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl">
                      <div>
                        <Label className="text-sm text-gray-600">引導強度</Label>
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
                        <Label className="text-sm text-gray-600">種子值</Label>
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
            <Card className="bg-white rounded-xl shadow-sm border border-purple-200">
              <CardContent className="p-6 space-y-5">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <i className="fas fa-pencil-alt text-purple-500"></i>
                  文字生影片
                </h2>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label className="text-sm font-medium text-gray-700">描述影片內容</Label>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => enhanceVideoPromptAIMutation.mutate("text-to-video")}
                        disabled={!videoPrompt.trim() || enhanceVideoPromptAIMutation.isPending || enhanceVideoPromptClaudeMutation.isPending}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {enhanceVideoPromptAIMutation.isPending ? (
                          <><i className="fas fa-spinner fa-spin text-xs"></i> 優化中...</>
                        ) : (
                          <><i className="fas fa-magic text-xs"></i> ①AI優化</>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => enhanceVideoPromptClaudeMutation.mutate("text-to-video")}
                        disabled={!videoPrompt.trim() || enhanceVideoPromptAIMutation.isPending || enhanceVideoPromptClaudeMutation.isPending}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {enhanceVideoPromptClaudeMutation.isPending ? (
                          <><i className="fas fa-spinner fa-spin text-xs"></i> 優化中...</>
                        ) : (
                          <><i className="fas fa-robot text-xs"></i> ②Claude優化</>
                        )}
                      </button>
                    </div>
                  </div>
                  <Textarea 
                    placeholder="例如：一隻橘貓在陽光下的草地上追蝴蝶，鏡頭緩慢環繞"
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    className="w-full min-h-[100px] px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">詳細描述您想要的影片畫面和動態效果 ・先①AI優化讓描述更豐富，再②Claude優化轉為英文專業格式</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-700">影片長度</Label>
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
                        <span className="text-sm text-gray-500">4秒</span>
                        <span className="text-lg font-bold text-purple-700">{videoDuration} 秒</span>
                        <span className="text-sm text-gray-500">12秒</span>
                      </div>
                      <div className="text-center text-sm font-medium text-purple-600 bg-purple-50 rounded-lg py-1.5">
                        {Math.round(videoDuration * (videoResolution === "720p" ? 3.4 : 6.8))} 積分（{videoDuration}秒 × {videoResolution === "720p" ? "3.4" : "6.8"}積分/秒）
                      </div>
                    </div>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">鏡頭模式</Label>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setCameraFixed(false)}
                        className={`p-3 rounded-lg border-2 text-center transition-all ${
                          !cameraFixed 
                            ? "border-purple-500 bg-purple-50 text-purple-700" 
                            : "border-gray-200 text-gray-600 hover:border-purple-200"
                        }`}
                      >
                        <div className="font-semibold text-sm">動態鏡頭</div>
                        <div className="text-xs mt-0.5">自動運鏡</div>
                      </button>
                      <button
                        onClick={() => setCameraFixed(true)}
                        className={`p-3 rounded-lg border-2 text-center transition-all ${
                          cameraFixed 
                            ? "border-purple-500 bg-purple-50 text-purple-700" 
                            : "border-gray-200 text-gray-600 hover:border-purple-200"
                        }`}
                      >
                        <div className="font-semibold text-sm">固定鏡頭</div>
                        <div className="text-xs mt-0.5">穩定畫面</div>
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">影片解析度</Label>
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
                      <div className="text-xs mt-0.5 text-green-600 font-medium">3.4 積分/秒</div>
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
                      <div className="text-xs mt-0.5 text-orange-600 font-medium">6.8 積分/秒</div>
                    </button>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">畫面比例</Label>
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
                      <div className="text-xs mt-0.5">橫向</div>
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
                      <div className="text-xs mt-0.5">直向</div>
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
                      <div className="text-xs mt-0.5">方形</div>
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-sm text-purple-700 flex items-center gap-2">
                  <i className="fas fa-info-circle"></i>
                  影片生成需要 1-3 分鐘，費用：{Math.round(videoDuration * (videoResolution === "720p" ? 3.4 : 6.8))} 積分
                </div>

                <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl">
                  <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                    <i className="fas fa-coins text-yellow-500"></i>
                    影片生成費用說明
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                      <div className="font-semibold text-gray-700">720P 標準畫質</div>
                      <div className="text-green-600 font-bold text-base mt-1">3.4 積分/秒</div>
                      <div className="text-gray-400 mt-0.5">適合一般用途、社群分享</div>
                    </div>
                    <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                      <div className="font-semibold text-gray-700">1080P 高畫質</div>
                      <div className="text-orange-600 font-bold text-base mt-1">6.8 積分/秒</div>
                      <div className="text-gray-400 mt-0.5">適合專業製作、高品質需求</div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                    <i className="fas fa-calculator"></i>
                    計算方式：影片秒數 × 每秒積分 = 總費用（支援 4-12 秒）
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ============ IMAGE-TO-VIDEO INPUT ============ */}
          {mode === "image-to-video" && (
            <Card className="bg-white rounded-xl shadow-sm border border-purple-200">
              <CardContent className="p-6 space-y-5">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <i className="fas fa-video text-purple-500"></i>
                  圖片生影片
                </h2>
              
                {!uploadedImageUrl ? (
                  <UnifiedUploader
                    maxNumberOfFiles={1} maxFileSize={10485760}
                    onGetUploadParameters={handleGetUploadParameters}
                    onComplete={handleUploadComplete}
                    onError={handleUploadError}
                    className="w-full"
                  >
                    拖放圖片到此處或點擊瀏覽
                  </UnifiedUploader>
                ) : (
                  <div className="space-y-5">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">來源圖片</span>
                        <button className="text-red-500 hover:text-red-700 text-sm flex items-center gap-1" onClick={removeImage}>
                          <i className="fas fa-times"></i>移除
                        </button>
                      </div>
                      <div className="bg-gray-100 rounded-lg overflow-hidden">
                        <img src={uploadedImageUrl} alt="Video source" className="w-full h-48 object-cover" />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <Label className="text-sm font-medium text-gray-700">描述影片動態效果</Label>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => enhanceVideoPromptAIMutation.mutate("image-to-video")}
                            disabled={!videoPrompt.trim() || enhanceVideoPromptAIMutation.isPending || enhanceVideoPromptClaudeMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {enhanceVideoPromptAIMutation.isPending ? (
                              <><i className="fas fa-spinner fa-spin text-xs"></i> 優化中...</>
                            ) : (
                              <><i className="fas fa-magic text-xs"></i> ①AI優化</>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => enhanceVideoPromptClaudeMutation.mutate("image-to-video")}
                            disabled={!videoPrompt.trim() || enhanceVideoPromptAIMutation.isPending || enhanceVideoPromptClaudeMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {enhanceVideoPromptClaudeMutation.isPending ? (
                              <><i className="fas fa-spinner fa-spin text-xs"></i> 優化中...</>
                            ) : (
                              <><i className="fas fa-robot text-xs"></i> ②Claude優化</>
                            )}
                          </button>
                        </div>
                      </div>
                      <Textarea 
                        placeholder="例如：高速穿越障礙物，帶來沉浸式的飛行體驗"
                        value={videoPrompt}
                        onChange={(e) => setVideoPrompt(e.target.value)}
                        className="w-full min-h-[100px] px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                      />
                      <p className="text-xs text-gray-400 mt-1">描述您希望圖片如何變成動態影片 ・先①AI優化讓描述更豐富，再②Claude優化轉為英文專業格式</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium text-gray-700">影片長度</Label>
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
                            <span className="text-sm text-gray-500">4秒</span>
                            <span className="text-lg font-bold text-purple-700">{videoDuration} 秒</span>
                            <span className="text-sm text-gray-500">12秒</span>
                          </div>
                          <div className="text-center text-sm font-medium text-purple-600 bg-purple-50 rounded-lg py-1.5">
                            {Math.round(videoDuration * (videoResolution === "720p" ? 3.4 : 6.8))} 積分（{videoDuration}秒 × {videoResolution === "720p" ? "3.4" : "6.8"}積分/秒）
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-gray-700">鏡頭模式</Label>
                        <div className="mt-1.5 grid grid-cols-2 gap-2">
                          <button
                            onClick={() => setCameraFixed(false)}
                            className={`p-3 rounded-lg border-2 text-center transition-all ${
                              !cameraFixed 
                                ? "border-purple-500 bg-purple-50 text-purple-700" 
                                : "border-gray-200 text-gray-600 hover:border-purple-200"
                            }`}
                          >
                            <div className="font-semibold text-sm">動態鏡頭</div>
                            <div className="text-xs mt-0.5">自動運鏡</div>
                          </button>
                          <button
                            onClick={() => setCameraFixed(true)}
                            className={`p-3 rounded-lg border-2 text-center transition-all ${
                              cameraFixed 
                                ? "border-purple-500 bg-purple-50 text-purple-700" 
                                : "border-gray-200 text-gray-600 hover:border-purple-200"
                            }`}
                          >
                            <div className="font-semibold text-sm">固定鏡頭</div>
                            <div className="text-xs mt-0.5">穩定畫面</div>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-medium text-gray-700">影片解析度</Label>
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
                          <div className="text-xs mt-0.5 text-green-600 font-medium">3.4 積分/秒</div>
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
                          <div className="text-xs mt-0.5 text-orange-600 font-medium">6.8 積分/秒</div>
                        </button>
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-medium text-gray-700">畫面比例</Label>
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
                          <div className="text-xs mt-0.5">橫向</div>
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
                          <div className="text-xs mt-0.5">直向</div>
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
                          <div className="text-xs mt-0.5">方形</div>
                        </button>
                      </div>
                    </div>

                    <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-sm text-purple-700 flex items-center gap-2">
                      <i className="fas fa-info-circle"></i>
                      影片生成需要 1-3 分鐘，費用：{Math.round(videoDuration * (videoResolution === "720p" ? 3.4 : 6.8))} 積分
                    </div>

                    <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl">
                      <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                        <i className="fas fa-coins text-yellow-500"></i>
                        影片生成費用說明
                      </h4>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                          <div className="font-semibold text-gray-700">720P 標準畫質</div>
                          <div className="text-green-600 font-bold text-base mt-1">3.4 積分/秒</div>
                          <div className="text-gray-400 mt-0.5">適合一般用途、社群分享</div>
                        </div>
                        <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                          <div className="font-semibold text-gray-700">1080P 高畫質</div>
                          <div className="text-orange-600 font-bold text-base mt-1">6.8 積分/秒</div>
                          <div className="text-gray-400 mt-0.5">適合專業製作、高品質需求</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                        <i className="fas fa-calculator"></i>
                        計算方式：影片秒數 × 每秒積分 = 總費用（支援 4-12 秒）
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
                  <span className="text-sm font-medium text-gray-700">浮水印</span>
                  <p className="text-xs text-gray-400">
                    {watermark ? "生成圖片會包含浮水印" : "已移除浮水印（每張 +5 積分）"}
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
                去除浮水印：每張圖片額外 +{WATERMARK_REMOVAL_COST} 積分（共 {3 + WATERMARK_REMOVAL_COST} 積分/張）
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
                    <h3 className="font-semibold text-gray-900">去除浮水印 — 免責聲明</h3>
                    <p className="text-xs text-gray-500">請詳閱以下條款後勾選同意</p>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 space-y-2 max-h-48 overflow-y-auto border">
                  <p><strong>1. 額外費用：</strong>去除浮水印將對每張圖片額外收取 {WATERMARK_REMOVAL_COST} 積分（原價 3 積分 + 去浮水印 {WATERMARK_REMOVAL_COST} 積分 = 每張 {3 + WATERMARK_REMOVAL_COST} 積分）。</p>
                  <p><strong>2. 版權責任：</strong>去除浮水印後的圖片，使用者須自行承擔所有版權及法律責任。本平台不對去除浮水印後圖片的使用方式及其衍生之任何法律糾紛負責。</p>
                  <p><strong>3. 商業使用：</strong>使用者將去浮水印圖片用於商業用途時，應確保內容不侵犯第三方權益，並遵守相關法律法規。</p>
                  <p><strong>4. 禁止濫用：</strong>嚴禁將去浮水印圖片用於任何違法、侵權、詐騙、冒名或損害他人名譽之用途。</p>
                  <p><strong>5. 免責範圍：</strong>本平台（極電行銷整合）僅提供 AI 圖片生成技術服務，對生成內容之後續使用不承擔任何直接或間接責任。</p>
                </div>

                <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <Checkbox
                    checked={disclaimerAgreed}
                    onCheckedChange={(checked) => setDisclaimerAgreed(checked === true)}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-gray-700">我已閱讀並同意上述免責聲明條款，了解去除浮水印的額外費用及相關責任。</span>
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
                    取消
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
                    確認去除浮水印
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
                {showStoryHistory ? "收起歷史記錄" : "我的故事歷史"}
              </button>
            </div>
          )}
          {isStoryMode && showStoryHistory && !isStoryGenerating && (
            <Card className="bg-white rounded-xl shadow-sm border border-emerald-200">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <i className="fas fa-history text-emerald-600"></i>故事歷史紀錄
                  <span className="text-xs font-normal text-gray-400">（點擊可重新載入查看）</span>
                </h3>
                {storyHistory.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">尚無故事紀錄</p>
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
                                {story.status === "completed" ? `✓ ${doneCount}幕完成` :
                                 story.status === "generating" ? "生成中..." :
                                 story.status === "failed" ? "失敗" : "等待中"}
                              </span>
                              <span className="text-xs text-gray-400">{new Date(story.createdAt!).toLocaleDateString("zh-TW")}</span>
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
            <Card className="bg-white rounded-xl shadow-sm border border-emerald-200">
              <CardContent className="p-6 space-y-5">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <span className="text-xl">📖</span>
                  故事分鏡設定
                </h2>

                {/* Story Title */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">故事標題</Label>
                  <Input
                    placeholder="例如：神秘森林的冒險"
                    value={storyTitle}
                    onChange={e => setStoryTitle(e.target.value)}
                    className="rounded-xl border-gray-200 focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Story Full Content */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    故事內容（選填）
                    <InfoTooltip text="貼上已寫好的故事全文，Claude 會根據內容自動生成更精準的場景描述與圖片提示詞" />
                  </Label>
                  <Textarea
                    rows={4}
                    placeholder="貼上你已經寫好的故事內容（例如劇本、腳本、故事大綱），Claude 優化提示詞時會參考此內容..."
                    value={storyContent}
                    onChange={e => setStoryContent(e.target.value)}
                    className="resize-y text-sm border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* Style Selection */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    畫風選擇
                    <InfoTooltip text="選擇整個故事的統一畫面風格，每幕圖片都會套用此風格" />
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
                      placeholder="請描述自訂畫風（英文效果最佳）"
                      value={storyCustomStyle}
                      onChange={e => setStoryCustomStyle(e.target.value)}
                    />
                  )}
                </div>

                {/* Scene Count */}
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-1.5 block">
                    場景數量（{storySceneCount} 幕，共 {storySceneCount * 3} 積分）
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
                    場景圖比例
                    <InfoTooltip text="選擇生成圖片的尺寸比例，手機直向適合短影音、IG 限時動態；正方形適合社群貼文；橫向適合桌面或影片截圖" />
                  </Label>
                  <div className="flex gap-2">
                    {[
                      { value: "1:1" as const, label: "1:1", sub: "正方形", icon: "⬜" },
                      { value: "9:16" as const, label: "9:16", sub: "手機直向", icon: "📱" },
                      { value: "16:9" as const, label: "16:9", sub: "橫向寬屏", icon: "🖥️" },
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
                    角色種子（選填）
                    <InfoTooltip text="鎖定同一個種子數字，讓所有幕的角色外觀更加一致。可手動輸入或隨機產生，建議記下來供下集使用。" />
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      placeholder="1000 – 999999（空白 = 隨機）"
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
                      🎲 隨機
                    </button>
                    {storySeed !== "" && (
                      <button
                        type="button"
                        onClick={() => { navigator.clipboard.writeText(String(storySeed)); toast({ title: "已複製種子", description: `種子 ${storySeed} 已複製到剪貼簿` }); }}
                        className="px-3 py-2 rounded-xl border-2 border-gray-200 bg-gray-50 text-gray-600 text-xs font-medium hover:bg-gray-100 transition-all whitespace-nowrap"
                      >
                        📋 複製
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
                    { label: "角色 A 外貌", sub: "保持每幕角色 A 外貌一致", icon: "🧑", images: storyCharacterImages, setter: setStoryCharacterImages, handler: handleCharacterImageUpload, color: "violet" },
                    { label: "角色 B 外貌", sub: "保持每幕角色 B 外貌一致（選填）", icon: "🧑‍🦱", images: storyCharacterBImages, setter: setStoryCharacterBImages, handler: handleCharacterBImageUpload, color: "orange" },
                    { label: "場景參考圖", sub: "構圖、場景、環境風格", icon: "🏞️", images: storySceneRefImages, setter: setStorySceneRefImages, handler: handleSceneRefImageUpload, color: "blue" },
                    { label: "畫風參考圖", sub: "整體美術風格與質感", icon: "🎨", images: storyStyleImages, setter: setStoryStyleImages, handler: handleStyleImageUpload, color: "pink" },
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
                      <span className="text-xs text-gray-400 font-normal">（選填，最多 2 張）</span>
                      <InfoTooltip text={`上傳「${label}」參考圖，AI 將在生成每幕時參考此圖的${sub}`} />
                    </Label>
                    {images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {images.map((img, idx) => (
                          <div key={idx} className="relative group">
                            <img
                              src={img.url.startsWith("/objects/") ? img.url : `/objects/${img.url.replace(/^\//, "")}`}
                              alt={`${label} ${idx + 1}`}
                              className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                              onError={e => { (e.target as HTMLImageElement).src = "https://placehold.co/64?text=圖" }}
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
                        點擊上傳{label}（{images.length}/2）
                      </UnifiedUploader>
                    )}
                  </div>
                ))}

                {/* Scene Cards */}
                <div>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <Label className="text-sm font-medium text-gray-700">
                      各幕場景描述
                    </Label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Step indicator */}
                      <span className="hidden sm:flex items-center gap-1 text-[10px] text-gray-400 mr-1">
                        <span className="w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[9px] font-bold flex items-center justify-center">1</span>
                        AI 中文大綱
                        <span className="text-gray-300">→</span>
                        <span className="w-4 h-4 rounded-full bg-violet-100 text-violet-700 text-[9px] font-bold flex items-center justify-center">2</span>
                        Claude 加強
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (!storyTitle.trim()) {
                            toast({ title: "請先填寫故事標題", variant: "destructive" });
                            return;
                          }
                          claudeOutlineMutation.mutate();
                        }}
                        disabled={claudeOutlineMutation.isPending || claudeEnhanceMutation.isPending}
                        title="第一步：AI 依起承轉合結構自動生成中文分鏡大綱"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {claudeOutlineMutation.isPending ? (
                          <><div className="w-3 h-3 border border-emerald-600 border-t-transparent rounded-full animate-spin" />生成中...</>
                        ) : (
                          <><span className="text-emerald-500 mr-0.5">①</span> AI 生成大綱</>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!storyTitle.trim()) {
                            toast({ title: "請先填寫故事標題", variant: "destructive" });
                            return;
                          }
                          if (storyScenes.slice(0, storySceneCount).some(s => !s.title.trim() && !s.description.trim())) {
                            toast({ title: "請至少填寫場景標題或描述", variant: "destructive" });
                            return;
                          }
                          claudeEnhanceMutation.mutate();
                        }}
                        disabled={claudeEnhanceMutation.isPending || claudeOutlineMutation.isPending}
                        title="第二步：Claude 將中文大綱加強為專業英文提示詞，保留起承轉合節奏"
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 hover:border-violet-300 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {claudeEnhanceMutation.isPending ? (
                          <>
                            <div className="w-3 h-3 border border-violet-600 border-t-transparent rounded-full animate-spin" />
                            Claude 生成中...
                          </>
                        ) : (
                          <><span className="text-violet-400 mr-0.5">②</span> Claude 加強提示詞</>
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
                            placeholder={`第 ${idx + 1} 幕標題`}
                          />
                        </div>
                        <div className="flex gap-2">
                          <div className="flex flex-col gap-1.5 flex-1">
                            <Textarea
                              rows={2}
                              value={scene.description}
                              onChange={e => updateStoryScene(idx, "description", e.target.value)}
                              placeholder={`描述第 ${idx + 1} 幕的場景內容（例如：主角站在山頂俯瞰整個城市，夕陽西下）`}
                              className="resize-none text-sm border-gray-100 bg-gray-50 rounded-lg focus:ring-2 focus:ring-emerald-500"
                            />
                            <div className="relative">
                              <span className="absolute left-2 top-1.5 text-[10px] text-amber-500 font-semibold pointer-events-none">💬</span>
                              <input
                                type="text"
                                value={scene.dialogue || ""}
                                onChange={e => updateStoryScene(idx, "dialogue", e.target.value)}
                                placeholder="台詞（選填）：角色說的話..."
                                className="w-full pl-6 pr-2 py-1.5 text-xs border border-amber-100 bg-amber-50/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-300 placeholder:text-gray-300 text-gray-700"
                              />
                            </div>
                          </div>
                          <div className="flex-shrink-0">
                            {scene.sceneReferenceImageUrl ? (
                              <div className="relative group w-16 h-16">
                                <img
                                  src={scene.sceneReferenceImageUrl.startsWith("/objects/") ? scene.sceneReferenceImageUrl : `/objects/${scene.sceneReferenceImageUrl.replace(/^\//, "")}`}
                                  alt="場景參考"
                                  className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                                  onError={e => { (e.target as HTMLImageElement).src = "https://placehold.co/64?text=圖" }}
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
                                    <span className="text-[9px] text-gray-400 group-hover:text-emerald-600 mt-0.5">上傳</span>
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
                  故事生成按順序逐幕進行，共需 {storySceneCount * 3} 積分（每幕 3 積分）。生成中可即時看到各幕進度。
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
                    <span>正在生成故事...</span>
                  </>
                ) : storyGeneration?.status === "completed" ? (
                  <>
                    <i className="fas fa-redo"></i>
                    <span>重新生成故事</span>
                  </>
                ) : (
                  <>
                    <span>✨</span>
                    <span>生成故事（{storySceneCount} 幕）</span>
                    <span className="text-sm bg-emerald-500 px-2.5 py-0.5 rounded-full">{creditsNeeded} 積分</span>
                  </>
                )
              ) : isGenerating ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>
                    {isVideoMode ? "正在生成影片..." 
                      : isBatchMode ? `正在生成 ${batchCount} 張圖片...`
                      : isSequentialMode ? `正在生成 ${sequentialCount} 張圖片...`
                      : isI2ISequentialMode ? `正在生成 ${i2iSequentialCount} 張圖片...`
                      : "生成中..."}
                  </span>
                </>
              ) : (
                <>
                  <i className={`fas ${isVideoMode ? "fa-video" : "fa-magic"}`}></i>
                  <span>
                    {isVideoMode ? "生成影片"
                      : mode === "text-to-image" 
                        ? isSequentialMode ? `生成 ${sequentialCount} 張序列圖片` : "生成圖片" 
                        : isBatchMode ? `批次生成 ${batchCount} 張`
                        : isI2ISequentialMode && isMultiImageMode ? `多圖序列生成 ${i2iSequentialCount} 張`
                        : isI2ISequentialMode ? `序列生成 ${i2iSequentialCount} 張`
                        : isMultiImageMode ? "多圖融合生成"
                        : "生成 AI 編輯"}
                  </span>
                  <span className={`text-sm ${isVideoMode ? "bg-purple-500" : "bg-blue-500"} px-2.5 py-0.5 rounded-full`}>
                    {creditsNeeded} 積分
                  </span>
                </>
              )}
            </Button>
            {!hasEnoughCredits && (
              <p className="text-red-500 text-sm flex items-center gap-1">
                <i className="fas fa-exclamation-triangle"></i>
                積分不足！需要 {creditsNeeded} 積分，目前餘額 {user?.credits ?? 0} 積分。
                <a href="/account" className="text-blue-600 underline ml-1">前往充值</a>
              </p>
            )}
            <p className="text-xs text-gray-400 text-center max-w-md">
              <i className="fas fa-info-circle mr-1"></i>
              AI 生成為技術交流，如有任何產生社會道德問題，請協尋專業法律諮詢
            </p>
          </div>

          {/* Loading State */}
          {isGenerating && (
            <Card className={`rounded-xl shadow-sm border ${isVideoMode ? "border-purple-200 bg-purple-50/30" : "border-blue-200 bg-blue-50/30"}`}>
              <CardContent className="p-8">
                <div className="text-center space-y-4">
                  <div className={`w-14 h-14 mx-auto border-4 ${isVideoMode ? "border-purple-500" : "border-blue-500"} border-t-transparent rounded-full animate-spin`} />
                  <h3 className="text-lg font-semibold text-gray-800">
                    {isVideoMode ? "正在生成影片" : "正在處理您的圖片"}
                  </h3>
                  <p className="text-gray-500 text-sm">
                    {isVideoMode ? "影片生成需要 1-3 分鐘，請耐心等待..." : "這可能需要一些時間..."}
                  </p>
                  <div className="w-full bg-gray-200 rounded-full h-1.5 max-w-sm mx-auto">
                    <div className={`${isVideoMode ? "bg-purple-500" : "bg-blue-500"} h-1.5 rounded-full animate-pulse`} style={{width: "45%"}} />
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
                <h3 className="text-red-800 font-semibold">生成失敗</h3>
                <p className="text-red-700 text-sm mt-1">{generation.errorMessage || "無法處理您的圖片，請重試。"}</p>
                <Button variant="ghost" className="text-blue-600 hover:text-blue-800 text-sm p-0 h-auto mt-2" onClick={handleGenerate}>
                  <i className="fas fa-redo mr-1"></i>重試
                </Button>
              </div>
            </div>
          )}

          {videoGeneration?.status === "failed" && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
              <i className="fas fa-exclamation-circle text-red-500 mt-0.5"></i>
              <div className="flex-1">
                <h3 className="text-red-800 font-semibold">影片生成失敗</h3>
                <p className="text-red-700 text-sm mt-1">{videoGeneration.errorMessage || "無法生成影片，請重試。"}</p>
                <Button variant="ghost" className="text-purple-600 hover:text-purple-800 text-sm p-0 h-auto mt-2" onClick={handleGenerate}>
                  <i className="fas fa-redo mr-1"></i>重試
                </Button>
              </div>
            </div>
          )}

          {/* Video Result */}
          {videoGeneration?.status === "completed" && videoGeneration.generatedVideoUrl && (
            <Card className="bg-white rounded-xl shadow-sm border border-purple-200">
              <CardContent className="p-6 space-y-4">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                  <i className="fas fa-video text-purple-500"></i>
                  影片生成結果
                </h2>
                <div className="bg-gray-900 rounded-lg overflow-hidden">
                  <video controls className="w-full max-h-96" src={videoGeneration.generatedVideoUrl}>
                    您的瀏覽器不支援影片播放。
                  </video>
                </div>
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg text-sm text-purple-700">
                  <span><i className="fas fa-clock mr-1"></i>影片長度：{videoGeneration.duration || 5} 秒</span>
                  <span className="font-semibold">費用：{videoGeneration.creditsUsed || Math.round((videoGeneration.duration || 5) * 6.8)} 積分（{videoGeneration.resolution === "720p" ? "720P" : "1080P"}）</span>
                </div>
                <div className="flex justify-center gap-3">
                  <Button className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg" onClick={() => {
                    const link = document.createElement('a');
                    link.href = videoGeneration.generatedVideoUrl!;
                    link.download = `generated-video-${videoGeneration.id}.mp4`;
                    link.click();
                  }}>
                    <i className="fas fa-download mr-2"></i>下載影片
                  </Button>
                  <Button variant="outline" className="border-purple-300 text-purple-600 hover:bg-purple-50 rounded-lg" onClick={() => {
                    setCurrentVideoGenerationId("");
                    setVideoPrompt("");
                  }}>
                    <i className="fas fa-plus mr-2"></i>生成新影片
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Single Image Result */}
          {generation?.status === "completed" && generation.generatedImageUrl && !currentBatchId && (
            <Card className="bg-white rounded-xl shadow-sm border border-gray-200">
              <CardContent className="p-6">
                <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-4">
                  <i className="fas fa-images text-blue-500"></i>
                  {generation.type === "text-to-image" ? "生成結果" : "修改前後對比"}
                </h2>
                
                {generation.type === "text-to-image" ? (
                  generation.generatedImageUrls && generation.generatedImageUrls.length > 1 ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">序列生成結果 ({generation.generatedImageUrls.length} 張)</span>
                        <span className="text-sm font-semibold text-blue-600">{generation.generatedImageUrls.length * 3} 積分</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {generation.generatedImageUrls.map((url, index) => (
                          <div key={index} className="space-y-2">
                            <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative group">
                              <img src={url} alt={`序列圖片 ${index + 1}`} className="w-full h-full object-cover hover:scale-105 transition-transform" />
                              <span className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">{index + 1}</span>
                            </div>
                            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => {
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = `sequential-image-${index + 1}.png`;
                              link.click();
                            }}>
                              <i className="fas fa-download mr-1"></i>下載
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
                          <i className="fas fa-download mr-2"></i>下載全部 ({generation.generatedImageUrls.length} 張)
                        </Button>
                        <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={handleGenerate}>
                          <i className="fas fa-redo mr-2"></i>再次生成
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
                        <span className="text-sm text-gray-600">序列生成結果 ({generation.generatedImageUrls.length} 張)</span>
                        <span className="text-sm font-semibold text-purple-600">{generation.generatedImageUrls.length * (watermark ? 3 : 8)} 積分</span>
                      </div>
                      <div className="mb-3 space-y-1">
                        <h3 className="text-sm font-medium text-gray-600">原始圖片</h3>
                        <div className="bg-gray-100 rounded-lg overflow-hidden w-32 h-32">
                          <img src={uploadedImageUrl} alt="Original" className="w-full h-full object-cover" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {generation.generatedImageUrls.map((url, index) => (
                          <div key={index} className="space-y-2">
                            <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square relative group">
                              <img src={url} alt={`序列圖片 ${index + 1}`} className="w-full h-full object-cover hover:scale-105 transition-transform" />
                              <span className="absolute top-2 left-2 bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">{index + 1}</span>
                            </div>
                            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => {
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = `sequential-image-${index + 1}.png`;
                              link.click();
                            }}>
                              <i className="fas fa-download mr-1"></i>下載
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
                          <i className="fas fa-download mr-2"></i>下載全部 ({generation.generatedImageUrls.length} 張)
                        </Button>
                        <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={handleGenerate}>
                          <i className="fas fa-redo mr-2"></i>再次生成
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-600 text-center">原始圖片</h3>
                        <div className="bg-gray-100 rounded-lg overflow-hidden aspect-square">
                          <img src={uploadedImageUrl} alt="Original" className="w-full h-full object-cover" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-600 text-center flex items-center justify-center gap-1">
                          AI 生成結果 <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">NEW</span>
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
                    <i className="fas fa-download mr-2"></i>下載結果
                  </Button>
                  <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={handleGenerate}>
                    <i className="fas fa-redo mr-2"></i>再次生成
                  </Button>
                  <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => {
                    if (navigator.share) {
                      navigator.share({ title: 'AI 生成的圖片', url: generation.generatedImageUrl! });
                    }
                  }}>
                    <i className="fas fa-share-alt mr-2"></i>分享
                  </Button>
                </div>

                {/* Generation Details */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <details className="group">
                    <summary className="cursor-pointer text-sm text-gray-500 hover:text-blue-600 flex items-center gap-2">
                      <i className="fas fa-info-circle"></i>
                      生成詳情
                      <i className="fas fa-chevron-down text-xs transform group-open:rotate-180 transition-transform"></i>
                    </summary>
                    <div className="mt-3 text-sm text-gray-600 space-y-1.5 bg-gray-50 rounded-lg p-3">
                      <div className="flex justify-between"><span>模型</span><span className="font-mono text-xs">Seedream 5.0</span></div>
                      <div className="flex justify-between"><span>描述</span><span className="text-xs max-w-[60%] text-right truncate">"{generation.prompt}"</span></div>
                      <div className="flex justify-between"><span>引導強度</span><span>{generation.guidanceScale}</span></div>
                      <div className="flex justify-between"><span>種子值</span><span>{generation.seed}</span></div>
                      <div className="flex justify-between"><span>處理時間</span><span>{generation.processingTime?.toFixed(1)}s</span></div>
                      <div className="flex justify-between"><span>費用</span><span className="font-semibold">{generation.watermark === false ? "8 積分（含去浮水印）" : "3 積分"}</span></div>
                    </div>
                  </details>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Batch Results */}
          {batchData && batchData.generations.some(g => g.status === "completed" && g.generatedImageUrl) && (
            <Card className="bg-white rounded-xl shadow-sm border border-gray-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-gray-800 flex items-center gap-2">
                    <i className="fas fa-images text-blue-500"></i>
                    批次生成結果
                  </h2>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">已完成 {batchData.completedCount}/{batchData.totalCount}</span>
                    <span className="text-sm font-semibold text-blue-600">{batchData.completedCount * 3} 積分</span>
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
                  <span className="text-sm text-gray-500">基礎圖片</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {batchData.generations.map((gen, index) => (
                    <div key={gen.id} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">圖片 {index + 1}</span>
                        {gen.status === "completed" && <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><i className="fas fa-check mr-1"></i>完成</span>}
                        {gen.status === "processing" && <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full"><i className="fas fa-spinner fa-spin mr-1"></i>處理中</span>}
                        {gen.status === "failed" && <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">失敗</span>}
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
                          <i className="fas fa-download mr-1"></i>下載
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
                      <i className="fas fa-download mr-2"></i>下載全部 ({batchData.completedCount} 張)
                    </Button>
                    <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={handleGenerate}>
                      <i className="fas fa-redo mr-2"></i>再次生成
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ============ STORY PROGRESS ============ */}
          {isStoryMode && isStoryGenerating && currentStoryId && (
            <Card className="bg-white rounded-xl shadow-sm border border-emerald-200">
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" style={{ borderWidth: 3 }} />
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-800">正在生成故事分鏡</h3>
                      <p className="text-sm text-gray-500">
                        {(() => {
                          if (!storyGeneration) return "初始化中...";
                          const scenes: StoryScene[] = JSON.parse(storyGeneration.scenes || "[]");
                          const done = scenes.filter(s => s.status === "completed").length;
                          const failed = scenes.filter(s => s.status === "failed").length;
                          const total = scenes.length;
                          const generating = scenes.find(s => s.status === "generating");
                          const remaining = total - done - failed;
                          const estSec = remaining * 25;
                          const estText = estSec >= 60 ? `約 ${Math.ceil(estSec / 60)} 分鐘` : `約 ${estSec} 秒`;
                          return <>
                            第 <span className="font-semibold text-emerald-600">{done + 1}</span> / {total} 幕
                            {generating ? `「${generating.title}」` : ""}生成中
                            {done > 0 && <span className="text-xs text-gray-400 ml-1">· 預估剩餘 {estText}</span>}
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
                                  <span className="text-gray-400 text-xs">第 {idx + 1} 幕</span>
                                )}
                              </div>
                            )}
                            <div className="p-2 bg-white">
                              <p className="text-xs font-medium text-gray-700 truncate">{scene.title || `第 ${idx + 1} 幕`}</p>
                              <span className={`text-xs ${
                                scene.status === "completed" ? "text-emerald-600" :
                                scene.status === "generating" ? "text-blue-500" :
                                scene.status === "failed" ? "text-red-500" : "text-gray-400"
                              }`}>
                                {scene.status === "completed" ? "✓ 完成" :
                                 scene.status === "generating" ? "生成中..." :
                                 scene.status === "failed" ? "失敗" : "等待中"}
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
            <Card className="bg-white rounded-xl shadow-sm border border-emerald-200">
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
                          title="編輯標題"
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
                      <i className="fas fa-history mr-1.5"></i>歷史
                    </Button>
                  <Button
                    variant="outline"
                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-lg text-sm"
                    onClick={() => {
                      setCurrentStoryId("");
                      setPerSceneTailEnabled({});
                    }}
                  >
                    <i className="fas fa-plus mr-2"></i>新故事
                  </Button>
                  </div>
                </div>

                {/* Seed display */}
                {storyGeneration.globalSeed && (
                  <div className="flex items-center gap-2 px-1 py-0.5">
                    <span className="text-xs text-gray-500">🎲 角色種子：</span>
                    <span className="text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">{storyGeneration.globalSeed}</span>
                    <button
                      className="text-xs text-gray-400 hover:text-emerald-600 transition-colors"
                      title="複製種子"
                      onClick={() => { navigator.clipboard.writeText(String(storyGeneration.globalSeed)); toast({ title: "已複製種子", description: `種子 ${storyGeneration.globalSeed} 已複製` }); }}
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
                          const sceneCost = Math.round(sceneDur * (sceneRes === "720p" ? 3.4 : 6.8));
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
                                  <span className="text-xs text-emerald-600">重新生成中...</span>
                                </div>
                              ) : imgUrl ? (
                                <div className="relative group cursor-pointer" onClick={() => setStoryLightboxIdx(idx)}>
                                  <img src={imgUrl} alt={scene.title} className="w-full aspect-square object-cover group-hover:scale-105 transition-transform duration-300" />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <i className="fas fa-search-plus text-white text-xl"></i>
                                  </div>
                                  {/* Narrative + scene badge */}
                                  <span className="absolute top-2 left-2 flex items-center gap-1">
                                    <span className="bg-emerald-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">第 {idx + 1} 幕</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${nInfo.bg} ${nInfo.color} ${nInfo.border}`}>{nInfo.icon}{nInfo.short}</span>
                                  </span>
                                  {/* Image controls */}
                                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <a href={imgUrl} download={`scene-${idx + 1}.jpg`} target="_blank" onClick={e => e.stopPropagation()}
                                      className="w-7 h-7 bg-black/50 hover:bg-emerald-600 text-white rounded-full text-xs flex items-center justify-center" title="下載圖片">
                                      <i className="fas fa-download text-xs"></i>
                                    </a>
                                    <button className="w-7 h-7 bg-black/50 hover:bg-black/70 text-white rounded-full text-xs flex items-center justify-center"
                                      title="重新生成此幕（3 積分）"
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
                                    <i className="fas fa-redo"></i>重新生成（3積分）
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
                                      title="編輯描述後重新生成"
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
                                        }
                                      }}
                                      className={`w-5 h-5 rounded flex items-center justify-center transition-colors ${editingSceneIdx === idx ? "bg-emerald-100 text-emerald-600" : "hover:bg-gray-100 text-gray-400"}`}
                                    >
                                      <i className="fas fa-pencil-alt text-[9px]"></i>
                                    </button>
                                  )}
                                </div>
                                <p className="text-xs font-semibold text-gray-700">{scene.title || `第 ${idx + 1} 幕`}</p>

                                {editingSceneIdx === idx ? (
                                  <div className="mt-1.5 space-y-1.5">
                                    <textarea
                                      rows={3}
                                      value={editingSceneDesc}
                                      onChange={e => setEditingSceneDesc(e.target.value)}
                                      className="w-full text-[11px] border border-emerald-200 bg-emerald-50/40 rounded-lg p-2 resize-none focus:outline-none focus:ring-1 focus:ring-emerald-400"
                                      placeholder="修改場景描述..."
                                    />
                                    <div className="relative">
                                      <span className="absolute left-2 top-1.5 text-[10px] text-amber-500 pointer-events-none">💬</span>
                                      <input
                                        type="text"
                                        value={editingSceneDialogue}
                                        onChange={e => setEditingSceneDialogue(e.target.value)}
                                        placeholder="台詞（選填）..."
                                        className="w-full pl-6 pr-2 py-1.5 text-[11px] border border-amber-100 bg-amber-50/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-amber-300 placeholder:text-gray-300"
                                      />
                                    </div>
                                    {/* Character reference toggles */}
                                    {((storyGeneration?.characterImageUrls?.length ?? 0) > 0 || (storyGeneration?.characterBImageUrls?.length ?? 0) > 0) && (
                                      <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg border border-gray-100">
                                        <span className="text-[10px] text-gray-400 flex-shrink-0">角色參考：</span>
                                        {(storyGeneration?.characterImageUrls?.length ?? 0) > 0 && (
                                          <label className="flex items-center gap-1 cursor-pointer">
                                            <input
                                              type="checkbox"
                                              checked={editingUseCharA}
                                              onChange={e => setEditingUseCharA(e.target.checked)}
                                              className="w-3 h-3 accent-emerald-600"
                                            />
                                            <span className="text-[10px] text-gray-600 font-medium">角色A</span>
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
                                            <span className="text-[10px] text-gray-600 font-medium">角色B</span>
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
                                            toast({ title: "參考圖上傳成功" });
                                          } catch {
                                            toast({ title: "參考圖上傳失敗", variant: "destructive" });
                                          } finally {
                                            setEditingSceneRefUploading(false);
                                          }
                                        }} />
                                        {editingSceneRefUploading ? "上傳中..." : editingSceneRefPath ? "✓ 參考圖已替換" : "🖼 上傳此幕參考圖"}
                                      </label>
                                      {editingSceneRefPath && (
                                        <button onClick={() => setEditingSceneRefPath("")} className="text-[10px] text-gray-400 hover:text-gray-600">✕</button>
                                      )}
                                    </div>
                                    <div className="flex gap-1.5">
                                      <button
                                        onClick={() => { setEditingSceneIdx(null); setEditingSceneRefPath(""); setEditingUseCharA(true); setEditingUseCharB(true); }}
                                        className="flex-1 py-1 text-[11px] border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50"
                                      >取消</button>
                                      <button
                                        onClick={() => {
                                          regenerateSceneMutation.mutate({
                                            sceneIdx: idx,
                                            description: editingSceneDesc,
                                            dialogue: editingSceneDialogue,
                                            sceneReferenceImageUrl: editingSceneRefPath || undefined,
                                            useCharA: editingUseCharA,
                                            useCharB: editingUseCharB,
                                          });
                                        }}
                                        disabled={!editingSceneDesc.trim() || regenerateSceneMutation.isPending || editingSceneRefUploading}
                                        className="flex-1 py-1 text-[11px] bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-semibold"
                                      >重新生成（3積分）</button>
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
                                      <span className="text-[10px] font-semibold text-purple-600 uppercase tracking-wide">🎬 動畫提示詞</span>
                                      {!perSceneAnimPrompts[idx] && (
                                        <span className="text-[9px] text-gray-400">← AI 生成後自動填入</span>
                                      )}
                                    </div>
                                    <textarea
                                      rows={2}
                                      value={perSceneAnimPrompts[idx] || ""}
                                      onChange={e => setPerSceneAnimPrompts(prev => ({ ...prev, [idx]: e.target.value }))}
                                      placeholder={`此幕動畫描述，例：slow push in, golden light flows, ${nInfo.short === "起" ? "gentle establishing shot" : nInfo.short === "轉" ? "dramatic zoom, dynamic movement" : "slow fade out, peaceful ending"}`}
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
                                        <span className="text-[10px] text-indigo-700 font-medium">{isLast ? "循環回第一幕" : "銜接下一幕"}</span>
                                        <span className="text-[9px] text-indigo-400 font-normal">（結尾幀過渡）</span>
                                      </div>
                                    );
                                  })()}
                                  {/* Per-scene duration selector */}
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[10px] text-gray-500 flex-shrink-0">秒數</span>
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
                                    <span className="text-[10px] text-gray-500 flex-shrink-0">解析度</span>
                                    {(["720p", "1080p"] as const).map(r => {
                                      const sd = perSceneDuration[idx] ?? animDuration;
                                      return (
                                        <button key={r}
                                          onClick={() => setPerSceneResolution(prev => ({ ...prev, [idx]: r }))}
                                          className={`flex-1 py-1 rounded-lg border text-[11px] font-medium transition-all ${sceneRes === r ? "border-purple-500 bg-purple-100 text-purple-700" : "border-gray-200 text-gray-500 hover:border-purple-300"}`}>
                                          {r} <span className="text-[9px] opacity-70">({Math.round(sd * (r === "720p" ? 3.4 : 6.8))}積)</span>
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
                                      title={`生成 ${perSceneDuration[idx] ?? animDuration}秒 ${sceneRes} 動畫，需 ${sceneCost} 積分`}
                                    >
                                      {(singleSceneAnimateMutation.isPending && singleSceneAnimateMutation.variables?.sceneIdx === idx) ? (
                                        <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                                      ) : vidData?.status === "completed" && videoUrl ? (
                                        <><i className="fas fa-redo text-[9px]"></i>重生</>
                                      ) : (
                                        <><i className="fas fa-film text-[9px]"></i>生成</>
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
                                            className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/60 hover:bg-emerald-600 text-white rounded text-[9px] flex items-center justify-center" title="下載動畫">
                                            <i className="fas fa-download"></i>
                                          </a>
                                        </div>
                                      ) : vidData.status === "failed" ? (
                                        <div className="py-2 flex flex-col items-center gap-1 bg-red-50">
                                          <span className="text-[10px] text-red-500"><i className="fas fa-times-circle mr-1"></i>動畫失敗</span>
                                          <button className="text-[9px] px-2 py-0.5 bg-red-100 text-red-600 rounded hover:bg-red-200"
                                            onClick={() => singleSceneAnimateMutation.mutate({ sceneIdx: idx })}>重試</button>
                                        </div>
                                      ) : (
                                        <div className="py-2 flex items-center justify-center gap-2 bg-purple-50">
                                          <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                                          <span className="text-[10px] text-purple-500">動畫生成中…</span>
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
                          <i className="fas fa-download mr-2"></i>下載全部圖片
                        </Button>
                        <Button
                          className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
                          onClick={() => setShowAnimationSettings(v => !v)}
                          disabled={storyAnimateMutation.isPending}
                        >
                          <i className="fas fa-video mr-2"></i>
                          {storyAnimationJobs.length > 0 ? "重新生成動畫" : "批量生成動畫"}
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
                              setStoryTitle(`（第二集）${baseTitle}`);
                              setStorySeed(seedVal ?? "");
                              toast({ title: "✨ 已預填設定", description: "種子與角色參考圖已繼承，請填入新集數的場景描述" });
                            }}
                          >
                            <i className="fas fa-book-open mr-2"></i>建立第二集
                          </Button>
                        )}
                        <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => { setCurrentStoryId(""); setPerSceneTailEnabled({}); }}>
                          <i className="fas fa-redo mr-2"></i>重新生成故事
                        </Button>
                      </div>

                      {/* Note: animation aspect ratio is auto-detected from each scene image */}
                      <div className="mt-2 text-center text-xs text-gray-400">
                        <i className="fas fa-info-circle mr-1"></i>動畫比例自動對齊各幕圖片尺寸，無需手動設定
                      </div>

                      {/* Animation Global Settings Panel */}
                      {showAnimationSettings && (
                        <div className="mt-4 p-5 bg-purple-50 rounded-xl border border-purple-200 space-y-4">
                          <h3 className="font-semibold text-purple-800 flex items-center gap-2">
                            <i className="fas fa-sliders-h"></i>批量動畫設定
                            <span className="text-xs font-normal text-purple-600">（各幕可在卡片中個別選解析度與提示詞）</span>
                          </h3>

                          {/* Duration */}
                          <div>
                            <Label className="text-sm font-medium text-gray-700 mb-2 block">
                              各幕影片時長：<span className="text-purple-700 font-bold">{animDuration} 秒</span>
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
                              <p className="text-sm font-medium text-gray-700">AI 自動生成所有分鏡提示詞</p>
                              <p className="text-xs text-gray-500">Claude 依起承轉合節奏，為每幕生成對應的動畫提示詞</p>
                            </div>
                            <button
                              onClick={() => generateAnimPromptsMutation.mutate()}
                              disabled={generateAnimPromptsMutation.isPending}
                              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
                            >
                              {generateAnimPromptsMutation.isPending ? (
                                <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />生成中...</>
                              ) : (
                                <>✨ AI 生成提示詞</>
                              )}
                            </button>
                          </div>

                          <div className="text-xs text-gray-500 bg-white/60 rounded-lg px-3 py-2 border border-gray-100">
                            <i className="fas fa-info-circle mr-1 text-purple-400"></i>
                            動畫比例自動依各幕圖片尺寸決定；各幕的解析度和提示詞請在上方分鏡卡片中設定
                          </div>

                          {/* Batch Cost + Confirm */}
                          {(() => {
                            const completedScenes = scenes.filter(s => s.status === "completed" && (s.bunnyUrl || s.imageUrl));
                            const totalCost = completedScenes.reduce((sum, s) => {
                              const si = scenes.indexOf(s);
                              const res = perSceneResolution[si] ?? "720p";
                              const dur = perSceneDuration[si] ?? animDuration;
                              return sum + Math.round(dur * (res === "720p" ? 3.4 : 6.8));
                            }, 0);
                            const hasEnough = (user?.credits ?? 0) >= totalCost;
                            return (
                              <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-purple-200">
                                <div className="text-sm">
                                  <span className="text-gray-600">{completedScenes.length} 幕合計 </span>
                                  <span className="font-bold text-purple-700">{totalCost} 積分</span>
                                  <span className="text-gray-400 text-xs ml-1">（依各幕個別解析度與秒數計算）</span>
                                  {!hasEnough && (
                                    <span className="ml-2 text-red-500 text-xs"><i className="fas fa-exclamation-triangle mr-1"></i>積分不足（餘額 {user?.credits ?? 0}）</span>
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
                                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />送出中...</>
                                  ) : (
                                    <><i className="fas fa-play mr-2"></i>批量生成全部動畫</>
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
                            <i className="fas fa-video text-purple-500"></i>動畫生成進度
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
                                          <p className="text-xs text-gray-500">生成中</p>
                                        </div>
                                      ) : status === "failed" ? (
                                        <div className="text-center">
                                          <i className="fas fa-times-circle text-red-400 text-2xl"></i>
                                          <p className="text-xs text-red-500 mt-1">失敗</p>
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
                                        {status === "completed" ? "✓ 完成" :
                                         status === "processing" ? "生成中..." :
                                         status === "failed" ? "失敗" : "等待中"}
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
                                <i className="fas fa-download mr-2"></i>下載全部動畫（{storyAnimationJobs.length} 幕）
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
                              <i className="fas fa-times mr-1"></i>關閉
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
                                  <p className="text-white font-semibold">{scenes[storyLightboxIdx]?.title || `第 ${storyLightboxIdx + 1} 幕`}</p>
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
            <p className="text-sm font-medium text-gray-600">極電行銷整合</p>
            <div className="flex justify-center items-center gap-4 text-sm text-gray-500">
              <span>客服信箱：<a href="mailto:Service@cms-edu.com" className="text-purple-600 hover:underline">Service@cms-edu.com</a></span>
              <span className="text-gray-300">|</span>
              <span>LINE：<a href="https://line.me/R/ti/p/@558icnoi" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">@558icnoi</a></span>
              <span className="text-gray-300">|</span>
              <span>Facebook：<a href="https://www.facebook.com/profile.php?id=61569836876332" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">粉絲專頁</a></span>
            </div>
            <div className="flex justify-center items-center gap-6 text-sm text-gray-400">
              <a href="/privacy" className="hover:text-blue-600 transition-colors">隱私政策</a>
              <a href="/terms" className="hover:text-blue-600 transition-colors">服務條款</a>
            </div>
            <p className="text-xs text-gray-300">
              使用模型：SeedDance 2.0 · Seedream 5.0
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

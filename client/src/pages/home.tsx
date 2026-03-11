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
  const [storyScenes, setStoryScenes] = useState<{ title: string; description: string; sceneReferenceImageUrl?: string }[]>([
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
  const [storySceneRefImages, setStorySceneRefImages] = useState<{ url: string; path: string }[]>([]);
  const [storyStyleImages, setStoryStyleImages] = useState<{ url: string; path: string }[]>([]);
  const [currentStoryId, setCurrentStoryId] = useState<string>("");
  const [storyLightboxIdx, setStoryLightboxIdx] = useState<number | null>(null);
  const [storyAnimationJobs, setStoryAnimationJobs] = useState<{sceneIdx: number; sceneTitle: string; videoId: string}[]>([]);
  const [showAnimationSettings, setShowAnimationSettings] = useState(true);
  const [animDuration, setAnimDuration] = useState(5);
  const [animResolution, setAnimResolution] = useState<"720p" | "1080p">("720p");
  const [animAspectRatio, setAnimAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [animPrompt, setAnimPrompt] = useState("");
  
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
      return (gen?.status === "pending" || gen?.status === "generating") ? 3000 : false;
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

  const storyMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/story-generations", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      setCurrentStoryId(data.id);
      setStoryAnimationJobs([]);
      queryClient.invalidateQueries({ queryKey: ["/api/story-generations", data.id] });
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
        sceneRefImageUrls: storySceneRefImages.map(r => r.path),
        styleImageUrls: storyStyleImages.map(r => r.path),
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

  const handleCharacterImageUpload = makeStoryRefUploadHandler(setStoryCharacterImages, 2, "主角長相參考");
  const handleSceneRefImageUpload = makeStoryRefUploadHandler(setStorySceneRefImages, 2, "場景參考圖");
  const handleStyleImageUpload = makeStoryRefUploadHandler(setStoryStyleImages, 2, "畫風參考圖");

  const updateStorySceneCount = (count: number) => {
    setStorySceneCount(count);
    setStoryScenes(prev => {
      const arr = [...prev];
      while (arr.length < 8) arr.push({ title: `第 ${arr.length + 1} 幕`, description: "" });
      return arr;
    });
  };

  const updateStoryScene = (idx: number, field: "title" | "description" | "sceneReferenceImageUrl", value: string) => {
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
                  <Label className="text-sm font-medium text-gray-700">描述影片內容</Label>
                  <Textarea 
                    placeholder="例如：一隻橘貓在陽光下的草地上追蝴蝶，鏡頭緩慢環繞"
                    value={videoPrompt}
                    onChange={(e) => setVideoPrompt(e.target.value)}
                    className="mt-1.5 w-full min-h-[100px] px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  />
                  <p className="text-xs text-gray-400 mt-1">詳細描述您想要的影片畫面和動態效果</p>
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
                      <Label className="text-sm font-medium text-gray-700">描述影片動態效果</Label>
                      <Textarea 
                        placeholder="例如：高速穿越障礙物，帶來沉浸式的飛行體驗"
                        value={videoPrompt}
                        onChange={(e) => setVideoPrompt(e.target.value)}
                        className="mt-1.5 w-full min-h-[100px] px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                      />
                      <p className="text-xs text-gray-400 mt-1">
                        描述您希望圖片如何變成動態影片
                      </p>
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

          {/* ============ STORY MODE INPUT ============ */}
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
                  <div className="flex gap-2">
                    {[2, 3, 4, 5, 6, 7, 8].map(n => (
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

                {/* Reference Images - three categories */}
                {(
                  [
                    { label: "主角長相", sub: "保持每幕角色外貌一致", icon: "🧑", images: storyCharacterImages, setter: setStoryCharacterImages, handler: handleCharacterImageUpload, color: "violet" },
                    { label: "場景參考圖", sub: "構圖、場景、環境風格", icon: "🏞️", images: storySceneRefImages, setter: setStorySceneRefImages, handler: handleSceneRefImageUpload, color: "blue" },
                    { label: "畫風參考圖", sub: "整體美術風格與質感", icon: "🎨", images: storyStyleImages, setter: setStoryStyleImages, handler: handleStyleImageUpload, color: "pink" },
                  ] as const
                ).map(({ label, sub, icon, images, setter, handler, color }) => (
                  <div key={label} className={`p-3 rounded-xl border-2 ${
                    images.length > 0
                      ? color === "violet" ? "border-violet-200 bg-violet-50/40"
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
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-sm font-medium text-gray-700">
                      各幕場景描述
                    </Label>
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
                      disabled={claudeEnhanceMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 hover:border-violet-300 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {claudeEnhanceMutation.isPending ? (
                        <>
                          <div className="w-3 h-3 border border-violet-600 border-t-transparent rounded-full animate-spin" />
                          Claude 生成中...
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                          </svg>
                          Claude 優化提示詞
                        </>
                      )}
                    </button>
                  </div>
                  <div className="space-y-3">
                    {storyScenes.slice(0, storySceneCount).map((scene, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-xl p-4 space-y-2 hover:border-emerald-200 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="w-7 h-7 bg-emerald-100 text-emerald-700 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {idx + 1}
                          </span>
                          <Input
                            value={scene.title}
                            onChange={e => updateStoryScene(idx, "title", e.target.value)}
                            className="text-sm font-medium border-none p-0 h-auto focus:ring-0 shadow-none text-gray-700"
                            placeholder={`第 ${idx + 1} 幕`}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Textarea
                            rows={2}
                            value={scene.description}
                            onChange={e => updateStoryScene(idx, "description", e.target.value)}
                            placeholder={`描述第 ${idx + 1} 幕的場景內容（例如：主角站在山頂俯瞰整個城市，夕陽西下）`}
                            className="resize-none text-sm border-gray-100 bg-gray-50 rounded-lg focus:ring-2 focus:ring-emerald-500 flex-1"
                          />
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
                    ))}
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
                    <div>
                      <h3 className="font-semibold text-gray-800">正在生成故事分鏡</h3>
                      <p className="text-sm text-gray-500">
                        {(() => {
                          if (!storyGeneration) return "初始化中...";
                          const scenes: StoryScene[] = JSON.parse(storyGeneration.scenes || "[]");
                          const done = scenes.filter(s => s.status === "completed").length;
                          const total = scenes.length;
                          return `已完成 ${done} / ${total} 幕，請耐心等待...`;
                        })()}
                      </p>
                    </div>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
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
          {isStoryMode && storyGeneration?.status === "completed" && (
            <Card className="bg-white rounded-xl shadow-sm border border-emerald-200">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <span className="text-xl">📖</span>
                    {storyGeneration.title}
                  </h2>
                  <Button
                    variant="outline"
                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 rounded-lg text-sm"
                    onClick={() => {
                      setCurrentStoryId("");
                    }}
                  >
                    <i className="fas fa-plus mr-2"></i>新故事
                  </Button>
                </div>

                {(() => {
                  const scenes: StoryScene[] = JSON.parse(storyGeneration.scenes || "[]");
                  const cols = scenes.length <= 3 ? scenes.length : scenes.length <= 6 ? 3 : 4;
                  return (
                    <>
                      <div className={`grid grid-cols-2 ${cols >= 3 ? "sm:grid-cols-3" : ""} ${cols >= 4 ? "lg:grid-cols-4" : ""} gap-4`}>
                        {scenes.map((scene, idx) => {
                          const imgUrl = scene.bunnyUrl || scene.imageUrl;
                          return (
                            <div key={idx} className="rounded-xl overflow-hidden border border-gray-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer group"
                              onClick={() => setStoryLightboxIdx(idx)}>
                              {imgUrl ? (
                                <div className="relative">
                                  <img src={imgUrl} alt={scene.title} className="w-full aspect-square object-cover group-hover:scale-105 transition-transform duration-300" />
                                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                                    <i className="fas fa-search-plus text-white text-xl"></i>
                                  </div>
                                  <span className="absolute top-2 left-2 bg-emerald-600 text-white text-xs px-2 py-0.5 rounded-full font-medium">第 {idx + 1} 幕</span>
                                </div>
                              ) : (
                                <div className="w-full aspect-square bg-red-50 flex items-center justify-center">
                                  <i className="fas fa-times-circle text-red-400 text-xl"></i>
                                </div>
                              )}
                              <div className="p-3 bg-white">
                                <p className="text-xs font-semibold text-gray-700 mb-0.5">{scene.title || `第 ${idx + 1} 幕`}</p>
                                <p className="text-xs text-gray-500 line-clamp-2">{scene.description}</p>
                              </div>
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
                        <Button variant="secondary" className="bg-gray-100 hover:bg-gray-200 rounded-lg" onClick={() => setCurrentStoryId("")}>
                          <i className="fas fa-redo mr-2"></i>重新生成故事
                        </Button>
                      </div>

                      {/* Animation Settings Panel */}
                      {showAnimationSettings && (
                        <div className="mt-4 p-5 bg-purple-50 rounded-xl border border-purple-200 space-y-4">
                          <h3 className="font-semibold text-purple-800 flex items-center gap-2">
                            <i className="fas fa-sliders-h"></i>動畫參數設定
                            <span className="text-xs font-normal text-purple-600">（每幕套用相同設定）</span>
                          </h3>

                          {/* Duration */}
                          <div>
                            <Label className="text-sm font-medium text-gray-700 mb-2 block">
                              影片時長：<span className="text-purple-700 font-bold">{animDuration} 秒</span>
                            </Label>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-500">4s</span>
                              <input
                                type="range" min={4} max={12} step={1} value={animDuration}
                                onChange={e => setAnimDuration(Number(e.target.value))}
                                className="flex-1 accent-purple-600"
                              />
                              <span className="text-xs text-gray-500">12s</span>
                            </div>
                          </div>

                          {/* Resolution */}
                          <div>
                            <Label className="text-sm font-medium text-gray-700 mb-2 block">解析度</Label>
                            <div className="flex gap-2">
                              {(["720p", "1080p"] as const).map(r => (
                                <button key={r} onClick={() => setAnimResolution(r)}
                                  className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                                    animResolution === r ? "border-purple-500 bg-purple-100 text-purple-700" : "border-gray-200 text-gray-600 hover:border-purple-200"
                                  }`}>
                                  {r.toUpperCase()}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Aspect Ratio */}
                          <div>
                            <Label className="text-sm font-medium text-gray-700 mb-2 block">畫面比例</Label>
                            <div className="flex gap-2">
                              {(["16:9", "9:16", "1:1"] as const).map(a => (
                                <button key={a} onClick={() => setAnimAspectRatio(a)}
                                  className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                                    animAspectRatio === a ? "border-purple-500 bg-purple-100 text-purple-700" : "border-gray-200 text-gray-600 hover:border-purple-200"
                                  }`}>
                                  {a}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Animation Prompt */}
                          <div>
                            <Label className="text-sm font-medium text-gray-700 mb-2 block">
                              動畫提示詞（選填）
                              <InfoTooltip text="不填時自動使用各幕的場景描述作為提示詞" />
                            </Label>
                            <Input
                              placeholder="例如：鏡頭緩慢推進，光影流動，大氣磅礴"
                              value={animPrompt}
                              onChange={e => setAnimPrompt(e.target.value)}
                              className="rounded-xl border-gray-200"
                            />
                          </div>

                          {/* Cost + Confirm */}
                          {(() => {
                            const completedCount = scenes.filter(s => s.status === "completed" && (s.bunnyUrl || s.imageUrl)).length;
                            const rate = animResolution === "720p" ? 3.4 : 6.8;
                            const totalCost = Math.round(animDuration * rate) * completedCount;
                            const hasEnough = (user?.credits ?? 0) >= totalCost;
                            return (
                              <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-purple-200">
                                <div className="text-sm">
                                  <span className="text-gray-600">{completedCount} 幕 × {animDuration}秒 × {rate} = </span>
                                  <span className="font-bold text-purple-700">{totalCost} 積分</span>
                                  {!hasEnough && (
                                    <span className="ml-2 text-red-500 text-xs">
                                      <i className="fas fa-exclamation-triangle mr-1"></i>積分不足（餘額 {user?.credits ?? 0}）
                                    </span>
                                  )}
                                </div>
                                <Button
                                  className="bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
                                  disabled={!hasEnough || storyAnimateMutation.isPending}
                                  onClick={() => storyAnimateMutation.mutate({
                                    duration: animDuration,
                                    resolution: animResolution,
                                    aspectRatio: animAspectRatio,
                                    animationPrompt: animPrompt,
                                  })}
                                >
                                  {storyAnimateMutation.isPending ? (
                                    <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />送出中...</>
                                  ) : (
                                    <><i className="fas fa-play mr-2"></i>確認生成動畫</>
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

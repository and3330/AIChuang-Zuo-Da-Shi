import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import type { ImageGeneration, VideoGeneration } from "@shared/schema";

export default function Home() {
  const { user } = useUser();
  useSeo({
    title: "AI 創作工作台 - 圖片與影片生成 | AI 創意工坊",
    description: "使用 AI 創意工坊生成高品質圖片和影片。支援文字生圖、圖片編輯、多圖融合、序列生成、批次處理、AI 影片生成等功能。",
    keywords: "AI生成,文字生圖,圖片編輯,AI影片,批次生成,序列生成,多圖融合",
  });
  const [mode, setMode] = useState<"image-to-image" | "text-to-image" | "image-to-video" | "text-to-video">("text-to-image");
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string>("");
  const [uploadedImagePath, setUploadedImagePath] = useState<string>("");
  const [prompt, setPrompt] = useState("把泡泡變成愛心形狀");
  const [textPrompt, setTextPrompt] = useState("一幅美麗的日落山水風景畫，有山脈和湖泊");
  const [guidanceScale, setGuidanceScale] = useState(5.5);
  const [seed, setSeed] = useState(21);
  const [watermark, setWatermark] = useState(true);
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
  const [currentVideoGenerationId, setCurrentVideoGenerationId] = useState<string>("");
  
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
      videoGenerateMutation.mutate({
        type: "image-to-video",
        originalImageUrl: uploadedImagePath,
        prompt: videoPrompt.trim(),
        duration: videoDuration,
        cameraFixed,
      });
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

  const isGenerating = generateMutation.isPending || videoGenerateMutation.isPending ||
    (generation?.status === "pending" || generation?.status === "processing") ||
    (batchData?.generations.some(g => g.status === "pending" || g.status === "processing")) ||
    (videoGeneration?.status === "pending" || videoGeneration?.status === "processing");

  const getCreditsNeeded = () => {
    if (mode === "image-to-video" || mode === "text-to-video") return Math.round(videoDuration * 3.4);
    if (mode === "text-to-image") return isSequentialMode ? 3 * sequentialCount : 3;
    if (isBatchMode) return 3 * batchPrompts.filter(p => p.trim()).length;
    if (isI2ISequentialMode) return 3 * i2iSequentialCount;
    return 3;
  };

  const creditsNeeded = getCreditsNeeded();
  const hasEnoughCredits = (user?.credits ?? 0) >= creditsNeeded;

  const isSeedDanceMode = mode === "image-to-image" || mode === "text-to-image";
  const isVideoMode = mode === "image-to-video" || mode === "text-to-video";

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
                  <span className="font-semibold">SeedDance 4.5</span>
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
                  <span className="font-semibold">Seedream</span>
                  <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">影片</span>
                </div>
                {isVideoMode && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-purple-600" />}
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
                        <h3 className={`font-semibold text-sm ${mode === "text-to-image" ? "text-blue-700" : "text-gray-700"}`}>文字生圖</h3>
                        <p className="text-xs text-gray-500 mt-0.5">用文字描述創建圖片</p>
                        <span className="inline-block mt-1.5 text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">3 積分/張</span>
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
                        <h3 className={`font-semibold text-sm ${mode === "image-to-image" ? "text-blue-700" : "text-gray-700"}`}>圖片編輯</h3>
                        <p className="text-xs text-gray-500 mt-0.5">AI 編輯現有圖片</p>
                        <span className="inline-block mt-1.5 text-xs font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">3 積分/張</span>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Feature Tags */}
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  {mode === "text-to-image" && (
                    <>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-layer-group mr-1"></i>序列生成
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-expand-arrows-alt mr-1"></i>多種尺寸
                      </span>
                    </>
                  )}
                  {mode === "image-to-image" && (
                    <>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-clone mr-1"></i>批次生成
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-object-group mr-1"></i>多圖融合
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                        <i className="fas fa-layer-group mr-1"></i>序列生成
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
                        <h3 className={`font-semibold text-sm ${mode === "text-to-video" ? "text-purple-700" : "text-gray-700"}`}>文字生影片</h3>
                        <p className="text-xs text-gray-500 mt-0.5">用文字描述創建影片</p>
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">3.4積分/秒</span>
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
                        <h3 className={`font-semibold text-sm ${mode === "image-to-video" ? "text-purple-700" : "text-gray-700"}`}>圖片生影片</h3>
                        <p className="text-xs text-gray-500 mt-0.5">將靜態圖片轉為影片</p>
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">3.4積分/秒</span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 justify-center">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-video mr-1"></i>動態鏡頭
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-crosshairs mr-1"></i>固定鏡頭
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">
                    <i className="fas fa-clock mr-1"></i>5 / 10 秒可選
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
                    <span className="text-sm text-gray-600">序列生成</span>
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
                      <span className="ml-auto text-sm font-semibold text-blue-600">{sequentialCount * 3} 積分</span>
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
                      <i className="fas fa-object-group"></i>多圖融合
                    </button>
                    <button
                      onClick={() => { setIsI2ISequentialMode(!isI2ISequentialMode); if (!isI2ISequentialMode) setIsBatchMode(false); }}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${
                        isI2ISequentialMode ? "border-purple-400 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-500 hover:border-purple-300"
                      }`}
                    >
                      <i className="fas fa-layer-group"></i>序列生成
                    </button>
                    <button
                      onClick={() => { setIsBatchMode(!isBatchMode); if (!isBatchMode) { updateBatchCount(batchCount); setIsI2ISequentialMode(false); setIsMultiImageMode(false); setAdditionalImages([]); } }}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all flex items-center gap-1.5 ${
                        isBatchMode ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:border-blue-300"
                      }`}
                    >
                      <i className="fas fa-clone"></i>批次生成
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
                            <span className="ml-auto text-sm font-semibold text-purple-600">{i2iSequentialCount * 3} 積分</span>
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
                        <span className="ml-auto text-sm font-semibold text-blue-600">{batchPrompts.filter(p => p.trim()).length * 3} 積分</span>
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
                        min={2}
                        max={12}
                        step={1}
                        value={videoDuration}
                        onChange={(e) => setVideoDuration(parseInt(e.target.value))}
                        className="w-full h-2 bg-purple-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-gray-500">2秒</span>
                        <span className="text-lg font-bold text-purple-700">{videoDuration} 秒</span>
                        <span className="text-sm text-gray-500">12秒</span>
                      </div>
                      <div className="text-center text-sm font-medium text-purple-600 bg-purple-50 rounded-lg py-1.5">
                        {Math.round(videoDuration * 3.4)} 積分（{videoDuration}秒 × 3.4積分/秒）
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

                <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-sm text-purple-700 flex items-center gap-2">
                  <i className="fas fa-info-circle"></i>
                  影片生成需要 1-3 分鐘，費用：{Math.round(videoDuration * 3.4)} 積分
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
                      <p className="text-xs text-gray-400 mt-1">描述您希望圖片如何變成動態影片</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium text-gray-700">影片長度</Label>
                        <div className="mt-2 space-y-2">
                          <input
                            type="range"
                            min={2}
                            max={12}
                            step={1}
                            value={videoDuration}
                            onChange={(e) => setVideoDuration(parseInt(e.target.value))}
                            className="w-full h-2 bg-purple-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                          />
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-500">2秒</span>
                            <span className="text-lg font-bold text-purple-700">{videoDuration} 秒</span>
                            <span className="text-sm text-gray-500">12秒</span>
                          </div>
                          <div className="text-center text-sm font-medium text-purple-600 bg-purple-50 rounded-lg py-1.5">
                            {Math.round(videoDuration * 3.4)} 積分（{videoDuration}秒 × 3.4積分/秒）
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

                    <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-sm text-purple-700 flex items-center gap-2">
                      <i className="fas fa-info-circle"></i>
                      影片生成需要 1-3 分鐘，費用：{Math.round(videoDuration * 3.4)} 積分
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Watermark Toggle */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <i className="fas fa-stamp text-gray-400"></i>
                <div>
                  <span className="text-sm font-medium text-gray-700">浮水印</span>
                  <p className="text-xs text-gray-400">
                    {watermark ? "生成圖片會包含浮水印" : "生成圖片不含浮水印"}
                  </p>
                </div>
              </div>
              <button
                role="switch" aria-checked={watermark}
                onClick={() => setWatermark(!watermark)}
                className={`relative w-11 h-6 rounded-full transition-colors ${watermark ? 'bg-blue-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${watermark ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          </div>

          {/* Generate Button */}
          <div className="flex flex-col items-center gap-3">
            <Button
              onClick={handleGenerate}
              disabled={
                (mode === "image-to-image" && !uploadedImagePath) ||
                (mode === "image-to-image" && !isBatchMode && !prompt.trim()) ||
                (mode === "image-to-image" && isBatchMode && batchPrompts.filter(p => p.trim()).length < 2) ||
                (mode === "text-to-image" && !textPrompt.trim()) ||
                (mode === "text-to-video" && !videoPrompt.trim()) ||
                (mode === "image-to-video" && (!uploadedImagePath || !videoPrompt.trim())) ||
                isGenerating || !hasEnoughCredits
              }
              className={`${isVideoMode ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700"} text-white font-semibold px-10 py-4 rounded-xl shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 flex items-center gap-3 text-base`}
            >
              {isGenerating ? (
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
                  <span className="font-semibold">費用：{Math.round((videoGeneration.duration || 5) * 3.4)} 積分</span>
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
                      <div className="flex justify-between"><span>模型</span><span className="font-mono text-xs">SeedDance 4.5</span></div>
                      <div className="flex justify-between"><span>描述</span><span className="text-xs max-w-[60%] text-right truncate">"{generation.prompt}"</span></div>
                      <div className="flex justify-between"><span>引導強度</span><span>{generation.guidanceScale}</span></div>
                      <div className="flex justify-between"><span>種子值</span><span>{generation.seed}</span></div>
                      <div className="flex justify-between"><span>處理時間</span><span>{generation.processingTime?.toFixed(1)}s</span></div>
                      <div className="flex justify-between"><span>費用</span><span className="font-semibold">3 積分</span></div>
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
        </div>
      </main>

      <footer className="mt-12 border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="text-center space-y-3">
            <div className="flex justify-center items-center gap-6 text-sm text-gray-400">
              <a href="/privacy" className="hover:text-blue-600 transition-colors">隱私政策</a>
              <a href="/terms" className="hover:text-blue-600 transition-colors">服務條款</a>
              <a href="#" className="hover:text-blue-600 transition-colors">API 文件</a>
              <a href="#" className="hover:text-blue-600 transition-colors">技術支援</a>
            </div>
            <p className="text-xs text-gray-300">
              技術支援：SeedDance 4.5 & Seedream AI API
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

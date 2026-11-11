import { imageCost as priceOfImage } from "@shared/pricing";
import { useState, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { IMAGE_RATIOS, IMAGE_TIERS, imageSizeFor } from "@shared/imageSizes";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/pages/account";
import { UnifiedUploader } from "@/components/UnifiedUploader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/use-seo";
import type { UploadResult } from "@uppy/core";
import type { ImageGeneration, VideoGeneration } from "@shared/schema";

const TEMPLATE_FILES: { file: string; label: string; emoji: string }[] = [
  { file: "00-范例.md", label: "範例 Prompt", emoji: "📝" },
  { file: "01-场景主题.md", label: "場景主題", emoji: "🏞️" },
  { file: "02-景别构图.md", label: "景別構圖", emoji: "📷" },
  { file: "03-裸露液体.md", label: "裸露液體", emoji: "👙" },
  { file: "04-服装专项.md", label: "服裝專項", emoji: "👗" },
  { file: "05-光影氛围.md", label: "光影氛圍", emoji: "💡" },
  { file: "06-姿势动作.md", label: "姿勢動作", emoji: "🤸" },
  { file: "07-表情眼神.md", label: "表情眼神", emoji: "👁️" },
  { file: "08-风格胶片.md", label: "風格膠片", emoji: "🎞️" },
  { file: "09-妆容专项.md", label: "妝容專項", emoji: "💄" },
  { file: "10-发型饰品.md", label: "髮型飾品", emoji: "💍" },
  { file: "11-瑕疵细节.md", label: "瑕疵細節", emoji: "✨" },
  { file: "12-纹身标记.md", label: "紋身標記", emoji: "🏷️" },
  { file: "13-道具宠物.md", label: "道具寵物", emoji: "🎀" },
  { file: "14-人格卡片.md", label: "人格卡片", emoji: "🎭" },
];

/**
 * 一鍵範本 — 10 組常用情境，點一下整段塞進提示詞框，使用者不用自己組。
 * 內容是參考 `00-范例.md` 裡的「完整 Prompt 范例」精選改寫，每段都包含
 * 場景 + 服裝 + 動作 + 鏡頭 + 風格 + 細節，可直接出圖。
 */
const QUICK_TEMPLATES: { emoji: string; label: string; tag: string; prompt: string }[] = [
  {
    emoji: "🏫", label: "校園制服 · 教室誘惑", tag: "校園",
    prompt: "1girl, asian, japanese schoolgirl, sailor uniform, white shirt unbuttoned, breasts exposed, sitting on classroom desk, legs apart, afternoon sunlight from window, dust particles, shy expression, blush, detailed face, masterpiece, best quality, ultra detailed, 8k, photorealistic, film grain, Kodak Portra 400",
  },
  {
    emoji: "🛁", label: "浴室濕身 · 蒸氣朦朧", tag: "家居",
    prompt: "1girl, asian, beautiful detailed face, wet hair, water droplets on skin, in modern bathroom, steam, soft natural light from window, sitting on bathtub edge, fully nude, slim body, small breasts, anatomically correct, masterpiece, best quality, photorealistic, 8k, cinematic lighting, depth of field",
  },
  {
    emoji: "👔", label: "OL 辦公室 · 加班深夜", tag: "職場",
    prompt: "1girl, asian office lady, white blouse open, black pencil skirt pulled up, sitting on office desk at night, fluorescent light, glass window with city lights, tired but seductive expression, garter belt, stockings, high heels, detailed face, masterpiece, best quality, photorealistic, 8k, cinematic",
  },
  {
    emoji: "🏖️", label: "海邊比基尼 · 黃昏", tag: "戶外",
    prompt: "1girl, asian, beautiful detailed face, micro bikini, large breasts, slim waist, standing on beach at sunset, golden hour, wet hair, wet skin, ocean waves, soft warm light, looking at viewer, slightly parted lips, masterpiece, best quality, photorealistic, 8k, depth of field, Fuji Pro 400H",
  },
  {
    emoji: "🎤", label: "KTV 包廂 · 派對微醺", tag: "派對",
    prompt: "1girl, asian, drunk expression, flushed cheeks, strapless party dress pulled down, bare breasts, holding microphone, sitting on KTV sofa, legs open, neon lights, disco ball, colorful lights, party atmosphere, medium shot, masterpiece, best quality, ultra detailed, 8k, photorealistic",
  },
  {
    emoji: "🚗", label: "車內後座 · 私密時刻", tag: "場景",
    prompt: "1girl, asian, sitting in car back seat at night, mini skirt pulled up, no panties, legs open, parked in dim parking lot, street lights through window, intimate atmosphere, detailed face, embarrassed expression, masterpiece, best quality, photorealistic, 8k, cinematic lighting",
  },
  {
    emoji: "👰", label: "婚紗試穿 · 純白誘惑", tag: "禮服",
    prompt: "1girl, asian, beautiful detailed face, white wedding dress, strapless, breasts exposed above corset, in bridal shop fitting room, standing in front of large mirror, soft window light, elegant pose, long hair, jewelry, masterpiece, best quality, photorealistic, 8k, dreamy atmosphere",
  },
  {
    emoji: "🎌", label: "和服祭典 · 日式古風", tag: "風格",
    prompt: "1girl, asian, traditional japanese yukata, loosely worn, one shoulder exposed, breast slipping out, sitting on tatami mat, summer festival night, paper lantern light, cherry blossoms, fan in hand, shy smile, long black hair, masterpiece, best quality, photorealistic, 8k, film grain",
  },
  {
    emoji: "🧖", label: "溫泉露天 · 雪夜氤氳", tag: "戶外",
    prompt: "1girl, asian, soaking in outdoor onsen at night, snow falling, steam rising from hot spring, fully nude, beautiful small breasts visible above water, wet skin, looking up at snowy sky, peaceful expression, traditional japanese inn, masterpiece, best quality, photorealistic, 8k, cinematic, depth of field",
  },
  {
    emoji: "🛏️", label: "卧室晨光 · 慵懶純情", tag: "家居",
    prompt: "1girl, asian, lying on bed in morning, white bedsheets, sunlight through curtains, oversized white shirt only, no underwear, partially covered, sleepy expression, messy hair, soft natural light, intimate atmosphere, detailed face, masterpiece, best quality, photorealistic, 8k, Kodak Portra 400, film grain",
  },
];

type ParsedLine =
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "chip"; text: string }
  | { kind: "tableHeader"; cells: string[] }
  | { kind: "tableRow"; cells: string[]; header?: string[] }
  | { kind: "tableSep" }
  | { kind: "blank" };

const ID_HEADER_RE = /^(ID|編號|序號|#|No\.?|Idx)$/i;

function parseMarkdown(md: string): ParsedLine[] {
  const lines = md.split(/\r?\n/);
  const out: ParsedLine[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { out.push({ kind: "blank" }); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push({ kind: "heading", level: h[1].length, text: h[2].trim() }); continue; }
    if (/^[-*_]{3,}$/.test(line.trim())) { out.push({ kind: "hr" }); continue; }
    if (line.startsWith(">")) { out.push({ kind: "quote", text: line.replace(/^>+\s?/, "") }); continue; }
    // markdown table
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      const inner = line.trim().slice(1, -1);
      // separator row like |---|:---:|
      if (/^[\s:|\-]+$/.test(inner)) { out.push({ kind: "tableSep" }); continue; }
      const cells = inner.split("|").map(c => c.trim());
      out.push({ kind: "tableRow", cells });
      continue;
    }
    // bullet list
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) { out.push({ kind: "chip", text: bullet[1].trim() }); continue; }
    // numbered list
    const num = line.match(/^\s*\d+\.\s+(.*)$/);
    if (num) { out.push({ kind: "chip", text: num[1].trim() }); continue; }
    out.push({ kind: "chip", text: line.trim() });
  }
  // 後處理：(1) 把「在 tableSep 之前的最後一個 tableRow」標記為 header
  //         (2) 把表頭傳遞給後續所有資料列，直到下一張表開始
  // (markdown table 標準語法：標題列 → ---分隔線 → 資料列)
  let currentHeader: string[] | undefined;
  for (let i = 0; i < out.length; i++) {
    if (out[i].kind === "tableRow" && out[i + 1]?.kind === "tableSep") {
      const r = out[i] as Extract<ParsedLine, { kind: "tableRow" }>;
      const headerCells = r.cells;
      out[i] = { kind: "tableHeader", cells: headerCells };
      currentHeader = headerCells;
    } else if (out[i].kind === "tableRow" && currentHeader) {
      const r = out[i] as Extract<ParsedLine, { kind: "tableRow" }>;
      out[i] = { kind: "tableRow", cells: r.cells, header: currentHeader };
    } else if (out[i].kind === "heading" || out[i].kind === "hr") {
      // 跨章節就重置表頭，避免上一張表的 header 漏到下一張不相干的表
      currentHeader = undefined;
    }
  }
  return out;
}

/** 判斷某個欄位「應該被視為 ID 而剝除」：必須同時滿足
 *  (a) 對應表頭是 ID/編號/序號 之類
 *  (b) 內容像 ID 格式（C01、W12、純數字、## 號）
 *  兩個條件，避免誤刪語意內容如 A1（A 罩杯1）。
 */
function isIdColumn(cellRaw: string, headerCellRaw: string | undefined): boolean {
  if (!headerCellRaw) return false;
  const h = stripMd(headerCellRaw).trim();
  if (!ID_HEADER_RE.test(h)) return false;
  const c = stripMd(cellRaw).trim();
  return /^[A-Z]?\d{1,4}$/i.test(c) || /^[A-Z]+\d{1,4}$/.test(c);
}

/** 從一個資料列裡萃取出可以直接塞進提示詞的關鍵字字串。
 *  規則：
 *    - 跳過 ID 欄（須表頭+內容都像 ID 才剝；否則保留）
 *    - 跳過空格與 "-"
 *    - 每格再用 / 、 ， , 分割成關鍵字
 *    - 全部用 ", " 串起來
 *    - 後備：若剝完是空字串，退回所有非空格的純串接，不會送出空 prompt
 */
function tableRowToPrompt(cells: string[], header?: string[]): string {
  const out: string[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = stripMd(cells[i]).trim();
    if (!c || c === "-") continue;
    if (isIdColumn(cells[i], header?.[i])) continue;
    const parts = c.split(/[\/、，,]/).map(s => s.trim()).filter(Boolean);
    out.push(...parts);
  }
  if (out.length === 0) {
    // safety fallback：剝乾淨後沒東西，退回所有非空格 (含原 ID 欄)
    return cells.map(c => stripMd(c).trim()).filter(c => c && c !== "-").join(", ");
  }
  return out.join(", ");
}

function stripMd(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

export default function NsfwPage() {
  const { user } = useUser();
  useSeo({
    title: "NSFW 創作 (18+) - AI 創意工坊",
    description: "成人向 AI 圖像創作頁面，內建亞洲日系風格 NSFW 提示詞模板庫，14 個專業類別 1000+ 詞彙可直接點選使用。",
    keywords: "NSFW,AI生成,成人圖像,提示詞模板,日系,JAV",
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // age gate
  const [ageOk, setAgeOk] = useState<boolean>(() => {
    try { return localStorage.getItem("nsfw_age_ok") === "1"; } catch { return false; }
  });

  // Three top-level modes. image-to-video reuses the existing
  // /api/video-generations pipeline (WAN 3.0) — no new backend
  // surface, NSFW page just exposes the existing capability with an
  // uncensored prompt template library.
  const [mode, setMode] = useState<"text-to-image" | "image-to-image" | "image-to-video">("text-to-image");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("2048x2048");
  const [guidanceScale, setGuidanceScale] = useState(5.5);
  const [seed, setSeed] = useState(21);
  // Video-only knobs. Defaults mirror the home.tsx 圖片生影片 panel.
  const [videoDuration, setVideoDuration] = useState<number>(5);
  const [videoAspectRatio, setVideoAspectRatio] = useState<"16:9" | "9:16" | "1:1">("9:16");
  const [videoResolution, setVideoResolution] = useState<"720p" | "1080p">("720p");
  const [currentVideoGenerationId, setCurrentVideoGenerationId] = useState("");
  // Video model. Every image-to-video job runs on AtlasCloud WAN 3.0 (the
  // server ignores any provider/model sent by the client).
  const VIDEO_MODELS = [
    { id: "wan-3.0", label: "WAN 3.0 (AtlasCloud)", desc: "阿里 WAN 3.0 圖生影片，原生音訊，畫面比例跟隨上傳圖片", per720: 8, per1080: 15 },
  ];
  const [selectedVideoModel, setSelectedVideoModel] = useState<string>("wan-3.0");
  const selectedVideoMeta = VIDEO_MODELS.find(m => m.id === selectedVideoModel) ?? VIDEO_MODELS[0];
  // Image model. All image generation runs on AtlasCloud Seedream 5.5
  // (text-to-image + image editing); there is nothing to pick.
  const IMAGE_MODEL = { label: "Seedream 5.5 (AtlasCloud)", desc: "ByteDance Seedream 5.5，支援文字生圖與圖片編輯，可選浮水印" };
  const [watermark, setWatermark] = useState(true);
  const [uploadedImagePath, setUploadedImagePath] = useState("");
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const [currentGenerationId, setCurrentGenerationId] = useState("");
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // template browser
  const [activeFile, setActiveFile] = useState<string>(TEMPLATE_FILES[0].file);
  const [search, setSearch] = useState("");
  const [contentCache, setContentCache] = useState<Record<string, string>>({});
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  useEffect(() => {
    if (contentCache[activeFile] !== undefined) return;
    setLoadingTemplate(true);
    fetch(`/nsfw-templates/${encodeURIComponent(activeFile)}`)
      .then(r => r.ok ? r.text() : Promise.reject(new Error(String(r.status))))
      .then(text => setContentCache(prev => ({ ...prev, [activeFile]: text })))
      .catch(() => setContentCache(prev => ({ ...prev, [activeFile]: "（無法載入模板）" })))
      .finally(() => setLoadingTemplate(false));
  }, [activeFile, contentCache]);

  const parsed = useMemo(() => {
    const txt = contentCache[activeFile];
    if (!txt) return [] as ParsedLine[];
    return parseMarkdown(txt);
  }, [contentCache, activeFile]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parsed;
    return parsed.filter(l => {
      if (l.kind === "chip") return l.text.toLowerCase().includes(q);
      if (l.kind === "tableRow") return l.cells.some(c => c.toLowerCase().includes(q));
      if (l.kind === "heading") return l.text.toLowerCase().includes(q);
      return false;
    });
  }, [parsed, search]);

  const insertToPrompt = (snippet: string) => {
    const clean = stripMd(snippet);
    if (!clean) return;
    setPrompt(prev => {
      const sep = prev.trim().length === 0 ? "" : (prev.endsWith("，") || prev.endsWith(",") || prev.endsWith("\n") ? "" : "，");
      const next = prev + sep + clean;
      return next;
    });
    promptRef.current?.focus();
  };

  /** 一鍵範本：整段塞入。若已有內容會詢問是替換還是接在後面，
   *  確保使用者不會無意間覆蓋自己打到一半的提示詞。 */
  const applyQuickTemplate = (tpl: { label: string; prompt: string }) => {
    if (prompt.trim().length > 0) {
      const ok = window.confirm(`提示詞框已有內容，要用「${tpl.label}」覆蓋嗎？\n（按取消則接在後面）`);
      if (ok) setPrompt(tpl.prompt);
      else setPrompt(prev => prev.trim() + "\n\n" + tpl.prompt);
    } else {
      setPrompt(tpl.prompt);
    }
    toast({ title: "✅ 已套用範本", description: tpl.label });
    promptRef.current?.focus();
    promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // 進階詞庫預設折疊，使用者要自訂組詞時才打開。
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // upload handlers (same pattern as home.tsx)
  const handleGetUploadParameters = async () => {
    const response = await apiRequest("POST", "/api/objects/upload");
    const data = await response.json();
    return { method: "PUT" as const, url: data.uploadURL };
  };
  const handleUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    if (result.successful && result.successful[0]) {
      const uploadURL = result.successful[0].uploadURL as string;
      try {
        const response = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
        const data = await response.json();
        setUploadedImageUrl(data.objectPath);
        setUploadedImagePath(data.objectPath);
        toast({ title: "圖片上傳成功", description: "現在可以開始 AI 編輯。" });
      } catch {
        toast({ title: "上傳錯誤", description: "處理上傳圖片失敗。", variant: "destructive" });
      }
    }
  };
  const handleUploadError = (err: Error) => {
    toast({ title: "上傳失敗", description: err.message, variant: "destructive" });
  };

  const generateMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest("POST", "/api/image-generations", data);
      return response.json();
    },
    onSuccess: (data: any) => {
      setCurrentGenerationId(data.id);
      queryClient.invalidateQueries({ queryKey: ["/api/image-generations", data.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "生成已開始", description: "正在處理您的圖片..." });
    },
    onError: (error: any) => {
      const msg = error?.message || "無法開始圖片生成。";
      const description = msg.includes("402") ? "積分不足，請先充值。" :
                          msg.includes("401") ? "請先登入。" :
                          msg.includes("429") ? "今日生成次數已達上限，明日再試。" :
                          `圖片生成請求失敗：${msg}`;
      toast({ title: "生成失敗", description, variant: "destructive" });
    },
  });

  // Video generation mutation — hits the same endpoint as home.tsx with
  // type="image-to-video". The server already enforces the daily 10-video
  // cap, validates before charging, and refunds on failure.
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
      toast({ title: "影片生成已開始", description: "請稍候，約需 1-3 分鐘..." });
    },
    onError: (error: any) => {
      const msg = error?.message || "無法開始影片生成。";
      const description = msg.includes("402") ? "積分不足，請先充值。" :
                          msg.includes("401") ? "請先登入。" :
                          msg.includes("429") ? "今日影片生成次數已達上限（10 支/日），明日再試。" :
                          `影片生成請求失敗：${msg}`;
      toast({ title: "生成失敗", description, variant: "destructive" });
    },
  });

  const { data: videoGeneration } = useQuery<VideoGeneration>({
    queryKey: ["/api/video-generations", currentVideoGenerationId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/video-generations/${currentVideoGenerationId}`);
      return response.json();
    },
    enabled: !!currentVideoGenerationId,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => {
      const v = query.state.data as VideoGeneration | undefined;
      return (v?.status === "pending" || v?.status === "processing") ? 3000 : false;
    },
  });

  const { data: generation, isLoading: isPolling } = useQuery<ImageGeneration>({
    queryKey: ["/api/image-generations", currentGenerationId],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/image-generations/${currentGenerationId}`);
      return response.json();
    },
    enabled: !!currentGenerationId,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => {
      const gen = query.state.data as ImageGeneration | undefined;
      return (gen?.status === "pending" || gen?.status === "processing") ? 2000 : false;
    },
  });

  const handleGenerate = () => {
    if (!prompt.trim()) {
      toast({ title: "缺少描述", description: "請輸入或從模板挑選提示詞。", variant: "destructive" });
      return;
    }
    if ((mode === "image-to-image" || mode === "image-to-video") && !uploadedImagePath) {
      toast({
        title: "缺少圖片",
        description: mode === "image-to-video" ? "圖片生影片模式請先上傳一張靜態圖片。" : "圖片編輯模式請先上傳圖片。",
        variant: "destructive",
      });
      return;
    }
    if (mode === "image-to-video") {
      // Reset prior image polling so the result card flips cleanly to video.
      setCurrentGenerationId("");
      videoGenerateMutation.mutate({
        type: "image-to-video",
        originalImageUrl: uploadedImagePath,
        prompt: prompt.trim(),
        duration: videoDuration,
        cameraFixed: false,
        aspectRatio: videoAspectRatio,
        resolution: videoResolution,
      });
      return;
    }
    setCurrentVideoGenerationId("");
    if (mode === "text-to-image") {
      generateMutation.mutate({
        type: "text-to-image",
        prompt: prompt.trim(),
        guidanceScale, seed, watermark, size,
      });
    } else {
      generateMutation.mutate({
        type: "image-to-image",
        originalImageUrl: uploadedImagePath,
        prompt: prompt.trim(),
        guidanceScale, seed, watermark, size,
      });
    }
  };

  // Per-image credit cost: 3 with watermark, 8 without.
  const imageCost = priceOfImage(watermark);
  // Video cost: WAN 3.0 = 8 (720P) / 15 (1080P) credits per second.
  const videoCreditsPerSec = videoResolution === "720p" ? selectedVideoMeta.per720 : selectedVideoMeta.per1080;
  const videoCost = Math.round(videoDuration * videoCreditsPerSec);
  const cost = mode === "image-to-video" ? videoCost : imageCost;
  const isImageBusy = generateMutation.isPending || (currentGenerationId && (generation?.status === "pending" || generation?.status === "processing"));
  const isVideoBusy = videoGenerateMutation.isPending || (currentVideoGenerationId && (videoGeneration?.status === "pending" || videoGeneration?.status === "processing"));
  const isGenerating = mode === "image-to-video" ? isVideoBusy : isImageBusy;
  const resultUrl = generation?.generatedImageUrl;
  const resultVideoUrl = videoGeneration?.generatedVideoUrl || (videoGeneration as any)?.bunnyVideoUrl;

  // ----- Age gate UI -----
  if (!ageOk) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-purple-50">
        <NavigationHeader />
        <div className="max-w-lg mx-auto pt-24 px-4">
          <Card className="border-2 border-rose-200">
            <CardContent className="p-8 text-center space-y-6">
              <div className="text-5xl">🔞</div>
              <h1 className="text-2xl font-bold text-rose-700">成人內容警告</h1>
              <div className="text-gray-700 text-sm leading-relaxed space-y-2 text-left bg-rose-50 p-4 rounded-lg">
                <p>本頁面為 <b>NSFW（Not Safe For Work）</b> AI 創作工具，可能產生：</p>
                <ul className="list-disc list-inside space-y-1 text-gray-600">
                  <li>裸露 / 暗示性 / 成人題材圖像</li>
                  <li>亞洲日系 AV 風格的角色與場景</li>
                  <li>需年滿 18 歲（或當地法定成年）方可使用</li>
                </ul>
                <p className="text-xs text-gray-500 mt-3">
                  生成內容由您本人完全負責，請勿用於違法用途（兒童相關、未經同意的真人形象等皆嚴格禁止）。
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => { window.location.href = "/"; }}>
                  返回首頁
                </Button>
                <Button
                  className="flex-1 bg-rose-600 hover:bg-rose-700"
                  onClick={() => {
                    try { localStorage.setItem("nsfw_age_ok", "1"); } catch {}
                    setAgeOk(true);
                  }}
                >
                  我已滿 18 歲，繼續
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <NavigationHeader />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">🔞 NSFW 創作工坊</h1>
          <span className="text-xs px-2 py-1 bg-rose-100 text-rose-700 rounded-full">18+</span>
          <span className="text-sm text-gray-500 hidden sm:inline">內建 1000+ 亞洲日系提示詞模板</span>
        </div>

        <div className="grid lg:grid-cols-12 gap-6">
          {/* ============ 左欄：提示詞範本 + 進階詞庫 ============ */}
          <div className="lg:col-span-7 order-2 lg:order-1 space-y-4">
            {/* 一鍵範本：10 個常用情境，直接點就好，不用組詞 */}
            <Card className="bg-white shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-gray-800">🚀 一鍵範本</h2>
                  <span className="text-xs text-gray-500">點一下整段套用，不用自己組詞</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
                  {QUICK_TEMPLATES.map((tpl, i) => (
                    <button
                      key={i}
                      onClick={() => applyQuickTemplate(tpl)}
                      className="group flex flex-col items-start gap-1 text-left p-3 rounded-lg border border-gray-200 bg-gradient-to-br from-rose-50 to-pink-50 hover:from-rose-100 hover:to-pink-100 hover:border-rose-300 transition-colors"
                      title={tpl.prompt}
                    >
                      <div className="text-2xl">{tpl.emoji}</div>
                      <div className="text-sm font-semibold text-gray-800 leading-tight">{tpl.label}</div>
                      <div className="text-[10px] text-rose-600 bg-white/70 px-1.5 py-0.5 rounded">#{tpl.tag}</div>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-500 mt-3 leading-relaxed">
                  💡 範本是完整提示詞（包含場景、服裝、動作、鏡頭、風格），套用後可直接生成，也可以再加自己的描述。
                </p>
              </CardContent>
            </Card>

            {/* 進階詞庫：折疊式，使用者想自訂時才打開 */}
            <Card className="bg-white shadow-sm">
              <CardContent className="p-4">
                <button
                  onClick={() => setAdvancedOpen(v => !v)}
                  className="w-full flex items-center justify-between gap-2 group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-gray-800">🧰 進階詞庫</span>
                    <span className="text-xs text-gray-500">15 個分類 · 1000+ 詞彙</span>
                  </div>
                  <span className={`text-gray-400 group-hover:text-gray-700 transition-transform ${advancedOpen ? "rotate-180" : ""}`}>
                    ▼
                  </span>
                </button>

                {advancedOpen && (
                  <div className="mt-4">
                    {/* 搜尋 + 分類選單 */}
                    <div className="flex gap-2 mb-3 flex-wrap">
                      <Input
                        placeholder="🔍 搜尋詞彙（如：制服 / 教室 / 微笑）"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="flex-1 min-w-[200px] text-sm"
                      />
                      <select
                        value={activeFile}
                        onChange={(e) => setActiveFile(e.target.value)}
                        className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
                      >
                        {TEMPLATE_FILES.map(t => (
                          <option key={t.file} value={t.file}>{t.emoji} {t.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="text-xs text-gray-500 mb-2 px-1">
                      💡 點任意詞彙會以「，」串到提示詞框，可組合多個。
                    </div>

                    <div className="h-[50vh] overflow-y-auto pr-2 border rounded-lg bg-gray-50/50 p-3 text-sm">
                      {loadingTemplate && (
                        <div className="text-center text-gray-400 py-10">載入模板中...</div>
                      )}
                      {!loadingTemplate && filtered.length === 0 && (
                        <div className="text-center text-gray-400 py-10">沒有符合的詞彙</div>
                      )}
                      {!loadingTemplate && filtered.map((l, i) => {
                        if (l.kind === "blank") return <div key={i} className="h-2" />;
                        if (l.kind === "hr") return <hr key={i} className="my-3 border-gray-200" />;
                        if (l.kind === "heading") {
                          const sizeCls = l.level <= 2 ? "text-base font-bold text-rose-700 mt-3 mb-1" :
                                          l.level === 3 ? "text-sm font-semibold text-gray-800 mt-2 mb-1" :
                                          "text-xs font-semibold text-gray-600 mt-2";
                          return <div key={i} className={sizeCls}>{stripMd(l.text)}</div>;
                        }
                        if (l.kind === "quote") {
                          return <div key={i} className="text-xs text-gray-500 italic border-l-2 border-gray-300 pl-2 my-1">{stripMd(l.text)}</div>;
                        }
                        if (l.kind === "tableSep") return null;
                        if (l.kind === "tableHeader") {
                          // 標題列：純顯示用，灰色細字、不可點，視覺像表頭。
                          return (
                            <div key={i} className="grid grid-cols-[auto_1fr] gap-2 px-2 py-1 mt-2 mb-1 border-b border-gray-200">
                              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">欄位</span>
                              <div className="flex gap-1 flex-wrap">
                                {l.cells.map((c, ci) => {
                                  const clean = stripMd(c);
                                  if (!clean) return null;
                                  return (
                                    <span key={ci} className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                      {clean}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        }
                        if (l.kind === "tableRow") {
                          // 資料列：整列當一張卡，點一下把所有關鍵字（header-aware 跳過 ID）一次塞入。
                          const allClean = l.cells.map(c => stripMd(c).trim());
                          const idIdx = l.cells.findIndex((c, idx) => isIdColumn(c, l.header?.[idx]));
                          const idCell = idIdx >= 0 ? allClean[idIdx] : "";
                          const meaningful = allClean.filter((c, idx) => c && c !== "-" && idx !== idIdx);
                          if (meaningful.length === 0) return null;
                          const title = meaningful[0];
                          const extras = meaningful.slice(1);
                          const fullPrompt = tableRowToPrompt(l.cells, l.header);
                          return (
                            <button
                              key={i}
                              onClick={() => insertToPrompt(fullPrompt)}
                              className="w-full text-left my-1 px-2.5 py-2 rounded-lg border border-gray-200 bg-white hover:bg-rose-50 hover:border-rose-300 transition-colors group"
                              title={`點擊加入：${fullPrompt}`}
                            >
                              <div className="flex items-start gap-2">
                                {idCell && (
                                  <span className="shrink-0 text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded mt-0.5">
                                    {idCell}
                                  </span>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-800 group-hover:text-rose-700">
                                    {title}
                                  </div>
                                  {extras.length > 0 && (
                                    <div className="flex gap-1 flex-wrap mt-1">
                                      {extras.map((e, ei) => (
                                        <span key={ei} className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                          {e}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                <span className="shrink-0 text-xs text-gray-300 group-hover:text-rose-500">＋</span>
                              </div>
                            </button>
                          );
                        }
                        // chip
                        const clean = stripMd(l.text);
                        if (!clean) return null;
                        return (
                          <button
                            key={i}
                            onClick={() => insertToPrompt(l.text)}
                            className="block w-full text-left px-2 py-1 rounded hover:bg-rose-100 text-gray-700 text-xs leading-relaxed"
                            title="點擊加入提示詞"
                          >
                            {clean}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ============ 右欄：生成面板 ============ */}
          <div className="lg:col-span-5 order-1 lg:order-2 space-y-4">
            {/* mode toggle */}
            <Card className="bg-white shadow-sm">
              <CardContent className="p-4">
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <button
                    onClick={() => setMode("text-to-image")}
                    className={`py-2 rounded-lg text-xs sm:text-sm font-medium ${mode === "text-to-image" ? "bg-rose-600 text-white" : "bg-gray-100 text-gray-700"}`}
                  >
                    📝 文字生圖
                  </button>
                  <button
                    onClick={() => setMode("image-to-image")}
                    className={`py-2 rounded-lg text-xs sm:text-sm font-medium ${mode === "image-to-image" ? "bg-rose-600 text-white" : "bg-gray-100 text-gray-700"}`}
                  >
                    🖼️ 圖片編輯
                  </button>
                  <button
                    onClick={() => setMode("image-to-video")}
                    className={`py-2 rounded-lg text-xs sm:text-sm font-medium ${mode === "image-to-video" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-700"}`}
                  >
                    🎬 圖生影片
                  </button>
                </div>

                {(mode === "image-to-image" || mode === "image-to-video") && (
                  <div className="mb-4">
                    {!uploadedImageUrl ? (
                      <UnifiedUploader
                        maxNumberOfFiles={1}
                        maxFileSize={10485760}
                        onGetUploadParameters={handleGetUploadParameters}
                        onComplete={handleUploadComplete}
                        onError={handleUploadError}
                      />
                    ) : (
                      <div className="relative">
                        <img src={uploadedImageUrl} className="w-full rounded-lg max-h-48 object-cover" alt="已上傳" />
                        <button
                          onClick={() => { setUploadedImageUrl(""); setUploadedImagePath(""); }}
                          className="absolute top-2 right-2 bg-white/90 rounded-full w-8 h-8 text-gray-700 hover:bg-white"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    {mode === "image-to-video" && (
                      <p className="text-xs text-gray-500 mt-2">
                        💡 上傳一張靜態圖，描述想要的動態（如「人物緩慢轉頭，輕風吹動髮絲」），WAN 3.0 會生成 {videoDuration} 秒短片。
                      </p>
                    )}
                  </div>
                )}

                <Label className="text-sm font-medium text-gray-700">提示詞（中文 / 英文）</Label>
                <Textarea
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="從左側模板挑選詞彙，或直接輸入..."
                  className="mt-1.5 min-h-[140px] text-sm"
                />
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-xs text-gray-400">{prompt.length} 字</span>
                  {prompt && (
                    <button
                      onClick={() => setPrompt("")}
                      className="text-xs text-gray-500 hover:text-rose-600"
                    >
                      清空
                    </button>
                  )}
                </div>

                {/* Model picker — only meaningful for image modes. The video
                    pipeline is fixed to WAN 3.0 today, so we hide the
                    selector in 圖生影片 mode and show video-specific knobs
                    instead. */}
                {mode !== "image-to-video" && (
                <div className="mt-4">
                  <Label className="text-xs text-gray-700 flex items-center justify-between">
                    <span>AI 模型</span>
                    <span className="text-rose-600 font-semibold">{imageCost} 積分／張</span>
                  </Label>
                  <div className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-gray-50">
                    {IMAGE_MODEL.label}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{IMAGE_MODEL.desc}</p>
                </div>
                )}

                {mode !== "image-to-video" ? (
                  <div className="grid grid-cols-2 gap-3 mt-4">
                    <div>
                      <Label className="text-xs text-gray-700">尺寸</Label>
                      <select
                        value={size}
                        onChange={(e) => setSize(e.target.value)}
                        className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
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
                      <Label className="text-xs text-gray-700">引導強度</Label>
                      <Input
                        type="number"
                        min={1} max={20} step={0.5}
                        value={guidanceScale}
                        onChange={(e) => setGuidanceScale(parseFloat(e.target.value) || 5.5)}
                        className="mt-1 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-gray-700">隨機種子</Label>
                      <Input
                        type="number"
                        value={seed}
                        onChange={(e) => setSeed(parseInt(e.target.value) || 21)}
                        className="mt-1 text-sm"
                      />
                    </div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={watermark}
                          onChange={(e) => setWatermark(e.target.checked)}
                        />
                        含浮水印（便宜）
                      </label>
                    </div>
                  </div>
                ) : (
                  // Video-specific controls. Aspect ratio defaults to 9:16
                  // since most NSFW reference imagery is portrait. Duration
                  // is clamped on the server too (2-12s).
                  <div className="mt-4 space-y-3">
                    <div>
                      <Label className="text-xs text-gray-700">AI 影片模型</Label>
                      <select
                        value={selectedVideoModel}
                        onChange={(e) => setSelectedVideoModel(e.target.value)}
                        className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
                      >
                        {VIDEO_MODELS.map(m => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-gray-500 mt-1">{selectedVideoMeta.desc}</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs text-gray-700">時長</Label>
                        <select
                          value={videoDuration}
                          onChange={(e) => setVideoDuration(parseInt(e.target.value) || 5)}
                          className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
                        >
                          <option value={3}>3 秒</option>
                          <option value={5}>5 秒</option>
                          <option value={8}>8 秒</option>
                          <option value={10}>10 秒</option>
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs text-gray-700">比例</Label>
                        <select
                          value={videoAspectRatio}
                          onChange={(e) => setVideoAspectRatio(e.target.value as any)}
                          className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
                        >
                          <option value="9:16">9:16 直向</option>
                          <option value="16:9">16:9 橫向</option>
                          <option value="1:1">1:1 方形</option>
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs text-gray-700">畫質</Label>
                        <select
                          value={videoResolution}
                          onChange={(e) => setVideoResolution(e.target.value as any)}
                          className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
                        >
                          <option value="720p">720P（{selectedVideoMeta.per720} 積分/秒）</option>
                          <option value="1080p">1080P（{selectedVideoMeta.per1080} 積分/秒）</option>
                        </select>
                      </div>
                    </div>
                    <p className="text-xs text-purple-700 bg-purple-50 px-3 py-2 rounded-lg">
                      🎬 使用 <b>{selectedVideoMeta.label}</b>；本次預估扣費 <b>{videoCost} 積分</b>（{videoDuration} 秒 × {videoCreditsPerSec} 積分/秒）。每日上限 10 支影片。
                    </p>
                  </div>
                )}

                <Button
                  className={`w-full mt-4 text-white ${mode === "image-to-video" ? "bg-purple-600 hover:bg-purple-700" : "bg-rose-600 hover:bg-rose-700"}`}
                  disabled={!!isGenerating}
                  onClick={handleGenerate}
                >
                  {isGenerating
                    ? (mode === "image-to-video" ? "🎬 生成影片中..." : "🎨 生成中...")
                    : `${mode === "image-to-video" ? "🎬 開始生成影片" : "🔞 開始生成"}（${cost} 積分）`}
                </Button>
                {user && (
                  <div className="text-xs text-gray-500 mt-2 text-center">
                    您的餘額：<b className="text-rose-600">{user.credits}</b> 積分
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Video result card — shown whenever a video job is in flight,
                done or failed. Kept separate from the image result card so
                switching modes doesn't blow away prior results. */}
            {(isVideoBusy || resultVideoUrl || videoGeneration?.status === "failed") && (
              <Card className="bg-white shadow-sm">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-purple-800 mb-3">🎬 影片生成結果</h3>
                  {isVideoBusy && (
                    <div className="aspect-[9/16] bg-gradient-to-br from-purple-50 to-rose-50 rounded-lg flex flex-col items-center justify-center text-gray-600 max-h-80">
                      <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mb-3" />
                      <p className="text-sm">WAN 渲染中，約 1-3 分鐘...</p>
                      <p className="text-xs text-gray-400 mt-1">頁面可保持開啟，完成後自動顯示。</p>
                    </div>
                  )}
                  {!isVideoBusy && resultVideoUrl && (
                    <>
                      <video src={resultVideoUrl} controls className="w-full rounded-lg max-h-[70vh] bg-black" />
                      <div className="flex gap-2 mt-3">
                        <a
                          href={resultVideoUrl}
                          download
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 text-center py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                        >
                          ⬇️ 下載影片
                        </a>
                        <button
                          onClick={() => {
                            setCurrentVideoGenerationId("");
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          className="flex-1 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-sm"
                        >
                          ✨ 再生一支
                        </button>
                      </div>
                    </>
                  )}
                  {!isVideoBusy && videoGeneration?.status === "failed" && (
                    <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                      影片生成失敗：{videoGeneration.errorMessage || "未知錯誤"}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* image result */}
            {(isImageBusy || resultUrl || generation?.status === "failed") && (
              <Card className="bg-white shadow-sm">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">生成結果</h3>
                  {isImageBusy && (
                    <div className="aspect-square bg-gradient-to-br from-rose-50 to-purple-50 rounded-lg flex flex-col items-center justify-center text-gray-500">
                      <div className="animate-spin w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full mb-3" />
                      <p className="text-sm">AI 創作中，約 10-30 秒...</p>
                    </div>
                  )}
                  {!isImageBusy && resultUrl && (
                    <>
                      <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
                        <DialogTrigger asChild>
                          <img src={resultUrl} alt="result" className="w-full rounded-lg cursor-zoom-in" />
                        </DialogTrigger>
                        <DialogContent className="max-w-4xl p-2">
                          <img src={resultUrl} alt="result" className="w-full" />
                        </DialogContent>
                      </Dialog>
                      <div className="flex gap-2 mt-3">
                        <a
                          href={resultUrl}
                          download
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 text-center py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm"
                        >
                          ⬇️ 下載
                        </a>
                        <button
                          onClick={() => {
                            setCurrentGenerationId("");
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                          className="flex-1 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-sm"
                        >
                          ✨ 再生一張
                        </button>
                      </div>
                    </>
                  )}
                  {!isImageBusy && generation?.status === "failed" && (
                    <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                      生成失敗：{generation.errorMessage || "未知錯誤"}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/App";
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
import type { ImageGeneration } from "@shared/schema";

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

type ParsedLine =
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; text: string }
  | { kind: "hr" }
  | { kind: "chip"; text: string }
  | { kind: "tableRow"; cells: string[] }
  | { kind: "tableSep" }
  | { kind: "blank" };

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
  return out;
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

  const [mode, setMode] = useState<"text-to-image" | "image-to-image">("text-to-image");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("2K");
  const [guidanceScale, setGuidanceScale] = useState(5.5);
  const [seed, setSeed] = useState(21);
  // Model selection. "byteplus" = default Seedream 5.0 (with watermark toggle,
  // supports text + image-to-image). Other ids route through GMI Cloud and
  // hit /api/image-generations with provider:"gmi". GMI models are text-only
  // for now and bypass the watermark pipeline (no addWatermark()).
  // Keep ids + labels + prices in sync with server/gmiProvider.ts.
  const NSFW_MODELS = [
    { id: "byteplus", label: "Seedream 5.0 (BytePlus · 預設)", desc: "穩定快速、可選浮水印與圖片編輯", credits: 3, provider: "byteplus" as const, supportsI2I: true },
    { id: "Z-Image",          label: "Z-Image (阿里通義 · 寬鬆)",            desc: "中英文友好、無內建安全過濾",         credits: 3, provider: "gmi" as const, supportsI2I: false },
    { id: "wan2.7-image",     label: "Wan 2.7 (阿里 · 開源寬鬆)",            desc: "Wan 2.7 開源、預設審查寬鬆",         credits: 4, provider: "gmi" as const, supportsI2I: false },
    { id: "flux-kontext-pro", label: "FLUX Kontext Pro (Black Forest · 高細節)", desc: "細節最強、放寬安全等級 (=6)",     credits: 6, provider: "gmi" as const, supportsI2I: false },
  ];
  const [selectedModel, setSelectedModel] = useState<string>("byteplus");
  const selectedModelMeta = NSFW_MODELS.find(m => m.id === selectedModel) ?? NSFW_MODELS[0];
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
    if (mode === "image-to-image" && !uploadedImagePath) {
      toast({ title: "缺少圖片", description: "圖片編輯模式請先上傳圖片。", variant: "destructive" });
      return;
    }
    if (mode === "image-to-image" && !selectedModelMeta.supportsI2I) {
      toast({
        title: "此模型暫不支援圖片編輯",
        description: `${selectedModelMeta.label} 目前僅支援文字生圖，請切換到 Seedream 或改用文字生圖模式。`,
        variant: "destructive",
      });
      return;
    }
    // Common payload bits. For GMI models we send provider+model and skip
    // the watermark flag — GMI doesn't watermark and our server intentionally
    // ignores that toggle for GMI rows.
    const providerFields =
      selectedModelMeta.provider === "gmi"
        ? { provider: "gmi", model: selectedModelMeta.id }
        : {};
    if (mode === "text-to-image") {
      generateMutation.mutate({
        type: "text-to-image",
        prompt: prompt.trim(),
        guidanceScale, seed, watermark, size,
        ...providerFields,
      });
    } else {
      generateMutation.mutate({
        type: "image-to-image",
        originalImageUrl: uploadedImagePath,
        prompt: prompt.trim(),
        guidanceScale, seed, watermark, size,
        ...providerFields,
      });
    }
  };

  // Per-image credit cost. Default Seedream still honours the watermark
  // toggle (3 with / 8 without). GMI models charge a flat per-image rate
  // from the registry above and ignore the watermark flag.
  const cost = selectedModelMeta.provider === "gmi"
    ? selectedModelMeta.credits
    : (watermark ? 3 : 8);
  const isGenerating = generateMutation.isPending || (currentGenerationId && (generation?.status === "pending" || generation?.status === "processing"));
  const resultUrl = generation?.generatedImageUrl;

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
          {/* ============ 左欄：提示詞模板庫 ============ */}
          <div className="lg:col-span-7 order-2 lg:order-1">
            <Card className="bg-white shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <h2 className="text-base font-semibold text-gray-800">📚 提示詞模板庫</h2>
                  <Input
                    placeholder="🔍 搜尋詞彙（如：制服 / 教室 / 微笑）"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full sm:w-64 text-sm"
                  />
                </div>

                {/* tabs */}
                <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-thin">
                  {TEMPLATE_FILES.map(t => (
                    <button
                      key={t.file}
                      onClick={() => setActiveFile(t.file)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                        activeFile === t.file
                          ? "bg-rose-600 text-white border-rose-600"
                          : "bg-gray-50 text-gray-700 border-gray-200 hover:bg-rose-50 hover:border-rose-300"
                      }`}
                    >
                      <span className="mr-1">{t.emoji}</span>{t.label}
                    </button>
                  ))}
                </div>

                <div className="text-xs text-gray-500 mb-2 px-1">
                  💡 點任意一行詞彙會自動加到右側提示詞框。
                </div>

                <div className="h-[60vh] overflow-y-auto pr-2 border rounded-lg bg-gray-50/50 p-3 text-sm">
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
                    if (l.kind === "tableRow") {
                      return (
                        <div key={i} className="flex gap-1.5 flex-wrap my-1">
                          {l.cells.map((c, ci) => {
                            const clean = stripMd(c);
                            if (!clean || clean === "-") return null;
                            return (
                              <button
                                key={ci}
                                onClick={() => insertToPrompt(c)}
                                className="px-2 py-0.5 text-xs bg-white border border-gray-200 rounded hover:bg-rose-50 hover:border-rose-300 text-gray-700"
                                title="點擊加入提示詞"
                              >
                                {clean}
                              </button>
                            );
                          })}
                        </div>
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
              </CardContent>
            </Card>
          </div>

          {/* ============ 右欄：生成面板 ============ */}
          <div className="lg:col-span-5 order-1 lg:order-2 space-y-4">
            {/* mode toggle */}
            <Card className="bg-white shadow-sm">
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <button
                    onClick={() => setMode("text-to-image")}
                    className={`py-2 rounded-lg text-sm font-medium ${mode === "text-to-image" ? "bg-rose-600 text-white" : "bg-gray-100 text-gray-700"}`}
                  >
                    📝 文字生圖
                  </button>
                  <button
                    onClick={() => setMode("image-to-image")}
                    className={`py-2 rounded-lg text-sm font-medium ${mode === "image-to-image" ? "bg-rose-600 text-white" : "bg-gray-100 text-gray-700"}`}
                  >
                    🖼️ 圖片編輯
                  </button>
                </div>

                {mode === "image-to-image" && (
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

                {/* Model picker. Sits above the size/seed grid so it reads
                    as the most important choice. Each option shows its
                    per-image credit cost; GMI options are grouped with an
                    optgroup so the default Seedream stays visually primary. */}
                <div className="mt-4">
                  <Label className="text-xs text-gray-700 flex items-center justify-between">
                    <span>AI 模型</span>
                    <span className="text-rose-600 font-semibold">{selectedModelMeta.credits} 積分／張</span>
                  </Label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
                  >
                    <optgroup label="BytePlus（預設）">
                      {NSFW_MODELS.filter(m => m.provider === "byteplus").map(m => (
                        <option key={m.id} value={m.id}>{m.label} — {m.credits} 積分</option>
                      ))}
                    </optgroup>
                    <optgroup label="GMI Cloud（多家模型）">
                      {NSFW_MODELS.filter(m => m.provider === "gmi").map(m => (
                        <option key={m.id} value={m.id}>{m.label} — {m.credits} 積分</option>
                      ))}
                    </optgroup>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">{selectedModelMeta.desc}</p>
                  {selectedModelMeta.provider === "gmi" && !selectedModelMeta.supportsI2I && (
                    <p className="text-xs text-amber-600 mt-1">
                      ⚠️ 此模型僅支援文字生圖，圖片編輯請切回 Seedream。
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <Label className="text-xs text-gray-700">尺寸</Label>
                    <select
                      value={size}
                      onChange={(e) => setSize(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
                    >
                      <option value="2K">2K 高清</option>
                      <option value="4K">4K 超高清</option>
                      <option value="1920x1920">1:1 正方形</option>
                      <option value="1440x2560">9:16 直向</option>
                      <option value="2560x1440">16:9 橫向</option>
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

                <Button
                  className="w-full mt-4 bg-rose-600 hover:bg-rose-700 text-white"
                  disabled={!!isGenerating}
                  onClick={handleGenerate}
                >
                  {isGenerating ? "🎨 生成中..." : `🔞 開始生成（${cost} 積分）`}
                </Button>
                {user && (
                  <div className="text-xs text-gray-500 mt-2 text-center">
                    您的餘額：<b className="text-rose-600">{user.credits}</b> 積分
                  </div>
                )}
              </CardContent>
            </Card>

            {/* result */}
            {(isGenerating || resultUrl || generation?.status === "failed") && (
              <Card className="bg-white shadow-sm">
                <CardContent className="p-4">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">生成結果</h3>
                  {isGenerating && (
                    <div className="aspect-square bg-gradient-to-br from-rose-50 to-purple-50 rounded-lg flex flex-col items-center justify-center text-gray-500">
                      <div className="animate-spin w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full mb-3" />
                      <p className="text-sm">AI 創作中，約 10-30 秒...</p>
                    </div>
                  )}
                  {!isGenerating && resultUrl && (
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
                  {!isGenerating && generation?.status === "failed" && (
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

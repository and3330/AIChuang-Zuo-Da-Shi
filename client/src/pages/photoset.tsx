import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/App";
import { NavigationHeader } from "./account";
import type { ImageGeneration } from "@shared/schema";
import { IMAGE_RATIOS, IMAGE_TIERS, imageSizeFor, type ImageRatioId, type ImageTierId } from "@shared/imageSizes";

// 寫真套圖：上傳一張情境圖 → AI 分析並規劃一組鏡頭 → 使用者可修改 →
// 用 Seedream 5.5 以情境圖為參考，一次生成整組套圖。
// 生成走既有的批次端點 (/api/image-generations + prompts)，
// 所以扣點、失敗退點、CDN 轉存都與首頁的批次編輯一致。

type Shot = { title: string; prompt: string };
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
const COUNT_OPTIONS = [4, 6, 9];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

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

export default function PhotosetPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imagePath, setImagePath] = useState("");
  const [uploading, setUploading] = useState(false);
  const [count, setCount] = useState(6);
  const [ratioId, setRatioId] = useState<ImageRatioId>("3:4");
  const [tierId, setTierId] = useState<ImageTierId>("2k");
  const [direction, setDirection] = useState("");
  const [watermark, setWatermark] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [batchId, setBatchId] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const ratio = IMAGE_RATIOS.find(r => r.id === ratioId) ?? IMAGE_RATIOS[0];
  const outputSize = imageSizeFor(ratioId, tierId);
  const shots = plan?.shots ?? [];
  const validShots = shots.filter(s => s.prompt.trim().length > 0);
  const perImage = watermark ? 3 : 8;
  const totalCost = validShots.length * perImage;
  const credits = user?.credits ?? 0;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "檔案格式不支援", description: "請上傳 JPG、PNG 或 WEBP 圖片。", variant: "destructive" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ title: "圖片太大", description: "請上傳 20MB 以內的圖片。", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const path = await uploadToObjectStorage(file);
      setImagePath(path);
      setPlan(null);
      setBatchId("");
    } catch (e) {
      toast({ title: "上傳失敗", description: errorText(e), variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const planMutation = useMutation({
    mutationFn: async (): Promise<Plan> => {
      const res = await apiRequest("POST", "/api/photosets/plan", {
        originalImageUrl: imagePath,
        count,
        direction: direction.trim() || undefined,
        aspectRatio: ratio.id,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setPlan(data);
      setBatchId("");
    },
    onError: (e) => {
      toast({ title: "規劃失敗", description: errorText(e), variant: "destructive" });
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/image-generations", {
        type: "image-to-image",
        originalImageUrl: imagePath,
        prompts: validShots.map(s => s.prompt.trim()),
        watermark,
        size: outputSize,
      });
      return res.json() as Promise<{ batchId: string }>;
    },
    onSuccess: (data) => {
      setBatchId(data.batchId);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: (e) => {
      toast({ title: "生成失敗", description: errorText(e), variant: "destructive" });
    },
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

  const updateShot = (idx: number, patch: Partial<Shot>) => {
    setPlan(p => p ? { ...p, shots: p.shots.map((s, i) => (i === idx ? { ...s, ...patch } : s)) } : p);
  };
  const removeShot = (idx: number) => {
    setPlan(p => p ? { ...p, shots: p.shots.filter((_, i) => i !== idx) } : p);
  };
  const addShot = () => {
    setPlan(p => p && p.shots.length < MAX_SHOTS
      ? { ...p, shots: [...p.shots, { title: `鏡頭 ${p.shots.length + 1}`, prompt: "" }] }
      : p);
  };

  const canGenerate =
    !!imagePath && validShots.length >= MIN_SHOTS && validShots.length <= MAX_SHOTS &&
    credits >= totalCost && !isGenerating;

  const imageOf = (g: ImageGeneration) => g.bunnyImageUrl || g.generatedImageUrl || "";

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-24">
      <NavigationHeader />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#0f172a]">📸 寫真套圖</h1>
          <p className="text-sm text-[#64748b] mt-1">
            上傳一張情境圖，AI 會分析人物與場景，規劃一整組不同景別、角度與姿勢的寫真，一次生成可直接貼上社群的套圖。
          </p>
        </div>

        <div className="grid lg:grid-cols-[360px_1fr] gap-6 items-start">
          {/* ── 左：情境圖與設定 ───────────────────────────── */}
          <div className="bg-white border border-[#e2e8f0] rounded-2xl p-5 space-y-5">
            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">① 情境圖</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
                data-testid="input-photoset-file"
              />
              {imagePath ? (
                <div className="space-y-2">
                  <img src={imagePath} alt="情境圖" className="w-full max-h-80 object-contain rounded-xl bg-[#f1f5f9]" />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || isGenerating}
                    className="text-xs text-[#6366f1] hover:underline disabled:opacity-50"
                  >
                    {uploading ? "上傳中…" : "更換圖片"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full h-44 border-2 border-dashed border-[#cbd5e1] rounded-xl flex flex-col items-center justify-center gap-2 text-[#64748b] hover:border-[#6366f1] hover:text-[#6366f1] transition-colors disabled:opacity-50"
                  data-testid="button-photoset-upload"
                >
                  <i className="fas fa-cloud-upload-alt text-2xl" />
                  <span className="text-sm">{uploading ? "上傳中…" : "點擊上傳情境圖"}</span>
                  <span className="text-[11px] text-[#94a3b8]">JPG／PNG／WEBP，20MB 以內</span>
                </button>
              )}
              <p className="text-[11px] text-[#94a3b8] mt-2">
                建議使用人物清楚、服裝與場景完整的照片，整組套圖會以它維持人物與風格一致。
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">② 張數</p>
              <div className="flex gap-2">
                {COUNT_OPTIONS.map(n => (
                  <button
                    key={n}
                    onClick={() => setCount(n)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      count === n ? "border-[#6366f1] bg-[#6366f1]/10 text-[#4f46e5]" : "border-[#e2e8f0] text-[#475569] hover:border-[#6366f1]/40"
                    }`}
                  >
                    {n} 張
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">③ 比例</p>
              <div className="grid grid-cols-2 gap-2">
                {IMAGE_RATIOS.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setRatioId(r.id)}
                    className={`p-2 rounded-lg border text-left transition-colors ${
                      ratioId === r.id ? "border-[#6366f1] bg-[#6366f1]/10" : "border-[#e2e8f0] hover:border-[#6366f1]/40"
                    }`}
                  >
                    <div className="text-sm font-medium text-[#0f172a]">{r.label}</div>
                    <div className="text-[11px] text-[#64748b]">{r.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">④ 畫質</p>
              <div className="space-y-2">
                {IMAGE_TIERS.map(t => {
                  const [w, h] = ratio.sizes[t.id];
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTierId(t.id)}
                      className={`w-full p-2 rounded-lg border text-left flex items-center justify-between gap-2 transition-colors ${
                        tierId === t.id ? "border-[#6366f1] bg-[#6366f1]/10" : "border-[#e2e8f0] hover:border-[#6366f1]/40"
                      }`}
                      data-testid={`button-photoset-tier-${t.id}`}
                    >
                      <span>
                        <span className="text-sm font-medium text-[#0f172a]">{t.label}</span>
                        <span className="block text-[11px] text-[#64748b]">{t.hint}</span>
                      </span>
                      <span className="text-xs font-mono text-[#475569] shrink-0">{w} × {h}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-[#94a3b8] mt-2">
                輸出尺寸：{outputSize.replace("x", " × ")} px。各畫質的積分相同。
              </p>
            </div>

            <div>
              <p className="text-sm font-semibold text-[#0f172a] mb-2">⑤ 風格方向（選填）</p>
              <textarea
                value={direction}
                onChange={(e) => setDirection(e.target.value.slice(0, 500))}
                rows={3}
                placeholder="例如：日系清新、多一點臉部特寫、加入逆光與走動的抓拍感"
                className="w-full px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#6366f1] focus:border-transparent"
                data-testid="input-photoset-direction"
              />
            </div>

            <button
              onClick={() => planMutation.mutate()}
              disabled={!imagePath || planMutation.isPending || isGenerating}
              className="w-full py-2.5 rounded-xl bg-[#0f172a] text-white text-sm font-semibold hover:bg-[#1e293b] disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="button-photoset-plan"
            >
              {planMutation.isPending ? "AI 分析規劃中…" : plan ? "重新分析並規劃" : "分析情境圖並規劃鏡頭（免費）"}
            </button>
          </div>

          {/* ── 右：鏡頭規劃與成果 ─────────────────────────── */}
          <div className="space-y-6">
            {!plan && (
              <div className="bg-white border border-[#e2e8f0] rounded-2xl p-10 text-center text-[#94a3b8]">
                <i className="fas fa-images text-3xl mb-3" />
                <p className="text-sm">上傳情境圖並按下「分析情境圖並規劃鏡頭」，這裡會出現整組鏡頭清單，可逐條修改後再生成。</p>
              </div>
            )}

            {plan && (
              <div className="bg-white border border-[#e2e8f0] rounded-2xl p-5 space-y-4">
                {plan.analysis && (
                  <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-xl p-3">
                    <p className="text-xs font-semibold text-[#475569] mb-1">AI 對情境圖的分析</p>
                    <p className="text-sm text-[#334155] leading-relaxed">{plan.analysis}</p>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-[#0f172a]">鏡頭清單（{shots.length} 張，可修改）</p>
                  <button
                    onClick={addShot}
                    disabled={shots.length >= MAX_SHOTS || isGenerating}
                    className="text-xs text-[#6366f1] hover:underline disabled:opacity-40"
                  >
                    ＋ 新增鏡頭
                  </button>
                </div>

                <div className="space-y-3">
                  {shots.map((shot, idx) => (
                    <div key={idx} className="border border-[#e2e8f0] rounded-xl p-3 space-y-2" data-testid={`card-shot-${idx}`}>
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-[#6366f1]/10 text-[#4f46e5] text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                        <input
                          value={shot.title}
                          onChange={(e) => updateShot(idx, { title: e.target.value.slice(0, 30) })}
                          disabled={isGenerating}
                          className="flex-1 min-w-0 text-sm font-semibold text-[#0f172a] bg-transparent border-b border-transparent focus:border-[#6366f1] focus:outline-none"
                        />
                        <button
                          onClick={() => removeShot(idx)}
                          disabled={shots.length <= MIN_SHOTS || isGenerating}
                          className="text-xs text-[#ef4444] hover:underline disabled:opacity-30"
                        >
                          移除
                        </button>
                      </div>
                      <textarea
                        value={shot.prompt}
                        onChange={(e) => updateShot(idx, { prompt: e.target.value })}
                        disabled={isGenerating}
                        rows={3}
                        placeholder="描述這張的景別、角度、姿勢、表情與光線"
                        className="w-full px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm leading-relaxed focus:ring-2 focus:ring-[#6366f1] focus:border-transparent disabled:bg-[#f8fafc]"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-[#e2e8f0]">
                  <label className="flex items-center gap-2 text-sm text-[#475569] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={watermark}
                      onChange={(e) => setWatermark(e.target.checked)}
                      disabled={isGenerating}
                      className="accent-[#6366f1]"
                    />
                    加上浮水印（3 積分／張；取消為 8 積分／張）
                  </label>
                  <div className="text-sm text-[#475569]">
                    共 <b className="text-[#0f172a]">{validShots.length}</b> 張 × {perImage} ＝{" "}
                    <b className="text-[#4f46e5]">{totalCost} 積分</b>
                    <span className="text-xs text-[#94a3b8] ml-2">（餘額 {credits}）</span>
                  </div>
                </div>

                {credits < totalCost && (
                  <p className="text-xs text-[#ef4444]">積分不足，請先儲值或減少張數。</p>
                )}
                {validShots.length < MIN_SHOTS && (
                  <p className="text-xs text-[#ef4444]">至少需要 {MIN_SHOTS} 個有內容的鏡頭。</p>
                )}

                <button
                  onClick={() => generateMutation.mutate()}
                  disabled={!canGenerate}
                  className="w-full py-3 rounded-xl bg-[#6366f1] text-white text-sm font-semibold hover:bg-[#4f46e5] disabled:opacity-40 disabled:cursor-not-allowed"
                  data-testid="button-photoset-generate"
                >
                  {isGenerating
                    ? `生成中… ${batch ? `${batch.completedCount + batch.failedCount}/${batch.totalCount}` : ""}`
                    : batchDone ? `再生成一組（${totalCost} 積分）` : `生成整組套圖（${totalCost} 積分）`}
                </button>
                <p className="text-[11px] text-[#94a3b8]">
                  每張約需 1–3 分鐘，整組同時生成；失敗的張數會自動退還積分。每日圖片上限 50 張。
                </p>
              </div>
            )}

            {batch && (
              <div className="bg-white border border-[#e2e8f0] rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-[#0f172a]">套圖成果</p>
                  <p className="text-xs text-[#64748b]">
                    完成 {batch.completedCount}／{batch.totalCount}
                    {batch.failedCount > 0 && <span className="text-[#ef4444]">，失敗 {batch.failedCount}（已退點）</span>}
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {batch.generations.map((g, idx) => {
                    const url = imageOf(g);
                    return (
                      <div key={g.id} className="relative rounded-xl overflow-hidden bg-[#f1f5f9] border border-[#e2e8f0]" style={{ aspectRatio: ratio.id.replace(":", " / ") }} data-testid={`card-result-${idx}`}>
                        {g.status === "completed" && url ? (
                          <>
                            <img src={url} alt={`套圖 ${idx + 1}`} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setLightbox(url)} />
                            <a
                              href={url}
                              download={`photoset-${idx + 1}.jpg`}
                              target="_blank"
                              rel="noreferrer"
                              className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                              title="下載"
                            >
                              <i className="fas fa-download text-xs" />
                            </a>
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

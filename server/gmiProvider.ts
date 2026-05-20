/**
 * GMI Cloud Inference Engine provider.
 *
 * Wraps the async request-queue API documented at
 *   https://docs.gmicloud.ai/inference-engine/api-reference/video-api-reference
 *
 * Auth header:   Authorization: Bearer GMI_API_KEY
 * Submit job:    POST  {BASE}/requests        body { model, payload }
 *                returns { request_id, status }
 * Observe job:   GET   {BASE}/requests/{id}   returns { status, outcome? }
 *                status reaches "success" / "finished" / "completed" on done,
 *                "failed" / "error" on failure.
 *
 * Each model has different payload fields (Veo3 uses durationSeconds, Kling
 * uses duration, etc.) so we keep a per-model registry that knows how to
 * build the payload and how to dig the resulting image URL out of `outcome`.
 *
 * Scope: this file currently only exposes IMAGE models intended for the
 * /nsfw page (uncensored / permissive providers). Video models can be added
 * later by following the same pattern.
 */

const GMI_BASE = "https://console.gmicloud.ai/api/v1/ie/requestqueue/apikey";

function authHeader(): Record<string, string> {
  const key = process.env.GMI_API_KEY;
  if (!key) throw new Error("GMI_API_KEY 未設定，無法呼叫 GMI Cloud。");
  return { Authorization: `Bearer ${key}` };
}

export type GmiImageBuildArgs = {
  prompt: string;
  size?: string;            // app-level size like "2K", "4K", "1920x1920"
  seed?: number;
  guidanceScale?: number;
};

export type GmiImageModelConfig = {
  /** GMI model id, e.g. "Z-Image" */
  id: string;
  /** Friendly Chinese label shown in the UI */
  label: string;
  /** Short description, used as the dropdown subtitle */
  description: string;
  /** Whole-number credits charged per generated image */
  creditsPerImage: number;
  buildPayload: (args: GmiImageBuildArgs) => Record<string, any>;
};

/* ---------- size helpers ---------- */

function sizeToWH(size: string | undefined): { width: number; height: number } {
  if (!size) return { width: 1024, height: 1024 };
  if (size === "2K") return { width: 2048, height: 2048 };
  if (size === "4K") return { width: 4096, height: 4096 };
  const m = size.match(/^(\d+)x(\d+)$/);
  if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  return { width: 1024, height: 1024 };
}

/** Clamp width/height so the total pixel count stays inside a model's budget. */
function clampPixels(
  w: number,
  h: number,
  maxPixels: number,
  minSide = 256,
): { width: number; height: number } {
  if (w * h <= maxPixels) {
    return { width: Math.max(minSide, w), height: Math.max(minSide, h) };
  }
  const scale = Math.sqrt(maxPixels / (w * h));
  return {
    width: Math.max(minSide, Math.round(w * scale)),
    height: Math.max(minSide, Math.round(h * scale)),
  };
}

function sizeToAspect(size: string | undefined): "1:1" | "16:9" | "9:16" | "4:3" | "3:4" {
  const { width, height } = sizeToWH(size);
  const r = width / height;
  if (Math.abs(r - 16 / 9) < 0.15) return "16:9";
  if (Math.abs(r - 9 / 16) < 0.15) return "9:16";
  if (Math.abs(r - 4 / 3) < 0.1) return "4:3";
  if (Math.abs(r - 3 / 4) < 0.1) return "3:4";
  return "1:1";
}

/* ---------- model registry (NSFW-friendly only) ---------- */

export const GMI_IMAGE_MODELS: Record<string, GmiImageModelConfig> = {
  "Z-Image": {
    id: "Z-Image",
    label: "Z-Image (阿里通義 · 寬鬆)",
    description: "中英文友好、無內建安全過濾，適合多數 NSFW 場景",
    creditsPerImage: 3,
    buildPayload: ({ prompt, size, seed, guidanceScale }) => {
      // Z-Image budget: total pixels 0.25M ~ 4M. 2K square (4.19M) overshoots,
      // so we clamp to fit while preserving aspect ratio.
      const wh = clampPixels(sizeToWH(size).width, sizeToWH(size).height, 4_000_000);
      const payload: Record<string, any> = {
        prompt,
        width: wh.width,
        height: wh.height,
      };
      if (typeof guidanceScale === "number") payload.guidance_scale = guidanceScale;
      if (typeof seed === "number") payload.seed = seed;
      return payload;
    },
  },
  "wan2.7-image": {
    id: "wan2.7-image",
    label: "Wan 2.7 (阿里 · 開源寬鬆)",
    description: "阿里 Wan 2.7 開源圖片模型，預設審查寬鬆",
    creditsPerImage: 4,
    buildPayload: ({ prompt, size }) => {
      // Wan 2.7 uses `text` (not `prompt`) and an aspect-ratio enum via `size`.
      // We map our app sizes onto the closest aspect bucket.
      const aspect = sizeToAspect(size);
      const wanSize =
        aspect === "16:9" ? "1280*720" :
        aspect === "9:16" ? "720*1280" :
        aspect === "4:3"  ? "1280*960" :
        aspect === "3:4"  ? "960*1280" :
                            "1024*1024";
      return {
        text: prompt,
        size: wanSize,
        n: 1,
      };
    },
  },
  "flux-kontext-pro": {
    id: "flux-kontext-pro",
    label: "FLUX Kontext Pro (Black Forest · 高細節)",
    description: "細節最強、可放寬安全等級 (safety_tolerance=6)",
    creditsPerImage: 6,
    buildPayload: ({ prompt, size, seed }) => {
      const payload: Record<string, any> = {
        prompt,
        aspect_ratio: sizeToAspect(size),
        safety_tolerance: 6, // 0 strictest .. 6 most permissive
        output_format: "jpeg",
      };
      if (typeof seed === "number") payload.seed = seed;
      return payload;
    },
  },
};

/** Lightweight list for the frontend dropdown. */
export const GMI_IMAGE_MODEL_LIST = Object.values(GMI_IMAGE_MODELS).map((c) => ({
  id: c.id,
  label: c.label,
  description: c.description,
  creditsPerImage: c.creditsPerImage,
}));

/* ---------- HTTP helpers ---------- */

export async function gmiSubmitJob(model: string, payload: Record<string, any>): Promise<string> {
  const resp = await fetch(`${GMI_BASE}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ model, payload }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`GMI 任務建立失敗 (${resp.status}): ${text.slice(0, 400)}`);
  }
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`GMI 任務回傳不是合法 JSON: ${text.slice(0, 200)}`);
  }
  if (!j.request_id) {
    throw new Error(`GMI 任務回傳缺少 request_id: ${text.slice(0, 200)}`);
  }
  return j.request_id;
}

const TERMINAL_OK = new Set(["success", "finished", "completed", "succeeded"]);
const TERMINAL_FAIL = new Set(["failed", "error", "cancelled", "canceled"]);

export async function gmiPollUntilDone(
  requestId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<any> {
  const timeoutMs = opts.timeoutMs ?? 6 * 60 * 1000; // 6min default for images
  const intervalMs = opts.intervalMs ?? 3000;
  const started = Date.now();
  let lastStatus = "(no response yet)";
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let resp: Response;
    try {
      resp = await fetch(`${GMI_BASE}/requests/${requestId}`, { headers: authHeader() });
    } catch (e: any) {
      console.warn(`GMI poll network error: ${e?.message}`);
      continue;
    }
    if (!resp.ok) {
      console.warn(`GMI poll HTTP ${resp.status} for ${requestId}`);
      continue;
    }
    let j: any;
    try {
      j = await resp.json();
    } catch {
      continue;
    }
    lastStatus = j.status || lastStatus;
    if (TERMINAL_OK.has(j.status)) return j;
    if (TERMINAL_FAIL.has(j.status)) {
      const detail =
        j.outcome?.error || j.outcome?.message ||
        (j.outcome ? JSON.stringify(j.outcome).slice(0, 300) : "") ||
        j.error || "(no detail)";
      throw new Error(`GMI 任務失敗：${detail}`);
    }
  }
  throw new Error(`GMI 任務輪詢逾時 (last status: ${lastStatus})`);
}

/* ---------- image URL extraction ---------- */

/**
 * Pull a single image URL out of GMI's `outcome` dict. The shape varies per
 * model (we've seen `image_url`, `url`, `images[]`, `data[].url`, raw string,
 * nested `output`). We try every common shape; throw if nothing matches.
 */
function extractFirstImageUrl(outcome: any): string | undefined {
  if (!outcome) return undefined;
  if (typeof outcome === "string" && /^https?:\/\//.test(outcome)) return outcome;
  if (typeof outcome !== "object") return undefined;

  if (typeof outcome.image_url === "string") return outcome.image_url;
  if (outcome.image_url && typeof outcome.image_url.url === "string") return outcome.image_url.url;
  if (typeof outcome.url === "string" && /^https?:\/\//.test(outcome.url)) return outcome.url;
  if (typeof outcome.image === "string" && /^https?:\/\//.test(outcome.image)) return outcome.image;

  for (const key of ["images", "data", "result", "results", "outputs"]) {
    const arr = outcome[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      if (typeof first === "string" && /^https?:\/\//.test(first)) return first;
      if (first && typeof first === "object") {
        const nested =
          first.url || first.image_url || first.image ||
          (first.image_url && first.image_url.url);
        if (typeof nested === "string") return nested;
      }
    }
  }

  if (outcome.output) return extractFirstImageUrl(outcome.output);
  return undefined;
}

/* ---------- video models (NSFW image-to-video) ---------- */

export type GmiVideoBuildArgs = {
  /** Already-encoded data URI or public HTTPS URL of the source frame. */
  imageDataOrUrl: string;
  prompt: string;
  /** App-level aspect ratio. Wan i2v derives output orientation from input
   *  image anyway, but we pass `size` when the API accepts it. */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Clip length in seconds. Wan typically supports 5 or 8; we clamp. */
  seconds?: number;
  resolution?: "720p" | "1080p";
};

export type GmiVideoModelConfig = {
  id: string;
  label: string;
  description: string;
  creditsPerSecond720p: number;
  creditsPerSecond1080p: number;
  /** Whole-minute upper bound on polling — Wan i2v can take 3-8 min. */
  pollTimeoutMs: number;
  buildPayload: (args: GmiVideoBuildArgs) => Record<string, any>;
};

function aspectToWanVideoSize(aspect: "16:9" | "9:16" | "1:1" | undefined, res: "720p" | "1080p" | undefined): string {
  // Wan video uses W*H (asterisk) format. 720p = short side 720, 1080p = 1080.
  const short = res === "1080p" ? 1080 : 720;
  const long = res === "1080p" ? 1920 : 1280;
  if (aspect === "9:16") return `${short}*${long}`;
  if (aspect === "1:1") return `${short}*${short}`;
  return `${long}*${short}`; // default 16:9
}

export const GMI_VIDEO_MODELS: Record<string, GmiVideoModelConfig> = {
  "wan2.7-i2v": {
    id: "wan2.7-i2v",
    label: "Wan 2.7 i2v (阿里 · 寬鬆)",
    description: "阿里 Wan 2.7 開源圖生影片，預設審查寬鬆",
    creditsPerSecond720p: 6,
    creditsPerSecond1080p: 10,
    pollTimeoutMs: 12 * 60 * 1000, // 12 min
    buildPayload: ({ imageDataOrUrl, prompt, aspectRatio, seconds, resolution }) => {
      // Wan i2v on the request-queue accepts either a public image URL or a
      // base64 data URI in `image`. `prompt` (alias of `text`) drives motion.
      // `size` is optional; if omitted the output matches the source frame's
      // aspect ratio. We pass it for predictability when the user picked one.
      const clamped = Math.max(3, Math.min(10, Math.round(seconds || 5)));
      return {
        image: imageDataOrUrl,
        prompt,
        size: aspectToWanVideoSize(aspectRatio, resolution),
        seconds: clamped,
      };
    },
  },
};

export const GMI_VIDEO_MODEL_LIST = Object.values(GMI_VIDEO_MODELS).map((c) => ({
  id: c.id,
  label: c.label,
  description: c.description,
  creditsPerSecond720p: c.creditsPerSecond720p,
  creditsPerSecond1080p: c.creditsPerSecond1080p,
}));

/** Pull a single video URL out of GMI's `outcome`. Same shape variance as
 *  images; tries common Wan / generic Aliyun field names. */
function extractFirstVideoUrl(outcome: any): string | undefined {
  if (!outcome) return undefined;
  if (typeof outcome === "string" && /^https?:\/\//.test(outcome)) return outcome;
  if (typeof outcome !== "object") return undefined;

  if (typeof outcome.video_url === "string") return outcome.video_url;
  if (outcome.video_url && typeof outcome.video_url.url === "string") return outcome.video_url.url;
  if (typeof outcome.url === "string" && /\.mp4(\?|$)/i.test(outcome.url)) return outcome.url;
  if (typeof outcome.video === "string" && /^https?:\/\//.test(outcome.video)) return outcome.video;

  for (const key of ["videos", "video_urls", "data", "result", "results", "outputs"]) {
    const arr = outcome[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      if (typeof first === "string" && /^https?:\/\//.test(first)) return first;
      if (first && typeof first === "object") {
        const nested =
          first.video_url || first.url || first.video ||
          (first.video_url && first.video_url.url);
        if (typeof nested === "string") return nested;
      }
    }
  }

  if (outcome.output) return extractFirstVideoUrl(outcome.output);
  return undefined;
}

/** End-to-end helper: submit, poll, return final video URL. Caller is
 *  responsible for downloading and re-hosting on Bunny CDN. */
export async function gmiGenerateVideo(args: {
  modelId: string;
  imageDataOrUrl: string;
  prompt: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  seconds?: number;
  resolution?: "720p" | "1080p";
}): Promise<{ videoUrl: string; modelId: string }> {
  const cfg = GMI_VIDEO_MODELS[args.modelId];
  if (!cfg) throw new Error(`未支援的 GMI 影片模型：${args.modelId}`);
  const payload = cfg.buildPayload(args);
  const requestId = await gmiSubmitJob(cfg.id, payload);
  console.log(`[GMI] submitted video ${cfg.id} request ${requestId}, payload keys:`, Object.keys(payload));
  const done = await gmiPollUntilDone(requestId, { timeoutMs: cfg.pollTimeoutMs, intervalMs: 5000 });
  const url = extractFirstVideoUrl(done.outcome);
  if (!url) {
    throw new Error(`GMI 影片完成但無法擷取影片 URL：${JSON.stringify(done.outcome).slice(0, 400)}`);
  }
  return { videoUrl: url, modelId: cfg.id };
}

/** End-to-end helper: submit, poll, return final image URL + credit cost. */
export async function gmiGenerateImage(args: {
  modelId: string;
  prompt: string;
  size?: string;
  seed?: number;
  guidanceScale?: number;
}): Promise<{ imageUrl: string; creditsPerImage: number; modelId: string }> {
  const cfg = GMI_IMAGE_MODELS[args.modelId];
  if (!cfg) throw new Error(`未支援的 GMI 模型：${args.modelId}`);
  const payload = cfg.buildPayload(args);
  const requestId = await gmiSubmitJob(cfg.id, payload);
  console.log(`[GMI] submitted ${cfg.id} request ${requestId}, payload keys:`, Object.keys(payload));
  const done = await gmiPollUntilDone(requestId);
  const url = extractFirstImageUrl(done.outcome);
  if (!url) {
    throw new Error(`GMI 完成但無法擷取圖片 URL：${JSON.stringify(done.outcome).slice(0, 400)}`);
  }
  return { imageUrl: url, creditsPerImage: cfg.creditsPerImage, modelId: cfg.id };
}

/**
 * AtlasCloud provider — the ONLY image AND video generation backend of the
 * app (Seedream 5.5 for images, Alibaba WAN 3.0 for video, see bottom of file).
 *
 * Models (ByteDance Seedream 5.5):
 *   bytedance/seedream-v5.5/edit           1–10 reference images + prompt
 *   bytedance/seedream-v5.5/text-to-image  prompt only (edit requires ≥1 image)
 *
 * Auth header:   Authorization: Bearer ATLASCLOUD_API_KEY
 * Submit job:    POST  {BASE}/api/v1/model/generateImage
 *                body { model, prompt, reference_images?, size, output_format }
 *                returns { code, data: { id, status } }
 * Poll job:      GET   {BASE}/api/v1/model/prediction/{id}
 *                returns { data: { status, outputs[], error } }
 *                status reaches "completed" / "succeeded" on done, "failed" on
 *                failure, otherwise "queued" / "processing".
 *
 * Notes for callers:
 *   - `size` is "W*H" and must be one of the official presets (see below).
 *   - No `seed` and no `watermark` params. The app's own brand watermark is
 *     still applied locally via addWatermark() where the caller asks for it.
 */

const ATLAS_BASE = "https://api.atlascloud.ai";

export const ATLAS_EDIT_MODEL = "bytedance/seedream-v5.5/edit";
export const ATLAS_T2I_MODEL = "bytedance/seedream-v5.5/text-to-image";
/** Friendly name for logs / UI. */
export const ATLAS_IMAGE_MODEL_LABEL = "Seedream 5.5";
/** The edit model accepts at most 10 reference images. */
export const ATLAS_MAX_REFERENCE_IMAGES = 10;

function authHeader(): Record<string, string> {
  const key = process.env.ATLASCLOUD_API_KEY;
  if (!key) throw new Error("ATLASCLOUD_API_KEY 未設定，無法呼叫 AtlasCloud。");
  return { Authorization: `Bearer ${key}` };
}

/** True when the Atlas key is configured (for early 500s in route handlers). */
export function atlasIsConfigured(): boolean {
  return !!process.env.ATLASCLOUD_API_KEY;
}

/* ---------- size mapping ---------- */

/** Official Seedream 5.5 size presets (2k / 1.5k / 1k tiers). */
const ATLAS_SIZE_PRESETS: Array<[number, number]> = [
  [2048, 2048], [2368, 1776], [1776, 2368], [2816, 1584], [1584, 2816],
  [2496, 1664], [1664, 2496], [3136, 1344],
  [1536, 1536], [1792, 1344], [1344, 1792], [2048, 1152], [1152, 2048],
  [1872, 1248], [1248, 1872], [2352, 1008],
  [1024, 1024], [1152, 864], [864, 1152], [1424, 800], [800, 1424],
  [1248, 832], [832, 1248], [1568, 672],
];

const DEFAULT_AREA = 2048 * 2048;

/**
 * Map any app-level size ("2K", "4K", "1440x2560", "1024*1024", "16:9", …)
 * to the closest official preset: aspect ratio first, then pixel budget.
 */
export function toAtlasSize(size: string | null | undefined): string {
  let ratio = 1;
  let area = DEFAULT_AREA;
  const s = (size || "").trim();
  const wh = s.match(/^(\d+)\s*[x*×]\s*(\d+)$/i);
  const ar = s.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (wh) {
    const w = parseInt(wh[1], 10);
    const h = parseInt(wh[2], 10);
    if (w > 0 && h > 0) { ratio = w / h; area = w * h; }
  } else if (ar) {
    const a = parseFloat(ar[1]);
    const b = parseFloat(ar[2]);
    if (a > 0 && b > 0) ratio = a / b;
  } else if (/^1k$/i.test(s)) {
    area = 1024 * 1024;
  }
  let best = ATLAS_SIZE_PRESETS[0];
  let bestScore = Infinity;
  for (const p of ATLAS_SIZE_PRESETS) {
    const score =
      Math.abs(Math.log((p[0] / p[1]) / ratio)) * 10 +
      Math.abs(Math.log((p[0] * p[1]) / area));
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return `${best[0]}*${best[1]}`;
}

/** Width / height (px) an app-level size resolves to. */
export function atlasSizeDimensions(size: string | null | undefined): { width: number; height: number } {
  const [w, h] = toAtlasSize(size).split("*").map(Number);
  return { width: w, height: h };
}

/* ---------- HTTP helpers ---------- */

async function atlasSubmitJob(
  payload: Record<string, any>,
  endpoint: "generateImage" | "generateVideo" = "generateImage",
): Promise<string> {
  const resp = await fetch(`${ATLAS_BASE}/api/v1/model/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`AtlasCloud 任務建立失敗 (${resp.status}): ${text.slice(0, 400)}`);
  }
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`AtlasCloud 任務回傳不是合法 JSON: ${text.slice(0, 200)}`);
  }
  const id = j?.data?.id || j?.id;
  if (!id) {
    throw new Error(`AtlasCloud 任務回傳缺少 prediction id: ${text.slice(0, 200)}`);
  }
  return id;
}

const TERMINAL_OK = new Set(["completed", "succeeded", "success", "finished"]);
const TERMINAL_FAIL = new Set(["failed", "error", "cancelled", "canceled"]);

async function atlasPollUntilDone(
  predictionId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<any> {
  const timeoutMs = opts.timeoutMs ?? 6 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 2000;
  const started = Date.now();
  let lastStatus = "(no response yet)";
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let resp: Response;
    try {
      resp = await fetch(`${ATLAS_BASE}/api/v1/model/prediction/${predictionId}`, {
        headers: authHeader(),
      });
    } catch (e: any) {
      console.warn(`AtlasCloud poll network error: ${e?.message}`);
      continue;
    }
    if (!resp.ok) {
      console.warn(`AtlasCloud poll HTTP ${resp.status} for ${predictionId}`);
      continue;
    }
    let j: any;
    try {
      j = await resp.json();
    } catch {
      continue;
    }
    const data = j?.data ?? j;
    const status = data?.status;
    lastStatus = status || lastStatus;
    if (status && TERMINAL_OK.has(status)) return data;
    if (status && TERMINAL_FAIL.has(status)) {
      const detail = data?.error || data?.message || "(no detail)";
      throw new Error(`AtlasCloud 任務失敗：${detail}`);
    }
  }
  throw new Error(`AtlasCloud 任務輪詢逾時 (last status: ${lastStatus})`);
}

/** Pull the first output URL (image or video) out of a prediction `data` dict. */
function extractFirstImageUrl(data: any): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  for (const key of ["outputs", "output", "image_results", "images", "videos"]) {
    const arr = data[key];
    if (typeof arr === "string" && /^https?:\/\//.test(arr)) return arr;
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      if (typeof first === "string" && /^https?:\/\//.test(first)) return first;
      if (first && typeof first === "object") {
        const nested = first.url || first.image_url || first.image || first.video_url;
        if (typeof nested === "string" && /^https?:\/\//.test(nested)) return nested;
      }
    }
  }
  return undefined;
}

/* ---------- end-to-end helper ---------- */

/**
 * Generate one image with Seedream 5.5 on AtlasCloud and return its URL.
 *
 * `images` are reference images (public URL or base64 data URI). With at
 * least one image the edit model is used; with none, the text-to-image
 * sibling. Throws on any failure so callers can refund credits.
 */
export async function atlasGenerateImage(args: {
  prompt: string;
  images?: string | string[] | null;
  /** App-level size; mapped to the nearest official preset. */
  size?: string | null;
}): Promise<string> {
  const refs = (Array.isArray(args.images) ? args.images : args.images ? [args.images] : [])
    .filter((x): x is string => typeof x === "string" && x.length > 0);
  if (refs.length > ATLAS_MAX_REFERENCE_IMAGES) {
    console.warn(`[Atlas] ${refs.length} reference images supplied, keeping the first ${ATLAS_MAX_REFERENCE_IMAGES}`);
  }
  const referenceImages = refs.slice(0, ATLAS_MAX_REFERENCE_IMAGES);

  const payload: Record<string, any> = {
    model: referenceImages.length > 0 ? ATLAS_EDIT_MODEL : ATLAS_T2I_MODEL,
    prompt: args.prompt,
    size: toAtlasSize(args.size),
    // Results are re-hosted as .jpg and never need an alpha channel.
    output_format: "jpeg",
  };
  if (referenceImages.length > 0) payload.reference_images = referenceImages;

  const predictionId = await atlasSubmitJob(payload);
  console.log(`[Atlas] submitted ${payload.model} prediction ${predictionId} (size ${payload.size}, refs ${referenceImages.length})`);
  const done = await atlasPollUntilDone(predictionId);
  const url = extractFirstImageUrl(done);
  if (!url) {
    throw new Error(`AtlasCloud 完成但無法擷取圖片 URL：${JSON.stringify(done).slice(0, 400)}`);
  }
  return url.replace(/&amp;/g, "&");
}

/* ---------- asset-library previews (cheap text-to-image) ---------- */

/**
 * Model for bulk asset-library preview images. Deliberately NOT Seedream: at
 * thousands of images the per-image price matters more than edit ability.
 */
export const ATLAS_LIBRARY_MODEL = process.env.LIBRARY_IMAGE_MODEL || "openai/gpt-image-2.5-flare/text-to-image";
/** List price per image when this was written (2026-11); shown as an estimate only. */
export const ATLAS_LIBRARY_PRICE_USD = 0.003;
const LIBRARY_IMAGE_QUALITY = process.env.LIBRARY_IMAGE_QUALITY || "medium";

/** One preview image from a text prompt. Returns the provider URL. */
export async function atlasGenerateLibraryImage(args: {
  prompt: string;
  /** "WIDTHxHEIGHT", e.g. "1024x1536". */
  size: string;
  transparent?: boolean;
}): Promise<string> {
  const payload: Record<string, any> = {
    model: ATLAS_LIBRARY_MODEL,
    prompt: args.prompt,
    quality: LIBRARY_IMAGE_QUALITY,
    size: args.size,
    background: args.transparent ? "transparent" : "opaque",
    output_format: "png",
    n: 1,
  };
  const predictionId = await atlasSubmitJob(payload);
  const done = await atlasPollUntilDone(predictionId, { timeoutMs: 5 * 60 * 1000, intervalMs: 3000 });
  const url = extractFirstImageUrl(done);
  if (!url) throw new Error("AtlasCloud 完成但無法擷取圖片 URL");
  return url.replace(/&amp;/g, "&");
}

/* ---------- video (Alibaba WAN 3.0) ---------- */

export const ATLAS_I2V_MODEL = "alibaba/wan-3.0/image-to-video";
export const ATLAS_T2V_MODEL = "alibaba/wan-3.0/text-to-video";
/** Friendly name for logs / UI. */
export const ATLAS_VIDEO_MODEL_LABEL = "WAN 3.0";

export type AtlasVideoResult = { videoUrl: string; predictionId: string; processingTime: number };

function wanResolution(r: string | null | undefined): string {
  return r === "720p" ? "720p" : r === "480p" ? "480p" : "1080p";
}

function wanDuration(d: number | null | undefined): number {
  return Math.max(2, Math.min(30, Math.round(d || 5)));
}

/** Submit a WAN job, poll until done, return the video URL. */
async function runWanVideo(payload: Record<string, any>): Promise<AtlasVideoResult> {
  const started = Date.now();
  const predictionId = await atlasSubmitJob(payload, "generateVideo");
  console.log(`[Atlas] submitted ${payload.model} prediction ${predictionId} (${payload.resolution}, ${payload.duration}s, ratio=${payload.ratio ?? "first-frame"}, last_image=${!!payload.last_image}, audio=${payload.audio})`);
  // Videos take minutes; allow 20 min with a 5 s poll interval.
  const done = await atlasPollUntilDone(predictionId, { timeoutMs: 20 * 60 * 1000, intervalMs: 5000 });
  const url = extractFirstImageUrl(done);
  if (!url) {
    throw new Error(`AtlasCloud 完成但無法擷取影片 URL：${JSON.stringify(done).slice(0, 400)}`);
  }
  return {
    videoUrl: url.replace(/&amp;/g, "&"),
    predictionId,
    processingTime: (Date.now() - started) / 1000,
  };
}

/**
 * Text-to-video with WAN 3.0 on AtlasCloud. Throws on any failure so callers
 * can refund credits.
 *
 *   POST {BASE}/api/v1/model/generateVideo
 *   body { model, prompt, resolution, duration, ratio, audio }
 *
 * WAN 3.0 takes no reference audio; `audio` only toggles the native track.
 */
export async function atlasGenerateTextVideo(args: {
  prompt: string;
  resolution?: string | null;
  /** Seconds, clamped to the model's 2–30 range. */
  duration?: number | null;
  /** "16:9" | "9:16" | "1:1" | "4:3" | "3:4"; anything else → "adaptive". */
  aspectRatio?: string | null;
  audio?: boolean;
}): Promise<AtlasVideoResult> {
  const ratio = ["16:9", "9:16", "1:1", "4:3", "3:4"].includes(args.aspectRatio || "")
    ? args.aspectRatio
    : "adaptive";
  return runWanVideo({
    model: ATLAS_T2V_MODEL,
    prompt: args.prompt,
    resolution: wanResolution(args.resolution),
    duration: wanDuration(args.duration),
    ratio,
    audio: args.audio ?? true,
  });
}

/**
 * Animate a first frame (optionally towards a last frame) with WAN 3.0 on
 * AtlasCloud and return the video URL. Throws on any failure so callers can
 * refund credits.
 *
 *   POST {BASE}/api/v1/model/generateVideo
 *   body { model, prompt, image, last_image?, resolution, duration, audio }
 *
 * `image` / `lastImage` must be PUBLIC URLs (the API does not document base64
 * input). There is no aspect-ratio parameter: the output follows the first
 * frame. WAN 3.0 takes no extra reference images and no reference audio.
 */
export async function atlasGenerateVideo(args: {
  prompt: string;
  image: string;
  lastImage?: string | null;
  resolution?: string | null;
  /** Seconds, clamped to the model's 2–30 range. */
  duration?: number | null;
  /** Native audio track. Same price either way; defaults to true. */
  audio?: boolean;
}): Promise<AtlasVideoResult> {
  if (!args.image) throw new Error("WAN 圖生影片需要首幀圖片");
  const payload: Record<string, any> = {
    model: ATLAS_I2V_MODEL,
    prompt: args.prompt,
    image: args.image,
    resolution: wanResolution(args.resolution),
    duration: wanDuration(args.duration),
    audio: args.audio ?? true,
  };
  if (args.lastImage) payload.last_image = args.lastImage;
  return runWanVideo(payload);
}

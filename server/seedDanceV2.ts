/**
 * SeedDance 2.0 Multi-Image Reference Video Client
 *
 * Supports:
 * 1. Single image mode (current standard image-to-video)
 * 2. Multi-image reference mode (全能模式): up to 9 reference images, @圖片1 @圖片2 syntax
 *
 * NOTE: The multi-image endpoint is a placeholder — user will supply the actual
 * volcengine_omni / SeedDance 2.0 omni endpoint when ready.
 */

import sharp from "sharp";

// ─── Endpoint configuration ───────────────────────────────────────────────────
// Standard single-image endpoint (already in production)
export const SEEDDANCE_STANDARD_ENDPOINT =
  process.env.ARK_VIDEO_MODEL || "ep-20250813120833-g4mpb";

// Multi-image "全能模式" endpoint — USER WILL PROVIDE THIS
// Set ARK_VIDEO_OMNI_MODEL env var once the endpoint is confirmed
export const SEEDDANCE_OMNI_ENDPOINT =
  process.env.ARK_VIDEO_OMNI_MODEL || SEEDDANCE_STANDARD_ENDPOINT;

export const VIDEO_API_BASE =
  "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SeedDanceImageRef {
  /** base64 data URI or CDN URL */
  url: string;
  /** role for multi-image mode. always "reference_image" for extra refs */
  role?: "reference_image" | "main_image";
}

export interface SeedDanceVideoRequest {
  /** text prompt (can contain @圖片1 @圖片2 … for multi-image mode) */
  prompt: string;
  /** main scene image (required for standard mode; included as first ref in omni mode) */
  mainImage?: SeedDanceImageRef;
  /** additional reference images for omni mode (charA, charB, style…) */
  referenceImages?: SeedDanceImageRef[];
  /** video duration 4–15 seconds */
  duration?: number;
  /** aspect ratio */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** resolution */
  resolution?: "720p" | "1080p";
  /** keep camera fixed */
  cameraFixed?: boolean;
  /** use omni (multi-image) mode instead of standard single-image mode */
  useOmniMode?: boolean;
}

export interface SeedDanceVideoResult {
  taskId: string;
  videoUrl: string;
  processingTime: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Auto-crop image buffer to an aspect ratio within the allowed [0.40, 2.50] range
 * that SeedDance expects.
 */
async function normalizeImageBuffer(input: Buffer): Promise<Buffer> {
  const MIN_RATIO = 0.4;
  const MAX_RATIO = 2.5;
  const meta = await sharp(input).metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;
  const ratio = w / h;

  if (ratio > MAX_RATIO) {
    const newW = Math.floor(h * MAX_RATIO);
    const offsetX = Math.floor((w - newW) / 2);
    return sharp(input).extract({ left: offsetX, top: 0, width: newW, height: h }).jpeg().toBuffer();
  }
  if (ratio < MIN_RATIO) {
    const newH = Math.floor(w / MIN_RATIO);
    const offsetY = Math.floor((h - newH) / 2);
    return sharp(input).extract({ left: 0, top: offsetY, width: w, height: newH }).jpeg().toBuffer();
  }
  return input;
}

/**
 * Fetch a URL and convert to normalised base64 data URI.
 */
export async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const normalised = await normalizeImageBuffer(buf);
  return `data:image/jpeg;base64,${normalised.toString("base64")}`;
}

/**
 * Convert a raw Buffer to normalised base64 data URI.
 */
export async function bufferToBase64(buf: Buffer): Promise<string> {
  const normalised = await normalizeImageBuffer(buf);
  return `data:image/jpeg;base64,${normalised.toString("base64")}`;
}

// ─── Core client ─────────────────────────────────────────────────────────────

/**
 * Submit a SeedDance video generation task and poll until it completes.
 * Returns the video URL.
 */
export async function generateSeedDanceVideo(
  req: SeedDanceVideoRequest
): Promise<SeedDanceVideoResult> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("ARK_API_KEY environment variable is not set");

  const model = req.useOmniMode ? SEEDDANCE_OMNI_ENDPOINT : SEEDDANCE_STANDARD_ENDPOINT;

  // ── Build content array ───────────────────────────────────────────────────
  const contentItems: any[] = [];

  if (req.useOmniMode) {
    // Omni / multi-image mode:
    // Images go first (mainImage as first ref, then additional refs), then prompt text.
    // Prompt can reference images as @圖片1, @圖片2 … matching insertion order.
    if (req.mainImage) {
      contentItems.push({
        type: "image_url",
        image_url: { url: req.mainImage.url },
        role: "reference_image",
      });
    }
    for (const ref of req.referenceImages ?? []) {
      contentItems.push({
        type: "image_url",
        image_url: { url: ref.url },
        role: "reference_image",
      });
    }
    // Build prompt with flags
    let promptText = req.prompt;
    if (req.duration) promptText += ` --duration ${req.duration}`;
    if (req.cameraFixed !== undefined) promptText += ` --camerafixed ${req.cameraFixed}`;
    if (req.resolution) promptText += ` --resolution ${req.resolution}`;
    if (req.aspectRatio) promptText += ` --ratio ${req.aspectRatio}`;
    contentItems.push({ type: "text", text: promptText });
  } else {
    // Standard mode: text first, then optional main image
    let promptText = req.prompt;
    if (req.duration) promptText += ` --duration ${req.duration}`;
    if (req.cameraFixed !== undefined) promptText += ` --camerafixed ${req.cameraFixed}`;
    if (req.resolution) promptText += ` --resolution ${req.resolution}`;
    if (req.aspectRatio) promptText += ` --ratio ${req.aspectRatio}`;
    contentItems.push({ type: "text", text: promptText });

    if (req.mainImage) {
      contentItems.push({
        type: "image_url",
        image_url: { url: req.mainImage.url },
      });
    }
  }

  // ── Create task ───────────────────────────────────────────────────────────
  const startTime = Date.now();
  const createRes = await fetch(VIDEO_API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, content: contentItems }),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`SeedDance API error ${createRes.status}: ${errorText}`);
  }

  const createResult = await createRes.json();
  const taskId: string = createResult.id;
  if (!taskId) throw new Error("SeedDance: no task ID returned");

  console.log(`[SeedDance] Task created: ${taskId} | model=${model} | omni=${!!req.useOmniMode}`);

  // ── Poll for result ───────────────────────────────────────────────────────
  const MAX_ATTEMPTS = 180;
  let videoUrl: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, 5000));

    const pollRes = await fetch(`${VIDEO_API_BASE}/${taskId}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!pollRes.ok) {
      console.warn(`[SeedDance] Poll ${attempt} failed: ${pollRes.status}`);
      continue;
    }

    const poll = await pollRes.json();
    console.log(`[SeedDance] Poll ${attempt}: status=${poll.status}`);

    if (poll.status === "succeeded") {
      if (poll.content?.video_url && typeof poll.content.video_url === "string") {
        videoUrl = poll.content.video_url.replace(/&amp;/g, "&");
      } else if (Array.isArray(poll.content)) {
        for (const item of poll.content) {
          if (item.type === "video_url" && item.video_url?.url) {
            videoUrl = item.video_url.url.replace(/&amp;/g, "&");
            break;
          }
        }
      }
      break;
    } else if (poll.status === "failed") {
      throw new Error(poll.error?.message || "SeedDance: task failed");
    }
  }

  if (!videoUrl) throw new Error("SeedDance: timed out or no video URL returned");

  return {
    taskId,
    videoUrl,
    processingTime: (Date.now() - startTime) / 1000,
  };
}

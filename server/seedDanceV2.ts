/**
 * SeedDance 2.0 Multi-Image Reference Video Client
 *
 * API endpoint: ep-20260428161232-4znch (全能模式)
 * API format:
 *   POST /api/v3/contents/generations/tasks
 *   Body: { model, content[], ratio, duration, generate_audio, watermark }
 *
 * content items:
 *   { type: "text", text }
 *   { type: "image_url", image_url: { url }, role: "reference_image" }
 *   { type: "video_url", video_url: { url }, role: "reference_video" }
 *   { type: "audio_url", audio_url: { url }, role: "reference_audio" }
 */

import sharp from "sharp";
import { enhanceVideoPrompt } from "./promptEnhancer";

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const SEEDDANCE_STANDARD_ENDPOINT =
  process.env.ARK_VIDEO_MODEL || "ep-20250813120833-g4mpb";

export const SEEDDANCE_OMNI_ENDPOINT =
  process.env.ARK_VIDEO_OMNI_MODEL || "ep-20260428161232-4znch";

export const VIDEO_API_BASE =
  "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SeedDanceImageRef {
  url: string;
}

export interface SeedDanceVideoRef {
  url: string;
}

export interface SeedDanceAudioRef {
  url: string;
}

export interface SeedDanceVideoRequest {
  /** Text prompt describing the video */
  prompt: string;
  /** Primary scene image (used in both standard and omni mode) */
  mainImage?: SeedDanceImageRef;
  /** Extra reference images for omni mode (charA, charB, style…) */
  referenceImages?: SeedDanceImageRef[];
  /** Optional reference video for omni mode */
  referenceVideo?: SeedDanceVideoRef;
  /** Optional reference audio for omni mode */
  referenceAudio?: SeedDanceAudioRef;
  /** Video duration in seconds (4–15) */
  duration?: number;
  /** Aspect ratio — passed as top-level field */
  aspectRatio?: "16:9" | "9:16" | "1:1";
  /** Whether to generate AI audio. Default true for omni, false for standard */
  generateAudio?: boolean;
  /** Use omni multi-image endpoint */
  useOmniMode?: boolean;
}

export interface SeedDanceVideoResult {
  taskId: string;
  videoUrl: string;
  processingTime: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

export async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const normalised = await normalizeImageBuffer(buf);
  return `data:image/jpeg;base64,${normalised.toString("base64")}`;
}

export async function bufferToBase64(buf: Buffer): Promise<string> {
  const normalised = await normalizeImageBuffer(buf);
  return `data:image/jpeg;base64,${normalised.toString("base64")}`;
}

// ─── Core client ─────────────────────────────────────────────────────────────

export async function generateSeedDanceVideo(
  req: SeedDanceVideoRequest
): Promise<SeedDanceVideoResult> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("ARK_API_KEY environment variable is not set");

  const isOmni = req.useOmniMode ?? false;
  const model = isOmni ? SEEDDANCE_OMNI_ENDPOINT : SEEDDANCE_STANDARD_ENDPOINT;

  // 強制套用 NSFW 提示詞增強器（防呆：即使呼叫端忘了包，也保證 API 收到的是增強版）
  // enhanceVideoPrompt 是 idempotent — 已包過的 prompt 不會被重複包
  const enhancedPrompt = enhanceVideoPrompt(req.prompt);

  // ── Build content array ────────────────────────────────────────────────────
  const contentItems: any[] = [];

  if (isOmni) {
    // Omni mode: text prompt first, then all reference images, optional video/audio refs
    contentItems.push({ type: "text", text: enhancedPrompt });

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

    if (req.referenceVideo) {
      contentItems.push({
        type: "video_url",
        video_url: { url: req.referenceVideo.url },
        role: "reference_video",
      });
    }

    if (req.referenceAudio) {
      contentItems.push({
        type: "audio_url",
        audio_url: { url: req.referenceAudio.url },
        role: "reference_audio",
      });
    }
  } else {
    // Standard mode: text first, then main image (no extra refs)
    contentItems.push({ type: "text", text: enhancedPrompt });

    if (req.mainImage) {
      contentItems.push({
        type: "image_url",
        image_url: { url: req.mainImage.url },
      });
    }
  }

  // ── Build request body ─────────────────────────────────────────────────────
  const body: any = {
    model,
    content: contentItems,
    watermark: false,
  };

  // ratio, duration, generate_audio are top-level fields (new API format)
  if (req.aspectRatio) body.ratio = req.aspectRatio;
  if (req.duration) body.duration = req.duration;
  if (isOmni) {
    body.generate_audio = req.generateAudio ?? true;
  }

  // ── Submit task ────────────────────────────────────────────────────────────
  const startTime = Date.now();
  console.log(`[SeedDance] Submitting task | model=${model} | omni=${isOmni} | ratio=${req.aspectRatio} | duration=${req.duration}s`);

  const createRes = await fetch(VIDEO_API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(`SeedDance API error ${createRes.status}: ${errorText}`);
  }

  const createResult = await createRes.json();
  const taskId: string = createResult.id;
  if (!taskId) throw new Error(`SeedDance: no task ID returned. Response: ${JSON.stringify(createResult)}`);

  console.log(`[SeedDance] Task created: ${taskId}`);

  // ── Poll for result ────────────────────────────────────────────────────────
  const MAX_ATTEMPTS = 180; // 15 minutes max (5s intervals)
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
      // Extract video URL from response
      if (poll.content?.video_url && typeof poll.content.video_url === "string") {
        videoUrl = poll.content.video_url.replace(/&amp;/g, "&");
      } else if (Array.isArray(poll.content)) {
        for (const item of poll.content) {
          if (item.type === "video_url" && item.video_url?.url) {
            videoUrl = item.video_url.url.replace(/&amp;/g, "&");
            break;
          }
        }
      } else if (poll.content?.video?.url) {
        videoUrl = poll.content.video.url.replace(/&amp;/g, "&");
      }
      break;
    } else if (poll.status === "failed") {
      throw new Error(poll.error?.message || `SeedDance: task ${taskId} failed`);
    }
  }

  if (!videoUrl) throw new Error("SeedDance: timed out waiting for video");

  return {
    taskId,
    videoUrl,
    processingTime: (Date.now() - startTime) / 1000,
  };
}

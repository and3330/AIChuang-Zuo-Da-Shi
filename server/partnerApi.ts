/**
 * Partner (server-to-server) API — /api/v1/partner/*
 *
 * Lets another backend (客戶小鎮) create images, videos and photo sets with a
 * service token instead of a browser session. It reuses the website's own
 * generation pipeline: this module only authenticates, validates, charges
 * credits, creates the same generation rows the website creates and hands
 * them to the same workers.
 *
 * Everything this module needs is injected through `PartnerDeps`, so the
 * HTTP behaviour can be exercised with in-memory fakes
 * (scripts/test-partner-api.ts) without a database or the image provider.
 *
 * Rules that must hold here:
 *   - A token is only ever compared by SHA-256; the clear text is shown once
 *     at creation and never logged.
 *   - Requests carrying an Origin header (browsers) are refused.
 *   - All validation happens before credits are deducted.
 *   - The NSFW prompt enhancer is OFF unless the token allows it AND the
 *     request asks for it.
 *   - Result URLs are always our CDN URLs, never provider or /objects/ URLs.
 *   - Errors are { error, code } with no stack, key or internal path.
 *   - AI characters belong to one owner_ref (a partner-side workspace). Every
 *     character lookup goes through loadCharacter(), which answers 404 for a
 *     character of another owner_ref or another account.
 *   - Anything involving a character never uses the NSFW prompt enhancer.
 */

import { IMAGE_COST } from "@shared/pricing";
import type { Express, Request, Response, NextFunction } from "express";
import { createHash, randomBytes, randomUUID } from "crypto";
import { z } from "zod";
import { CHARACTER_PACK_MAX_IMAGES, type ImageGeneration, type VideoGeneration, type PartnerToken, type PartnerJob, type PartnerCharacter, type FourViewUrls } from "@shared/schema";
import { FOUR_VIEW_PRESETS, FOUR_VIEW_SIZE, fourViewPrompt } from "@shared/fourViews";
import { IMAGE_RATIOS, IMAGE_TIERS } from "@shared/imageSizes";
import { PHOTO_LOOKS, POSES, photoLookSuffix, poseById, referenceNote, type PhotoLookId } from "@shared/photosetOptions";

/* ───────────────────────── pricing (keep in sync with routes.ts) ───────────────────────── */

export const PARTNER_PRICING = {
  // The partner API keeps its own prices; site price changes do not move them.
  imageWithWatermark: 5,
  imageWithoutWatermark: 6,
  videoPerSecond: { "720p": 8, "1080p": 15 } as Record<string, number>,
  videoDuration: { min: 4, max: 12, default: 5 },
  imageCount: { min: 1, max: 4 },
  photosetCount: { min: 2, max: 10 },
  maxReferenceImages: 10,
  photosetMaxReferenceImages: 9,
};

export const PARTNER_CHARACTERS = {
  minReferenceImages: 3,
  maxReferenceImages: CHARACTER_PACK_MAX_IMAGES,
  /** Counted per owner_ref, not per account. */
  maxPerOwner: 50,
  /** character_ids per images / photosets request (videos: 1). */
  maxPerRequest: 3,
  /** Reference images taken from one character per generation. */
  maxImagesPerCharacter: 4,
  fourViewCost: FOUR_VIEW_PRESETS.length * IMAGE_COST,
};

export type PartnerUploadFormat = "jpg" | "png" | "webp";
export const PARTNER_UPLOAD = {
  maxBytes: 10 * 1024 * 1024,
  formats: ["jpg", "png", "webp"] as PartnerUploadFormat[],
  /** Per owner_ref, on top of the token's own per-minute limit. */
  perOwnerPerMinute: 30,
  minSidePixels: 256,
};

/* ───────────────────────── dependencies ───────────────────────── */

export type PartnerJobCreate = {
  tokenId: string;
  userId: string;
  type: "image" | "video" | "photoset" | "four_views";
  ownerRef?: string | null;
  characterIds?: string[];
  requestedCount: number;
  externalRef: string | null;
  idempotencyKey: string | null;
  requestHash: string;
  meta: Record<string, any>;
};

export interface PartnerStore {
  findTokenByHash(hash: string): Promise<PartnerToken | undefined>;
  touchToken(id: string): Promise<void>;
  listTokens(): Promise<PartnerToken[]>;
  createToken(data: {
    name: string; userId: string; tokenHash: string; tokenPrefix: string; allowNsfw: boolean;
    rateLimitPerMinute: number; dailyImageLimit: number | null; dailyVideoLimit: number | null; createdBy: string | null;
  }): Promise<PartnerToken>;
  updateToken(id: string, updates: Partial<Pick<PartnerToken, "name" | "allowNsfw" | "rateLimitPerMinute" | "dailyImageLimit" | "dailyVideoLimit">>): Promise<PartnerToken | undefined>;
  revokeToken(id: string): Promise<PartnerToken | undefined>;

  /** Must throw PartnerIdempotencyRace when (tokenId, idempotencyKey) already exists. */
  createJob(data: PartnerJobCreate): Promise<PartnerJob>;
  getJob(id: string): Promise<PartnerJob | undefined>;
  findJobByIdempotencyKey(tokenId: string, key: string): Promise<PartnerJob | undefined>;
  clearIdempotencyKey(jobId: string): Promise<void>;
  updateJob(id: string, updates: Partial<PartnerJob>): Promise<void>;
  deleteJob(id: string): Promise<void>;

  createCharacter(data: {
    userId: string; tokenId: string; ownerRef: string; name: string; description: string; styleHint: string;
    refImageUrls: string[]; consentAt: Date;
  }): Promise<PartnerCharacter>;
  getCharacter(id: string): Promise<PartnerCharacter | undefined>;
  /** Only characters of this account AND this owner_ref. */
  listCharacters(userId: string, ownerRef: string): Promise<PartnerCharacter[]>;
  updateCharacter(id: string, updates: Partial<PartnerCharacter>): Promise<PartnerCharacter | undefined>;
  deleteCharacter(id: string): Promise<void>;
  adminListCharacters(filter: { ownerRef?: string; id?: string }): Promise<PartnerCharacter[]>;
}

export class PartnerIdempotencyRace extends Error {}

export type PartnerDeps = {
  store: PartnerStore;
  core: {
    getUser(id: string): Promise<{ id: string; credits: number | null; username?: string | null } | undefined>;
    getUserByEmail(email: string): Promise<{ id: string } | undefined>;
    /** Throws when the balance is insufficient. */
    atomicDeductCredits(userId: string, amount: number, description: string): Promise<{ newBalance: number }>;
    atomicAddCredits(userId: string, amount: number, description: string): Promise<void>;
    createImageGeneration(data: Record<string, any>): Promise<ImageGeneration>;
    getImageGeneration(id: string): Promise<ImageGeneration | undefined>;
    createVideoGeneration(data: Record<string, any>): Promise<VideoGeneration>;
    getVideoGeneration(id: string): Promise<VideoGeneration | undefined>;
    getUserDailyImageCount(userId: string): Promise<number>;
    getUserDailyVideoCount(userId: string): Promise<number>;
  };
  /** Start the website's own workers (fire and forget). */
  runImage(generationId: string, opts: { rawPrompt: boolean }): void;
  runVideo(generationId: string, opts: { rawPrompt: boolean }): void;
  /** SSRF-guarded download of a public https image, re-hosted on our CDN. Returns the CDN URL. */
  ingestImage(url: string, folder: string): Promise<string>;
  /** Verify + strip metadata + store an uploaded image. Throws PartnerUploadError for bad files. */
  storeUpload(input: { buffer: Buffer; format: PartnerUploadFormat; folder: string }): Promise<{ url: string; width: number; height: number }>;
  /** True when the URL is on our own CDN. */
  isCdnUrl(url: string): boolean;
  /** Delete a file from our CDN by URL. Resolves false when it could not be deleted. */
  deleteStored(url: string): Promise<boolean>;
  /** False when the CDN is not configured (results could not be returned). */
  storageReady(): boolean;
  /** Same planner as POST /api/photosets/plan. */
  planPhotoset(input: Record<string, any>): Promise<{ analysis: string; shots: { title: string; prompt: string }[] }>;
  /** Width/height an app-level image size resolves to. */
  sizeDimensions(size: string): { width: number; height: number };
  /** Rewrites storage URLs to the public CDN host. */
  cdnUrl(url: string | null | undefined): string | null | undefined;
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
  now?: () => number;
};

/* ───────────────────────── errors ───────────────────────── */

export class PartnerError extends Error {
  constructor(public status: number, public code: string, message: string, public headers: Record<string, string> = {}) {
    super(message);
  }
}

/** An ingest failure the caller can fix (bad URL, not an image, too large…). */
export class PartnerIngestError extends Error {
  constructor(public code: "invalid_image_url" | "image_download_failed", message: string) {
    super(message);
  }
}

/** A rejected upload (wrong type, unreadable, too small). */
export class PartnerUploadError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function sendError(res: Response, e: unknown) {
  if (e instanceof PartnerError) {
    for (const [k, v] of Object.entries(e.headers)) res.setHeader(k, v);
    return res.status(e.status).json({ error: e.message, code: e.code });
  }
  // Never echo unexpected error text: it may contain provider or path details.
  console.error("[Partner] unexpected error:", e instanceof Error ? e.message : "unknown");
  return res.status(500).json({ error: "伺服器發生錯誤，請稍後再試。", code: "internal_error" });
}

/* ───────────────────────── tokens ───────────────────────── */

export const PARTNER_TOKEN_PREFIX = "ptk_";

export function hashPartnerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generatePartnerToken(): { token: string; hash: string; prefix: string } {
  const token = PARTNER_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashPartnerToken(token), prefix: token.slice(0, 10) };
}

/* ───────────────────────── rate limiting (in-memory, per process) ───────────────────────── */

class SlidingWindow {
  private hits = new Map<string, number[]>();
  constructor(private windowMs: number) {}
  /** Returns 0 when allowed, otherwise seconds until the next request may be made. */
  take(key: string, limit: number, now: number): number {
    const arr = (this.hits.get(key) ?? []).filter(t => now - t < this.windowMs);
    if (arr.length >= limit) {
      this.hits.set(key, arr);
      return Math.max(1, Math.ceil((arr[0] + this.windowMs - now) / 1000));
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 5000) {
      this.hits.forEach((v, k) => {
        if (v.every((t: number) => now - t >= this.windowMs)) this.hits.delete(k);
      });
    }
    return 0;
  }
}

/** Read endpoints (job polling, balance, pricing) get this many times the write allowance. */
const READ_RATE_MULTIPLIER = 10;
const FAILED_AUTH_PER_MINUTE = 20;

/* ───────────────────────── validation ───────────────────────── */

const IMAGE_SIZE_VALUES = IMAGE_RATIOS.flatMap(r => IMAGE_TIERS.map(t => `${r.sizes[t.id][0]}x${r.sizes[t.id][1]}`));
const LOOK_IDS = PHOTO_LOOKS.map(l => l.id) as [PhotoLookId, ...PhotoLookId[]];

const httpsUrl = z.string().max(2000).refine((u) => {
  try { return new URL(u).protocol === "https:"; } catch { return false; }
}, "必須是 https 公開網址");

const externalRef = z.string().max(200).optional();
const ownerRefField = z.string().regex(/^[\x21-\x7e]{1,100}$/, "owner_ref 必須是 1–100 個不含空白的英數或符號字元");
const idField = z.string().regex(/^[0-9a-fA-F-]{8,64}$/, "代號格式不正確");
const characterIdsField = (max: number) => z.array(idField).max(max, `character_ids 最多 ${max} 個`).optional().default([]);
function requireOwnerForCharacters(v: { owner_ref?: string; character_ids: string[] }, ctx: z.RefinementCtx) {
  if (v.character_ids.length > 0 && !v.owner_ref) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["owner_ref"], message: "使用 character_ids 時必須提供 owner_ref" });
  }
  if (new Set(v.character_ids).size !== v.character_ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["character_ids"], message: "character_ids 不可重複" });
  }
}
const promptField = z.string().trim().min(1, "prompt 不可為空").max(4000, "prompt 過長（上限 4000 字）");
const imageSizeField = z.string().refine(v => IMAGE_SIZE_VALUES.includes(v), "size 必須是 /pricing 列出的尺寸之一").default("2048x2048");

const imageBody = z.object({
  prompt: promptField,
  size: imageSizeField,
  reference_image_urls: z.array(httpsUrl).max(PARTNER_PRICING.maxReferenceImages).optional().default([]),
  count: z.number().int().min(PARTNER_PRICING.imageCount.min).max(PARTNER_PRICING.imageCount.max).optional().default(1),
  watermark: z.boolean().optional().default(false),
  nsfw: z.boolean().optional().default(false),
  external_ref: externalRef,
  owner_ref: ownerRefField.optional(),
  character_ids: characterIdsField(PARTNER_CHARACTERS.maxPerRequest),
}).strict().superRefine(requireOwnerForCharacters);

const videoBody = z.object({
  type: z.enum(["image-to-video", "text-to-video"]),
  prompt: promptField,
  image_url: httpsUrl.optional(),
  duration: z.number().int().min(PARTNER_PRICING.videoDuration.min).max(PARTNER_PRICING.videoDuration.max).optional().default(PARTNER_PRICING.videoDuration.default),
  ratio: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9"),
  quality: z.enum(["720p", "1080p"]).optional().default("1080p"),
  nsfw: z.boolean().optional().default(false),
  external_ref: externalRef,
  owner_ref: ownerRefField.optional(),
  /** WAN takes one first frame, so a video can use one character. */
  character_ids: characterIdsField(1),
}).strict().superRefine((v, ctx) => {
  requireOwnerForCharacters(v, ctx);
  if (v.type === "image-to-video" && !v.image_url && v.character_ids.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["image_url"], message: "image-to-video 必須提供 image_url，或用 character_ids 指定角色作為首幀" });
  }
  if (v.type === "text-to-video" && v.character_ids.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["character_ids"], message: "text-to-video 無法帶入角色參考圖；要用角色請改用 image-to-video" });
  }
  if (v.type === "text-to-video" && v.image_url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["image_url"], message: "text-to-video 不接受 image_url" });
  }
});

const photosetBody = z.object({
  mode: z.enum(["scene", "character"]),
  scene_image_url: httpsUrl.optional(),
  reference_image_urls: z.array(httpsUrl).max(PARTNER_PRICING.photosetMaxReferenceImages).optional().default([]),
  quality_style: z.enum(LOOK_IDS).optional().default("natural"),
  poses: z.array(z.string().max(60)).max(PARTNER_PRICING.photosetCount.max).optional().default([]),
  count: z.number().int().min(PARTNER_PRICING.photosetCount.min).max(PARTNER_PRICING.photosetCount.max).optional().default(6),
  size: z.string().refine(v => IMAGE_SIZE_VALUES.includes(v), "size 必須是 /pricing 列出的尺寸之一").optional().default("1776x2368"),
  /** character mode only: "preset" = fixed nine-shot sheet, no AI planning. */
  planner: z.enum(["ai", "preset"]).optional().default("ai"),
  outfit_from: z.enum(["character", "scene"]).optional().default("character"),
  direction: z.string().max(500).optional(),
  watermark: z.boolean().optional().default(false),
  nsfw: z.boolean().optional().default(false),
  external_ref: externalRef,
  owner_ref: ownerRefField.optional(),
  character_ids: characterIdsField(PARTNER_CHARACTERS.maxPerRequest),
}).strict().superRefine((v, ctx) => {
  requireOwnerForCharacters(v, ctx);
  if (v.mode === "scene" && !v.scene_image_url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scene_image_url"], message: "mode 為 scene 時必須提供 scene_image_url" });
  }
  if (v.mode === "character" && v.scene_image_url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scene_image_url"], message: "mode 為 character 時不接受 scene_image_url" });
  }
  if (v.mode === "character" && v.reference_image_urls.length === 0 && v.character_ids.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reference_image_urls"], message: "mode 為 character 時至少需要一張 reference_image_urls 或一個 character_ids" });
  }
  const unknown = v.poses.filter(id => !poseById(id));
  if (unknown.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["poses"], message: `未知的姿勢代號：${unknown.slice(0, 5).join("、")}` });
  }
  if (v.poses.length === 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["poses"], message: "poses 至少需要 2 個，或不要提供" });
  }
});

function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.output<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const detail = r.error.issues
      .slice(0, 5)
      .map(i => (i.code === "unrecognized_keys" ? `不支援的欄位：${(i as any).keys.join("、")}` : `${i.path.join(".") || "內容"}：${i.message}`))
      .join("；");
    throw new PartnerError(400, "invalid_request", `請求內容有誤：${detail}`);
  }
  return r.data;
}

const refUrlList = (min: number, max: number) => z.array(httpsUrl).min(min, `至少需要 ${min} 張`).max(max, `最多 ${max} 張`);
const characterText = { name: z.string().trim().min(1, "name 不可為空").max(60), description: z.string().trim().max(1000), style_hint: z.string().trim().max(200) };

const createCharacterBody = z.object({
  owner_ref: ownerRefField,
  name: characterText.name,
  description: characterText.description.optional().default(""),
  style_hint: characterText.style_hint.optional().default(""),
  reference_image_urls: refUrlList(PARTNER_CHARACTERS.minReferenceImages, PARTNER_CHARACTERS.maxReferenceImages),
  /** Must be true: the partner confirmed likeness consent with its customer. */
  consent: z.boolean().optional(),
}).strict();

const patchCharacterBody = z.object({
  owner_ref: ownerRefField,
  name: characterText.name.optional(),
  description: characterText.description.optional(),
  style_hint: characterText.style_hint.optional(),
  add_reference_image_urls: z.array(httpsUrl).max(PARTNER_CHARACTERS.maxReferenceImages).optional().default([]),
  remove_reference_image_urls: z.array(z.string().max(2000)).max(PARTNER_CHARACTERS.maxReferenceImages).optional().default([]),
}).strict();

const ownerOnlyBody = z.object({ owner_ref: ownerRefField }).strict();

/* ───────────────────────── uploads ───────────────────────── */

/** The real file type from its first bytes; the name and declared type are ignored. */
export function sniffImageFormat(buf: Buffer): PartnerUploadFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

function readRawBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new PartnerError(413, "file_too_large", `檔案過大：單檔上限 ${Math.round(PARTNER_UPLOAD.maxBytes / 1024 / 1024)} MB。`);
    if (Number(req.headers["content-length"] || 0) > maxBytes) { req.resume(); return reject(tooLarge()); }
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) { settled = true; reject(tooLarge()); return; }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    req.on("error", () => { if (!settled) { settled = true; reject(new PartnerError(400, "invalid_request", "上傳中斷，請重試。")); } });
  });
}

/** Minimal multipart/form-data reader: text fields and file parts, all in memory. */
function parseMultipart(body: Buffer, contentType: string): { fields: Record<string, string>; files: Record<string, Buffer> } {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = m?.[1] ?? m?.[2];
  if (!boundary) throw new PartnerError(400, "invalid_request", "請用 multipart/form-data 上傳。");
  const delim = Buffer.from("--" + boundary);
  const fields: Record<string, string> = {};
  const files: Record<string, Buffer> = {};
  let pos = body.indexOf(delim);
  while (pos !== -1) {
    const start = pos + delim.length;
    if (body.toString("latin1", start, start + 2) === "--") break;
    const next = body.indexOf(delim, start);
    if (next === -1) break;
    const part = body.subarray(start + 2, next - 2); // drop the CRLF after the boundary and before the next one
    const headEnd = part.indexOf("\r\n\r\n");
    if (headEnd !== -1) {
      const head = part.toString("utf8", 0, headEnd);
      const name = /\bname="([^"]*)"/i.exec(head)?.[1];
      const data = part.subarray(headEnd + 4);
      if (name) {
        if (/\bfilename="/i.test(head)) files[name] = data;
        else fields[name] = data.toString("utf8");
      }
    }
    pos = next;
  }
  return { fields, files };
}

/* ───────────────────────── characters ───────────────────────── */

function fourViewList(v: FourViewUrls | null | undefined): string[] {
  const f = v ?? {};
  return [f.front, f.threeQuarter, f.side, f.back].filter((u): u is string => !!u);
}

/** Reference images a generation takes from one character: four views first (front leading), else its photos. */
function characterReferenceImages(c: PartnerCharacter, max: number): string[] {
  const views = fourViewList(c.fourViewUrls as FourViewUrls | null);
  return (views.length > 0 ? views : c.refImageUrls ?? []).slice(0, max);
}

function characterView(c: PartnerCharacter) {
  const v = (c.fourViewUrls ?? {}) as FourViewUrls;
  return {
    id: c.id,
    owner_ref: c.ownerRef,
    name: c.name,
    description: c.description ?? "",
    style_hint: c.styleHint ?? "",
    reference_image_urls: c.refImageUrls ?? [],
    /** front, three-quarter, side, back — only the ones that exist. */
    four_view_urls: fourViewList(v),
    four_views: { front: v.front ?? null, three_quarter: v.threeQuarter ?? null, side: v.side ?? null, back: v.back ?? null },
    four_view_status: c.fourViewStatus ?? "idle",
    disabled: !!c.disabledAt,
    created_at: c.createdAt ? new Date(c.createdAt).toISOString() : null,
  };
}

/* ───────────────────────── job presentation ───────────────────────── */

type JobStatus = "queued" | "processing" | "succeeded" | "failed";

/** Map an internal failure message to text that is safe to show a partner. */
function publicFailure(message: string | null | undefined): { error: string; code: string } {
  const m = (message || "").toLowerCase();
  if (m.includes("sensitive") || m.includes("敏感") || m.includes("content") && m.includes("policy") || m.includes("審查") || m.includes("moderation")) {
    return { error: "內容未通過安全審查，請調整提示詞或更換圖片後再試。", code: "content_rejected" };
  }
  if (m.includes("逾時") || m.includes("timeout") || m.includes("timed out") || m.includes("超時")) {
    return { error: "生成逾時，積分已退回，請稍後再試。", code: "generation_timeout" };
  }
  return { error: "生成失敗，積分已退回，請稍後再試。", code: "generation_failed" };
}

function videoDimensions(resolution: string | null | undefined, ratio: string | null | undefined) {
  const short = resolution === "720p" ? 720 : 1080;
  const long = resolution === "720p" ? 1280 : 1920;
  if (ratio === "9:16") return { width: short, height: long };
  if (ratio === "1:1") return { width: short, height: short };
  return { width: long, height: short };
}

async function describeJob(job: PartnerJob, deps: PartnerDeps) {
  const meta = (job.meta ?? {}) as Record<string, any>;
  const ids = job.generationIds ?? [];
  const results: Array<{ url: string; type: "image" | "video"; width: number; height: number }> = [];
  let refunded = job.creditsRefundedExtra ?? 0;
  let failure: { error: string; code: string } | null = null;
  let finishedAt: Date | null = job.finishedAt ?? null;
  let status: JobStatus;

  if (job.phase === "failed") {
    status = "failed";
    failure = { error: job.error || "任務失敗，積分已退回。", code: job.errorCode || "generation_failed" };
  } else if (ids.length === 0) {
    status = job.phase === "planning" ? "processing" : "queued";
  } else {
    let pending = 0;
    let running = 0;
    let latest = 0;
    if (job.type === "video") {
      for (const id of ids) {
        const g = await deps.core.getVideoGeneration(id);
        if (!g) { failure = failure ?? publicFailure(null); continue; }
        latest = Math.max(latest, g.updatedAt ? new Date(g.updatedAt).getTime() : 0);
        if (g.status === "pending") pending++;
        else if (g.status === "processing") running++;
        else if (g.status === "failed") {
          refunded += g.creditsUsed ?? 0;
          failure = failure ?? publicFailure(g.errorMessage);
        } else if (g.status === "completed") {
          const url = deps.cdnUrl(g.bunnyVideoUrl);
          if (url) results.push({ url, type: "video", ...videoDimensions(g.resolution, g.aspectRatio) });
          else failure = failure ?? { error: "影片已生成但轉存失敗，請聯絡客服處理。", code: "storage_failed" };
        }
      }
    } else {
      const dims = { width: Number(meta.width) || 0, height: Number(meta.height) || 0 };
      for (const id of ids) {
        const g = await deps.core.getImageGeneration(id);
        if (!g) { failure = failure ?? publicFailure(null); continue; }
        latest = Math.max(latest, g.updatedAt ? new Date(g.updatedAt).getTime() : 0);
        if (g.status === "pending") pending++;
        else if (g.status === "processing") running++;
        else if (g.status === "failed") {
          refunded += g.creditsUsed ?? 0;
          failure = failure ?? publicFailure(g.errorMessage);
        } else if (g.status === "completed") {
          const wanted = Math.max(1, g.maxImages ?? 1);
          const made = g.generatedImageUrls?.length ? g.generatedImageUrls.length : 1;
          // Multi-image rows are pre-charged for `wanted`; the worker refunds the shortfall.
          if (wanted > 1 && made < wanted) refunded += Math.floor((g.creditsUsed ?? 0) / wanted) * (wanted - made);
          const urls = (g.bunnyImageUrls?.length ? g.bunnyImageUrls : g.bunnyImageUrl ? [g.bunnyImageUrl] : [])
            .map(u => deps.cdnUrl(u))
            .filter((u): u is string => !!u);
          if (urls.length === 0) failure = failure ?? { error: "圖片已生成但轉存失敗，請聯絡客服處理。", code: "storage_failed" };
          for (const url of urls) results.push({ url, type: "image", ...dims });
        }
      }
    }
    if (pending + running > 0) {
      status = running > 0 || results.length > 0 || failure ? "processing" : "queued";
      failure = null; // only report an error once the job is finished
    } else {
      status = results.length > 0 ? "succeeded" : "failed";
      if (status === "succeeded") failure = null;
      else failure = failure ?? publicFailure(null);
      finishedAt = finishedAt ?? (latest ? new Date(latest) : new Date());
    }
  }

  return {
    job_id: job.id,
    type: job.type,
    status,
    results: status === "succeeded" ? results : [],
    credits_charged: job.creditsCharged ?? 0,
    credits_refunded: Math.min(refunded, job.creditsCharged ?? 0),
    external_ref: job.externalRef ?? null,
    owner_ref: job.ownerRef ?? null,
    character_ids: job.characterIds ?? [],
    error: failure?.error ?? null,
    code: failure?.code ?? null,
    created_at: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    finished_at: (status === "succeeded" || status === "failed") && finishedAt ? new Date(finishedAt).toISOString() : null,
  };
}

/* ───────────────────────── routes ───────────────────────── */

type AuthedRequest = Request & { partnerToken?: PartnerToken };

export function registerPartnerRoutes(app: Express, deps: PartnerDeps) {
  const now = deps.now ?? (() => Date.now());
  const writeLimiter = new SlidingWindow(60_000);
  const readLimiter = new SlidingWindow(60_000);
  const failedAuthLimiter = new SlidingWindow(60_000);
  const lastTouched = new Map<string, number>();
  const BASE = "/api/v1/partner";

  /* ── authentication ── */
  const authenticate = async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      // Server-to-server only: browsers always send Origin on cross-site and
      // on same-site non-GET requests, and have no business holding a token.
      if (req.headers.origin) {
        throw new PartnerError(403, "browser_requests_not_allowed", "這組 API 僅供伺服器端呼叫，不接受瀏覽器請求。");
      }
      const ip = req.ip || "unknown";
      const header = req.headers.authorization || "";
      const match = /^Bearer\s+(\S+)$/i.exec(header);
      const token = match?.[1];
      const record = token && token.startsWith(PARTNER_TOKEN_PREFIX)
        ? await deps.store.findTokenByHash(hashPartnerToken(token))
        : undefined;
      if (!record || record.revokedAt) {
        const wait = failedAuthLimiter.take(ip, FAILED_AUTH_PER_MINUTE, now());
        if (wait > 0) {
          throw new PartnerError(429, "rate_limited", "驗證失敗次數過多，請稍後再試。", { "Retry-After": String(wait) });
        }
        throw new PartnerError(401, "unauthorized", "權杖無效或已撤銷。", { "WWW-Authenticate": "Bearer" });
      }

      const isRead = req.method === "GET";
      const limit = Math.max(1, record.rateLimitPerMinute ?? 60) * (isRead ? READ_RATE_MULTIPLIER : 1);
      const wait = (isRead ? readLimiter : writeLimiter).take(record.id, limit, now());
      if (wait > 0) {
        throw new PartnerError(429, "rate_limited", "請求過於頻繁，請稍後再試。", { "Retry-After": String(wait) });
      }

      if (now() - (lastTouched.get(record.id) ?? 0) > 60_000) {
        lastTouched.set(record.id, now());
        deps.store.touchToken(record.id).catch(() => { /* non-critical */ });
      }
      req.partnerToken = record;
      res.setHeader("Cache-Control", "no-store");
      next();
    } catch (e) {
      sendError(res, e);
    }
  };

  /* ── shared helpers ── */

  function requestHash(endpoint: string, body: unknown): string {
    return createHash("sha256").update(endpoint + "\n" + JSON.stringify(body)).digest("hex");
  }

  function readIdempotencyKey(req: Request): string | null {
    const raw = req.headers["idempotency-key"];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (key === undefined) return null;
    if (!/^[\x21-\x7e]{1,128}$/.test(key)) {
      throw new PartnerError(400, "invalid_request", "Idempotency-Key 必須是 1–128 個可見 ASCII 字元。");
    }
    return key;
  }

  const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

  /** Returns the earlier job when this key was already used in the last 24 h. */
  async function findReplay(token: PartnerToken, key: string | null, hash: string): Promise<PartnerJob | null> {
    if (!key) return null;
    const existing = await deps.store.findJobByIdempotencyKey(token.id, key);
    if (!existing) return null;
    const age = now() - (existing.createdAt ? new Date(existing.createdAt).getTime() : 0);
    if (age > IDEMPOTENCY_WINDOW_MS) {
      await deps.store.clearIdempotencyKey(existing.id);
      return null;
    }
    if (existing.requestHash && existing.requestHash !== hash) {
      throw new PartnerError(409, "idempotency_key_conflict", "這個 Idempotency-Key 已用於內容不同的請求。");
    }
    return existing;
  }

  async function replyAccepted(res: Response, job: PartnerJob) {
    const view = await describeJob(job, deps);
    res.status(202).json({ job_id: view.job_id, status: view.status, credits_charged: view.credits_charged });
  }

  function assertNsfwAllowed(token: PartnerToken, wanted: boolean) {
    if (wanted && !token.allowNsfw) {
      throw new PartnerError(403, "nsfw_not_allowed", "這個權杖未開放 NSFW 提示詞強化，請移除 nsfw 欄位或聯絡管理員開通。");
    }
  }

  function assertStorage() {
    if (!deps.storageReady()) {
      throw new PartnerError(503, "storage_unavailable", "儲存服務尚未就緒，暫時無法接受生成請求。");
    }
  }

  function secondsUntilUtcMidnight(): number {
    const d = new Date(now());
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    return Math.max(1, Math.ceil((next - d.getTime()) / 1000));
  }

  async function assertDailyLimit(token: PartnerToken, kind: "image" | "video", adding: number) {
    const cap = kind === "image" ? token.dailyImageLimit : token.dailyVideoLimit;
    if (cap === null || cap === undefined) return; // unlimited for this token
    const used = kind === "image"
      ? await deps.core.getUserDailyImageCount(token.userId)
      : await deps.core.getUserDailyVideoCount(token.userId);
    if (used + adding > cap) {
      throw new PartnerError(429, "daily_limit_reached",
        `已達這個權杖的每日${kind === "image" ? "圖片" : "影片"}上限（${cap}）。`,
        { "Retry-After": String(secondsUntilUtcMidnight()) });
    }
  }

  async function assertBalance(userId: string, cost: number) {
    const user = await deps.core.getUser(userId);
    if (!user) throw new PartnerError(403, "account_unavailable", "權杖綁定的帳號不存在，請聯絡管理員。");
    if ((user.credits ?? 0) < cost) {
      throw new PartnerError(402, "insufficient_credits", `積分不足：需要 ${cost}，目前 ${user.credits ?? 0}。`);
    }
  }

  async function ingest(url: string, token: PartnerToken): Promise<string> {
    try {
      return await deps.ingestImage(url, `partner/${token.id}/inputs`);
    } catch (e) {
      if (e instanceof PartnerIngestError) {
        throw new PartnerError(e.code === "invalid_image_url" ? 400 : 422, e.code, e.message);
      }
      console.error("[Partner] image ingest failed:", e instanceof Error ? e.message : "unknown");
      throw new PartnerError(502, "image_download_failed", "無法取得參考圖，請確認網址可公開存取後再試。");
    }
  }

  const uploadLimiter = new SlidingWindow(60_000);
  const notFoundCharacter = () => new PartnerError(404, "not_found", "找不到這個角色。");

  /** Where one owner_ref's files live. The owner_ref itself never appears in a URL. */
  function ownerFolder(userId: string, ownerRef: string): string {
    return `partner/u/${userId}/o/${createHash("sha256").update(ownerRef, "utf8").digest("hex").slice(0, 24)}`;
  }
  function isInOwnerFolder(url: string, folder: string): boolean {
    try { return deps.isCdnUrl(url) && decodeURIComponent(new URL(url).pathname).startsWith(`/${folder}/`); } catch { return false; }
  }

  function readOwnerRef(req: Request): string {
    const raw = typeof req.query.owner_ref === "string" ? req.query.owner_ref : (req.body && typeof req.body.owner_ref === "string" ? req.body.owner_ref : undefined);
    const r = ownerRefField.safeParse(raw);
    if (!r.success) throw new PartnerError(400, "invalid_request", "請求內容有誤：owner_ref 為必填，且必須是 1–100 個不含空白的英數或符號字元。");
    return r.data;
  }

  /** Bring a character's four views up to date with the job that is drawing them. */
  async function syncFourViews(c: PartnerCharacter): Promise<PartnerCharacter> {
    if (!c.fourViewJobId) return c;
    const job = await deps.store.getJob(c.fourViewJobId);
    const ids = job?.generationIds ?? [];
    const urls: FourViewUrls = { ...((c.fourViewUrls ?? {}) as FourViewUrls) };
    let open = 0;
    let made = 0;
    for (let i = 0; i < ids.length; i++) {
      const g = await deps.core.getImageGeneration(ids[i]);
      const key = FOUR_VIEW_PRESETS[i]?.key;
      if (!g || !key) continue;
      if (g.status === "pending" || g.status === "processing") { open++; continue; }
      const url = g.status === "completed" ? deps.cdnUrl(g.bunnyImageUrl || g.bunnyImageUrls?.[0]) : null;
      if (url) { urls[key] = url; made++; }
    }
    const stillStarting = !!job && job.phase !== "failed" && ids.length === 0;
    if (open > 0 || stillStarting) return { ...c, fourViewUrls: urls, fourViewStatus: "generating" };
    const updated = await deps.store.updateCharacter(c.id, {
      fourViewUrls: urls, fourViewJobId: null, fourViewStatus: made > 0 ? "completed" : "failed",
    });
    return updated ?? { ...c, fourViewUrls: urls, fourViewJobId: null, fourViewStatus: made > 0 ? "completed" : "failed" };
  }

  /**
   * The ONLY way partner routes read a character. A character of another
   * account or another owner_ref is reported exactly like a missing one.
   */
  async function loadCharacter(token: PartnerToken, ownerRef: string, id: string): Promise<PartnerCharacter> {
    const c = /^[0-9a-fA-F-]{8,64}$/.test(id) ? await deps.store.getCharacter(id) : undefined;
    if (!c || c.userId !== token.userId || c.ownerRef !== ownerRef) throw notFoundCharacter();
    return syncFourViews(c);
  }

  /** Characters for a generation request: all must belong to owner_ref and be enabled. */
  async function loadCharactersForGeneration(token: PartnerToken, body: { owner_ref?: string; character_ids: string[]; nsfw: boolean }): Promise<PartnerCharacter[]> {
    if (body.character_ids.length === 0) return [];
    if (body.nsfw) {
      throw new PartnerError(400, "nsfw_not_allowed_with_characters", "使用角色生成時不可啟用 nsfw 提示詞強化，請移除 nsfw 欄位。");
    }
    const list: PartnerCharacter[] = [];
    for (const id of body.character_ids) list.push(await loadCharacter(token, body.owner_ref!, id));
    const disabled = list.find(c => c.disabledAt);
    if (disabled) throw new PartnerError(403, "character_disabled", `角色「${disabled.name}」已被停用，無法用來生成。`);
    return list;
  }

  /** Split the reference-image budget between the characters; explicit references keep their place. */
  function characterImagesWithin(characters: PartnerCharacter[], budget: number, explicit: number): { images: string[]; spans: { name: string; from: number; to: number }[] } {
    const images: string[] = [];
    const spans: { name: string; from: number; to: number }[] = [];
    if (characters.length === 0) return { images, spans };
    const each = Math.min(PARTNER_CHARACTERS.maxImagesPerCharacter, Math.floor((budget - explicit) / characters.length));
    if (each < 1) {
      throw new PartnerError(400, "invalid_request", `請求內容有誤：參考圖太多。角色與 reference_image_urls 合計最多 ${budget} 張，每個角色至少需要 1 張的空間。`);
    }
    for (const c of characters) {
      const own = characterReferenceImages(c, each);
      if (own.length === 0) throw new PartnerError(409, "character_not_ready", `角色「${c.name}」沒有可用的參考圖。`);
      spans.push({ name: c.name, from: images.length + 1, to: images.length + own.length });
      images.push(...own);
    }
    return { images, spans };
  }

  function characterNote(spans: { name: string; from: number; to: number }[]): string {
    if (spans.length === 0) return "";
    const parts = spans.map(s => `${s.from === s.to ? `第 ${s.from} 張` : `第 ${s.from}–${s.to} 張`}參考圖是角色「${s.name}」`);
    return `\n（${parts.join("；")}。請讓畫面中的角色與參考圖是同一個人：臉、髮型、體型與年齡保持一致。）`;
  }

  /** Files of this owner that no other character of the owner still uses. */
  async function deleteOwnedFiles(token: PartnerToken, ownerRef: string, urls: string[], exceptCharacterId: string, includeGenerated: string[] = []) {
    const folder = ownerFolder(token.userId, ownerRef);
    const others = (await deps.store.listCharacters(token.userId, ownerRef)).filter(c => c.id !== exceptCharacterId);
    const stillUsed = new Set(others.flatMap(c => c.refImageUrls ?? []));
    const targets = Array.from(new Set([...urls.filter(u => isInOwnerFolder(u, folder) && !stillUsed.has(u)), ...includeGenerated.filter(u => deps.isCdnUrl(u))]));
    let deleted = 0;
    let failed = 0;
    for (const url of targets) {
      try { (await deps.deleteStored(url)) ? deleted++ : failed++; } catch { failed++; }
    }
    return { deleted, failed };
  }

  /** Accept a reference image: our own file of this owner as-is, anything else is downloaded and re-hosted. */
  async function adoptReference(url: string, token: PartnerToken, ownerRef: string): Promise<string> {
    const folder = ownerFolder(token.userId, ownerRef);
    if (isInOwnerFolder(url, folder)) return url;
    try {
      return await deps.ingestImage(url, `${folder}/refs`);
    } catch (e) {
      if (e instanceof PartnerIngestError) throw new PartnerError(e.code === "invalid_image_url" ? 400 : 422, e.code, e.message);
      console.error("[Partner] reference ingest failed:", e instanceof Error ? e.message : "unknown");
      throw new PartnerError(502, "image_download_failed", "無法取得參考圖，請確認網址可公開存取後再試。");
    }
  }

  /** Claim the job row (and the idempotency key), then charge. */
  async function openJob(token: PartnerToken, data: Omit<PartnerJobCreate, "tokenId" | "userId">, cost: number, description: string): Promise<PartnerJob | { replay: PartnerJob }> {
    let job: PartnerJob;
    try {
      job = await deps.store.createJob({ ...data, tokenId: token.id, userId: token.userId });
    } catch (e) {
      if (e instanceof PartnerIdempotencyRace && data.idempotencyKey) {
        const existing = await deps.store.findJobByIdempotencyKey(token.id, data.idempotencyKey);
        if (existing) return { replay: existing };
      }
      throw e;
    }
    try {
      await deps.core.atomicDeductCredits(token.userId, cost, description);
    } catch {
      await deps.store.deleteJob(job.id);
      throw new PartnerError(402, "insufficient_credits", `積分不足：需要 ${cost} 積分。`);
    }
    await deps.store.updateJob(job.id, { creditsCharged: cost });
    return { ...job, creditsCharged: cost };
  }

  /** Something broke after charging and before any generation existed: give everything back. */
  async function failJobAndRefund(job: PartnerJob, alreadyRefunded: number, error: string, code: string) {
    const amount = Math.max(0, (job.creditsCharged ?? 0) - alreadyRefunded);
    if (amount > 0) {
      await deps.core.atomicAddCredits(job.userId, amount, `對外 API 任務失敗退還 ${amount} 積分`);
    }
    await deps.store.updateJob(job.id, {
      phase: "failed", error, errorCode: code,
      creditsRefundedExtra: alreadyRefunded + amount,
      finishedAt: new Date(now()),
    });
  }

  /* ── POST /images ── */
  app.post(`${BASE}/images`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const token = req.partnerToken!;
      const body = parseBody(imageBody, req.body);
      assertNsfwAllowed(token, body.nsfw);
      const key = readIdempotencyKey(req);
      const hash = requestHash("images", body);
      const replay = await findReplay(token, key, hash);
      if (replay) return await replyAccepted(res, replay);

      assertStorage();
      const perImage = body.watermark ? PARTNER_PRICING.imageWithWatermark : PARTNER_PRICING.imageWithoutWatermark;
      const cost = perImage * body.count;
      await assertDailyLimit(token, "image", body.count);
      await assertBalance(token.userId, cost);

      // Characters first (404 / 403 before anything is charged or downloaded).
      const characters = await loadCharactersForGeneration(token, body);
      const fromCharacters = characterImagesWithin(characters, PARTNER_PRICING.maxReferenceImages, body.reference_image_urls.length);

      const refs: string[] = [...fromCharacters.images];
      for (const url of body.reference_image_urls) refs.push(await ingest(url, token));

      const dims = deps.sizeDimensions(body.size);
      const opened = await openJob(token, {
        type: "image", requestedCount: body.count, externalRef: body.external_ref ?? null,
        ownerRef: body.owner_ref ?? null, characterIds: body.character_ids,
        idempotencyKey: key, requestHash: hash, meta: { ...dims, nsfw: body.nsfw },
      }, cost, `對外 API 圖片生成 ${body.count} 張，消耗 ${cost} 積分`);
      if ("replay" in opened) return await replyAccepted(res, opened.replay);
      const job = opened;

      try {
        const generation = await deps.core.createImageGeneration({
          userId: token.userId,
          type: refs.length > 0 ? "image-to-image" : "text-to-image",
          originalImageUrl: refs[0] ?? "",
          additionalImageUrls: refs.slice(1),
          prompt: `${body.prompt}${characterNote(fromCharacters.spans)}`,
          watermark: body.watermark,
          size: body.size,
          sequentialGeneration: body.count > 1,
          maxImages: body.count > 1 ? body.count : undefined,
          provider: "atlas",
          creditsUsed: cost,
        });
        await deps.store.updateJob(job.id, { generationIds: [generation.id], phase: "running" });
        deps.runImage(generation.id, { rawPrompt: !body.nsfw });
        return await replyAccepted(res, { ...job, generationIds: [generation.id], phase: "running" });
      } catch (e) {
        await failJobAndRefund(job, 0, "任務建立失敗，積分已退回。", "internal_error");
        throw e;
      }
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── POST /videos ── */
  app.post(`${BASE}/videos`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const token = req.partnerToken!;
      const body = parseBody(videoBody, req.body);
      assertNsfwAllowed(token, body.nsfw);
      const key = readIdempotencyKey(req);
      const hash = requestHash("videos", body);
      const replay = await findReplay(token, key, hash);
      if (replay) return await replyAccepted(res, replay);

      assertStorage();
      const cost = Math.round(body.duration * PARTNER_PRICING.videoPerSecond[body.quality]);
      await assertDailyLimit(token, "video", 1);
      await assertBalance(token.userId, cost);

      const characters = await loadCharactersForGeneration(token, body);
      // An explicit image_url is the first frame; otherwise the character's front view is.
      const firstFrame = body.type !== "image-to-video" ? undefined
        : body.image_url ? await ingest(body.image_url, token)
        : characterReferenceImages(characters[0], 1)[0];
      if (body.type === "image-to-video" && !firstFrame) {
        throw new PartnerError(409, "character_not_ready", "這個角色沒有可用的參考圖，請提供 image_url。");
      }

      const opened = await openJob(token, {
        type: "video", requestedCount: 1, externalRef: body.external_ref ?? null,
        ownerRef: body.owner_ref ?? null, characterIds: body.character_ids,
        idempotencyKey: key, requestHash: hash, meta: { nsfw: body.nsfw },
      }, cost, `對外 API 影片生成 ${body.duration} 秒 ${body.quality}，消耗 ${cost} 積分`);
      if ("replay" in opened) return await replyAccepted(res, opened.replay);
      const job = opened;

      try {
        const generation = await deps.core.createVideoGeneration({
          userId: token.userId,
          type: body.type,
          ...(firstFrame ? { originalImageUrl: firstFrame } : {}),
          prompt: body.prompt,
          duration: body.duration,
          cameraFixed: false,
          aspectRatio: body.ratio,
          resolution: body.quality,
        });
        await deps.store.updateJob(job.id, { generationIds: [generation.id], phase: "running" });
        deps.runVideo(generation.id, { rawPrompt: !body.nsfw });
        return await replyAccepted(res, { ...job, generationIds: [generation.id], phase: "running" });
      } catch (e) {
        await failJobAndRefund(job, 0, "任務建立失敗，積分已退回。", "internal_error");
        throw e;
      }
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── POST /photosets ── */
  app.post(`${BASE}/photosets`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const token = req.partnerToken!;
      const body = parseBody(photosetBody, req.body);
      assertNsfwAllowed(token, body.nsfw);
      const key = readIdempotencyKey(req);
      const hash = requestHash("photosets", body);
      const replay = await findReplay(token, key, hash);
      if (replay) return await replyAccepted(res, replay);

      assertStorage();
      // Picked poses decide the number of shots (one each), like on the website.
      const count = body.poses.length >= 2 && body.planner === "ai" ? body.poses.length : body.count;
      const perImage = body.watermark ? PARTNER_PRICING.imageWithWatermark : PARTNER_PRICING.imageWithoutWatermark;
      const cost = perImage * count;
      await assertDailyLimit(token, "image", count);
      await assertBalance(token.userId, cost);

      const characters = await loadCharactersForGeneration(token, body);
      const fromCharacters = characterImagesWithin(characters, PARTNER_PRICING.photosetMaxReferenceImages, body.reference_image_urls.length);

      const sceneUrl = body.mode === "scene" ? await ingest(body.scene_image_url!, token) : undefined;
      const refs: string[] = [...fromCharacters.images];
      for (const url of body.reference_image_urls) refs.push(await ingest(url, token));

      const dims = deps.sizeDimensions(body.size);
      const opened = await openJob(token, {
        type: "photoset", requestedCount: count, externalRef: body.external_ref ?? null,
        ownerRef: body.owner_ref ?? null, characterIds: body.character_ids,
        idempotencyKey: key, requestHash: hash, meta: { ...dims, nsfw: body.nsfw },
      }, cost, `對外 API 寫真套圖 ${count} 張，消耗 ${cost} 積分`);
      if ("replay" in opened) return await replyAccepted(res, opened.replay);
      const job = opened;

      await deps.store.updateJob(job.id, { phase: "planning" });
      await replyAccepted(res, { ...job, phase: "queued" });

      // ── background: plan → create the batch → run ──
      (async () => {
        let refundedSoFar = 0;
        try {
          const ratio = IMAGE_RATIOS.find(r => IMAGE_TIERS.some(t => `${r.sizes[t.id][0]}x${r.sizes[t.id][1]}` === body.size));
          const plan = await deps.planPhotoset({
            mode: body.mode,
            planner: body.mode === "character" ? body.planner : "ai",
            situationImageUrl: sceneUrl,
            referenceImageUrls: refs,
            outfitFrom: body.outfit_from,
            count,
            poseIds: body.planner === "ai" ? body.poses : [],
            look: body.quality_style,
            direction: body.direction,
            aspectRatio: ratio?.id,
          });
          const shots = plan.shots.filter(s => s.prompt.trim().length > 0).slice(0, count);
          if (shots.length === 0) throw new Error("planner returned no shots");

          // Charged for `count`; give back anything the planner did not produce.
          const missing = count - shots.length;
          if (missing > 0) {
            refundedSoFar = perImage * missing;
            await deps.core.atomicAddCredits(job.userId, refundedSoFar, `對外 API 寫真套圖少規劃 ${missing} 張，退還 ${refundedSoFar} 積分`);
            await deps.store.updateJob(job.id, { creditsRefundedExtra: refundedSoFar });
          }

          const note = referenceNote(body.mode, refs.length, body.outfit_from);
          const look = photoLookSuffix(body.quality_style);
          // Image order must match referenceNote(): 情境圖 first in scene mode.
          const [first, ...rest] = body.mode === "scene" ? [sceneUrl!, ...refs] : refs;
          const batchId = randomUUID();
          const ids: string[] = [];
          for (const shot of shots) {
            const g = await deps.core.createImageGeneration({
              userId: job.userId,
              type: "image-to-image",
              batchId,
              originalImageUrl: first,
              additionalImageUrls: rest,
              prompt: `${shot.prompt.trim()}${note}${look}`,
              watermark: body.watermark,
              size: body.size,
              provider: "atlas",
              creditsUsed: perImage,
            });
            ids.push(g.id);
          }
          await deps.store.updateJob(job.id, { generationIds: ids, phase: "running" });
          for (const id of ids) deps.runImage(id, { rawPrompt: !body.nsfw });
        } catch (e) {
          console.error("[Partner] photoset job failed before generation:", e instanceof Error ? e.message : "unknown");
          try {
            await failJobAndRefund(job, refundedSoFar, "套圖規劃失敗，積分已退回，請稍後再試或更換圖片。", "planning_failed");
          } catch (refundErr) {
            console.error("[Partner] photoset refund failed for job", job.id);
          }
        }
      })();
    } catch (e) {
      if (!res.headersSent) sendError(res, e);
    }
  });

  /* ── POST /uploads ── */
  app.post(`${BASE}/uploads`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const token = req.partnerToken!;
      const contentType = String(req.headers["content-type"] || "");
      if (!/^multipart\/form-data/i.test(contentType)) {
        throw new PartnerError(400, "invalid_request", "請用 multipart/form-data 上傳，欄位為 file 與 owner_ref。");
      }
      assertStorage();
      const raw = await readRawBody(req, PARTNER_UPLOAD.maxBytes + 64 * 1024);
      const { fields, files } = parseMultipart(raw, contentType);
      const owner = ownerRefField.safeParse(fields.owner_ref);
      if (!owner.success) throw new PartnerError(400, "invalid_request", "請求內容有誤：owner_ref 為必填，且必須是 1–100 個不含空白的英數或符號字元。");
      const file = files.file;
      if (!file || file.length === 0) throw new PartnerError(400, "invalid_request", "請求內容有誤：缺少 file 欄位。");
      if (file.length > PARTNER_UPLOAD.maxBytes) {
        throw new PartnerError(413, "file_too_large", `檔案過大：單檔上限 ${Math.round(PARTNER_UPLOAD.maxBytes / 1024 / 1024)} MB。`);
      }
      const format = sniffImageFormat(file);
      if (!format) throw new PartnerError(415, "unsupported_file_type", "只接受 JPG、PNG、WEBP 圖片（以檔案實際內容判斷，不看副檔名）。");

      const wait = uploadLimiter.take(`${token.userId}\n${owner.data}`, PARTNER_UPLOAD.perOwnerPerMinute, now());
      if (wait > 0) throw new PartnerError(429, "rate_limited", "這個 owner_ref 上傳過於頻繁，請稍後再試。", { "Retry-After": String(wait) });

      try {
        const stored = await deps.storeUpload({ buffer: file, format, folder: `${ownerFolder(token.userId, owner.data)}/uploads` });
        res.status(201).json({ url: stored.url, width: stored.width, height: stored.height });
      } catch (e) {
        if (e instanceof PartnerUploadError) throw new PartnerError(e.status, e.code, e.message);
        throw e;
      }
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── POST /characters ── */
  app.post(`${BASE}/characters`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const token = req.partnerToken!;
      const body = parseBody(createCharacterBody, req.body);
      if (body.consent !== true) {
        throw new PartnerError(400, "consent_required", "建立角色前必須確認肖像同意：請在向客戶確認「照片中的人是本人或已取得本人同意」後傳入 consent: true。");
      }
      assertStorage();
      const existing = await deps.store.listCharacters(token.userId, body.owner_ref);
      if (existing.length >= PARTNER_CHARACTERS.maxPerOwner) {
        throw new PartnerError(409, "character_limit_reached", `這個 owner_ref 的角色已達上限（${PARTNER_CHARACTERS.maxPerOwner} 個），請先刪除不用的角色。`);
      }
      const refs: string[] = [];
      for (const url of Array.from(new Set(body.reference_image_urls))) refs.push(await adoptReference(url, token, body.owner_ref));
      if (refs.length < PARTNER_CHARACTERS.minReferenceImages) {
        throw new PartnerError(400, "invalid_request", `請求內容有誤：reference_image_urls 至少需要 ${PARTNER_CHARACTERS.minReferenceImages} 張不重複的圖片。`);
      }
      const created = await deps.store.createCharacter({
        userId: token.userId, tokenId: token.id, ownerRef: body.owner_ref,
        name: body.name, description: body.description, styleHint: body.style_hint,
        refImageUrls: refs, consentAt: new Date(now()),
      });
      res.status(201).json(characterView(created));
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── GET /characters ── */
  app.get(`${BASE}/characters`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const token = req.partnerToken!;
      const ownerRef = readOwnerRef(req);
      const rows = await deps.store.listCharacters(token.userId, ownerRef);
      const synced: PartnerCharacter[] = [];
      for (const row of rows) synced.push(await syncFourViews(row));
      res.json({ characters: synced.map(characterView), count: synced.length, limit: PARTNER_CHARACTERS.maxPerOwner });
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── GET /characters/:id ── */
  app.get(`${BASE}/characters/:id`, authenticate, async (req: AuthedRequest, res) => {
    try {
      res.json(characterView(await loadCharacter(req.partnerToken!, readOwnerRef(req), req.params.id)));
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── PATCH /characters/:id ── */
  app.patch(`${BASE}/characters/:id`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const token = req.partnerToken!;
      const body = parseBody(patchCharacterBody, req.body);
      const character = await loadCharacter(token, body.owner_ref, req.params.id);

      const remove = new Set(body.remove_reference_image_urls);
      const kept = (character.refImageUrls ?? []).filter(u => !remove.has(u));
      const removed = (character.refImageUrls ?? []).filter(u => remove.has(u));
      const adding = Array.from(new Set(body.add_reference_image_urls)).filter(u => !kept.includes(u));
      const total = kept.length + adding.length;
      if (total < PARTNER_CHARACTERS.minReferenceImages || total > PARTNER_CHARACTERS.maxReferenceImages) {
        throw new PartnerError(400, "invalid_request", `請求內容有誤：修改後參考圖會是 ${total} 張，必須介於 ${PARTNER_CHARACTERS.minReferenceImages} 到 ${PARTNER_CHARACTERS.maxReferenceImages} 張。`);
      }
      if (adding.length > 0) assertStorage();
      const next = [...kept];
      for (const url of adding) {
        const stored = await adoptReference(url, token, body.owner_ref);
        if (!next.includes(stored)) next.push(stored);
      }
      const updated = await deps.store.updateCharacter(character.id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.style_hint !== undefined ? { styleHint: body.style_hint } : {}),
        refImageUrls: next,
      });
      if (removed.length > 0) await deleteOwnedFiles(token, body.owner_ref, removed, character.id);
      res.json(characterView(updated ?? { ...character, refImageUrls: next }));
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── DELETE /characters/:id ── */
  app.delete(`${BASE}/characters/:id`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const token = req.partnerToken!;
      const ownerRef = readOwnerRef(req);
      const character = await loadCharacter(token, ownerRef, req.params.id);
      if (character.fourViewJobId) {
        throw new PartnerError(409, "four_views_in_progress", "這個角色的四視圖還在生成，請等任務結束後再刪除。", { "Retry-After": "30" });
      }
      // Remove the row first so nothing can use the character while its files go away.
      await deps.store.deleteCharacter(character.id);
      const files = await deleteOwnedFiles(token, ownerRef, character.refImageUrls ?? [], character.id, fourViewList(character.fourViewUrls as FourViewUrls | null));
      res.json({ id: character.id, deleted: true, files_deleted: files.deleted, files_failed: files.failed });
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── POST /characters/:id/four-views ── */
  app.post(`${BASE}/characters/:id/four-views`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const token = req.partnerToken!;
      const body = parseBody(ownerOnlyBody, { owner_ref: readOwnerRef(req) });
      const character = await loadCharacter(token, body.owner_ref, req.params.id);
      if (character.disabledAt) throw new PartnerError(403, "character_disabled", `角色「${character.name}」已被停用，無法用來生成。`);
      const key = readIdempotencyKey(req);
      const hash = requestHash(`characters/${character.id}/four-views`, body);
      const replay = await findReplay(token, key, hash);
      if (replay) return await replyAccepted(res, replay);
      if (character.fourViewJobId) {
        throw new PartnerError(409, "four_views_in_progress", "這個角色的四視圖已經在生成中。", { "Retry-After": "30" });
      }

      assertStorage();
      const views = FOUR_VIEW_PRESETS;
      const cost = PARTNER_CHARACTERS.fourViewCost;
      const refs = (character.refImageUrls ?? []).slice(0, PARTNER_PRICING.maxReferenceImages);
      if (refs.length === 0) throw new PartnerError(409, "character_not_ready", "這個角色沒有參考圖。");
      await assertDailyLimit(token, "image", views.length);
      await assertBalance(token.userId, cost);

      let dims = { width: 1440, height: 2560 };
      try { dims = deps.sizeDimensions(FOUR_VIEW_SIZE); } catch { /* keep the nominal size */ }
      const opened = await openJob(token, {
        type: "four_views", requestedCount: views.length, externalRef: null,
        ownerRef: body.owner_ref, characterIds: [character.id],
        idempotencyKey: key, requestHash: hash, meta: { ...dims, nsfw: false },
      }, cost, `對外 API 角色四視圖，消耗 ${cost} 積分`);
      if ("replay" in opened) return await replyAccepted(res, opened.replay);
      const job = opened;

      try {
        const batchId = randomUUID();
        const ids: string[] = [];
        for (const view of views) {
          const g = await deps.core.createImageGeneration({
            userId: token.userId,
            type: "image-to-image",
            batchId,
            originalImageUrl: refs[0],
            additionalImageUrls: refs.slice(1),
            prompt: fourViewPrompt(view.promptZh, character.description, character.styleHint),
            watermark: false,
            size: FOUR_VIEW_SIZE,
            provider: "atlas",
            creditsUsed: IMAGE_COST,
          });
          ids.push(g.id);
        }
        await deps.store.updateJob(job.id, { generationIds: ids, phase: "running" });
        await deps.store.updateCharacter(character.id, { fourViewJobId: job.id, fourViewStatus: "generating" });
        // Character work never uses the NSFW prompt enhancer.
        for (const id of ids) deps.runImage(id, { rawPrompt: true });
        return await replyAccepted(res, { ...job, generationIds: ids, phase: "running" });
      } catch (e) {
        await failJobAndRefund(job, 0, "任務建立失敗，積分已退回。", "internal_error");
        throw e;
      }
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── GET /jobs/:id ── */
  app.get(`${BASE}/jobs/:id`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const token = req.partnerToken!;
      const job = /^[0-9a-fA-F-]{8,64}$/.test(req.params.id) ? await deps.store.getJob(req.params.id) : undefined;
      // Jobs of other accounts must be indistinguishable from missing ones.
      const asked = typeof req.query.owner_ref === "string" ? req.query.owner_ref : null;
      // A job made for one owner_ref can only be read with that owner_ref.
      if (!job || job.userId !== token.userId || (job.ownerRef ?? null) !== (job.ownerRef ? asked : (asked ?? null))) {
        throw new PartnerError(404, "not_found", "找不到這個任務。");
      }
      res.json(await describeJob(job, deps));
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── GET /balance ── */
  app.get(`${BASE}/balance`, authenticate, async (req: AuthedRequest, res) => {
    try {
      const user = await deps.core.getUser(req.partnerToken!.userId);
      if (!user) throw new PartnerError(403, "account_unavailable", "權杖綁定的帳號不存在，請聯絡管理員。");
      res.json({ credits: user.credits ?? 0 });
    } catch (e) {
      sendError(res, e);
    }
  });

  /* ── GET /pricing ── */
  app.get(`${BASE}/pricing`, authenticate, async (req: AuthedRequest, res) => {
    const token = req.partnerToken!;
    res.json({
      unit: "credits",
      images: {
        per_image: { without_watermark: PARTNER_PRICING.imageWithoutWatermark, with_watermark: PARTNER_PRICING.imageWithWatermark },
        default_watermark: false,
        note: "所有畫質與比例的積分相同；一次請求的費用為 per_image × count。",
        count: PARTNER_PRICING.imageCount,
        max_reference_images: PARTNER_PRICING.maxReferenceImages,
        sizes: IMAGE_RATIOS.flatMap(r => IMAGE_TIERS.map(t => ({
          size: `${r.sizes[t.id][0]}x${r.sizes[t.id][1]}`,
          ratio: r.id, quality: t.id, width: r.sizes[t.id][0], height: r.sizes[t.id][1],
        }))),
      },
      videos: {
        per_second: PARTNER_PRICING.videoPerSecond,
        duration_seconds: PARTNER_PRICING.videoDuration,
        ratios: ["16:9", "9:16", "1:1"],
        note: "費用為 per_second × duration。image-to-video 的畫面比例跟隨首幀圖片，ratio 只對 text-to-video 生效。",
      },
      photosets: {
        per_image: { without_watermark: PARTNER_PRICING.imageWithoutWatermark, with_watermark: PARTNER_PRICING.imageWithWatermark },
        planning: 0,
        count: PARTNER_PRICING.photosetCount,
        max_reference_images: PARTNER_PRICING.photosetMaxReferenceImages,
        note: "費用為 per_image × 張數；規劃不另外收費。指定 poses 時張數等於姿勢數。",
        quality_styles: PHOTO_LOOKS.map(l => ({ id: l.id, name: l.label, description: l.hint })),
        poses: POSES.map(p => ({ id: p.id, category: p.category, name: p.name, framing: p.framing })),
      },
      characters: {
        four_views: PARTNER_CHARACTERS.fourViewCost,
        reference_images: { min: PARTNER_CHARACTERS.minReferenceImages, max: PARTNER_CHARACTERS.maxReferenceImages },
        max_per_owner_ref: PARTNER_CHARACTERS.maxPerOwner,
        max_character_ids: { images: PARTNER_CHARACTERS.maxPerRequest, photosets: PARTNER_CHARACTERS.maxPerRequest, videos: 1 },
        note: "建立、修改、刪除角色不收費。四視圖一次 4 張。使用角色生成時不可啟用 nsfw。",
      },
      uploads: {
        max_bytes: PARTNER_UPLOAD.maxBytes,
        formats: PARTNER_UPLOAD.formats,
        min_side_pixels: PARTNER_UPLOAD.minSidePixels,
        per_owner_ref_per_minute: PARTNER_UPLOAD.perOwnerPerMinute,
        note: "不收費。依檔案實際內容判斷格式；儲存前會移除 EXIF 等所有中繼資料（含拍攝位置）。",
      },
      refunds: "生成失敗的部分會自動退回積分，並反映在任務的 credits_refunded。",
      nsfw_allowed: !!token.allowNsfw,
      limits: {
        requests_per_minute: token.rateLimitPerMinute ?? 60,
        read_requests_per_minute: (token.rateLimitPerMinute ?? 60) * READ_RATE_MULTIPLIER,
        daily_images: token.dailyImageLimit ?? null,
        daily_videos: token.dailyVideoLimit ?? null,
      },
    });
  });

  // Anything else under the prefix: a JSON 404 instead of the SPA fallback.
  app.use(BASE, (_req, res) => {
    res.status(404).json({ error: "找不到這個端點。", code: "not_found" });
  });

  /* ───────────── admin: manage service tokens (browser session, admins only) ───────────── */

  const tokenView = (t: PartnerToken) => ({
    id: t.id, name: t.name, userId: t.userId, tokenPrefix: t.tokenPrefix,
    allowNsfw: !!t.allowNsfw, rateLimitPerMinute: t.rateLimitPerMinute,
    dailyImageLimit: t.dailyImageLimit ?? null, dailyVideoLimit: t.dailyVideoLimit ?? null,
    createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, revokedAt: t.revokedAt,
  });

  const limitField = z.number().int().min(1).max(1_000_000).nullable().optional();
  const tokenSettings = z.object({
    name: z.string().trim().min(1).max(80),
    allowNsfw: z.boolean().optional(),
    rateLimitPerMinute: z.number().int().min(1).max(6000).optional(),
    dailyImageLimit: limitField,
    dailyVideoLimit: limitField,
  });
  const createTokenBody = tokenSettings.extend({
    userId: z.string().max(100).optional(),
    userEmail: z.string().email().max(200).optional(),
  }).strict();

  app.get("/api/admin/partner-tokens", deps.requireAuth, deps.requireAdmin, async (_req, res) => {
    try {
      res.json((await deps.store.listTokens()).map(tokenView));
    } catch {
      res.status(500).json({ error: "讀取權杖列表失敗（資料表可能尚未建立，請先執行 npm run db:push）。" });
    }
  });

  app.post("/api/admin/partner-tokens", deps.requireAuth, deps.requireAdmin, async (req, res) => {
    try {
      const parsed = createTokenBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "欄位有誤：" + parsed.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("；") });
      const body = parsed.data;
      const user = body.userId
        ? await deps.core.getUser(body.userId)
        : body.userEmail ? await deps.core.getUserByEmail(body.userEmail) : undefined;
      if (!user) return res.status(400).json({ error: "找不到要綁定的使用者帳號，請確認使用者 ID 或 Email。" });

      const { token, hash, prefix } = generatePartnerToken();
      const created = await deps.store.createToken({
        name: body.name, userId: user.id, tokenHash: hash, tokenPrefix: prefix,
        allowNsfw: body.allowNsfw ?? false,
        rateLimitPerMinute: body.rateLimitPerMinute ?? 60,
        dailyImageLimit: body.dailyImageLimit ?? null,
        dailyVideoLimit: body.dailyVideoLimit ?? null,
        createdBy: (req.session as any)?.userId ?? null,
      });
      // The clear-text token leaves the server exactly once, here.
      res.setHeader("Cache-Control", "no-store");
      res.json({ ...tokenView(created), token });
    } catch {
      res.status(500).json({ error: "建立權杖失敗（資料表可能尚未建立，請先執行 npm run db:push）。" });
    }
  });

  app.patch("/api/admin/partner-tokens/:id", deps.requireAuth, deps.requireAdmin, async (req, res) => {
    try {
      const parsed = tokenSettings.partial().strict().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "欄位有誤：" + parsed.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("；") });
      const updated = await deps.store.updateToken(req.params.id, parsed.data);
      if (!updated) return res.status(404).json({ error: "找不到這個權杖。" });
      res.json(tokenView(updated));
    } catch {
      res.status(500).json({ error: "更新權杖失敗。" });
    }
  });

  app.post("/api/admin/partner-tokens/:id/revoke", deps.requireAuth, deps.requireAdmin, async (req, res) => {
    try {
      const revoked = await deps.store.revokeToken(req.params.id);
      if (!revoked) return res.status(404).json({ error: "找不到這個權杖。" });
      res.json(tokenView(revoked));
    } catch {
      res.status(500).json({ error: "撤銷權杖失敗。" });
    }
  });

  /* ───────────── admin: partner characters (takedown) ───────────── */

  const adminCharacterView = (c: PartnerCharacter) => ({
    ...characterView(c),
    userId: c.userId,
    consentAt: c.consentAt, disabledAt: c.disabledAt ?? null, disabledBy: c.disabledBy ?? null, disabledReason: c.disabledReason ?? null,
  });
  const disableBody = z.object({ disabled: z.boolean(), reason: z.string().trim().max(300).optional() }).strict();
  const disableOwnerBody = disableBody.extend({ ownerRef: ownerRefField }).strict();
  const disablePatch = (req: Request, body: { disabled: boolean; reason?: string }) => body.disabled
    ? { disabledAt: new Date(now()), disabledBy: ((req.session as any)?.userId ?? null) as string | null, disabledReason: body.reason ?? null }
    : { disabledAt: null, disabledBy: null, disabledReason: null };

  app.get("/api/admin/partner-characters", deps.requireAuth, deps.requireAdmin, async (req, res) => {
    try {
      const ownerRef = typeof req.query.owner_ref === "string" && req.query.owner_ref.trim() ? req.query.owner_ref.trim() : undefined;
      const id = typeof req.query.id === "string" && /^[0-9a-fA-F-]{8,64}$/.test(req.query.id.trim()) ? req.query.id.trim() : undefined;
      res.json((await deps.store.adminListCharacters({ ownerRef, id })).map(adminCharacterView));
    } catch {
      res.status(500).json({ error: "讀取角色列表失敗（資料表可能尚未建立，請先執行 npm run db:push）。" });
    }
  });

  app.post("/api/admin/partner-characters/disable-by-owner", deps.requireAuth, deps.requireAdmin, async (req, res) => {
    try {
      const parsed = disableOwnerBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "欄位有誤：" + parsed.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("；") });
      const rows = await deps.store.adminListCharacters({ ownerRef: parsed.data.ownerRef });
      for (const row of rows) await deps.store.updateCharacter(row.id, disablePatch(req, parsed.data));
      res.json({ ownerRef: parsed.data.ownerRef, disabled: parsed.data.disabled, affected: rows.length });
    } catch {
      res.status(500).json({ error: "更新角色狀態失敗。" });
    }
  });

  app.post("/api/admin/partner-characters/:id/disable", deps.requireAuth, deps.requireAdmin, async (req, res) => {
    try {
      const parsed = disableBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "欄位有誤：" + parsed.error.issues.map(i => `${i.path.join(".")} ${i.message}`).join("；") });
      const updated = await deps.store.updateCharacter(req.params.id, disablePatch(req, parsed.data));
      if (!updated) return res.status(404).json({ error: "找不到這個角色。" });
      res.json(adminCharacterView(updated));
    } catch {
      res.status(500).json({ error: "更新角色狀態失敗。" });
    }
  });
}

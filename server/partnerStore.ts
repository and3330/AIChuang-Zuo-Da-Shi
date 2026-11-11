/**
 * Database-backed persistence and image ingestion for the partner API.
 * Kept apart from partnerApi.ts so that module stays free of database and
 * network imports and can be tested with in-memory fakes.
 */

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import sharp from "sharp";
import { db } from "./db";
import { partnerTokens, partnerJobs, partnerCharacters, type PartnerJob, type PartnerToken } from "@shared/schema";
import { PartnerIdempotencyRace, PartnerIngestError, PartnerUploadError, type PartnerStore, type PartnerUploadFormat } from "./partnerApi";
import { assertPublicHttpsUrl } from "./ssrfGuard";
import type { BunnyStorageService } from "./bunnyStorage";

/** Postgres unique-violation. */
function isUniqueViolation(e: any): boolean {
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export const partnerStore: PartnerStore = {
  async findTokenByHash(hash) {
    const [row] = await db.select().from(partnerTokens).where(eq(partnerTokens.tokenHash, hash));
    return row;
  },
  async touchToken(id) {
    await db.update(partnerTokens).set({ lastUsedAt: new Date() }).where(eq(partnerTokens.id, id));
  },
  async listTokens() {
    return db.select().from(partnerTokens).orderBy(desc(partnerTokens.createdAt));
  },
  async createToken(data) {
    const [row] = await db.insert(partnerTokens).values(data).returning();
    return row;
  },
  async updateToken(id, updates) {
    const [row] = await db.update(partnerTokens).set(updates).where(eq(partnerTokens.id, id)).returning();
    return row;
  },
  async revokeToken(id) {
    const [existing] = await db.select().from(partnerTokens).where(eq(partnerTokens.id, id));
    if (!existing) return undefined;
    if (existing.revokedAt) return existing;
    const [row] = await db.update(partnerTokens).set({ revokedAt: new Date() }).where(eq(partnerTokens.id, id)).returning();
    return row;
  },

  async createJob(data) {
    try {
      const [row] = await db.insert(partnerJobs).values({
        tokenId: data.tokenId,
        userId: data.userId,
        type: data.type,
        requestedCount: data.requestedCount,
        externalRef: data.externalRef,
        idempotencyKey: data.idempotencyKey,
        requestHash: data.requestHash,
        meta: data.meta,
        ownerRef: data.ownerRef ?? null,
        characterIds: data.characterIds ?? [],
      }).returning();
      return row;
    } catch (e) {
      if (isUniqueViolation(e)) throw new PartnerIdempotencyRace();
      throw e;
    }
  },
  async getJob(id) {
    const [row] = await db.select().from(partnerJobs).where(eq(partnerJobs.id, id));
    return row;
  },
  async findJobByIdempotencyKey(tokenId, key) {
    const [row] = await db.select().from(partnerJobs)
      .where(and(eq(partnerJobs.tokenId, tokenId), eq(partnerJobs.idempotencyKey, key)));
    return row;
  },
  async clearIdempotencyKey(jobId) {
    await db.update(partnerJobs).set({ idempotencyKey: null }).where(eq(partnerJobs.id, jobId));
  },
  async updateJob(id, updates: Partial<PartnerJob>) {
    await db.update(partnerJobs).set(updates).where(eq(partnerJobs.id, id));
  },
  async deleteJob(id) {
    await db.delete(partnerJobs).where(eq(partnerJobs.id, id));
  },

  async createCharacter(data) {
    const [row] = await db.insert(partnerCharacters).values(data).returning();
    return row;
  },
  async getCharacter(id) {
    const [row] = await db.select().from(partnerCharacters).where(eq(partnerCharacters.id, id));
    return row;
  },
  async listCharacters(userId, ownerRef) {
    return db.select().from(partnerCharacters)
      .where(and(eq(partnerCharacters.userId, userId), eq(partnerCharacters.ownerRef, ownerRef)))
      .orderBy(desc(partnerCharacters.createdAt));
  },
  async updateCharacter(id, updates) {
    const [row] = await db.update(partnerCharacters).set({ ...updates, updatedAt: new Date() }).where(eq(partnerCharacters.id, id)).returning();
    return row;
  },
  async deleteCharacter(id) {
    await db.delete(partnerCharacters).where(eq(partnerCharacters.id, id));
  },
  async adminListCharacters(filter) {
    const conds = [
      filter.ownerRef ? eq(partnerCharacters.ownerRef, filter.ownerRef) : undefined,
      filter.id ? eq(partnerCharacters.id, filter.id) : undefined,
    ].filter((x): x is NonNullable<typeof x> => !!x);
    const q = db.select().from(partnerCharacters);
    return (conds.length ? q.where(and(...conds)) : q).orderBy(desc(partnerCharacters.createdAt)).limit(200);
  },
};

export type { PartnerToken };

const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isNonPublicAddress(address: string): boolean {
  const ip = address.toLowerCase();
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(ip) === 6) {
    return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") ||
      ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb") ||
      ip.startsWith("ff");
  }
  return true; // not an IP at all
}

async function assertResolvesToPublicAddress(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some(a => isNonPublicAddress(a.address))) {
    throw new Error("host resolves to a non-public address");
  }
}

/**
 * GET an image without following redirects (a redirect could lead anywhere,
 * including inside our network), with a content-type check, a byte cap and a
 * timeout.
 */
async function downloadImageNoRedirect(url: URL): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await fetch(url.toString(), { redirect: "manual", signal: ctrl.signal });
    if (resp.status >= 300 && resp.status < 400) throw new Error("redirects are not followed");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const type = (resp.headers.get("content-type") || "").toLowerCase();
    if (type && !type.startsWith("image/")) throw new Error("not an image");
    const declared = Number(resp.headers.get("content-length") || 0);
    if (declared > MAX_INPUT_BYTES) throw new Error("too large");
    const reader = resp.body?.getReader();
    if (!reader) throw new Error("no body");
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_INPUT_BYTES) {
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error("too large");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download a partner-supplied image through the SSRF guard (https only, no
 * internal hosts or addresses, no redirects, image content-type, 25 MB cap,
 * 30 s timeout), normalise it
 * to JPEG and re-host it on our CDN. The generation workers and the video
 * model then only ever see our own CDN URL.
 */
export function createPartnerImageIngestor(
  bunnyStorage: BunnyStorageService,
  cdnUrl: (url: string | null | undefined) => string | null | undefined,
) {
  return async function ingestImage(url: string, folder: string): Promise<string> {
    // These URLs come from another system, so on top of the shared guard we
    // (a) check what the host name resolves to and (b) refuse redirects, so a
    // public-looking URL cannot be pointed at an internal address.
    let safe: URL;
    try {
      safe = assertPublicHttpsUrl(url);
      await assertResolvesToPublicAddress(safe.hostname);
    } catch {
      throw new PartnerIngestError("invalid_image_url", "圖片網址必須是可公開存取、不會轉址的 https 網址。");
    }
    let raw: Buffer;
    try {
      raw = await downloadImageNoRedirect(safe);
    } catch {
      throw new PartnerIngestError("image_download_failed", "無法下載圖片：請確認網址可公開存取、不會轉址、內容是圖片且小於 25MB。");
    }
    let jpeg: Buffer;
    try {
      // Also validates that the bytes really are an image.
      jpeg = await sharp(raw).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
    } catch {
      throw new PartnerIngestError("image_download_failed", "圖片格式無法辨識，請改用 JPG、PNG 或 WEBP。");
    }
    const stored = await bunnyStorage.uploadBuffer(jpeg, `${folder}/${randomUUID()}.jpg`);
    const publicUrl = cdnUrl(stored);
    if (!publicUrl) throw new Error("CDN upload returned no URL");
    return publicUrl;
  };
}

/** Largest image we will decode for an upload (width × height). */
const MAX_UPLOAD_PIXELS = 50_000_000;
const MIN_UPLOAD_SIDE = 256;

/**
 * Store a partner upload: confirm the bytes really decode as the sniffed
 * format, apply the EXIF orientation, then re-encode. Re-encoding with sharp
 * drops ALL metadata (EXIF incl. GPS position, XMP, IPTC), so nothing about
 * where or with what a photo was taken reaches the CDN.
 */
export function createPartnerUploadStore(
  bunnyStorage: BunnyStorageService,
  cdnUrl: (url: string | null | undefined) => string | null | undefined,
) {
  return async function storeUpload(input: { buffer: Buffer; format: PartnerUploadFormat; folder: string }) {
    let out: Buffer; let width = 0; let height = 0;
    try {
      const img = sharp(input.buffer, { limitInputPixels: MAX_UPLOAD_PIXELS, failOn: "error" });
      const meta = await img.metadata();
      const actual = meta.format === "jpeg" ? "jpg" : meta.format;
      if (actual !== input.format) throw new Error("format mismatch");
      const pipeline = img.rotate();
      const encoded = input.format === "png" ? pipeline.png({ compressionLevel: 9 })
        : input.format === "webp" ? pipeline.webp({ quality: 92 })
        : pipeline.jpeg({ quality: 92 });
      const result = await encoded.toBuffer({ resolveWithObject: true });
      out = result.data; width = result.info.width; height = result.info.height;
    } catch {
      throw new PartnerUploadError(422, "invalid_image", "檔案無法辨識為 JPG、PNG 或 WEBP 圖片，或圖片過大。");
    }
    if (Math.min(width, height) < MIN_UPLOAD_SIDE) {
      throw new PartnerUploadError(422, "image_too_small", `圖片太小：短邊至少 ${MIN_UPLOAD_SIDE} 像素。`);
    }
    const stored = await bunnyStorage.uploadBuffer(out, `${input.folder}/${randomUUID()}.${input.format}`);
    const url = cdnUrl(stored);
    if (!url) throw new Error("CDN upload returned no URL");
    return { url, width, height };
  };
}

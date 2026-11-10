/**
 * 素材圖庫：清單同步、批次生成預覽圖、瀏覽。
 *
 *   清單（shared/libraryCatalog.ts，純文字）
 *      │  POST /api/admin/library/sync      只新增缺少的列，不動已生成的圖
 *      ▼
 *   library_assets（資料庫：每筆素材的狀態與 CDN 網址）
 *      │  POST /api/admin/library/generate  背景批次生成，可隨時停止、之後續跑
 *      ▼
 *   CDN：library/<圖庫>/<代號>.webp 與 _thumb.webp
 *
 * 預覽圖用便宜的文字生圖模型（GPT Image 2.5 Flare），不是網站使用者生圖用的
 * Seedream。生成只會由管理員手動啟動，而且每次都要指定張數上限，避免一按就
 * 花掉預期以外的費用。
 *
 * 批次狀態放在這個程序的記憶體裡：伺服器重啟會中斷批次，但每張圖的進度都在
 * 資料庫，重新按開始就會從還沒完成的接著做。
 */

import type { Express, Request, Response, NextFunction } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { db } from "./db";
import { libraryAssets, type LibraryAsset } from "@shared/schema";
import { libraryCatalog, LIBRARIES, type LibraryId } from "@shared/libraryCatalog";
import { atlasGenerateLibraryImage, atlasIsConfigured, ATLAS_LIBRARY_MODEL, ATLAS_LIBRARY_PRICE_USD } from "./atlasProvider";
import { assertPublicHttpsUrl, fetchImageWithLimits } from "./ssrfGuard";
import type { BunnyStorageService } from "./bunnyStorage";

const MAX_ATTEMPTS = 3;
const LIBRARY_IDS = LIBRARIES.map(l => l.id) as [LibraryId, ...LibraryId[]];

type RunState = {
  running: boolean;
  stopRequested: boolean;
  library: LibraryId | "all";
  target: number;
  done: number;
  failed: number;
  startedAt: number | null;
  finishedAt: number | null;
  lastError: string | null;
};

const run: RunState = {
  running: false, stopRequested: false, library: "all", target: 0, done: 0, failed: 0,
  startedAt: null, finishedAt: null, lastError: null,
};

/** Short, log-safe description of a failure (no URLs, keys or stack). */
function shortError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/sensitive|moderation|safety|policy|審查|敏感/i.test(m)) return "內容被模型的安全審查拒絕";
  if (/逾時|timeout|timed out/i.test(m)) return "生成逾時";
  if (/\(40[13]\)|unauthor|forbidden/i.test(m)) return "金鑰無效或沒有這個模型的權限";
  if (/\(429\)|rate/i.test(m)) return "供應商限流，請稍後續跑";
  if (/Bunny/i.test(m)) return "上傳 CDN 失敗";
  return "生成失敗";
}

export function registerAssetLibraryRoutes(
  app: Express,
  deps: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
    requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
    bunnyStorage: BunnyStorageService;
    cdnUrl: (url: string | null | undefined) => string | null | undefined;
  },
) {
  const { requireAuth, requireAdmin, bunnyStorage, cdnUrl } = deps;

  /* ───────── catalog → database ───────── */

  async function syncCatalog(): Promise<{ added: number; updated: number; total: number }> {
    const catalog = libraryCatalog();
    const existing = await db.select({ id: libraryAssets.id, prompt: libraryAssets.prompt }).from(libraryAssets);
    const known = new Map(existing.map(r => [r.id, r.prompt]));
    let added = 0;
    let updated = 0;
    // Thousands of rows: write in chunks instead of one query per row.
    const CHUNK = 250;
    for (let i = 0; i < catalog.length; i += CHUNK) {
      const chunk = catalog.slice(i, i + CHUNK);
      for (const e of chunk) {
        if (!known.has(e.id)) added++;
        else if (known.get(e.id) !== e.prompt) updated++;
      }
      await db.insert(libraryAssets)
        .values(chunk.map(e => ({
          id: e.id, library: e.library, category: e.category, name: e.name, prompt: e.prompt, adult: e.adult,
          size: e.size, transparent: e.transparent, usage: e.usage, tags: e.tags, sortOrder: e.sortOrder,
        })))
        // Keep names / tags / prompts in step with the catalog. Status and the
        // image are left alone: changing a prompt does not silently spend
        // money — the admin regenerates that asset when they want the new look.
        .onConflictDoUpdate({
          target: libraryAssets.id,
          set: {
            library: sql`excluded.library`, category: sql`excluded.category`, name: sql`excluded.name`,
            prompt: sql`excluded.prompt`, adult: sql`excluded.adult`, size: sql`excluded.size`,
            transparent: sql`excluded.transparent`, usage: sql`excluded.usage`, tags: sql`excluded.tags`,
            sortOrder: sql`excluded.sort_order`, updatedAt: new Date(),
          },
        });
    }
    return { added, updated, total: catalog.length };
  }

  /* ───────── one asset ───────── */

  async function generateOne(asset: LibraryAsset): Promise<void> {
    await db.update(libraryAssets)
      .set({ status: "generating", attempts: (asset.attempts ?? 0) + 1, updatedAt: new Date() })
      .where(eq(libraryAssets.id, asset.id));
    try {
      const sourceUrl = await atlasGenerateLibraryImage({
        prompt: asset.prompt,
        size: asset.size || "1024x1536",
        transparent: !!asset.transparent,
      });
      assertPublicHttpsUrl(sourceUrl);
      const raw = await fetchImageWithLimits(sourceUrl, { maxBytes: 30 * 1024 * 1024, timeoutMs: 60_000 });
      // WebP keeps the alpha channel of cut-out costumes and is far smaller than PNG.
      const full = await sharp(raw).webp({ quality: 88 }).toBuffer();
      const thumb = await sharp(raw).resize({ width: 384, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      const meta = await sharp(raw).metadata();
      const safeId = asset.id.replace(/[^a-zA-Z0-9_-]+/g, "_");
      // A version suffix keeps CDN caches from serving the old picture after a regenerate.
      const version = Date.now().toString(36);
      const imageUrl = cdnUrl(await bunnyStorage.uploadBuffer(full, `library/${asset.library}/${safeId}_${version}.webp`));
      const thumbUrl = cdnUrl(await bunnyStorage.uploadBuffer(thumb, `library/${asset.library}/${safeId}_${version}_thumb.webp`));
      await db.update(libraryAssets).set({
        status: "ready", imageUrl: imageUrl ?? null, thumbUrl: thumbUrl ?? null,
        width: meta.width ?? null, height: meta.height ?? null, error: null, updatedAt: new Date(),
      }).where(eq(libraryAssets.id, asset.id));
    } catch (e) {
      const reason = shortError(e);
      run.lastError = reason;
      console.error(`[Library] ${asset.id} failed: ${reason}`);
      await db.update(libraryAssets).set({ status: "failed", error: reason, updatedAt: new Date() })
        .where(eq(libraryAssets.id, asset.id));
      throw e;
    }
  }

  /* ───────── batch runner ───────── */

  async function nextBatch(library: LibraryId | "all", limit: number): Promise<LibraryAsset[]> {
    const todo = and(
      library === "all" ? sql`true` : eq(libraryAssets.library, library),
      sql`(${libraryAssets.status} = 'pending' OR (${libraryAssets.status} = 'failed' AND ${libraryAssets.attempts} < ${MAX_ATTEMPTS}))`,
    );
    return db.select().from(libraryAssets).where(todo)
      .orderBy(asc(libraryAssets.library), asc(libraryAssets.sortOrder)).limit(limit);
  }

  async function runBatch(library: LibraryId | "all", target: number, concurrency: number) {
    Object.assign(run, {
      running: true, stopRequested: false, library, target, done: 0, failed: 0,
      startedAt: Date.now(), finishedAt: null, lastError: null,
    } satisfies RunState);
    try {
      // Rows left "generating" by a restart are not being worked on by anyone.
      await db.update(libraryAssets).set({ status: "pending" }).where(eq(libraryAssets.status, "generating"));
      while (!run.stopRequested && run.done + run.failed < target) {
        const remaining = target - run.done - run.failed;
        const batch = await nextBatch(library, Math.min(concurrency, remaining));
        if (batch.length === 0) break;
        const results = await Promise.allSettled(batch.map(generateOne));
        for (const r of results) r.status === "fulfilled" ? run.done++ : run.failed++;
        // The whole batch failing the same way means something is wrong with
        // the key or the provider: stop instead of burning through the queue.
        if (results.every(r => r.status === "rejected") && batch.length >= Math.min(2, concurrency)) {
          run.stopRequested = true;
        }
      }
    } catch (e) {
      run.lastError = "批次中斷：" + shortError(e);
      console.error("[Library] batch aborted:", e instanceof Error ? e.message : "unknown");
    } finally {
      run.running = false;
      run.finishedAt = Date.now();
    }
  }

  async function statusSummary() {
    const rows = await db.select({
      library: libraryAssets.library, status: libraryAssets.status, n: sql<number>`count(*)::int`,
    }).from(libraryAssets).groupBy(libraryAssets.library, libraryAssets.status);
    const byLibrary = LIBRARIES.map(l => {
      const mine = rows.filter(r => r.library === l.id);
      const count = (s: string) => mine.find(r => r.status === s)?.n ?? 0;
      const total = mine.reduce((n, r) => n + r.n, 0);
      return {
        id: l.id, label: l.label, total, ready: count("ready"), pending: count("pending"),
        generating: count("generating"), failed: count("failed"),
        inCatalog: libraryCatalog().filter(e => e.library === l.id).length,
      };
    });
    return {
      model: ATLAS_LIBRARY_MODEL,
      priceUsdPerImage: ATLAS_LIBRARY_PRICE_USD,
      configured: { atlas: atlasIsConfigured(), cdn: bunnyStorage.isConfigured() },
      libraries: byLibrary,
      run: { ...run },
    };
  }

  /* ───────── admin routes ───────── */

  const tableHint = "（若是第一次使用，請先在 Shell 執行 npm run db:push 建立資料表）";

  app.get("/api/admin/library/status", requireAuth, requireAdmin, async (_req, res) => {
    try { res.json(await statusSummary()); }
    catch { res.status(500).json({ error: "讀取圖庫狀態失敗" + tableHint }); }
  });

  app.post("/api/admin/library/sync", requireAuth, requireAdmin, async (_req, res) => {
    try { res.json(await syncCatalog()); }
    catch { res.status(500).json({ error: "同步清單失敗" + tableHint }); }
  });

  const generateBody = z.object({
    library: z.enum(["all", ...LIBRARY_IDS]).default("all"),
    /** Hard cap on images for this run — the spending limit. */
    limit: z.number().int().min(1).max(5000),
    concurrency: z.number().int().min(1).max(8).default(4),
  });

  app.post("/api/admin/library/generate", requireAuth, requireAdmin, async (req, res) => {
    const parsed = generateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "請指定圖庫與這次最多生成幾張（1–5000）。" });
    if (run.running) return res.status(409).json({ error: "已有一批正在生成，請先等它完成或按停止。" });
    if (!atlasIsConfigured()) return res.status(400).json({ error: "尚未設定 ATLASCLOUD_API_KEY，無法生成。" });
    if (!bunnyStorage.isConfigured()) return res.status(400).json({ error: "尚未設定 Bunny CDN，生成的圖沒有地方存放。" });
    const { library, limit, concurrency } = parsed.data;
    try {
      const waiting = (await nextBatch(library, 1)).length;
      if (waiting === 0) return res.status(400).json({ error: "這個圖庫沒有待生成的項目。若清單有更新，請先按「同步清單」。" });
    } catch {
      return res.status(500).json({ error: "讀取待生成項目失敗" + tableHint });
    }
    runBatch(library, limit, concurrency); // background; progress via /status
    res.json({ started: true, library, limit, estimatedMaxUsd: Number((limit * ATLAS_LIBRARY_PRICE_USD).toFixed(2)) });
  });

  app.post("/api/admin/library/stop", requireAuth, requireAdmin, (_req, res) => {
    if (run.running) run.stopRequested = true;
    res.json({ stopping: run.running });
  });

  /** Queue assets again (new picture on the next run). */
  const requeueBody = z.object({
    ids: z.array(z.string().max(200)).max(500).optional(),
    failedIn: z.enum(["all", ...LIBRARY_IDS]).optional(),
  }).refine(v => !!v.ids?.length || !!v.failedIn, "需要 ids 或 failedIn");

  app.post("/api/admin/library/requeue", requireAuth, requireAdmin, async (req, res) => {
    const parsed = requeueBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "請指定要重生的素材。" });
    try {
      const where = parsed.data.ids?.length
        ? inArray(libraryAssets.id, parsed.data.ids)
        : and(eq(libraryAssets.status, "failed"),
            parsed.data.failedIn === "all" ? sql`true` : eq(libraryAssets.library, parsed.data.failedIn as LibraryId));
      const rows = await db.update(libraryAssets)
        .set({ status: "pending", attempts: 0, error: null, updatedAt: new Date() })
        .where(where).returning({ id: libraryAssets.id });
      res.json({ requeued: rows.length });
    } catch {
      res.status(500).json({ error: "重新排入失敗。" });
    }
  });

  /* ───────── browsing (signed-in users) ───────── */

  const listQuery = z.object({
    library: z.enum(LIBRARY_IDS),
    category: z.string().max(60).optional(),
    q: z.string().max(60).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(120).default(60),
    /** Admin only: also list assets that have no picture yet. */
    includeUnready: z.enum(["0", "1"]).default("0"),
  });

  app.get("/api/library/assets", requireAuth, async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "查詢參數有誤。" });
    const { library, category, q, page, pageSize, includeUnready } = parsed.data;
    const isAdmin = !!(req.session as any)?.isAdmin;
    try {
      const filters = [eq(libraryAssets.library, library)];
      // Adult-flagged categories follow the same rule as the existing adult page: admins only.
      if (!isAdmin) filters.push(eq(libraryAssets.adult, false));
      if (!(isAdmin && includeUnready === "1")) filters.push(eq(libraryAssets.status, "ready"));
      if (category) filters.push(eq(libraryAssets.category, category));
      if (q?.trim()) filters.push(sql`(${libraryAssets.name} ILIKE ${"%" + q.trim() + "%"} OR ${q.trim()} = ANY(${libraryAssets.tags}))`);
      const where = and(...filters);

      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(libraryAssets).where(where);
      const items = await db.select({
        id: libraryAssets.id, library: libraryAssets.library, category: libraryAssets.category,
        name: libraryAssets.name, adult: libraryAssets.adult, usage: libraryAssets.usage, tags: libraryAssets.tags,
        imageUrl: libraryAssets.imageUrl, thumbUrl: libraryAssets.thumbUrl, width: libraryAssets.width,
        height: libraryAssets.height, status: libraryAssets.status, error: libraryAssets.error,
      }).from(libraryAssets).where(where)
        .orderBy(asc(libraryAssets.sortOrder)).limit(pageSize).offset((page - 1) * pageSize);

      const categoryFilters = [eq(libraryAssets.library, library)];
      if (!isAdmin) categoryFilters.push(eq(libraryAssets.adult, false));
      if (!(isAdmin && includeUnready === "1")) categoryFilters.push(eq(libraryAssets.status, "ready"));
      const categories = await db.select({
        category: libraryAssets.category, adult: sql<boolean>`bool_or(${libraryAssets.adult})`, n: sql<number>`count(*)::int`,
      }).from(libraryAssets).where(and(...categoryFilters))
        .groupBy(libraryAssets.category).orderBy(sql`min(${libraryAssets.sortOrder})`);

      res.json({ items, total: n, page, pageSize, categories });
    } catch {
      res.status(500).json({ error: "讀取圖庫失敗。" });
    }
  });
}

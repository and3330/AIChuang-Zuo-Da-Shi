/**
 * 作品庫 (Vault): every finished image and video of the signed-in user in one
 * list, whichever feature produced it (image tools, photo sets, the editor,
 * videos). Read-only — it derives everything from the existing generation
 * tables, so there is nothing to migrate.
 *
 * Also hosts a small same-origin image proxy for the editor: drawing a CDN
 * image onto a <canvas> and reading it back needs a same-origin (or CORS
 * enabled) source. Only our own CDN can be proxied.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { ImageGeneration, VideoGeneration } from "@shared/schema";
import { assertAllowedRemoteUrl, fetchImageWithLimits } from "./ssrfGuard";

export type VaultItem = {
  /** Stable within the vault: generation id plus image index. */
  id: string;
  kind: "image" | "video";
  url: string;
  prompt: string;
  /** Adult prompt: blur until the user asks to see it. */
  sensitive?: boolean;
  /** Which feature made it, for the filter chips. */
  source: "image" | "edit" | "photoset" | "video";
  generationId: string;
  createdAt: string | null;
};

const listQuery = z.object({
  kind: z.enum(["all", "image", "video"]).default("all"),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(120).default(60),
});

export function registerVaultRoutes(
  app: Express,
  deps: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
    getUserImageGenerations: (userId: string) => Promise<ImageGeneration[]>;
    getUserVideoGenerations: (userId: string) => Promise<VideoGeneration[]>;
    cdnUrl: (url: string | null | undefined) => string | null | undefined;
  },
) {
  const { requireAuth, cdnUrl } = deps;

  app.get("/api/vault", requireAuth, async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "查詢參數有誤。" });
    const { kind, page, pageSize } = parsed.data;
    const userId = req.session.userId!;
    try {
      const items: VaultItem[] = [];

      if (kind !== "video") {
        for (const g of await deps.getUserImageGenerations(userId)) {
          if (g.status !== "completed") continue;
          const urls = (g.bunnyImageUrls?.length ? g.bunnyImageUrls
            : g.bunnyImageUrl ? [g.bunnyImageUrl]
            : g.generatedImageUrls?.length ? g.generatedImageUrls
            : g.generatedImageUrl ? [g.generatedImageUrl] : [])
            .map(u => cdnUrl(u))
            .filter((u): u is string => !!u);
          const source: VaultItem["source"] = g.batchId ? "photoset" : g.type === "text-to-image" ? "image" : "edit";
          urls.forEach((url, i) => items.push({
            id: `${g.id}:${i}`, kind: "image", url, prompt: g.prompt ?? "", source, sensitive: !!g.sensitive,
            generationId: g.id, createdAt: g.createdAt ? new Date(g.createdAt).toISOString() : null,
          }));
        }
      }
      if (kind !== "image") {
        for (const v of await deps.getUserVideoGenerations(userId)) {
          if (v.status !== "completed") continue;
          const url = cdnUrl(v.bunnyVideoUrl) || v.generatedVideoUrl;
          if (!url) continue;
          items.push({
            id: v.id, kind: "video", url, prompt: v.prompt ?? "", source: "video",
            generationId: v.id, createdAt: v.createdAt ? new Date(v.createdAt).toISOString() : null,
          });
        }
      }

      items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
      res.json({
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        counts: { image: items.filter(i => i.kind === "image").length, video: items.filter(i => i.kind === "video").length },
        page, pageSize,
      });
    } catch (e) {
      console.error("Vault listing failed:", e instanceof Error ? e.message : "unknown");
      res.status(500).json({ error: "讀取作品庫失敗。" });
    }
  });

  /** Same-origin copy of one of our CDN images, for canvas work in the editor. */
  app.get("/api/vault/proxy", requireAuth, async (req, res) => {
    const url = typeof req.query.url === "string" ? req.query.url : "";
    try {
      const safe = assertAllowedRemoteUrl(url); // our CDN only
      const buf = await fetchImageWithLimits(safe.toString(), { maxBytes: 30 * 1024 * 1024, timeoutMs: 30_000 });
      const lower = safe.pathname.toLowerCase();
      res.setHeader("Content-Type", lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(buf);
    } catch {
      res.status(400).json({ error: "無法讀取這張圖片。" });
    }
  });
}

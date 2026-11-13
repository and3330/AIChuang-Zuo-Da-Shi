/**
 * Drama Studio extension routes:
 *   - Character library (CRUD + 4-view generation)
 *   - Scene library (CRUD)
 *   - Script upload & auto-import (TXT / DOCX → Claude → episodes)
 *   - AI video prompt rewriter
 *   - First / last keyframe generation
 *   - Per-episode ZIP download (all assets)
 */

import { outputLanguageNote } from "./lang";
import { FOUR_VIEW_COST, IMAGE_COST } from "@shared/pricing";
import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { ObjectStorageService } from "./objectStorage";
import { BunnyStorageService } from "./bunnyStorage";
import { plainImagePrompt } from "./promptEnhancer";
import {
  FOUR_VIEW_PRESETS, FOUR_VIEW_SIZE, fourViewPrompt, FRONT_FREE_RETRIES, frontConfirmStatus, frontRetriesUsed,
  type FourViewKey, type PhotoTags,
} from "@shared/fourViews";
import { motionPromptRequest, finishMotionPrompt } from "@shared/dramaMotion";
import {
  insertCharacterLibrarySchema,
  updateCharacterLibrarySchema,
  insertSceneLibrarySchema,
  updateSceneLibrarySchema,
  type FourViewUrls,
  users,
  characterLibrary,
} from "@shared/schema";
import { and, eq, isNull, like } from "drizzle-orm";
import { db } from "./db";
import { ATLAS_SEED_MODEL, createAtlasSeedClient } from "./atlasSeed";
import sharp from "sharp";
import archiver from "archiver";
import mammoth from "mammoth";
import { assertAllowedRemoteUrl, assertPublicHttpsUrl } from "./ssrfGuard";
import { atlasGenerateImage, atlasIsConfigured } from "./atlasProvider";


const FOUR_VIEW_CREDIT_COST = FOUR_VIEW_COST; // 4 images

export function registerDramaLibraryRoutes(
  app: Express,
  deps: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
    objectStorageService: ObjectStorageService;
    bunnyStorage: BunnyStorageService;
  }
) {
  const { requireAuth, objectStorageService, bunnyStorage } = deps;

  // ─── Helper: load a stored ref image as base64 data URL ────────────────────
  async function loadAsBase64(imageUrl: string): Promise<string> {
    if (imageUrl.startsWith("data:")) return imageUrl;
    if (imageUrl.startsWith("/objects/") || imageUrl.startsWith("/object-entities/")) {
      const objectFile = await objectStorageService.getObjectEntityFile(imageUrl);
      const chunks: Buffer[] = [];
      for await (const chunk of objectFile.createReadStream()) chunks.push(Buffer.from(chunk));
      return `data:image/jpeg;base64,${Buffer.concat(chunks).toString("base64")}`;
    }
    // Treat as remote URL (e.g. Bunny CDN). Validate against allowlist to prevent SSRF.
    const safeUrl = assertAllowedRemoteUrl(imageUrl);
    const resp = await fetch(safeUrl.toString(), { redirect: "error" });
    if (!resp.ok) throw new Error(`Failed to fetch ref image: ${imageUrl}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CHARACTER LIBRARY
  // ════════════════════════════════════════════════════════════════════════════

  app.get("/api/character-library", requireAuth, async (req, res) => {
    try {
      const list = await storage.getUserCharacters(req.session.userId!);
      res.json(list);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * Writes the character's appearance description from its photos (face shape,
   * features, hair, skin tone, build, distinguishing marks) so every later
   * generation can carry it in the prompt. Runs in the background after a
   * character is created without a description; never overwrites one the user
   * wrote. Failing is harmless: the character simply keeps an empty description.
   */
  async function describeCharacterFromPhotos(characterId: string, urls: string[], photoPrompts: string[] = []): Promise<void> {
    // Per-photo readings from the wizard (see /photo-tags): they cover every uploaded photo,
    // while only the first four images are looked at again here.
    const notes = photoPrompts.length > 0
      ? `以下是逐張判讀每一張上傳照片得到的外貌描述（共 ${photoPrompts.length} 張）。請以它們和下面的照片為依據，多張都提到的特徵優先採用，彼此矛盾時以照片為準：\n${photoPrompts.map((t, i) => `第 ${i + 1} 張：${t}`).join("\n")}\n\n`
      : "";
    try {
      const images: Array<{ type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }> = [];
      for (const url of urls.slice(0, 4)) {
        try {
          const dataUrl = await loadAsBase64(url);
          // Shrink and re-encode: keeps the request small and the media type always correct.
          const small = await sharp(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"))
            .rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
          images.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") } });
        } catch { /* skip a photo that cannot be read */ }
      }
      if (images.length === 0) return;
      const anthropic = createAtlasSeedClient();
      const resp = await anthropic.messages.create({
        model: ATLAS_SEED_MODEL,
        max_tokens: 400,
        messages: [{
          role: "user",
          content: [
            ...images,
            {
              type: "text",
              text: notes + "這些是同一個人的照片，之後要用來讓 AI 繪圖時畫得像這個人。請用繁體中文寫一段 80 到 150 字的外貌描述，只寫看得到的特徵：臉型、眉眼、鼻子、嘴唇、髮型與髮色、膚色、體型，以及明顯的特徵（例如痣、酒窩、眼鏡）。不要猜測姓名、身分、職業或年齡數字，不要描述服裝、背景與拍攝方式，不要加任何前言或結語，只輸出描述本身。",
            },
          ],
        }],
      });
      const text = ((resp.content.find((b: any) => b.type === "text") as any)?.text || "").trim().slice(0, 400);
      if (!text) return;
      const current = await storage.getCharacter(characterId);
      if (!current || (current.description ?? "").trim()) return;
      await storage.updateCharacter(characterId, { description: text } as any);
    } catch (e: any) {
      console.warn("[Character] could not describe from photos:", String(e?.message ?? e).slice(0, 120));
    }
  }

  // One description call per character at a time: the create route starts it, and the
  // four-view job waits for the same call so the front view is drawn with the description.
  const describing = new Map<string, Promise<void>>();
  function ensureDescription(characterId: string, urls: string[], photoPrompts: string[] = []): Promise<void> {
    let running = describing.get(characterId);
    if (!running) {
      running = describeCharacterFromPhotos(characterId, urls, photoPrompts).finally(() => describing.delete(characterId));
      describing.set(characterId, running);
    }
    return running;
  }

  /** The character's description, written from the photos first when it is still empty. Waits at most 25 seconds. */
  async function descriptionForGeneration(characterId: string, current: string | null | undefined, refUrls: string[]): Promise<string> {
    if ((current ?? "").trim()) return current!.trim();
    await Promise.race([ensureDescription(characterId, refUrls), new Promise(resolve => setTimeout(resolve, 25_000))]);
    const fresh = await storage.getCharacter(characterId);
    return (fresh?.description ?? "").trim();
  }

  /**
   * Generates the given views one after another and stores each on Bunny CDN.
   * `frontUrl` is the finished front view: every other view gets it as reference 1, ahead of
   * the person's own photos, so all views wear the same outfit. When "front" is among `keys`
   * it is made first and becomes that reference. `fileTag` makes the stored file name unique
   * (a regenerated front view must not be served from the CDN cache of the old one).
   */
  async function generateViews(opts: {
    character: { id: string; name: string; styleHint: string | null };
    description: string;
    keys: FourViewKey[];
    refUrls: string[];
    userFolder: string;
    frontUrl?: string;
    fileTag?: string;
    onView?: (soFar: FourViewUrls) => Promise<void>;
  }): Promise<{ results: FourViewUrls; succeeded: number }> {
    const { character } = opts;
    // A character pack can hold up to 30 images; the edit model uses 10.
    const refBase64s = await Promise.all(opts.refUrls.slice(0, 10).map(loadAsBase64));
    const results: FourViewUrls = {};
    let succeeded = 0;
    let frontViewUrl = opts.frontUrl ?? "";
    for (const preset of FOUR_VIEW_PRESETS.filter(p => opts.keys.includes(p.key))) {
      try {
        const chained = preset.key !== "front" && !!frontViewUrl;
        const plainPrompt = fourViewPrompt(preset.promptZh, opts.description, character.styleHint, chained ? Math.min(10, refBase64s.length + 1) : refBase64s.length);
        const fullPrompt = chained
          ? `${plainPrompt}（第 1 張參考圖是這個角色已完成的正面定裝圖：服裝、鞋子、髮型與體型必須和它完全一樣。其餘參考圖是本人的照片，用來保持臉部五官一致。）`
          : plainPrompt;
        const viewImages = chained ? [frontViewUrl, ...refBase64s.slice(0, 9)] : refBase64s;
        const imageUrl = await atlasGenerateImage({
          prompt: fullPrompt,
          images: (viewImages.length === 1 ? viewImages[0] : viewImages) as any,
          size: FOUR_VIEW_SIZE,
        });
        if (preset.key === "front") frontViewUrl = imageUrl;

        let storedUrl = imageUrl;
        if (bunnyStorage.isConfigured()) {
          try {
            const safe = assertPublicHttpsUrl(imageUrl);
            const imgResp = await fetch(safe.toString(), { redirect: "error" });
            const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
            const remotePath = `users/${opts.userFolder}/character-library/${character.id}_${preset.key}${opts.fileTag ?? ""}.jpg`;
            storedUrl = await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
          } catch (e) {
            console.warn(`[CharLib] Bunny upload failed for ${preset.key}:`, e);
          }
        }
        results[preset.key] = storedUrl;
        succeeded++;
        if (opts.onView) await opts.onView({ ...results });
        console.log(`✅ Character ${character.name} 四視圖 ${preset.key} 完成`);
      } catch (viewErr: any) {
        console.error(`❌ Character ${character.name} ${preset.key} 失敗:`, viewErr.message);
      }
    }
    return { results, succeeded };
  }

  async function refundCredits(userId: string, amount: number, description: string): Promise<void> {
    const u = await storage.getUser(userId);
    const balance = (u?.credits ?? 0) + amount;
    await storage.updateUserCredits(userId, balance);
    await storage.createCreditTransaction({ userId, type: "refund", amount, balance, description });
  }

  /** Moves a character out of "waiting for front-view confirmation" into "generating". Null when it was not waiting. */
  async function claimFrontConfirm(id: string, userId: string) {
    const [claimed] = await db.update(characterLibrary)
      .set({ fourViewStatus: "generating", fourViewError: null, updatedAt: new Date() })
      .where(and(eq(characterLibrary.id, id), eq(characterLibrary.userId, userId), like(characterLibrary.fourViewStatus, "confirm%")))
      .returning();
    return claimed ?? null;
  }

  // ─── AI labels for one uploaded photo (shown in the character wizard) ───────
  // Free for the person, so it is capped per account.
  const photoTagCalls = new Map<string, number[]>();
  const PHOTO_TAG_LIMIT = 60;
  const PHOTO_TAG_WINDOW_MS = 10 * 60 * 1000;
  const PHOTO_ANGLES = ["front_face", "three_quarter", "side", "full_body", "back", "other"];
  const PHOTO_QUALITIES = ["good", "fair", "poor"];

  app.post("/api/character-library/photo-tags", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      const english = req.body?.lang === "en";
      if (!url || url.length > 2000 || url.startsWith("data:")) return res.status(400).json({ error: "缺少照片。" });
      if (!atlasIsConfigured()) return res.status(500).json({ error: "ATLASCLOUD_API_KEY 未設定" });

      const now = Date.now();
      const recent = (photoTagCalls.get(userId) ?? []).filter(t => now - t < PHOTO_TAG_WINDOW_MS);
      if (recent.length >= PHOTO_TAG_LIMIT) return res.status(429).json({ error: "照片判讀次數太多，請稍後再試。" });
      recent.push(now);
      photoTagCalls.set(userId, recent);

      const dataUrl = await loadAsBase64(url);
      const small = await sharp(Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"))
        .rotate().resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      const anthropic = createAtlasSeedClient();
      const resp = await anthropic.messages.create({
        model: ATLAS_SEED_MODEL,
        max_tokens: 700,
        temperature: 0.2,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") } },
            {
              type: "text",
              text: `這張照片要當作 AI 繪圖的人物參考圖，用來把這個人畫得像本人。請仔細看這張照片，只輸出一個 JSON 物件，不要有其他文字：
{"angle": "...", "quality": "...", "issue": "...", "tags": ["...", "..."], "prompt": "..."}
angle 只能是：front_face（臉部正面，五官完整看得到）、three_quarter（臉轉約 45 度）、side（側臉）、full_body（全身入鏡）、back（背面）、other（看不到人或無法判斷）。同時是全身又是正面時，臉夠清楚選 front_face，臉很小選 full_body。
quality 只能是：good（臉清楚、光線足、沒有遮擋）、fair（可以用但不理想）、poor（模糊、太暗、臉被遮住、戴墨鏡或口罩、濾鏡或美顏很重、臉太小、畫面裡不只一個人、或根本不是真人照片）。
issue：quality 不是 good 時，用一句 15 字以內的話說明原因；good 時給空字串。
tags：4 到 6 個簡短標籤，只寫這個人本身的外貌特徵（臉型、眼睛、眉毛、鼻子、嘴唇、膚色、髮型、髮色、痣、酒窩、眼鏡等），不要寫衣服、背景或拍攝方式。
prompt：一段 60 到 120 字的完整外貌描述，可以直接放進繪圖提示詞讓 AI 畫出同一個人。依序寫這張照片裡看得到的：臉型與輪廓、眼型與眼距、眉形、鼻子、嘴唇、膚色與膚質、髮型髮長與髮色、體型，以及痣、酒窩、眼鏡等明顯特徵。這張照片看不清楚的部位就不要寫，不要編造。不要寫衣服、飾品、背景、姿勢、光線與拍攝方式。
不要猜測姓名、身分、職業、種族或年齡數字。
issue、tags 與 prompt 請用${english ? "英文" : "繁體中文"}書寫。`,
            },
          ],
        }],
      });
      const text = ((resp.content.find((b: any) => b.type === "text") as any)?.text || "").trim();
      let parsed: any = null;
      try { parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* handled below */ }
      if (!parsed || typeof parsed !== "object") return res.status(502).json({ error: "照片判讀失敗，請稍後再試。" });
      const tags: PhotoTags = {
        angle: PHOTO_ANGLES.includes(parsed.angle) ? parsed.angle : "other",
        quality: PHOTO_QUALITIES.includes(parsed.quality) ? parsed.quality : "fair",
        issue: typeof parsed.issue === "string" ? parsed.issue.trim().slice(0, 80) : "",
        tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t: any) => typeof t === "string" && t.trim()).map((t: string) => t.trim().slice(0, 24)).slice(0, 6) : [],
        prompt: typeof parsed.prompt === "string" ? parsed.prompt.trim().slice(0, 400) : "",
      };
      if (tags.quality === "good") tags.issue = "";
      res.json(tags);
    } catch (e: any) {
      console.warn("[Character] photo tags failed:", String(e?.message ?? e).slice(0, 120));
      res.status(502).json({ error: "照片判讀失敗，請稍後再試。" });
    }
  });

  app.post("/api/character-library", requireAuth, async (req, res) => {
    try {
      const data = insertCharacterLibrarySchema.parse(req.body);
      const c = await storage.createCharacter({ ...data, userId: req.session.userId! });
      res.json(c);
      if (!(c.description ?? "").trim() && (c.refImageUrls?.length ?? 0) > 0) {
        // The wizard sends what the AI read from each photo; the description is written from all of them.
        const photoPrompts = Array.isArray(req.body?.photoPrompts)
          ? req.body.photoPrompts.filter((t: unknown) => typeof t === "string" && t.trim()).map((t: string) => t.trim().slice(0, 400)).slice(0, 10)
          : [];
        void ensureDescription(c.id, c.refImageUrls ?? [], photoPrompts);
      }
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/character-library/:id", requireAuth, async (req, res) => {
    try {
      const c = await storage.getCharacter(req.params.id);
      if (!c || c.userId !== req.session.userId!) return res.status(404).json({ error: "找不到角色" });
      res.json(c);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/character-library/:id", requireAuth, async (req, res) => {
    try {
      const c = await storage.getCharacter(req.params.id);
      if (!c || c.userId !== req.session.userId!) return res.status(404).json({ error: "找不到角色" });
      const updates = updateCharacterLibrarySchema.parse(req.body);
      const updated = await storage.updateCharacter(req.params.id, updates as any);
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/character-library/:id", requireAuth, async (req, res) => {
    try {
      const c = await storage.getCharacter(req.params.id);
      if (!c || c.userId !== req.session.userId!) return res.status(404).json({ error: "找不到角色" });
      await storage.deleteCharacter(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Generate four-view turnaround sheet ───────────────────────────────────
  app.post("/api/character-library/:id/generate-four-views", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const character = await storage.getCharacter(req.params.id);
      if (!character || character.userId !== userId) return res.status(404).json({ error: "找不到角色" });

      const refUrls = character.refImageUrls ?? [];
      if (refUrls.length === 0) {
        return res.status(400).json({ error: "請先上傳至少一張角色參考圖" });
      }
      // The character wizard asks for the front view alone first; the other three follow
      // after the person confirms it looks like them (see /four-views/confirm).
      const frontFirst = req.body?.frontFirst === true;

      if (!atlasIsConfigured()) return res.status(500).json({ error: "ATLASCLOUD_API_KEY 未設定" });

      // Atomic compare-and-set: claim the in-flight slot before deducting
      // credits. Concurrent duplicate requests get rejected here without ever
      // reaching the deduction step, so the user can never be charged twice.
      const claim = await storage.claimCharacterFourViewGeneration(req.params.id, userId);
      if (!claim.ok) {
        return res.status(409).json({ error: "此角色的四視圖正在生成中，請稍後" });
      }
      const previousStatus = claim.previousStatus ?? null;

      // Every account gets one 四視圖 generation free (meant for its first character).
      // Claimed with a compare-and-set so two requests cannot both be free. Partner
      // workspaces (embed mode) are not people and do not get it.
      let free = false;
      if (!(req.session as any).embed) {
        const claimed = await db.update(users).set({ freeFourViewUsedAt: new Date() })
          .where(and(eq(users.id, userId), isNull(users.freeFourViewUsedAt))).returning({ id: users.id });
        free = claimed.length > 0;
      }

      // Atomic deduction guards against negative balance.
      try {
        if (!free) await storage.atomicDeductCredits(
          userId,
          FOUR_VIEW_CREDIT_COST,
          `角色「${character.name}」四視圖生成（4 張）`
        );
      } catch (deductErr: any) {
        // Restore the prior status — if the user already had completed
        // four-view URLs we must not downgrade their status to "idle".
        await storage.releaseCharacterFourViewGeneration(req.params.id, previousStatus);
        return res.status(400).json({ error: deductErr.message || `積分不足，需要 ${FOUR_VIEW_CREDIT_COST} 積分` });
      }
      const user = await storage.getUser(userId);
      res.json({ ok: true, creditsUsed: free ? 0 : FOUR_VIEW_CREDIT_COST, free });

      // ── Async background work ────────────────────────────────────────────────
      (async () => {
        try {
          const userFolder = user?.username || userId;
          const description = await descriptionForGeneration(character.id, character.description, refUrls);
          const { results, succeeded } = await generateViews({
            character, description, refUrls, userFolder,
            keys: frontFirst ? ["front"] : FOUR_VIEW_PRESETS.map(p => p.key),
            onView: soFar => storage.updateCharacter(character.id, { fourViewUrls: soFar } as any).then(() => undefined),
          });

          if (succeeded === 0) {
            if (free) {
              // Nothing was charged: give the free generation back instead.
              await db.update(users).set({ freeFourViewUsedAt: null }).where(eq(users.id, userId));
            } else {
              await refundCredits(userId, FOUR_VIEW_CREDIT_COST, `角色「${character.name}」四視圖生成失敗退款`);
            }
            await storage.updateCharacter(character.id, {
              fourViewStatus: "failed",
              fourViewError: "全部視圖生成失敗",
            } as any);
          } else {
            await storage.updateCharacter(character.id, {
              // Front view only: wait for the person to confirm the likeness before the other three.
              fourViewStatus: frontFirst ? frontConfirmStatus(0) : "completed",
              fourViewUrls: results,
            } as any);
          }
        } catch (e: any) {
          console.error("[CharLib] four-view generation failed:", e);
          await storage.updateCharacter(req.params.id, {
            fourViewStatus: "failed",
            fourViewError: e.message,
          } as any);
        }
      })().catch(console.error);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Front view confirmed: generate the other three views ──────────────────
  // Already paid for (or free) when the front view was started; nothing is charged here.
  app.post("/api/character-library/:id/four-views/confirm", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      if (!atlasIsConfigured()) return res.status(500).json({ error: "ATLASCLOUD_API_KEY 未設定" });
      const before = await storage.getCharacter(req.params.id);
      if (!before || before.userId !== userId) return res.status(404).json({ error: "找不到角色" });
      const character = await claimFrontConfirm(req.params.id, userId);
      if (!character) return res.status(409).json({ error: "這個角色目前沒有待確認的正面圖。" });
      const front =((character.fourViewUrls ?? {}) as FourViewUrls).front;
      const refUrls = character.refImageUrls ?? [];
      if (!front || refUrls.length === 0) {
        await storage.updateCharacter(character.id, { fourViewStatus: "idle" } as any);
        return res.status(400).json({ error: "找不到正面圖，請重新生成四視圖。" });
      }
      const user = await storage.getUser(userId);
      res.json({ ok: true });

      (async () => {
        const waiting = frontConfirmStatus(frontRetriesUsed(before.fourViewStatus));
        try {
          const description = await descriptionForGeneration(character.id, character.description, refUrls);
          const { results, succeeded } = await generateViews({
            character, description, refUrls, userFolder: user?.username || userId,
            keys: ["threeQuarter", "side", "back"], frontUrl: front,
            onView: soFar => storage.updateCharacter(character.id, { fourViewUrls: { front, ...soFar } } as any).then(() => undefined),
          });
          if (succeeded === 0) {
            // Nothing new was made: stay on the confirmation step so it can be pressed again for free.
            await storage.updateCharacter(character.id, { fourViewStatus: waiting, fourViewUrls: { front }, fourViewError: "其餘三張生成失敗，請再按一次確認。" } as any);
          } else {
            await storage.updateCharacter(character.id, { fourViewStatus: "completed", fourViewUrls: { front, ...results } } as any);
          }
        } catch (e: any) {
          console.error("[CharLib] remaining views failed:", e);
          await storage.updateCharacter(character.id, { fourViewStatus: waiting, fourViewUrls: { front }, fourViewError: "其餘三張生成失敗，請再按一次確認。" } as any);
        }
      })().catch(console.error);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Front view does not look like the person: make it again ───────────────
  // The first FRONT_FREE_RETRIES are free, after that one image's credits each.
  // `mainPhoto` (one of the character's own photos) can be moved to first place first.
  app.post("/api/character-library/:id/four-views/retry-front", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      if (!atlasIsConfigured()) return res.status(500).json({ error: "ATLASCLOUD_API_KEY 未設定" });
      const before = await storage.getCharacter(req.params.id);
      if (!before || before.userId !== userId) return res.status(404).json({ error: "找不到角色" });
      const mainPhoto = typeof req.body?.mainPhoto === "string" ? req.body.mainPhoto : "";
      if (mainPhoto && !(before.refImageUrls ?? []).includes(mainPhoto)) return res.status(400).json({ error: "這張照片不在角色圖庫裡。" });
      if ((before.refImageUrls ?? []).length === 0) return res.status(400).json({ error: "請先上傳至少一張角色參考圖" });

      const character = await claimFrontConfirm(req.params.id, userId);
      if (!character) return res.status(409).json({ error: "這個角色目前沒有待確認的正面圖。" });
      const used = frontRetriesUsed(before.fourViewStatus);
      const oldFront = ((character.fourViewUrls ?? {}) as FourViewUrls).front;
      const charged = used >= FRONT_FREE_RETRIES;
      if (charged) {
        try {
          await storage.atomicDeductCredits(userId, IMAGE_COST, `角色「${character.name}」正面圖重新生成`);
        } catch (deductErr: any) {
          await storage.updateCharacter(character.id, { fourViewStatus: before.fourViewStatus } as any);
          return res.status(400).json({ error: deductErr.message || `積分不足，需要 ${IMAGE_COST} 積分` });
        }
      }
      let refUrls = character.refImageUrls ?? [];
      if (mainPhoto && refUrls[0] !== mainPhoto) {
        refUrls = [mainPhoto, ...refUrls.filter(u => u !== mainPhoto)];
        await storage.updateCharacter(character.id, { refImageUrls: refUrls } as any);
      }
      const user = await storage.getUser(userId);
      res.json({ ok: true, creditsUsed: charged ? IMAGE_COST : 0, freeLeft: Math.max(0, FRONT_FREE_RETRIES - used - 1) });

      (async () => {
        const giveBack = async (message: string) => {
          if (charged) await refundCredits(userId, IMAGE_COST, `角色「${character.name}」正面圖重新生成失敗退款`);
          await storage.updateCharacter(character.id, {
            fourViewStatus: frontConfirmStatus(used), fourViewError: message,
            ...(oldFront ? { fourViewUrls: { front: oldFront } } : {}),
          } as any);
        };
        try {
          const description = await descriptionForGeneration(character.id, character.description, refUrls);
          const { results, succeeded } = await generateViews({
            character, description, refUrls, userFolder: user?.username || userId,
            keys: ["front"], fileTag: `_r${Date.now()}`,
          });
          if (succeeded === 0 || !results.front) return await giveBack("正面圖重新生成失敗，沒有算次數，請再試一次。");
          await storage.updateCharacter(character.id, { fourViewStatus: frontConfirmStatus(used + 1), fourViewUrls: { front: results.front } } as any);
        } catch (e: any) {
          console.error("[CharLib] front view retry failed:", e);
          await giveBack("正面圖重新生成失敗，沒有算次數，請再試一次。");
        }
      })().catch(console.error);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SCENE LIBRARY (lightweight CRUD; no AI generation)
  // ════════════════════════════════════════════════════════════════════════════

  app.get("/api/scene-library", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getUserSceneLibrary(req.session.userId!));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/scene-library", requireAuth, async (req, res) => {
    try {
      const data = insertSceneLibrarySchema.parse(req.body);
      res.json(await storage.createSceneLibraryItem({ ...data, userId: req.session.userId! }));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/scene-library/:id", requireAuth, async (req, res) => {
    try {
      const s = await storage.getSceneLibraryItem(req.params.id);
      if (!s || s.userId !== req.session.userId!) return res.status(404).json({ error: "找不到場景" });
      const updates = updateSceneLibrarySchema.parse(req.body);
      res.json(await storage.updateSceneLibraryItem(req.params.id, updates as any));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/scene-library/:id", requireAuth, async (req, res) => {
    try {
      const s = await storage.getSceneLibraryItem(req.params.id);
      if (!s || s.userId !== req.session.userId!) return res.status(404).json({ error: "找不到場景" });
      await storage.deleteSceneLibraryItem(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SCRIPT IMPORT (TXT / DOCX → Claude → suggested episodes & characters)
  // ════════════════════════════════════════════════════════════════════════════

  app.post("/api/drama/projects/:projectId/import-script", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const project = await storage.getDramaProject(req.params.projectId);
      if (!project || project.userId !== userId) return res.status(404).json({ error: "找不到專案" });

      const { scriptText, fileBase64, fileName, episodeCount = 3, scenesPerEpisode = 6 } = req.body as {
        scriptText?: string;
        fileBase64?: string;
        fileName?: string;
        episodeCount?: number;
        scenesPerEpisode?: number;
      };

      // Hard limits to protect Claude context + memory
      const MAX_FILE_BYTES = 2 * 1024 * 1024;   // 2 MB raw upload
      const MAX_TEXT_CHARS = 30000;             // ~30K chars after parse

      let rawText = (scriptText || "").trim();
      if (!rawText && fileBase64) {
        const buffer = Buffer.from(fileBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
        if (buffer.length > MAX_FILE_BYTES) {
          return res.status(400).json({
            error: `檔案太大（${(buffer.length / 1024 / 1024).toFixed(1)} MB），上限 2 MB，請分段上傳。`
          });
        }
        const lowerName = fileName?.toLowerCase() ?? "";
        if (lowerName.endsWith(".docx")) {
          try {
            const result = await mammoth.extractRawText({ buffer });
            rawText = result.value.trim();
          } catch (parseErr: any) {
            return res.status(400).json({ error: `DOCX 解析失敗：${parseErr.message || "檔案可能損毀"}` });
          }
        } else if (lowerName.endsWith(".pdf")) {
          // pdf-parse-fork is the maintained ESM-friendly fork of pdf-parse;
          // it returns { text } for the whole document. Wrap in try so a
          // password-protected or scanned-image PDF doesn't 500.
          try {
            // @ts-ignore — pdf-parse-fork has no bundled .d.ts; we cast result to any.
            const pdfMod: any = await import("pdf-parse-fork");
            const pdfParse = pdfMod.default || pdfMod;
            const result = await pdfParse(buffer);
            rawText = (result?.text || "").trim();
            if (!rawText) {
              return res.status(400).json({
                error: "PDF 內容無法擷取（可能是掃描檔或加密檔），請改用 TXT/DOCX。"
              });
            }
          } catch (parseErr: any) {
            return res.status(400).json({ error: `PDF 解析失敗：${parseErr.message || "檔案可能損毀"}` });
          }
        } else {
          rawText = buffer.toString("utf-8").trim();
        }
      }
      if (!rawText) return res.status(400).json({ error: "請提供劇本文字或檔案" });
      if (rawText.length > MAX_TEXT_CHARS) {
        return res.status(400).json({
          error: `劇本文字太長（${rawText.length.toLocaleString()} 字），上限 ${MAX_TEXT_CHARS.toLocaleString()} 字，請分段上傳或先濃縮大綱。`
        });
      }

      if (!atlasIsConfigured()) return res.status(500).json({ error: "ATLASCLOUD_API_KEY 未設定" });

      const anthropic = createAtlasSeedClient();

      const prompt = `你是抖音/TikTok 直式短劇（漫劇）的資深編劇與分鏡導演。請把以下故事原文改寫為可拍的短劇分鏡腳本。

【規則】
1. 共 ${episodeCount} 集，每集 ${scenesPerEpisode} 幕
2. 每幕都要有：title（10 字內）、description（場景視覺描述，30-60 字）、dialogue（角色台詞，可空）、cameraMovement（運鏡，例如「推鏡」「環繞」）、useCharA、useCharB（哪些主角出場）
3. 同時抽取 1-3 位主要角色，給每位角色：name、description（外型/個性 30-50 字）
4. 只輸出 JSON，不要其他文字、不要 markdown code block
5. 全部用繁體中文

【輸出格式】
{
  "characters": [
    { "name": "角色名", "description": "外型與個性描述" }
  ],
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "本集標題",
      "scenes": [
        {
          "title": "幕標題",
          "description": "場景視覺描述",
          "dialogue": "角色台詞或留空",
          "cameraMovement": "運鏡建議",
          "useCharA": true,
          "useCharB": false
        }
      ]
    }
  ]
}

【原始故事】
${rawText}`;

      const claudeResp = await anthropic.messages.create({
        model: ATLAS_SEED_MODEL,
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt + outputLanguageNote(req) }],
      });

      const textBlock = claudeResp.content.find((b: any) => b.type === "text") as any;
      let jsonText = (textBlock?.text || "").trim();
      // strip code fences if Claude added any
      jsonText = jsonText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const startIdx = jsonText.indexOf("{");
      const endIdx = jsonText.lastIndexOf("}");
      if (startIdx >= 0 && endIdx > startIdx) jsonText = jsonText.slice(startIdx, endIdx + 1);

      let parsed: any;
      try {
        parsed = JSON.parse(jsonText);
      } catch (parseErr: any) {
        console.error("[ScriptImport] JSON parse failed:", parseErr.message, "raw:", jsonText.slice(0, 500));
        return res.status(500).json({ error: "AI 回傳格式錯誤，請重試" });
      }

      // Auto-create characters in library
      const createdCharacters: any[] = [];
      for (const ch of parsed.characters ?? []) {
        if (!ch?.name) continue;
        const c = await storage.createCharacter({
          userId,
          name: String(ch.name).slice(0, 60),
          description: String(ch.description ?? "").slice(0, 600),
          refImageUrls: [],
          styleHint: "",
        });
        createdCharacters.push(c);
      }

      // Build episodes
      const createdEpisodes: any[] = [];
      let nextNum = (project.episodeCount ?? 0) + 1;
      for (const ep of parsed.episodes ?? []) {
        const sceneArr = (ep.scenes ?? []).map((s: any, idx: number) => ({
          id: `${Date.now()}-${nextNum}-${idx}`,
          sceneNumber: idx + 1,
          title: String(s.title ?? `第 ${idx + 1} 幕`).slice(0, 40),
          description: String(s.description ?? "").slice(0, 600),
          dialogue: String(s.dialogue ?? "").slice(0, 300),
          cameraMovement: String(s.cameraMovement ?? "").slice(0, 60),
          useCharA: s.useCharA !== false,
          useCharB: s.useCharB === true,
          imageStatus: "pending" as const,
          videoDuration: 5,
          videoResolution: "720p" as const,
        }));
        if (sceneArr.length < 2) continue;

        const newEp = await storage.createDramaEpisode({
          projectId: project.id,
          userId,
          episodeNumber: nextNum,
          title: String(ep.title ?? `第 ${nextNum} 集`).slice(0, 60),
          scenes: JSON.stringify(sceneArr),
          sceneCount: sceneArr.length,
        });
        createdEpisodes.push(newEp);
        nextNum++;
      }

      res.json({
        ok: true,
        charactersCreated: createdCharacters.length,
        episodesCreated: createdEpisodes.length,
        characters: createdCharacters,
        episodes: createdEpisodes,
      });
    } catch (e: any) {
      console.error("[ScriptImport] failed:", e);
      res.status(500).json({ error: e.message || "劇本匯入失敗" });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // AI VIDEO PROMPT REWRITER (Claude)
  // ════════════════════════════════════════════════════════════════════════════

  app.post("/api/drama/episodes/:episodeId/scenes/:sceneIdx/generate-video-prompt", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== userId) return res.status(404).json({ error: "找不到集數" });

      const sceneIdx = parseInt(req.params.sceneIdx);
      const scenes: any[] = JSON.parse(episode.scenes);
      if (sceneIdx < 0 || sceneIdx >= scenes.length) return res.status(400).json({ error: "幕索引超出範圍" });
      const scene = scenes[sceneIdx];

      if (!atlasIsConfigured()) return res.status(500).json({ error: "ATLASCLOUD_API_KEY 未設定" });

      const anthropic = createAtlasSeedClient();

      // Always pass prev/next scene context to Claude so rewriter understands
      // the episode timeline. Chain Mode adds extra "must bridge" requirements.
      const episodeChainOn = !!episode.chainMode;
      const ov = scene?.chainModeOverride ?? "inherit";
      const sceneChainOn = ov === "on" ? true : ov === "off" ? false : episodeChainOn;
      const prevScene = sceneIdx > 0 ? scenes[sceneIdx - 1] : null;
      const nextScene = sceneIdx + 1 < scenes.length ? scenes[sceneIdx + 1] : null;

      const hasLastFrame = !!(scene.useFirstLastFrame && (scene.lastFrameBunnyUrl || scene.lastFrameUrl));
      const prompt = motionPromptRequest({ scene, prev: prevScene, next: nextScene, chain: sceneChainOn, hasLastFrame });

      const claudeResp = await anthropic.messages.create({
        model: ATLAS_SEED_MODEL,
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = claudeResp.content.find((b: any) => b.type === "text") as any;
      const videoPrompt = finishMotionPrompt(textBlock?.text || "");
      if (!videoPrompt) return res.status(500).json({ error: "AI 未產生提示詞" });

      scenes[sceneIdx].videoPrompt = videoPrompt;
      await storage.updateDramaEpisode(req.params.episodeId, { scenes: JSON.stringify(scenes) });
      res.json({ ok: true, videoPrompt });
    } catch (e: any) {
      console.error("[VideoPrompt] failed:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // FIRST / LAST KEYFRAME GENERATION (creates two more images per scene)
  // ════════════════════════════════════════════════════════════════════════════

  app.post("/api/drama/episodes/:episodeId/scenes/:sceneIdx/generate-frames", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== userId) return res.status(404).json({ error: "找不到集數" });
      const sceneIdx = parseInt(req.params.sceneIdx);
      const scenes: any[] = JSON.parse(episode.scenes);
      if (sceneIdx < 0 || sceneIdx >= scenes.length) return res.status(400).json({ error: "幕索引超出範圍" });
      const scene = scenes[sceneIdx];

      if (!atlasIsConfigured()) return res.status(500).json({ error: "ATLASCLOUD_API_KEY 未設定" });

      const FRAME_COST = 2 * IMAGE_COST; // 2 frames

      const project = await storage.getDramaProject(episode.projectId);
      if (!project) return res.status(404).json({ error: "找不到專案" });

      // Atomic compare-and-set inside a row-locked transaction: claim the
      // in-flight slot for this scene's frames before deducting credits.
      // Concurrent duplicate requests get rejected with 409 here.
      const claim = await storage.claimSceneFrameGeneration(req.params.episodeId, sceneIdx, userId);
      if (!claim.ok) {
        if (claim.reason === "in_flight") {
          return res.status(409).json({ error: "此幕的首尾幀正在生成中，請稍後" });
        }
        return res.status(400).json({ error: "claim 失敗" });
      }
      const previousFirstStatus = claim.previousFirstStatus ?? null;
      const previousLastStatus = claim.previousLastStatus ?? null;

      try {
        await storage.atomicDeductCredits(
          userId,
          FRAME_COST,
          `漫劇第 ${sceneIdx + 1} 幕首尾關鍵幀生成`
        );
      } catch (deductErr: any) {
        // Restore the prior status — preserves any prior completed/failed
        // state instead of clobbering it to "idle" on insufficient credits.
        await storage.releaseSceneFrameGeneration(
          req.params.episodeId,
          sceneIdx,
          previousFirstStatus,
          previousLastStatus,
        );
        return res.status(400).json({ error: deductErr.message || `積分不足，需要 ${FRAME_COST} 積分` });
      }
      const user = await storage.getUser(userId);
      // Refresh the in-memory `scenes` array so subsequent code sees the
      // generating status that was set inside the claim transaction.
      const refreshed = await storage.getDramaEpisode(req.params.episodeId);
      if (refreshed) {
        try { scenes.splice(0, scenes.length, ...JSON.parse(refreshed.scenes)); } catch { /* keep stale */ }
      }
      res.json({ ok: true, creditsUsed: FRAME_COST });

      (async () => {
        try {
          const sceneSizeMap: Record<string, string> = {
            "1:1": "2048x2048", "9:16": "1440x2560", "16:9": "2560x1440",
          };
          const imageSize = sceneSizeMap[project.sceneSize ?? "9:16"] || "1440x2560";

          // Build the same character/style ref base64 list as main scene image
          const charABase64s = await Promise.all((project.characterAUrls ?? []).map(loadAsBase64));
          const charBBase64s = await Promise.all((project.characterBUrls ?? []).map(loadAsBase64));
          const styleBase64s = await Promise.all((project.styleImageUrls ?? []).map(loadAsBase64));
          const useA = scene.useCharA !== false;
          const useB = scene.useCharB !== false;

          // Chain Mode: prepend previous scene's last frame so the first frame
          // of *this* scene visually picks up where scene N-1 ended. Honors
          // the per-scene chainRefCustomUrl / chainRefSource override.
          const episodeChainOn = !!episode.chainMode;
          const ov = scene?.chainModeOverride ?? "inherit";
          const sceneChainOn = ov === "on" ? true : ov === "off" ? false : episodeChainOn;
          const resolveContinuityUrl = (prev: any, curr: any): string | null => {
            const fallback =
              prev?.lastFrameBunnyUrl
                || prev?.lastFrameUrl
                || prev?.bunnyUrl
                || prev?.imageUrl
                || null;
            if (curr?.chainRefCustomUrl) return curr.chainRefCustomUrl;
            const src = curr?.chainRefSource ?? "auto";
            switch (src) {
              case "prevLast":
                return prev?.lastFrameBunnyUrl || prev?.lastFrameUrl || fallback;
              case "prevFirst":
                return prev?.firstFrameBunnyUrl || prev?.firstFrameUrl || fallback;
              case "prevMain":
                return prev?.bunnyUrl || prev?.imageUrl || fallback;
              default:
                return fallback;
            }
          };
          let continuityRef: string | null = null;
          if (sceneChainOn && sceneIdx > 0) {
            const prev = scenes[sceneIdx - 1];
            const prevUrl = resolveContinuityUrl(prev, scene);
            if (prevUrl) {
              try {
                if (prevUrl.startsWith("/objects/") || prevUrl.startsWith("/object-entities/") || prevUrl.startsWith("data:")) {
                  continuityRef = await loadAsBase64(prevUrl);
                } else {
                  const safe = assertAllowedRemoteUrl(prevUrl);
                  const r = await fetch(safe.toString(), { redirect: "error" });
                  if (r.ok) {
                    const buf = Buffer.from(await r.arrayBuffer());
                    continuityRef = `data:image/jpeg;base64,${buf.toString("base64")}`;
                  }
                }
              } catch (e: any) {
                console.warn(`[Frames] continuity ref failed: ${e.message}`);
              }
            }
          }

          const allRefs = [
            ...(continuityRef ? [continuityRef] : []),
            ...(useA ? charABase64s : []),
            ...(useB ? charBBase64s : []),
            ...styleBase64s,
          ];
          const userFolder = user?.username || userId;

          const dialoguePart = scene.dialogue?.trim() ? `，台詞：「${scene.dialogue}」` : "";
          const continuityNote = continuityRef
            ? "（第 1 張參考圖為上一幕的結尾畫面，請從此畫面自然延續構圖、角色站位、光線與氛圍）"
            : "";
          const baseDesc = `${scene.description}${dialoguePart}${continuityNote}`;

          const genOne = async (framePrompt: string, label: "first" | "last"): Promise<string | null> => {
            try {
              const requestBody: any = {
                prompt: plainImagePrompt(framePrompt),
                size: imageSize,
              };
              if (allRefs.length > 0) {
                requestBody.image = allRefs.length === 1 ? allRefs[0] : allRefs;
              }
              const imageUrl = await atlasGenerateImage({ prompt: requestBody.prompt, images: requestBody.image, size: requestBody.size });

              if (bunnyStorage.isConfigured()) {
                const safe = assertPublicHttpsUrl(imageUrl);
                const imgResp = await fetch(safe.toString(), { redirect: "error" });
                const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
                const remotePath = `users/${userFolder}/drama/${episode.projectId}_ep${episode.episodeNumber}_scene${sceneIdx}_${label}.jpg`;
                return await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
              }
              return imageUrl;
            } catch (e: any) {
              console.error(`[Frames] ${label} frame failed:`, e.message);
              return null;
            }
          };

          const [firstUrl, lastUrl] = await Promise.all([
            genOne(`${baseDesc}（這是場景的「起始時刻」，角色處於開場狀態，動作尚未展開）`, "first"),
            genOne(`${baseDesc}（這是場景的「結束時刻」，動作已完成或即將收尾，與起始時刻形成連貫變化）`, "last"),
          ]);

          // Reload latest scenes (other scenes might have changed)
          const ep2 = await storage.getDramaEpisode(req.params.episodeId);
          if (!ep2) return;
          const sceneArr: any[] = JSON.parse(ep2.scenes);
          if (firstUrl) {
            sceneArr[sceneIdx].firstFrameUrl = firstUrl;
            sceneArr[sceneIdx].firstFrameBunnyUrl = firstUrl;
            sceneArr[sceneIdx].firstFrameStatus = "completed";
          } else {
            sceneArr[sceneIdx].firstFrameStatus = "failed";
          }
          if (lastUrl) {
            sceneArr[sceneIdx].lastFrameUrl = lastUrl;
            sceneArr[sceneIdx].lastFrameBunnyUrl = lastUrl;
            sceneArr[sceneIdx].lastFrameStatus = "completed";
          } else {
            sceneArr[sceneIdx].lastFrameStatus = "failed";
          }
          // Auto-enable first/last mode if both succeeded
          if (firstUrl && lastUrl) {
            sceneArr[sceneIdx].useFirstLastFrame = true;
          }
          await storage.updateDramaEpisode(req.params.episodeId, { scenes: JSON.stringify(sceneArr) });

          if (!firstUrl && !lastUrl) {
            // refund
            const u2 = await storage.getUser(userId);
            const refundBal = (u2?.credits ?? 0) + FRAME_COST;
            await storage.updateUserCredits(userId, refundBal);
            await storage.createCreditTransaction({
              userId, type: "refund", amount: FRAME_COST, balance: refundBal,
              description: `漫劇第 ${sceneIdx + 1} 幕首尾關鍵幀生成失敗退款`,
            });
          }
        } catch (e: any) {
          console.error("[Frames] background failed:", e);
        }
      })().catch(console.error);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ZIP DOWNLOAD — every asset of an episode in one file
  // ════════════════════════════════════════════════════════════════════════════

  app.get("/api/drama/episodes/:episodeId/download-zip", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== userId) return res.status(404).json({ error: "找不到集數" });
      const project = await storage.getDramaProject(episode.projectId);

      const safeTitle = (episode.title || `episode-${episode.episodeNumber}`).replace(/[^\w\u4e00-\u9fff\-]+/g, "_").slice(0, 40);
      const zipName = `drama-${safeTitle}-ep${episode.episodeNumber}.zip`;
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(zipName)}"`);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("warning", (err: any) => console.warn("[Zip] warning:", err));
      archive.on("error", (err: any) => {
        console.error("[Zip] error:", err);
        try { res.status(500).end(); } catch {}
      });
      archive.pipe(res);

      // Manifest JSON: full project + episode + scenes definition
      const manifest = {
        project: project ? {
          id: project.id,
          title: project.title,
          genre: project.genre,
          description: project.description,
          characterAName: project.characterAName,
          characterBName: project.characterBName,
          sceneSize: project.sceneSize,
        } : null,
        episode: {
          id: episode.id,
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          status: episode.status,
          compiledVideoUrl: episode.compiledVideoUrl,
          createdAt: episode.createdAt,
        },
        scenes: JSON.parse(episode.scenes),
      };
      archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

      const scenes: any[] = JSON.parse(episode.scenes);

      // Helper: stream remote URL into the archive (allowlist enforced)
      const appendRemote = async (url: string | undefined, archivePath: string) => {
        if (!url) return;
        try {
          const cleanUrl = url.split("?")[0];
          const safeUrl = assertAllowedRemoteUrl(cleanUrl);
          const resp = await fetch(safeUrl.toString(), { redirect: "error" });
          if (!resp.ok || !resp.body) return;
          const buf = Buffer.from(await resp.arrayBuffer());
          archive.append(buf, { name: archivePath });
        } catch (e: any) {
          console.warn(`[Zip] failed to add ${archivePath}:`, e.message);
        }
      };

      for (let i = 0; i < scenes.length; i++) {
        const s = scenes[i];
        const sceneFolder = `scenes/scene-${String(i + 1).padStart(2, "0")}`;
        await appendRemote(s.bunnyUrl || s.imageUrl, `${sceneFolder}/key-frame.jpg`);
        await appendRemote(s.firstFrameBunnyUrl || s.firstFrameUrl, `${sceneFolder}/first-frame.jpg`);
        await appendRemote(s.lastFrameBunnyUrl || s.lastFrameUrl, `${sceneFolder}/last-frame.jpg`);
        await appendRemote(s.videoBunnyUrl || s.videoUrl, `${sceneFolder}/scene.mp4`);
      }

      // Compiled mp4 (if any)
      if (episode.compiledVideoUrl) {
        await appendRemote(episode.compiledVideoUrl, `compiled-episode-${episode.episodeNumber}.mp4`);
      }

      await archive.finalize();
    } catch (e: any) {
      console.error("[Zip] outer failure:", e);
      try { res.status(500).json({ error: e.message }); } catch {}
    }
  });
}

/**
 * Drama Studio extension routes:
 *   - Character library (CRUD + 4-view generation)
 *   - Scene library (CRUD)
 *   - Script upload & auto-import (TXT / DOCX → Claude → episodes)
 *   - AI video prompt rewriter
 *   - First / last keyframe generation
 *   - Per-episode ZIP download (all assets)
 */

import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "./storage";
import { ObjectStorageService } from "./objectStorage";
import { BunnyStorageService } from "./bunnyStorage";
import { enhanceImagePrompt } from "./promptEnhancer";
import {
  insertCharacterLibrarySchema,
  updateCharacterLibrarySchema,
  insertSceneLibrarySchema,
  updateSceneLibrarySchema,
  type FourViewUrls,
} from "@shared/schema";
import Anthropic from "@anthropic-ai/sdk";
import archiver from "archiver";
import mammoth from "mammoth";
import { assertAllowedRemoteUrl, assertPublicHttpsUrl } from "./ssrfGuard";
import { atlasGenerateImage, atlasIsConfigured } from "./atlasProvider";


// Four-view image presets (all share the same base portrait so we get a
// consistent character rotated around — the prompt does the work of
// indicating which side is being rendered).
const FOUR_VIEW_PRESETS: { key: keyof FourViewUrls; promptZh: string }[] = [
  { key: "front",        promptZh: "角色正面全身肖像，A-pose 站姿，正面對鏡頭，乾淨白色背景，中性表情，雙臂自然下垂略微張開，全身入鏡（從頭到腳），高解析、無遮擋、清晰光線" },
  { key: "threeQuarter", promptZh: "同一角色 3/4 側身全身肖像（左前 45 度），A-pose 站姿，乾淨白色背景，中性表情，全身入鏡，與正面圖完全一致的服裝、髮型、體型與五官" },
  { key: "side",         promptZh: "同一角色純側面全身肖像（90 度側面），A-pose 站姿，乾淨白色背景，中性表情，全身入鏡，與正面圖完全一致的服裝、髮型、體型與五官" },
  { key: "back",         promptZh: "同一角色背面全身肖像，A-pose 站姿，乾淨白色背景，全身入鏡，背向鏡頭，與正面圖完全一致的髮型、服裝與體型" },
];

const FOUR_VIEW_CREDIT_COST = 12; // 4 images × 3 credits

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

  app.post("/api/character-library", requireAuth, async (req, res) => {
    try {
      const data = insertCharacterLibrarySchema.parse(req.body);
      const c = await storage.createCharacter({ ...data, userId: req.session.userId! });
      res.json(c);
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

      if (!atlasIsConfigured()) return res.status(500).json({ error: "ATLASCLOUD_API_KEY 未設定" });

      // Atomic compare-and-set: claim the in-flight slot before deducting
      // credits. Concurrent duplicate requests get rejected here without ever
      // reaching the deduction step, so the user can never be charged twice.
      const claim = await storage.claimCharacterFourViewGeneration(req.params.id, userId);
      if (!claim.ok) {
        return res.status(409).json({ error: "此角色的四視圖正在生成中，請稍後" });
      }
      const previousStatus = claim.previousStatus ?? null;

      // Atomic deduction guards against negative balance.
      try {
        await storage.atomicDeductCredits(
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
      res.json({ ok: true, creditsUsed: FOUR_VIEW_CREDIT_COST });

      // ── Async background work ────────────────────────────────────────────────
      (async () => {
        try {
          const refBase64s = await Promise.all(refUrls.map(loadAsBase64));
          const userFolder = user?.username || userId;
          const styleHint = character.styleHint?.trim()
            ? `，整體風格：${character.styleHint}`
            : "";
          const baseDescription = character.description?.trim()
            ? `角色描述：${character.description}。`
            : "";

          const results: FourViewUrls = {};
          let succeeded = 0;

          for (const preset of FOUR_VIEW_PRESETS) {
            try {
              const fullPrompt = enhanceImagePrompt(
                `${baseDescription}${preset.promptZh}${styleHint}（保持與第 1 張參考圖完全一致的角色外貌、髮色、五官、年齡與服裝）`
              );
              const requestBody: any = {
                prompt: fullPrompt,
                image: refBase64s.length === 1 ? refBase64s[0] : refBase64s,
                size: "1440x2560",
              };
              const imageUrl = await atlasGenerateImage({ prompt: requestBody.prompt, images: requestBody.image, size: requestBody.size });

              let storedUrl = imageUrl;
              if (bunnyStorage.isConfigured()) {
                try {
                  const safe = assertPublicHttpsUrl(imageUrl);
                  const imgResp = await fetch(safe.toString(), { redirect: "error" });
                  const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
                  const remotePath = `users/${userFolder}/character-library/${character.id}_${preset.key}.jpg`;
                  storedUrl = await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
                } catch (e) {
                  console.warn(`[CharLib] Bunny upload failed for ${preset.key}:`, e);
                }
              }
              results[preset.key] = storedUrl;
              succeeded++;
              await storage.updateCharacter(character.id, { fourViewUrls: { ...results } } as any);
              console.log(`✅ Character ${character.name} 四視圖 ${preset.key} 完成`);
            } catch (viewErr: any) {
              console.error(`❌ Character ${character.name} ${preset.key} 失敗:`, viewErr.message);
            }
          }

          if (succeeded === 0) {
            // refund
            const u2 = await storage.getUser(userId);
            const refundBal = (u2?.credits ?? 0) + FOUR_VIEW_CREDIT_COST;
            await storage.updateUserCredits(userId, refundBal);
            await storage.createCreditTransaction({
              userId, type: "refund", amount: FOUR_VIEW_CREDIT_COST, balance: refundBal,
              description: `角色「${character.name}」四視圖生成失敗退款`,
            });
            await storage.updateCharacter(character.id, {
              fourViewStatus: "failed",
              fourViewError: "全部視圖生成失敗",
            } as any);
          } else {
            await storage.updateCharacter(character.id, {
              fourViewStatus: "completed",
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

      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) return res.status(500).json({ error: "Claude API Key 未設定（AI_INTEGRATIONS_ANTHROPIC_API_KEY）" });

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

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
        model: "claude-haiku-4-5",
        max_tokens: 8000,
        messages: [{ role: "user", content: prompt }],
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

      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) return res.status(500).json({ error: "Claude API Key 未設定（AI_INTEGRATIONS_ANTHROPIC_API_KEY）" });

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      // Always pass prev/next scene context to Claude so rewriter understands
      // the episode timeline. Chain Mode adds extra "must bridge" requirements.
      const episodeChainOn = !!episode.chainMode;
      const ov = scene?.chainModeOverride ?? "inherit";
      const sceneChainOn = ov === "on" ? true : ov === "off" ? false : episodeChainOn;
      const prevScene = sceneIdx > 0 ? scenes[sceneIdx - 1] : null;
      const nextScene = sceneIdx + 1 < scenes.length ? scenes[sceneIdx + 1] : null;

      const continuityBlock = `

【上一幕】${prevScene ? `${prevScene.title || ""}｜${prevScene.description || ""}` : "（這是首幕）"}
【本幕】${scene.title || ""}｜${scene.description || ""}
【下一幕】${nextScene ? `${nextScene.title || ""}｜${nextScene.description || ""}` : "（這是末幕）"}
${sceneChainOn ? `
連續模式（已開啟）特別要求：
- 如果有上一幕，提示詞需自然「承接」上一幕的動作或情緒（例如「承接上一幕的對視，他緩緩開口…」）
- 如果有下一幕，動作收尾要朝下一幕的開場方向過渡，避免突兀
- 鏡頭起手與收尾的構圖／角色站位需與相鄰幕一致` : `
請參考前後幕的劇情走向，避免動作或情緒與相鄰幕互相矛盾。`}`;

      const prompt = `你是 WAN 3.0 圖生影片的提示詞專家。請根據以下分鏡資訊，寫出一段精煉、專業的視頻生成提示詞（限 100 字內，繁中）：

【本幕場景描述】${scene.description ?? ""}
【台詞】${scene.dialogue ?? "（無）"}
【運鏡建議】${scene.cameraMovement ?? "（自由）"}${continuityBlock}

要求：
- 開頭直接寫主體動作（角色做什麼）
- 包含運鏡（推鏡/拉鏡/環繞/跟拍）、景別（特寫/中景/遠景）、光線（暖色/冷色/自然光/逆光）、氛圍（緊張/溫馨/懸疑等）
- 不要寫「請生成」「以下是」之類的引言
- 不要包含台詞內容、不加引號
- 直接輸出提示詞文字，沒有任何標題或解釋`;

      const claudeResp = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = claudeResp.content.find((b: any) => b.type === "text") as any;
      const videoPrompt = (textBlock?.text || "").trim().replace(/^[「『"']|[」』"']$/g, "");
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

      const FRAME_COST = 6; // 2 frames × 3 credits

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
                prompt: enhanceImagePrompt(framePrompt),
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

/**
 * 寫真套圖 (photo set) planner.
 *
 * Flow:
 *   1. Client uploads ONE situation / reference image to object storage.
 *   2. POST /api/photosets/plan — Claude looks at the image and writes a shot
 *      list: N self-contained image-edit prompts that keep the same person,
 *      outfit and setting but vary framing, angle, pose, expression and light,
 *      like a photographer working through one shoot.
 *   3. The client lets the user edit the shot list, then submits it to the
 *      existing batch endpoint (POST /api/image-generations with `prompts`),
 *      which generates every shot with Seedream 5.5 edit using the uploaded
 *      image as the reference. Credits, refunds, Bunny re-hosting and polling
 *      (GET /api/batch-generations/:batchId) are all reused from there.
 *
 * Planning itself is free; only the generated images cost credits.
 */

import type { Express, Request, Response, NextFunction } from "express";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { z } from "zod";
import type { ObjectStorageService } from "./objectStorage";

/** Same Claude model the rest of the app uses through the Replit Anthropic
 *  integration. Override with PHOTOSET_PLANNER_MODEL to try a stronger one. */
const PLANNER_MODEL = process.env.PHOTOSET_PLANNER_MODEL || "claude-haiku-4-5";

export const PHOTOSET_MIN_SHOTS = 2;
export const PHOTOSET_MAX_SHOTS = 10;

const planRequestSchema = z.object({
  /** Object-storage path of the uploaded situation image ("/objects/..."). */
  originalImageUrl: z.string().min(1),
  count: z.number().int().min(PHOTOSET_MIN_SHOTS).max(PHOTOSET_MAX_SHOTS),
  /** Optional art direction from the user, e.g. "日系清新、多一點特寫". */
  direction: z.string().max(500).optional(),
  /** Target aspect ratio label, only used to steer composition. */
  aspectRatio: z.string().max(10).optional(),
});

export type PhotosetShot = { title: string; prompt: string };
export type PhotosetPlan = { analysis: string; shots: PhotosetShot[] };

function buildPlannerPrompt(count: number, direction: string | undefined, aspectRatio: string | undefined): string {
  return `你是一位資深人像寫真攝影師兼社群視覺企劃。請仔細觀察這張「情境圖」，把它當成一次拍攝的定裝照，規劃一組 ${count} 張的寫真套圖，讓整組圖貼在社群（Instagram、Threads、小紅書）時像同一次拍攝的作品集。

【先分析】
用 2–3 句繁體中文描述你看到的：主體（人物的外貌特徵、髮型、服裝；若沒有人物則描述主體物）、場景、光線、色調與整體氛圍。

【再規劃 ${count} 個鏡頭】
每個鏡頭都會交給「圖片編輯模型」，並附上這張情境圖當參考圖，所以每一條提示詞必須：
1. 是一段可以獨立執行的完整指令，不能引用其他鏡頭（不要寫「同上」「延續上一張」）。
2. 開頭先交代一致性：保持參考圖中同一位人物的臉部五官、髮型髮色、身形、服裝配件，以及同一個場景與色調。
3. 接著明確寫出這一張的變化：景別（特寫／半身／全身／遠景）、拍攝角度（平視／俯拍／仰拍／側面／背影回眸）、姿勢與動作、表情與視線、人物在場景中的位置、光線方向。
4. 以寫實攝影的語言描述，加入鏡頭感（例如 85mm 淺景深、35mm 環境人像、自然光、逆光輪廓光）。
5. 使用繁體中文，長度 60–140 字，不要加引號、編號或任何說明文字。

【整組的節奏】
- ${count} 張之間要有明顯差異，避免重複的姿勢或構圖。
- 景別要有遠有近：至少包含一張環境全景、一張半身、一張臉部或細節特寫（張數不足時依序優先）。
- 第一張適合當封面：最能代表整組氛圍、主體清楚。
- 不要改變人物身分、年齡、服裝或場景；不要加入文字、浮水印、邊框。${aspectRatio ? `\n- 成品比例為 ${aspectRatio}，構圖請以此比例安排。` : ""}${direction ? `\n\n【使用者的額外要求（優先遵守）】\n${direction}` : ""}

【輸出格式】
只輸出一個 JSON 物件，不要有任何其他文字或 Markdown：
{"analysis":"……","shots":[{"title":"4–10 字的鏡頭名稱","prompt":"完整提示詞"}]}
shots 陣列必須剛好 ${count} 個元素。`;
}

/** Pull the first balanced-looking JSON object out of the model's text. */
function parsePlan(text: string, count: number): PhotosetPlan {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 規劃結果格式錯誤，請再試一次。");
  let parsed: any;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("AI 規劃結果無法解析，請再試一次。");
  }
  const shots: PhotosetShot[] = (Array.isArray(parsed?.shots) ? parsed.shots : [])
    .map((s: any, i: number) => ({
      title: typeof s?.title === "string" && s.title.trim() ? s.title.trim().slice(0, 30) : `鏡頭 ${i + 1}`,
      prompt: typeof s?.prompt === "string" ? s.prompt.trim() : "",
    }))
    .filter((s: PhotosetShot) => s.prompt.length > 0)
    .slice(0, count);
  if (shots.length < PHOTOSET_MIN_SHOTS) {
    throw new Error("AI 沒有產生足夠的鏡頭，請再試一次。");
  }
  return {
    analysis: typeof parsed?.analysis === "string" ? parsed.analysis.trim() : "",
    shots,
  };
}

export function registerPhotosetRoutes(
  app: Express,
  deps: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
    objectStorageService: ObjectStorageService;
  },
) {
  const { requireAuth, objectStorageService } = deps;

  app.post("/api/photosets/plan", requireAuth, async (req, res) => {
    try {
      const parsedBody = planRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        return res.status(400).json({ error: `請求格式錯誤：${parsedBody.error.issues.map(i => i.message).join("、")}` });
      }
      const { originalImageUrl, count, direction, aspectRatio } = parsedBody.data;

      if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: "Claude API Key 未設定（AI_INTEGRATIONS_ANTHROPIC_API_KEY）" });
      }
      // Only images the user uploaded through our object storage are accepted
      // — never an arbitrary URL — so this endpoint can't be used to make the
      // server fetch remote hosts.
      if (!originalImageUrl.startsWith("/objects/")) {
        return res.status(400).json({ error: "請先上傳情境圖。" });
      }

      const objectFile = await objectStorageService.getObjectEntityFile(originalImageUrl);
      const chunks: Buffer[] = [];
      for await (const chunk of objectFile.createReadStream()) {
        chunks.push(Buffer.from(chunk));
      }
      // Normalise for vision: upright, ≤1568px on the long edge, JPEG.
      const jpeg = await sharp(Buffer.concat(chunks))
        .rotate()
        .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 88 })
        .toBuffer();

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const message = await anthropic.messages.create({
        model: PLANNER_MODEL,
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
              },
              { type: "text", text: buildPlannerPrompt(count, direction?.trim() || undefined, aspectRatio) },
            ],
          },
        ],
      });

      if (message.stop_reason === "refusal") {
        return res.status(422).json({ error: "AI 無法分析這張圖片，請換一張情境圖再試。" });
      }
      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("");

      const plan = parsePlan(text, count);
      res.json(plan);
    } catch (error: any) {
      console.error("Photoset planning failed:", error?.message || error);
      const status = error instanceof Anthropic.RateLimitError ? 429 : 500;
      res.status(status).json({ error: error?.message || "套圖規劃失敗，請稍後再試。" });
    }
  });
}

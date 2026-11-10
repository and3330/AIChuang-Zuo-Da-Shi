/**
 * 寫真套圖 / 角色九宮格 (photo set) planner.
 *
 * Two modes, both ending in the existing batch endpoint
 * (POST /api/image-generations with `prompts`), which generates every shot
 * with Seedream 5.5 edit and reuses credits, refunds, Bunny re-hosting and
 * polling (GET /api/batch-generations/:batchId):
 *
 *   scene      — a 情境圖 sets the location, light and mood. Optional
 *                character reference images (a library character and/or ad-hoc
 *                uploads) set WHO is in the pictures. Without references the
 *                person in the 情境圖 is kept.
 *   character  — no 情境圖. The reference images are one character and the
 *                plan is a character sheet (views, expressions, poses) that
 *                fully establishes them — the "九宮格" pack.
 *
 * POST /api/photosets/plan returns the shot list. planner "ai" asks Claude to
 * look at the images; planner "preset" (character mode only) returns the
 * fixed nine-shot sheet without calling Claude. Planning is free; only the
 * generated images cost credits.
 *
 * Image order sent to the image model is always
 *   [情境圖 (scene mode), ...reference images]
 * and the client appends a short note describing that order to every prompt,
 * so planned prompts must NOT refer to images by number.
 */

import type { Express, Request, Response, NextFunction } from "express";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { z } from "zod";
import type { ObjectStorageService } from "./objectStorage";
import { assertAllowedRemoteUrl, fetchImageWithLimits } from "./ssrfGuard";
import { PHOTO_LOOKS, poseById, type Pose } from "@shared/photosetOptions";

/** Same Claude model the rest of the app uses through the Replit Anthropic
 *  integration. Override with PHOTOSET_PLANNER_MODEL to try a stronger one. */
const PLANNER_MODEL = process.env.PHOTOSET_PLANNER_MODEL || "claude-haiku-4-5";

export const PHOTOSET_MIN_SHOTS = 2;
export const PHOTOSET_MAX_SHOTS = 10;
/** The edit model takes 10 images; one slot is reserved for the 情境圖. */
export const PHOTOSET_MAX_REFERENCES = 9;
/** How many reference images Claude looks at while planning. */
const PLANNER_REFERENCE_LOOKS = 3;

const planRequestSchema = z.object({
  mode: z.enum(["scene", "character"]).default("scene"),
  planner: z.enum(["ai", "preset"]).default("ai"),
  /** 情境圖 — required in scene mode. */
  situationImageUrl: z.string().optional(),
  /** Character / person reference images. Required in character mode. */
  referenceImageUrls: z.array(z.string()).max(PHOTOSET_MAX_REFERENCES).optional().default([]),
  characterName: z.string().max(60).optional(),
  characterDescription: z.string().max(1000).optional(),
  /** Character mode: "sheet" = turnaround / expression sheet on a studio
   *  backdrop (default); "shoot" = a photo shoot of the character in a
   *  setting the planner picks, e.g. for a library recipe. */
  characterGoal: z.enum(["sheet", "shoot"]).default("sheet"),
  /** Scene mode with references: whose outfit the shots should use. */
  outfitFrom: z.enum(["character", "scene"]).default("character"),
  count: z.number().int().min(PHOTOSET_MIN_SHOTS).max(PHOTOSET_MAX_SHOTS),
  /** Poses picked from the pose library. When given, the plan has exactly
   *  one shot per pose, in this order, and `count` is ignored. */
  poseIds: z.array(z.string().max(60)).max(PHOTOSET_MAX_SHOTS).optional().default([]),
  /** Finishing look id (see PHOTO_LOOKS). The client appends the look's own
   *  wording to each prompt; the planner only needs to stay out of its way. */
  look: z.string().max(20).optional(),
  /** Optional art direction from the user, e.g. "日系清新、多一點特寫". */
  direction: z.string().max(500).optional(),
  /** Target aspect ratio label, only used to steer composition. */
  aspectRatio: z.string().max(10).optional(),
});

type PlanRequest = z.infer<typeof planRequestSchema>;
export type PhotosetShot = { title: string; prompt: string };
export type PhotosetPlan = { analysis: string; shots: PhotosetShot[] };

/* ---------- fixed nine-shot character sheet ---------- */

const SHEET_BACKDROP = "乾淨的淺灰色攝影棚背景，柔和均勻的棚燈，寫實攝影質感";

/** Standard 九宮格: views first, then expressions, then poses. Ordered so a
 *  shorter request still gets the most useful shots. */
const CHARACTER_SHEET_PRESET: PhotosetShot[] = [
  { title: "正面半身定裝", prompt: `角色正面半身定裝照，身體與臉正對鏡頭，自然中性表情，雙肩放鬆，${SHEET_BACKDROP}，85mm 人像鏡頭，五官與服裝細節清晰。` },
  { title: "正面全身", prompt: `角色正面全身站姿，從頭到腳完整入鏡，雙臂自然下垂，站姿端正，${SHEET_BACKDROP}，50mm 鏡頭，完整呈現身形比例與整套服裝。` },
  { title: "3/4 側半身", prompt: `角色左前 45 度的 3/4 側身半身照，臉微微轉向鏡頭，眼神看向鏡頭，${SHEET_BACKDROP}，85mm 鏡頭，呈現臉部立體輪廓。` },
  { title: "正側面", prompt: `角色 90 度正側面半身照，面向畫面左方，視線平視前方，${SHEET_BACKDROP}，清楚呈現側臉輪廓、鼻樑、下顎線與髮型側面。` },
  { title: "背面全身", prompt: `角色背面全身站姿，背對鏡頭，從頭到腳完整入鏡，${SHEET_BACKDROP}，清楚呈現髮型背面與服裝背面的設計。` },
  { title: "微笑特寫", prompt: `角色臉部特寫，溫暖自然的微笑，眼神明亮看向鏡頭，${SHEET_BACKDROP}，85mm 淺景深，皮膚質感與五官細節清晰。` },
  { title: "嚴肅眼神特寫", prompt: `角色臉部特寫，表情冷靜嚴肅，眼神堅定直視鏡頭，嘴唇微抿，${SHEET_BACKDROP}，側光勾勒輪廓，85mm 淺景深。` },
  { title: "開懷大笑", prompt: `角色半身照，開懷大笑、露出牙齒，身體自然微微後仰，充滿感染力的抓拍感，${SHEET_BACKDROP}，85mm 鏡頭。` },
  { title: "動態姿勢全身", prompt: `角色全身動態姿勢，邁步向前行走並回頭看向鏡頭，頭髮與衣襬帶有自然的動態，${SHEET_BACKDROP}，35mm 鏡頭，全身完整入鏡。` },
  { title: "坐姿半身", prompt: `角色坐在簡約的高腳凳上，身體微側、單手自然放在膝上，放鬆自信的表情看向鏡頭，${SHEET_BACKDROP}，50mm 鏡頭。` },
];

/* ---------- Claude prompts ---------- */

const SHOT_RULES = `每個鏡頭的提示詞必須：
1. 是一段可以獨立執行的完整指令，不能引用其他鏡頭（不要寫「同上」「延續上一張」）。
2. 不要用「第幾張圖」「參考圖一」這類編號來指稱圖片，系統會自動補上圖片說明；直接描述畫面即可。
3. 明確寫出這一張的景別（特寫／半身／全身／遠景）、拍攝角度（平視／俯拍／仰拍／側面／背影回眸）、姿勢與動作、表情與視線、光線方向。
4. 以寫實攝影的語言描述，加入鏡頭感（例如 85mm 淺景深、35mm 環境人像、自然光、逆光輪廓光）。
5. 使用繁體中文，長度 60–140 字，不要加引號、編號或任何說明文字。
6. 不要加入文字、浮水印、邊框。
7. 不要描述膚質、修圖或畫質（系統會另外附上質感設定），也不要使用「完美」「無瑕」「精緻」「夢幻」「唯美」「絕美」這類會讓畫面過度修飾的形容詞；用具體、平實的攝影語言描述真實的瞬間。`;

/** Planner instructions for user-picked poses: one shot per pose, in order. */
function poseBlock(poses: Pose[]): string {
  if (poses.length === 0) return "";
  const list = poses
    .map((p, i) => `${i + 1}. 【${p.name}】${p.description}（建議${p.framing}）`)
    .join("\n");
  return `

【使用者指定的姿勢】
請「依序」為下面每一個姿勢各寫一個鏡頭，共 ${poses.length} 個，不要增減或調換順序。每個鏡頭必須忠實呈現該姿勢的身體姿態，再依場景決定人物位置、拍攝角度、表情與光線；title 請用該姿勢的名稱。
${list}`;
}

function outputFormat(count: number): string {
  return `【輸出格式】
只輸出一個 JSON 物件，不要有任何其他文字或 Markdown：
{"analysis":"……","shots":[{"title":"4–10 字的鏡頭名稱","prompt":"完整提示詞"}]}
shots 陣列必須剛好 ${count} 個元素。`;
}

function userExtras(req: PlanRequest): string {
  const parts: string[] = [];
  if (req.aspectRatio) parts.push(`成品比例為 ${req.aspectRatio}，構圖請以此比例安排。`);
  if (req.characterName?.trim()) parts.push(`角色名稱：${req.characterName.trim()}`);
  if (req.characterDescription?.trim()) parts.push(`角色設定：${req.characterDescription.trim()}`);
  const look = PHOTO_LOOKS.find(l => l.id === req.look);
  if (look) parts.push(`整組的畫面質感為「${look.label}」（${look.hint}），鏡頭的光線與氛圍請與它相符。`);
  if (req.direction?.trim()) parts.push(`使用者的額外要求（優先遵守）：${req.direction.trim()}`);
  return parts.length ? `\n\n【補充資訊】\n${parts.join("\n")}` : "";
}

function buildScenePrompt(req: PlanRequest, refLooks: number, poses: Pose[]): string {
  const hasRefs = req.referenceImageUrls.length > 0;
  const imageIntro = hasRefs
    ? `你會看到 ${1 + refLooks} 張圖：第一張是「情境圖」，決定這次拍攝的場景、光線、色調與氛圍；其餘 ${refLooks} 張是「角色參考圖」，決定畫面中的人物是誰（臉部五官、髮型髮色、身形）。成品要讓「角色參考圖中的這個人」出現在「情境圖的場景」裡；情境圖裡原本的人物只當作姿勢與構圖的參考，不要保留他的長相。${
        req.outfitFrom === "scene"
          ? "服裝請沿用情境圖中的穿著。"
          : "服裝請沿用角色參考圖中的穿著。"
      }`
    : "你會看到一張「情境圖」，請把它當成一次拍攝的定裝照：保持圖中同一位人物（臉部、髮型、身形、服裝配件）與同一個場景、色調。";
  return `你是一位資深人像寫真攝影師兼社群視覺企劃。${imageIntro}

請規劃一組 ${req.count} 張的寫真套圖，讓整組圖貼在社群（Instagram、Threads、小紅書）時像同一次拍攝的作品集。

【先分析】
用 2–3 句繁體中文描述：${hasRefs ? "角色的外貌特徵與服裝，以及情境圖的" : "主體人物的外貌特徵與服裝，以及"}場景、光線、色調與整體氛圍。

【再規劃 ${req.count} 個鏡頭】
${SHOT_RULES}

【整組的節奏】
- ${req.count} 張之間要有明顯差異，避免重複的姿勢或構圖，並善用情境圖場景中的不同位置與元素。
- 景別要有遠有近：至少包含一張環境全景、一張半身、一張臉部或細節特寫（張數不足時依序優先）。
- 第一張適合當封面：最能代表整組氛圍、主體清楚。
- 不要改變人物身分、年齡或場景。${poseBlock(poses)}${userExtras(req)}

${outputFormat(req.count)}`;
}

function buildCharacterPrompt(req: PlanRequest, refLooks: number, poses: Pose[]): string {
  return `你是一位資深角色設計師兼人像攝影師。你會看到 ${refLooks} 張同一個角色的參考圖。請為這個角色規劃一組 ${req.count} 張的「角色定裝圖庫」，目的是把這個角色完整建立起來，之後可以拿這組圖當參考，在任何場景中穩定重現同一個人。

【先分析】
用 2–3 句繁體中文描述這個角色：臉型與五官特徵、髮型髮色、身形、服裝與配件、整體氣質，以及參考圖還缺少哪些角度或表情。

【再規劃 ${req.count} 個鏡頭】
${SHOT_RULES}

【整組必須涵蓋】（張數不足時依序優先）
- 視角：正面半身、正面全身、3/4 側身、正側面、背面。
- 表情：自然微笑、嚴肅或冷靜、開懷大笑或驚訝等至少兩種明顯不同的情緒特寫。
- 姿勢：至少一張全身動態姿勢、一張坐姿或倚靠等放鬆姿勢。
- 背景一律使用乾淨的淺色攝影棚背景與柔和棚燈，讓人物成為唯一重點。
- 所有鏡頭都必須是同一位角色：臉部五官、髮型髮色、身形與服裝完全一致，不要更換服裝（除非使用者另有要求）。${poseBlock(poses)}${userExtras(req)}

${outputFormat(req.count)}`;
}

function buildCharacterShootPrompt(req: PlanRequest, refLooks: number, poses: Pose[]): string {
  return `你是一位資深人像寫真攝影師兼社群視覺企劃。你會看到 ${refLooks} 張同一位角色的參考圖，它們只用來確認這個人的臉部五官、髮型髮色與身形。

請為這位角色規劃一組 ${req.count} 張的寫真套圖，讓整組圖貼在社群（Instagram、Threads、小紅書）時像同一次拍攝的作品集。這次沒有情境圖，請你依照角色的氣質與下方補充資訊，挑選「一個」具體且統一的拍攝地點與時段（例如午後的咖啡店、傍晚的海邊堤防、有大窗的房間），整組都在這個地點拍攝。

【先分析】
用 2–3 句繁體中文描述這位角色的外貌特徵，以及你選定的拍攝地點、時段、光線與整體氛圍。

【再規劃 ${req.count} 個鏡頭】
${SHOT_RULES}

【整組的節奏】
- 每個鏡頭都要寫出拍攝地點中的具體位置與背景元素，因為生成時沒有場景參考圖。
- 補充資訊若指定了服裝，每一個鏡頭的提示詞都必須完整寫出這套服裝；若指定了姿勢，每一個鏡頭都以該姿勢為主，只變化景別、拍攝角度、表情、視線與在場景中的位置。
- 沒有指定姿勢時，${req.count} 張之間的姿勢要有明顯差異。
- 景別要有遠有近：至少包含一張環境全景、一張半身、一張臉部或細節特寫（張數不足時依序優先）。
- 第一張適合當封面：最能代表整組氛圍、主體清楚。
- 所有鏡頭都是同一位角色，不要改變人物身分與年齡。${poseBlock(poses)}${userExtras(req)}

${outputFormat(req.count)}`;
}

/** Pull the first JSON object out of the model's text and validate it. */
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

/** A planning failure that is safe to show to the caller. */
export class PhotosetPlanError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "PhotosetPlanError";
  }
}

export type PhotosetPlanInput = z.input<typeof planRequestSchema>;

/**
 * Build the planner used by both the website route and the partner API.
 * `plan()` validates its input and throws PhotosetPlanError for anything the
 * caller can fix.
 */
export function createPhotosetPlanner(objectStorageService: ObjectStorageService) {
  /** Load a stored image (object-storage path or allow-listed CDN URL) and
   *  normalise it for vision: upright, ≤1568px on the long edge, JPEG. */
  async function loadForVision(imageUrl: string): Promise<Anthropic.ImageBlockParam> {
    let raw: Buffer;
    if (imageUrl.startsWith("/objects/")) {
      const objectFile = await objectStorageService.getObjectEntityFile(imageUrl);
      const chunks: Buffer[] = [];
      for await (const chunk of objectFile.createReadStream()) {
        chunks.push(Buffer.from(chunk));
      }
      raw = Buffer.concat(chunks);
    } else {
      // Only our own CDN is allowed, so planning can't be used to make the
      // server fetch arbitrary hosts.
      const safe = assertAllowedRemoteUrl(imageUrl);
      raw = await fetchImageWithLimits(safe.toString(), { maxBytes: 25 * 1024 * 1024, timeoutMs: 30_000 });
    }
    const jpeg = await sharp(raw)
      .rotate()
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88 })
      .toBuffer();
    return {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
    };
  }

  async function plan(input: unknown): Promise<PhotosetPlan> {
    const parsedBody = planRequestSchema.safeParse(input);
    if (!parsedBody.success) {
      throw new PhotosetPlanError(400, `請求格式錯誤：${parsedBody.error.issues.map(i => i.message).join("、")}`);
    }
    const body = parsedBody.data;
    // Unknown pose ids are dropped; picked poses decide the shot count.
    const poses = body.poseIds.map(poseById).filter((p): p is Pose => !!p);
    if (poses.length === 1) {
      throw new PhotosetPlanError(400, `請至少選擇 ${PHOTOSET_MIN_SHOTS} 個姿勢，或清除姿勢選擇改用張數。`);
    }
    if (poses.length >= PHOTOSET_MIN_SHOTS) body.count = poses.length;

    if (body.mode === "scene" && !body.situationImageUrl) {
      throw new PhotosetPlanError(400, "請先上傳情境圖。");
    }
    if (body.mode === "character" && body.referenceImageUrls.length === 0) {
      throw new PhotosetPlanError(400, "請先選擇角色或上傳至少一張角色參考圖。");
    }

    // Fixed character sheet: no model call needed.
    if (body.mode === "character" && body.planner === "preset") {
      return {
        analysis: "標準角色九宮格：依序涵蓋正面、全身、側面、背面等視角，以及多種表情與姿勢，全部使用乾淨的攝影棚背景，方便之後當作角色參考圖庫。",
        shots: CHARACTER_SHEET_PRESET.slice(0, body.count),
      };
    }

    if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
      throw new PhotosetPlanError(500, "規劃用的 AI 服務尚未設定。");
    }

    const refsToLook = body.referenceImageUrls.slice(0, PLANNER_REFERENCE_LOOKS);
    const imageUrls = body.mode === "scene"
      ? [body.situationImageUrl!, ...refsToLook]
      : refsToLook;
    const imageBlocks = await Promise.all(imageUrls.map(loadForVision));

    const promptText = body.mode === "scene"
      ? buildScenePrompt(body, refsToLook.length, poses)
      : body.characterGoal === "shoot"
        ? buildCharacterShootPrompt(body, refsToLook.length, poses)
        : buildCharacterPrompt(body, refsToLook.length, poses);

    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });

    const message = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 4000,
      messages: [
        { role: "user", content: [...imageBlocks, { type: "text", text: promptText }] },
      ],
    });

    if (message.stop_reason === "refusal") {
      throw new PhotosetPlanError(422, "AI 無法分析這些圖片，請換一張圖再試。");
    }
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map(b => b.text)
      .join("");

    try {
      return parsePlan(text, body.count);
    } catch (e: any) {
      throw new PhotosetPlanError(502, e?.message || "AI 規劃結果格式錯誤，請再試一次。");
    }
  }

  return { plan };
}

export function registerPhotosetRoutes(
  app: Express,
  deps: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
    objectStorageService: ObjectStorageService;
  },
) {
  const { requireAuth, objectStorageService } = deps;
  const planner = createPhotosetPlanner(objectStorageService);

  app.post("/api/photosets/plan", requireAuth, async (req, res) => {
    try {
      res.json(await planner.plan(req.body));
    } catch (error: any) {
      if (error instanceof PhotosetPlanError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("Photoset planning failed:", error?.message || error);
      const status = error instanceof Anthropic.RateLimitError ? 429 : 500;
      res.status(status).json({ error: error?.message || "套圖規劃失敗，請稍後再試。" });
    }
  });
}

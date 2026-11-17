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
 *   product    — 商品帶貨圖 (/product). The reference images are one character and
 *                productImageUrls are photos of one product. The plan is a set of
 *                shots of that person with the product, plus a ready-to-post
 *                caption and hashtags. Image order sent to the image model is
 *                [...reference images, ...product images].
 *   ugc        — UGC 實拍短片 (/ugc). Same inputs as product, plus the film's length and
 *                the video model. The plan is a product script laid out like the
 *                「AI 短劇導演」skill's storyboard: a director's intent, then a ten-column
 *                table (shot, time, angle, framing, action, sound, camera, purpose,
 *                subtitle, clip). Shots are grouped into Clips; one Clip is one video
 *                generation, as long as the model allows (VIDEO_MODELS[...].maxSeconds,
 *                30 s for all three), so a film up to 30 s is made in ONE generation with
 *                the cuts written into its prompt and no editing afterwards. Each clip
 *                has one English, time-coded multi-shot prompt (`clips[].motion`).
 *                Keyframes: Kling 4.0 takes one per shot (first frame + middle_images),
 *                the others only the clip's first frame; `shots[].keyframe` marks them.
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
import { ATLAS_SEED_MODEL, createAtlasSeedClient } from "./atlasSeed";
import { mergePhotosetSupplement } from "@shared/photosetPrompt";
import sharp from "sharp";
import { z } from "zod";
import type { ObjectStorageService } from "./objectStorage";
import { assertAllowedRemoteUrl, fetchImageWithLimits } from "./ssrfGuard";
import { PHOTO_LOOKS, poseById, type Pose } from "@shared/photosetOptions";
import { LANGUAGE_NAME, languageNote, type RequestLang } from "./lang";
import { VIDEO_MODELS, type VideoModelKey } from "@shared/pricing";

const PLANNER_MODEL = ATLAS_SEED_MODEL;

export const PHOTOSET_MIN_SHOTS = 2;
export const PHOTOSET_MAX_SHOTS = 10;
/** The edit model takes 10 images; one slot is reserved for the 情境圖. */
export const PHOTOSET_MAX_REFERENCES = 9;
/** How many reference images Claude looks at while planning. */
const PLANNER_REFERENCE_LOOKS = 3;
/** Product mode: photos of the product. */
export const PHOTOSET_MAX_PRODUCT_IMAGES = 3;
/** UGC film length. Every video model makes 30 s in one go, so the page never needs editing. */
export const UGC_MIN_SECONDS = 8;
export const UGC_MAX_SECONDS = 30;
export const UGC_DEFAULT_SECONDS = 15;
/** No shot shorter than this (「AI 短劇導演」Clip rule). */
const UGC_MIN_SHOT_SECONDS = 1.5;

export const planRequestSchema = z.object({
  mode: z.enum(["scene", "character", "product", "ugc"]).default("scene"),
  planner: z.enum(["ai", "preset"]).default("ai"),
  /** 情境圖 — required in scene mode. */
  situationImageUrl: z.string().optional(),
  /** Character / person reference images. Required in character mode. */
  referenceImageUrls: z.array(z.string()).max(PHOTOSET_MAX_REFERENCES).optional().default([]),
  characterName: z.string().max(60).optional(),
  characterDescription: z.string().max(1000).optional(),
  /** Product mode: photos of the one product (required), its name and what to say about it. */
  productImageUrls: z.array(z.string()).max(PHOTOSET_MAX_PRODUCT_IMAGES).optional().default([]),
  productName: z.string().max(80).optional(),
  sellingPoints: z.string().max(800).optional(),
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
  /** Poses picked from the asset library (free text). Same rule as poseIds:
   *  one shot per pose, in order; they follow any poseIds. */
  customPoses: z.array(z.object({
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(600),
  })).max(PHOTOSET_MAX_SHOTS).optional().default([]),
  /** Finishing look id (see PHOTO_LOOKS). The client appends the look's own
   *  wording to each prompt; the planner only needs to stay out of its way. */
  look: z.string().max(20).optional(),
  /** Optional art direction from the user, e.g. "日系清新、多一點特寫". */
  direction: z.string().max(4000).optional(),
  /** User-authored supplement, kept separate so controls cannot truncate it. */
  customPrompt: z.string().trim().max(1000).optional(),
  /** Target aspect ratio label, only used to steer composition. */
  aspectRatio: z.string().max(10).optional(),
  /** Interface language of the person asking. Anything but "zh" makes the planner write its whole answer in that language. */
  lang: z.enum(["zh", "zh-CN", "en", "ja", "vi"]).optional(),
  /** Scene mode: the full reading of the 情境圖 (from POST /api/photosets/read-photo), possibly edited by the person. */
  photoReading: z.string().trim().max(3000).optional(),
  /** ugc mode: the whole film's length, and the video model that will make it. */
  totalSeconds: z.number().int().min(UGC_MIN_SECONDS).max(UGC_MAX_SECONDS).optional(),
  videoModel: z.enum(["wan", "kling", "seedance"]).optional(),
});

/* ---------- full reading of the photo to copy (照片同款) ---------- */

/** What the reading covers, in order. The person is described by pose, expression and clothes only: who they are comes from the character. */
const READING_FIELDS = [
  { key: "scene", zh: "場景與地點", en: "Setting", cn: "场景与地点", ja: "撮影場所", vi: "Bối cảnh", ask: "在哪裡拍的：地點類型、背景裡看得到的所有東西與它們的位置、時段" },
  { key: "composition", zh: "構圖與鏡頭", en: "Framing and camera", cn: "构图与镜头", ja: "構図とカメラ", vi: "Bố cục và góc máy", ask: "景別（特寫／半身／七分身／全身／遠景）、人物在畫面中的位置與大小、拍攝角度與高度、鏡頭焦段感與景深、畫面比例" },
  { key: "pose", zh: "姿勢與動作", en: "Pose", cn: "姿势与动作", ja: "ポーズ", vi: "Tư thế", ask: "身體朝向、頭部角度、雙手與雙腳的位置、重心、正在做的動作，寫到能照著擺出一模一樣的姿勢" },
  { key: "expression", zh: "表情與視線", en: "Expression and gaze", cn: "表情与视线", ja: "表情と視線", vi: "Biểu cảm và ánh mắt", ask: "表情、嘴型、眼神看向哪裡" },
  { key: "outfit", zh: "服裝與配件", en: "Outfit and accessories", cn: "服装与配件", ja: "服装と小物", vi: "Trang phục và phụ kiện", ask: "每一件衣物的款式、顏色、材質、合身程度，以及鞋子、包包、飾品、眼鏡" },
  { key: "props", zh: "道具與互動", en: "Props", cn: "道具与互动", ja: "小道具", vi: "Đạo cụ", ask: "人物拿著、靠著、坐著或互動的物件；沒有就寫「無」" },
  { key: "lighting", zh: "光線", en: "Lighting", cn: "光线", ja: "ライティング", vi: "Ánh sáng", ask: "光源種類、方向、軟硬、明暗對比、有沒有逆光或輪廓光" },
  { key: "color", zh: "色調與質感", en: "Colour and finish", cn: "色调与质感", ja: "色調と質感", vi: "Màu sắc và chất ảnh", ask: "主要色彩、冷暖、飽和度、底片感或手機感等後製風格、顆粒" },
  { key: "mood", zh: "整體氛圍", en: "Mood", cn: "整体氛围", ja: "雰囲気", vi: "Không khí", ask: "一句話說這張照片給人的感覺" },
] as const;

function readingPrompt(lang: RequestLang = "zh"): string {
  const list = READING_FIELDS.map(f => `- ${f.key}：${f.ask}`).join("\n");
  const language = `自然的${LANGUAGE_NAME[lang]}`;
  return `你是一位資深攝影指導。使用者想用自己的角色拍一張和這張照片「幾乎一樣」的照片，接著再延伸成一整組寫真。請完整、具體地判讀這張照片，讓攝影師只看你的文字就能重拍出同一張。

規則：
- 只寫看得到的內容，不要猜測或美化；不確定就寫「看不清楚」。
- 不要描述人物的長相、臉部五官、膚色、年齡或身分（人物會換成使用者的角色）；髮型也不用寫。
- 每一項用${language}寫 1–3 句，具體到位置、方向、顏色與數量。
- 如果照片裡沒有人，pose、expression、outfit 都寫「畫面中沒有人物」。

要判讀的項目：
${list}

只輸出一個 JSON 物件，鍵就是上面的英文名稱，值是文字，不要有任何其他文字或 Markdown。`;
}

/** Turn the model's JSON into labelled lines the person can read and edit. */
export function formatReading(value: unknown, lang: RequestLang = "zh"): string {
  const obj = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return READING_FIELDS
    .map(f => {
      const text = typeof obj[f.key] === "string" ? (obj[f.key] as string).trim().slice(0, 400) : "";
      return text ? `${f[lang === "zh-CN" ? "cn" : lang === "zh" ? "zh" : lang]}：${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

/** First balanced JSON object in a text answer. */
function firstJsonObject(text: string): unknown {
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) { if (c === "{") { start = i; depth = 1; } continue; }
    if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { start = -1; }
    }
  }
  return undefined;
}

type PlanRequest = z.infer<typeof planRequestSchema>;
export type PhotosetShot = {
  title: string; prompt: string;
  /** Legacy single-shot motion prompt (ugc plans now carry one per clip in `clips`). */
  motion?: string;
  /** ugc mode, the storyboard columns: on-screen subtitle, length (0.5 s steps), start time in the film,
   *  framing, angle, camera move, visible action, sound, narrative purpose; `keyframe` = gets its own picture. */
  subtitle?: string; seconds?: number; start?: number;
  framing?: string; angle?: string; camera?: string; action?: string; sound?: string; purpose?: string;
  keyframe?: boolean;
};
/** ugc mode: one video generation. `shots` are 0-based indexes into plan.shots, in order. */
export type PhotosetClip = { shots: number[]; seconds: number; motion: string };
export type PhotosetPlan = {
  analysis: string; shots: PhotosetShot[];
  customPrompt?: string;
  /** Product mode only: a post to go with the pictures. */
  caption?: string; hashtags?: string[];
  /** ugc mode: director's intent (hook, structure, rhythm) and the video generations. */
  intent?: string; clips?: PhotosetClip[];
  /** The planner's unchecked clip list, only between parsePlan and finishUgcPlan. */
  rawClips?: unknown;
};

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
type PlanPose = Pick<Pose, "name" | "description"> & { framing?: string };

function poseBlock(poses: PlanPose[]): string {
  if (poses.length === 0) return "";
  const list = poses
    .map((p, i) => `${i + 1}. 【${p.name}】${p.description}${p.framing ? `（建議${p.framing}）` : ""}`)
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

export function userExtras(req: PlanRequest): string {
  const parts: string[] = [];
  if (req.aspectRatio) parts.push(`成品比例為 ${req.aspectRatio}，構圖請以此比例安排。`);
  if (req.characterName?.trim()) parts.push(`角色名稱：${req.characterName.trim()}`);
  if (req.characterDescription?.trim()) parts.push(`角色設定：${req.characterDescription.trim()}`);
  const look = PHOTO_LOOKS.find(l => l.id === req.look);
  if (look) parts.push(`整組的畫面質感為「${look.label}」（${look.hint}），鏡頭的光線與氛圍請與它相符。`);
  if (req.direction?.trim()) parts.push(`使用者的額外要求（優先遵守）：${req.direction.trim()}`);
  if (req.customPrompt) {
    parts.push(`補充 Prompt（與人物、服裝、姿勢、場景及拍攝設定一起綜合規劃；在不違反內容安全規則的前提下，具體反映在每個相關鏡頭中）：${req.customPrompt}`);
  }
  return parts.length ? `\n\n【補充資訊】\n${parts.join("\n")}` : "";
}

function buildScenePrompt(req: PlanRequest, refLooks: number, poses: PlanPose[]): string {
  const hasRefs = req.referenceImageUrls.length > 0;
  const imageIntro = hasRefs
    ? `你會看到 ${1 + refLooks} 張圖：第一張是「情境圖」，決定這次拍攝的場景、光線、色調與氛圍；其餘 ${refLooks} 張是「角色參考圖」，決定畫面中的人物是誰（臉部五官、髮型髮色、身形）。成品要讓「角色參考圖中的這個人」出現在「情境圖的場景」裡；情境圖裡原本的人物只當作姿勢與構圖的參考，不要保留他的長相。${
        req.outfitFrom === "scene"
          ? "服裝請沿用情境圖中的穿著。"
          : "服裝請沿用角色參考圖中的穿著。"
      }`
    : "你會看到一張「情境圖」，請把它當成一次拍攝的定裝照：保持圖中同一位人物（臉部、髮型、身形、服裝配件）與同一個場景、色調。";
  const reading = req.photoReading?.trim()
    ? `

【情境圖的完整判讀】（使用者已確認，可能改過；與圖片不同時以這段文字為準）
${req.photoReading.trim()}`
    : "";
  const firstOutfit = hasRefs && req.outfitFrom !== "scene" ? "，只有人物換成角色、服裝換成角色的穿著" : hasRefs ? "，只有人物換成角色" : "";
  // Picked poses decide every shot, so the replica rule only applies without them.
  const replica = poses.length === 0;
  return `你是一位資深人像寫真攝影師兼社群視覺企劃。${imageIntro}${reading}

請規劃一組 ${req.count} 張的寫真套圖，讓整組圖貼在社群（Instagram、Threads、小紅書）時像同一次拍攝的作品集。

【先分析】
用 2–3 句繁體中文描述：${hasRefs ? "角色的外貌特徵與服裝，以及情境圖的" : "主體人物的外貌特徵與服裝，以及"}場景、光線、色調與整體氛圍。
${replica ? `
【第一個鏡頭：重拍情境圖】
第一個鏡頭要和情境圖「幾乎一模一樣」${firstOutfit}：同一個地點與背景元素的位置、同樣的景別與人物在畫面中的位置和大小、同樣的拍攝角度與高度、同樣的姿勢（頭、手、腳、身體朝向）、表情與視線、同樣的道具與互動、同樣的光線方向與色調。提示詞要把這些逐項寫清楚（這一個可以寫到 220 字），不要自行加入新元素或改變構圖。title 寫「照片同款」。
` : ""}
【${replica ? `其餘 ${Math.max(0, req.count - 1)} 個鏡頭` : `規劃 ${req.count} 個鏡頭`}】
${SHOT_RULES}

【整組的節奏】
- ${replica ? "第二張以後" : `${req.count} 張之間`}彼此要有明顯差異，避免重複的姿勢或構圖，並善用情境圖場景中的不同位置與元素；光線、色調與氛圍維持和情境圖一致。
- 景別要有遠有近：至少包含一張環境全景、一張半身、一張臉部或細節特寫（張數不足時依序優先）。
- 不要改變人物身分、年齡或場景。${poseBlock(poses)}${userExtras(req)}

${outputFormat(req.count)}`;
}

function buildCharacterPrompt(req: PlanRequest, refLooks: number, poses: PlanPose[]): string {
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

function buildCharacterShootPrompt(req: PlanRequest, refLooks: number, poses: PlanPose[]): string {
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

function buildProductPrompt(req: PlanRequest, refLooks: number, productLooks: number): string {
  const info: string[] = [];
  if (req.productName?.trim()) info.push(`商品名稱：${req.productName.trim()}`);
  if (req.sellingPoints?.trim()) info.push(`賣家提供的賣點（文案只能根據這些與圖片上看得到的內容）：${req.sellingPoints.trim()}`);
  return `你是一位社群帶貨內容企劃兼人像攝影師。你會看到 ${refLooks + productLooks} 張圖：前 ${refLooks} 張是同一位「人物」的參考圖，只用來確認這個人的臉部五官、髮型髮色與身形；後 ${productLooks} 張是同一件「商品」的照片。

請規劃一組 ${req.count} 張的「商品帶貨圖」：由這位人物實際拿著、穿戴或使用這件商品，看起來像創作者自己拍來分享的真實使用照，貼在 Instagram、Threads、小紅書上能讓人想點進去看。同時寫一則可以直接搭配這組圖發布的貼文。
${info.length ? `\n【商品資訊】\n${info.join("\n")}\n` : ""}
【先分析】
用 2–3 句繁體中文描述：這件商品是什麼（品類、外觀、顏色、材質、包裝上看得到的特徵），以及你為這組圖選定的「一個」拍攝場景與氛圍（要符合這類商品實際會被使用的地方）。

【再規劃 ${req.count} 個鏡頭】
${SHOT_RULES}

【商品帶貨圖的要求】
- 每個鏡頭都要寫出人物如何與商品互動（手持展示、正在使用、穿戴在身上、放在身旁桌面等），以及商品在畫面中的位置與大小；商品必須清楚可辨識。
- 每個鏡頭的提示詞都要用一句話具體描述商品的外觀（品類、形狀、顏色、材質），因為生成時要靠文字與商品圖一起還原它。
- 依商品品類決定合理的用法：穿戴類（衣服、鞋包、飾品）要穿戴在身上；手持類（保養品、飲料、3C）要有手部與商品的近景；大型或居家類放在環境中由人物使用。
- 景別要有變化：至少一張人物與商品都清楚的半身、一張商品為主的手部或細節特寫、一張帶環境的生活情境（張數不足時依序優先）。
- 第一張適合當封面：人物的臉與商品同時清楚。
- 所有鏡頭都是同一位人物、同一件商品，不要改變人物身分與年齡，不要讓商品變形或出現第二種商品。
- 補充資訊若指定了服裝或場景，請遵守。${userExtras(req)}

【貼文文案】
- caption：繁體中文，80–160 字，第一人稱、口語、像真的在分享使用心得；第一句要能吸引人停下來看；結尾帶一句自然的行動呼籲（例如問問題或邀請留言）。可以用 1–3 個表情符號。
- 只能寫圖片上看得到的特徵與賣家提供的賣點，不要編造成分、價格、折扣、產地或數據；不要寫療效、醫療功效、「保證有效」「第一」「最」這類宣稱。
- hashtags：5–8 個，不含 # 符號，混合品類詞與情境詞。

【輸出格式】
只輸出一個 JSON 物件，不要有任何其他文字或 Markdown：
{"analysis":"……","shots":[{"title":"4–10 字的鏡頭名稱","prompt":"完整提示詞"}],"caption":"……","hashtags":["……"]}
shots 陣列必須剛好 ${req.count} 個元素。`;
}

function buildUgcPrompt(req: PlanRequest, refLooks: number, productLooks: number): string {
  const info: string[] = [];
  if (req.productName?.trim()) info.push(`商品名稱：${req.productName.trim()}`);
  if (req.sellingPoints?.trim()) info.push(`賣家提供的賣點（字幕與文案只能根據這些與圖片上看得到的內容）：${req.sellingPoints.trim()}`);
  const model = ugcModel(req);
  const spec = VIDEO_MODELS[model];
  const total = ugcSeconds(req);
  const clipCount = Math.ceil(total / spec.maxSeconds);
  const perShotFrames = spec.keyframes > 1;
  const clipLine = clipCount === 1
    ? `整支 ${total} 秒在「一次」影片生成裡完成（${spec.label} 一次最長 ${spec.maxSeconds} 秒），鏡頭之間的切換直接寫在影片提示詞裡，成品不需要再剪接。`
    : `${spec.label} 一次最長 ${spec.maxSeconds} 秒，所以分成 ${clipCount} 個 Clip（每個 Clip 是一次影片生成，不超過 ${spec.maxSeconds} 秒），Clip 內的鏡頭切換寫在提示詞裡。`;
  const frameLine = perShotFrames
    ? `${spec.label} 可以放關鍵幀：每個鏡頭都會先生成一張「關鍵幀圖」（該鏡頭開始的那一格），依時間順序一起交給影片模型。在 motion 裡用 @image_1、@image_2…（依鏡頭在 Clip 內的順序編號）指出每個鏡頭從哪一張關鍵幀開始。`
    : `${spec.label} 只收一張首幀：每個 Clip 只有第一個鏡頭會生成「首幀圖」，後面的鏡頭完全靠 motion 的文字描述切換出來，所以每個鏡頭的畫面在 motion 裡都要寫得具體完整。`;
  return `你是一位 UGC 帶貨短影音的導演兼分鏡師。身為導演，你決定觀眾在什麼時候、用什麼方式看到商品；身為分鏡師，你用影片模型能生成的單位把這支片拆成鏡頭。你會看到 ${refLooks + productLooks} 張圖：前 ${refLooks} 張是同一位「人物」的參考圖，只用來確認這個人的臉部五官、髮型髮色與身形；後 ${productLooks} 張是同一件「商品」的照片。

請寫一支 ${total} 秒、${req.count} 個鏡頭的直式（9:16）UGC 商品腳本：這位人物用手機自拍或請朋友手持拍攝，分享自己實際使用這件商品，適合 Reels、TikTok、Shorts。
${clipLine}
${frameLine}
${info.length ? `\n【商品資訊】\n${info.join("\n")}\n` : ""}
【analysis：先分析】
用 2–3 句繁體中文描述：這件商品是什麼（品類、外觀、顏色、材質、包裝上看得到的特徵），以及你選定的「一個」拍攝地點、時段與光線（要是這類商品實際會被使用的日常場景）。

【intent：導演意圖】繁體中文 3–5 句，依序寫：
1. 鉤子：用哪一種鉤子公式（反直覺的結論／具體數字加時間／點名某一種人／從事情中途切入），以及前 3 秒觀眾看到什麼。
2. 結構：這支商品腳本的段落安排（見下方商品腳本結構）。
3. 節奏：哪裡快、哪裡停留；畫面與現場音怎麼配合。
4. 收尾：最後一個畫面停在哪裡。

【商品腳本結構】（${req.count} 個鏡頭依序對應，鏡頭較少時合併中間段）
1. 鉤子（前 3 秒內）：人物看向鏡頭、商品已經在畫面裡，像是影片從事情中途切入。
2. 情境或痛點：這件商品會出現的日常時刻，用看得見的動作表現，不用台詞說明。
3. 商品登場：拿起或打開商品，對著鏡頭展示外觀與包裝。
4. 使用示範：實際使用的過程，手部與商品的近景。
5. 效果與細節：使用後的反應或質地、細節特寫，靠表情與小動作表現。
6. 行動呼籲：人物拿著商品看向鏡頭，停在一個可以定格的畫面。

【分鏡規則】
- 每個鏡頭都要有存在的理由，purpose 寫「目的標籤｜一句話理由」，目的標籤從這些挑：鉤子、建立、展示、示範、細節、反應、轉折、收尾。
- 景別要有遠近變化（特寫、近景、中景、全景），連續兩個鏡頭不要用同一個景別；至少一個商品或手部的特寫。
- 情緒越重，表達越輕：用表情與小動作，不要直接寫「她很開心」。
- 每個鏡頭只做一個清楚、物理上合理的動作；動作要小而真實（拿起、轉動、打開、塗抹、喝一口、對鏡頭微笑、點頭）。
- 鏡頭時長參考：簡單動作 2–3 秒、展示或使用 3–5 秒、反應或表情 1.5–2.5 秒、細節特寫 1.5–2 秒、收尾定格 2–3 秒。每個鏡頭至少 ${UGC_MIN_SHOT_SECONDS} 秒，以 0.5 秒為單位，全部鏡頭加起來剛好 ${total} 秒。
- 不要自編台詞或旁白；人物不開口說話。聲音只用非語言的現場音（例如 soft room tone, cap click, fabric rustle, pouring sound）${spec.audio ? "" : `；${spec.label} 不輸出聲音，sound 欄仍寫建議的後製音效`}。
- 畫面裡不出現文字；字幕另外由 subtitle 欄位提供，後製再疊上去。

【每個鏡頭的欄位】
- title：4–10 字的鏡頭名稱。
- purpose：見上方分鏡規則。
- framing：景別（大遠景／遠景／全景／中景／近景／特寫／大特寫 擇一）。
- angle：角度（平視／俯拍／仰拍／頂拍／微俯 擇一）。
- camera：運鏡（手持微晃、自拍視角、POV、緩慢推近、固定鏡頭、跟拍 等，幅度要小）。
- action：畫面內容，繁體中文一句話，只寫看得見的動作，關鍵道具要點名。
- sound：聲音。
- seconds：這個鏡頭的秒數。
- prompt：${perShotFrames ? "這個鏡頭的關鍵幀圖" : "這個鏡頭開始那一格的畫面（只有每個 Clip 的第一個鏡頭會真的生成成首幀圖）"}提示詞，規則如下。
- subtitle：字幕，規則如下。

【prompt（關鍵幀圖）的規則】
${SHOT_RULES}
- 關鍵幀是該鏡頭的第一格：畫面是動作「開始前」的靜止瞬間，不要寫動作的過程。
- 風格是手機實拍：手持或自拍視角、現場自然光、構圖隨性、背景是真實的居家或日常環境。
- 每個鏡頭都要用同一句話重複寫出：人物的服裝、商品的外觀（品類、形狀、顏色、材質）、拍攝地點，讓每個鏡頭看起來是同一次拍攝。
- 商品必須清楚可辨識，不要變形，不要出現第二種商品。

【subtitle（字幕）的規則】
- 繁體中文，每句 8–18 字，第一人稱口語。這是後製疊在畫面上的字幕，不是人物說的話。
- 第一個鏡頭的字幕就是鉤子。不要用暖場句（大家好、今天要分享）、自我介紹、弱疑問句（有沒有人跟我一樣）、形容詞堆疊（超好用又實用）。
- 只能寫圖片上看得到的特徵與賣家提供的賣點，不要編造成分、價格、折扣或數據；不要寫療效、醫療功效、「保證有效」「第一」「最」這類宣稱。
- 最後一個鏡頭的字幕是自然的行動呼籲。

【clips：影片提示詞】共 ${clipCount} 個 Clip。每個 Clip 給 shots（屬於這個 Clip 的鏡頭編號，從 1 開始、依序、連續，所有 Clip 合起來剛好涵蓋全部鏡頭${clipCount === 1 ? "，所以就是全部鏡頭" : `，每個 Clip 的秒數加總不超過 ${spec.maxSeconds} 秒`}）與 motion。motion 的寫法：
- 英文、電報式（省略冠詞與繫動詞），一整段，${Math.min(2500, 400 + req.count * 260)} 個字元以內。
- 開頭先寫兩行鎖定，之後每個鏡頭都沿用、不改字：Style lock: vertical 9:16 handheld smartphone UGC footage, natural light, realistic skin and fabric, no filters. Subject lock: （人物的髮型、服裝、體型，一句英文）; （商品的品類、形狀、顏色、材質、包裝，一句英文）.
- 接著依序寫每個鏡頭：Shot N (起–迄秒，以 Clip 起點從 0 計算, framing, camera)${perShotFrames ? ", opens on @image_N" : ""}: 主體動作 + 鏡頭運動 + 光線或氛圍的細微變化。第二個鏡頭起，開頭寫 hard cut to 或 match cut to。每個鏡頭的動作開頭先用半句話回引人物或商品（例如 same woman, same bottle）。
- 只寫非語言聲音（Sound: …）${spec.audio ? "" : "，可以省略"}；不寫台詞、旁白、配樂。
- 結尾固定加上：The product keeps its exact shape, color and label in every shot. No text overlay, no subtitles, no speech.${userExtras(req)}

【貼文文案】
- caption：繁體中文，60–120 字，第一人稱，搭配這支影片發布用；規則同字幕。
- hashtags：5–8 個，不含 # 符號。

【輸出格式】
只輸出一個 JSON 物件，不要有任何其他文字或 Markdown：
{"analysis":"……","intent":"……","shots":[{"title":"……","purpose":"鉤子｜……","framing":"近景","angle":"平視","camera":"手持微晃","action":"……","sound":"……","seconds":3,"prompt":"關鍵幀提示詞","subtitle":"字幕"}],"clips":[{"shots":[1,2,3],"motion":"Style lock: …"}],"caption":"……","hashtags":["……"]}
shots 陣列必須剛好 ${req.count} 個元素，clips 陣列剛好 ${clipCount} 個元素。`;
}

export function ugcModel(req: Pick<PlanRequest, "videoModel">): VideoModelKey {
  return req.videoModel ?? "kling";
}
export function ugcSeconds(req: Pick<PlanRequest, "totalSeconds">): number {
  return req.totalSeconds ?? UGC_DEFAULT_SECONDS;
}

/**
 * ugc mode: make the shot lengths add up to the film, give every shot its start time, check the
 * planner's clip grouping, and mark which shots get a picture. Throws PhotosetPlanError when the
 * plan cannot be turned into video generations.
 */
export function finishUgcPlan(plan: PhotosetPlan, rawClips: unknown, req: Pick<PlanRequest, "totalSeconds" | "videoModel">): PhotosetPlan {
  const spec = VIDEO_MODELS[ugcModel(req)];
  const total = ugcSeconds(req);
  const n = plan.shots.length;
  // Lengths: scale to the film, 0.5 s steps, at least the minimum, then put the rounding on the longest shot.
  const asked = plan.shots.map(s => (s.seconds && s.seconds > 0 ? s.seconds : total / n));
  const scale = total / asked.reduce((a, b) => a + b, 0);
  const secs = asked.map(s => Math.max(UGC_MIN_SHOT_SECONDS, Math.round(s * scale * 2) / 2));
  let diff = total - secs.reduce((a, b) => a + b, 0);
  while (Math.abs(diff) >= 0.5) {
    const step = diff > 0 ? 0.5 : -0.5;
    const order = secs.map((s, i) => i).sort((a, b) => secs[b] - secs[a]);
    const i = order.find(k => secs[k] + step >= UGC_MIN_SHOT_SECONDS);
    if (i === undefined) throw new PhotosetPlanError(400, `${total} 秒放不下 ${n} 個鏡頭，請減少鏡頭數。`);
    secs[i] += step;
    diff -= step;
  }
  let start = 0;
  const shots = plan.shots.map((s, i) => {
    const shot = { ...s, seconds: secs[i], start };
    start += secs[i];
    return shot;
  });

  // Clips: the planner's grouping when it covers every shot in order, otherwise one clip if that fits.
  const parsed = (Array.isArray(rawClips) ? rawClips : [])
    .map((c: any) => ({
      shots: (Array.isArray(c?.shots) ? c.shots : []).map((x: unknown) => Math.round(Number(x)) - 1),
      motion: typeof c?.motion === "string" ? c.motion.trim().slice(0, 3000) : "",
    }))
    .filter(c => c.motion.length > 0);
  const flat = parsed.flatMap(c => c.shots);
  const ordered = flat.length === n && flat.every((x, i) => x === i) && parsed.every(c => c.shots.length > 0);
  let groups: { shots: number[]; motion: string }[];
  if (ordered) groups = parsed;
  else if (parsed.length > 0 && total <= spec.maxSeconds) groups = [{ shots: shots.map((_, i) => i), motion: parsed.map(c => c.motion).join(" ") }];
  else throw new PhotosetPlanError(502, "AI 沒有寫好影片提示詞，請再試一次。");

  const clips: PhotosetClip[] = groups.map(g => {
    const seconds = Math.round(g.shots.reduce((t, i) => t + secs[i], 0));
    if (seconds > spec.maxSeconds) throw new PhotosetPlanError(502, "AI 分段超過影片模型的長度上限，請再試一次。");
    return { shots: g.shots, motion: g.motion, seconds: Math.max(spec.minSeconds, seconds) };
  });
  const firsts = new Set(clips.map(c => c.shots[0]));
  return {
    ...plan,
    shots: shots.map((s, i) => ({ ...s, keyframe: spec.keyframes > 1 || firsts.has(i) })),
    clips,
  };
}

/** Appended to the planner prompt when the visitor's interface is not Chinese. */
const OUTPUT_LANGUAGE: Record<string, string> = {
  en: `

【輸出語言（優先於上面所有關於語言與字數的規定）】
這位使用者使用英文介面。所有文字欄位都必須用自然、道地的英文撰寫：analysis、每個鏡頭的 title 與 prompt，以及（如果有的話）caption、hashtags、subtitle。不要出現任何中文。每個 prompt 改為 40–90 個英文單字，title 改為 2–5 個英文單字，caption 改為 40–90 個英文單字，每句 subtitle 改為 4–10 個英文單字。欄位名稱維持不變。`,
};

/** The output-language block for the planner. Shot prompts go to the image model, so for Japanese and Vietnamese they stay in English. */
function plannerLanguage(lang: RequestLang | undefined): string {
  if (!lang || lang === "zh") return "";
  if (lang === "en") return OUTPUT_LANGUAGE.en;
  return languageNote(lang, ["每個鏡頭的 prompt", "clips 的 motion（本來就是英文）"], "字數規定改為相當的長度；hashtags 用這個語言常用的標籤。");
}

/** Pull the first JSON object out of the model's text and validate it. */
export function parsePlan(value: unknown, count: number): PhotosetPlan {
  let parsed: any = value;
  if (typeof value === "string") {
    // Scan balanced objects instead of greedily matching the first through last
    // brace. Quoted braces, Markdown fences and surrounding prose are common.
    parsed = undefined;
    let start = -1, depth = 0, quoted = false, escaped = false;
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (start < 0) {
        if (c === "{") { start = i; depth = 1; }
        continue;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          const candidate = JSON.parse(value.slice(start, i + 1));
          if (Array.isArray(candidate?.shots)) { parsed = candidate; break; }
        } catch { /* Keep looking for a complete, valid plan, never invent one. */ }
        start = -1;
      }
    }
    if (!parsed) throw new Error("AI 未回傳可讀取的鏡頭規劃格式，請再試一次。");
  }
  const shots: PhotosetShot[] = (Array.isArray(parsed?.shots) ? parsed.shots : [])
    .map((s: any, i: number) => ({
      title: typeof s?.title === "string" && s.title.trim() ? s.title.trim().slice(0, 30) : `鏡頭 ${i + 1}`,
      prompt: typeof s?.prompt === "string" ? s.prompt.trim() : "",
      ...(typeof s?.motion === "string" && s.motion.trim() ? { motion: s.motion.trim().slice(0, 1200) } : {}),
      ...(typeof s?.subtitle === "string" && s.subtitle.trim() ? { subtitle: s.subtitle.trim().slice(0, 60) } : {}),
      ...(Number(s?.seconds) > 0 ? { seconds: Math.max(UGC_MIN_SHOT_SECONDS, Math.min(UGC_MAX_SECONDS, Math.round(Number(s.seconds) * 2) / 2)) } : {}),
      ...Object.fromEntries((["framing", "angle", "camera", "action", "sound", "purpose"] as const)
        .filter(k => typeof s?.[k] === "string" && s[k].trim())
        .map(k => [k, s[k].trim().slice(0, k === "action" ? 200 : 80)])),
    }))
    .filter((s: PhotosetShot) => s.prompt.length > 0)
    .slice(0, count);
  if (shots.length !== count) {
    throw new Error(`AI 規劃鏡頭不完整（需要 ${count} 個），請再試一次。`);
  }
  const hashtags: string[] = (Array.isArray(parsed?.hashtags) ? parsed.hashtags : [])
    .filter((h: unknown): h is string => typeof h === "string")
    .map((h: string) => h.replace(/^#+/, "").trim().slice(0, 30))
    .filter((h: string) => h.length > 0)
    .slice(0, 10);
  return {
    analysis: typeof parsed?.analysis === "string" ? parsed.analysis.trim() : "",
    shots,
    ...(typeof parsed?.caption === "string" && parsed.caption.trim() ? { caption: parsed.caption.trim().slice(0, 600) } : {}),
    ...(hashtags.length > 0 ? { hashtags } : {}),
    ...(typeof parsed?.intent === "string" && parsed.intent.trim() ? { intent: parsed.intent.trim().slice(0, 1200) } : {}),
    // ugc mode: checked and replaced by finishUgcPlan; other modes drop it.
    ...(Array.isArray(parsed?.clips) ? { rawClips: parsed.clips } : {}),
  };
}

/** A planning failure that is safe to show to the caller. */
export class PhotosetPlanError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "PhotosetPlanError";
  }
}

/** Distinguish refusal and truncated output from an actual JSON format error. */
export function readPlannerMessage(message: Pick<Anthropic.Message, "content" | "stop_reason">, count: number): PhotosetPlan {
  if (message.stop_reason === "refusal") {
    console.warn("Photoset planner explicitly refused the request", { stopReason: message.stop_reason });
    throw new PhotosetPlanError(422, "AI 無法處理這次內容，請調整圖片或描述後再試。");
  }
  if (message.stop_reason === "max_tokens") {
    throw new PhotosetPlanError(502, "AI 規劃回覆被截斷，請減少張數或縮短描述後再試。");
  }
  const tool = message.content.find((block): block is Anthropic.ToolUseBlock =>
    block.type === "tool_use" && block.name === "submit_photoset_plan");
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map(block => block.text).join("\n");
  // Ordinary limitations or apologies are not a reliable content-safety signal.
  // Only the provider's explicit refusal above is classified as a 422.
  // Text without a valid plan still fails validation; never generate a fallback.
  try {
    return parsePlan(tool ? tool.input : text, count);
  } catch (e) {
    console.warn("Photoset planner returned no valid plan", {
      stopReason: message.stop_reason,
      hasPlanTool: Boolean(tool),
    });
    throw new PhotosetPlanError(502, e instanceof Error ? e.message : "AI 規劃格式錯誤，請再試一次。");
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
    const poses: PlanPose[] = [
      ...body.poseIds.map(poseById).filter((p): p is Pose => !!p),
      ...body.customPoses.map(p => ({ name: p.name.trim(), description: p.description.trim() })),
    ].slice(0, PHOTOSET_MAX_SHOTS);
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
    if (body.mode === "product" || body.mode === "ugc") {
      if (body.productImageUrls.length === 0) throw new PhotosetPlanError(400, "請先上傳商品照片。");
      if (body.referenceImageUrls.length === 0) throw new PhotosetPlanError(400, "請先選擇角色。");
    }
    if (body.mode === "ugc") {
      const most = Math.min(VIDEO_MODELS[ugcModel(body)].keyframes > 1 ? 10 : 8, Math.floor(ugcSeconds(body) / UGC_MIN_SHOT_SECONDS));
      if (body.count < 2 || body.count > most) throw new PhotosetPlanError(400, `${ugcSeconds(body)} 秒的影片可以放 2 到 ${most} 個鏡頭。`);
    }

    // Fixed character sheet: no model call needed.
    if (body.mode === "character" && body.planner === "preset") {
      if (body.customPrompt || body.direction?.trim()) {
        throw new PhotosetPlanError(400, "固定九宮格不會套用補充描述，請改用 AI 規劃。");
      }
      return {
        analysis: "標準角色九宮格：依序涵蓋正面、全身、側面、背面等視角，以及多種表情與姿勢，全部使用乾淨的攝影棚背景，方便之後當作角色參考圖庫。",
        shots: CHARACTER_SHEET_PRESET.slice(0, body.count),
      };
    }

    if (!process.env.ATLASCLOUD_API_KEY) {
      throw new PhotosetPlanError(500, "規劃用的 AtlasCloud AI 服務尚未設定。");
    }

    const withProduct = body.mode === "product" || body.mode === "ugc";
    const refsToLook = body.referenceImageUrls.slice(0, withProduct ? 2 : PLANNER_REFERENCE_LOOKS);
    const imageUrls = body.mode === "scene"
      ? [body.situationImageUrl!, ...refsToLook]
      : withProduct
        ? [...refsToLook, ...body.productImageUrls]
        : refsToLook;
    const imageBlocks = await Promise.all(imageUrls.map(loadForVision));

    const promptText = body.mode === "scene"
      ? buildScenePrompt(body, refsToLook.length, poses)
      : body.mode === "ugc"
        ? buildUgcPrompt(body, refsToLook.length, body.productImageUrls.length)
      : body.mode === "product"
        ? buildProductPrompt(body, refsToLook.length, body.productImageUrls.length)
      : body.characterGoal === "shoot"
        ? buildCharacterShootPrompt(body, refsToLook.length, poses)
        : buildCharacterPrompt(body, refsToLook.length, poses);

    const anthropic = createAtlasSeedClient();

    const message = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: Math.min(14000, Math.max(4000, body.count * (body.mode === "ugc" ? 1300 : 750) + (body.mode === "ugc" ? 3000 : 1000))),
      tools: [{
        name: "submit_photoset_plan",
        description: "Return the requested photo shoot plan as structured data. Do not use this tool if you cannot assist with the requested content.",
        input_schema: {
          type: "object",
          properties: {
            analysis: { type: "string" },
            shots: {
              type: "array", minItems: body.count, maxItems: body.count,
              items: {
                type: "object",
                properties: {
                  title: { type: "string" }, prompt: { type: "string" },
                  ...(body.mode === "ugc" ? {
                    purpose: { type: "string" }, framing: { type: "string" }, angle: { type: "string" },
                    camera: { type: "string" }, action: { type: "string" }, sound: { type: "string" },
                    subtitle: { type: "string" }, seconds: { type: "number", minimum: UGC_MIN_SHOT_SECONDS, maximum: UGC_MAX_SECONDS },
                  } : {}),
                },
                required: body.mode === "ugc"
                  ? ["title", "purpose", "framing", "angle", "camera", "action", "sound", "seconds", "prompt", "subtitle"]
                  : ["title", "prompt"],
              },
            },
            caption: { type: "string" },
            hashtags: { type: "array", items: { type: "string" } },
            ...(body.mode === "ugc" ? {
              intent: { type: "string" },
              clips: {
                type: "array", minItems: 1,
                items: {
                  type: "object",
                  properties: { shots: { type: "array", items: { type: "integer" } }, motion: { type: "string" } },
                  required: ["shots", "motion"],
                },
              },
            } : {}),
          },
          required: body.mode === "ugc" ? ["analysis", "intent", "shots", "clips"] : ["analysis", "shots"],
        },
      }],
      tool_choice: { type: "auto" },
      messages: [
        { role: "user", content: [...imageBlocks, { type: "text", text: `${promptText}${plannerLanguage(body.lang)}\n\n請優先以 submit_photoset_plan 工具回傳結構化結果；若無法協助這次內容，請直接說明，不要產生替代鏡頭。` }] },
      ],
    });

    // Merge only after a valid, non-refused plan. Never turn a refusal into shots.
    const read = readPlannerMessage(message, body.count);
    const { rawClips, ...rest } = read;
    const plan = body.mode === "ugc" ? finishUgcPlan(rest, rawClips, body) : rest;
    return {
      ...plan,
      shots: plan.shots.map(shot => ({
        ...shot,
        prompt: mergePhotosetSupplement(shot.prompt, body.customPrompt),
      })),
      ...(body.customPrompt ? { customPrompt: body.customPrompt } : {}),
    };
  }

  /** 照片同款: read the whole photo once, before planning, so the person can check and correct it. */
  async function readPhoto(input: unknown): Promise<{ reading: string }> {
    const parsed = z.object({ imageUrl: z.string().min(1).max(2000), lang: z.enum(["zh", "zh-CN", "en", "ja", "vi"]).optional() }).safeParse(input);
    if (!parsed.success) throw new PhotosetPlanError(400, "請求格式錯誤。");
    if (!process.env.ATLASCLOUD_API_KEY) throw new PhotosetPlanError(500, "規劃用的 AtlasCloud AI 服務尚未設定。");
    const lang = parsed.data.lang ?? "zh";
    let image: Anthropic.ImageBlockParam;
    try {
      image = await loadForVision(parsed.data.imageUrl);
    } catch {
      throw new PhotosetPlanError(400, "讀不到這張照片，請重新上傳。");
    }
    const message = await createAtlasSeedClient().messages.create({
      model: PLANNER_MODEL,
      max_tokens: 2500,
      messages: [{ role: "user", content: [image, { type: "text", text: readingPrompt(lang) }] }],
    });
    if (message.stop_reason === "refusal") throw new PhotosetPlanError(422, "AI 無法判讀這張照片，請換一張再試。");
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map(block => block.text).join("\n");
    const reading = formatReading(firstJsonObject(text), lang);
    if (!reading) throw new PhotosetPlanError(502, "AI 判讀照片失敗，請再試一次。");
    return { reading };
  }

  return { plan, readPhoto };
}

/** Free calls that still cost us a model call: a few per minute per person. */
const readHits = new Map<string, number[]>();
function tooManyReads(userId: string): boolean {
  const now = Date.now();
  const recent = (readHits.get(userId) ?? []).filter(t => now - t < 60_000);
  if (recent.length >= 8) { readHits.set(userId, recent); return true; }
  recent.push(now);
  readHits.set(userId, recent);
  return false;
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

  app.post("/api/photosets/read-photo", requireAuth, async (req, res) => {
    const userId = String(req.session.userId ?? req.ip);
    if (tooManyReads(userId)) return res.status(429).json({ error: "判讀太頻繁，請稍候一分鐘再試。" });
    try {
      res.json(await planner.readPhoto(req.body));
    } catch (error: any) {
      if (error instanceof PhotosetPlanError) return res.status(error.status).json({ error: error.message });
      console.error("Photo reading failed:", error?.message || error);
      res.status(500).json({ error: "AI 判讀照片失敗，請再試一次。" });
    }
  });
}

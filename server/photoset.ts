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
 *   ugc        — UGC 實拍短片 (/ugc). Same inputs as product, but the plan is a short
 *                video script: each shot has a first-frame image prompt (`prompt`),
 *                an English image-to-video motion prompt (`motion`), an on-screen
 *                subtitle (`subtitle`) and a length (`seconds`). The rules come from the
 *                owner's own prompt skills (short-video, video-continuity,
 *                image-to-video, hook library): 4–5 shots, a hook first, the same
 *                subject description repeated in every shot, motion written as
 *                "anchor + subject motion + camera + light", and no invented speech.
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
/** Product mode: photos of the product. */
export const PHOTOSET_MAX_PRODUCT_IMAGES = 3;

const planRequestSchema = z.object({
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
  direction: z.string().max(1200).optional(),
  /** Target aspect ratio label, only used to steer composition. */
  aspectRatio: z.string().max(10).optional(),
});

type PlanRequest = z.infer<typeof planRequestSchema>;
export type PhotosetShot = {
  title: string; prompt: string;
  /** ugc mode: image-to-video motion prompt (English), on-screen subtitle, clip length. */
  motion?: string; subtitle?: string; seconds?: number;
};
export type PhotosetPlan = {
  analysis: string; shots: PhotosetShot[];
  /** Product mode only: a post to go with the pictures. */
  caption?: string; hashtags?: string[];
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

function buildScenePrompt(req: PlanRequest, refLooks: number, poses: PlanPose[]): string {
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
  return `你是一位短影音導演兼 UGC 帶貨內容企劃。你會看到 ${refLooks + productLooks} 張圖：前 ${refLooks} 張是同一位「人物」的參考圖，只用來確認這個人的臉部五官、髮型髮色與身形；後 ${productLooks} 張是同一件「商品」的照片。

請寫一支 ${req.count} 個鏡頭的直式（9:16）UGC 實拍短片腳本：這位人物用手機自拍或請朋友手持拍攝，分享自己實際使用這件商品，適合 Reels、TikTok、Shorts。每個鏡頭會先生成一張「首幀圖」，再用圖生影片把它變成 4–6 秒的影片，所以每個鏡頭要同時給首幀圖的描述與動態的描述。
${info.length ? `\n【商品資訊】\n${info.join("\n")}\n` : ""}
【先分析】
用 2–3 句繁體中文描述：這件商品是什麼（品類、外觀、顏色、材質），以及你選定的「一個」拍攝地點、時段與光線（要是這類商品實際會被使用的日常場景）。

【整支片的結構】（${req.count} 個鏡頭依序對應，鏡頭較少時合併中間段）
1. 鉤子：前 2–3 秒就要讓人停下來。人物看向鏡頭、商品已經在畫面裡，像是影片從事情中途切入。
2. 展示：開箱或拿起商品，對著鏡頭展示外觀。
3. 使用：實際使用商品的過程，手部與商品的近景。
4. 感受：使用後的反應或細節特寫，靠表情與小動作表現，不靠台詞。
5. 收尾：人物拿著商品看向鏡頭，停在一個可以定格的畫面。

【每個鏡頭的 prompt（首幀圖）】
${SHOT_RULES}
- 首幀是影片的第一格：畫面是動作「開始前」的靜止瞬間，不要寫動作的過程。
- 風格是手機實拍：手持或自拍視角、現場自然光、構圖隨性、背景是真實的居家或日常環境。
- 每個鏡頭都要用同一句話重複寫出：人物的服裝、商品的外觀（品類、形狀、顏色、材質）、拍攝地點，讓每個鏡頭看起來是同一次拍攝。
- 商品必須清楚可辨識，不要變形，不要出現第二種商品。

【每個鏡頭的 motion（圖生影片的動態，用英文寫）】
- 一段連貫的英文段落，40–70 個英文單字，不要條列。
- 首幀圖模型已經看得到，所以只用半句話點出主體，其餘都寫「接下來幾秒發生的變化」。
- 依序寫三件事：主體動作（一個鏡頭只做一個清楚、物理上合理的動作）、鏡頭運動（handheld、slight push-in、POV、static 擇一，幅度要小）、光線或氛圍的細微變化。
- 動作要小而真實：拿起、轉動、打開、塗抹、喝一口、對鏡頭微笑、點頭。不要快速剪接、不要特效、不要畫面文字。
- 聲音只寫非語言的現場音（例如 soft room tone, cap click, fabric rustle）。不要寫任何人物說話的台詞。
- 結尾加上：The product keeps its exact shape, color and label. Natural phone-video look, no text overlay.

【每個鏡頭的 subtitle（上字幕用的一句話）】
- 繁體中文，每句 8–18 字，第一人稱口語。這是後製要疊在畫面上的字幕，不是人物說的話。
- 第一個鏡頭的字幕是鉤子，從這四種寫法挑一種：反直覺的結論、具體數字加時間、點名某一種人、從事情中途切入。
- 不要用暖場句（大家好、今天要分享）、自我介紹、弱疑問句（有沒有人跟我一樣）、形容詞堆疊（超好用又實用）。
- 只能寫圖片上看得到的特徵與賣家提供的賣點，不要編造成分、價格、折扣或數據；不要寫療效、醫療功效、「保證有效」「第一」「最」這類宣稱。
- 最後一個鏡頭的字幕是自然的行動呼籲。

【每個鏡頭的 seconds】整數，4 到 6，整支片合計 15–25 秒。${userExtras(req)}

【貼文文案】
- caption：繁體中文，60–120 字，第一人稱，搭配這支影片發布用；規則同字幕。
- hashtags：5–8 個，不含 # 符號。

【輸出格式】
只輸出一個 JSON 物件，不要有任何其他文字或 Markdown：
{"analysis":"……","shots":[{"title":"4–10 字的鏡頭名稱","prompt":"首幀圖提示詞","motion":"English motion paragraph","subtitle":"字幕","seconds":5}],"caption":"……","hashtags":["……"]}
shots 陣列必須剛好 ${req.count} 個元素。`;
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
      ...(typeof s?.motion === "string" && s.motion.trim() ? { motion: s.motion.trim().slice(0, 1200) } : {}),
      ...(typeof s?.subtitle === "string" && s.subtitle.trim() ? { subtitle: s.subtitle.trim().slice(0, 60) } : {}),
      ...(Number.isFinite(Number(s?.seconds)) ? { seconds: Math.max(4, Math.min(6, Math.round(Number(s.seconds)))) } : {}),
    }))
    .filter((s: PhotosetShot) => s.prompt.length > 0)
    .slice(0, count);
  if (shots.length < PHOTOSET_MIN_SHOTS) {
    throw new Error("AI 沒有產生足夠的鏡頭，請再試一次。");
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

    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });

    const message = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: body.mode === "ugc" ? 6000 : 4000,
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

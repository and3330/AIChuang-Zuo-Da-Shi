// 角色生成器（兩階段建立角色）的設定：外貌與身材選項、背景故事欄位，以及把設定寫成提示詞。
// 前後端共用。選項的範例圖放在 client/public/character-options/<屬性>-<值>.webp。
//
// 流程：
//   1. 臉：上傳臉部照片（第一張是正面），AI 判讀品質與外貌。
//   2. 身材：正面身材照（建議）與背面身材照（選填）。照片裡的臉在生成時會被塗灰，不會混進角色的臉。
//   3. 外貌與身材比例：AI 先從照片判讀，使用者用範例圖修改。
//   4. 背景故事（選填）：不影響長相，只給文字規劃（寫真企劃等）參考。
// 生成時先用臉部照片做一張標準正臉「臉卡」與一張 3/4 側臉，再用「臉卡＋側臉＋塗掉臉的身材照」生成正面全身，
// 使用者確認像了才做其餘三張四視圖。臉卡之後也排在角色圖庫的第一張，所有生成都以它為準。

export type Gender = "female" | "male";

export type ProfileOption = {
  value: string;
  /** Label shown on the picker (Traditional Chinese; translated with tr()). */
  label: string;
  /** What goes into the image prompt. */
  prompt: string;
};

export type ProfileAttr = {
  key: string;
  group: "looks" | "body";
  label: string;
  /** Only shown for female characters. */
  femaleOnly?: boolean;
  options: ProfileOption[];
};

const o = (value: string, label: string, prompt: string): ProfileOption => ({ value, label, prompt });

export const LOOK_ATTRS: ProfileAttr[] = [
  { key: "skinTone", group: "looks", label: "膚色", options: [
    o("fair", "白皙", "膚色白皙"), o("light", "淺膚色", "膚色偏淺"), o("medium", "自然膚色", "自然的中等膚色"),
    o("olive", "橄欖膚色", "橄欖色膚色"), o("tan", "小麥膚色", "小麥色膚色"), o("brown", "深膚色", "深棕色膚色"), o("dark", "黝黑", "黝黑的深色膚色"),
  ] },
  { key: "faceShape", group: "looks", label: "臉型", options: [
    o("oval", "鵝蛋臉", "鵝蛋臉"), o("round", "圓臉", "圓臉"), o("heart", "瓜子臉", "瓜子臉（下巴尖）"),
    o("square", "方臉", "方臉（下顎線明顯）"), o("long", "長臉", "長臉"),
  ] },
  { key: "eyeShape", group: "looks", label: "眼型", options: [
    o("monolid", "單眼皮", "單眼皮"), o("inner", "內雙", "內雙眼皮"), o("double", "雙眼皮", "明顯的雙眼皮"),
  ] },
  { key: "eyeColor", group: "looks", label: "眼睛顏色", options: [
    o("darkBrown", "深棕", "深棕色（近黑）的眼睛"), o("brown", "棕色", "棕色眼睛"), o("hazel", "淺褐", "淺褐色眼睛"),
    o("green", "綠色", "綠色眼睛"), o("blue", "藍色", "藍色眼睛"), o("gray", "灰色", "灰色眼睛"),
  ] },
  { key: "lips", group: "looks", label: "唇形", options: [
    o("thin", "薄唇", "嘴唇偏薄"), o("medium", "中等", "嘴唇厚度中等"), o("full", "豐唇", "豐厚的嘴唇"), o("veryFull", "很豐厚", "非常豐厚的嘴唇"),
  ] },
  { key: "hairColor", group: "looks", label: "髮色", options: [
    o("black", "黑色", "黑髮"), o("darkBrown", "深棕", "深棕色頭髮"), o("brown", "棕色", "棕色頭髮"), o("chestnut", "栗色", "栗棕色頭髮"),
    o("blonde", "金色", "金髮"), o("platinum", "白金", "白金色頭髮"), o("red", "紅色", "紅髮"), o("gray", "銀灰", "銀灰色頭髮"), o("pink", "粉紅", "染成粉紅色的頭髮"),
  ] },
  { key: "hairLength", group: "looks", label: "髮長", options: [
    o("buzz", "極短", "極短的平頭"), o("short", "短髮", "短髮"), o("shoulder", "及肩", "及肩的頭髮"), o("long", "長髮", "過胸的長髮"), o("veryLong", "超長", "及腰的超長髮"),
  ] },
  { key: "hairTexture", group: "looks", label: "髮質", options: [
    o("straight", "直髮", "直髮"), o("wavy", "波浪", "波浪捲髮"), o("curly", "捲髮", "捲髮"), o("coily", "細密捲", "細密的小捲髮"),
  ] },
];

export const BODY_ATTRS: ProfileAttr[] = [
  { key: "build", group: "body", label: "體態", options: [
    o("slim", "纖瘦", "纖瘦的體態"), o("average", "勻稱", "勻稱的體態"), o("athletic", "健美", "健美、有肌肉線條的體態"),
    o("curvy", "豐滿", "豐滿有曲線的體態"), o("heavy", "豐腴", "豐腴圓潤的體態"),
  ] },
  { key: "figure", group: "body", label: "身形比例", options: [
    o("hourglass", "沙漏型", "沙漏型身材：胸圍與臀圍相近、腰明顯纖細"), o("pear", "梨型", "梨型身材：臀部比肩膀與胸部寬"),
    o("invertedTriangle", "倒三角型", "倒三角型身材：肩膀與胸部比臀部寬"), o("rectangle", "直筒型", "直筒型身材：胸、腰、臀寬度相近"),
    o("apple", "蘋果型", "蘋果型身材：腰腹較圓、腿較細"),
  ] },
  { key: "bust", group: "body", label: "胸部", femaleOnly: true, options: [
    o("flat", "平坦", "胸部平坦"), o("small", "小", "胸部較小"), o("medium", "中等", "胸部大小中等"), o("full", "豐滿", "胸部豐滿"), o("veryFull", "很豐滿", "胸部非常豐滿"),
  ] },
  { key: "waist", group: "body", label: "腰", options: [
    o("slim", "纖細", "腰部纖細"), o("average", "一般", "腰部粗細一般"), o("thick", "較粗", "腰部較粗"),
  ] },
  { key: "hips", group: "body", label: "臀部", options: [
    o("flat", "扁平", "臀部扁平"), o("small", "小巧", "臀部小巧"), o("medium", "中等", "臀部大小中等"), o("round", "圓翹", "臀部圓翹"), o("full", "豐滿", "臀部豐滿寬厚"),
  ] },
  { key: "legs", group: "body", label: "腿型", options: [
    o("slim", "纖細", "雙腿纖細"), o("average", "一般", "雙腿粗細一般"), o("athletic", "健美", "雙腿健美有肌肉"), o("curvy", "豐腴", "大腿豐腴"),
  ] },
];

export const PROFILE_ATTRS: ProfileAttr[] = [...LOOK_ATTRS, ...BODY_ATTRS];

export function attrsFor(group: "looks" | "body", gender: Gender | undefined): ProfileAttr[] {
  return PROFILE_ATTRS.filter(a => a.group === group && !(a.femaleOnly && gender === "male"));
}

export function optionImage(attrKey: string, value: string): string {
  return `/character-options/${attrKey}-${value}.webp`;
}

export function findOption(attrKey: string, value: string | undefined): ProfileOption | undefined {
  if (!value) return undefined;
  return PROFILE_ATTRS.find(a => a.key === attrKey)?.options.find(op => op.value === value);
}

/** Numbers the person may type in: height, weight and measurements, in cm / kg. */
export const BODY_NUMBERS = [
  { key: "heightCm", label: "身高（公分）", min: 120, max: 220 },
  { key: "weightKg", label: "體重（公斤）", min: 30, max: 200 },
  { key: "bustCm", label: "胸圍（公分）", min: 50, max: 160 },
  { key: "waistCm", label: "腰圍（公分）", min: 40, max: 160 },
  { key: "hipsCm", label: "臀圍（公分）", min: 50, max: 170 },
] as const;
export type BodyNumberKey = typeof BODY_NUMBERS[number]["key"];

export const BACKSTORY_FIELDS = [
  { key: "age", label: "年齡", max: 3, placeholder: "例如：26" },
  { key: "city", label: "所在城市", max: 40, placeholder: "例如：台中" },
  { key: "niche", label: "領域", max: 60, placeholder: "例如：健身與生活" },
  { key: "personality", label: "個性", max: 300, placeholder: "例如：溫暖、有點害羞、很愛笑" },
  { key: "background", label: "成長背景", max: 500, placeholder: "在哪裡長大、怎麼走到現在" },
  { key: "daily", label: "日常生活", max: 300, placeholder: "例如：平日在咖啡店上班，週末去爬山" },
  { key: "contentTypes", label: "常做的內容", max: 200, placeholder: "例如：穿搭分享、健身打卡、早晨日常" },
  { key: "interests", label: "興趣與嗜好", max: 200, placeholder: "例如：抹茶、陶藝、二手古著" },
  { key: "audience", label: "觀眾是誰", max: 300, placeholder: "誰會追蹤她、想看什麼" },
  { key: "notes", label: "其他", max: 800, placeholder: "其他值得記住的設定" },
] as const;
export type BackstoryKey = typeof BACKSTORY_FIELDS[number]["key"];

/** 0–1000 coordinates of the face in a photo: [x1, y1, x2, y2]. */
export type FaceBox = [number, number, number, number];

export type CharacterProfile = {
  version: 1;
  gender?: Gender;
  /** Face photos, first = the main front photo. Also the start of the character's refImageUrls. */
  facePhotos: string[];
  bodyPhotos: { front?: string; back?: string };
  /** Where the face is in each body photo, so it can be greyed out before generating. */
  faceBoxes?: Record<string, FaceBox>;
  looks: Record<string, string>;
  body: Record<string, string>;
  numbers: Partial<Record<BodyNumberKey, number>>;
  backstory: Partial<Record<BackstoryKey, string>>;
  /** Generated: the standard front face and a 3/4 face, both on the CDN. */
  faceCardUrl?: string;
  faceAngleUrl?: string;
};

export const MAX_FACE_PHOTOS = 5;

export function emptyProfile(): CharacterProfile {
  return { version: 1, facePhotos: [], bodyPhotos: {}, looks: {}, body: {}, numbers: {}, backstory: {} };
}

const clampNum = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
};
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Cleans a profile that came from the browser: unknown attributes and values are dropped. */
export function sanitizeProfile(raw: any): CharacterProfile {
  const p = emptyProfile();
  if (!raw || typeof raw !== "object") return p;
  if (raw.gender === "female" || raw.gender === "male") p.gender = raw.gender;
  const url = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 2000 && !v.startsWith("data:") ? v : "");
  p.facePhotos = (Array.isArray(raw.facePhotos) ? raw.facePhotos : []).map(url).filter(Boolean).slice(0, MAX_FACE_PHOTOS);
  const front = url(raw.bodyPhotos?.front), back = url(raw.bodyPhotos?.back);
  if (front) p.bodyPhotos.front = front;
  if (back) p.bodyPhotos.back = back;
  if (raw.faceBoxes && typeof raw.faceBoxes === "object") {
    const boxes: Record<string, FaceBox> = {};
    for (const photo of [front, back].filter(Boolean)) {
      const b = raw.faceBoxes[photo];
      if (Array.isArray(b) && b.length === 4 && b.every((n: unknown) => typeof n === "number" && n >= 0 && n <= 1000)) boxes[photo] = b as FaceBox;
    }
    if (Object.keys(boxes).length) p.faceBoxes = boxes;
  }
  for (const [group, target] of [["looks", p.looks], ["body", p.body]] as const) {
    for (const a of PROFILE_ATTRS.filter(x => x.group === group)) {
      const v = raw[group]?.[a.key];
      if (typeof v === "string" && a.options.some(op => op.value === v)) target[a.key] = v;
    }
  }
  for (const n of BODY_NUMBERS) {
    const v = clampNum(raw.numbers?.[n.key], n.min, n.max);
    if (v !== undefined) p.numbers[n.key] = v;
  }
  for (const f of BACKSTORY_FIELDS) {
    const v = str(raw.backstory?.[f.key], f.max);
    if (v) p.backstory[f.key] = v;
  }
  return p;
}

/** The chosen looks and body, as one sentence for the image prompt. Empty when nothing is set. */
export function profilePrompt(p: CharacterProfile | null | undefined): string {
  if (!p) return "";
  const pick = (group: "looks" | "body") => attrsFor(group, p.gender)
    .map(a => findOption(a.key, (group === "looks" ? p.looks : p.body)[a.key])?.prompt).filter(Boolean) as string[];
  const looks = pick("looks");
  const body = pick("body");
  const n = p.numbers;
  if (n.heightCm) body.push(`身高約 ${n.heightCm} 公分`);
  if (n.weightKg) body.push(`體重約 ${n.weightKg} 公斤`);
  if (n.bustCm && n.waistCm && n.hipsCm) body.push(`三圍約 ${n.bustCm}／${n.waistCm}／${n.hipsCm} 公分`);
  const parts: string[] = [];
  if (p.gender) parts.push(p.gender === "female" ? "成年女性" : "成年男性");
  if (looks.length) parts.push(`外貌：${looks.join("、")}`);
  if (body.length) parts.push(`身材：${body.join("、")}${p.bodyPhotos.front ? "（身材以身材照為準，這些設定只做微調）" : ""}`);
  return parts.join("。");
}

/** Only the face and hair settings, for the face card. */
export function looksPrompt(p: CharacterProfile | null | undefined): string {
  if (!p) return "";
  return attrsFor("looks", p.gender).map(a => findOption(a.key, p.looks[a.key])?.prompt).filter(Boolean).join("、");
}

/** The backstory as plain text for text planners (never for image prompts). */
export function backstoryText(p: CharacterProfile | null | undefined): string {
  if (!p) return "";
  return BACKSTORY_FIELDS.map(f => (p.backstory[f.key] ? `${f.label}：${p.backstory[f.key]}` : "")).filter(Boolean).join("\n");
}

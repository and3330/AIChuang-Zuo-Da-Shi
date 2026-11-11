// 安全與隱私：年齡、成人內容開關、成人內容偵測。前後端共用。
//
// 規則：
//   1. 帳號預設不能使用成人內容的提示詞。
//   2. 使用者要先填生日，年滿 ADULT_AGE，並同意 NSFW_TERMS_OF_USE，才能啟用。
//   3. 提示詞被 containsNsfw() 判定為成人內容時，沒啟用的帳號直接擋下（不扣積分）；
//      啟用的帳號可以生成，成品標記為 sensitive，畫面上先模糊，點了才顯示。

export const ADULT_AGE = 18;

/** birthDate: "YYYY-MM-DD". Returns null when missing or not a real date. */
export function ageFromBirthDate(birthDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

export function isAdult(birthDate: string | null | undefined): boolean {
  const age = ageFromBirthDate(birthDate);
  return age !== null && age >= ADULT_AGE;
}

/** True when this account may send adult prompts. */
export function canUseNsfw(user: { birthDate?: string | null; nsfwEnabled?: boolean | null } | null | undefined): boolean {
  return !!user?.nsfwEnabled && isAdult(user.birthDate);
}

// Detection only: these mark a prompt as adult so it can be gated and blurred.
const NSFW_TERMS_ZH = [
  "裸體", "全裸", "半裸", "裸露", "赤裸", "裸身", "露點", "乳頭", "乳暈", "性愛", "做愛", "性交", "性行為",
  "色情", "情色", "成人片", "自慰", "陰部", "私處", "下體", "生殖器", "情趣內衣", "十八禁", "18禁", "限制級",
];
const NSFW_TERMS_EN = [
  "nsfw", "nude", "nudity", "naked", "topless", "nipple", "nipples", "sex", "sexual", "porn", "porno",
  "pornographic", "erotic", "hentai", "genitals", "r18", "r-18", "x-rated", "bdsm",
];
const NSFW_EN_PATTERN = new RegExp(`(^|[^a-z0-9])(${NSFW_TERMS_EN.map(t => t.replace(/[-]/g, "\\-")).join("|")})([^a-z0-9]|$)`, "i");

export function containsNsfw(text: string | null | undefined): boolean {
  if (!text) return false;
  return NSFW_TERMS_ZH.some(t => text.includes(t)) || NSFW_EN_PATTERN.test(text);
}

/** Shown, and must be accepted, before adult content is enabled. */
export const NSFW_TERMS_OF_USE: string[] = [
  "我已年滿 18 歲，且我所在地區的法律允許我瀏覽與製作成人內容。",
  "我不會生成任何涉及未成年人、或外觀看起來像未成年人的性相關內容。",
  "我不會用真實人物的肖像生成成人內容，除非是我本人，或已取得當事人明確同意；也不會用於騷擾、報復、詐騙或未經同意的散布。",
  "生成內容的使用、保存與散布，以及因此產生的一切法律責任，由我自行承擔。",
  "違反以上任何一項，帳號會被停用且不退還積分，平台並得依法配合調查。",
];

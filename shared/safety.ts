// 安全與隱私：年齡、會員階級、成人內容偵測。前後端共用。
//
// 規則：
//   1. 會員分兩階：正式會員（MEMBERSHIP）與黃金會員（GOLD_MEMBERSHIP）。
//   2. 一般頁面一律不接受成人內容的提示詞，任何階級都一樣（不扣積分）。
//   3. 成人內容只在黃金專區（網址以 GOLD_ZONE_PATH 開頭）開放，而且帳號必須是
//      黃金會員、年滿 ADULT_AGE、同意 GOLD_TERMS_OF_USE。
//      加入黃金會員前要先完成申請：認證 Email、填真實姓名、同意條款（goldApplicationDone）。
//      入口是帳戶設定「內容審查限制」裡的開關；除了那個開關，畫面上不出現內容分級的字眼。
//   4. 黃金專區的成品一律標記為 sensitive，畫面上先模糊，點了才顯示。
//   5. 黃金專區不接受任何與未成年人、學生相關的提示詞。

/** Client route prefix of the gold zone; requests from it carry `X-Zone: gold`. */
export const GOLD_ZONE_PATH = "/gold";
export const GOLD_ZONE_HEADER = "x-zone";
export const GOLD_ZONE_VALUE = "gold";

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

type SafetyUser = { birthDate?: string | null; nsfwEnabled?: boolean | null; isGold?: boolean | null } | null | undefined;

/** 18+ by birth date and has accepted the terms. Needed before the gold tier can be bought. */
export function hasAdultConsent(user: SafetyUser): boolean {
  return !!user?.nsfwEnabled && isAdult(user.birthDate);
}

/** Application for the gold tier is complete: 18+, terms accepted, e-mail confirmed, real name given. */
export function goldApplicationDone(user: (SafetyUser & { realName?: string | null; emailVerifiedAt?: unknown }) | null | undefined): boolean {
  return hasAdultConsent(user) && !!user?.realName && !!user?.emailVerifiedAt;
}

/** True when this account may use the gold zone: gold tier, 18+, terms accepted. */
export function canUseNsfw(user: SafetyUser): boolean {
  return !!user?.isGold && hasAdultConsent(user);
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

// Never accepted in the gold zone, whatever else the prompt says.
const MINOR_TERMS_ZH = [
  "未成年", "未滿18", "未滿十八", "兒童", "小孩", "孩童", "幼女", "幼童", "幼兒", "蘿莉", "萝莉", "正太", "小學", "國小", "國中", "初中",
  "高中", "中學", "學生", "学生", "校服", "學生服", "制服少女", "水手服", "女童", "男童", "少女", "少年", "稚嫩", "童顏",
];
const MINOR_TERMS_EN = [
  "child", "children", "kid", "kids", "minor", "minors", "underage", "under-age", "teen", "teens", "teenage", "teenager",
  "loli", "lolita", "shota", "schoolgirl", "schoolboy", "school girl", "school boy", "school uniform", "sailor uniform",
  "student", "preteen", "toddler", "infant", "young girl", "young boy", "little girl", "little boy",
];
const MINOR_EN_PATTERN = new RegExp(`(^|[^a-z0-9])(${MINOR_TERMS_EN.map(t => t.replace(/[-]/g, "\\-")).join("|")})([^a-z0-9]|$)`, "i");
const MINOR_AGE_PATTERN = /(^|\D)(\d{1,2})\s*(歲|岁|years?\s*old|y\.?o\.?|yrs?)/gi;

/** True when a prompt refers to minors or students, or states an age under ADULT_AGE. */
export function containsMinorTerms(text: string | null | undefined): boolean {
  if (!text) return false;
  if (MINOR_TERMS_ZH.some(t => text.includes(t)) || MINOR_EN_PATTERN.test(text)) return true;
  for (const m of Array.from(text.matchAll(MINOR_AGE_PATTERN))) {
    if (Number(m[2]) < ADULT_AGE) return true;
  }
  return false;
}

/** AI 生成內容的法律風險說明。加入黃金會員前要逐條顯示並同意。 */
export const GOLD_TERMS_OF_USE: string[] = [
  "我已年滿 18 歲，具有完全行為能力，且我所在地區的法律允許我瀏覽與製作黃金專區提供的內容。",
  "我了解所有內容都是 AI 生成的，可能不正確，也可能與真實人物或既有作品相似；平台不保證內容的正確性、合法性或可供商業使用，使用前由我自行判斷。",
  "我不會生成任何涉及未成年人、或外觀看起來像未成年人的內容。",
  "我只會上傳我本人、或已取得當事人明確同意的照片；不會製作冒用他人身分、足以讓人誤認為真實的影像，也不會用於騷擾、報復、詐騙、誹謗或未經同意的散布。",
  "我不會生成侵害他人著作權、商標權、肖像權或隱私權的內容，也不會生成我所在地法律禁止的內容。",
  "黃金專區的作品不能公開到作品牆。我在其他平台發布時，會遵守該平台的規範，並依當地法規標示為 AI 生成內容。",
  "生成內容的使用、保存與散布，以及因此產生的一切法律責任，由我自行承擔，與平台無關。",
  "我提供的真實姓名與 Email 只用於確認會員資格，平台會在法律要求時配合提供。違反以上任何一項，帳號會被停用，且不退還費用與積分。",
];

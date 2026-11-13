// 角色四視圖（正面／3/4 側／側面／背面）的固定提示詞。
// 網站的角色庫與對外 API 的角色共用同一組，確保兩邊產出的四視圖一致。

export type FourViewKey = "front" | "threeQuarter" | "side" | "back";

export const FOUR_VIEW_PRESETS: { key: FourViewKey; promptZh: string }[] = [
  { key: "front",        promptZh: "角色正面全身肖像，A-pose 站姿，正面對鏡頭，乾淨白色背景，中性表情，雙臂自然下垂略微張開，全身入鏡（從頭到腳），高解析、無遮擋、清晰光線" },
  { key: "threeQuarter", promptZh: "同一角色 3/4 側身全身肖像（左前 45 度），A-pose 站姿，乾淨白色背景，中性表情，全身入鏡，與正面圖完全一致的服裝、髮型、體型與五官" },
  { key: "side",         promptZh: "同一角色純側面全身肖像（90 度側面），A-pose 站姿，乾淨白色背景，中性表情，全身入鏡，與正面圖完全一致的服裝、髮型、體型與五官" },
  { key: "back",         promptZh: "同一角色背面全身肖像，A-pose 站姿，乾淨白色背景，全身入鏡，背向鏡頭，與正面圖完全一致的髮型、服裝與體型" },
];

export const FOUR_VIEW_SIZE = "1440x2560";

/** The full prompt for one view of a character. */
/**
 * `refCount` is how many reference images go with the prompt. With several, the model is told to
 * read the face from all of them: "match reference 1" made it copy the first photo and ignore the rest.
 */
export function fourViewPrompt(presetPrompt: string, description?: string | null, styleHint?: string | null, refCount = 1): string {
  const base = description?.trim() ? `角色描述：${description.trim()}。` : "";
  const style = styleHint?.trim() ? `，整體風格：${styleHint.trim()}` : "";
  const keep = refCount > 1
    ? `（${refCount} 張參考圖都是同一個人：請綜合每一張參考圖判斷他的臉型、五官、髮型髮色、膚色、年齡與體型，不要只看其中一張；服裝以第 1 張參考圖為準）`
    : "（保持與第 1 張參考圖完全一致的角色外貌、髮色、五官、年齡與服裝）";
  return `${base}${presetPrompt}${style}${keep}`;
}

// ─── 先確認正面圖 ───────────────────────────────────────────────────────────
// 從「上傳照片建立角色」開始的四視圖分兩段：先只做正面圖，角色的 fourViewStatus 變成 "confirm"，
// 等使用者確認「像」之後才做其餘三張。不像可以重新生成正面圖：前 FRONT_FREE_RETRIES 次免費，
// 之後每次收一張圖的積分。已經重生幾次記在狀態字串後面（"confirm:2"），不另外開欄位。

export const FRONT_FREE_RETRIES = 2;

/** The front view is ready and waits for the person to say whether it looks like them. */
export function awaitingFrontConfirm(status?: string | null): boolean {
  return !!status && status.startsWith("confirm");
}

/** How many times the front view was regenerated while waiting for confirmation. */
export function frontRetriesUsed(status?: string | null): number {
  const n = Number((status ?? "").split(":")[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function frontConfirmStatus(retriesUsed: number): string {
  return retriesUsed > 0 ? `confirm:${retriesUsed}` : "confirm";
}

// ─── 上傳照片的 AI 判讀 ─────────────────────────────────────────────────────
export type PhotoAngle = "front_face" | "three_quarter" | "side" | "full_body" | "back" | "other";
export type PhotoQuality = "good" | "fair" | "poor";
export type PhotoTags = {
  /** What the photo shows of the person. */
  angle: PhotoAngle;
  /** How usable it is as a likeness reference. */
  quality: PhotoQuality;
  /** Why it is not "good" (blurry, face covered, filter...). Empty when good. In the interface language. */
  issue: string;
  /** 4 to 6 short labels of the person's own features (not clothes or background), in the interface language. */
  tags: string[];
  /** A full appearance description of the person as seen in this photo, ready to go into an image prompt. */
  prompt: string;
};

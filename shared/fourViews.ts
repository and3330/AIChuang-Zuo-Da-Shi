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
export function fourViewPrompt(presetPrompt: string, description?: string | null, styleHint?: string | null): string {
  const base = description?.trim() ? `角色描述：${description.trim()}。` : "";
  const style = styleHint?.trim() ? `，整體風格：${styleHint.trim()}` : "";
  return `${base}${presetPrompt}${style}（保持與第 1 張參考圖完全一致的角色外貌、髮色、五官、年齡與服裝）`;
}

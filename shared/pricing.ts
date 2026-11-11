// 全站計價，前後端共用。改價只改這個檔案。
// （對外 API 的計價另外定義在 server/partnerApi.ts，不受這裡影響。）

/** 每張圖片（文字生圖、圖片編輯、寫真、漫劇分鏡圖都一樣）。 */
export const IMAGE_COST = 5;
/** 去除浮水印的加價，每張。 */
export const WATERMARK_REMOVAL_COST = 1;

export function imageCost(watermark: boolean): number {
  return watermark ? IMAGE_COST : IMAGE_COST + WATERMARK_REMOVAL_COST;
}

/** 影片每秒。 */
export const VIDEO_COST_PER_SECOND = { "720p": 8, "1080p": 15 } as const;

/** 信箱驗證完成（或用 Google 註冊）時送的積分，每個帳號一次。 */
export const SIGNUP_CREDITS = 10;

/** 一次性開通會員：付這個金額、拿這些積分。開通後才能加購積分。 */
export const MEMBERSHIP = { priceUsd: 9.9, credits: 300 } as const;

/** 加購積分的最低數量（1 積分 = 1 元新台幣）。 */
export const MIN_TOPUP = 50;

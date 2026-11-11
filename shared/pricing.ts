// 全站計價，前後端共用。改價只改這個檔案。
// （對外 API 的計價另外定義在 server/partnerApi.ts，不受這裡影響。）

/** 每張圖片（文字生圖、圖片編輯、寫真、漫劇分鏡圖都一樣；黃金專區也是這個價）。 */
export const IMAGE_COST = 5;
/** 角色四視圖（一次 4 張）。每個帳號的第一次免費；之後每建立一個角色、或重新生成，都收這個價。 */
export const FOUR_VIEW_COST = 30;
/** 去除浮水印的加價，每張：一般區。 */
export const WATERMARK_REMOVAL_COST = 1;
/** 去除浮水印的加價，每張：黃金專區。 */
export const GOLD_WATERMARK_REMOVAL_COST = 3;

/** 一般區：有浮水印 5、去浮水印 6。黃金專區：有浮水印 5、去浮水印 8。 */
export function imageCost(watermark: boolean, gold: boolean = false): number {
  return watermark ? IMAGE_COST : IMAGE_COST + (gold ? GOLD_WATERMARK_REMOVAL_COST : WATERMARK_REMOVAL_COST);
}

/** 影片每秒。 */
export const VIDEO_COST_PER_SECOND = { "720p": 8, "1080p": 15 } as const;

/** 信箱驗證完成（或用 Google 註冊）時送的積分，每個帳號一次。 */
export const SIGNUP_CREDITS = 10;

/** 一次性開通會員：付這個金額、拿這些積分。開通後才能加購積分。 */
export const MEMBERSHIP = { priceUsd: 9.9, credits: 300 } as const;

/** 黃金會員：正式會員再付這個金額升級、拿這些積分。須先是正式會員、年滿 18 歲並同意條款。 */
export const GOLD_MEMBERSHIP = { priceUsd: 22, credits: 600 } as const;

/** 小試身手：還不是會員時可以買一次，不算會員、不能加購。 */
export const TRIAL = { priceUsd: 2, credits: 40 } as const;

/** 加購積分的最低金額（新台幣）。 */
export const MIN_TOPUP = 50;

/** 儲值包（正式會員才能買）。金額越大加贈越多。 */
export const TOPUP_PACKS = [
  { twd: 100, credits: 100 },
  { twd: 300, credits: 320 },
  { twd: 500, credits: 550 },
  { twd: 1000, credits: 1150 },
  { twd: 3000, credits: 3600 },
] as const;

/** 付這個金額（新台幣）拿到的積分：自訂金額套用不超過它的最大一包的加贈比例。 */
export function topupCredits(twd: number): number {
  let pack: { twd: number; credits: number } = { twd: 1, credits: 1 };
  for (const p of TOPUP_PACKS) if (twd >= p.twd) pack = p;
  return Math.floor((twd * pack.credits) / pack.twd);
}

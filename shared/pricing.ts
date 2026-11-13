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

/** 影片每秒（預設模型 WAN 3.0）。 */
export const VIDEO_COST_PER_SECOND = { "720p": 8, "1080p": 15 } as const;

/**
 * 影片頁可以選的模型：價格，以及這個模型做得到的選項（頁面只顯示做得到的）。
 *   ratios   文字生影片可選的畫面比例；圖生影片一律跟隨首幀圖片。
 *   audio    模型本身會不會輸出音軌（WAN 會；Kling 沒有開關，以實際輸出為準）。
 * 影片長度兩個模型在網站上都開放 VIDEO_SECONDS 的範圍。夥伴 API 與故事動畫只用 WAN。
 */
export const VIDEO_MODELS = {
  wan: {
    label: "WAN 3.0", desc: "阿里 WAN 3.0，速度快、價格低，自帶音訊。",
    perSecond: { "720p": 8, "1080p": 15 }, ratios: ["16:9", "9:16", "1:1", "4:3", "3:4"], audio: true,
  },
  kling: {
    label: "Kling 4.0", desc: "可靈 Kling 4.0，人物與動作更細緻，適合要求高的作品。",
    perSecond: { "720p": 12, "1080p": 20 }, ratios: ["16:9", "9:16", "1:1", "21:9"], audio: false,
  },
  // AtlasCloud list price (2026-11): 720p US$0.30/s, 1080p US$0.59/s — about 2.7× Kling's.
  // Priced for about a 40% gross margin (1 credit = NT$1, after the 8% payment fee).
  seedance: {
    label: "Seedance 2.5", desc: "字節 Seedance 2.5，畫面與動作最細緻、自帶音訊，價格最高。",
    perSecond: { "720p": 18, "1080p": 35 }, ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], audio: true,
  },
} as const;
export type VideoModelKey = keyof typeof VIDEO_MODELS;
export const VIDEO_MODEL_KEYS = Object.keys(VIDEO_MODELS) as VideoModelKey[];
export const VIDEO_SECONDS = { min: 4, max: 12, default: 5 } as const;
export const VIDEO_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;

/** Accepts a key ("kling") or a provider model id ("kwaivgi/kling-v4.0/..."). Anything else is WAN. */
export function videoModelKey(model: string | null | undefined): VideoModelKey {
  const m = (model ?? "").toLowerCase();
  return m.includes("kling") ? "kling" : m.includes("seedance") ? "seedance" : "wan";
}

export function videoCostPerSecond(model: string | null | undefined, resolution: string | null | undefined): number {
  return VIDEO_MODELS[videoModelKey(model)].perSecond[resolution === "720p" ? "720p" : "1080p"];
}

/** 信箱驗證完成（或用 Google 註冊）時送的積分，每個帳號一次。 */
export const SIGNUP_CREDITS = 10;

/** 一次性開通會員：付這個金額、拿這些積分。開通後才能加購積分。 */
export const MEMBERSHIP = { priceUsd: 9.9, credits: 200 } as const;

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

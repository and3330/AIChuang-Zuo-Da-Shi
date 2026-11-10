/**
 * Official Seedream 5.5 output sizes on AtlasCloud: 8 aspect ratios × 3
 * quality tiers = 24 presets. These are the ONLY sizes the model accepts, so
 * UI size pickers should offer exactly these. The value sent to the API layer
 * is "WIDTHxHEIGHT"; server/atlasProvider.ts converts it to Atlas's "W*H".
 *
 * Keep in sync with ATLAS_SIZE_PRESETS in server/atlasProvider.ts.
 */

export type ImageTierId = "2k" | "1.5k" | "1k";
export type ImageRatioId = "1:1" | "3:4" | "4:3" | "9:16" | "16:9" | "2:3" | "3:2" | "21:9";

export const IMAGE_TIERS: Array<{ id: ImageTierId; label: string; hint: string }> = [
  { id: "2k", label: "2K 高畫質", hint: "最清晰，適合發佈與裁切" },
  { id: "1.5k", label: "1.5K 標準", hint: "畫質與速度平衡" },
  { id: "1k", label: "1K 快速", hint: "出圖最快，適合試拍" },
];

export const IMAGE_RATIOS: Array<{
  id: ImageRatioId;
  label: string;
  hint: string;
  sizes: Record<ImageTierId, [number, number]>;
}> = [
  { id: "3:4", label: "3:4 直式", hint: "IG／小紅書貼文", sizes: { "2k": [1776, 2368], "1.5k": [1344, 1792], "1k": [864, 1152] } },
  { id: "1:1", label: "1:1 方形", hint: "IG 方形貼文、頭貼", sizes: { "2k": [2048, 2048], "1.5k": [1536, 1536], "1k": [1024, 1024] } },
  { id: "9:16", label: "9:16 滿版直式", hint: "限時動態／Reels／Shorts 封面", sizes: { "2k": [1584, 2816], "1.5k": [1152, 2048], "1k": [800, 1424] } },
  { id: "2:3", label: "2:3 直式", hint: "相機原生直幅、Pinterest", sizes: { "2k": [1664, 2496], "1.5k": [1248, 1872], "1k": [832, 1248] } },
  { id: "4:3", label: "4:3 橫式", hint: "Facebook、部落格配圖", sizes: { "2k": [2368, 1776], "1.5k": [1792, 1344], "1k": [1152, 864] } },
  { id: "3:2", label: "3:2 橫式", hint: "相機原生橫幅", sizes: { "2k": [2496, 1664], "1.5k": [1872, 1248], "1k": [1248, 832] } },
  { id: "16:9", label: "16:9 寬螢幕", hint: "YouTube 封面、橫幅", sizes: { "2k": [2816, 1584], "1.5k": [2048, 1152], "1k": [1424, 800] } },
  { id: "21:9", label: "21:9 電影寬幅", hint: "電影感橫幅、網站主視覺", sizes: { "2k": [3136, 1344], "1.5k": [2352, 1008], "1k": [1568, 672] } },
];

/** "WIDTHxHEIGHT" for a ratio + tier, e.g. imageSizeFor("3:4", "2k") → "1776x2368". */
export function imageSizeFor(ratio: ImageRatioId, tier: ImageTierId): string {
  const r = IMAGE_RATIOS.find(x => x.id === ratio) ?? IMAGE_RATIOS[0];
  const [w, h] = r.sizes[tier];
  return `${w}x${h}`;
}

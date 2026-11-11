import { GOLD_ZONE_HEADER, GOLD_ZONE_PATH, GOLD_ZONE_VALUE } from "@shared/safety";

// 黃金專區：網址以 /gold 開頭的頁面。頁面本身和一般區是同一套（圖片、影片、寫真、
// 素材圖庫），差別只在從這裡送出的請求會帶 X-Zone: gold，伺服器才會放行。
// 伺服器另外會檢查帳號是不是黃金會員，所以光改網址或標頭沒有用。

export function inGoldZone(path: string = window.location.pathname): boolean {
  return path === GOLD_ZONE_PATH || path.startsWith(GOLD_ZONE_PATH + "/");
}

/** Keeps a link inside the zone the user is in: "/photoset" → "/gold/photoset". */
export function zonePath(href: string): string {
  return inGoldZone() ? GOLD_ZONE_PATH + href : href;
}

/** Extra request headers for the current page. */
export function zoneHeaders(): Record<string, string> {
  return inGoldZone() ? { [GOLD_ZONE_HEADER]: GOLD_ZONE_VALUE } : {};
}

/** May this account open the gold zone? (The server checks again on every request.) */
export function hasGoldAccess(user: { isAdmin?: boolean | null; isGold?: boolean | null; nsfwEnabled?: boolean | null } | null | undefined): boolean {
  return !!user && (!!user.isAdmin || (!!user.isGold && !!user.nsfwEnabled));
}

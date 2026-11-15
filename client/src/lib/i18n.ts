import { en } from "@/locales/en";
import { serverEn, serverPatterns } from "@/locales/en-server";
import { libraryEn, libraryJoinersEn } from "@/locales/en-library";

// 多語系。做法：程式裡的中文就是「鍵」，tr("中文") 在中文介面原樣回傳，其他語言去字典查。
//
//   tr("免費開始")                          → "Start free"
//   tr("送你 {n} 積分", { n: credits })     → "You get 120 credits"
//
// 好處是不用另外發明鍵名，頁面可以一頁一頁慢慢包；字典裡沒有的句子會直接顯示中文（開發時在主控台提醒）。
// 英文字典是手寫的（locales/en*.ts）。日文、越南文、簡體中文是 scripts/translate-locales.ts 從英文字典翻成的
// locales/<語言>.json，只下載使用者選的那一種；加了新字串後跑一次那支腳本補翻。缺字時日文、越南文顯示英文，簡體顯示原文。
// 新增語言：在 TARGETS（腳本）、LANGS 與 LOADERS 登記。
//
// 語言只在載入時讀一次（localStorage "lang" → 網址 ?lang= → 瀏覽器語言），切換語言會重新載入頁面。
// 這樣寫在模組最外層的常數（選單、範本、步驟說明）也會跟著換，不需要每個元件訂閱語言。

export type Lang = "zh" | "zh-CN" | "en" | "ja" | "vi";
export const LANGS: Array<{ id: Lang; label: string }> = [
  { id: "zh", label: "繁體中文" },
  { id: "zh-CN", label: "简体中文" },
  { id: "en", label: "English" },
  { id: "ja", label: "日本語" },
  { id: "vi", label: "Tiếng Việt" },
];

// English is built in. The other languages are one generated file each (scripts/translate-locales.ts),
// loaded by loadLanguage() before the app starts, so only the chosen one is downloaded.
type LocaleFile = {
  ui: Record<string, string>; server: Record<string, string>; patterns: Record<string, string>;
  library: Record<string, string>; joiners: Record<string, string>;
};
const LOADERS: Partial<Record<Lang, () => Promise<{ default: LocaleFile }>>> = {
  "zh-CN": () => import("@/locales/zh-CN.json") as Promise<{ default: LocaleFile }>,
  ja: () => import("@/locales/ja.json") as Promise<{ default: LocaleFile }>,
  vi: () => import("@/locales/vi.json") as Promise<{ default: LocaleFile }>,
};
let loaded: LocaleFile | null = null;
const STORAGE_KEY = "lang";

/** The browser's language mapped onto ours: Traditional Chinese stays the default for Chinese. */
function fromBrowser(): Lang {
  const langs = typeof navigator === "undefined" ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]);
  for (const raw of langs) {
    const l = (raw || "").toLowerCase();
    if (l.startsWith("zh")) return /^zh-(cn|sg|hans)/.test(l) ? "zh-CN" : "zh";
    if (l.startsWith("ja")) return "ja";
    if (l.startsWith("vi")) return "vi";
    if (l.startsWith("en")) return "en";
  }
  return langs.length ? "en" : "zh";
}

function detect(): Lang {
  if (typeof window === "undefined") return "zh";
  const known = (v: string | null): v is Lang => LANGS.some(l => l.id === v);
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (known(fromUrl)) { window.localStorage.setItem(STORAGE_KEY, fromUrl); return fromUrl; }
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (known(stored)) return stored;
  } catch { /* storage unavailable: fall through to the browser language */ }
  return fromBrowser();
}

const current: Lang = detect();
if (typeof document !== "undefined") document.documentElement.lang = current === "zh" ? "zh-Hant" : current === "zh-CN" ? "zh-Hans" : current;

/** Downloads the current language's text. main.tsx waits for it before loading the app. */
export async function loadLanguage(): Promise<void> {
  const loader = LOADERS[current];
  if (!loader) return;
  try { loaded = (await loader()).default; } catch (e) { console.warn("[i18n] could not load", current, e); }
}

/** Interface text for the current language, falling back to English (but not for Simplified Chinese, which falls back to the Chinese original). */
function uiText(zh: string): string | undefined {
  if (current === "en") return en[zh];
  const hit = loaded?.ui[zh];
  if (hit !== undefined) return hit;
  return current === "zh-CN" ? undefined : en[zh];
}

export function getLang(): Lang {
  return current;
}

/** Saves the choice and reloads, so module-level text is rebuilt in the new language. */
export function setLang(lang: Lang): void {
  if (lang === current) return;
  try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* still reload; the URL carries the choice */ }
  const url = new URL(window.location.href);
  url.searchParams.set("lang", lang);
  window.location.replace(url.toString());
}

/** Locale for Date#toLocaleString and friends. */
export function dateLocale(): string {
  return { zh: "zh-TW", "zh-CN": "zh-CN", en: "en-US", ja: "ja-JP", vi: "vi-VN" }[current];
}

const warned = new Set<string>();

/** Text for the current language. `zh` is the Traditional Chinese source and also the dictionary key. */
export function tr(zh: string, vars?: Record<string, string | number | null | undefined>): string {
  let out = zh;
  if (current !== "zh") {
    const hit = uiText(zh);
    if (hit !== undefined) out = hit;
    else if (import.meta.env.DEV && !warned.has(zh)) { warned.add(zh); console.warn(`[i18n] no ${current} text for: ${zh}`); }
  }
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v === null || v === undefined ? "" : String(v));
  return out;
}

let compiled: Array<[RegExp, string]> | null = null;

/**
 * Text that came from the server (an error message, a transaction description). The server always
 * answers in Chinese; this swaps in the current language when it knows the message and returns the
 * original otherwise.
 */
export function trServer(message: string | null | undefined): string {
  if (!message) return "";
  if (current === "zh") return message;
  const own = current === "en" ? null : loaded;
  const fallBack = current !== "zh-CN";
  const exact = own?.server[message] ?? (fallBack ? serverEn[message] : undefined) ?? uiText(message);
  if (exact !== undefined) return exact;
  if (!compiled) {
    const patterns: Array<[string, string]> = own
      ? [...Object.entries(own.patterns), ...(fallBack ? serverPatterns.filter(([zh]) => own.patterns[zh] === undefined) : [])]
      : current === "zh-CN" ? [] : serverPatterns;
    compiled = patterns.map(([zh, out]) => {
      const source = zh.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\d+\}/g, "(.*?)");
      return [new RegExp(`^${source}$`), out] as [RegExp, string];
    });
  }
  for (const [pattern, out] of compiled) {
    const m = pattern.exec(message);
    if (m) return out.replace(/\{(\d+)\}/g, (_whole, n) => trServer(m[Number(n) + 1] ?? ""));
  }
  return message;
}

/** Asset-library vocabulary per language (see locales/en-library.ts). */
let libraryCache: { words: Record<string, string>; joiners: Array<[string, string]> } | null = null;
function library(): { words: Record<string, string>; joiners: Array<[string, string]> } {
  return (libraryCache ??= buildLibrary());
}
function buildLibrary(): { words: Record<string, string>; joiners: Array<[string, string]> } {
  if (current === "en" || !loaded) return current === "zh-CN" ? { words: {}, joiners: [] } : { words: libraryEn, joiners: libraryJoinersEn };
  const fallBack = current !== "zh-CN";
  return {
    words: fallBack ? { ...libraryEn, ...loaded.library } : loaded.library,
    joiners: fallBack ? libraryJoinersEn.map(([zh, out]) => [zh, loaded!.joiners[zh] ?? out]) : Object.entries(loaded.joiners),
  };
}
/** Languages that put spaces between words, and capitalise. */
const SPACED = current === "en" || current === "vi";
let libraryKeys: string[] | null = null;
const assetCache = new Map<string, string>();

/**
 * An asset-library name, category or description in the current language. These texts are built from a
 * fixed vocabulary, so the Chinese is taken apart (longest piece first) and put back together translated.
 * Anything that is not in the vocabulary is kept as it is.
 */
export function trAsset(text: string | null | undefined): string {
  if (!text) return "";
  if (current === "zh" || !/[\u4e00-\u9fff]/.test(text)) return text;
  const hit = assetCache.get(text);
  if (hit !== undefined) return hit;
  const { words, joiners } = library();
  if (!libraryKeys) libraryKeys = Object.keys(words).sort((a, b) => b.length - a.length);
  let out = "";
  let i = 0;
  let lastWasWord = false;
  while (i < text.length) {
    const word = libraryKeys.find(k => text.startsWith(k, i));
    if (word) {
      out += (lastWasWord && SPACED ? " " : "") + words[word];
      i += word.length; lastWasWord = true; continue;
    }
    const joiner = joiners.find(([zh]) => text.startsWith(zh, i));
    if (joiner) { out += joiner[1]; i += joiner[0].length; lastWasWord = false; continue; }
    out += text[i]; i += 1; lastWasWord = false;
  }
  if (SPACED) {
    out = out.replace(/ +/g, " ").trim();
    out = out.charAt(0).toUpperCase() + out.slice(1);
  } else out = out.trim();
  assetCache.set(text, out);
  return out;
}

const ASSET_FIELDS = new Set(["name", "title", "category", "label", "usage", "framing"]);

/**
 * Translates the text fields of an asset-library API response in place and returns it.
 * `categories` and `variantOptions` are left in Chinese: the page sends those values back to the server
 * as filters, so they are translated only where they are shown (trAsset at the chip).
 */
export function localizeLibrary<T>(data: T): T {
  if (current === "zh" || data === null || typeof data !== "object") return data;
  if (Array.isArray(data)) { data.forEach(localizeLibrary); return data; }
  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === "string") { if (ASSET_FIELDS.has(key)) record[key] = trAsset(value); }
    else if (key === "categories" || key === "variantOptions") continue;
    else if (key === "tags" && Array.isArray(value)) record[key] = value.map(v => (typeof v === "string" ? trAsset(v) : v));
    else if (value && typeof value === "object") localizeLibrary(value);
  }
  return data;
}

/**
 * Turns a search typed in the interface language into the Chinese word the asset library is indexed by:
 * "trench" → "風衣外套造型". The best match is the vocabulary entry whose translation contains the query
 * and is closest to it in length. Chinese queries, and queries that match nothing, are returned unchanged.
 */
export function assetQuery(query: string): string {
  const q = query.trim().toLowerCase();
  // Chinese queries are sent as typed (the library is indexed in Chinese); Japanese may contain kanji, so it is matched first.
  if (current === "zh" || !q || (current !== "ja" && /[\u4e00-\u9fff]/.test(q))) return query;
  let best = "";
  let bestExtra = Infinity;
  for (const [zh, translated] of Object.entries(library().words)) {
    if (zh.length > 12) continue;                         // names and tags only, not the long descriptions
    const t = translated.toLowerCase();
    if (!t.includes(q)) continue;
    const extra = t.length - q.length;
    if (extra < bestExtra) { best = zh; bestExtra = extra; }
  }
  return best || query;
}

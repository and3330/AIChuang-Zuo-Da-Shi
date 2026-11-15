import type { Request } from "express";

// The website sends its interface language with every request (header X-Lang, set in
// client/src/lib/queryClient.ts). The server still answers errors in Chinese (the website
// translates those itself); this module is for the places where the server writes text a
// person will read: AI-written scripts and outlines, e-mails, and names on the payment page.

export type RequestLang = "zh" | "zh-CN" | "en" | "ja" | "vi";
export const REQUEST_LANGS: readonly RequestLang[] = ["zh", "zh-CN", "en", "ja", "vi"];

export function asLang(value: unknown): RequestLang {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "zh-cn") return "zh-CN";
  return (REQUEST_LANGS as readonly string[]).includes(v) ? v as RequestLang : "zh";
}

export function requestLang(req: Request): RequestLang {
  return asLang(req.get("x-lang"));
}

/**
 * Chooses between the Chinese and the English wording for this request (payment page names, e-mails).
 * Simplified Chinese gets the Chinese text; Japanese and Vietnamese get the English text.
 */
export function byLang<T>(req: Request, zh: T, en: T): T {
  const lang = requestLang(req);
  return lang === "zh" || lang === "zh-CN" ? zh : en;
}

/** How each language is named in a Chinese prompt to the AI. */
export const LANGUAGE_NAME: Record<RequestLang, string> = {
  zh: "繁體中文",
  "zh-CN": "简体中文（中国大陆用语）",
  en: "英文",
  ja: "日文",
  vi: "越南文",
};

/**
 * The output-language block appended to a prompt whose answer is shown to the person. Empty for
 * Traditional Chinese. The prompts themselves stay in Chinese; this only changes what the model writes.
 */
export function languageNote(lang: RequestLang, modelFields: string[] = [], extra = ""): string {
  if (lang === "zh") return "";
  const name = LANGUAGE_NAME[lang];
  // The image and video models read Chinese and English well, but not Japanese or Vietnamese.
  const forModel = (lang === "ja" || lang === "vi") && modelFields.length
    ? `其中 ${modelFields.join("、")} 會直接交給影像模型生成畫面，這幾個欄位請改用英文撰寫。`
    : "";
  return `\n\n【輸出語言（優先於上面所有關於語言的規定）】\n這位使用者使用${name}介面。所有會顯示給使用者看的文字（標題、場景描述、台詞、大綱、角色名稱與說明等）一律用自然、道地的${name}撰寫${lang === "zh-CN" ? "" : "，不要出現中文"}。JSON 的鍵名與結構維持不變。${forModel}${extra}`;
}

/** `modelFields`: fields of the answer that are sent on to an image or video model (kept in English for Japanese and Vietnamese). */
export function outputLanguageNote(req: Request, modelFields: string[] = []): string {
  return languageNote(requestLang(req), modelFields);
}

import type { Request } from "express";

// The website sends its interface language with every request (header X-Lang, set in
// client/src/lib/queryClient.ts). The server still answers errors in Chinese (the website
// translates those itself); this module is for the places where the server writes text a
// person will read: AI-written scripts and outlines, e-mails, and names on the payment page.

export type RequestLang = "zh" | "en";

export function requestLang(req: Request): RequestLang {
  return String(req.get("x-lang") ?? "").toLowerCase() === "en" ? "en" : "zh";
}

/** Chooses between the Chinese and the English wording for this request. */
export function byLang<T>(req: Request, zh: T, en: T): T {
  return requestLang(req) === "en" ? en : zh;
}

/**
 * Appended to a prompt whose answer is shown to the person. Empty for Chinese. The prompts
 * themselves stay in Chinese; this only changes the language of what the model writes.
 */
export function outputLanguageNote(req: Request): string {
  if (requestLang(req) !== "en") return "";
  return "\n\n【輸出語言（優先於上面所有關於語言的規定）】\n這位使用者使用英文介面。所有會顯示給使用者看的文字（標題、場景描述、台詞、大綱、角色名稱與說明等）一律用自然、道地的英文撰寫，不要出現中文。JSON 的鍵名與結構維持不變。";
}

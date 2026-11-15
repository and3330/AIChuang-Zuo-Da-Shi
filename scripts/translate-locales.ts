// 把網站的英文字典翻成其他語言（日文、越南文、簡體中文），寫進 client/src/locales/<語言>.json。
//
//   npx tsx --tsconfig tsconfig.json scripts/translate-locales.ts ja vi zh-CN
//   npx tsx --tsconfig tsconfig.json scripts/translate-locales.ts ja --model openai/gpt-5.6-terra
//
// 原文是程式裡的繁體中文（字典的鍵），英文只當參考。只翻還沒有的句子，所以加了新字串後再跑一次，
// 只會補新的；每批翻完就存檔，中斷了可以接著跑。走 AtlasCloud 的 atlas CLI（要先登入），會計費。
// 翻完會檢查 {0}、{n} 這類佔位符有沒有保留，不一致的那句不收，下次再翻。

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { en } from "../client/src/locales/en";
import { serverEn, serverPatterns } from "../client/src/locales/en-server";
import { libraryEn, libraryJoinersEn } from "../client/src/locales/en-library";

type Section = "ui" | "server" | "patterns" | "library" | "joiners";
export type LocaleFile = {
  ui: Record<string, string>;
  server: Record<string, string>;
  patterns: Record<string, string>;
  library: Record<string, string>;
  joiners: Record<string, string>;
};

const TARGETS: Record<string, string> = {
  ja: "Japanese (natural, polite です/ます style for full sentences; short labels and buttons stay concise)",
  vi: "Vietnamese (natural, friendly and clear)",
  "zh-CN": "Simplified Chinese as used in mainland China (convert characters AND wording to mainland usage, e.g. 影片→视频, 帳號→账号, 儲值→充值, 品質→质量, 資訊→信息)",
};

const SOURCES: Record<Section, Record<string, string>> = {
  ui: en,
  server: serverEn,
  patterns: Object.fromEntries(serverPatterns),
  library: libraryEn,
  joiners: Object.fromEntries(libraryJoinersEn),
};

const NOTES: Record<Section, string> = {
  ui: "Website interface text: buttons, labels, help text, toasts.",
  server: "Messages from the server shown to the person (errors, statuses).",
  patterns: "Server messages with changing parts; {0}, {1}… are filled in later and must stay exactly as they are.",
  library: "Vocabulary of an AI image asset library (poses, outfits, hairstyles, colours, fabrics). Pieces are joined together to form names and descriptions, so translate each piece on its own, lowercase where the language has case and the English is lowercase.",
  joiners: "Punctuation-like joiners placed between vocabulary pieces. Return the joiner as it should appear in the target language, including any spaces it needs.",
};

const args = process.argv.slice(2);
const modelAt = args.indexOf("--model");
const MODEL = modelAt >= 0 ? args[modelAt + 1] : "openai/gpt-5.6-terra";
const langs = args.filter((a, i) => !a.startsWith("--") && (modelAt < 0 || i !== modelAt + 1));
const BATCH = 60;
const PARALLEL = 4;
const work = mkdtempSync(join(tmpdir(), "translate-"));

const placeholders = (s: string) => (s.match(/\{[^{}]+\}/g) ?? []).sort().join(",");

function fileFor(lang: string) { return join("client", "src", "locales", `${lang}.json`); }

function load(lang: string): LocaleFile {
  const empty: LocaleFile = { ui: {}, server: {}, patterns: {}, library: {}, joiners: {} };
  if (!existsSync(fileFor(lang))) return empty;
  return { ...empty, ...JSON.parse(readFileSync(fileFor(lang), "utf8")) };
}

function save(lang: string, data: LocaleFile) {
  // Keep the source order so diffs stay readable.
  const ordered = Object.fromEntries((Object.keys(SOURCES) as Section[]).map(s => [s,
    Object.fromEntries(Object.keys(SOURCES[s]).filter(k => data[s][k] !== undefined).map(k => [k, data[s][k]]))]));
  writeFileSync(fileFor(lang), JSON.stringify(ordered, null, 1) + "\n", "utf8");
}

function atlas(requestFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("atlas", ["chat", "--input", requestFile, "--json", "--timeout", "8m"], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" }, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32",
    }, (err, stdout) => {
      try {
        const out = JSON.parse(stdout);
        if (out.outcome !== "succeeded") return reject(new Error(JSON.stringify(out.errors ?? out).slice(0, 300)));
        // The reply text is the first message.content string anywhere in the result.
        const find = (o: unknown): string | undefined => {
          if (!o || typeof o !== "object") return undefined;
          const r = o as Record<string, unknown>;
          const msg = r.message as Record<string, unknown> | undefined;
          if (msg && typeof msg.content === "string") return msg.content;
          for (const v of Object.values(r)) { const hit = find(v); if (hit !== undefined) return hit; }
          return undefined;
        };
        const content = find(out.data);
        if (content === undefined) return reject(new Error("no content in reply"));
        resolve(content);
      } catch (e) { reject(err ?? e); }
    });
  });
}

async function translateBatch(lang: string, section: Section, items: Array<[string, string]>, n: number) {
  const input = Object.fromEntries(items.map(([zh, english]) => [zh, english]));
  const prompt = `Translate a website's text into ${TARGETS[lang]}.
The site is "AI 創意工坊" (AI Creative Studio): people make AI photo sets, characters, videos and short dramas, and pay with credits (積分).
${NOTES[section]}

Input: a JSON object. Each key is the original Traditional Chinese text (the source of truth); each value is an English translation given only as a reference.
Output: ONLY a JSON object with exactly the same keys, each value being the translation into the target language. No Markdown, no commentary.

Rules:
- Keep every placeholder such as {0}, {1}, {n}, {name} exactly as written, the same number of times.
- Keep leading and trailing spaces, line breaks, HTML tags, numbers, units, currency (NT$, US$), brand and model names (Seedream, Seedance, Kling, WAN, Bunny, Stripe, Instagram…) as they are.
- Use one consistent term for each concept across the whole site: credits, character, photo set, four views, face card, asset library, Gold membership.
- Match the length and tone of the original: a button stays short.

${JSON.stringify(input, null, 1)}`;
  const file = join(work, `${lang}-${section}-${n}.json`);
  writeFileSync(file, JSON.stringify({ model: MODEL, max_tokens: 16000, temperature: 0.2, messages: [{ role: "user", content: prompt }] }), "utf8");
  const reply = await atlas(file);
  const start = reply.indexOf("{"), end = reply.lastIndexOf("}");
  const parsed = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>;
  const good: Record<string, string> = {};
  let bad = 0;
  for (const [zh, english] of items) {
    const v = parsed[zh];
    if (typeof v !== "string" || !v.trim() && english.trim()) { bad++; continue; }
    if (placeholders(v) !== placeholders(zh)) { bad++; continue; }
    good[zh] = v;
  }
  return { good, bad };
}

async function run(lang: string) {
  if (!TARGETS[lang]) throw new Error(`unknown language ${lang}; choose ${Object.keys(TARGETS).join(", ")}`);
  const data = load(lang);
  const jobs: Array<{ section: Section; items: Array<[string, string]> }> = [];
  for (const section of Object.keys(SOURCES) as Section[]) {
    const missing = Object.entries(SOURCES[section]).filter(([zh]) => data[section][zh] === undefined);
    for (let i = 0; i < missing.length; i += BATCH) jobs.push({ section, items: missing.slice(i, i + BATCH) });
  }
  const total = jobs.reduce((t, j) => t + j.items.length, 0);
  console.log(`${lang}: ${total} strings in ${jobs.length} batches with ${MODEL}`);
  let done = 0, failed = 0, next = 0;
  async function worker() {
    while (next < jobs.length) {
      const n = next++;
      const job = jobs[n];
      try {
        const { good, bad } = await translateBatch(lang, job.section, job.items, n);
        Object.assign(data[job.section], good);
        done += Object.keys(good).length; failed += bad;
        save(lang, data);
        console.log(`${lang}: batch ${n + 1}/${jobs.length} ok (${done}/${total}${failed ? `, ${failed} rejected` : ""})`);
      } catch (e) {
        failed += job.items.length;
        console.log(`${lang}: batch ${n + 1}/${jobs.length} FAILED: ${(e as Error).message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  console.log(`${lang}: done ${done}, not translated ${failed}${failed ? " (run again to retry)" : ""}`);
}

(async () => {
  if (langs.length === 0) throw new Error("usage: translate-locales.ts <ja|vi|zh-CN>... [--model id]");
  for (const lang of langs) await run(lang);
})();

// Checks the English lookups that work on text from the server and the asset catalog.
//   npx tsx scripts/test-i18n.ts
// 1. Every asset in the catalog (name, category, usage, tags) comes out with no Chinese left.
// 2. A sample of server messages, fixed and with values, is translated.
const store: Record<string, string> = { lang: "en" };
(globalThis as any).window = {
  location: { search: "", href: "http://localhost/" },
  localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
};
(globalThis as any).document = { documentElement: { lang: "" } };

async function main() {
  const { trAsset, trServer, getLang } = await import("../client/src/lib/i18n");
  const { libraryCatalog } = await import("../shared/libraryCatalog");
  if (getLang() !== "en") throw new Error("language was not set to English");
  const cjk = /[一-鿿]/;
  let failed = 0;

  const left = new Map<string, string>();
  const entries = libraryCatalog();
  for (const e of entries) {
    for (const text of [e.name, e.category, e.usage, ...e.tags]) {
      const out = trAsset(text);
      if (cjk.test(out) && !left.has(text)) left.set(text, out);
    }
  }
  console.log(`catalog: ${entries.length} assets, ${left.size} texts still contain Chinese`);
  for (const [zh, out] of Array.from(left).slice(0, 15)) console.log(`  ${zh}  →  ${out}`);
  failed += left.size;

  const samples = entries.filter((_, i) => i % 1700 === 0).slice(0, 5);
  for (const e of samples) console.log(`  e.g. ${e.name}  →  ${trAsset(e.name)}\n       ${e.usage}  →  ${trAsset(e.usage)}`);

  const server: Array<[string, string]> = [
    ["积分不足", "Not enough credits"],
    ["積分不足，需要 30 積分", "Not enough credits. 30 credits needed"],
    ["圖片生成消耗 5 積分", "Image generation used 5 credits"],
    ["今日影片生成次數已達上限（10 支/日），請明天再試或聯繫客服提升額度。", "You have reached today's video limit (10 per day). Try again tomorrow or contact support to raise it."],
    ["Kling 4.0 不支援 4:3 的畫面比例。", "Kling 4.0 does not support the 4:3 aspect ratio."],
    ["請先設定生日。", "Set your birthday first."],
  ];
  for (const [zh, want] of server) {
    const got = trServer(zh);
    const ok = got === want;
    if (!ok) failed += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${zh}  →  ${got}`);
  }
  // 3. English searches find the Chinese word the library is indexed by.
  const { assetQuery } = await import("../client/src/lib/i18n");
  const searches: Array<[string, string]> = [["trench", "風衣外套造型"], ["blunt bob", "齊短髮"], ["坐姿", "坐姿"], ["zzzz", "zzzz"]];
  for (const [typed, want] of searches) {
    const got = assetQuery(typed);
    const ok = got === want;
    if (!ok) failed += 1;
    console.log(`${ok ? "ok  " : "FAIL"} search "${typed}"  →  ${got}`);
  }

  if (failed > 0) { console.log(`${failed} problem(s)`); process.exit(1); }
  console.log("all good");
}
main();

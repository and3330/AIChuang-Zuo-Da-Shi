// Lists strings wrapped in tr("…") in the client that have no entry in a dictionary.
//   npx tsx scripts/check-i18n.ts
// Exits 1 when anything is missing. Only double-quoted literal first arguments are checked,
// so write tr("…") with double quotes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { en } from "../client/src/locales/en";

const DICTS: Record<string, Record<string, string>> = { en };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith(".ts") || name.endsWith(".tsx") ? [path] : [];
  });
}

// tr( "…" — not preceded by a letter, digit, underscore or dot (so `.split("…")` and `format("…")` do not match).
const CALL = new RegExp('(^|[^\\w.])tr\\(\\s*"((?:[^"\\\\]|\\\\.)*)"', "g");
const used = new Map<string, string>();
for (const file of [...files("client/src"), ...files("shared")]) {
  if (file.includes("locales") || file.endsWith("i18n.ts")) continue;
  const source = readFileSync(file, "utf8");
  for (const m of Array.from(source.matchAll(CALL))) {
    const key = JSON.parse(`"${m[2]}"`) as string;
    if (!used.has(key)) used.set(key, file);
  }
}

let missing = 0;
for (const [lang, dict] of Object.entries(DICTS)) {
  for (const [key, file] of Array.from(used)) {
    if (dict[key] === undefined) { missing += 1; console.log(`[${lang}] ${file}: ${key}`); }
  }
  const unused = Object.keys(dict).filter(k => !used.has(k));
  console.log(`[${lang}] ${used.size} strings in code, ${Object.keys(dict).length} in the dictionary, ${unused.length} unused.`);
}
process.exit(missing > 0 ? 1 : 0);

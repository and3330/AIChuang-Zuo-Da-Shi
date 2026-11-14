import { PROFILE_ATTRS } from "../shared/characterProfile";

const W = "一位虛構的成年女性，真實照片，真實皮膚質感，不修圖，淺灰色素面攝影棚背景，柔和均勻的光線";
const BODY = `攝影棚全身照，${W}，穿合身的淺灰色運動背心與深灰色運動緊身長褲、白色運動鞋，自然站立，雙手自然下垂，從頭到腳完整入鏡`;
const tmpl: Record<string, (p: string) => string> = {
  skinTone: p => `攝影棚人像，${W}，頭髮往後綁起，穿淺灰色細肩帶運動背心，正面，畫面從頭頂到胸口上方，${p}`,
  faceShape: p => `攝影棚正面大頭照，${W}，頭髮全部往後梳並綁起，露出完整的臉型、額頭與下巴輪廓，表情中性，${p}`,
  eyeShape: p => `一位虛構成年東亞女性的單眼微距特寫，只有一隻眼睛和眉毛，眼睛直視鏡頭，自然光，真實皮膚質感，${p}`,
  eyeColor: p => `一位虛構成年女性的單眼微距特寫，只有一隻眼睛和眉毛，眼睛直視鏡頭，虹膜清楚，自然光，真實皮膚質感，${p}`,
  lips: p => `一位虛構成年女性的下半臉特寫，從鼻尖到下巴，嘴巴輕閉，自然唇色、沒有口紅，淺灰背景，真實皮膚質感，${p}`,
  hairColor: p => `攝影棚人像，${W}，3/4 側臉，畫面從頭頂到肩膀，中長的自然波浪髮，${p}`,
  hairLength: p => `攝影棚背影照，${W}，背對鏡頭，畫面從頭頂到腰部，穿淺灰色運動背心，深棕色頭髮，${p}`,
  hairTexture: p => `攝影棚背影照，${W}，背對鏡頭，畫面從頭頂到腰部，穿淺灰色運動背心，深棕色長髮，${p}`,
  build: p => `${BODY}，身體略微側轉約 20 度，${p}`,
  figure: p => `${BODY}，正面站立，${p}`,
  bust: p => `${BODY}，身體側轉約 45 度，${p}，其他部位勻稱`,
  waist: p => `${BODY}，正面站立，${p}，其他部位勻稱`,
  hips: p => `${BODY}，身體側轉約 70 度露出側面輪廓，${p}，其他部位勻稱`,
  legs: p => `${BODY}，正面站立，${p}，其他部位勻稱`,
};
// Writes one Atlas request file per option into the folder given as the first argument
// (UTF-8 JSON, so the Chinese prompt never passes through a shell). Then run, for each file:
//   atlas generate image bytedance/seedream-v5.5/text-to-image --input <file>.json --output <file>.jpg
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
if (!dir) throw new Error("usage: tsx scripts/character-option-prompts.ts <output folder>");
mkdirSync(dir, { recursive: true });
let n = 0;
for (const a of PROFILE_ATTRS) for (const op of a.options) {
  writeFileSync(join(dir, `${a.key}-${op.value}.json`), JSON.stringify({ prompt: tmpl[a.key](op.prompt), size: "1344*1792", output_format: "jpeg" }), "utf8");
  n++;
}
console.log(`${n} request files`);


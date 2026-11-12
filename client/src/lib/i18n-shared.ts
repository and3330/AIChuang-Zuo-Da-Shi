import { getLang, tr } from "@/lib/i18n";
import { IMAGE_RATIOS, IMAGE_TIERS } from "@shared/imageSizes";
import { EXPRESSIONS, PHOTO_LOOKS, PROP_PRESETS, SETTINGS, SHOT_STYLES } from "@shared/photosetOptions";
import { LIBRARIES } from "@shared/libraryCatalog";
import { VIDEO_MODELS } from "@shared/pricing";
import { GOLD_TERMS_OF_USE } from "@shared/safety";

// 前後端共用的選項清單（圖片比例、畫質、畫面質感、鏡頭風格、表情、場景、道具、圖庫、影片模型、黃金會員條款）
// 定義在 shared/，那裡不能引用前端的翻譯函式。所以在前端啟動時把「顯示用」的欄位就地換成目前語言：
// label、hint、desc，以及整句就是顯示文字的清單。交給 AI 的欄位（PHOTO_LOOKS.suffix、各選項的 text）不動，
// 伺服器那一份也不受影響。新增共用選項時，記得把英文加進 locales/en.ts 的「shared lists」區塊。
// main.tsx 在載入 App 之前引用這個檔案。

type Labelled = { label: string; hint?: string };

function localize(list: Labelled[]): void {
  for (const item of list) {
    item.label = tr(item.label);
    if (item.hint !== undefined) item.hint = tr(item.hint);
  }
}

function localizeStrings(list: string[]): void {
  for (let i = 0; i < list.length; i += 1) list[i] = tr(list[i]);
}

if (getLang() !== "zh") {
  localize(IMAGE_RATIOS);
  localize(IMAGE_TIERS);
  localize(PHOTO_LOOKS);
  localize(SHOT_STYLES);
  localize(EXPRESSIONS);
  localize(SETTINGS);
  localize(LIBRARIES);
  localizeStrings(PROP_PRESETS);
  localizeStrings(GOLD_TERMS_OF_USE);
  for (const model of Object.values(VIDEO_MODELS) as Array<{ desc: string }>) model.desc = tr(model.desc);
}

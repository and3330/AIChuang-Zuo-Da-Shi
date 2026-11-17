// 漫劇「AI 寫腳本」的導演模式：一次寫出導演意圖、資產清單（鎖定錨點）與十欄分鏡。
//
// 做法取自公司的「AI 短劇導演」分鏡方法，改寫成適合這裡的流程：
//   每一幕 = 一張 Seedream 分鏡圖 + 一段 WAN 3.0 圖生影片（一個鏡頭，不切鏡）→ 合成一集。
//   - 導演意圖：鉤子公式、敘事模板、故事節拍、資訊差、情緒曲線與反轉、視覺與聲音基調。
//   - 資產清單：角色 S1…、道具 P1…、場景 L1…，每項一條「鎖定錨點」（關鍵詞堆疊）。
//     每一幕記下自己畫面裡有哪些資產，伺服器把錨點原文抄進那一幕（scene.locks），
//     生圖與動態提示詞都一字不改地重複，角色、道具、場景才不會每幕長得不一樣。
//   - 分鏡欄位：景別、角度、運鏡、畫面、聲音、敘事目的、秒數、動態提示詞。
// 這裡只組文字與整理 AI 的回覆，不呼叫任何服務。

import { DRAMA_SECONDS, DIALOGUE_MAX_CHARS, dialogueSeconds, finishMotionPrompt } from "@shared/dramaMotion";
import type { DramaLock } from "@shared/schema";

export const DRAMA_CAMERAS = ["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit", "zoom_in", "zoom_out", "static"] as const;
const FRAMINGS = ["大遠景", "遠景", "全景", "中景", "近景", "特寫", "大特寫"];
const ANGLES = ["平視", "俯拍", "仰拍", "頂拍", "微俯", "微仰"];
const PURPOSES = ["建立", "推進", "揭示", "強調", "轉場", "情緒", "內省"];

export function dramaScriptPrompt(input: { pitch: string; genre: string; charA: string; charB: string; count: number; seriesAssets?: DramaLock[] }): string {
  const { pitch, genre, charA, charB, count } = input;
  const series = (input.seriesAssets ?? []).slice(0, 16);
  const seriesBlock = series.length
    ? `\n【前幾集已經定好的資產】\n${series.map(a => `${a.id}｜${a.name}｜${a.lock}`).join("\n")}\n這是同一部劇：同一個角色、道具、場景再出現時，沿用上面的 id、name 與 lock 原文，一個字都不要改，也要列進 assets；新的資產用上面沒用過的編號。\n`
    : "";
  return `你是短劇導演兼分鏡師。你不是劇本的執行者，而是資訊的組織者：決定觀眾看到什麼、什麼時候看到、什麼永遠不讓他看到。
這一集是直式短劇（漫劇）：每一幕先用 Seedream 5.5 生成一張分鏡圖，再用 WAN 3.0 圖生影片把這張圖變成「一個鏡頭」的動畫（一幕不切鏡），最後各幕接成一集。

【劇情概念】${pitch}
【類型】${genre}
【角色 A 名稱】${charA}
【角色 B 名稱】${charB}
【總幕數】${count}
${seriesBlock}
一、導演意圖 intent（繁體中文，6 行以內，每行「項目｜內容」）
- 鉤子｜從「誤會／資訊差、身分反差、時間壓力、情緒累積、規則禁忌、冷開場倒敘」選一種，寫出前 3 秒讓觀眾心裡冒出的疑問
- 敘事模板｜從「克制悲劇、釋放場景、懸疑公式、遮蔽敘事、循環敘事、受限空間、童話變奏」選一到兩種
- 故事節拍｜3 到 6 個節拍，只寫因果與轉折（① … → ② … → ③ …）
- 資訊差｜觀眾知道什麼、角色不知道什麼
- 情緒與反轉｜情緒曲線；反轉在第幾幕。三分之一處前建立衝突，四分之三處前到高潮，最後留一拍餘韻；這麼短的片反轉最多兩次
- 視聽基調｜色調與主光源、要避免的畫面；環境音；配樂方向（配樂在後製加，不寫進畫面）

二、資產清單 assets
找出所有角色、關鍵道具與場景。每項給 id（角色 S1、S2…，道具 P1、P2…，場景 L1、L2…）、name（簡短名稱）、lock（鎖定錨點）。
lock 是用逗號分隔的關鍵詞堆疊，不寫句子，只寫鏡頭看得到的東西：
- 角色：年齡感、臉部特徵、髮型髮色、體型、核心服裝與配色、明顯標記（20 個詞以內）
- 道具：形狀、材質、顏色、特徵（10 個詞以內）
- 場景：建築或空間、陳設、光線、色調（15 個詞以內）
有反轉或隱藏身分時，lock 只寫中性的外觀，不能洩漏反轉。

三、分鏡 scenes（共 ${count} 幕，每一幕就是一個鏡頭）
1. purpose：每一幕都要有存在的理由。從「${PURPOSES.join("、")}」選一個標籤，加一句理由，格式「標籤｜理由」（例：「揭示｜照片背面寫著她的名字」）。說不出理由的幕就和別的幕合併。
2. 第 1 幕是鉤子：第一格畫面本身就要拋出疑問。
3. description：繁體中文 60 到 120 字，只寫看得見的東西，用肯定句（不要寫「沒有人」「沒有文字」這類否定句，模型反而會畫出來）：地點、角色的動作與表情（用「他／她」或稱謂，不寫角色名）、光線、構圖，關鍵道具要點名。用動作句，不寫心理狀態（✔「她把燈舉高」✘「她很害怕」）。情緒越重，表達越輕；整集至少一幕用遮蔽手法（遮擋、畫外音、剪影、延遲揭示）。
   會讓 AI 出錯的畫面要避開：招牌、螢幕、紙張寫成空白的；不要寫鏡子、玻璃倒影（會多出第二張臉）；兩人同框時寫明「畫面裡只有他們兩人」；一隻手只做一件事；精細手勢與精確的道具操作做不出來，改用前後兩幕交代（動作前、結果）。
4. framing（景別）從「${FRAMINGS.join("、")}」選一個；angle（角度）從「${ANGLES.join("、")}」選一個；相鄰兩幕的景別要有變化。
5. cameraMovement 從以下選一個：${DRAMA_CAMERAS.join(" / ")}
6. assetIds：這一幕畫面裡會出現的資產 id（角色、道具、場景都要列）；有台詞時，說話的角色放第一個。
7. dialogue：台詞要少而精，最多一半的幕有台詞，能用動作表達的就不要說出口；劇情概念裡有給的台詞優先照用。沒有就空字串。一幕只有一個人說話，兩人對話就拆成兩幕輪流拍（正反打），中間可以插一幕聽的人的反應。台詞每秒約 4 個字，一幕最多 ${DIALOGUE_MAX_CHARS} 字。
8. sound：這一幕的聲音（環境音、動作音效、呼吸或嘆氣等人聲），20 字以內，不寫配樂。
9. useCharA、useCharB：這一幕是否需要該角色出現（boolean）。
10. seconds：這一幕動畫的秒數，${DRAMA_SECONDS.planMin} 到 ${DRAMA_SECONDS.planMax} 的整數，依內容決定，不要每幕都一樣：鉤子、反應鏡頭、特寫 3 到 4 秒；有台詞的幕至少要「台詞字數 ÷ 4 再加 1」秒，不然會講不完；建立場景、動作戲、高潮與收尾 6 到 10 秒。
11. title：4 到 8 字的幕名。
13. transition：這一幕的動作要不要剛好收在下一幕的畫面（例如走進門、鏡頭推向下一個地點）。是就填 true，整集最多兩幕，最後一幕不能是 true；其他填 false。
12. videoPrompt：這一幕的動態提示詞，繁體中文、120 字以內、不分點。影片模型已經看得到分鏡圖（它就是第一格），不要重述畫面，只寫接下來 seconds 秒發生的變化，依序是：
    - 首幀錨點：從主角的 lock 挑 3 到 6 個不會變的特徵（臉、髮型、體型、核心服裝），一字不改地照抄，點出主體
    - 主體動態：一個主要動作加一個微動作（眼神、呼吸、髮絲、手指），幅度要能在 seconds 秒內自然做完
    - 背景動態：環境裡一個會動的東西；沒有就寫背景保持穩定
    - 運鏡：只用一種，和 cameraMovement 一致，並寫出速度
    - 氛圍變化：光線或情緒從什麼走向什麼
    對話與情緒戲用細微動態；追逐、打鬥、衝突才用大動態。有台詞時讓說話的人有開口說話的口型，但不寫出台詞文字。開場承接上一幕的結尾，收尾朝下一幕過渡。不切鏡頭、不新增人物或物件。

全部規則：畫面裡不出現任何文字、字幕或招牌字；不寫真人、導演或藝術家的名字；恐怖與暴力只用暗示，不呈現血腥；角色一律是成年人。

請只回傳 JSON，不要任何其他說明文字：
{
  "intent": "鉤子｜…\\n敘事模板｜…\\n故事節拍｜…\\n資訊差｜…\\n情緒與反轉｜…\\n視聽基調｜…",
  "assets": [
    { "id": "S1", "name": "名稱", "lock": "關鍵詞, 關鍵詞, …" },
    { "id": "L1", "name": "名稱", "lock": "關鍵詞, 關鍵詞, …" }
  ],
  "scenes": [
    {
      "title": "幕名稱",
      "purpose": "建立｜理由",
      "framing": "中景",
      "angle": "平視",
      "cameraMovement": "push_in",
      "description": "畫面描述…",
      "assetIds": ["S1", "L1"],
      "dialogue": "一句台詞或空字串",
      "sound": "雨聲、遠處車聲",
      "useCharA": true,
      "useCharB": false,
      "seconds": 5,
      "transition": false,
      "videoPrompt": "動態提示詞…"
    }
  ]
}`;
}

export type DramaScriptScene = {
  title: string; description: string; dialogue: string; cameraMovement: string;
  useCharA: boolean; useCharB: boolean;
  plannedSeconds?: number; videoPrompt?: string; endOnNext?: boolean;
  framing?: string; angle?: string; sound?: string; purpose?: string; locks?: DramaLock[];
};
export type DramaScript = { intent: string; assets: DramaLock[]; scenes: DramaScriptScene[] };

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Tidy the model's JSON: clamp every field, keep only known assets, copy each scene's locks word for word. */
export function parseDramaScript(raw: any, count: number, seriesAssets: DramaLock[] = []): DramaScript {
  const assets: DramaLock[] = [];
  const seen = new Set<string>();
  const series = new Map(seriesAssets.map(a => [a.id, a]));
  for (const a of Array.isArray(raw?.assets) ? raw.assets : []) {
    const id = str(a?.id, 4).toUpperCase();
    const lock = str(a?.lock, 240);
    if (!/^[SPLG]\d{1,2}$/.test(id) || !lock || seen.has(id)) continue;
    seen.add(id);
    assets.push({ id, name: str(a?.name, 30) || id, lock });
    if (assets.length >= 16) break;
  }
  // 沿用前幾集的資產：模型只寫了 id 沒寫進 assets 也補回來
  const usedIds = new Set<string>((Array.isArray(raw?.scenes) ? raw.scenes : []).flatMap((sc: any) => Array.isArray(sc?.assetIds) ? sc.assetIds.map((x: unknown) => str(x, 4).toUpperCase()) : []));
  for (const id of Array.from(usedIds)) {
    const a = series.get(id);
    if (a && !seen.has(id) && assets.length < 16) { seen.add(id); assets.push(a); }
  }
  const byId = new Map(assets.map(a => [a.id, a]));
  const cameras = new Set<string>(DRAMA_CAMERAS);

  const scenes = (Array.isArray(raw?.scenes) ? raw.scenes : []).slice(0, count).map((s: any, i: number): DramaScriptScene => {
    const cm = str(s?.cameraMovement, 40);
    const dialogue = str(s?.dialogue, 100);
    const sec = Math.max(Math.round(Number(s?.seconds)) || 0, dialogueSeconds(dialogue));
    const plannedSeconds = sec > 0 ? Math.max(DRAMA_SECONDS.planMin, Math.min(DRAMA_SECONDS.planMax, sec)) : undefined;
    const videoPrompt = finishMotionPrompt(str(s?.videoPrompt, 400));
    const ids: string[] = Array.isArray(s?.assetIds) ? s.assetIds.map((x: unknown) => str(x, 4).toUpperCase()) : [];
    // 角色 → 道具 → 場景，各只出現一次；同類保留原本順序，說話的角色才會排第一
    const order = (id: string) => "SPGL".indexOf(id[0]);
    const locks = Array.from(new Set(ids)).filter(id => byId.has(id)).sort((a, b) => order(a) - order(b)).map(id => byId.get(id)!);
    return {
      title: str(s?.title, 30) || `第 ${i + 1} 幕`,
      description: str(s?.description, 500),
      dialogue,
      cameraMovement: cameras.has(cm) ? cm : "",
      useCharA: s?.useCharA !== false,
      useCharB: s?.useCharB !== false,
      ...(plannedSeconds ? { plannedSeconds } : {}),
      ...(videoPrompt ? { videoPrompt } : {}),
      ...(str(s?.framing, 10) ? { framing: str(s?.framing, 10) } : {}),
      ...(str(s?.angle, 10) ? { angle: str(s?.angle, 10) } : {}),
      ...(str(s?.sound, 60) ? { sound: str(s?.sound, 60) } : {}),
      ...(str(s?.purpose, 60) ? { purpose: str(s?.purpose, 60) } : {}),
      ...(locks.length ? { locks } : {}),
      ...(s?.transition === true ? { endOnNext: true } : {}),
    };
  }).filter((s: DramaScriptScene) => s.description);
  // 轉場最多兩幕，最後一幕沒有下一幕可以接
  let transitions = 0;
  scenes.forEach((sc: DramaScriptScene, i: number) => {
    if (!sc.endOnNext) return;
    if (i === scenes.length - 1 || transitions >= 2) delete sc.endOnNext; else transitions++;
  });

  return { intent: str(raw?.intent, 1500), assets, scenes };
}

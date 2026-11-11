// 漫劇「分鏡圖 → 動畫」的動態提示詞。
//
// 圖生影片模型已經看得到分鏡圖（第一格），所以提示詞不該重述畫面裡有什麼，
// 而要寫「接下來幾秒發生的變化」。公式：
//   首幀錨點 + 主體動態 + 背景動態 + 運鏡 + 氛圍變化
// 這裡只組文字，不呼叫任何服務，網站端點與批次動畫共用。

export type MotionScene = {
  title?: string | null;
  description?: string | null;
  dialogue?: string | null;
  cameraMovement?: string | null;
};

const CAMERA_ZH: Record<string, string> = {
  none: "固定鏡頭", static: "固定鏡頭",
  push_in: "緩慢推近", pull_out: "緩慢拉遠",
  pan_left: "向左平移", pan_right: "向右平移",
  tilt_up: "向上搖", tilt_down: "向下搖",
  orbit: "緩慢環繞", zoom_in: "緩慢變焦拉近", zoom_out: "緩慢變焦拉遠",
};

export function cameraMovementZh(value?: string | null): string {
  const v = (value ?? "").trim();
  return CAMERA_ZH[v] ?? v;
}

/** Constraints every drama clip needs, whoever wrote the rest of the prompt. */
export const MOTION_GUARD = "全程同一個鏡頭不切換，角色的臉、髮型與服裝保持不變，不新增人物或物件，畫面不出現字幕或文字。";

/** The instruction given to the language model that writes one scene's motion prompt. */
export function motionPromptRequest(input: {
  scene: MotionScene; prev?: MotionScene | null; next?: MotionScene | null;
  chain: boolean; durationSeconds?: number; hasLastFrame?: boolean;
}): string {
  const { scene, prev, next, chain } = input;
  const seconds = input.durationSeconds ?? 5;
  const camera = cameraMovementZh(scene.cameraMovement) || "（未指定，請依內容挑一種）";
  const line = (s?: MotionScene | null, empty = "") => (s ? `${s.title || ""}｜${s.description || ""}` : empty);
  return `你是圖生影片（image-to-video）的動態提示詞專家。影片模型已經看得到這一幕的分鏡圖，它就是影片的第一格。所以不要重述畫面裡有什麼，把字數花在「接下來 ${seconds} 秒發生的變化」。

【本幕畫面】${scene.description ?? ""}
【台詞】${scene.dialogue?.trim() ? scene.dialogue : "（無）"}
【運鏡建議】${camera}
【上一幕】${line(prev, "（這是首幕）")}
【下一幕】${line(next, "（這是末幕）")}

請寫一段繁體中文、120 字以內、不分點的提示詞，依序包含：
1. 首幀錨點：用不超過 15 個字點出主體是誰（例如「窗邊的長髮女子」），不描述背景細節。
2. 主體動態：一個主要動作，加一個微動作（眼神、呼吸、髮絲、手指）。幅度要能在 ${seconds} 秒內自然做完，只寫一件事，不要連續好幾個動作。
3. 背景動態：環境裡一個會動的東西（光影、風、雨、煙、遠處人群）；沒有就寫背景保持穩定。
4. 運鏡：只用一種，並寫出速度（緩慢、平穩或急促）。
5. 氛圍變化：光線或情緒從什麼走向什麼。

能量依內容決定：對話與情緒戲用細微動態（固定或緩慢的鏡頭、眼神與呼吸）；追逐、打鬥、衝突才用大動態（跟拍、急推、大幅位移）。
${scene.dialogue?.trim() ? "這一幕有台詞：讓說話的人有開口說話的口型與相符的神情，但不要寫出台詞文字。\n" : ""}${input.hasLastFrame ? "這一幕指定了尾幀：動作要自然收在尾幀的姿勢與構圖。\n" : ""}${chain
    ? "連續模式已開啟：有上一幕時，開場要承接上一幕結束時的動作或情緒；有下一幕時，收尾要朝下一幕的開場過渡；起手與收尾的站位要和相鄰幕一致。\n"
    : "請參考前後幕的走向，動作與情緒不要和相鄰幕矛盾。\n"}
限制：只描述畫面中已有的人事物，不新增角色或物件；不切鏡頭；用看得見的動作表現情緒，不要寫「她很難過」這類敘述；不寫台詞、不加引號、不寫「請生成」之類的引言。只輸出提示詞本身。`;
}

/** Tidy the model's answer and add the fixed constraints. */
export function finishMotionPrompt(text: string): string {
  const body = text.trim().replace(/^[「『"']|[」』"']$/g, "").replace(/\s+/g, " ");
  if (!body) return "";
  return `${body}${/[。！？.!?]$/.test(body) ? "" : "。"}${MOTION_GUARD}`;
}

/**
 * Used when no motion prompt was written for a scene. The scene description
 * describes a still picture, so it is only kept as a short anchor; the motion
 * itself is a safe, generic one that suits most shots.
 */
export function fallbackMotionPrompt(scene: MotionScene): string {
  const camera = cameraMovementZh(scene.cameraMovement) || "緩慢推近";
  const anchor = (scene.description ?? "").trim().split(/[，。,.；;]/)[0]?.slice(0, 24) ?? "";
  const speaking = scene.dialogue?.trim() ? "角色開口說話，神情與語氣相符，" : "角色自然呼吸、眼神微微移動，";
  return `${anchor ? `${anchor}。` : ""}${speaking}髮絲與衣角隨空氣輕輕晃動，背景光影緩慢流動。鏡頭${camera}，節奏平穩。${MOTION_GUARD}`;
}

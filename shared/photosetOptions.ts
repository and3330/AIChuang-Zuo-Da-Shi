/**
 * Options for the 寫真套圖 page that both the client and the planner use.
 *
 *   PHOTO_LOOKS — finishing styles. The chosen look's `suffix` is appended to
 *                 every prompt; it is what keeps skin and light from looking
 *                 over-processed ("AI 感").
 *   POSES       — an original, text-only pose library. Each pose is a plain
 *                 description the image model can follow. No third-party
 *                 pose image is bundled; a user may attach their own pose
 *                 reference image to a shot on the page.
 */

/* ---------- finishing looks ---------- */

export type PhotoLookId = "natural" | "phone" | "film" | "studio";

export const PHOTO_LOOKS: Array<{ id: PhotoLookId; label: string; hint: string; suffix: string }> = [
  {
    id: "natural",
    label: "自然寫實",
    hint: "相機原片感，保留皮膚紋理（推薦）",
    suffix:
      "【質感】未修圖的相機原片：保留皮膚紋理、毛孔與細微瑕疵，不磨皮、不美顏、不要塑膠感皮膚；髮絲有自然碎髮；真實環境光，色彩自然不過飽和、不過度銳利；五官比例真實；極輕微顆粒。",
  },
  {
    id: "phone",
    label: "手機隨拍",
    hint: "生活感、朋友幫拍的日常照",
    suffix:
      "【質感】手機隨手拍的生活照：只有現場光、沒有專業打光，景深較深、構圖隨性，有輕微雜訊；皮膚保留真實紋理、不磨皮不美顏；表情自然像被朋友抓拍；色彩平實。",
  },
  {
    id: "film",
    label: "底片感",
    hint: "顆粒、柔和高光、復古色調",
    suffix:
      "【質感】35mm 彩色負片：可見的底片顆粒、柔和高光與輕微光暈、對比略低、膚色溫潤；銳利度柔和不數位；皮膚保留真實紋理、不磨皮。",
  },
  {
    id: "studio",
    label: "棚拍精修",
    hint: "雜誌感、乾淨光滑（較有修圖感）",
    suffix:
      "【質感】專業棚拍雜誌人像：柔光箱主光與輪廓光，膚質乾淨但保留紋理，色彩準確，畫面銳利。",
  },
];

export function photoLookSuffix(id: PhotoLookId): string {
  return (PHOTO_LOOKS.find(l => l.id === id) ?? PHOTO_LOOKS[0]).suffix;
}

/* ---------- pose library ---------- */

export type PoseFraming = "全身" | "半身" | "特寫";

export type Pose = {
  id: string;
  category: string;
  name: string;
  /** Suggested framing; the planner may adjust it to fit the scene. */
  framing: PoseFraming;
  /** Plain description of the body position. */
  description: string;
};

export const POSE_CATEGORIES = ["站姿", "坐姿", "蹲跪", "躺臥倚靠", "動態", "回眸背影", "半身手勢", "臉部特寫"] as const;

export const POSES: Pose[] = [
  // ── 站姿 ──
  { id: "stand-relaxed", category: "站姿", name: "自然站立", framing: "全身", description: "自然站立，重心放在一隻腳上，另一腳微微放鬆，雙手自然垂在身側" },
  { id: "stand-hip", category: "站姿", name: "單手扶腰", framing: "全身", description: "站立，一手輕扶在腰側，另一手自然下垂，肩膀放鬆，身體呈現柔和的 S 曲線" },
  { id: "stand-cross-legs", category: "站姿", name: "交叉腿站", framing: "全身", description: "站立，雙腿前後交叉，雙手在身前輕輕交握，上身微微傾向一側" },
  { id: "stand-lean-wall", category: "站姿", name: "倚牆站", framing: "全身", description: "背部或肩膀輕靠在牆上，一腳向後踩牆、膝蓋彎曲，雙手放在身後或插在口袋" },
  { id: "stand-pocket", category: "站姿", name: "手插口袋", framing: "全身", description: "站立，雙手或單手插在口袋，雙腳與肩同寬，神情輕鬆" },
  { id: "stand-arms-up", category: "站姿", name: "抬手整理頭髮", framing: "半身", description: "站立，一手抬起撥弄或整理頭髮，手肘自然抬高，另一手放鬆下垂" },
  { id: "stand-doorframe", category: "站姿", name: "倚門框", framing: "全身", description: "側身倚靠在門框或柱子旁，一手扶著門框，頭微微靠向手臂" },
  { id: "stand-tiptoe", category: "站姿", name: "踮腳伸展", framing: "全身", description: "站立踮起腳尖，雙手向上伸展或伸懶腰，身體拉長、背部微微後仰" },

  // ── 坐姿 ──
  { id: "sit-chair-side", category: "坐姿", name: "側坐椅子", framing: "全身", description: "側坐在椅子上，雙腿併攏斜放，一手搭在椅背，上身轉向鏡頭" },
  { id: "sit-floor-knee", category: "坐姿", name: "坐地抱膝", framing: "全身", description: "坐在地上，雙膝彎起，雙手環抱小腿，下巴輕靠在膝蓋上" },
  { id: "sit-floor-lean-back", category: "坐姿", name: "後仰坐單膝立起", framing: "全身", description: "坐在地上，身體向後傾、雙手在身後撐地，一腿伸直、另一腿屈膝立起" },
  { id: "sit-cross-legged", category: "坐姿", name: "盤腿坐", framing: "全身", description: "盤腿坐著，背部挺直放鬆，雙手自然放在膝上或腳踝" },
  { id: "sit-edge", category: "坐姿", name: "坐在邊緣", framing: "全身", description: "坐在床沿、窗台或台階邊緣，雙腳自然垂下或一腳踩地，雙手撐在身體兩側" },
  { id: "sit-sofa-curl", category: "坐姿", name: "窩在沙發", framing: "全身", description: "側身窩在沙發上，雙腿收起放在坐墊上，一手撐著頭，姿態慵懶" },
  { id: "sit-chin-hand", category: "坐姿", name: "坐著托腮", framing: "半身", description: "坐在桌邊，一手手肘撐在桌上托著臉頰，身體微微前傾" },
  { id: "sit-stairs", category: "坐姿", name: "坐在階梯", framing: "全身", description: "坐在階梯上，雙腳踩在不同高度的台階，手肘放在膝上，身體微微前傾" },

  // ── 蹲跪 ──
  { id: "squat-low", category: "蹲跪", name: "蹲姿", framing: "全身", description: "雙腳著地蹲下，雙臂自然搭在膝蓋上，抬頭看向鏡頭" },
  { id: "kneel-one", category: "蹲跪", name: "單膝跪", framing: "全身", description: "單膝跪地，另一腳屈膝踩地，一手放在立起的膝蓋上，上身挺直" },
  { id: "kneel-sit", category: "蹲跪", name: "跪坐", framing: "全身", description: "雙膝併攏跪坐在腳跟上，雙手輕放在大腿上，背部挺直" },
  { id: "kneel-up", category: "蹲跪", name: "跪立", framing: "全身", description: "雙膝跪地、上身直立，一手抬起輕觸頭髮，另一手自然放在身側" },

  // ── 躺臥倚靠 ──
  { id: "lie-side", category: "躺臥倚靠", name: "側躺撐頭", framing: "全身", description: "側躺，一手手肘撐起托住頭部，另一手自然放在身前，雙腿微微彎曲交疊" },
  { id: "lie-back", category: "躺臥倚靠", name: "仰躺", framing: "全身", description: "仰躺，頭髮自然散開，一手放在頭側、一手放在腹部，從上方俯拍" },
  { id: "lie-prone", category: "躺臥倚靠", name: "趴著撐下巴", framing: "全身", description: "趴著，雙手手肘撐起、雙手托著下巴，小腿向上彎起交叉" },
  { id: "lean-table", category: "躺臥倚靠", name: "趴在桌上", framing: "半身", description: "上身趴在桌面，頭側枕在交疊的手臂上，眼神望向鏡頭" },
  { id: "lean-railing", category: "躺臥倚靠", name: "倚欄杆", framing: "全身", description: "雙手或手肘搭在欄杆上，身體前傾，望向遠方或回頭看鏡頭" },

  // ── 動態 ──
  { id: "walk-toward", category: "動態", name: "迎面走來", framing: "全身", description: "朝鏡頭方向自然行走，一腳向前跨出，手臂自然擺動，頭髮與衣襬帶有動態" },
  { id: "walk-away-look", category: "動態", name: "走遠回頭", framing: "全身", description: "背對鏡頭向前走，回頭望向鏡頭，頭髮隨著轉頭甩動" },
  { id: "spin", category: "動態", name: "轉圈", framing: "全身", description: "原地旋轉，裙襬或頭髮因旋轉而飛揚，雙臂微微張開，表情開心" },
  { id: "jump", category: "動態", name: "輕跳", framing: "全身", description: "輕輕跳起離地，雙腳微屈，雙手自然張開，頭髮向上飄起，笑容燦爛" },
  { id: "run", category: "動態", name: "小跑", framing: "全身", description: "朝畫面一側小跑，身體前傾，手臂擺動，頭髮向後飄" },
  { id: "hair-flip", category: "動態", name: "甩髮", framing: "半身", description: "快速轉頭甩動長髮，髮絲在空中散開，表情自然帶笑" },
  { id: "stretch", category: "動態", name: "伸懶腰", framing: "半身", description: "雙手高舉過頭伸懶腰，眼睛微閉、嘴角帶笑，身體微微後仰" },

  // ── 回眸背影 ──
  { id: "back-look", category: "回眸背影", name: "背影回眸", framing: "半身", description: "背對鏡頭，轉頭越過肩膀回望鏡頭，肩線與下顎線清楚" },
  { id: "back-full", category: "回眸背影", name: "純背影", framing: "全身", description: "完全背對鏡頭站立，望向遠方，呈現髮型與服裝的背面，人物在場景中顯得安靜" },
  { id: "side-profile", category: "回眸背影", name: "側身望遠", framing: "半身", description: "身體與臉都呈側面，視線平視望向畫面外，下巴微微抬起" },
  { id: "over-shoulder-smile", category: "回眸背影", name: "側身回頭笑", framing: "半身", description: "身體側對鏡頭，轉頭面向鏡頭露出笑容，一側肩膀微微前傾" },

  // ── 半身手勢 ──
  { id: "hand-chin", category: "半身手勢", name: "手托下巴", framing: "半身", description: "一手輕托下巴，手指自然彎曲，頭微微傾斜，眼神看向鏡頭" },
  { id: "hand-hair-ear", category: "半身手勢", name: "撥髮到耳後", framing: "半身", description: "一手將髮絲撥到耳後，視線微微向下或望向一側，神情溫柔" },
  { id: "arms-crossed", category: "半身手勢", name: "雙手抱胸", framing: "半身", description: "雙手在胸前交叉，肩膀放鬆，表情自信" },
  { id: "hands-cup", category: "半身手勢", name: "雙手捧杯", framing: "半身", description: "雙手捧著杯子靠近嘴邊，肩膀微微聳起，眼神越過杯緣看向鏡頭" },
  { id: "hand-collar", category: "半身手勢", name: "手扶衣領", framing: "半身", description: "一手輕拉或整理衣領與肩帶，另一手自然下垂，下巴微抬" },
  { id: "hand-shade", category: "半身手勢", name: "手遮陽光", framing: "半身", description: "一手抬到額前遮擋陽光，光影落在臉上，瞇著眼微笑" },
  { id: "hug-self", category: "半身手勢", name: "環抱手臂", framing: "半身", description: "雙手環抱自己的上臂，身體微微縮起，神情安靜" },
  { id: "hold-object", category: "半身手勢", name: "手持小物", framing: "半身", description: "手上拿著場景裡合適的小物（花、書本、相機或飲料），視線落在物品上" },

  // ── 臉部特寫 ──
  { id: "face-direct", category: "臉部特寫", name: "直視鏡頭", framing: "特寫", description: "臉部特寫，正面直視鏡頭，表情平靜自然，嘴唇微張" },
  { id: "face-smile", category: "臉部特寫", name: "自然微笑", framing: "特寫", description: "臉部特寫，自然的微笑，眼睛因笑意微彎，視線看向鏡頭" },
  { id: "face-down", category: "臉部特寫", name: "低頭垂眼", framing: "特寫", description: "臉部特寫，微微低頭、眼睛向下看，睫毛與鼻樑線條清楚，神情沉靜" },
  { id: "face-look-away", category: "臉部特寫", name: "望向遠方", framing: "特寫", description: "臉部特寫，3/4 側臉，視線望向畫面外的遠方，表情若有所思" },
  { id: "face-laugh", category: "臉部特寫", name: "開懷大笑", framing: "特寫", description: "臉部特寫，開懷大笑、露出牙齒，眼睛瞇起，頭微微後仰，抓拍感" },
  { id: "face-eyes-closed", category: "臉部特寫", name: "閉眼感受", framing: "特寫", description: "臉部特寫，閉上眼睛、臉微微仰起，像在感受陽光或微風，嘴角放鬆" },
];

export function poseById(id: string): Pose | undefined {
  return POSES.find(p => p.id === id);
}

/** A ready-to-use shot prompt for a pose, for adding a shot without the AI planner. */
export function poseShotPrompt(pose: Pose): string {
  const lens = pose.framing === "特寫" ? "85mm 淺景深" : pose.framing === "半身" ? "50mm 鏡頭" : "35mm 環境人像";
  return `${pose.framing}構圖，${pose.description}。${lens}，光線與場景自然融合。`;
}

/* ---------- reference-image notes ---------- */

export type PhotosetMode = "scene" | "character";

/**
 * Note appended to every photo-set prompt so the image model knows what each
 * input image is for. Image order is always [情境圖 (scene mode), ...refs].
 */
export function referenceNote(
  mode: PhotosetMode,
  refCount: number,
  outfitFrom: "character" | "scene",
  /** character mode: false when the outfit comes from the prompt, not the references. */
  keepOutfit = true,
): string {
  if (mode === "character" && !keepOutfit) {
    return "（參考圖是這位角色的臉部與髮型參考，請保持臉部五官、髮型髮色與身形一致；服裝請依照提示詞的描述，不要沿用參考圖中的衣服。）";
  }
  if (mode === "character") {
    return refCount > 1
      ? "（所有參考圖都是同一位角色，請保持臉部五官、髮型髮色、身形與服裝完全一致。）"
      : "（參考圖為角色本人，請保持臉部五官、髮型髮色、身形與服裝完全一致。）";
  }
  if (refCount === 0) return "";
  const refRange = refCount > 1 ? `第 2–${refCount + 1} 張圖` : "第 2 張圖";
  const outfit = outfitFrom === "scene" ? "服裝沿用第 1 張圖中的穿著" : "服裝沿用角色參考圖中的穿著";
  return `（第 1 張圖是情境參考，只取其場景、光線、色調與氛圍；${refRange}是角色參考圖，畫面中的人物必須是角色參考圖中的這個人，臉部五官、髮型髮色與身形以角色參考圖為準，${outfit}。）`;
}

/** Tells the image model how to use a per-shot pose reference image. */
export function poseRefNote(imageNumber: number): string {
  return `（第 ${imageNumber} 張圖是姿勢參考圖，只參考其身體姿態、四肢角度與鏡頭視角；不要沿用其中人物的外觀、服裝、背景與畫風，也不要畫成人偶或線稿。）`;
}

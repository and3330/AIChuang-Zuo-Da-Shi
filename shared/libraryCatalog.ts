/**
 * 素材圖庫的清單（catalog）。
 *
 * 這裡只有文字：每一筆素材的代號、分類、名稱和「生成預覽圖用的提示詞」。
 * 圖片不在版本庫裡 —— 由後台的批次生成器用便宜的文字生圖模型畫出來，存到
 * CDN，資料庫的 library_assets 記錄網址與狀態。
 *
 * 清單全部是我們自己寫的描述，用屬性組合產生：
 *   pose     姿勢 2,034 筆：288 組組合姿勢 ＋ 119 組手寫姿勢，各 5 個視角，中性的白色素體人偶
 *   costume  服裝 3,392 筆：52 套穿搭 × 8 組配色 × 8 種布料細節（3,224）＋ 21 套成人向 × 8 色（168），沒有人、透明背景
 *   portrait 人像 1,499 筆：25 種髮型 × 5 種髮色 × 4 種表情 × 3 種臉型
 *   合計 6,925 筆
 *
 * 規則：
 *   - 代號（id）由屬性的 key 組成，是穩定的。同步時只新增缺少的列，不會動到
 *     已生成的圖。不要改既有的 key；要換內容就新增一個 key。
 *   - 改了某一筆的提示詞後，在後台對那一筆按「重生」即可。
 *   - 組合出來的項目偶爾會有不太合理的搭配，生成後看圖，不滿意就單張重生或
 *     從清單拿掉。
 */

export type LibraryId = "pose" | "costume" | "portrait";

export type CatalogEntry = {
  id: string;
  library: LibraryId;
  category: string;
  name: string;
  /** Prompt for the preview image. */
  prompt: string;
  /** Hidden from non-admin users. */
  adult: boolean;
  /** "WIDTHxHEIGHT" accepted by the preview model. */
  size: string;
  transparent: boolean;
  /** What the user-facing generators should use when this asset is picked. */
  usage: string;
  tags: string[];
  sortOrder: number;
};

export const LIBRARIES: Array<{ id: LibraryId; label: string; hint: string }> = [
  { id: "pose", label: "姿勢", hint: "素體人偶示範的身體姿態，每個姿勢有正面、斜側、側面、俯視、仰視五個視角" },
  { id: "costume", label: "服裝", hint: "不含人物的整套穿搭，透明背景" },
  { id: "portrait", label: "人像", hint: "臉部與髮型參考" },
];

/** Target sizes of each library. */
export const LIBRARY_TARGETS: Record<LibraryId, number> = { pose: 2034, costume: 3392, portrait: 1499 };

type Opt = { key: string; name: string; desc: string };

/* ───────────────────────── poses: 288 groups × 5 views ───────────────────────── */

const POSE_VIEWS: Opt[] = [
  { key: "front", name: "正面", desc: "正面視角，鏡頭與人偶腰部等高" },
  { key: "diag", name: "斜側", desc: "左前方 45 度的斜側視角，鏡頭與人偶腰部等高" },
  { key: "side", name: "側面", desc: "90 度正側面視角，鏡頭與人偶腰部等高" },
  { key: "high", name: "俯視", desc: "從斜上方約 45 度俯視的高角度視角" },
  { key: "low", name: "仰視", desc: "從地面附近向上仰視的低角度視角" },
];

const ARMS_GENERAL: Opt[] = [
  { key: "relax", name: "雙手放鬆", desc: "雙手自然垂放在身側" },
  { key: "hip1", name: "單手扶腰", desc: "一手扶在腰側，另一手自然垂放" },
  { key: "hip2", name: "雙手扶腰", desc: "雙手扶在腰的兩側，手肘向外" },
  { key: "cross", name: "雙手抱胸", desc: "雙手在胸前交叉" },
  { key: "hair", name: "單手撥髮", desc: "一手抬起放在頭側像在撥頭髮，另一手自然垂放" },
  { key: "up", name: "雙手高舉", desc: "雙手高舉過頭向上伸展" },
  { key: "back", name: "雙手背後", desc: "雙手在身後交握" },
  { key: "chin", name: "單手托下巴", desc: "一手托著下巴，另一手扶著托下巴那隻手的手肘" },
  { key: "wave", name: "單手揮手", desc: "一手舉到肩膀高度揮手，另一手自然垂放" },
];

const STAND_LEGS: Opt[] = [
  { key: "even", name: "站直", desc: "雙腳與肩同寬站直" },
  { key: "contra", name: "重心單腳", desc: "重心放在一隻腳，另一腳膝蓋微彎、腳尖點地，骨盆自然傾斜" },
  { key: "crossed", name: "交叉腿站", desc: "站立，雙腿前後交叉" },
  { key: "step", name: "跨前半步", desc: "站立，一腳向前跨出半步" },
  { key: "together", name: "併腿站", desc: "雙腳併攏站直" },
  { key: "wide", name: "開腿站", desc: "雙腳大幅張開、穩穩站立" },
  { key: "tiptoe", name: "踮腳站", desc: "雙腳踮起腳尖站立，身體向上拉長" },
  { key: "hook", name: "單腳後勾", desc: "單腳站立，另一腳小腿向後勾起" },
];

const SIT_BASES: Opt[] = [
  { key: "chair", name: "坐椅併腿", desc: "端坐在一張簡單的方凳上，雙腿併攏、雙腳踩地" },
  { key: "chair-cross", name: "坐椅翹腳", desc: "坐在一張簡單的方凳上，一腿翹在另一腿上" },
  { key: "chair-slant", name: "坐椅斜腿", desc: "坐在一張簡單的方凳上，雙腿併攏斜向一側" },
  { key: "floor-cross", name: "盤腿坐", desc: "盤腿坐在地上，背部挺直" },
  { key: "floor-knees", name: "屈膝坐", desc: "坐在地上，雙膝彎起、雙腳踩地" },
  { key: "floor-straight", name: "伸腿坐", desc: "坐在地上，雙腿向前伸直併攏" },
  { key: "floor-side", name: "側坐", desc: "坐在地上，雙腿彎曲收向身體一側" },
  { key: "ledge", name: "坐高處", desc: "坐在一個高平台的邊緣，雙腳自然懸空" },
];

const SIT_ARMS: Opt[] = [
  { key: "lap", name: "手放腿上", desc: "雙手自然放在大腿上" },
  { key: "cheek", name: "單手托腮", desc: "一手托著臉頰，手肘靠在腿上" },
  { key: "prop", name: "向後撐", desc: "雙手在身後撐住身體，上身微微後仰" },
  { key: "clasp", name: "雙手交握", desc: "雙手交握放在腿上" },
  { key: "hair", name: "單手撥髮", desc: "一手抬起放在頭側像在撥頭髮" },
  { key: "stretch", name: "伸懶腰", desc: "雙手高舉過頭伸懶腰" },
  { key: "cross", name: "雙手抱胸", desc: "雙手在胸前交叉" },
  { key: "neck", name: "手扶後頸", desc: "一手扶在後頸，另一手放在腿上" },
  { key: "wave", name: "單手揮手", desc: "一手舉到肩膀高度揮手，另一手放在腿上" },
];

const LOW_BASES: Opt[] = [
  { key: "seiza", name: "跪坐", desc: "雙膝併攏跪坐在腳跟上，背部挺直" },
  { key: "kneel-up", name: "跪立", desc: "雙膝跪地、大腿與上身直立" },
  { key: "kneel-one", name: "單膝跪", desc: "單膝跪地，另一腳屈膝踩地" },
  { key: "squat", name: "深蹲", desc: "雙腳著地深蹲，膝蓋朝外" },
];

const LIE_BASES: Opt[] = [
  { key: "back", name: "仰躺", desc: "仰躺在地上，雙腿伸直" },
  { key: "back-knees", name: "仰躺屈膝", desc: "仰躺在地上，雙膝彎起、雙腳踩地" },
  { key: "side", name: "側躺", desc: "側躺在地上，雙腿微彎交疊" },
  { key: "prone", name: "趴姿", desc: "趴在地上，小腿向上彎起" },
  { key: "recline", name: "半躺", desc: "斜靠半躺，上身用手肘撐起" },
];

const LIE_ARMS: Opt[] = [
  { key: "sides", name: "手放身側", desc: "雙手自然放在身體兩側" },
  { key: "pillow", name: "雙手枕頭", desc: "雙手交疊枕在頭後" },
  { key: "head", name: "單手撐頭", desc: "一手撐著頭部" },
  { key: "reach", name: "雙手上伸", desc: "雙手向頭頂方向伸展" },
  { key: "belly", name: "手放腹部", desc: "一手放在腹部，另一手放在頭側" },
  { key: "chest", name: "手疊胸前", desc: "雙手交疊放在胸前" },
];

const ACTIONS: Opt[] = [
  { key: "walk", name: "行走", desc: "向前行走，一腳跨出、手臂自然擺動" },
  { key: "jog", name: "小跑", desc: "小跑步，身體前傾、手臂彎曲擺動" },
  { key: "jump", name: "跳躍", desc: "原地跳起離地，雙腳微屈" },
  { key: "spin", name: "旋轉", desc: "原地旋轉，雙臂微微張開保持平衡" },
  { key: "sidestep", name: "側跨步", desc: "向側邊大步跨出，重心移到跨出的那隻腳" },
  { key: "kick", name: "踢腿", desc: "一腳向前踢起到腰部高度，雙臂張開保持平衡" },
  { key: "lunge", name: "弓步", desc: "前後弓箭步，前腳屈膝、後腳伸直" },
  { key: "dance", name: "舞動", desc: "隨音樂擺動的舞蹈姿勢，骨盆偏向一側、一手高舉" },
  { key: "stairs", name: "踏階", desc: "一腳踏上一階台階的步伐" },
  { key: "bend", name: "彎腰", desc: "向前彎腰，一手伸向地面像在拾起東西" },
  { key: "balance", name: "單腳平衡", desc: "單腳站立保持平衡，另一腳向後抬起、雙臂側平舉" },
  { key: "backstep", name: "後退", desc: "向後退一步，上身微微後仰、雙手抬到胸前" },
];

const ACTION_VARIANTS: Opt[] = [
  { key: "soft", name: "輕緩", desc: "動作幅度小而輕緩" },
  { key: "big", name: "大幅度", desc: "動作幅度大而有力" },
  { key: "look", name: "回頭", desc: "同時轉頭回望身後" },
];

const GESTURES: Opt[] = [
  { key: "chin", name: "手托下巴", desc: "一手輕托下巴" },
  { key: "ear", name: "撥髮到耳後", desc: "一手抬到耳邊像在把頭髮撥到耳後" },
  { key: "cross", name: "雙手抱胸", desc: "雙手在胸前交叉" },
  { key: "cheeks", name: "雙手捧臉", desc: "雙手捧著臉頰" },
  { key: "brim", name: "手扶帽簷", desc: "一手抬到額前像在扶著帽簷" },
  { key: "shade", name: "手遮陽", desc: "一手抬到額前遮擋陽光" },
  { key: "hug", name: "環抱上臂", desc: "雙手環抱自己的上臂" },
  { key: "wave", name: "揮手", desc: "一手舉到臉旁揮手" },
  { key: "pray", name: "雙手合十", desc: "雙手在胸前合十" },
  { key: "neck", name: "手扶後頸", desc: "一手扶在後頸" },
  { key: "collar", name: "整理衣領", desc: "雙手抬到鎖骨附近像在整理衣領" },
  { key: "heart", name: "手放胸口", desc: "一手輕放在胸口" },
  { key: "clasp", name: "雙手交握", desc: "雙手在胸前交握" },
  { key: "reach", name: "伸手向鏡頭", desc: "一手向前伸向鏡頭" },
];

const HEADS: Opt[] = [
  { key: "straight", name: "頭擺正", desc: "頭部擺正" },
  { key: "tilt", name: "歪頭", desc: "頭部微微傾向一側" },
  { key: "turn", name: "轉頭", desc: "頭部轉向側面" },
];

const POSE_STYLE_ONE =
  "一個中性、沒有五官細節、沒有頭髮與服裝的白色素體人偶（藝用人體模型），啞光白色材質，關節線條清楚，比例為成年人。" +
  "純淺灰色無縫背景，柔和均勻的棚燈，有淡淡的接觸陰影。置中，周圍留白。不要任何文字、標籤、箭頭或邊框。";

type PoseGroup = { key: string; category: string; name: string; desc: string; framing: "全身" | "半身"; people?: 2 };

function cross(category: string, prefix: string, bases: Opt[], extras: Opt[], framing: "全身" | "半身" = "全身"): PoseGroup[] {
  const out: PoseGroup[] = [];
  for (const b of bases) {
    for (const x of extras) {
      out.push({ key: `${prefix}-${b.key}-${x.key}`, category, name: `${b.name}・${x.name}`, desc: `${b.desc}，${x.desc}`, framing });
    }
  }
  return out;
}

function poseGroups(): PoseGroup[] {
  return [
    ...cross("站姿", "stand", STAND_LEGS, ARMS_GENERAL),      // 8 × 9 = 72
    ...cross("坐姿", "sit", SIT_BASES, SIT_ARMS),              // 8 × 9 = 72
    ...cross("蹲跪", "low", LOW_BASES, ARMS_GENERAL),          // 4 × 9 = 36
    ...cross("躺臥", "lie", LIE_BASES, LIE_ARMS),              // 5 × 6 = 30
    ...cross("動態", "move", ACTIONS, ACTION_VARIANTS),        // 12 × 3 = 36
    ...cross("半身手勢", "bust", GESTURES, HEADS, "半身"),      // 14 × 3 = 42
  ];                                                           // = 288
}

/**
 * Hand-written poses added on top of the combined ones (119 groups × 5 views).
 * Everyday, portrait, stretching and two-person poses only; our own wording.
 * Keys are stable: add new ones at the end, never rename.
 */
const EXTRA_POSES: PoseGroup[] = [
  { key: "x-s-curve", category: "站姿", name: "S 曲線站", desc: "站立，身體呈 S 形曲線，骨盆推向一側，一手扶腰", framing: "全身" },
  { key: "x-hair-both", category: "站姿", name: "雙手攏髮", desc: "站立，背部微微後仰，雙手抬起把頭髮向後攏", framing: "全身" },
  { key: "x-look-back", category: "站姿", name: "回眸", desc: "站立，身體背向鏡頭四分之三，轉頭越過肩膀回望", framing: "全身" },
  { key: "x-nape", category: "站姿", name: "雙手扶後頸", desc: "站立，雙手抬起扶在後頸，手肘向兩側打開", framing: "全身" },
  { key: "x-head-one", category: "站姿", name: "單手扶後腦", desc: "站立，一手抬起扶在後腦，另一手自然垂放，重心放在一隻腳", framing: "全身" },
  { key: "x-neck-thigh", category: "站姿", name: "手放頸側與腿側", desc: "站立，一手輕放在頸側，另一手輕放在大腿外側", framing: "全身" },
  { key: "x-arm-hip", category: "站姿", name: "單手高舉送胯", desc: "站立，一手高舉過頭，骨盆推向另一側", framing: "全身" },
  { key: "x-wide-hips", category: "站姿", name: "開腿扶腰", desc: "雙腳大幅張開站立，雙手扶腰，挺胸", framing: "全身" },
  { key: "x-tiptoe-v", category: "站姿", name: "踮腳雙臂 V 字", desc: "踮起腳尖站立，雙臂向斜上方張開成 V 字", framing: "全身" },
  { key: "x-wind", category: "站姿", name: "迎風站", desc: "站立，身體微微前傾像迎著風，一手抬到頭側按住頭髮", framing: "全身" },
  { key: "x-knee-in", category: "站姿", name: "內收膝扶腰", desc: "站立，雙手扶腰，一腳膝蓋向內收、腳尖點地，上身微微後仰", framing: "全身" },
  { key: "x-knee-hug", category: "站姿", name: "站姿抱膝", desc: "單腳站立，另一腳屈膝抬到胸前，雙手抱住膝蓋", framing: "全身" },
  { key: "x-foot-back", category: "站姿", name: "後勾腳回頭", desc: "站立，一腳小腿向後勾起，雙手在身後交握，轉頭看向一側", framing: "全身" },
  { key: "x-lean-knee", category: "坐姿", name: "後仰單膝立", desc: "坐在地上，上身向後仰用雙手撐地，一膝立起、另一腿伸直", framing: "全身" },
  { key: "x-one-hand-legs", category: "坐姿", name: "單手撐地伸腿", desc: "坐在地上，一手在身側撐地，雙腿併攏向前斜伸", framing: "全身" },
  { key: "x-back-hands", category: "坐姿", name: "雙手後撐挺胸", desc: "坐在地上，雙手在身後撐地，挺胸、雙腿向前伸直交疊", framing: "全身" },
  { key: "x-knees-tilt", category: "坐姿", name: "抱膝斜倒", desc: "坐在地上雙膝彎起，雙膝併攏倒向左側，雙手環抱小腿", framing: "全身" },
  { key: "x-knee-hair", category: "坐姿", name: "單膝立撥髮", desc: "坐在地上，一膝立起，一手搭在膝上、另一手撥頭髮", framing: "全身" },
  { key: "x-diag-hip", category: "坐姿", name: "斜伸腿扶腰", desc: "坐在地上，雙腿向斜前方伸直，一手扶腰、一手撐地", framing: "全身" },
  { key: "x-elbows", category: "坐姿", name: "雙肘後撐", desc: "坐在地上向後斜躺，用雙手手肘撐起上身，雙腿伸直交疊", framing: "全身" },
  { key: "x-knees-head", category: "坐姿", name: "屈膝雙手枕頭", desc: "坐在地上雙膝彎起，雙手交疊放在頭後，手肘打開", framing: "全身" },
  { key: "x-lean-elbow", category: "坐姿", name: "側倚單肘", desc: "坐在地上，身體向右傾斜用單肘撐地，雙腿收向另一側", framing: "全身" },
  { key: "x-ankle", category: "坐姿", name: "手扶腳踝", desc: "坐在地上，一膝立起，一手輕扶同側腳踝，另一手撐地", framing: "全身" },
  { key: "x-knee-chin", category: "坐姿", name: "單膝立托腮", desc: "坐在地上，一膝立起，手肘靠在膝上托著臉頰", framing: "全身" },
  { key: "x-float", category: "坐姿", name: "後仰抬腳", desc: "坐在地上向後仰用雙手撐地，雙腳併攏離地微微抬起", framing: "全身" },
  { key: "x-knee-arch", category: "坐姿", name: "抱單膝挺背", desc: "坐在地上，雙手抱住一隻立起的膝蓋，背部挺直、另一腿伸直", framing: "全身" },
  { key: "x-leg-up", category: "坐姿", name: "坐姿抬腿", desc: "坐在地上，一腿向上伸直抬高，同側手扶著小腿，另一腿彎曲平放", framing: "全身" },
  { key: "x-w-lap", category: "坐姿", name: "鴨子坐・手放腿上", desc: "鴨子坐（雙膝併攏、小腿分向兩側坐在地上），雙手放在大腿上", framing: "全身" },
  { key: "x-w-front", category: "坐姿", name: "鴨子坐・雙手前撐", desc: "鴨子坐，雙手在身前撐地，上身微微前傾", framing: "全身" },
  { key: "x-w-back", category: "坐姿", name: "鴨子坐・雙手後撐", desc: "鴨子坐，雙手在身後撐地，上身微微後仰", framing: "全身" },
  { key: "x-side-cheek", category: "坐姿", name: "側坐托腮", desc: "側坐在地上，雙腿收向右側，一手托著臉頰", framing: "全身" },
  { key: "x-side-arm", category: "坐姿", name: "側坐單手上伸", desc: "側坐在地上，雙腿收向一側，一手向上伸展、另一手撐地", framing: "全身" },
  { key: "x-side-curve", category: "坐姿", name: "側坐撐地", desc: "側坐在地上，一手在身側撐地，身體向撐地那側彎出弧線", framing: "全身" },
  { key: "x-kneel-thigh", category: "蹲跪", name: "跪立手放腿", desc: "雙膝跪地、上身直立，雙手放在大腿前側", framing: "全身" },
  { key: "x-kneel-head", category: "蹲跪", name: "跪立雙手枕頭", desc: "雙膝跪地、上身直立，雙手交疊放在頭後，手肘打開", framing: "全身" },
  { key: "x-half-knee", category: "蹲跪", name: "單膝跪手放膝", desc: "單膝跪地，另一腳屈膝踩地，雙手疊放在立起的膝蓋上", framing: "全身" },
  { key: "x-half-look", category: "蹲跪", name: "單膝跪仰望", desc: "單膝跪地，另一腳屈膝踩地，抬頭向上仰望，一手放在胸口", framing: "全身" },
  { key: "x-kneel-up-arms", category: "蹲跪", name: "跪立雙手上伸", desc: "雙膝跪地、上身直立，雙手向上伸直", framing: "全身" },
  { key: "x-kneel-hair-hip", category: "蹲跪", name: "跪立撥髮扶腰", desc: "雙膝跪地、上身直立，一手撥頭髮、一手扶腰", framing: "全身" },
  { key: "x-kneel-side", category: "蹲跪", name: "跪姿側撐", desc: "雙膝跪地，身體向一側傾斜、一手撐地，另一手放在腿上", framing: "全身" },
  { key: "x-kneel-twist", category: "蹲跪", name: "跪姿回頭", desc: "雙膝跪地、上身直立，上身扭轉回頭看向身後", framing: "全身" },
  { key: "x-seiza-hair", category: "蹲跪", name: "跪坐撥髮", desc: "跪坐在腳跟上，背部挺直，一手抬起撥頭髮", framing: "全身" },
  { key: "x-squat-knees", category: "蹲跪", name: "蹲姿手放膝", desc: "雙膝併攏蹲下，雙手放在膝蓋上", framing: "全身" },
  { key: "x-squat-hand", category: "蹲跪", name: "蹲姿單手撐地", desc: "蹲下，一手在身側撐地，另一手搭在膝上", framing: "全身" },
  { key: "x-squat-chin", category: "蹲跪", name: "蹲姿托腮", desc: "雙膝併攏蹲下，雙肘靠在膝上、雙手托著臉頰", framing: "全身" },
  { key: "x-squat-hair", category: "蹲跪", name: "蹲姿撥髮", desc: "雙膝併攏蹲下，一手撥頭髮、一手環抱膝蓋", framing: "全身" },
  { key: "x-squat-look", category: "蹲跪", name: "蹲姿回頭", desc: "背向鏡頭蹲下，轉頭越過肩膀回望", framing: "全身" },
  { key: "x-side-knee", category: "躺臥", name: "側躺屈腿", desc: "側躺在地上，一手撐頭，上方的腿屈膝向前", framing: "全身" },
  { key: "x-prone-chin", category: "躺臥", name: "趴姿托腮踢腳", desc: "趴在地上，雙肘撐地、雙手托腮，兩隻小腿向上彎起交錯", framing: "全身" },
  { key: "x-prone-one", category: "躺臥", name: "趴姿托腮單腳", desc: "趴在地上，雙肘撐地、雙手托腮，一隻小腿向上彎起", framing: "全身" },
  { key: "x-prone-arms", category: "躺臥", name: "趴姿枕臂", desc: "趴在地上，雙臂交疊、頭側枕在手臂上，雙腿伸直", framing: "全身" },
  { key: "x-prone-elbows", category: "躺臥", name: "趴姿肘撐", desc: "趴在地上用雙肘撐起上身，雙腿伸直併攏", framing: "全身" },
  { key: "x-back-knees-side", category: "躺臥", name: "仰躺雙膝側倒", desc: "仰躺在地上，雙膝併攏彎起倒向一側，雙臂向兩側打開", framing: "全身" },
  { key: "x-back-one-knee", category: "躺臥", name: "仰躺單膝立", desc: "仰躺在地上，一膝立起、一腿伸直，一手放在頭側", framing: "全身" },
  { key: "x-back-knee-arm", category: "躺臥", name: "仰躺屈膝單手上伸", desc: "仰躺在地上，雙膝立起，一手向頭頂方向伸展、一手放在腹部", framing: "全身" },
  { key: "x-back-hug", category: "躺臥", name: "仰躺抱膝", desc: "仰躺在地上，雙膝收向胸前，雙手抱住小腿", framing: "全身" },
  { key: "x-back-legs-up", category: "躺臥", name: "仰躺雙腿上舉", desc: "仰躺在地上，雙腿併攏向正上方伸直，雙手放在身側", framing: "全身" },
  { key: "x-side-reach", category: "躺臥", name: "側躺伸展", desc: "側躺在地上，雙臂向頭頂方向伸直，身體拉長成弧線", framing: "全身" },
  { key: "x-elbow-knee", category: "躺臥", name: "肘撐半躺單膝立", desc: "仰面用雙肘撐起上身半躺，一膝立起、一腿伸直", framing: "全身" },
  { key: "x-bend-knees", category: "伸展", name: "前彎手扶膝", desc: "站立向前彎腰，雙手扶在膝蓋上，抬頭看向前方", framing: "全身" },
  { key: "x-bend-shins", category: "伸展", name: "前彎手觸小腿", desc: "站立向前彎腰，雙手觸碰小腿，背部拉長", framing: "全身" },
  { key: "x-fold", category: "伸展", name: "站姿前屈", desc: "站立雙腿伸直向前折疊，雙手掌貼地", framing: "全身" },
  { key: "x-bend-arms", category: "伸展", name: "前彎垂臂", desc: "站立向前彎腰，雙臂放鬆自然下垂", framing: "全身" },
  { key: "x-bend-leg", category: "伸展", name: "前彎後抬腿", desc: "站立向前彎腰，一腿向後抬起與地面平行，雙臂向兩側打開", framing: "全身" },
  { key: "x-backbend", category: "伸展", name: "站姿後彎", desc: "站立，雙手扶在後腰，上身向後彎", framing: "全身" },
  { key: "x-backbend-arms", category: "伸展", name: "舉臂後彎", desc: "站立，雙臂高舉過頭，上身向後彎成弧線", framing: "全身" },
  { key: "x-twist-stand", category: "伸展", name: "站姿扭轉", desc: "站立，上身向一側扭轉，雙臂向兩側平舉打開", framing: "全身" },
  { key: "x-twist-sit", category: "伸展", name: "坐姿扭轉", desc: "盤腿坐在地上，上身向一側扭轉，一手放在對側膝蓋、一手在身後撐地", framing: "全身" },
  { key: "x-overhead-twist", category: "伸展", name: "舉臂扭腰", desc: "站立，雙臂高舉過頭交握，腰部向一側扭轉", framing: "全身" },
  { key: "x-i-balance", category: "伸展", name: "I 字平衡", desc: "單腳站立，另一腿向上伸直抬到肩膀高度，同側手握住腳踝", framing: "全身" },
  { key: "x-side-leg", category: "伸展", name: "側抬腿平衡", desc: "單腳站立，另一腿向側邊高高抬起，雙臂張開保持平衡", framing: "全身" },
  { key: "x-standing-split", category: "伸展", name: "站立分腿", desc: "站立向前折疊、雙手撐地，一腿向後上方高高抬起", framing: "全身" },
  { key: "x-cat-cow", category: "伸展", name: "四足跪姿", desc: "雙手雙膝著地的四足跪姿，背部微微下沉、抬頭看向前方", framing: "全身" },
  { key: "x-donkey", category: "伸展", name: "四足跪後抬腿", desc: "雙手雙膝著地的四足跪姿，一腿向後伸直抬高", framing: "全身" },
  { key: "x-puppy", category: "伸展", name: "伸展嬰兒式", desc: "雙膝跪地，雙臂向前伸直、胸口貼近地面，臀部在膝蓋正上方", framing: "全身" },
  { key: "x-cobra", category: "伸展", name: "眼鏡蛇式", desc: "趴在地上，雙手撐地把上身推起向後彎，雙腿伸直貼地", framing: "全身" },
  { key: "x-camel", category: "伸展", name: "駱駝式", desc: "雙膝跪地、大腿直立，上身向後彎，雙手握住腳跟", framing: "全身" },
  { key: "x-camel-one", category: "伸展", name: "跪姿單手後彎", desc: "雙膝跪地、大腿直立，上身向後彎，一手伸向腳跟、一手向上伸展", framing: "全身" },
  { key: "x-kneel-back", category: "伸展", name: "跪姿後撐", desc: "雙膝跪地，雙手在身後撐地，上身向後仰、挺胸", framing: "全身" },
  { key: "x-bridge", category: "伸展", name: "橋式", desc: "仰躺，雙腳踩地把臀部抬高成橋式，雙手放在身側", framing: "全身" },
  { key: "x-bridge-leg", category: "伸展", name: "單腳橋式", desc: "仰躺，雙腳踩地把臀部抬高成橋式，一腿向天花板伸直", framing: "全身" },
  { key: "x-wheel", category: "伸展", name: "輪式", desc: "雙手雙腳撐地、身體向上拱起的輪式後彎", framing: "全身" },
  { key: "x-table", category: "伸展", name: "反向桌式", desc: "面朝上，雙手雙腳撐地、軀幹抬平與地面平行的反向桌式", framing: "全身" },
  { key: "x-plow", category: "伸展", name: "犁式", desc: "仰躺，雙腿併攏越過頭頂、腳尖觸地，雙手在背後伸直貼地", framing: "全身" },
  { key: "x-shoulder-stand", category: "伸展", name: "肩立式", desc: "仰躺用肩膀支撐，雙手扶腰，雙腿併攏向正上方伸直", framing: "全身" },
  { key: "x-front-split", category: "伸展", name: "前後劈腿", desc: "在地上前後劈腿坐下，上身直立、雙臂向上伸展", framing: "全身" },
  { key: "x-side-split", category: "伸展", name: "左右劈腿", desc: "在地上左右劈腿坐下，上身直立、雙手在身前撐地", framing: "全身" },
  { key: "x-heart-chest", category: "半身手勢", name: "胸前比愛心", desc: "雙手在胸前合成愛心形狀", framing: "半身" },
  { key: "x-heart-head", category: "半身手勢", name: "頭頂大愛心", desc: "雙臂在頭頂上方圍成一個大愛心", framing: "半身" },
  { key: "x-finger-heart", category: "半身手勢", name: "臉旁指愛心", desc: "一手在臉頰旁用拇指與食指比出小愛心", framing: "半身" },
  { key: "x-peace-chin", category: "半身手勢", name: "下巴雙 V", desc: "雙手在下巴下方比出兩個 V 字手勢", framing: "半身" },
  { key: "x-peace-back", category: "半身手勢", name: "反手 V", desc: "一手在臉旁比 V 字，手背朝向鏡頭", framing: "半身" },
  { key: "x-fists-cheeks", category: "半身手勢", name: "握拳貼臉", desc: "雙手握拳貼在兩側臉頰，肩膀微微聳起", framing: "半身" },
  { key: "x-bunny", category: "半身手勢", name: "兔耳手勢", desc: "雙手舉在頭頂兩側，手掌向前像兔耳朵", framing: "半身" },
  { key: "x-cat-paw", category: "半身手勢", name: "招財貓手", desc: "一手舉到臉旁、手腕彎曲握成貓掌", framing: "半身" },
  { key: "x-roar", category: "半身手勢", name: "張爪手勢", desc: "雙手舉到臉旁，手指彎曲像爪子", framing: "半身" },
  { key: "x-shush", category: "半身手勢", name: "噓手勢", desc: "食指豎起放在嘴唇前", framing: "半身" },
  { key: "x-cover-eye", category: "半身手勢", name: "歪頭遮單眼", desc: "頭歪向一側，一手手掌遮住一隻眼睛", framing: "半身" },
  { key: "x-kiss", category: "半身手勢", name: "飛吻", desc: "一手手掌從嘴邊向前送出飛吻", framing: "半身" },
  { key: "x-flower", category: "半身手勢", name: "雙掌托臉", desc: "雙手手腕併攏、手掌打開托住下巴，像一朵花", framing: "半身" },
  { key: "x-poke", category: "半身手勢", name: "食指戳臉頰", desc: "一手食指輕戳自己的臉頰", framing: "半身" },
  { key: "x-cover-mouth", category: "半身手勢", name: "雙手遮嘴", desc: "雙手交疊遮在嘴前，肩膀微微聳起", framing: "半身" },
  { key: "x-please", category: "半身手勢", name: "拜託手勢", desc: "雙手在臉前合掌，頭微微低下", framing: "半身" },
  { key: "x-frame", category: "半身手勢", name: "手指取景框", desc: "雙手拇指與食指在臉前框出一個長方形取景框", framing: "半身" },
  { key: "x-salute", category: "半身手勢", name: "敬禮", desc: "一手舉到額側敬禮", framing: "半身" },
  { key: "x-point", category: "半身手勢", name: "指向鏡頭", desc: "一手食指向前指向鏡頭", framing: "半身" },
  { key: "x-yawn", category: "半身手勢", name: "打呵欠伸懶腰", desc: "一手握拳向上伸懶腰，另一手遮在嘴前", framing: "半身" },
  { key: "x-peek", category: "半身手勢", name: "指縫偷看", desc: "雙手遮住臉，從張開的指縫間向外看", framing: "半身" },
  { key: "x-chin-back", category: "半身手勢", name: "下巴靠手背", desc: "身體微微前傾，下巴靠在交疊的手背上", framing: "半身" },
  { key: "x-elbow-chin", category: "半身手勢", name: "手肘靠膝托腮", desc: "坐姿，手肘靠在膝上、手托著臉頰，上身前傾", framing: "半身" },
  { key: "x-collarbone", category: "半身手勢", name: "雙手放鎖骨", desc: "雙手輕放在鎖骨兩側，抬頭看向上方的鏡頭", framing: "半身" },
  { key: "x-hug", category: "雙人", name: "相擁", desc: "兩人面對面站立擁抱，一人雙手環抱對方的背，另一人雙手環抱對方的肩", framing: "全身", people: 2 },
  { key: "x-hug-tiptoe", category: "雙人", name: "踮腳擁抱", desc: "兩人面對面站立擁抱，較矮的一人踮起腳尖、一腳小腿向後勾起", framing: "全身", people: 2 },
  { key: "x-whisper", category: "雙人", name: "耳語", desc: "兩人並肩站立，一人側身靠近對方耳邊說悄悄話、一手輕扶對方肩膀", framing: "全身", people: 2 },
  { key: "x-hug-behind", category: "雙人", name: "背後環抱", desc: "兩人同向站立，後方的人從背後環抱前方的人的肩膀，頭靠在對方肩上", framing: "全身", people: 2 },
  { key: "x-carry", category: "雙人", name: "公主抱", desc: "一人站立，雙手把另一人橫抱在胸前，被抱的人一手環著對方的脖子", framing: "全身", people: 2 },
  { key: "x-back-to-back", category: "雙人", name: "背靠背", desc: "兩人背靠背站立，雙手抱胸，頭微微轉向鏡頭", framing: "全身", people: 2 },
  { key: "x-hand-in-hand", category: "雙人", name: "牽手並肩", desc: "兩人並肩站立、牽著手，身體微微朝向對方", framing: "全身", people: 2 },
  { key: "x-lap-side", category: "雙人", name: "並肩坐靠肩", desc: "兩人並肩坐在地上，一人把頭靠在另一人的肩膀上", framing: "全身", people: 2 },
];

const POSE_STYLE_TWO =
  "兩個中性、沒有五官細節、沒有頭髮與服裝的白色素體人偶（藝用人體模型），啞光白色材質，關節線條清楚，比例為成年人，其中一個略高。" +
  "純淺灰色無縫背景，柔和均勻的棚燈，有淡淡的接觸陰影。置中，周圍留白。不要任何文字、標籤、箭頭或邊框。";

/** The combined poses were cut to this many when the library was first built; kept so their ids never change. */
const COMBINED_POSE_COUNT = 1439;

function poseEntries(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const combined = poseGroups();
  [...combined, ...EXTRA_POSES].forEach((group, i) => {
    POSE_VIEWS.forEach((view, v) => {
      if (i < combined.length && i * POSE_VIEWS.length + v >= COMBINED_POSE_COUNT) return;
      const framing = group.framing === "半身" ? "腰部以上的半身入鏡" : "全身完整入鏡";
      const POSE_STYLE = group.people === 2 ? POSE_STYLE_TWO : POSE_STYLE_ONE;
      out.push({
        id: `pose:${group.key}:${view.key}`,
        library: "pose",
        category: group.category,
        name: `${group.name}・${view.name}`,
        prompt: `${POSE_STYLE}${framing}。人偶的姿勢：${group.desc}。${view.desc}。`,
        adult: false,
        size: "1024x1536",
        transparent: false,
        usage: group.desc,
        tags: [group.category, group.framing, view.name, ...group.name.split("・")],
        sortOrder: i * 10 + v,
      });
    });
  });
  return out;
}

/* ───────────────────────── costumes: 52 outfits × 8 palettes × 8 details ───────────────────────── */

type CostumeGroup = { key: string; label: string; adult: boolean; outfits: Opt[]; palettes: Opt[] };

const PALETTES: Record<string, Opt[]> = {
  soft: [
    { key: "cream", name: "奶油白", desc: "奶油白與淺米色" },
    { key: "pink", name: "櫻花粉", desc: "柔和的櫻花粉與白色" },
    { key: "mint", name: "薄荷綠", desc: "薄荷綠與米白色" },
    { key: "sky", name: "天空藍", desc: "淺天空藍與白色" },
    { key: "lilac", name: "丁香紫", desc: "丁香紫與奶油白" },
    { key: "butter", name: "奶油黃", desc: "奶油黃與白色" },
    { key: "oat", name: "燕麥色", desc: "燕麥色與淺棕色" },
    { key: "blush", name: "裸粉", desc: "裸粉色與淺灰色" },
  ],
  bright: [
    { key: "white", name: "純白", desc: "純白色" },
    { key: "lemon", name: "檸檬黃", desc: "檸檬黃與白色" },
    { key: "navy", name: "海軍藍", desc: "海軍藍與白色" },
    { key: "coral", name: "珊瑚橘", desc: "珊瑚橘與米色" },
    { key: "aqua", name: "湖水綠", desc: "湖水綠與白色" },
    { key: "red", name: "番茄紅", desc: "番茄紅與白色" },
    { key: "denim", name: "丹寧藍", desc: "丹寧藍與白色" },
    { key: "sand", name: "沙色", desc: "沙色與卡其色" },
  ],
  earth: [
    { key: "camel", name: "駝色", desc: "駝色與奶茶色" },
    { key: "olive", name: "橄欖綠", desc: "橄欖綠與卡其色" },
    { key: "wine", name: "酒紅", desc: "酒紅色與深棕色" },
    { key: "mustard", name: "芥末黃", desc: "芥末黃與深咖啡色" },
    { key: "rust", name: "鐵鏽橘", desc: "鐵鏽橘與米色" },
    { key: "choco", name: "巧克力棕", desc: "巧克力棕與駝色" },
    { key: "teal", name: "墨綠藍", desc: "墨綠藍與深灰色" },
    { key: "taupe", name: "灰褐", desc: "灰褐色與象牙白" },
  ],
  dark: [
    { key: "black", name: "經典黑", desc: "黑色與炭灰色" },
    { key: "gray", name: "霧灰", desc: "淺灰與白色" },
    { key: "ivory", name: "象牙白", desc: "象牙白與米色" },
    { key: "forest", name: "森林綠", desc: "深森林綠與黑色" },
    { key: "navy", name: "深藍", desc: "深藍色與灰色" },
    { key: "burgundy", name: "勃艮第紅", desc: "勃艮第紅與黑色" },
    { key: "camel", name: "駝色", desc: "駝色與黑色" },
    { key: "plum", name: "梅紫", desc: "梅紫色與深灰色" },
  ],
  formal: [
    { key: "black", name: "黑", desc: "黑色" },
    { key: "champagne", name: "香檳金", desc: "香檳金色" },
    { key: "red", name: "正紅", desc: "正紅色" },
    { key: "emerald", name: "祖母綠", desc: "祖母綠色" },
    { key: "navy", name: "午夜藍", desc: "午夜藍色" },
    { key: "silver", name: "銀灰", desc: "銀灰色" },
    { key: "white", name: "珍珠白", desc: "珍珠白色" },
    { key: "rose", name: "玫瑰粉", desc: "玫瑰粉色" },
  ],
  sport: [
    { key: "black", name: "黑", desc: "黑色配白色線條" },
    { key: "gray", name: "灰", desc: "麻灰色" },
    { key: "pink", name: "粉", desc: "粉紅色配白色" },
    { key: "blue", name: "藍", desc: "寶藍色配白色" },
    { key: "white", name: "白", desc: "白色配黑色線條" },
    { key: "green", name: "綠", desc: "鼠尾草綠配米白色" },
    { key: "purple", name: "紫", desc: "薰衣草紫配白色" },
    { key: "orange", name: "橘", desc: "亮橘色配深灰色" },
  ],
};

const COSTUME_DETAILS: Opt[] = [
  { key: "plain", name: "素面", desc: "素面布料，沒有圖案" },
  { key: "stripe", name: "細條紋", desc: "帶有細條紋圖案" },
  { key: "check", name: "格紋", desc: "帶有格紋圖案" },
  { key: "dot", name: "波點", desc: "帶有小波點圖案" },
  { key: "lace", name: "蕾絲細節", desc: "領口與袖口有蕾絲細節" },
  { key: "embroid", name: "刺繡細節", desc: "胸前或下襬有精緻的刺繡細節" },
  { key: "block", name: "拼色", desc: "採用兩色拼接的設計" },
  { key: "texture", name: "肌理布料", desc: "使用有明顯織紋肌理的布料" },
];

const COSTUME_GROUPS: CostumeGroup[] = [
  {
    key: "spring", label: "春裝", adult: false, palettes: PALETTES.soft, outfits: [
      { key: "knit-skirt", name: "針織衫配百褶裙", desc: "短版針織開襟衫、內搭白色上衣、百褶短裙、白色短襪與小白鞋" },
      { key: "trench", name: "風衣外套造型", desc: "長版風衣外套、細肩帶上衣、直筒牛仔褲、樂福鞋與小肩背包" },
      { key: "floral-dress", name: "長洋裝配針織外套", desc: "及小腿的長洋裝、薄針織外套、編織草帽與瑪莉珍鞋" },
      { key: "shirt-jeans", name: "襯衫配牛仔褲", desc: "寬鬆襯衫、高腰直筒牛仔褲、帆布鞋與帆布托特包" },
      { key: "cardigan-dress", name: "開襟衫配吊帶裙", desc: "長版開襟毛衣、細肩帶緞面中長裙與芭蕾平底鞋" },
      { key: "denim-jacket", name: "牛仔外套造型", desc: "短版牛仔外套、白色 T 恤、棉質長裙與白色運動鞋" },
      { key: "blouse-shorts", name: "荷葉邊上衣配短褲", desc: "荷葉邊雪紡上衣、高腰西裝短褲、涼鞋與鏈條小包" },
      { key: "hoodie", name: "連帽衫休閒", desc: "寬鬆連帽衫、運動短裙、中筒襪與厚底運動鞋" },
    ],
  },
  {
    key: "summer", label: "夏裝", adult: false, palettes: PALETTES.bright, outfits: [
      { key: "tank-shorts", name: "背心配牛仔短褲", desc: "細肩帶背心、高腰牛仔短褲、涼鞋與草編包" },
      { key: "sundress", name: "細肩帶洋裝", desc: "細肩帶棉質短洋裝、寬簷草帽與綁帶涼鞋" },
      { key: "linen-set", name: "亞麻套裝", desc: "亞麻短袖襯衫與同色寬褲的套裝、平底涼鞋" },
      { key: "tee-skirt", name: "T 恤配牛仔裙", desc: "短版 T 恤、A 字牛仔短裙、帆布鞋與棒球帽" },
      { key: "off-shoulder", name: "一字領上衣", desc: "一字領平口上衣、高腰長裙與楔型涼鞋" },
      { key: "polo-skort", name: "網球風", desc: "短袖 Polo 衫、網球百褶褲裙、白襪與白色運動鞋、遮陽帽" },
      { key: "romper", name: "連身褲", desc: "無袖連身短褲、腰間綁帶、平底涼鞋與小側背包" },
      { key: "maxi", name: "度假長洋裝", desc: "飄逸的度假風長洋裝、編織手提包與夾腳涼鞋" },
    ],
  },
  {
    key: "autumn", label: "秋裝", adult: false, palettes: PALETTES.earth, outfits: [
      { key: "blazer", name: "西裝外套造型", desc: "寬肩西裝外套、高領針織上衣、直筒長褲與樂福鞋" },
      { key: "sweater-skirt", name: "毛衣配長裙", desc: "寬鬆麻花毛衣、百褶長裙、短靴與托特包" },
      { key: "leather-jacket", name: "皮衣外套造型", desc: "短版皮衣外套、白色 T 恤、窄管褲與短靴" },
      { key: "vest-shirt", name: "針織背心疊穿", desc: "V 領針織背心疊穿白襯衫、及膝裙、及膝襪與樂福鞋" },
      { key: "cord-set", name: "燈芯絨套裝", desc: "燈芯絨襯衫外套與同色寬褲、內搭 T 恤與帆布鞋" },
      { key: "knit-dress", name: "針織洋裝", desc: "合身針織長洋裝、長版大衣披在肩上、長靴" },
      { key: "bomber", name: "飛行外套造型", desc: "飛行夾克、連帽上衣、工裝褲與厚底運動鞋" },
      { key: "wool-coat", name: "羊毛大衣造型", desc: "中長版羊毛大衣、高領毛衣、九分褲與踝靴、圍巾" },
    ],
  },
  {
    key: "winter", label: "冬裝", adult: false, palettes: PALETTES.dark, outfits: [
      { key: "down", name: "羽絨外套造型", desc: "短版羽絨外套、高領毛衣、直筒褲與雪靴、毛線帽" },
      { key: "long-coat", name: "長版大衣", desc: "長版羊毛大衣、針織洋裝、過膝長靴與皮手套" },
      { key: "teddy", name: "泰迪熊外套", desc: "毛絨泰迪熊外套、高領內搭、牛仔褲與馬丁靴" },
      { key: "turtleneck", name: "高領毛衣配長裙", desc: "厚針織高領毛衣、毛呢長裙、褲襪與短靴" },
      { key: "duffle", name: "牛角扣大衣", desc: "牛角扣大衣、針織毛衣、及膝裙、厚褲襪與樂福鞋、圍巾" },
      { key: "puffer-vest", name: "鋪棉背心疊穿", desc: "鋪棉背心疊穿連帽衫、束口褲與運動鞋" },
      { key: "cape", name: "斗篷外套", desc: "羊毛斗篷外套、合身長褲、高跟短靴與貝蕾帽" },
      { key: "shearling", name: "羊羔毛外套", desc: "麂皮羊羔毛外套、針織上衣、直筒牛仔褲與踝靴" },
    ],
  },
  {
    key: "formal", label: "禮服派對", adult: false, palettes: PALETTES.formal, outfits: [
      { key: "slip-gown", name: "緞面長禮服", desc: "細肩帶緞面長禮服、高跟涼鞋與晚宴手拿包" },
      { key: "cocktail", name: "小禮服", desc: "合身及膝小禮服、尖頭高跟鞋與珍珠耳環" },
      { key: "suit", name: "褲裝西裝", desc: "合身西裝外套與同色西裝長褲、絲質內搭與尖頭高跟鞋" },
      { key: "sequin", name: "亮片短洋裝", desc: "亮片短洋裝、細跟高跟鞋與小型鏈條包" },
      { key: "tulle", name: "紗裙禮服", desc: "平口上身搭配多層紗裙的禮服、緞面高跟鞋" },
      { key: "qipao", name: "改良式旗袍", desc: "立領盤扣的改良式旗袍、低跟鞋" },
    ],
  },
  {
    key: "sport", label: "運動休閒", adult: false, palettes: PALETTES.sport, outfits: [
      { key: "yoga", name: "瑜珈服", desc: "運動背心式上衣、高腰緊身瑜珈褲與運動鞋" },
      { key: "running", name: "慢跑裝", desc: "排汗短袖上衣、運動短褲、慢跑鞋與運動帽" },
      { key: "tracksuit", name: "運動套裝", desc: "立領運動外套與同色運動長褲的套裝、運動鞋" },
      { key: "hoodie-set", name: "衛衣套裝", desc: "寬鬆連帽衛衣與同色束口棉褲、厚底運動鞋" },
      { key: "outdoor", name: "戶外機能", desc: "防風機能外套、機能長褲、登山鞋與後背包" },
      { key: "dance", name: "舞蹈練習服", desc: "短版寬鬆 T 恤、寬鬆工裝褲與高筒帆布鞋" },
    ],
  },
  {
    key: "sleep", label: "居家睡衣", adult: true, palettes: PALETTES.soft, outfits: [
      { key: "pajama", name: "緞面睡衣套裝", desc: "緞面襯衫式睡衣上衣與同色長褲、絨毛拖鞋" },
      { key: "robe", name: "浴袍", desc: "棉質長版浴袍與綁帶、室內拖鞋" },
      { key: "camisole-set", name: "細肩帶家居服", desc: "細肩帶背心與同色短褲的家居服套裝" },
      { key: "nightdress", name: "棉質睡裙", desc: "寬鬆棉質睡裙、薄針織外套與室內拖鞋" },
    ],
  },
  {
    key: "swim", label: "泳裝", adult: true, palettes: PALETTES.bright, outfits: [
      { key: "one-piece", name: "連身泳裝", desc: "連身泳裝、罩衫與草帽、夾腳拖" },
      { key: "two-piece", name: "兩件式泳裝", desc: "兩件式泳裝、沙灘巾與太陽眼鏡、涼鞋" },
      { key: "rashguard", name: "防曬泳裝", desc: "長袖防磨衣與泳褲、遮陽帽" },
      { key: "cover-up", name: "泳裝罩衫造型", desc: "泳裝外搭鏤空針織罩衫長裙、編織包與涼鞋" },
    ],
  },
];

/**
 * Adult-only outfits added after the library was first built (管理員才看得到).
 * Clothing only, no person; one plain version per colour. Kept apart from
 * COSTUME_GROUPS so the ids of the first 3,224 costumes never change.
 */
const BOUDOIR_PALETTE: Opt[] = [
  { key: "black", name: "黑", desc: "黑色" },
  { key: "wine", name: "酒紅", desc: "酒紅色" },
  { key: "ivory", name: "象牙白", desc: "象牙白色" },
  { key: "blush", name: "裸粉", desc: "裸粉色" },
  { key: "red", name: "正紅", desc: "正紅色" },
  { key: "navy", name: "午夜藍", desc: "午夜藍色" },
  { key: "champagne", name: "香檳金", desc: "香檳金色" },
  { key: "lilac", name: "丁香紫", desc: "丁香紫色" },
];

const ADULT_COSTUME_GROUPS: CostumeGroup[] = [
  {
    key: "lingerie", label: "內衣", adult: true, palettes: BOUDOIR_PALETTE, outfits: [
      { key: "lace-set", name: "蕾絲內衣套裝", desc: "蕾絲胸罩與同款三角內褲的兩件式內衣套裝" },
      { key: "satin-set", name: "緞面內衣套裝", desc: "緞面無鋼圈胸罩與高腰內褲的兩件式內衣套裝" },
      { key: "sport-set", name: "運動內衣套裝", desc: "運動內衣與同色低腰平口內褲" },
      { key: "garter-set", name: "吊帶襪套裝", desc: "蕾絲胸罩、內褲、吊襪帶與大腿襪的四件式套裝" },
      { key: "corset", name: "馬甲", desc: "魚骨束腰馬甲、同色內褲與大腿襪" },
      { key: "bodysuit", name: "連身內衣", desc: "高衩連身蕾絲內衣" },
      { key: "dudou", name: "肚兜", desc: "緞面刺繡肚兜與同色綁帶短褲" },
    ],
  },
  {
    key: "nightwear", label: "性感睡衣", adult: true, palettes: BOUDOIR_PALETTE, outfits: [
      { key: "slip", name: "細肩帶睡裙", desc: "絲質細肩帶短版睡裙，領口與裙襬有蕾絲滾邊" },
      { key: "babydoll", name: "娃娃裝睡衣", desc: "透膚薄紗娃娃裝睡衣與同色內褲" },
      { key: "robe-set", name: "絲質睡袍組", desc: "絲質短版睡袍、腰帶與同色細肩帶睡裙" },
      { key: "shirt", name: "男友襯衫", desc: "寬大的牛津襯衫當睡衣穿，下襬蓋到大腿" },
    ],
  },
  {
    key: "swim-adult", label: "性感泳裝", adult: true, palettes: BOUDOIR_PALETTE, outfits: [
      { key: "triangle", name: "三角比基尼", desc: "綁帶三角比基尼上衣與側綁帶泳褲" },
      { key: "high-cut", name: "高衩連身泳裝", desc: "高衩露背連身泳裝" },
      { key: "bandeau", name: "平口比基尼", desc: "平口比基尼上衣與高腰泳褲" },
      { key: "cutout", name: "鏤空連身泳裝", desc: "腰側鏤空的連身泳裝" },
    ],
  },
  {
    key: "party-adult", label: "派對扮裝", adult: true, palettes: BOUDOIR_PALETTE, outfits: [
      { key: "bunny", name: "兔女郎裝", desc: "緞面無肩帶連身衣、兔耳髮箍、領結、袖扣與網襪、高跟鞋" },
      { key: "maid", name: "女僕裝", desc: "短版女僕洋裝、白色荷葉邊圍裙、頭飾與過膝襪" },
      { key: "qipao", name: "高衩旗袍", desc: "緞面合身旗袍，側邊高衩，搭配高跟鞋" },
      { key: "leather", name: "緊身皮衣套裝", desc: "皮革緊身連身衣、腰帶與長靴" },
      { key: "club", name: "夜店小禮服", desc: "貼身細肩帶短洋裝、細跟高跟鞋與手拿包" },
      { key: "sheer", name: "透膚罩衫造型", desc: "透膚薄紗長罩衫內搭同色系內衣套裝" },
    ],
  },
];

const COSTUME_STYLE =
  "電商服裝去背圖：隱形模特兒（ghost mannequin）呈現的一整套穿搭，從頭到腳完整搭配，正面視角，置中。" +
  "畫面中沒有任何人物、沒有臉、沒有皮膚、沒有人台支架。衣物有自然的立體感與布料質感，柔和均勻的棚燈。背景完全透明。不要任何文字或標籤。";

/** The combined costumes were cut to this many when the library was first built; kept so their ids never change. */
const COMBINED_COSTUME_COUNT = 3224;

function costumeEntries(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  let order = 0;
  // Detail outermost so that trimming to the target removes a few of the
  // last detail's rows instead of emptying one category.
  for (const detail of COSTUME_DETAILS) {
    for (const group of COSTUME_GROUPS) {
      for (const outfit of group.outfits) {
        for (const pal of group.palettes) {
          out.push({
            id: `costume:${group.key}:${outfit.key}:${pal.key}:${detail.key}`,
            library: "costume",
            category: group.label,
            name: `${pal.name}${outfit.name}・${detail.name}`,
            prompt: `${COSTUME_STYLE}這套穿搭：${outfit.desc}。整體配色為${pal.desc}，${detail.desc}。`,
            adult: group.adult,
            size: "1024x1536",
            transparent: true,
            usage: `${outfit.desc}，整體配色為${pal.desc}，${detail.desc}`,
            tags: [group.label, outfit.name, pal.name, detail.name],
            sortOrder: order++,
          });
        }
      }
    }
  }
  const combined = out.slice(0, COMBINED_COSTUME_COUNT);
  for (const group of ADULT_COSTUME_GROUPS) {
    for (const outfit of group.outfits) {
      for (const pal of group.palettes) {
        combined.push({
          id: `costume:${group.key}:${outfit.key}:${pal.key}:plain`,
          library: "costume",
          category: group.label,
          name: `${pal.name}${outfit.name}`,
          prompt: `${COSTUME_STYLE}這套穿搭：${outfit.desc}。整體配色為${pal.desc}，素面布料。`,
          adult: true,
          size: "1024x1536",
          transparent: true,
          usage: `${outfit.desc}，整體配色為${pal.desc}`,
          tags: [group.label, outfit.name, pal.name],
          sortOrder: order++,
        });
      }
    }
  }
  return combined;
}

/* ───────────────────────── portraits: 25 hair × 5 colors × 4 expressions × 3 faces ───────────────────────── */

const HAIR_STYLES: Array<Opt & { gender: "f" | "m" }> = [
  { key: "bob", name: "齊短髮", desc: "下巴長度的齊短髮（bob），髮尾微微內彎", gender: "f" },
  { key: "bob-bangs", name: "齊瀏海短髮", desc: "齊瀏海的短髮，髮長及下巴", gender: "f" },
  { key: "bob-wave", name: "微捲短髮", desc: "帶有自然捲度的短髮，髮長及下巴", gender: "f" },
  { key: "lob", name: "及肩中長髮", desc: "及肩的中長髮（lob），髮尾外翹", gender: "f" },
  { key: "lob-in", name: "內彎鎖骨髮", desc: "髮尾內彎、長度到鎖骨的中長髮", gender: "f" },
  { key: "long-straight", name: "長直髮", desc: "過胸的長直髮，中分", gender: "f" },
  { key: "long-wave", name: "大波浪長髮", desc: "過胸的大波浪長捲髮，側分", gender: "f" },
  { key: "long-bangs", name: "空氣瀏海長髮", desc: "空氣瀏海搭配及胸長髮，髮尾微捲", gender: "f" },
  { key: "long-layer", name: "層次長髮", desc: "有明顯層次的長髮，臉頰兩側有修飾臉型的髮絲", gender: "f" },
  { key: "hime", name: "公主切", desc: "齊瀏海、兩側齊切到下巴、後方留長的公主切", gender: "f" },
  { key: "ponytail", name: "高馬尾", desc: "綁高的馬尾，兩側留鬚鬚瀏海", gender: "f" },
  { key: "low-pony", name: "低馬尾", desc: "鬆鬆綁在後頸的低馬尾，中分", gender: "f" },
  { key: "bun", name: "丸子頭", desc: "鬆鬆的高丸子頭，後頸有碎髮", gender: "f" },
  { key: "half-up", name: "公主頭", desc: "上半部頭髮綁起的半頭造型，下方長髮自然垂放", gender: "f" },
  { key: "braid", name: "側編髮", desc: "一條垂在肩前的鬆散側編辮子", gender: "f" },
  { key: "twin", name: "雙馬尾", desc: "低位的雙馬尾，帶瀏海", gender: "f" },
  { key: "wolf", name: "狼尾剪", desc: "層次分明的狼尾剪（wolf cut），帶瀏海", gender: "f" },
  { key: "pixie", name: "精靈短髮", desc: "俐落的精靈短髮（pixie cut）", gender: "f" },
  { key: "m-short", name: "男・清爽短髮", desc: "兩側推短、上方稍長的清爽短髮", gender: "m" },
  { key: "m-comma", name: "男・逗號瀏海", desc: "韓系逗號瀏海的中短髮", gender: "m" },
  { key: "m-middle", name: "男・中分", desc: "中分的微捲中長髮", gender: "m" },
  { key: "m-buzz", name: "男・平頭", desc: "極短的平頭", gender: "m" },
  { key: "m-perm", name: "男・燙捲髮", desc: "蓬鬆的燙捲短髮，瀏海蓋住額頭", gender: "m" },
  { key: "m-slick", name: "男・油頭", desc: "向後梳整的側分油頭", gender: "m" },
  { key: "m-long", name: "男・及肩長髮", desc: "自然垂落的及肩長髮", gender: "m" },
];

const HAIR_COLORS: Opt[] = [
  { key: "black", name: "黑髮", desc: "自然黑髮" },
  { key: "brown", name: "深棕髮", desc: "深棕色頭髮" },
  { key: "tea", name: "茶色髮", desc: "亞麻茶色頭髮" },
  { key: "ash", name: "霧灰棕髮", desc: "霧面灰棕色頭髮" },
  { key: "honey", name: "蜂蜜金髮", desc: "蜂蜜金棕色頭髮" },
];

const EXPRESSIONS: Opt[] = [
  { key: "neutral", name: "自然", desc: "表情自然放鬆，嘴唇輕閉" },
  { key: "smile", name: "微笑", desc: "溫和的微笑，眼神柔和" },
  { key: "grin", name: "開朗笑", desc: "露齒的開朗笑容，眼睛微彎" },
  { key: "cool", name: "冷靜", desc: "表情冷靜沉著，眼神堅定" },
];

const FACE_SHAPES: Opt[] = [
  { key: "oval", name: "鵝蛋臉", desc: "鵝蛋臉，五官柔和" },
  { key: "round", name: "圓臉", desc: "圓臉，臉頰飽滿，顯得親切" },
  { key: "sharp", name: "瓜子臉", desc: "下顎線條清楚的瓜子臉，五官立體" },
];

function portraitEntries(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  let order = 0;
  // Face shape and expression outermost: trimming to the target then drops a
  // single row rather than a hairstyle.
  for (const face of FACE_SHAPES) {
    for (const exp of EXPRESSIONS) {
      for (const hair of HAIR_STYLES) {
        const person = hair.gender === "m" ? "一位 25 歲左右的東亞成年男性" : "一位 25 歲左右的東亞成年女性";
        for (const color of HAIR_COLORS) {
          out.push({
            id: `portrait:${hair.key}:${color.key}:${exp.key}:${face.key}`,
            library: "portrait",
            category: hair.gender === "m" ? "男性" : "女性",
            name: `${hair.name}・${color.name}・${exp.name}・${face.name}`,
            prompt:
              `寫實攝影的棚拍大頭照：${person}，${face.desc}，${color.desc}，髮型是${hair.desc}。${exp.desc}，正面直視鏡頭，肩膀以上入鏡，素色上衣。` +
              "淺灰色純色背景，柔和均勻的棚燈。皮膚保留自然紋理，不要過度磨皮。不要任何文字。",
            adult: false,
            size: "1024x1024",
            transparent: false,
            usage: `${face.desc}，${color.desc}，${hair.desc}，${exp.desc}`,
            tags: [hair.name, color.name, exp.name, face.name],
            sortOrder: order++,
          });
        }
      }
    }
  }
  return out.slice(0, LIBRARY_TARGETS.portrait);
}

/* ───────────────────────── public API ───────────────────────── */

let cached: CatalogEntry[] | null = null;

export function libraryCatalog(): CatalogEntry[] {
  if (!cached) cached = [...poseEntries(), ...costumeEntries(), ...portraitEntries()];
  return cached;
}

export function catalogCounts(): Record<LibraryId, number> {
  const counts: Record<LibraryId, number> = { pose: 0, costume: 0, portrait: 0 };
  for (const e of libraryCatalog()) counts[e.library]++;
  return counts;
}

import { tr } from "@/lib/i18n";
import { IMAGE_COST } from "@shared/pricing";
import { VaultPicker } from "@/components/VaultPicker";
import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NavigationHeader } from "./account";
import { useUser } from "@/hooks/use-user";
import type { DramaProject, DramaEpisode, DramaScene, CharacterLibraryItem, FourViewUrls } from "@shared/schema";
import { Slider } from "@/components/ui/slider";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter, DrawerClose } from "@/components/ui/drawer";

const nid = () => Math.random().toString(36).slice(2, 10);

// ─── Types ─────────────────────────────────────────────────────────────────────
type View =
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
  | { kind: "episode"; projectId: string; episodeId: string };

const CAMERA_MOVEMENTS = [
  { value: "none", label: tr("不指定") },
  { value: "slow push in, gentle light", label: tr("緩慢推進") },
  { value: "slow zoom out, fade out", label: tr("緩慢拉遠") },
  { value: "pan left, smooth", label: tr("向左平移") },
  { value: "pan right, smooth", label: tr("向右平移") },
  { value: "tilt up, reveal", label: tr("向上移動") },
  { value: "tilt down, settle", label: tr("向下移動") },
  { value: "orbit around subject", label: tr("環繞拍攝") },
  { value: "static, fixed camera", label: tr("固定鏡頭") },
  { value: "handheld, slight shake", label: tr("手持晃動") },
  { value: "drone aerial shot", label: tr("空拍俯視") },
];

const GENRES = [tr("愛情"), tr("動作"), tr("懸疑"), tr("喜劇"), tr("奇幻"), tr("恐怖"), tr("科幻"), tr("歷史"), tr("其他")];
const SIZE_LABELS: Record<string, string> = {
  "9:16": tr("直式 9:16"),
  "16:9": tr("橫式 16:9"),
  "1:1": tr("正方形 1:1"),
};

// ─── Prompt Snippets Library (依 WAN 3.0 提示詞指南分類) ─────────────
type SnippetCategory = {
  key: string; emoji: string; label: string; color: string;
  snippets: { label: string; text: string }[];
};

const PROMPT_SNIPPETS: SnippetCategory[] = [
  {
    key: "lighting", emoji: "💡", label: tr("光線氛圍"), color: "#ca8a04",
    snippets: [
      { label: tr("黃金時刻"), text: tr("黃金時刻溫暖斜陽光，金橘色調，柔和側光") },
      { label: tr("霓虹冷光"), text: tr("賽博龐克霓虹冷光，藍紫光斑反射在臉上") },
      { label: tr("燭光"), text: tr("暖黃燭光搖曳，臉部柔光，背景陰影") },
      { label: tr("逆光剪影"), text: tr("逆光剪影，背景過曝光暈，輪廓清晰") },
      { label: tr("雨夜街燈"), text: tr("雨夜路燈反光在濕潤路面，冷暖對比") },
      { label: tr("晨光透窗"), text: tr("晨光透過窗簾灑入，塵埃飄浮，柔焦") },
      { label: tr("戲劇打光"), text: tr("高反差電影打光，明暗強對比，硬光") },
      { label: tr("辦公冷光"), text: tr("辦公室白冷日光燈，理性科技感氛圍") },
    ],
  },
  {
    key: "camera", emoji: "🎬", label: tr("鏡頭運鏡"), color: "#6366f1",
    snippets: [
      { label: tr("緩慢推進"), text: tr("鏡頭緩慢推進，聚焦人物表情") },
      { label: tr("拉遠揭示"), text: tr("鏡頭緩慢拉遠，揭示更廣場景") },
      { label: tr("特寫"), text: tr("面部特寫，強調眼神情緒") },
      { label: tr("過肩鏡頭"), text: tr("過肩鏡頭，呈現對話張力") },
      { label: tr("低角度"), text: tr("低角度仰拍，營造氣場與壓迫感") },
      { label: tr("俯視"), text: tr("俯視鏡頭，強調孤獨感或全景") },
      { label: tr("環繞"), text: tr("鏡頭環繞主角，動感呈現") },
      { label: tr("手持晃動"), text: tr("手持晃動鏡頭，紀實感與緊張感") },
    ],
  },
  {
    key: "emotion", emoji: "😢", label: tr("情緒表現"), color: "#db2777",
    snippets: [
      { label: tr("憂鬱"), text: tr("她眼眶泛紅，眼神空洞，低頭不語") },
      { label: tr("震驚"), text: tr("他瞳孔微縮，呼吸停頓，難以置信") },
      { label: tr("曖昧"), text: tr("兩人四目相接，呼吸交織，臉頰微紅") },
      { label: tr("憤怒"), text: tr("他緊握雙拳，咬牙切齒，目光如刀") },
      { label: tr("甜蜜"), text: tr("她嘴角上揚，眼神含笑，髮絲輕揚") },
      { label: tr("緊張對峙"), text: tr("兩人對峙，空氣凝結，眼神對視不退") },
      { label: tr("決絕"), text: tr("她決絕轉身，背影堅定，再不回頭") },
      { label: tr("崩潰"), text: tr("他蹲跪在地，雙手掩面，肩膀顫抖") },
    ],
  },
  {
    key: "scene", emoji: "🏠", label: tr("場景類型"), color: "#22c55e",
    snippets: [
      { label: tr("高級辦公室"), text: tr("現代化高級辦公室，落地窗俯瞰城市天際線") },
      { label: tr("雨天街角"), text: tr("雨夜霓虹街角，路面積水反射街燈") },
      { label: tr("咖啡廳窗邊"), text: tr("復古咖啡廳窗邊角落，木質吧台暖光") },
      { label: tr("豪華車內"), text: tr("黑色豪車後座，皮革座椅冷光照明") },
      { label: tr("醫院走廊"), text: tr("白色醫院長廊，冷光日光燈，空曠寂靜") },
      { label: tr("海邊碼頭"), text: tr("黃昏海邊碼頭，海風吹起髮絲，海浪拍岸") },
      { label: tr("華麗宴會"), text: tr("華麗宴會大廳，水晶吊燈，香檳塔") },
      { label: tr("校園走廊"), text: tr("陽光灑落的校園走廊，櫻花飄落，學生身影") },
    ],
  },
  {
    key: "style", emoji: "🎨", label: tr("畫面風格"), color: "#a855f7",
    snippets: [
      { label: tr("電影感"), text: tr("電影感寬銀幕構圖，戲劇性光影分級") },
      { label: tr("韓劇氛圍"), text: tr("韓劇浪漫氛圍，柔焦淡彩，唯美光暈") },
      { label: tr("日漫風"), text: tr("日系動漫風格，鮮明線條，鮮豔色彩") },
      { label: tr("寫實插畫"), text: tr("寫實插畫風格，細膩筆觸，光影豐富") },
      { label: tr("復古港片"), text: tr("復古港片美學，膠片顆粒感，霓虹色調") },
      { label: tr("高級時尚"), text: tr("高級時尚雜誌風格，精緻構圖，極簡奢華") },
      { label: tr("黑白默劇"), text: tr("黑白攝影，高反差，戲劇性陰影") },
      { label: tr("魔幻神秘"), text: tr("魔幻奇幻氛圍，魔法光粒，神秘色彩") },
    ],
  },
];

// ─── Drama Templates (預製短劇範本) ───────────────────────────────────────
type DramaTemplate = {
  key: string; emoji: string; title: string; genre: string; description: string;
  scenes: Array<{ title: string; description: string; dialogue?: string; cameraMovement?: string }>;
};

const DRAMA_TEMPLATES: DramaTemplate[] = [
  {
    key: "ceo_love", emoji: "💼", title: tr("霸總愛情"), genre: tr("愛情"),
    description: tr("霸道總裁愛上小助理的經典套路"),
    scenes: [
      { title: tr("電梯初遇"), description: tr("現代化高級辦公室電梯內，西裝筆挺的男主角低頭看手機，女主角抱著一疊文件慌張衝進電梯，兩人撞個正著文件散落一地。冷光打在兩人臉上，氣氛凝結。"), dialogue: tr("對不起！我不是故意的…"), cameraMovement: "slow push in, gentle light" },
      { title: tr("辦公室對峙"), description: tr("落地窗俯瞰城市夜景的辦公室，男主角坐在大班椅上，神色冷冽地看著站在桌前低頭的女主角。黃金時刻陽光穿過百葉窗，光影斑駁灑在兩人之間。"), dialogue: tr("妳知道這份合約的重要性嗎？"), cameraMovement: "orbit around subject" },
      { title: tr("雨夜接送"), description: tr("傾盆大雨的街頭，女主角獨自撐著破傘等公車，男主角的黑色豪車緩緩停下，車窗降下露出他擔憂的臉。霓虹燈光反射在濕潤路面。"), dialogue: tr("上車，別淋濕了。"), cameraMovement: "tilt up, reveal" },
      { title: tr("餐廳告白"), description: tr("高級法式餐廳包廂，燭光搖曳，男主角從口袋拿出小盒子，眼神溫柔卻緊張地看著女主角。背景虛化，焦點在兩人交握的手。"), dialogue: tr("我認真的，妳願意嗎？"), cameraMovement: "slow push in, gentle light" },
      { title: tr("誤會分手"), description: tr("男主角辦公室外走廊，女主角看到男主角和另一名美麗女子親密交談，瞬間心碎轉身奔跑。冷色調走廊燈光，背影孤獨。"), dialogue: tr("原來我什麼都不是…"), cameraMovement: "pan left, smooth" },
      { title: tr("機場挽回"), description: tr("機場登機口，女主角含淚拖行李準備離開，男主角衝破人群氣喘吁吁地抓住她的手，背景旅客模糊化。"), dialogue: tr("別走！妳就是我的全部！"), cameraMovement: "slow zoom out, fade out" },
    ],
  },
  {
    key: "campus", emoji: "🌸", title: tr("校園青春"), genre: tr("愛情"),
    description: tr("陽光下的純愛校園戀曲"),
    scenes: [
      { title: tr("教室相遇"), description: tr("陽光透過窗戶灑入教室，櫻花瓣飄落，新轉學生女主角站在講台前自我介紹，男主角在窗邊位置抬頭驚訝地看著她。"), dialogue: tr("大家好，請多多指教。"), cameraMovement: "slow push in, gentle light" },
      { title: tr("圖書館巧遇"), description: tr("安靜的圖書館書架間，兩人同時伸手拿同一本書指尖相觸。陽光從高窗斜射，灰塵在光柱中飄浮。"), dialogue: tr("啊！對不起…"), cameraMovement: "static, fixed camera" },
      { title: tr("操場奔跑"), description: tr("黃昏操場跑道，男主角追上前面慢跑的女主角，並肩奔跑歡笑。夕陽金光灑在兩人身上，背景模糊。"), dialogue: tr("妳跑得真快！"), cameraMovement: "pan right, smooth" },
      { title: tr("雨中共傘"), description: tr("突如其來的午後雷陣雨，校園走廊外，男主角將傘傾向女主角，自己肩膀濕透。她臉頰泛紅低頭。"), dialogue: tr("妳會感冒的…"), cameraMovement: "slow zoom out, fade out" },
      { title: tr("天台告白"), description: tr("黃昏校園天台，男主角站在風中，女主角驚訝地走上來。橘紅色夕陽染滿天空，髮絲飛揚。"), dialogue: tr("我喜歡妳，從第一眼開始。"), cameraMovement: "orbit around subject" },
      { title: tr("畢業典禮"), description: tr("畢業典禮後的櫻花樹下，兩人穿著畢業服相擁而笑，櫻花瓣紛飛。柔焦溫暖光影，唯美如夢。"), dialogue: tr("謝謝你，陪我度過最美的青春。"), cameraMovement: "slow zoom out, fade out" },
    ],
  },
  {
    key: "revenge", emoji: "🔪", title: tr("復仇懸疑"), genre: tr("懸疑"),
    description: tr("蛻變歸來的復仇之路"),
    scenes: [
      { title: tr("悲慘往事"), description: tr("陰暗潮濕地下室，年輕女主角蜷縮在角落啜泣，臉上有淚痕和傷痕。冷藍色月光從鐵窗縫隙灑入，氣氛陰鬱壓抑。"), dialogue: tr("我絕不會放過你們…"), cameraMovement: "slow push in, gentle light" },
      { title: tr("華麗歸來"), description: tr("三年後高級飯店大廳，蛻變後的女主角穿著黑色禮服緩緩走下樓梯，紅唇冷艷，眼神犀利。水晶吊燈閃爍，眾人側目。"), dialogue: tr("好久不見，各位。"), cameraMovement: "tilt up, reveal" },
      { title: tr("首次交鋒"), description: tr("高級餐廳包廂，女主角優雅地舉起紅酒杯，對面坐著當年的仇人，臉色驟變。燭光晃動，氣氛凝結。"), dialogue: tr("你應該還記得我吧？"), cameraMovement: "static, fixed camera" },
      { title: tr("佈局陷阱"), description: tr("深夜辦公室，女主角站在落地窗前看著城市夜景，手中握著關鍵證據U盤。冷光城市燈火映照，剪影神秘。"), dialogue: tr("棋局已經開始了。"), cameraMovement: "pan left, smooth" },
      { title: tr("真相揭露"), description: tr("豪華記者會現場，女主角站在台上將證據投影在大螢幕上，台下記者譁然騷動。鎂光燈閃爍。"), dialogue: tr("這就是真相，無可辯駁。"), cameraMovement: "slow zoom out, fade out" },
      { title: tr("復仇結局"), description: tr("雨夜頂樓天台，仇人跪地哀求，女主角冷冷俯視。背景閃電交加，雨水滂沱，氣氛壓迫。"), dialogue: tr("晚了，這就是你的代價。"), cameraMovement: "orbit around subject" },
    ],
  },
  {
    key: "isekai", emoji: "🌌", title: tr("穿越奇幻"), genre: tr("奇幻"),
    description: tr("穿越異世界的奇幻冒險"),
    scenes: [
      { title: tr("意外穿越"), description: tr("現代都市夜晚街頭，女主角過馬路時被閃電擊中，身體發出金光被吸入時空漩渦。背景城市光線扭曲變形。"), dialogue: tr("這…這是怎麼回事？"), cameraMovement: "orbit around subject" },
      { title: tr("異世界醒來"), description: tr("古樸森林空地，女主角穿著現代服裝醒來，周圍是高聳古樹和奇幻光點。陽光透過樹葉灑下斑駁光影，神秘氛圍。"), dialogue: tr("我在哪裡…"), cameraMovement: "tilt up, reveal" },
      { title: tr("邂逅王子"), description: tr("森林小溪邊，神秘銀髮男子騎白馬出現，目光驚訝地看著倒在地上的女主角。藍紫色魔法光點圍繞。"), dialogue: tr("妳是什麼人？"), cameraMovement: "slow push in, gentle light" },
      { title: tr("魔法覺醒"), description: tr("古老石塔頂端，女主角伸手間爆發出耀眼金色光芒，魔法符文圍繞她旋轉。背景天空閃電轟鳴。"), dialogue: tr("原來這就是我的力量！"), cameraMovement: "slow zoom out, fade out" },
      { title: tr("決戰魔王"), description: tr("崩塌的城堡廢墟戰場，女主角和男主角並肩持劍對峙巨大魔王陰影。火焰魔法光環四射。"), dialogue: tr("為了這個世界！"), cameraMovement: "orbit around subject" },
      { title: tr("回到現實"), description: tr("現代都市公園長椅，女主角醒來陽光燦爛，恍若一場夢。低頭發現手中握著異世界的銀色項鍊。"), dialogue: tr("原來…不是夢…"), cameraMovement: "slow zoom out, fade out" },
    ],
  },
  {
    key: "office", emoji: "🏢", title: tr("職場逆襲"), genre: tr("其他"),
    description: tr("小職員的職場逆襲記"),
    scenes: [
      { title: tr("被嘲諷"), description: tr("現代辦公室茶水間，女主角端著咖啡被同事們嘲笑奚落，她低頭強忍淚水。冷白色日光燈，背景虛化。"), dialogue: tr("她連這種小事都做不好。"), cameraMovement: "static, fixed camera" },
      { title: tr("深夜加班"), description: tr("空無一人的辦公室深夜，女主角獨自在電腦前認真工作，桌面只有一盞檯燈和一杯冷掉的咖啡。"), dialogue: tr("我一定要證明自己。"), cameraMovement: "slow push in, gentle light" },
      { title: tr("提案展示"), description: tr("高級會議室，女主角自信地站在投影幕前展示提案，老闆和高管們專注聆聽。落地窗外城市天際線。"), dialogue: tr("這是我準備的方案。"), cameraMovement: "orbit around subject" },
      { title: tr("拿下大案"), description: tr("辦公室角落，女主角接到電話露出震驚又激動的表情，手中緊握合約。陽光從窗外灑入背影輝煌。"), dialogue: tr("真的嗎？我們拿下了！"), cameraMovement: "slow zoom out, fade out" },
      { title: tr("晉升宣布"), description: tr("公司大會議室，老闆在台上宣布女主角晉升，全場鼓掌，先前嘲諷她的同事們臉色尷尬。"), dialogue: tr("恭喜妳，新任部門總監。"), cameraMovement: "tilt up, reveal" },
      { title: tr("夜景敬酒"), description: tr("高樓頂層酒吧落地窗前，女主角獨自舉起香檳杯，俯瞰整座城市燈火。霓虹倒映在杯中，氣場全開。"), dialogue: tr("這只是開始。"), cameraMovement: "pan left, smooth" },
    ],
  },
];

function getSceneImageUrl(s: DramaScene) { return s.bunnyUrl || s.imageUrl || null; }
function getSceneVideoUrl(s: DramaScene) { return s.videoBunnyUrl || s.videoUrl || null; }

async function uploadToObjectStorage(file: File): Promise<string> {
  const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
  const { uploadURL } = await uploadRes.json();
  const putRes = await fetch(uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!putRes.ok) throw new Error(tr("上傳失敗"));
  const pathRes = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
  const { objectPath } = await pathRes.json();
  return objectPath as string;
}

// ─── Shared styles ─────────────────────────────────────────────────────────────
const S = {
  root: "min-h-screen flex flex-col",
  page: "flex-1 bg-[#f8fafc] text-[#0f172a]",
};

// ─── Small helpers ──────────────────────────────────────────────────────────────
function Spinner({ color = "#6366f1" }: { color?: string }) {
  return (
    <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin mx-auto"
      style={{ borderColor: `${color}44`, borderTopColor: color }} />
  );
}

function DarkButton({
  children, onClick, disabled, className = "", variant = "primary", style,
}: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  className?: string; variant?: "primary" | "secondary" | "danger" | "ghost";
  style?: React.CSSProperties;
}) {
  const base = "px-3 py-1.5 rounded-lg text-sm font-medium transition-all focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed";
  const variants = {
    primary:   "bg-indigo-600 hover:bg-[#4338ca] text-white",
    secondary: "bg-[#e2e8f0] hover:bg-[#f1f5f9] border border-[#cbd5e1] text-[#334155]",
    danger:    "bg-[#ef4444]/10 hover:bg-[#ef4444]/20 border border-[#ef4444]/30 text-[#dc2626]",
    ghost:     "hover:bg-[#e2e8f0] text-[#64748b] hover:text-[#334155]",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

function DarkInput({
  value, onChange, placeholder, className = "",
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-[#0f172a] text-sm
        placeholder-[#94a3b8] focus:outline-none focus:border-indigo-500 transition-colors ${className}`}
    />
  );
}

function DarkTextarea({
  value, onChange, placeholder, rows = 3, className = "",
}: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; className?: string }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-[#0f172a] text-sm
        placeholder-[#94a3b8] focus:outline-none focus:border-indigo-500 transition-colors resize-none ${className}`}
    />
  );
}

function DarkSelect({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-[#0f172a] text-sm
        focus:outline-none focus:border-indigo-500 transition-colors"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Modal({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#ffffff] border border-[#cbd5e1] rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-[#0f172a]">{title}</h3>
          <button onClick={onClose} className="text-[#64748b] hover:text-[#334155] text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Chain-mode custom continuity reference uploader ─────────────────────────
function ChainRefCustomUploader({
  customUrl, onChange,
}: {
  customUrl?: string;
  onChange: (url: string) => void;
}) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadToObjectStorage(file);
      onChange(path);
      toast({ title: tr("已設定自訂銜接圖") });
    } catch {
      toast({ title: tr("上傳失敗"), variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-[10px] text-[#64748b] uppercase tracking-wide">
        {tr("自訂銜接圖（會優先於上方來源）")}
      </label>
      <div className="flex items-center gap-2">
        {customUrl ? (
          <>
            <img
              src={customUrl}
              alt={tr("自訂銜接圖")}
              className="w-10 h-10 object-cover rounded border border-[#10b981]/40"
            />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-[10px] text-[#0f766e] hover:text-[#115e59] underline"
              data-testid="button-replace-chain-ref-custom"
            >
              {uploading ? tr("上傳中…") : tr("換一張")}
            </button>
            <button
              onClick={() => onChange("")}
              className="text-[10px] text-[#dc2626] hover:text-[#b91c1c] underline"
              data-testid="button-clear-chain-ref-custom"
            >
              {tr("移除")}
            </button>
          </>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="text-[10px] px-2 py-1 rounded-md border border-dashed border-[#10b981]/50 text-[#0f766e] hover:bg-[#10b981]/10"
            data-testid="button-upload-chain-ref-custom"
          >
            {uploading ? tr("上傳中…") : tr("＋ 上傳自訂銜接圖")}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}

// ─── Image upload ────────────────────────────────────────────────────────────
function ImageUploadButton({
  label, objectPaths, onAdd, onRemove, max = 4,
}: {
  label: string; objectPaths: string[]; onAdd: (path: string) => void;
  onRemove: (idx: number) => void; max?: number;
}) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [fromWorks, setFromWorks] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const remaining = max - objectPaths.length;
    const toUpload = Array.from(files).slice(0, remaining);
    setUploading(true);
    for (const file of toUpload) {
      try {
        const path = await uploadToObjectStorage(file);
        onAdd(path);
      } catch {
        toast({ title: tr("上傳失敗"), variant: "destructive" });
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[#64748b] uppercase tracking-wide">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {objectPaths.map((path, i) => (
          <div key={i} className="relative w-12 h-12 rounded-lg bg-[#e2e8f0] border border-[#cbd5e1] flex items-center justify-center">
            {/^https?:/.test(path)
              ? <img src={path} alt="" className="w-full h-full rounded-lg object-cover" />
              : <span className="text-indigo-500 text-xs font-bold">✓</span>}
            <button type="button" onClick={() => onRemove(i)} aria-label={tr("移除")}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#ef4444] text-white text-xs rounded-full flex items-center justify-center">×</button>
          </div>
        ))}
        {objectPaths.length < max && (
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="w-12 h-12 rounded-lg border border-dashed border-[#cbd5e1] flex flex-col items-center justify-center text-[#94a3b8] hover:border-indigo-500 hover:text-indigo-500 transition-all">
            {uploading ? <span className="text-xs">...</span> : <><span className="text-lg leading-none">+</span><span className="text-[9px]">{tr("上傳")}</span></>}
          </button>
        )}
        {objectPaths.length < max && (
          <button type="button" onClick={() => setFromWorks(true)}
            className="h-12 px-3 rounded-lg border border-[#cbd5e1] bg-white text-xs text-[#334155] hover:border-indigo-500 hover:text-indigo-600 transition-all" data-testid="button-from-vault">
            {tr("從作品選")}
          </button>
        )}
      </div>
      {fromWorks && <VaultPicker onPick={url => { onAdd(url); setFromWorks(false); }} onClose={() => setFromWorks(false)} />}
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => handleFiles(e.target.files)} />
    </div>
  );
}

// ─── Projects View ─────────────────────────────────────────────────────────────
/** Project setting: which library character plays this role. Fills the role's
 *  reference images with the character's four views (or its first images). */
/** One step of the episode flow: 劇本 → 分鏡圖 → 動畫 → 合成. Holds that step's own actions. */
function FlowStep({ n, title, meta, state, children }: {
  n: number; title: string; meta: string; state: "done" | "active" | "todo"; children?: React.ReactNode;
}) {
  const box = state === "active" ? "border-indigo-500 bg-[#eef2ff]" : state === "done" ? "border-[#a7f3d0] bg-[#ecfdf5]" : "border-[#e2e8f0] bg-[#f8fafc]";
  const dot = state === "done" ? "bg-[#10b981]" : state === "active" ? "bg-indigo-600" : "bg-[#cbd5e1]";
  return (
    <div className={`flex items-center gap-2.5 rounded-xl border px-3 py-1.5 shrink-0 ${box}`} data-testid={`episode-step-${n}`} data-state={state}>
      <span className={`w-6 h-6 rounded-full text-[11px] font-bold text-white flex items-center justify-center shrink-0 ${dot}`}>{state === "done" ? "✓" : n}</span>
      <span className="leading-tight shrink-0">
        <span className="block text-xs font-bold text-[#0f172a]">{title}</span>
        <span className="block text-[10px] text-[#64748b]">{meta}</span>
      </span>
      {children}
    </div>
  );
}

function CharacterRolePicker({ label, urls, onChange }: { label: string; urls: string[]; onChange: (urls: string[]) => void }) {
  const { data: characters = [] } = useQuery<CharacterLibraryItem[]>({ queryKey: ["/api/character-library"] });
  const imagesOf = (c: CharacterLibraryItem): string[] => {
    const v = (c.fourViewUrls ?? {}) as FourViewUrls;
    const views = [v.front, v.threeQuarter, v.side, v.back].filter((u): u is string => !!u);
    return (views.length > 0 ? views : c.refImageUrls ?? []).slice(0, 4);
  };
  const current = characters.find(c => { const imgs = imagesOf(c); return imgs.length > 0 && imgs.every(u => urls.includes(u)); });
  return (
    <div>
      <label className="text-xs text-[#64748b] block mb-1.5">{label}</label>
      {characters.length === 0 ? (
        <p className="text-xs text-[#64748b] bg-[#f8fafc] border border-[#e2e8f0] rounded-xl p-3">
          {tr("角色庫還沒有角色。先到")}<Link href="/character-library"><span className="text-indigo-600 underline cursor-pointer">{tr("角色庫")}</span></Link> {tr("上傳照片建立一個，再回來選。")}
        </p>
      ) : (
        <select value={current?.id ?? ""} onChange={e => { const c = characters.find(x => x.id === e.target.value); onChange(c ? imagesOf(c) : []); }}
          className="w-full h-11 px-3 rounded-xl border border-[#cbd5e1] bg-white text-sm text-[#0f172a]" data-testid={`select-role-${label}`}>
          <option value="">{urls.length > 0 && !current ? tr("（沿用先前上傳的圖）") : tr("不指定")}</option>
          {characters.map(c => <option key={c.id} value={c.id} disabled={imagesOf(c).length === 0}>{c.name}{imagesOf(c).length === 0 ? tr("（還沒有圖片）") : ""}</option>)}
        </select>
      )}
      {urls.length > 0 && (
        <div className="flex items-center gap-1.5 mt-2">
          {urls.slice(0, 4).map((u, i) => <img key={i} src={u} alt="" className="w-11 h-11 rounded-lg object-cover border border-[#e2e8f0] bg-[#f8fafc]" />)}
          <button type="button" onClick={() => onChange([])} className="ml-auto text-xs text-[#94a3b8] hover:text-[#ef4444]">{tr("清除")}</button>
        </div>
      )}
    </div>
  );
}

function ProjectsView({ onSelect }: { onSelect: (id: string) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newGenre, setNewGenre] = useState(tr("愛情"));

  const { data: projects = [], isLoading } = useQuery<DramaProject[]>({
    queryKey: ["/api/drama/projects"],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/drama/projects", data).then(r => r.json()),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/projects"] });
      setShowCreate(false);
      setNewTitle("");
      toast({ title: tr("漫劇建立成功！") });
      onSelect(project.id);
    },
    onError: (e: any) => toast({ title: tr("建立失敗"), description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/drama/projects/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/drama/projects"] }),
  });

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-5 md:py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="hidden md:block text-2xl font-bold text-[#0f172a]">{tr("漫劇工作室")}</h1>
          <p className="text-sm text-[#64748b] md:mt-1">{tr("從一句劇情，到分鏡圖、動畫與整集短劇。")}</p>
        </div>
        <DarkButton onClick={() => setShowCreate(true)}>{tr("＋ 新建漫劇")}</DarkButton>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40"><Spinner /></div>
      ) : projects.length === 0 ? (
        <div className="text-center py-24">
          <div className="text-6xl mb-4">🎬</div>
          <p className="text-lg font-medium text-[#334155] mb-2">{tr("還沒有漫劇專案")}</p>
          <p className="text-sm text-[#64748b] mb-6">{tr("點擊「新建漫劇」開始你的第一部 AI 漫劇")}</p>
          <DarkButton onClick={() => setShowCreate(true)}>{tr("＋ 新建漫劇")}</DarkButton>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {projects.map(p => (
            <div key={p.id} onClick={() => onSelect(p.id)}
              className="bg-[#ffffff] border border-[#e2e8f0] rounded-2xl p-5 cursor-pointer
                hover:border-indigo-500 hover:shadow-[0_0_20px_rgba(99,102,241,0.15)] transition-all group">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-indigo-600/10 rounded-xl flex items-center justify-center text-xl">🎬</div>
                <button onClick={e => { e.stopPropagation(); if (confirm(tr("確定刪除「{0}」？", { 0: p.title }))) deleteMutation.mutate(p.id); }}
                  className="opacity-0 group-hover:opacity-100 text-[#94a3b8] hover:text-[#ef4444] transition-all text-sm">✕</button>
              </div>
              <h3 className="font-bold text-[#0f172a] truncate">{p.title}</h3>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {p.genre && <span className="text-xs bg-indigo-600/10 text-indigo-600 px-2 py-0.5 rounded-full">{p.genre}</span>}
                <span className="text-xs text-[#64748b]">{tr("{0} 集", { 0: p.episodeCount ?? 0 })}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={tr("新建漫劇專案")}>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">{tr("漫劇標題")}</label>
            <DarkInput value={newTitle} onChange={setNewTitle} placeholder={tr("例：霸道總裁的秘密")} />
          </div>
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">{tr("類型")}</label>
            <div className="flex flex-wrap gap-2">
              {GENRES.map(g => (
                <button key={g} onClick={() => setNewGenre(g)}
                  className={`px-3 py-1 rounded-full text-xs border transition-all ${newGenre === g ? "bg-indigo-600 text-white border-indigo-500" : "border-[#cbd5e1] text-[#64748b] hover:border-indigo-500 hover:text-indigo-600"}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <DarkButton
            onClick={() => createMutation.mutate({ title: newTitle, genre: newGenre })}
            disabled={!newTitle.trim() || createMutation.isPending}
            className="w-full justify-center"
          >
            {createMutation.isPending ? tr("建立中...") : tr("建立漫劇")}
          </DarkButton>
        </div>
      </Modal>
    </div>
  );
}

// ─── Project View ──────────────────────────────────────────────────────────────
function ProjectView({
  projectId, onBack, onSelectEpisode,
}: { projectId: string; onBack: () => void; onSelectEpisode: (id: string) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showSettings, setShowSettings] = useState(false);
  const [showNewEpisode, setShowNewEpisode] = useState(false);
  const [showImportScript, setShowImportScript] = useState(false);
  const [newEpTitle, setNewEpTitle] = useState("");
  const [newEpSceneCount, setNewEpSceneCount] = useState(6);
  const [pTitle, setPTitle] = useState("");
  const [pGenre, setPGenre] = useState(tr("愛情"));
  const [pSceneSize, setPSceneSize] = useState("9:16");
  const [pCharAUrls, setPCharAUrls] = useState<string[]>([]);
  const [pCharBUrls, setPCharBUrls] = useState<string[]>([]);
  const [pStyleUrls, setPStyleUrls] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const { data: project, isLoading: loadingProject } = useQuery<DramaProject>({
    queryKey: ["/api/drama/projects", projectId],
    queryFn: () => fetch(`/api/drama/projects/${projectId}`).then(r => r.json()),
  });

  const { data: episodes = [], isLoading: loadingEpisodes } = useQuery<DramaEpisode[]>({
    queryKey: ["/api/drama/projects", projectId, "episodes"],
    queryFn: () => fetch(`/api/drama/projects/${projectId}/episodes`).then(r => r.json()),
  });

  useEffect(() => {
    if (project) {
      setPTitle(project.title);
      setPGenre(project.genre ?? tr("愛情"));
      setPSceneSize(project.sceneSize ?? "9:16");
      setPCharAUrls(project.characterAUrls ?? []);
      setPCharBUrls(project.characterBUrls ?? []);
      setPStyleUrls(project.styleImageUrls ?? []);
    }
  }, [project]);

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/drama/projects/${projectId}`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/drama/projects"] });
      setShowSettings(false);
      toast({ title: tr("已儲存") });
    },
  });

  const createEpisodeMutation = useMutation({
    mutationFn: (data: any) =>
      apiRequest("POST", `/api/drama/projects/${projectId}/episodes`, data).then(r => r.json()),
    onSuccess: (ep) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/projects", projectId, "episodes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drama/projects", projectId] });
      setShowNewEpisode(false);
      setNewEpTitle("");
      toast({ title: tr("第 {0} 集已建立！", { 0: ep.episodeNumber }) });
      onSelectEpisode(ep.id);
    },
  });

  const deleteEpisodeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/drama/episodes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/projects", projectId, "episodes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drama/projects", projectId] });
    },
  });

  const handleCreateEpisode = () => {
    const tpl = selectedTemplate ? DRAMA_TEMPLATES.find(t => t.key === selectedTemplate) : null;
    let scenes: DramaScene[];

    if (tpl) {
      scenes = tpl.scenes.map((s, i) => ({
        id: nid(), sceneNumber: i + 1,
        title: s.title, description: s.description,
        dialogue: s.dialogue || "", cameraMovement: s.cameraMovement || "",
        useCharA: true, useCharB: true, imageStatus: "pending",
      }));
    } else {
      scenes = Array.from({ length: newEpSceneCount }, (_, i) => ({
        id: nid(), sceneNumber: i + 1, title: tr("第 {0} 幕", { 0: i + 1 }),
        description: "", dialogue: "", cameraMovement: "",
        useCharA: true, useCharB: true, imageStatus: "pending",
      }));
    }

    createEpisodeMutation.mutate({
      title: newEpTitle || tpl?.title || tr("第 {0} 集", { 0: episodes.length + 1 }),
      scenes, episodeNumber: episodes.length + 1,
    });
  };

  if (loadingProject) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (!project) return <div className="text-center py-20 text-[#ef4444]">{tr("找不到漫劇")}</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 py-5 md:py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2 md:gap-3 flex-wrap">
        <button onClick={onBack} className="text-[#64748b] hover:text-[#334155] text-sm transition-colors">{tr("← 返回")}</button>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-[#0f172a]">{project.title}</h1>
            {project.genre && <span className="text-xs bg-indigo-600/10 text-indigo-600 px-2 py-0.5 rounded-full">{project.genre}</span>}
            <span className="text-xs text-[#94a3b8]">{SIZE_LABELS[project.sceneSize ?? "9:16"]}</span>
          </div>
        </div>
      </div>

      {/* 流程：每一步在哪裡做、做到哪了 */}
      <div className="bg-white border border-[#e0e7ff] rounded-3xl p-4 md:p-5" data-testid="drama-flow">
        <ol className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
          {[
            { n: 1, title: tr("選角色與風格"), desc: tr("從角色庫選主角，設定畫面比例與風格圖。"), done: (project.characterAUrls ?? []).length > 0, action: tr("設定"), onClick: () => setShowSettings(true) },
            { n: 2, title: tr("寫劇本"), desc: tr("新增一集：自己寫、用範本，或上傳劇本讓 AI 拆成分鏡。"), done: episodes.length > 0, action: tr("新增集數"), onClick: () => setShowNewEpisode(true), alt: { label: tr("上傳劇本"), onClick: () => setShowImportScript(true) } },
            { n: 3, title: tr("生成分鏡圖"), desc: tr("進入集數，逐幕或一次生成。每幕 {0} 積分。", { 0: IMAGE_COST }), done: episodes.some(e => (e.creditsUsed ?? 0) > 0), action: "", onClick: undefined },
            { n: 4, title: tr("動畫與合成"), desc: tr("把分鏡圖變成動畫，再合成整集下載。"), done: false, action: "", onClick: undefined },
          ].map(st => (
            <li key={st.n} className={`rounded-2xl border p-3 ${st.done ? "border-[#a7f3d0] bg-[#ecfdf5]" : "border-[#e2e8f0] bg-[#f8fafc]"}`}>
              <p className="flex items-center gap-2 text-sm font-bold text-[#0f172a]">
                <span className={`w-6 h-6 rounded-full text-[11px] flex items-center justify-center text-white ${st.done ? "bg-[#10b981]" : "bg-indigo-600"}`}>{st.done ? "✓" : st.n}</span>
                {st.title}
              </p>
              <p className="text-xs text-[#64748b] mt-1.5 leading-relaxed">{st.desc}</p>
              {st.onClick && (
                <div className="flex gap-2 mt-2.5">
                  <button onClick={st.onClick} className="h-9 px-3 rounded-lg bg-indigo-600 text-white text-xs font-semibold" data-testid={`drama-flow-${st.n}`}>{st.action}</button>
                  {st.alt && <button onClick={st.alt.onClick} className="h-9 px-3 rounded-lg border border-[#cbd5e1] bg-white text-xs text-[#334155]" data-testid="button-import-script">{st.alt.label}</button>}
                </div>
              )}
              {st.n >= 3 && <p className="text-[11px] text-[#94a3b8] mt-2">{episodes.length > 0 ? tr("點下方的集數進入。") : tr("先完成前兩步。")}</p>}
            </li>
          ))}
        </ol>
      </div>

      {/* Character Library */}
      <div className="bg-[#ffffff] border border-[#e2e8f0] rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-[#334155] text-sm">{tr("角色與風格")}</h2>
          <button onClick={() => setShowSettings(true)} className="text-xs text-indigo-600 hover:underline">{tr("編輯設定")}</button>
        </div>
        <div className="grid grid-cols-3 gap-3 md:gap-6">
          {[
            { label: tr("角色 A"), urls: project.characterAUrls ?? [], color: "#6366f1" },
            { label: tr("角色 B"), urls: project.characterBUrls ?? [], color: "#f59e0b" },
            { label: tr("風格參考"), urls: project.styleImageUrls ?? [], color: "#10b981" },
          ].map(({ label, urls, color }) => (
            <div key={label}>
              <p className="text-xs text-[#64748b] mb-2">{tr("{0}（{1} 張）", { 0: label, 1: urls.length })}</p>
              <div className="flex flex-wrap gap-1.5">
                {urls.map((u, i) => (
                  <img key={i} src={u} alt={`${label} ${i + 1}`} className="w-10 h-10 rounded-lg object-cover border" style={{ borderColor: `${color}60` }} />
                ))}
                {urls.length === 0 && <p className="text-xs text-[#cbd5e1]">{tr("未設定")}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Episodes */}
      <div className="bg-[#ffffff] border border-[#e2e8f0] rounded-2xl p-5">
        <h2 className="font-semibold text-[#334155] mb-4 text-sm">{tr("集數")}</h2>
        {loadingEpisodes ? (
          <div className="flex items-center justify-center h-16"><Spinner /></div>
        ) : episodes.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[#94a3b8] mb-3 text-sm">{tr("還沒有集數")}</p>
            <DarkButton variant="secondary" onClick={() => setShowNewEpisode(true)}>{tr("＋ 新增第一集")}</DarkButton>
          </div>
        ) : (
          <div className="space-y-2">
            {episodes.map(ep => {
              const scenes: DramaScene[] = JSON.parse(ep.scenes || "[]");
              const done = scenes.filter(s => s.imageStatus === "completed").length;
              const statusColor = ep.status === "completed" ? "#22c55e" : ep.status === "generating" ? "#ca8a04" : ep.status === "failed" ? "#ef4444" : "#94a3b8";
              return (
                <div key={ep.id} onClick={() => onSelectEpisode(ep.id)}
                  className="flex items-center gap-4 p-4 rounded-xl border border-[#e2e8f0] hover:border-indigo-500/40 hover:bg-indigo-600/5 cursor-pointer transition-all group">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm"
                    style={{ background: "#6366f115", color: "#4f46e5" }}>
                    {ep.episodeNumber}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-[#0f172a]">{ep.title}</p>
                    <p className="text-xs text-[#94a3b8]">{tr("{0} 幕 · {1} 幕已生成圖片", { 0: ep.sceneCount, 1: done })}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full border"
                      style={{ color: statusColor, borderColor: `${statusColor}40`, background: `${statusColor}10` }}>
                      {ep.status === "generating" ? tr("生成中") : ep.status === "completed" ? tr("完成") : ep.status === "failed" ? tr("失敗") : tr("草稿")}
                    </span>
                    <button onClick={e => { e.stopPropagation(); if (confirm(tr("確定刪除此集？"))) deleteEpisodeMutation.mutate(ep.id); }}
                      className="opacity-0 group-hover:opacity-100 text-[#94a3b8] hover:text-[#ef4444] transition-all text-sm">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title={tr("編輯漫劇設定")}>
        <div className="space-y-5">
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">{tr("漫劇標題")}</label>
            <DarkInput value={pTitle} onChange={setPTitle} />
          </div>
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">{tr("類型")}</label>
            <div className="flex flex-wrap gap-2">
              {GENRES.map(g => (
                <button key={g} onClick={() => setPGenre(g)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-all ${pGenre === g ? "bg-indigo-600 text-white border-indigo-500" : "border-[#cbd5e1] text-[#64748b] hover:border-indigo-500"}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">{tr("圖片尺寸")}</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(SIZE_LABELS).map(([val, label]) => (
                <button key={val} onClick={() => setPSceneSize(val)}
                  className={`p-2.5 rounded-xl border text-xs transition-all ${pSceneSize === val ? "border-indigo-500 bg-indigo-600/10 text-indigo-600" : "border-[#cbd5e1] text-[#64748b] hover:border-indigo-500/40"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <CharacterRolePicker label={tr("角色 A（主角）")} urls={pCharAUrls} onChange={setPCharAUrls} />
          <CharacterRolePicker label={tr("角色 B（選填）")} urls={pCharBUrls} onChange={setPCharBUrls} />
          <ImageUploadButton label={tr("風格參考圖（最多 4 張）")} objectPaths={pStyleUrls}
            onAdd={p => setPStyleUrls(v => [...v, p])} onRemove={i => setPStyleUrls(v => v.filter((_, idx) => idx !== i))} />
          <DarkButton onClick={() => updateMutation.mutate({ title: pTitle, genre: pGenre, sceneSize: pSceneSize, characterAUrls: pCharAUrls, characterBUrls: pCharBUrls, styleImageUrls: pStyleUrls })}
            disabled={updateMutation.isPending} className="w-full justify-center">
            {updateMutation.isPending ? tr("儲存中...") : tr("儲存設定")}
          </DarkButton>
        </div>
      </Modal>

      {/* New Episode Modal */}
      <Modal open={showNewEpisode} onClose={() => { setShowNewEpisode(false); setSelectedTemplate(null); }} title={tr("新增集數")}>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">{tr("集數標題")}</label>
            <DarkInput value={newEpTitle} onChange={setNewEpTitle} placeholder={tr("第 {0} 集", { 0: episodes.length + 1 })} />
          </div>

          {/* Template picker */}
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block flex items-center justify-between">
              <span>{tr("📚 從範本開始（選填）")}</span>
              {selectedTemplate && (
                <button onClick={() => setSelectedTemplate(null)} className="text-[10px] text-indigo-600 hover:text-indigo-500 normal-case tracking-normal">{tr("清除")}</button>
              )}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {DRAMA_TEMPLATES.map(t => {
                const active = selectedTemplate === t.key;
                return (
                  <button key={t.key} onClick={() => setSelectedTemplate(t.key)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${active ? "border-indigo-500 bg-indigo-600/10" : "border-[#e2e8f0] bg-[#f8fafc] hover:border-indigo-500/40"}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-base">{t.emoji}</span>
                      <span className={`text-xs font-semibold ${active ? "text-indigo-600" : "text-[#334155]"}`}>{t.title}</span>
                    </div>
                    <p className="text-[10px] text-[#64748b] leading-snug line-clamp-2">{t.description}</p>
                    <p className="text-[10px] text-[#94a3b8] mt-1">{tr("共 {0} 幕 · {1} 積分", { 0: t.scenes.length, 1: t.scenes.length * IMAGE_COST })}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scene count slider (disabled when template selected) */}
          {!selectedTemplate && (
            <div>
              <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">
                {tr("場景數量：")}<span className="text-indigo-600 font-bold">{tr("{0} 幕", { 0: newEpSceneCount })}</span>
                <span className="text-[#94a3b8] ml-2">{tr("（{0} 積分）", { 0: newEpSceneCount * IMAGE_COST })}</span>
              </label>
              <input type="range" min={2} max={12} value={newEpSceneCount}
                onChange={e => setNewEpSceneCount(Number(e.target.value))}
                className="w-full accent-indigo-500" />
              <div className="flex justify-between text-xs text-[#94a3b8] mt-1"><span>{tr("2 幕")}</span><span>{tr("12 幕")}</span></div>
              <p className="text-[10px] text-[#64748b] mt-2">{tr("💡 建立後可在編輯器中用「🤖 AI 寫腳本」一鍵生成所有幕的內容")}</p>
            </div>
          )}

          {selectedTemplate && (
            <div className="bg-indigo-600/5 border border-indigo-500/20 rounded-lg p-2.5 text-[11px] text-indigo-600">
              {tr("✨ 將以「{0}」範本建立完整腳本，建立後可隨時微調", { 0: DRAMA_TEMPLATES.find(t => t.key === selectedTemplate)?.title })}
            </div>
          )}

          <DarkButton onClick={handleCreateEpisode} disabled={createEpisodeMutation.isPending} className="w-full justify-center">
            {createEpisodeMutation.isPending ? tr("建立中...") : selectedTemplate ? tr("✨ 套用範本並建立") : tr("建立空白集數")}
          </DarkButton>
        </div>
      </Modal>

      {/* Import Script Modal */}
      <ImportScriptModal
        open={showImportScript}
        onClose={() => setShowImportScript(false)}
        projectId={projectId}
        onImported={() => {
          setShowImportScript(false);
          queryClient.invalidateQueries({ queryKey: ["/api/drama/projects", projectId, "episodes"] });
          queryClient.invalidateQueries({ queryKey: ["/api/drama/projects", projectId] });
          queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
        }}
      />
    </div>
  );
}

// ─── Library pickers (per-scene character/location reuse) ─────────────────────
function LibraryPickers({
  scene,
  onUpdate,
}: {
  scene: DramaScene;
  onUpdate: (patch: Partial<DramaScene>) => void;
}) {
  const charsQuery = useQuery<CharacterLibraryItem[]>({ queryKey: ["/api/character-library"] });
  const scenesQuery = useQuery<any[]>({ queryKey: ["/api/scene-library"] });
  const characters = charsQuery.data ?? [];
  const sceneItems = scenesQuery.data ?? [];

  const selectedCharIds = new Set(scene.characterIds ?? []);
  const toggleChar = (id: string) => {
    const next = selectedCharIds.has(id)
      ? (scene.characterIds ?? []).filter(x => x !== id)
      : [...(scene.characterIds ?? []), id];
    onUpdate({ characterIds: next });
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] text-[#64748b] uppercase tracking-wide">{tr("角色庫角色（多選，影響出圖）")}</label>
          <Link href="/character-library" className="text-[10px] text-indigo-500 hover:underline" data-testid="link-open-charlib">
            {tr("管理 →")}
          </Link>
        </div>
        {characters.length === 0 ? (
          <p className="text-[11px] text-[#94a3b8]">{tr("角色庫是空的，先到「角色庫」建一個角色並生成四視圖。")}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5" data-testid="char-lib-picker">
            {characters.map(c => {
              const active = selectedCharIds.has(c.id);
              const fv = c.fourViewUrls as FourViewUrls | null;
              const thumb = fv?.front || fv?.threeQuarter || c.refImageUrls?.[0];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleChar(c.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] transition-all ${
                    active
                      ? "bg-indigo-600/10 border-indigo-500 text-indigo-600"
                      : "bg-white border-[#cbd5e1] text-[#64748b] hover:border-[#94a3b8]"
                  }`}
                  data-testid={`char-lib-chip-${c.id}`}
                >
                  {thumb ? (
                    <img src={thumb} alt={c.name} className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-[#e2e8f0]" />
                  )}
                  <span>{c.name}</span>
                  {active && <span>✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[10px] text-[#64748b] uppercase tracking-wide">{tr("場景庫場景（影響出圖背景）")}</label>
          <Link href="/scene-library" className="text-[10px] text-indigo-500 hover:underline" data-testid="link-open-scenelib">
            {tr("管理 →")}
          </Link>
        </div>
        {sceneItems.length === 0 ? (
          <p className="text-[11px] text-[#94a3b8]">{tr("場景庫是空的，先到「場景庫」建立場景。")}</p>
        ) : (
          <select
            value={scene.sceneLocationId ?? ""}
            onChange={e => onUpdate({ sceneLocationId: e.target.value || undefined })}
            className="w-full text-xs bg-white border border-[#cbd5e1] rounded-lg px-2 py-1.5 text-[#0f172a]"
            data-testid="select-scene-lib"
          >
            <option value="">{tr("不套用場景庫")}</option>
            {sceneItems.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

// ─── Import Script Modal ───────────────────────────────────────────────────────
function ImportScriptModal({
  open, onClose, projectId, onImported,
}: { open: boolean; onClose: () => void; projectId: string; onImported: () => void }) {
  const { toast } = useToast();
  const [scriptText, setScriptText] = useState("");
  const [episodeCount, setEpisodeCount] = useState(3);
  const [scenesPerEpisode, setScenesPerEpisode] = useState(6);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const importMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/drama/projects/${projectId}/import-script`, {
        scriptText: scriptText.trim() || undefined,
        fileBase64: fileBase64 || undefined,
        fileName: fileName || undefined,
        episodeCount, scenesPerEpisode,
      }).then(r => r.json()),
    onSuccess: (data: any) => {
      toast({
        title: tr("✨ 已建立 {0} 集 ／ {1} 個角色", { 0: data.episodesCreated ?? 0, 1: data.charactersCreated ?? 0 }),
        description: tr("可在角色庫與集數列表中查看"),
      });
      setScriptText(""); setFileBase64(null); setFileName("");
      onImported();
    },
    onError: (e: any) => toast({ title: tr("匯入失敗"), description: e.message, variant: "destructive" }),
  });

  const handleFile = (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setFileBase64(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <Modal open={open} onClose={onClose} title={tr("📄 從劇本匯入")}>
      <div className="space-y-4">
        <p className="text-xs text-[#64748b]">
          {tr("上傳故事原文（TXT / DOCX / PDF）或直接貼入文字，AI 會自動拆集、抽出主要角色（會自動加到角色庫）並產生分鏡。")}
        </p>

        <div>
          <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("劇本檔案（TXT / DOCX / PDF）")}</label>
          <input ref={fileRef} type="file" accept=".txt,.docx,.pdf" className="hidden"
            onChange={e => handleFile(e.target.files?.[0] ?? null)} />
          <button onClick={() => fileRef.current?.click()}
            className="w-full p-3 rounded-lg border-2 border-dashed border-[#cbd5e1] hover:border-indigo-500 text-sm text-[#64748b] hover:text-indigo-600 transition-all"
            data-testid="button-pick-script-file">
            {fileName ? `📎 ${fileName}` : tr("📂 選擇檔案…")}
          </button>
        </div>

        <div className="text-center text-[10px] text-[#94a3b8]">{tr("— 或 —")}</div>

        <div>
          <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("直接貼入劇本文字")}</label>
          <DarkTextarea
            value={scriptText}
            onChange={setScriptText}
            placeholder={tr("貼入故事大綱或完整劇本（最多 60,000 字）…")}
            rows={6}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("集數")}</label>
            <input type="number" min={1} max={10} value={episodeCount}
              onChange={e => setEpisodeCount(Math.min(10, Math.max(1, Number(e.target.value))))}
              className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("每集幕數")}</label>
            <input type="number" min={2} max={12} value={scenesPerEpisode}
              onChange={e => setScenesPerEpisode(Math.min(12, Math.max(2, Number(e.target.value))))}
              className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
        </div>

        <div className="bg-[#f8fafc] rounded-lg p-2.5 text-[11px] text-[#64748b]">
          {tr("ℹ️ 預估產出：{0} 集 × {1} 幕 = {2} 幕分鏡（不會自動扣積分，須在編輯器中手動生成圖片）", { 0: episodeCount, 1: scenesPerEpisode, 2: episodeCount * scenesPerEpisode })}
        </div>

        <DarkButton
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending || (!scriptText.trim() && !fileBase64)}
          className="w-full justify-center"
          data-testid="button-import-script-submit"
        >
          {importMutation.isPending ? tr("🤖 AI 拆集中…約 30 秒") : tr("✨ 開始匯入")}
        </DarkButton>
      </div>
    </Modal>
  );
}

// ─── Scene Flow Canvas (visual flow with SVG connections) ──────────────────────
function SceneFlowCanvas({
  scenes, serverScenes, selectedIdx, onSelect, chainEffective,
}: {
  scenes: DramaScene[]; serverScenes: DramaScene[]; selectedIdx: number | null;
  onSelect: (idx: number) => void;
  chainEffective?: boolean[];
}) {
  const CARD_W = 120;
  const CARD_H = 160;
  const GAP = 60;
  const PAD = 40;
  const totalW = scenes.length * (CARD_W + GAP) - GAP + PAD * 2;
  const totalH = CARD_H + PAD * 2;

  return (
    <div className="overflow-x-auto">
      <svg width={totalW} height={totalH} style={{ display: "block" }}>
        <defs>
          <filter id="node-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="sel-glow">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Connection arrows */}
        {scenes.slice(0, -1).map((_, idx) => {
          const x1 = PAD + idx * (CARD_W + GAP) + CARD_W;
          const x2 = PAD + (idx + 1) * (CARD_W + GAP);
          const y = PAD + CARD_H / 2;
          const ss = serverScenes[idx];
          const ns = serverScenes[idx + 1];
          const bothDone = ss?.imageStatus === "completed" && ns?.imageStatus === "completed";
          const color = bothDone ? "#22c55e" : "#cbd5e1";
          return (
            <g key={idx}>
              <path d={`M${x1},${y} C${x1 + GAP * 0.4},${y} ${x2 - GAP * 0.4},${y} ${x2},${y}`}
                fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.6" />
              <polygon
                points={`${x2},${y} ${x2 - 8},${y - 4} ${x2 - 8},${y + 4}`}
                fill={color} fillOpacity="0.6" />
            </g>
          );
        })}

        {/* Scene nodes */}
        {scenes.map((scene, idx) => {
          const ss = serverScenes[idx];
          const imgUrl = ss ? getSceneImageUrl(ss) : null;
          const isSelected = selectedIdx === idx;
          const isGenerating = ss?.imageStatus === "generating";
          const isDone = ss?.imageStatus === "completed";
          const isFailed = ss?.imageStatus === "failed";
          const hasVideo = ss?.videoStatus === "completed";
          const borderColor = isSelected ? "#6366f1" : isGenerating ? "#ca8a04" : isDone ? "#22c55e" : isFailed ? "#ef4444" : "#cbd5e1";
          const x = PAD + idx * (CARD_W + GAP);
          const y = PAD;

          return (
            <g key={scene.id} transform={`translate(${x},${y})`}
              onClick={() => onSelect(idx)} style={{ cursor: "pointer" }}>

              {/* Glow for selected */}
              {isSelected && (
                <rect x={-2} y={-2} width={CARD_W + 4} height={CARD_H + 4} rx={12}
                  fill="none" stroke="#6366f1" strokeWidth="2" filter="url(#sel-glow)" strokeOpacity="0.6" />
              )}

              {/* Shadow */}
              <rect x={3} y={3} width={CARD_W} height={CARD_H} rx={10} fill="#94a3b8" fillOpacity="0.25" />

              {/* Card background */}
              <rect width={CARD_W} height={CARD_H} rx={10} fill="#ffffff" stroke={borderColor} strokeWidth={isSelected ? 2 : 1.5} />

              {/* Image area */}
              {imgUrl ? (
                <image href={imgUrl} x={0} y={0} width={CARD_W} height={CARD_H * 0.65}
                  preserveAspectRatio="xMidYMid slice"
                  style={{ borderRadius: 10 }} clipPath={`inset(0 0 0 0 round 10px)`} />
              ) : (
                <rect x={0} y={0} width={CARD_W} height={CARD_H * 0.65} rx={10} fill="#f8fafc" />
              )}

              {/* Image placeholder icon */}
              {!imgUrl && (
                <text x={CARD_W / 2} y={CARD_H * 0.33} textAnchor="middle" fontSize="24" fill="#cbd5e1">🎬</text>
              )}

              {/* Generating animation */}
              {isGenerating && (
                <rect x={0} y={0} width={CARD_W} height={CARD_H * 0.65} rx={10} fill="#ca8a0420">
                  <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
                </rect>
              )}

              {/* Header accent */}
              <rect x={0} y={CARD_H * 0.65} width={CARD_W} height={1} fill={borderColor} fillOpacity="0.3" />

              {/* Scene number badge */}
              <rect x={4} y={4} width={22} height={16} rx={4} fill="#0f172a" fillOpacity="0.85" />
              <text x={15} y={15} textAnchor="middle" fill="#ffffff" fontSize="10" fontFamily="monospace">{scene.sceneNumber}</text>

              {/* Status dot */}
              <circle cx={CARD_W - 10} cy={10} r={4} fill={borderColor}
                filter={isGenerating || isSelected ? "url(#node-glow)" : ""}>
                {isGenerating && <animate attributeName="opacity" values="1;0.2;1" dur="0.8s" repeatCount="indefinite" />}
              </circle>

              {/* Video badge */}
              {hasVideo && (
                <rect x={CARD_W - 30} y={CARD_H * 0.65 - 18} width={26} height={14} rx={3} fill="#a855f7" />
              )}
              {hasVideo && (
                <text x={CARD_W - 17} y={CARD_H * 0.65 - 7} textAnchor="middle" fill="#fff" fontSize="8">{tr("▶ 影")}</text>
              )}

              {/* Chain Mode badge — scene picks up from prev scene's tail frame */}
              {chainEffective?.[idx] && idx > 0 && (
                <g>
                  <rect x={CARD_W - 46} y={4} width={42} height={14} rx={3} fill="#10b981" />
                  <text x={CARD_W - 25} y={14} textAnchor="middle" fill="#fff" fontSize="8">{tr("🔗 銜接 #{0}", { 0: idx })}</text>
                </g>
              )}

              {/* Scene title */}
              <text x={8} y={CARD_H * 0.65 + 16} fill="#475569" fontSize="10" fontFamily="'Noto Sans TC', sans-serif">
                {scene.title.length > 7 ? scene.title.slice(0, 7) + "…" : scene.title}
              </text>

              {/* Description preview */}
              <text x={8} y={CARD_H * 0.65 + 30} fill="#94a3b8" fontSize="9" fontFamily="'Noto Sans TC', sans-serif">
                {(scene.description || tr("未填寫場景描述")).slice(0, 10)}…
              </text>

              {/* Port connectors */}
              <circle cx={0} cy={CARD_H / 2} r={5} fill="#ffffff" stroke="#cbd5e1" strokeWidth={1.5} />
              <circle cx={CARD_W} cy={CARD_H / 2} r={5} fill="#ffffff" stroke={borderColor} strokeWidth={1.5} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── AI Script Generation Dialog ──────────────────────────────────────────────
function AIScriptDialog({
  open, onClose, onApply, defaultSceneCount, genre, characterAName, characterBName,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (scenes: Array<{ title: string; description: string; dialogue: string; cameraMovement: string; useCharA: boolean; useCharB: boolean }>) => void;
  defaultSceneCount: number;
  genre?: string;
  characterAName?: string;
  characterBName?: string;
}) {
  const { toast } = useToast();
  const [pitch, setPitch] = useState("");
  const [count, setCount] = useState(defaultSceneCount);

  useEffect(() => { if (open) { setCount(defaultSceneCount); } }, [open, defaultSceneCount]);

  const aiMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/drama/ai-generate-script", {
      pitch, sceneCount: count, genre, characterAName, characterBName,
    }).then(r => r.json()),
    onSuccess: (data) => {
      if (!data.scenes || data.scenes.length === 0) {
        toast({ title: tr("AI 沒有產出有效腳本"), variant: "destructive" });
        return;
      }
      onApply(data.scenes);
      toast({ title: tr("AI 已生成 {0} 幕腳本！", { 0: data.scenes.length }) });
      setPitch("");
      onClose();
    },
    onError: (e: any) => toast({ title: tr("AI 生成失敗"), description: e.message, variant: "destructive" }),
  });

  return (
    <Modal open={open} onClose={onClose} title={tr("🤖 AI 智慧腳本助手")}>
      <div className="space-y-4">
        <div className="bg-indigo-600/5 border border-indigo-500/20 rounded-xl p-3 text-xs text-indigo-600 leading-relaxed">
          {tr("💡 用一兩句話描述劇情概念，AI 會依 WAN 3.0 提示詞最佳實踐自動產出整集分鏡（含場景描述、台詞、運鏡）。")}
        </div>

        <div>
          <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">{tr("劇情概念")}</label>
          <DarkTextarea
            value={pitch} onChange={setPitch}
            placeholder={tr("例：{0}", { 0: genre === "懸疑" ? "失憶女記者調查三年前的命案，意外發現真兇是自己的未婚夫" : "霸道總裁愛上小助理，第一次在電梯相遇文件灑滿地" })}
            rows={4}
          />
          <p className="text-[10px] text-[#94a3b8] mt-1.5">{tr("💬 越具體越好（角色、衝突、地點、結局想法都可以加進來）")}</p>
        </div>

        <div>
          <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">
            {tr("幕數：")}<span className="text-indigo-600 font-bold">{tr("{0} 幕", { 0: count })}</span>
          </label>
          <input type="range" min={2} max={12} value={count}
            onChange={e => setCount(Number(e.target.value))} className="w-full accent-indigo-500" />
          <div className="flex justify-between text-xs text-[#94a3b8] mt-1"><span>{tr("2 幕")}</span><span>{tr("12 幕")}</span></div>
        </div>

        {(characterAName || characterBName) && (
          <div className="bg-[#f8fafc] rounded-lg p-2.5 text-[11px] text-[#64748b] space-y-0.5">
            {characterAName && <div>{tr("🎭 角色 A：")}<span className="text-indigo-600">{characterAName}</span></div>}
            {characterBName && <div>{tr("🎭 角色 B：")}<span className="text-[#d97706]">{characterBName}</span></div>}
          </div>
        )}

        <div className="bg-[#ca8a04]/5 border border-[#ca8a04]/20 rounded-lg p-2.5 text-[11px] text-[#ca8a04]">
          {tr("⚠️ AI 會「覆蓋」當前所有幕的標題、描述、台詞、運鏡。已生成圖片的幕不會受影響但內容會被換新。")}
        </div>

        <DarkButton
          onClick={() => aiMutation.mutate()}
          disabled={!pitch.trim() || aiMutation.isPending}
          className="w-full justify-center"
        >
          {aiMutation.isPending ? tr("🤖 AI 撰寫中…約 10 秒") : tr("✨ 生成腳本")}
        </DarkButton>
      </div>
    </Modal>
  );
}

// ─── Prompt Snippets Floating Panel (插入到場景描述) ──────────────────────
function PromptSnippetsPanel({
  onInsert,
}: { onInsert: (text: string) => void }) {
  const [openCategory, setOpenCategory] = useState<string | null>("lighting");

  return (
    <div className="border-t border-[#e2e8f0] pt-3">
      <p className="text-[10px] text-[#64748b] uppercase tracking-wide mb-2 flex items-center gap-1">
        <span>✨</span><span>{tr("提示詞素材庫")}</span>
      </p>
      <p className="text-[10px] text-[#cbd5e1] mb-2 leading-snug">{tr("點擊任一標籤快速插入到場景描述末尾")}</p>
      <div className="space-y-1.5">
        {PROMPT_SNIPPETS.map(cat => (
          <div key={cat.key} className="rounded-lg border border-[#e2e8f0] overflow-hidden bg-[#f8fafc]">
            <button
              onClick={() => setOpenCategory(openCategory === cat.key ? null : cat.key)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-[#f8fafc] transition-colors"
              style={{ borderLeft: `2px solid ${cat.color}` }}
            >
              <span className="text-[11px] font-medium" style={{ color: cat.color }}>
                {cat.emoji} {cat.label}
              </span>
              <span className="text-[10px] text-[#94a3b8]">{openCategory === cat.key ? "▾" : "▸"}</span>
            </button>
            {openCategory === cat.key && (
              <div className="p-2 flex flex-wrap gap-1">
                {cat.snippets.map(s => (
                  <button
                    key={s.label}
                    onClick={() => onInsert(s.text)}
                    title={s.text}
                    className="text-[10px] px-2 py-0.5 rounded-full border bg-[#f8fafc] transition-all hover:scale-105"
                    style={{ borderColor: `${cat.color}30`, color: `${cat.color}` }}
                  >
                    + {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Episode View (Main Visual Editor) ────────────────────────────────────────
function EpisodeView({
  episodeId, projectId, onBack,
}: { episodeId: string; projectId: string; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const isMobile = useIsMobile();

  const { data: episode, isLoading } = useQuery<DramaEpisode>({
    queryKey: ["/api/drama/episodes", episodeId],
    queryFn: () => fetch(`/api/drama/episodes/${episodeId}`).then(r => r.json()),
    refetchInterval: (query) => {
      const ep = query.state.data as DramaEpisode | undefined;
      if (!ep) return false;
      const scenes: DramaScene[] = JSON.parse(ep.scenes || "[]");
      const busy = scenes.some(s => s.imageStatus === "generating" || s.videoStatus === "generating") || ep.status === "generating";
      return busy ? 3000 : false;
    },
  });

  const { data: project } = useQuery<DramaProject>({
    queryKey: ["/api/drama/projects", projectId],
    queryFn: () => fetch(`/api/drama/projects/${projectId}`).then(r => r.json()),
  });

  const [localScenes, setLocalScenes] = useState<DramaScene[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<"flow" | "grid">("flow");
  const [animateDialog, setAnimateDialog] = useState<{ sceneIdx: number } | null>(null);
  const [animDuration, setAnimDuration] = useState(5);
  const [animResolution, setAnimResolution] = useState<"720p" | "1080p">("720p");
  const [animUseOmni, setAnimUseOmni] = useState(false);
  const [animUseFirstLast, setAnimUseFirstLast] = useState(false);
  const [showAIDialog, setShowAIDialog] = useState(false);
  // Tracks whether *this* tab fired a chain-mode整集重生 batch — used so the
  // progress badge stays visible all the way down to the very last scene
  // (where only 1 in-flight remains and our heuristic would otherwise miss it).
  const [chainBatchActive, setChainBatchActive] = useState(false);
  // Two-phase clear: only allow `chainBatchActive` to be cleared *after* we have
  // observed at least one scene 2..N flip to "generating". This prevents racing
  // the first poll: the mutation can resolve before the very next refetch sees
  // the server-side status updates we wrote.
  const chainGeneratingObservedRef = useRef(false);
  // Local "cancel acknowledged" flag set the instant the cancel mutation
  // resolves. Server marks all 2..N targets as `generating` up front so the
  // `inFlightAfterFirst >= 2` cross-tab heuristic would otherwise keep the
  // progress pill / cancel button on screen until each remaining scene's
  // status is restored (only happens after the in-flight scene wraps up).
  // While this flag is set, the chain-batch UI stays hidden regardless of
  // the raw `generating` counts — we trust the server already has the cancel
  // request and will refund + restore status. Reset on next batch start.
  const [chainCancelAcknowledged, setChainCancelAcknowledged] = useState(false);
  // Same two-phase pattern for the animate-all batch — keeps the progress
  // badge / cancel button visible from dispatch through the very last scene.
  const [animateBatchActive, setAnimateBatchActive] = useState(false);
  const animateGeneratingObservedRef = useRef(false);
  // Compile crossfade (ms) between adjacent scenes — sent to /compile.
  // Slider exposes 0 / 200 / 400 / 800 ms (default 400 = subtle fade).
  const [compileCrossfadeMs, setCompileCrossfadeMs] = useState<number>(400);

  // Mobile UX: long-press action sheet & inspector sheet
  const [actionSheetIdx, setActionSheetIdx] = useState<number | null>(null);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);
  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  useEffect(() => () => cancelLongPress(), []);
  const makeLongPressHandlers = (idx: number) => ({
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      longPressStartRef.current = { x: t.clientX, y: t.clientY };
      longPressFiredRef.current = false;
      cancelLongPress();
      longPressTimerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          navigator.vibrate(20);
        }
        setActionSheetIdx(idx);
      }, 550);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const s = longPressStartRef.current;
      if (!s) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - s.x) > 10 || Math.abs(t.clientY - s.y) > 10) {
        cancelLongPress();
      }
    },
    onTouchEnd: cancelLongPress,
    onTouchCancel: cancelLongPress,
    onContextMenu: (e: React.MouseEvent) => {
      // Right-click also opens action sheet on touch devices that surface it
      if (isMobile) {
        e.preventDefault();
        setActionSheetIdx(idx);
      }
    },
  });

  useEffect(() => {
    if (episode) {
      const s: DramaScene[] = JSON.parse(episode.scenes || "[]");
      setLocalScenes(s);
    }
  }, [episode]);

  // ─── Refund toasts on regen failure ──────────────────────────────────────
  // Backend auto-refunds the scene cost only via regenerateDramaScene's catch (single
  // regen + each scene of chain regen-all). /generate-images doesn't refund
  // per-scene, so we track only scenes whose regen WE kicked off — preventing
  // misleading "已退回" toasts. State machine: armed → active → resolved.
  // Chain-batch failures are buffered and emitted as one summary toast.
  type RegenTrack = "armed" | "active";
  const regenTrackedRef = useRef<Map<number, RegenTrack>>(new Map());
  const chainBatchActiveRef = useRef(false);
  const chainBatchFailuresRef = useRef<number[]>([]);

  const emitRefundToast = useCallback(
    (sceneNumbers: number[]) => {
      if (sceneNumbers.length === 0) return;
      const perScene = 3;
      if (sceneNumbers.length === 1) {
        toast({
          title: tr("第 {0} 幕重生失敗", { 0: sceneNumbers[0] }),
          description: tr("已自動退回 {0} 積分", { 0: perScene }),
        });
      } else {
        toast({
          title: tr("{0} 幕重生失敗", { 0: sceneNumbers.length }),
          description: tr("已自動退回 {0} 積分（第 {1} 幕）", { 0: sceneNumbers.length * perScene, 1: sceneNumbers.join("、") }),
        });
      }
    },
    [toast],
  );

  const flushChainBatchFailures = useCallback(() => {
    const failures = chainBatchFailuresRef.current;
    chainBatchFailuresRef.current = [];
    emitRefundToast(failures);
  }, [emitRefundToast]);

  useEffect(() => {
    if (!episode) return;
    const scenes: DramaScene[] = JSON.parse(episode.scenes || "[]");

    const newlyFailed: number[] = [];
    scenes.forEach((s, idx) => {
      const trackState = regenTrackedRef.current.get(idx);
      if (trackState === undefined) return;
      const curStatus = s.imageStatus ?? "pending";

      if (trackState === "armed") {
        if (curStatus === "generating") {
          // Backend picked up the regen; arm → active.
          regenTrackedRef.current.set(idx, "active");
        } else if (curStatus === "failed" || curStatus === "completed") {
          // Fast resolve — backend ran the regen between our mutate call
          // and the next poll, so we never observed the intermediate
          // "generating" state. "failed" still counts as a refunded regen
          // failure (the regenerateDramaScene catch always refunds), so
          // toast it; "completed" just untracks silently.
          if (curStatus === "failed") newlyFailed.push(idx + 1);
          regenTrackedRef.current.delete(idx);
        }
        return;
      }
      if (trackState === "active" && curStatus !== "generating") {
        if (curStatus === "failed") {
          newlyFailed.push(idx + 1);
        }
        // Resolved (completed / failed / cancel-restored) — untrack.
        regenTrackedRef.current.delete(idx);
      }
    });

    // If all tracked regens for the active chain batch have already
    // resolved (fast-resolve case where polling never saw any scene as
    // "generating"), flush the buffer right now instead of waiting for
    // chainBatchActive to flip — that flip is gated on
    // chainGeneratingObservedRef which would never have been set.
    const allTrackedResolved = regenTrackedRef.current.size === 0;

    if (newlyFailed.length === 0) {
      if (
        chainBatchActiveRef.current &&
        allTrackedResolved &&
        chainBatchFailuresRef.current.length > 0
      ) {
        flushChainBatchFailures();
      }
      return;
    }

    // Refund already posted server-side — refresh the cached balance so the
    // user immediately sees their credits return.
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });

    if (chainBatchActiveRef.current) {
      // Chain regen-all in flight — buffer.
      chainBatchFailuresRef.current.push(...newlyFailed);
      // Same fast-resolve guard: if this poll resolved the last tracked
      // regen, flush right away rather than waiting for chainBatchActive.
      if (allTrackedResolved) flushChainBatchFailures();
      return;
    }

    // Standalone single-scene regen — toast immediately.
    emitRefundToast(newlyFailed);
  }, [episode, queryClient, emitRefundToast, flushChainBatchFailures]);

  // Mirror `chainBatchActive` into a ref (so the polling effect above can
  // read the latest value without itself re-running on each flip) and flush
  // buffered failures when the batch transitions from active → inactive.
  useEffect(() => {
    const wasActive = chainBatchActiveRef.current;
    chainBatchActiveRef.current = chainBatchActive;
    if (wasActive && !chainBatchActive) {
      flushChainBatchFailures();
    }
  }, [chainBatchActive, flushChainBatchFailures]);

  // Flush any buffered failures on unmount so the user still sees the
  // refund summary toast when navigating away mid-batch.
  useEffect(() => {
    return () => {
      flushChainBatchFailures();
    };
  }, [flushChainBatchFailures]);

  const saveScenesMutation = useMutation({
    mutationFn: (scenes: DramaScene[]) =>
      apiRequest("PATCH", `/api/drama/episodes/${episodeId}`, { scenes }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: tr("分鏡已儲存") });
    },
  });

  // Episode-level Chain Mode (連續模式) — when on, scene N+1 uses scene N's
  // last frame as a Seedream reference and Claude prompt rewriting receives
  // prev/next scene context.
  const setChainModeMutation = useMutation({
    mutationFn: (chainMode: boolean) =>
      apiRequest("PATCH", `/api/drama/episodes/${episodeId}`, { chainMode }).then(r => r.json()),
    onSuccess: (_, chainMode) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: chainMode ? tr("🔗 連續模式已開啟") : tr("連續模式已關閉") });
    },
    onError: (e: any) => toast({ title: tr("設定失敗"), description: e.message, variant: "destructive" }),
  });

  const generateImagesMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/generate-images`, {}).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: tr("開始生成！消耗 {0} 積分", { 0: data.creditCost }) });
    },
    onError: (e: any) => toast({ title: tr("生成失敗"), description: e.message, variant: "destructive" }),
  });

  const regenerateSceneMutation = useMutation({
    mutationFn: ({ sceneIdx, overrides }: { sceneIdx: number; overrides?: any }) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/regenerate-scene/${sceneIdx}`, overrides || {}).then(r => r.json()),
    onMutate: ({ sceneIdx }) => {
      // Arm the refund-toast watcher for this scene index. It will fire if
      // polling later sees the scene transition out of "generating" into
      // "failed".
      regenTrackedRef.current.set(sceneIdx, "armed");
    },
    onSuccess: (_, { sceneIdx }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: tr("第 {0} 幕重新生成中", { 0: sceneIdx + 1 }) });
    },
    onError: (e: any, { sceneIdx }) => {
      // Mutation never reached the server in a state that triggers a refund —
      // drop the tracking entry so a future unrelated failure doesn't toast.
      regenTrackedRef.current.delete(sceneIdx);
      toast({ title: tr("生成失敗"), description: e.message, variant: "destructive" });
    },
  });

  const animateSceneMutation = useMutation({
    mutationFn: ({ sceneIdx, duration, resolution, useOmniMode, useFirstLastFrame }: any) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/animate-scene/${sceneIdx}`, { duration, resolution, useOmniMode, useFirstLastFrame }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: tr("動畫生成中，消耗 {0} 積分", { 0: data.creditCost }) });
      setAnimateDialog(null);
    },
    onError: (e: any) => toast({ title: tr("動畫失敗"), description: e.message, variant: "destructive" }),
  });

  // ─── First/Last Frame Generation ─────────────────────────────────────────
  const generateFramesMutation = useMutation({
    mutationFn: (sceneIdx: number) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/scenes/${sceneIdx}/generate-frames`, {}).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: tr("首尾關鍵幀生成中（-{0} 積分）", { 0: data.creditsUsed }) });
    },
    onError: (e: any) => toast({ title: tr("首尾幀生成失敗"), description: e.message, variant: "destructive" }),
  });

  // ─── AI Video Prompt Rewriter ────────────────────────────────────────────
  const generateVideoPromptMutation = useMutation({
    mutationFn: (sceneIdx: number) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/scenes/${sceneIdx}/generate-video-prompt`, {}).then(r => r.json()),
    onSuccess: (data, sceneIdx) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      // Reflect immediately in local state
      setLocalScenes(prev => prev.map((s, i) => i === sceneIdx ? { ...s, videoPrompt: data.videoPrompt } : s));
      toast({ title: tr("✨ AI 已寫好專業視頻提示詞") });
    },
    onError: (e: any) => toast({ title: tr("AI 生成提示詞失敗"), description: e.message, variant: "destructive" }),
  });

  // Chain Mode: re-regenerate scenes 2..N sequentially using prev frame as ref.
  // Used after enabling 連續模式 on an already-generated episode.
  const regenerateAllChainMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/regenerate-all-chain`, {}).then(r => r.json()),
    onMutate: () => {
      chainGeneratingObservedRef.current = false;
      setChainCancelAcknowledged(false);
      setChainBatchActive(true);
      // Arm refund-toast tracking for every scene the backend will retry.
      // Mirrors the server-side target filter (scenes idx >= 1 whose
      // imageStatus !== "generating") at /regenerate-all-chain.
      if (episode) {
        try {
          const s: DramaScene[] = JSON.parse(episode.scenes || "[]");
          s.forEach((sc, idx) => {
            if (idx >= 1 && sc.imageStatus !== "generating") {
              regenTrackedRef.current.set(idx, "armed");
            }
          });
        } catch { /* ignore parse errors */ }
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({
        title: tr("🔁 連續模式整集重生中"),
        description: tr("將依序重生 {0} 幕，共消耗 {1} 積分", { 0: data.sceneCount, 1: data.creditCost }),
      });
    },
    onError: (e: any) => {
      chainGeneratingObservedRef.current = false;
      setChainBatchActive(false);
      // Server rejected the batch — drop any "armed" entries we just added
      // so an unrelated future failure (e.g. a /generate-images per-scene
      // fail) doesn't trigger a refund toast.
      for (const [k, v] of Array.from(regenTrackedRef.current.entries())) {
        if (v === "armed") regenTrackedRef.current.delete(k);
      }
      chainBatchFailuresRef.current = [];
      toast({ title: tr("整集重生失敗"), description: e.message, variant: "destructive" });
    },
  });

  // Clear the local chain-batch flag once *we have observed* the batch start
  // and then later see no scenes 2..N still generating. Two-phase prevents the
  // race where mutation resolves before the next 3s poll lands.
  useEffect(() => {
    if (!chainBatchActive || regenerateAllChainMutation.isPending || !episode) return;
    const s: DramaScene[] = JSON.parse(episode.scenes || "[]");
    const stillGenerating = s.slice(1).some(x => x.imageStatus === "generating");
    if (stillGenerating) {
      chainGeneratingObservedRef.current = true;
      return;
    }
    if (chainGeneratingObservedRef.current) setChainBatchActive(false);
  }, [episode, chainBatchActive, regenerateAllChainMutation.isPending]);

  // Auto-clear `chainCancelAcknowledged` once the server-side cleanup has
  // settled (no scene 2..N still generating *and* the cancel flag is cleared
  // on the episode). Without this, `blockNewBatch` would stay true forever
  // after a cancel, preventing the user from firing the next 整集重生 batch.
  useEffect(() => {
    if (!chainCancelAcknowledged || !episode) return;
    const s: DramaScene[] = JSON.parse(episode.scenes || "[]");
    const stillGenerating = s.slice(1).some(x => x.imageStatus === "generating");
    if (!stillGenerating && !episode.chainRegenCancelRequested) {
      setChainCancelAcknowledged(false);
    }
  }, [episode, chainCancelAcknowledged]);

  // Cancel an in-flight chain regen-all batch. The current scene finishes,
  // remaining un-started scenes are skipped, and their pre-deducted credits
  // are refunded server-side.
  const cancelChainRegenMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/cancel-chain-regen`, {}).then(r => r.json()),
    onSuccess: () => {
      // Trust the backend: it has either already refunded skipped scenes (and
      // restored their pre-batch imageStatus) or will do so once the in-flight
      // scene wraps up. Suppress the chain-batch UI immediately so the page
      // exits the "整集連續重生中 / 中止中…" state without waiting for the
      // next 3s poll. We can't rely solely on `chainBatchActive` because the
      // server marks every 2..N target as `generating` up front — those flags
      // only get rolled back once the in-flight scene finishes, so the
      // `inFlightAfterFirst >= 2` cross-tab heuristic would keep the pill on
      // screen for episodes with 3+ scenes. `chainCancelAcknowledged` short-
      // circuits that heuristic until the next batch starts.
      chainGeneratingObservedRef.current = false;
      setChainBatchActive(false);
      setChainCancelAcknowledged(true);
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      // Cancellation reverts un-started scenes to their pre-batch status
      // (which can be "failed") and refunds in one batch. Suppress the
      // per-scene refund-toast tracking so we don't double-message — the
      // cancel toast below already covers refund expectations.
      regenTrackedRef.current.clear();
      chainBatchFailuresRef.current = [];
      toast({
        title: tr("🛑 已送出中止請求"),
        description: tr("目前這幕跑完後就會停下，剩餘積分會自動退回"),
      });
    },
    onError: (e: any) => toast({ title: tr("中止失敗"), description: e.message, variant: "destructive" }),
  });

  const animateAllMutation = useMutation({
    mutationFn: ({ duration, resolution, useOmniMode }: any) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/animate-all`, { duration, resolution, useOmniMode, generateAudio: true }).then(r => r.json()),
    onMutate: () => {
      animateGeneratingObservedRef.current = false;
      setAnimateBatchActive(true);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: tr("🎬 開始批次生成 {0} 幕影片", { 0: data.sceneCount }), description: tr("共消耗 {0} 積分，請耐心等候", { 0: data.creditCost }) });
    },
    onError: (e: any) => {
      animateGeneratingObservedRef.current = false;
      setAnimateBatchActive(false);
      toast({ title: tr("批次生成失敗"), description: e.message, variant: "destructive" });
    },
  });

  // Mirror of chainBatchActive clear logic — only drop the local flag once we
  // have observed the batch start (some scene flipped to videoStatus=generating)
  // and then later see no scenes still generating videos.
  useEffect(() => {
    if (!animateBatchActive || animateAllMutation.isPending || !episode) return;
    const s: DramaScene[] = JSON.parse(episode.scenes || "[]");
    const stillGenerating = s.some(x => x.videoStatus === "generating");
    if (stillGenerating) {
      animateGeneratingObservedRef.current = true;
      return;
    }
    if (animateGeneratingObservedRef.current) setAnimateBatchActive(false);
  }, [episode, animateBatchActive, animateAllMutation.isPending]);

  // Cancel an in-flight animate-all batch. The current scene's video finishes,
  // remaining un-started scenes are skipped, and their pre-deducted credits
  // are refunded server-side.
  const cancelAnimateAllMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/cancel-animate-all`, {}).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      // Server returns alreadyDone:true when no /animate-all loop is actually
      // running (e.g. batch already finished, or stale UI click). Don't claim
      // a refund was queued in that case — there is nothing to cancel.
      if (data?.alreadyDone) {
        toast({
          title: tr("批次已結束"),
          description: tr("目前沒有正在進行的整集動畫批次，無需中止"),
        });
        return;
      }
      toast({
        title: tr("🛑 已送出中止請求"),
        description: tr("目前這幕跑完後就會停下，剩餘積分會自動退回"),
      });
    },
    onError: (e: any) => toast({ title: tr("中止失敗"), description: e.message, variant: "destructive" }),
  });

  const compileMutation = useMutation({
    mutationFn: (crossfadeMs: number) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/compile`, { crossfadeMs }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: tr("🎞️ 開始剪接合併"), description: tr("完成後可在下方播放器播放與下載") });
    },
    onError: (e: any) => toast({ title: tr("剪接失敗"), description: e.message, variant: "destructive" }),
  });

  const replaceImageMutation = useMutation({
    mutationFn: ({ sceneIdx, objectPath }: { sceneIdx: number; objectPath: string }) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/replace-scene-image/${sceneIdx}`, { objectPath }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: tr("圖片已替換") });
    },
  });

  const updateScene = (idx: number, updates: Partial<DramaScene>) => {
    setLocalScenes(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s));
  };

  const addScene = () => {
    if (localScenes.length >= 12) { toast({ title: tr("最多 12 幕") }); return; }
    const s: DramaScene = {
      id: nid(), sceneNumber: localScenes.length + 1, title: tr("第 {0} 幕", { 0: localScenes.length + 1 }),
      description: "", dialogue: "", cameraMovement: "", useCharA: true, useCharB: true, imageStatus: "pending",
    };
    setLocalScenes(prev => [...prev, s]);
  };

  const removeScene = (idx: number) => {
    if (localScenes.length <= 2) { toast({ title: tr("最少需要 2 幕") }); return; }
    setLocalScenes(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, sceneNumber: i + 1 })));
    if (selectedIdx === idx) setSelectedIdx(null);
    else if (selectedIdx !== null && selectedIdx > idx) setSelectedIdx(selectedIdx - 1);
  };

  const replaceFileRef = useRef<HTMLInputElement | null>(null);
  const [replaceFromVault, setReplaceFromVault] = useState(false);
  const pendingCount = localScenes.filter(s => s.imageStatus !== "completed").length;
  const creditCost = pendingCount * IMAGE_COST;
  const hasEnoughCredits = (user?.credits ?? 0) >= creditCost;

  const handleGenerateImages = () => {
    saveScenesMutation.mutate(localScenes, {
      onSuccess: () => generateImagesMutation.mutate(),
    });
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (!episode) return <div className="text-center py-20 text-[#ef4444]">{tr("找不到集數")}</div>;

  const serverScenes: DramaScene[] = JSON.parse(episode.scenes || "[]");
  const selectedScene = selectedIdx !== null ? localScenes[selectedIdx] : null;
  const selectedServerScene = selectedIdx !== null ? serverScenes[selectedIdx] : null;

  // Per-scene effective chain mode: episode-level toggle OR per-scene override
  const chainEffective: boolean[] = localScenes.map(s => {
    const ov = s.chainModeOverride ?? "inherit";
    return ov === "on" ? true : ov === "off" ? false : !!episode.chainMode;
  });

  // Where the episode stands in 劇本 → 分鏡圖 → 動畫 → 合成.
  const flowTotal = serverScenes.length;
  const flowImg = serverScenes.filter(sc => sc.imageStatus === "completed").length;
  const flowVid = serverScenes.filter(sc => sc.videoBunnyUrl || sc.videoUrl).length;
  const flowCompiled = episode.compiledStatus === "completed" && !!episode.compiledVideoUrl;
  const flowStage = localScenes.length === 0 ? 1 : flowImg < flowTotal || flowTotal === 0 ? 2 : flowVid < flowTotal ? 3 : flowCompiled ? 5 : 4;
  const flowState = (n: number): "done" | "active" | "todo" => n < flowStage ? "done" : n === flowStage ? "active" : "todo";
  const flowHint = flowStage === 1 ? tr("先新增幕，或讓 AI 寫腳本。")
    : flowStage === 2 ? tr("檢查每一幕的描述與台詞，再生成分鏡圖。")
    : flowStage === 3 ? tr("分鏡圖都好了，可以生成動畫。")
    : flowStage === 4 ? tr("動畫都好了，合成整集影片。") : tr("整集完成，可以下載。");

  // ─── Mobile Layout (single-column + horizontal swipe + bottom sheets) ───
  const renderMobileLayout = () => {
    const totalScenes = localScenes.length;
    const imgDone = serverScenes.filter(s => s.imageStatus === "completed").length;
    const imgGen = serverScenes.filter(s => s.imageStatus === "generating").length;
    const imgFail = serverScenes.filter(s => s.imageStatus === "failed").length;
    const vidTotal = serverScenes.filter(s => s.imageStatus === "completed").length;
    const vidDone = serverScenes.filter(s => s.videoStatus === "completed").length;
    const vidGen = serverScenes.filter(s => s.videoStatus === "generating").length;
    const isCompiling = episode.compiledStatus === "compiling";
    const imgPct = totalScenes > 0 ? Math.round((imgDone / totalScenes) * 100) : 0;
    const vidPct = vidTotal > 0 ? Math.round((vidDone / vidTotal) * 100) : 0;
    const anyBusy = imgGen > 0 || vidGen > 0 || isCompiling || episode.status === "generating";

    return (
      <>
        {/* Mobile Top Bar */}
        <div className="flex items-center gap-2 px-3 h-12 bg-white border-b border-[#e2e8f0] shrink-0">
          <button onClick={onBack} className="text-[#64748b] text-sm shrink-0 px-1" data-testid="mobile-back">←</button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-[#94a3b8] truncate leading-tight">{project?.title}</p>
            <p className="text-sm font-medium text-[#0f172a] truncate leading-tight">{episode.title}</p>
          </div>
          <button
            onClick={() => saveScenesMutation.mutate(localScenes)}
            disabled={saveScenesMutation.isPending}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-[#f1f5f9] text-[#334155] disabled:opacity-50 shrink-0"
            data-testid="mobile-save"
          >
            {saveScenesMutation.isPending ? "…" : "💾"}
          </button>
          <button
            onClick={() => setShowAIDialog(true)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600/10 text-indigo-600 shrink-0"
            data-testid="mobile-ai-script"
          >
            🤖
          </button>
        </div>

        {/* Mobile: where am I in the flow */}
        <div className="bg-white border-b border-[#e2e8f0] px-3 pt-2 pb-1.5 shrink-0" data-testid="mobile-episode-steps">
          <div className="flex items-center gap-1">
            {[tr("劇本"), tr("分鏡圖"), tr("動畫"), tr("合成")].map((t, i) => {
              const st = flowState(i + 1);
              return (
                <span key={t} className={`flex-1 text-center text-[11px] font-semibold py-1 rounded-full ${st === "active" ? "bg-indigo-600 text-white" : st === "done" ? "bg-[#d1fae5] text-[#047857]" : "bg-[#f1f5f9] text-[#94a3b8]"}`}>
                  {st === "done" ? "✓ " : `${i + 1} `}{t}
                </span>
              );
            })}
          </div>
          <p className="text-[11px] text-[#64748b] mt-1.5">{flowHint}</p>
        </div>

        {/* Mobile Progress Bar */}
        <div className="bg-white border-b border-[#e2e8f0] px-4 py-2.5 space-y-2 shrink-0">
          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-[#475569] font-medium">
                {tr("🎨 圖片 {0}/{1}", { 0: imgDone, 1: totalScenes })}
                {imgGen > 0 && <span className="ml-1.5 text-[#ca8a04] animate-pulse">{tr("● {0} 生成中", { 0: imgGen })}</span>}
                {imgFail > 0 && <span className="ml-1.5 text-[#ef4444]">{tr("● {0} 失敗", { 0: imgFail })}</span>}
              </span>
              <span className="text-[#94a3b8]">{imgPct}%</span>
            </div>
            <div className="h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-[#8b5cf6] transition-all"
                style={{ width: `${imgPct}%` }}
              />
            </div>
          </div>
          {vidTotal > 0 && (
            <div>
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-[#475569] font-medium">
                  {tr("🎬 影片 {0}/{1}", { 0: vidDone, 1: vidTotal })}
                  {vidGen > 0 && <span className="ml-1.5 text-[#0ea5e9] animate-pulse">{tr("● {0} 渲染中", { 0: vidGen })}</span>}
                </span>
                <span className="text-[#94a3b8]">{vidPct}%</span>
              </div>
              <div className="h-1.5 bg-[#f1f5f9] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#0ea5e9] to-[#a855f7] transition-all"
                  style={{ width: `${vidPct}%` }}
                />
              </div>
            </div>
          )}
          {isCompiling && (
            <div className="flex items-center gap-2 text-[11px] text-[#7c3aed]">
              <Spinner color="#7c3aed" />
              <span className="animate-pulse">{tr("影片合併中…")}</span>
            </div>
          )}
        </div>

        {/* Mobile Scene Strip — horizontally swipeable, snap-x */}
        <div className="flex-1 overflow-y-hidden bg-[#f8fafc] relative">
          <div
            className="h-full overflow-x-auto overflow-y-hidden flex gap-4 px-5 py-4 snap-x snap-mandatory scroll-smooth"
            style={{ WebkitOverflowScrolling: "touch" }}
            data-testid="mobile-scene-strip"
          >
            {localScenes.map((scene, idx) => {
              const ss = serverScenes[idx];
              const imgUrl = ss ? getSceneImageUrl(ss) : null;
              const vidUrl = ss ? getSceneVideoUrl(ss) : null;
              const statusColor =
                ss?.imageStatus === "completed" ? "#22c55e" :
                ss?.imageStatus === "generating" ? "#ca8a04" :
                ss?.imageStatus === "failed" ? "#ef4444" : "#cbd5e1";
              const statusLabel =
                ss?.imageStatus === "completed" ? tr("完成") :
                ss?.imageStatus === "generating" ? tr("生成中") :
                ss?.imageStatus === "failed" ? tr("失敗") : tr("待生成");
              return (
                <div
                  key={scene.id}
                  className="snap-center shrink-0 w-[78vw] max-w-[340px] flex flex-col"
                  data-testid={`mobile-scene-card-${idx}`}
                >
                  <div
                    {...makeLongPressHandlers(idx)}
                    onClick={() => {
                      if (longPressFiredRef.current) {
                        longPressFiredRef.current = false;
                        return;
                      }
                      setSelectedIdx(idx);
                      setMobileInspectorOpen(true);
                    }}
                    className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-white border-2 shadow-sm active:scale-[0.98] transition-transform select-none"
                    style={{ borderColor: statusColor, touchAction: "pan-x" }}
                  >
                    {imgUrl ? (
                      <img src={imgUrl} alt={scene.title} loading="lazy" decoding="async" className="w-full h-full object-cover pointer-events-none" draggable={false} />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center bg-[#f8fafc]">
                        {ss?.imageStatus === "generating" ? (
                          <><Spinner color="#ca8a04" /><span className="text-xs text-[#ca8a04] mt-2">{tr("生成中")}</span></>
                        ) : ss?.imageStatus === "failed" ? (
                          <span className="text-xs text-[#ef4444]">{tr("⚠ 生成失敗")}</span>
                        ) : (
                          <><span className="text-5xl mb-2">🎬</span><span className="text-xs text-[#94a3b8]">{tr("尚未生成")}</span></>
                        )}
                      </div>
                    )}

                    {/* top-left scene number badge */}
                    <div className="absolute top-2 left-2 bg-[#0f172a]/85 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                      {scene.sceneNumber}
                    </div>
                    {/* status pill */}
                    <div
                      className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full font-medium text-white"
                      style={{ background: statusColor }}
                    >
                      {statusLabel}
                    </div>
                    {/* video badge */}
                    {vidUrl && (
                      <div className="absolute bottom-12 right-2 bg-[#a855f7]/90 text-white text-[10px] px-2 py-0.5 rounded-full">
                        {tr("▶ 影片")}
                      </div>
                    )}
                    {/* chain badge */}
                    {chainEffective[idx] && idx > 0 && (
                      <div className="absolute bottom-12 left-2 bg-[#10b981] text-white text-[10px] px-2 py-0.5 rounded-full font-medium">
                        {tr("🔗 銜接 #{0}", { 0: idx })}
                      </div>
                    )}
                    {/* dark overlay for text */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/75 to-transparent p-3 pointer-events-none">
                      <p className="text-white text-sm font-semibold truncate">{scene.title}</p>
                      <p className="text-white/70 text-[11px] line-clamp-2">{scene.description || tr("（尚未填寫描述）")}</p>
                    </div>
                  </div>

                  {/* Hint text */}
                  <p className="text-center text-[10px] text-[#94a3b8] mt-2">
                    {tr("輕點編輯 · 長按開啟操作")}
                  </p>
                </div>
              );
            })}

            {/* Add scene card */}
            {localScenes.length < 12 && (
              <div className="snap-center shrink-0 w-[78vw] max-w-[340px] flex flex-col">
                <button
                  onClick={addScene}
                  className="aspect-[9/16] rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-white/60 flex flex-col items-center justify-center text-[#94a3b8] active:scale-[0.98] transition-transform"
                  data-testid="mobile-add-scene"
                >
                  <span className="text-5xl mb-2">＋</span>
                  <span className="text-sm font-medium">{tr("新增幕")}</span>
                  <span className="text-[10px] mt-1">{tr("最多 12 幕")}</span>
                </button>
                <p className="text-center text-[10px] text-[#94a3b8] mt-2">{tr("滑動瀏覽分鏡")}</p>
              </div>
            )}
          </div>
        </div>

        {/* Mobile Bottom Action Bar */}
        <div className="bg-white border-t border-[#e2e8f0] pl-3 pr-[76px] py-2 shrink-0 flex items-center gap-2">
          <div className="text-[10px] text-[#94a3b8] flex-1 leading-tight">
            {tr("積分")}<span className="font-semibold text-[#334155]">{user?.credits ?? 0}</span>
            <br />
            {tr("待生成 {0} 幕", { 0: pendingCount })}
          </div>
          {(() => {
            // Animate-all if all images done
            const animatable = serverScenes.filter(s => s.imageStatus === "completed" && s.bunnyUrl && !(s.videoStatus === "completed" && s.videoBunnyUrl) && s.videoStatus !== "generating").length;
            const allVidsDone = serverScenes.length > 0 && serverScenes.every(s => s.videoBunnyUrl || s.videoUrl);
            const showCompile = allVidsDone && !isCompiling;
            if (showCompile) {
              return (
                <button
                  onClick={() => compileMutation.mutate(compileCrossfadeMs)}
                  disabled={compileMutation.isPending}
                  className="px-3 py-2 rounded-lg bg-[#10b981] text-white text-xs font-semibold shrink-0 disabled:opacity-50"
                  data-testid="mobile-compile"
                >
                  {tr("🎞️ 合併影片")}
                </button>
              );
            }
            if (pendingCount === 0 && animatable > 0) {
              const batchCost = animatable * 5 * 8;
              return (
                <button
                  onClick={() => {
                    if (!confirm(tr("為 {0} 幕生成影片（5秒 720P + AI 音效），共消耗 {1} 積分？", { 0: animatable, 1: batchCost }))) return;
                    animateAllMutation.mutate({ duration: 5, resolution: "720p", useOmniMode: false });
                  }}
                  disabled={animateAllMutation.isPending || (user?.credits ?? 0) < batchCost}
                  className="px-3 py-2 rounded-lg bg-[#0ea5e9] text-white text-xs font-semibold shrink-0 disabled:opacity-50"
                  data-testid="mobile-animate-all"
                >
                  {tr("🎬 生成影片 (-{0})", { 0: batchCost })}
                </button>
              );
            }
            return (
              <button
                onClick={handleGenerateImages}
                disabled={!hasEnoughCredits || generateImagesMutation.isPending || pendingCount === 0}
                className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold shrink-0 disabled:opacity-50"
                data-testid="mobile-generate-images"
              >
                {generateImagesMutation.isPending ? "⏳…" : tr("🎨 生成圖片 (-{0})", { 0: creditCost })}
              </button>
            );
          })()}
        </div>

        {/* Tiny status strip */}
        {anyBusy && (
          <div className="bg-[#fef3c7] border-t border-[#fde68a] px-3 py-1 text-[10px] text-[#92400e] text-center shrink-0 animate-pulse">
            {tr("⟳ 背景處理中，可繼續滑動瀏覽")}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="h-[calc(100dvh-48px-56px-env(safe-area-inset-bottom))] md:h-[calc(100vh-56px)] flex flex-col bg-[#f8fafc]">

      {isMobile ? renderMobileLayout() : (<>

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 min-h-12 py-1.5 flex-wrap bg-[#ffffff] border-b border-[#e2e8f0] shrink-0">
        <button onClick={onBack} className="text-[#64748b] hover:text-[#334155] text-sm transition-colors shrink-0">{tr("← 返回")}</button>
        <div className="w-px h-4 bg-[#e2e8f0]" />
        <div className="flex-1 min-w-0">
          <span className="text-xs text-[#94a3b8]">{project?.title} · </span>
          <span className="text-sm font-medium text-[#0f172a]">{episode.title}</span>
          {episode.status === "generating" && (
            <span className="ml-2 text-xs text-[#ca8a04] animate-pulse">{tr("● 生成中")}</span>
          )}
        </div>

        {/* View toggle */}
        <div className="flex gap-1 bg-[#f8fafc] rounded-lg p-0.5">
          <button onClick={() => setActiveView("flow")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeView === "flow" ? "bg-indigo-600 text-white" : "text-[#64748b] hover:text-[#334155]"}`}>
            {tr("⬡ 節點流")}
          </button>
          <button onClick={() => setActiveView("grid")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeView === "grid" ? "bg-indigo-600 text-white" : "text-[#64748b] hover:text-[#334155]"}`}>
            {tr("⊞ 格網")}
          </button>
        </div>

        {/* Episode-level Chain Mode toggle */}
        <button
          onClick={() => setChainModeMutation.mutate(!episode.chainMode)}
          disabled={setChainModeMutation.isPending}
          title={episode.chainMode
            ? tr("連續模式開啟中：第 N+1 幕會自動以第 N 幕的尾幀為主參考，並在 AI 寫提示詞時帶入前後幕 context")
            : tr("點擊開啟連續模式，讓相鄰幕之間視覺與敘事自然銜接")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all shrink-0 ${
            episode.chainMode
              ? "bg-[#10b981]/10 border-[#10b981]/40 text-[#047857]"
              : "bg-[#f8fafc] border-[#e2e8f0] text-[#64748b] hover:border-[#10b981]/40 hover:text-[#047857]"
          } disabled:opacity-50`}
          data-testid="toggle-chain-mode"
        >
          <span>🔗</span>
          <span>{tr("連續模式")}</span>
          <span className={`w-7 h-3.5 rounded-full relative transition-all ${episode.chainMode ? "bg-[#10b981]" : "bg-[#cbd5e1]"}`}>
            <span className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-all ${episode.chainMode ? "left-3.5" : "left-0.5"}`} />
          </span>
        </button>

        <DarkButton variant="secondary" onClick={() => saveScenesMutation.mutate(localScenes)} disabled={saveScenesMutation.isPending}>
          {saveScenesMutation.isPending ? tr("儲存中...") : tr("💾 儲存")}
        </DarkButton>
        {/* Download all assets as ZIP */}
        <a
          href={`/api/drama/episodes/${episodeId}/download-zip`}
          download
          className="text-xs font-medium text-[#475569] bg-[#f1f5f9] hover:bg-[#e2e8f0] px-3 py-1.5 rounded-md transition-colors shrink-0 border border-[#e2e8f0]"
          data-testid="link-download-zip"
        >
          {tr("📦 下載素材 ZIP")}
        </a>
      </div>

      {/* ── 流程列：每一步自己的動作都放在那一步 ─────────────────────────── */}
      <div className="flex flex-wrap items-stretch gap-2 px-4 py-2 bg-white border-b border-[#e2e8f0] shrink-0" data-testid="episode-steps">
        <FlowStep n={1} title={tr("劇本")} meta={tr("{0} 幕（最多 12）", { 0: localScenes.length })} state={flowState(1)}>
        <DarkButton variant="secondary" onClick={() => setShowAIDialog(true)}
          style={{ background: "#6366f110", borderColor: "#6366f140", color: "#4f46e5" }}>
          {tr("🤖 AI 寫腳本")}
        </DarkButton>

        <DarkButton variant="secondary" onClick={addScene} disabled={localScenes.length >= 12}>{tr("＋ 新增幕")}</DarkButton>
        </FlowStep>
        <FlowStep n={2} title={tr("分鏡圖")} meta={tr("{0}/{1} 完成・每幕 {2} 積分", { 0: flowImg, 1: flowTotal, 2: IMAGE_COST })} state={flowState(2)}>
        <DarkButton
          onClick={handleGenerateImages}
          disabled={!hasEnoughCredits || generateImagesMutation.isPending || pendingCount === 0}
        >
          {generateImagesMutation.isPending ? tr("⏳ 生成中...") : tr("🎨 生成分鏡圖（{0} 積分）", { 0: creditCost })}
        </DarkButton>
        {!hasEnoughCredits && creditCost > 0 && (
          <span className="text-xs text-[#ef4444] shrink-0">{tr("積分不足")}</span>
        )}

        {/* One-click: re-apply chain mode to the whole episode */}
        {episode.chainMode && serverScenes.length >= 2 && (() => {
          const firstReady = serverScenes[0]?.imageStatus === "completed" && (serverScenes[0]?.bunnyUrl || serverScenes[0]?.imageUrl);
          // Targets: scenes 2..N excluding ones already in flight
          const targets = serverScenes.slice(1).filter(s => s.imageStatus !== "generating");
          const inFlightAfterFirst = serverScenes.slice(1).filter(s => s.imageStatus === "generating").length;
          const chainCost = targets.length * IMAGE_COST;
          const insufficient = (user?.credits ?? 0) < chainCost;
          const totalChainTargets = serverScenes.length - 1;
          const completedAfterFirst = serverScenes.slice(1).filter(s => s.imageStatus === "completed").length;
          // Cancel was acknowledged either locally (this tab just fired and
          // got 200 back) or via the persisted server flag (any other tab /
          // refresh). While true, we hide the chain-batch UI immediately even
          // though scenes 2..N are still marked `generating` server-side —
          // they only roll back after the in-flight scene wraps up.
          const cancelInProgress =
            chainCancelAcknowledged || !!episode.chainRegenCancelRequested;
          // Batch in progress if: this tab fired the mutation AND any scene 2..N
          // is still generating; or the mutation request itself is pending; or as
          // a cross-tab/refresh fallback ≥2 of scenes 2..N are concurrently in
          // flight (a single-scene regen would only ever have 1).
          const isChainBatchRunning =
            !cancelInProgress &&
            (regenerateAllChainMutation.isPending ||
              (chainBatchActive && inFlightAfterFirst > 0) ||
              inFlightAfterFirst >= 2);
          // Don't let users fire a second batch while any post-anchor scene is
          // still generating — would silently double-charge them. We keep this
          // active during cancel cleanup too so the "🔁 整集重生" button doesn't
          // pop back in while remaining scenes are being rolled back.
          const blockNewBatch =
            isChainBatchRunning || inFlightAfterFirst > 0 || cancelInProgress;

          if (isChainBatchRunning) {
            const cancelRequested = !!episode.chainRegenCancelRequested;
            return (
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className="text-xs text-[#047857] bg-[#10b981]/10 border border-[#10b981]/40 px-3 py-1.5 rounded-lg animate-pulse"
                  data-testid="status-chain-regen-progress"
                >
                  {tr("🔁 整集連續重生中 {0}/{1}", { 0: completedAfterFirst, 1: totalChainTargets })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (cancelChainRegenMutation.isPending || cancelRequested) return;
                    if (!confirm(tr("中止後，目前這幕跑完就會停下，剩下未開始的幕不再執行，已扣積分會退回。確定中止？"))) return;
                    cancelChainRegenMutation.mutate();
                  }}
                  disabled={cancelChainRegenMutation.isPending || cancelRequested}
                  title={cancelRequested
                    ? tr("已送出中止請求，等目前這幕跑完就會停")
                    : tr("中止整集連續重生：跑完當前這幕後停下，未開始的幕積分會退回")}
                  className="text-xs px-2.5 py-1.5 rounded-lg border bg-[#fef2f2] border-[#fecaca] text-[#b91c1c] hover:bg-[#fee2e2] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  data-testid="button-cancel-chain-regen"
                >
                  {cancelRequested ? tr("⏳ 中止中…") : tr("🛑 中止")}
                </button>
              </div>
            );
          }

          if (!firstReady || targets.length === 0 || blockNewBatch) return null;

          return (
            <>
              <span title={tr("從第 2 幕起，依序以上一幕尾幀為參考重生整集，讓視覺自然銜接")} className="shrink-0">
                <DarkButton
                  variant="secondary"
                  onClick={() => {
                    if (!confirm(tr("即將從第 2 幕開始依序重生 {0} 幕，每幕以上一幕的尾幀為參考，共消耗 {1} 積分。確定？", { 0: targets.length, 1: chainCost }))) return;
                    regenerateAllChainMutation.mutate();
                  }}
                  disabled={insufficient}
                  style={{ background: "#10b98110", borderColor: "#10b98140", color: "#047857" }}
                  data-testid="button-regenerate-all-chain"
                >
                  {tr("🔁 整集重生（{0} 積分）", { 0: chainCost })}
                </DarkButton>
              </span>
              {insufficient && (
                <span className="text-xs text-[#ef4444] shrink-0">{tr("積分不足")}</span>
              )}
            </>
          );
        })()}

        </FlowStep>
        <FlowStep n={3} title={tr("動畫")} meta={tr("{0}/{1} 完成", { 0: flowVid, 1: flowTotal })} state={flowState(3)}>
        {/* Batch animate all scenes */}
        {(() => {
          const animatable = serverScenes.filter(s => s.imageStatus === "completed" && s.bunnyUrl && !(s.videoStatus === "completed" && s.videoBunnyUrl) && s.videoStatus !== "generating").length;
          const generatingCount = serverScenes.filter(s => s.videoStatus === "generating").length;
          const totalVideoTargets = serverScenes.filter(s => s.imageStatus === "completed" && s.bunnyUrl).length;
          const completedVideos = serverScenes.filter(s => s.videoStatus === "completed" && s.videoBunnyUrl).length;
          const batchCost = animatable * 5 * 8; // 5s @ 720p
          // Authoritative: server-persisted `animateAllInProgress` flag, set
          // when /animate-all dispatches and cleared when the loop ends. This
          // intentionally does NOT fall back to "≥2 scenes generating" — that
          // heuristic would falsely fire when users start multiple ordinary
          // per-scene animations in parallel, and the cancel endpoint cannot
          // refund those (they aren't driven by the cancellable batch loop).
          // Local `animateBatchActive` covers the brief window between the
          // POST resolving and the next poll observing the flag.
          const isAnimateBatchRunning =
            animateAllMutation.isPending ||
            !!episode.animateAllInProgress ||
            (animateBatchActive && generatingCount > 0);

          if (isAnimateBatchRunning) {
            const cancelRequested = !!episode.animateAllCancelRequested;
            return (
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className="text-xs text-[#0369a1] bg-[#0ea5e9]/10 border border-[#0ea5e9]/40 px-3 py-1.5 rounded-lg animate-pulse"
                  data-testid="status-animate-all-progress"
                >
                  {tr("🎬 整集動畫生成中 {0}/{1}", { 0: completedVideos, 1: totalVideoTargets })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (cancelAnimateAllMutation.isPending || cancelRequested) return;
                    if (!confirm(tr("中止後，目前這幕影片跑完就會停下，剩下未開始的幕不再執行，已扣積分會退回。確定中止？"))) return;
                    cancelAnimateAllMutation.mutate();
                  }}
                  disabled={cancelAnimateAllMutation.isPending || cancelRequested}
                  title={cancelRequested
                    ? tr("已送出中止請求，等目前這幕跑完就會停")
                    : tr("中止整集動畫批次：跑完當前這幕後停下，未開始的幕積分會退回")}
                  className="text-xs px-2.5 py-1.5 rounded-lg border bg-[#fef2f2] border-[#fecaca] text-[#b91c1c] hover:bg-[#fee2e2] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  data-testid="button-cancel-animate-all"
                >
                  {cancelRequested ? tr("⏳ 中止中…") : tr("🛑 中止")}
                </button>
              </div>
            );
          }

          return animatable > 0 ? (
            <DarkButton
              onClick={() => {
                if (!confirm(tr("即將為 {0} 幕生成影片（5秒 720P + AI 音效），共消耗 {1} 積分，確定？", { 0: animatable, 1: batchCost }))) return;
                animateAllMutation.mutate({ duration: 5, resolution: "720p", useOmniMode: false });
              }}
              disabled={animateAllMutation.isPending || (user?.credits ?? 0) < batchCost}
              style={{ background: "#0ea5e9", borderColor: "#0ea5e9" }}
            >
              {animateAllMutation.isPending ? tr("⏳ 派發中...") : tr("🎬 生成全部動畫（{0} 積分）", { 0: batchCost })}
            </DarkButton>
          ) : null;
        })()}

          {flowImg === 0 && <span className="text-[11px] text-[#94a3b8]">{tr("先完成分鏡圖")}</span>}
        </FlowStep>
        <FlowStep n={4} title={tr("合成")} meta={flowCompiled ? tr("已完成") : tr("剪接＋字幕")} state={flowState(4)}>
        {/* Compile (stitch + subtitles) */}
        {(() => {
          const allDone = serverScenes.length > 0 && serverScenes.every(s => s.videoBunnyUrl || s.videoUrl);
          const isCompiling = episode.compiledStatus === "compiling";
          if (!allDone && !isCompiling) return null;
          // Discrete crossfade stops (ms) — slider snaps to one of these by index.
          const crossfadeStops = [0, 200, 400, 800] as const;
          const foundIdx = crossfadeStops.findIndex(v => v === compileCrossfadeMs);
          // Fall back to the 400ms stop (index 2) if state ever drifts to a value
          // outside the slider's discrete domain.
          const safeIdx = foundIdx === -1 ? 2 : foundIdx;
          const fadeDisabled = isCompiling || compileMutation.isPending;
          return (
            <div className="flex items-center gap-2 shrink-0">
              <div
                className="flex items-center gap-2 bg-[#f0fdf4] border border-[#10b981]/30 rounded-lg px-3 py-1.5"
                title={tr("相鄰幕之間的轉場淡入淡出時間（影像 + 音訊），0=硬切")}
                data-testid="group-crossfade-slider"
              >
                <span className="text-[11px] text-[#047857] font-medium select-none whitespace-nowrap">
                  {tr("轉場")}
                </span>
                <Slider
                  className="w-28"
                  min={0}
                  max={crossfadeStops.length - 1}
                  step={1}
                  value={[safeIdx]}
                  onValueChange={(v) => {
                    const i = Math.round(v[0] ?? safeIdx);
                    setCompileCrossfadeMs(crossfadeStops[i] ?? 400);
                  }}
                  disabled={fadeDisabled}
                  data-testid="slider-crossfade-ms"
                />
                <span
                  className="text-[11px] text-[#047857] font-semibold tabular-nums select-none whitespace-nowrap min-w-[3.5rem] text-right"
                  data-testid="text-crossfade-value"
                >
                  {compileCrossfadeMs === 0 ? tr("硬切") : `${compileCrossfadeMs}ms`}
                </span>
              </div>
              <DarkButton
                onClick={() => {
                  const fadeNote = compileCrossfadeMs > 0
                    ? tr("（含 {0}ms 轉場淡入淡出）", { 0: compileCrossfadeMs })
                    : tr("（硬切）");
                  if (!confirm(tr("即將剪接合併 {0} 幕影片並燒入字幕{1}，約需 1-3 分鐘。確定？", { 0: serverScenes.length, 1: fadeNote }))) return;
                  compileMutation.mutate(compileCrossfadeMs);
                }}
                disabled={fadeDisabled}
                style={{ background: "#10b981", borderColor: "#10b981" }}
                data-testid="btn-compile-episode"
              >
                {isCompiling ? tr("⏳ 剪接中...") : episode.compiledVideoUrl ? tr("🎞 重新剪接") : tr("🎞 剪接合併＋字幕")}
              </DarkButton>
            </div>
          );
        })()}

          {flowVid < flowTotal || flowTotal === 0 ? <span className="text-[11px] text-[#94a3b8]">{tr("全部動畫完成後開放")}</span> : null}
        </FlowStep>
        <span className="self-center text-xs text-[#64748b] pl-1" data-testid="episode-flow-hint">{flowHint}</span>
      </div>

      {/* ── Compiled Episode Player ─────────────────────────────────────────── */}
      {(episode.compiledVideoUrl || episode.compiledStatus === "compiling" || episode.compiledStatus === "failed") && (
        <div className="px-4 py-3 bg-[#ecfdf5] border-b border-[#10b98140] shrink-0">
          {episode.compiledStatus === "compiling" && (
            <div className="flex items-center gap-2 text-sm text-[#047857]">
              <Spinner /> <span>{tr("正在剪接合併並燒字幕，約需 1-3 分鐘…")}</span>
            </div>
          )}
          {episode.compiledStatus === "failed" && (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-[#dc2626]">{tr("❌ 剪接失敗：{0}", { 0: episode.compiledError })}</div>
              <DarkButton variant="secondary" onClick={() => compileMutation.mutate(compileCrossfadeMs)}>{tr("重試")}</DarkButton>
            </div>
          )}
          {episode.compiledStatus === "completed" && episode.compiledVideoUrl && (
            <div className="flex items-center gap-4">
              <video
                src={episode.compiledVideoUrl}
                controls
                className="h-32 w-auto rounded-md bg-black shrink-0"
                data-testid="video-compiled-episode"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#047857]">{tr("✅ 完整漫劇影片已生成")}</div>
                <div className="text-xs text-[#64748b] truncate">{episode.compiledVideoUrl}</div>
              </div>
              <a
                href={episode.compiledVideoUrl}
                download
                className="text-sm font-medium text-white bg-[#10b981] hover:bg-[#059669] px-4 py-2 rounded-md transition-colors shrink-0"
                data-testid="link-download-compiled"
              >
                {tr("⬇ 下載 MP4")}
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── Main Workspace ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Canvas Area */}
        <div className="flex-1 overflow-auto p-6 relative">

          {/* Background grid */}
          <div className="absolute inset-0 opacity-30"
            style={{ backgroundImage: "radial-gradient(circle, #cbd5e1 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

          {activeView === "flow" ? (
            <div className="relative z-10">
              {/* Pipeline labels */}
              <div className="flex items-center gap-2 mb-4">
                {[tr("📝 分鏡描述"), "→", tr("🖼 Seedream 出圖"), "→", tr("🎬 WAN 動畫")].map((s, i) => (
                  <span key={i} className={`text-xs ${s === "→" ? "text-[#cbd5e1]" : "bg-[#ffffff] border border-[#e2e8f0] px-3 py-1 rounded-full text-[#64748b]"}`}>
                    {s}
                  </span>
                ))}
              </div>

              {/* Scene flow */}
              <SceneFlowCanvas
                scenes={localScenes}
                serverScenes={serverScenes}
                selectedIdx={selectedIdx}
                onSelect={idx => setSelectedIdx(selectedIdx === idx ? null : idx)}
                chainEffective={chainEffective}
              />

              {/* Legend */}
              <div className="flex items-center gap-4 mt-4">
                {[
                  { color: "#cbd5e1", label: tr("待生成") },
                  { color: "#ca8a04", label: tr("生成中") },
                  { color: "#22c55e", label: tr("完成") },
                  { color: "#ef4444", label: tr("失敗") },
                  { color: "#6366f1", label: tr("已選取") },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                    <span className="text-[10px] text-[#94a3b8]">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Grid view */
            <div className="relative z-10 grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {localScenes.map((scene, idx) => {
                const ss = serverScenes[idx];
                const imgUrl = ss ? getSceneImageUrl(ss) : null;
                const isSelected = selectedIdx === idx;
                const statusColor = ss?.imageStatus === "completed" ? "#22c55e" : ss?.imageStatus === "generating" ? "#ca8a04" : ss?.imageStatus === "failed" ? "#ef4444" : "#cbd5e1";
                return (
                  <div key={scene.id} onClick={() => setSelectedIdx(isSelected ? null : idx)}
                    className="cursor-pointer rounded-xl border-2 overflow-hidden transition-all"
                    style={{ borderColor: isSelected ? "#6366f1" : statusColor, boxShadow: isSelected ? "0 0 16px rgba(99,102,241,0.3)" : "none" }}>
                    <div className="aspect-[9/16] bg-[#f8fafc] relative">
                      {imgUrl ? (
                        <img src={imgUrl} alt={scene.title} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center">
                          {ss?.imageStatus === "generating" ? (
                            <><Spinner color="#ca8a04" /><span className="text-xs text-[#ca8a04] mt-2">{tr("生成中")}</span></>
                          ) : <span className="text-3xl">🎬</span>}
                        </div>
                      )}
                      <div className="absolute top-1.5 left-1.5 bg-[#0f172a]/85 text-white text-[10px] px-1.5 py-0.5 rounded-full">{scene.sceneNumber}</div>
                      {ss?.videoStatus === "completed" && <div className="absolute top-1.5 right-1.5 bg-[#a855f7]/80 text-white text-[10px] px-1.5 py-0.5 rounded-full">▶</div>}
                      {chainEffective[idx] && idx > 0 && (
                        <div
                          className="absolute bottom-1.5 left-1.5 bg-[#10b981] text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium shadow"
                          title={tr("銜接第 {0} 幕的尾幀", { 0: idx })}
                        >
                          {tr("🔗 銜接 #{0}", { 0: idx })}
                        </div>
                      )}
                    </div>
                    <div className="p-2 bg-[#ffffff]">
                      <p className="text-[10px] text-[#64748b] truncate">{scene.title}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right Inspector Panel ─────────────────────────────────────────── */}
        {selectedScene ? (
          <div className="w-72 bg-[#ffffff] border-l border-[#e2e8f0] flex flex-col shrink-0 overflow-hidden">
            {/* Inspector header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e2e8f0]">
              <div>
                <span className="text-xs text-indigo-500 font-mono">SCENE {(selectedIdx ?? 0) + 1}</span>
                <p className="text-sm font-semibold text-[#0f172a] mt-0.5">{tr("場景屬性")}</p>
              </div>
              <button onClick={() => setSelectedIdx(null)} className="text-[#94a3b8] hover:text-[#334155] text-lg">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Image preview */}
              {selectedServerScene && getSceneImageUrl(selectedServerScene) && (
                <div className="rounded-xl overflow-hidden border border-[#e2e8f0]">
                  <img src={getSceneImageUrl(selectedServerScene)!} alt="scene" className="w-full object-cover" />
                </div>
              )}
              {selectedServerScene && getSceneVideoUrl(selectedServerScene) && (
                <div className="rounded-xl overflow-hidden border border-[#e2e8f0]">
                  <video src={getSceneVideoUrl(selectedServerScene)!} controls className="w-full" />
                </div>
              )}

              {/* Scene title */}
              <div>
                <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("幕名稱")}</label>
                <DarkInput
                  value={selectedScene.title}
                  onChange={v => updateScene(selectedIdx!, { title: v })}
                  placeholder={tr("幕名稱")}
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("場景描述")}</label>
                <DarkTextarea
                  value={selectedScene.description}
                  onChange={v => updateScene(selectedIdx!, { description: v })}
                  placeholder={tr("描述場景內容，AI 將根據此生成圖片...")}
                  rows={4}
                />
              </div>

              {/* Prompt Snippets Library */}
              <PromptSnippetsPanel
                onInsert={text => {
                  const cur = selectedScene.description.trim();
                  const sep = cur && !cur.endsWith("，") && !cur.endsWith("。") ? "，" : "";
                  updateScene(selectedIdx!, { description: cur + sep + text });
                }}
              />

              {/* Dialogue */}
              <div>
                <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("台詞（選填）")}</label>
                <DarkInput
                  value={selectedScene.dialogue || ""}
                  onChange={v => updateScene(selectedIdx!, { dialogue: v })}
                  placeholder={tr("人物台詞")}
                />
              </div>

              {/* Camera movement */}
              <div>
                <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("攝影機運鏡")}</label>
                <DarkSelect
                  value={selectedScene.cameraMovement || "none"}
                  onChange={v => updateScene(selectedIdx!, { cameraMovement: v === "none" ? "" : v })}
                  options={CAMERA_MOVEMENTS}
                />
              </div>

              {/* Character toggles */}
              {((project?.characterAUrls ?? []).length > 0 || (project?.characterBUrls ?? []).length > 0) && (
                <div>
                  <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("角色出場")}</label>
                  <div className="flex gap-2">
                    {(project?.characterAUrls ?? []).length > 0 && (
                      <button onClick={() => updateScene(selectedIdx!, { useCharA: !selectedScene.useCharA })}
                        className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${selectedScene.useCharA ? "bg-indigo-600/10 border-indigo-500/40 text-indigo-600" : "border-[#cbd5e1] text-[#94a3b8]"}`}>
                        {tr("角色A {0}", { 0: selectedScene.useCharA ? "✓" : "×" })}
                      </button>
                    )}
                    {(project?.characterBUrls ?? []).length > 0 && (
                      <button onClick={() => updateScene(selectedIdx!, { useCharB: !selectedScene.useCharB })}
                        className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${selectedScene.useCharB ? "bg-[#f59e0b]/10 border-[#f59e0b]/40 text-[#d97706]" : "border-[#cbd5e1] text-[#94a3b8]"}`}>
                        {tr("角色B {0}", { 0: selectedScene.useCharB ? "✓" : "×" })}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Separator */}
              <div className="border-t border-[#e2e8f0]" />

              {/* Global library pickers (cross-episode reuse) */}
              <LibraryPickers
                scene={selectedScene}
                onUpdate={(patch) => updateScene(selectedIdx!, patch)}
              />

              {/* Separator */}
              <div className="border-t border-[#e2e8f0]" />

              {/* AI Video Prompt */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] text-[#64748b] uppercase tracking-wide">{tr("視頻提示詞（影片生成用）")}</label>
                  <button
                    onClick={() => generateVideoPromptMutation.mutate(selectedIdx!)}
                    disabled={generateVideoPromptMutation.isPending || !selectedScene.description.trim()}
                    className="text-[10px] text-[#7c3aed] hover:text-[#6d28d9] disabled:text-[#cbd5e1] flex items-center gap-1"
                    data-testid="button-ai-video-prompt"
                  >
                    {generateVideoPromptMutation.isPending ? tr("AI 撰寫中…") : tr("✨ AI 寫提示詞")}
                  </button>
                </div>
                <DarkTextarea
                  value={selectedScene.videoPrompt || ""}
                  onChange={v => updateScene(selectedIdx!, { videoPrompt: v })}
                  placeholder={tr("留空＝用場景描述。填入＝動畫優先用此（含運鏡、景別、光線）")}
                  rows={3}
                />
              </div>

              {/* Per-scene Chain Mode override (跨幕銜接) */}
              {selectedIdx !== null && selectedIdx > 0 && (() => {
                const ov = (selectedScene.chainModeOverride ?? "inherit") as "inherit" | "on" | "off";
                const effective =
                  ov === "on" ? true :
                  ov === "off" ? false :
                  !!episode.chainMode;
                const prev = serverScenes[selectedIdx - 1];
                const prevLast = prev?.lastFrameBunnyUrl || prev?.lastFrameUrl;
                const prevFirst = prev?.firstFrameBunnyUrl || prev?.firstFrameUrl;
                const prevMain = prev?.bunnyUrl || prev?.imageUrl;
                const fallbackUrl = prevLast || prevMain || null;

                const refSource = (selectedScene.chainRefSource ?? "auto") as
                  "auto" | "prevLast" | "prevFirst" | "prevMain" | "custom";
                const customUrl = selectedScene.chainRefCustomUrl;

                // Mirror the backend resolution logic so the preview matches
                // exactly what processDramaEpisode / regenerate will pick.
                let resolvedUrl: string | null = null;
                let resolvedLabel = "";
                if (customUrl) {
                  resolvedUrl = customUrl;
                  resolvedLabel = tr("自訂上傳圖");
                } else if (refSource === "custom") {
                  resolvedUrl = fallbackUrl;
                  resolvedLabel = fallbackUrl
                    ? tr("（尚未上傳自訂圖，暫用自動回退）")
                    : tr("（尚未上傳自訂圖）");
                } else if (refSource === "prevLast") {
                  resolvedUrl = prevLast || fallbackUrl;
                  resolvedLabel = prevLast ? tr("第 {0} 幕尾幀", { 0: selectedIdx }) : tr("（尾幀缺失，回退）");
                } else if (refSource === "prevFirst") {
                  resolvedUrl = prevFirst || fallbackUrl;
                  resolvedLabel = prevFirst ? tr("第 {0} 幕首幀", { 0: selectedIdx }) : tr("（首幀缺失，回退）");
                } else if (refSource === "prevMain") {
                  resolvedUrl = prevMain || fallbackUrl;
                  resolvedLabel = prevMain ? tr("第 {0} 幕主圖", { 0: selectedIdx }) : tr("（主圖缺失，回退）");
                } else {
                  resolvedUrl = fallbackUrl;
                  resolvedLabel = prevLast
                    ? tr("自動：第 {0} 幕尾幀", { 0: selectedIdx })
                    : prevMain
                    ? tr("自動：第 {0} 幕主圖", { 0: selectedIdx })
                    : "";
                }

                return (
                  <div className="rounded-xl border border-[#e2e8f0] p-3 space-y-2.5 bg-[#f0fdf4]">
                    <div>
                      <p className="text-xs font-semibold text-[#0f172a]">
                        {tr("🔗 銜接上一幕")}
                        {effective && <span className="ml-1 text-[10px] text-[#047857]">{tr("·啟用中")}</span>}
                      </p>
                      <p className="text-[10px] text-[#64748b] mt-0.5">
                        {tr("指定一張參考圖，讓本幕構圖自然延續")}
                      </p>
                    </div>

                    <div className="flex gap-1 bg-white rounded-lg p-0.5 border border-[#e2e8f0]">
                      {([
                        { v: "inherit", label: tr("跟隨集設定（目前 {0}）", { 0: episode.chainMode ? "開" : "關" }) },
                        { v: "on", label: tr("強制開") },
                        { v: "off", label: tr("強制關") },
                      ] as const).map(o => (
                        <button
                          key={o.v}
                          onClick={() => updateScene(selectedIdx!, { chainModeOverride: o.v })}
                          className={`flex-1 text-[10px] py-1 rounded-md transition-all ${
                            ov === o.v
                              ? "bg-[#10b981] text-white font-medium"
                              : "text-[#64748b] hover:text-[#334155]"
                          }`}
                          data-testid={`chain-override-${o.v}`}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>

                    {effective && (
                      <>
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#64748b] uppercase tracking-wide">
                            {tr("銜接來源")}
                          </label>
                          <select
                            value={refSource}
                            onChange={e => updateScene(selectedIdx!, {
                              chainRefSource: e.target.value as DramaScene["chainRefSource"],
                            })}
                            data-testid="select-chain-ref-source"
                            className="w-full bg-white border border-[#cbd5e1] rounded-lg px-2 py-1 text-[11px] text-[#0f172a] focus:outline-none focus:border-[#10b981]"
                          >
                            <option value="auto">{tr("自動（尾幀 → 主圖）")}</option>
                            <option value="prevLast">{tr("上一幕尾幀")}</option>
                            <option value="prevFirst">{tr("上一幕首幀")}</option>
                            <option value="prevMain">{tr("上一幕主圖")}</option>
                            <option value="custom">{tr("自訂上傳圖")}</option>
                          </select>
                          {/* Bulk apply: copy this refSource + chainModeOverride
                              to every other scene from #2 onwards. Saves users
                              from clicking through every幕 to set the same
                              continuity behaviour. */}
                          <button
                            type="button"
                            onClick={() => {
                              if (refSource === "custom") {
                                toast({
                                  title: tr("無法批次套用「自訂上傳圖」"),
                                  description: tr("自訂圖每幕不同，請改選其他來源再套用。"),
                                  variant: "destructive",
                                });
                                return;
                              }
                              const targetCount = Math.max(0, localScenes.length - 1);
                              if (targetCount === 0) return;
                              if (!confirm(tr("將目前的銜接設定（來源：{0}、模式：{1}）套用至全部 {2} 幕？", { 0: refSource, 1: ov, 2: targetCount }))) return;
                              setLocalScenes(prev => prev.map((s, i) =>
                                i === 0
                                  ? s
                                  : { ...s, chainRefSource: refSource as DramaScene["chainRefSource"], chainModeOverride: ov as DramaScene["chainModeOverride"] }
                              ));
                              toast({ title: tr("✅ 已套用至 {0} 幕，記得按「💾 儲存」", { 0: targetCount }) });
                            }}
                            className="w-full mt-1 text-[10px] py-1 rounded-md border border-[#10b981]/40 text-[#047857] bg-[#10b981]/5 hover:bg-[#10b981]/10 transition-colors"
                            data-testid="button-apply-chain-to-all"
                            title={tr("把目前這幕的銜接來源與模式套用到其他每一幕")}
                          >
                            {tr("⤵ 套用至全部幕（{0} 幕）", { 0: Math.max(0, localScenes.length - 1) })}
                          </button>
                        </div>

                        <ChainRefCustomUploader
                          customUrl={customUrl}
                          onChange={(url) => updateScene(selectedIdx!, {
                            chainRefCustomUrl: url || undefined,
                            // Auto-switch source to "custom" on upload so the
                            // dropdown label reflects what's actually used.
                            chainRefSource: url ? "custom" : (refSource === "custom" ? "auto" : refSource),
                          })}
                        />

                        {resolvedUrl ? (
                          <div className="flex items-center gap-2">
                            <img
                              src={resolvedUrl}
                              alt={tr("銜接參考")}
                              className="w-12 h-20 object-cover rounded border border-[#10b981]/40 shrink-0"
                            />
                            <p className="text-[10px] text-[#475569]">
                              {resolvedLabel}<br />
                              <span className="text-[#94a3b8]">{tr("（重生本幕後構圖會接續）")}</span>
                            </p>
                          </div>
                        ) : (
                          <p className="text-[10px] text-[#ca8a04]">
                            {tr("⚠ 沒有可用的銜接參考圖，請上傳自訂圖或等上一幕生成完成")}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* First / Last Frame Mode */}
              <div className="rounded-xl border border-[#e2e8f0] p-3 space-y-3 bg-[#f8fafc]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-[#0f172a]">{tr("🎞 首尾關鍵幀模式")}</p>
                    <p className="text-[10px] text-[#64748b] mt-0.5">{tr("先生兩張關鍵幀，影片更平順")}</p>
                  </div>
                  <button
                    onClick={() => updateScene(selectedIdx!, { useFirstLastFrame: !selectedScene.useFirstLastFrame })}
                    className={`w-10 h-6 rounded-full relative shrink-0 transition-all ${selectedScene.useFirstLastFrame ? "bg-indigo-600" : "bg-[#e2e8f0]"}`}
                    data-testid="toggle-use-first-last"
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${selectedScene.useFirstLastFrame ? "left-5" : "left-1"}`} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(["first", "last"] as const).map(which => {
                    const url = which === "first"
                      ? (selectedServerScene?.firstFrameBunnyUrl || selectedServerScene?.firstFrameUrl)
                      : (selectedServerScene?.lastFrameBunnyUrl || selectedServerScene?.lastFrameUrl);
                    const status = which === "first" ? selectedServerScene?.firstFrameStatus : selectedServerScene?.lastFrameStatus;
                    return (
                      <div key={which} className="aspect-[9/16] rounded-lg border border-[#e2e8f0] bg-white overflow-hidden flex flex-col items-center justify-center">
                        {url ? (
                          <img src={url} alt={which} className="w-full h-full object-cover" />
                        ) : status === "generating" ? (
                          <><Spinner color="#ca8a04" /><span className="text-[10px] text-[#ca8a04] mt-1">{tr("生成中")}</span></>
                        ) : status === "failed" ? (
                          <span className="text-[10px] text-[#ef4444]">{tr("失敗")}</span>
                        ) : (
                          <span className="text-[10px] text-[#94a3b8]">{which === "first" ? tr("首幀") : tr("尾幀")}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <DarkButton
                  variant="secondary"
                  className="w-full justify-center"
                  onClick={() => generateFramesMutation.mutate(selectedIdx!)}
                  disabled={
                    generateFramesMutation.isPending
                    || !selectedScene.description.trim()
                    || (user?.credits ?? 0) < 6
                    || selectedServerScene?.firstFrameStatus === "generating"
                    || selectedServerScene?.lastFrameStatus === "generating"
                  }
                  data-testid="button-generate-frames"
                >
                  {generateFramesMutation.isPending ? tr("派發中…") :
                   (selectedServerScene?.firstFrameUrl && selectedServerScene?.lastFrameUrl) ? tr("🔄 重新生成首尾幀 (-6積分)") : tr("🎞 生成首尾幀 (-6積分)")}
                </DarkButton>
              </div>

              {/* Separator */}
              <div className="border-t border-[#e2e8f0]" />

              {/* Actions */}
              <div className="space-y-2">
                <p className="text-[10px] text-[#64748b] uppercase tracking-wide">{tr("動作")}</p>

                {selectedServerScene?.imageStatus === "completed" && (
                  <DarkButton variant="secondary" className="w-full justify-center"
                    onClick={() => regenerateSceneMutation.mutate({ sceneIdx: selectedIdx! })}
                    disabled={regenerateSceneMutation.isPending}>
                    {tr("🔄 重新生成圖片 (-3積分)")}
                  </DarkButton>
                )}

                {selectedServerScene?.imageStatus === "failed" && (
                  <DarkButton variant="danger" className="w-full justify-center"
                    onClick={() => regenerateSceneMutation.mutate({ sceneIdx: selectedIdx! })}>
                    {tr("🔄 重試生成")}
                  </DarkButton>
                )}

                {selectedServerScene?.imageStatus === "completed" && selectedServerScene?.videoStatus !== "completed" && selectedServerScene?.videoStatus !== "generating" && (
                  <DarkButton className="w-full justify-center" style={{ background: "#7c3aed" }}
                    onClick={() => {
                      // Initialise animate dialog flags from the scene's saved preference
                      const hasFrames = !!(selectedServerScene?.firstFrameUrl && selectedServerScene?.lastFrameUrl);
                      setAnimUseFirstLast(!!selectedScene.useFirstLastFrame && hasFrames);
                      setAnimateDialog({ sceneIdx: selectedIdx! });
                    }}>
                    {tr("🎬 生成動畫影片")}
                  </DarkButton>
                )}

                {selectedServerScene?.videoStatus === "generating" && (
                  <div className="text-xs text-center text-[#ca8a04] animate-pulse py-2">{tr("影片生成中...")}</div>
                )}

                {/* Replace image */}
                {selectedServerScene?.imageStatus === "completed" && (
                  <DarkButton variant="secondary" className="w-full justify-center"
                    onClick={() => replaceFileRef.current?.click()}>
                    {tr("🖼 替換圖片（上傳）")}
                  </DarkButton>
                )}
                {selectedServerScene?.imageStatus === "completed" && (
                  <DarkButton variant="secondary" className="w-full justify-center" onClick={() => setReplaceFromVault(true)} data-testid="button-replace-from-vault">
                    {tr("從作品選一張替換")}
                  </DarkButton>
                )}
                <input ref={replaceFileRef} type="file" accept="image/*" className="hidden"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const path = await uploadToObjectStorage(file);
                    replaceImageMutation.mutate({ sceneIdx: selectedIdx!, objectPath: path });
                    if (e.target) e.target.value = "";
                  }} />

                <DarkButton variant="danger" className="w-full justify-center"
                  onClick={() => removeScene(selectedIdx!)}>
                  {tr("✕ 刪除此幕")}
                </DarkButton>
              </div>

              {/* Port info (like ComicFlow inspector) */}
              <div className="border-t border-[#e2e8f0] pt-3">
                <p className="text-[10px] text-[#cbd5e1] uppercase tracking-wide mb-2">{tr("連接埠")}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#94a3b8] font-mono border border-[#e2e8f0] rounded px-2 py-0.5">◎ text_in</span>
                  <span className="text-[10px] text-indigo-500 font-mono border border-indigo-500/20 rounded px-2 py-0.5">image_out ◉</span>
                </div>
                {selectedServerScene?.imageStatus === "completed" && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-[#94a3b8] font-mono border border-[#e2e8f0] rounded px-2 py-0.5">◎ image_in</span>
                    <span className="text-[10px] text-[#a855f7] font-mono border border-[#a855f7]/20 rounded px-2 py-0.5">video_out ◉</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* No selection placeholder */
          <div className="w-64 bg-[#ffffff] border-l border-[#e2e8f0] flex items-center justify-center shrink-0">
            <div className="text-center px-6">
              <p className="text-[#cbd5e1] text-3xl mb-3">←</p>
              <p className="text-xs text-[#cbd5e1]">{tr("點擊場景節點")}<br />{tr("開啟屬性面板")}</p>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 h-7 bg-[#f1f5f9] border-t border-[#e2e8f0] shrink-0">
        <span className="text-[10px] text-[#cbd5e1]">{tr("節點")} {localScenes.length} {tr("個 ／ 完成")} {serverScenes.filter(s => s.imageStatus === "completed").length} {tr("幕")}</span>
        <span className="text-[10px] text-[#cbd5e1]">{tr("積分 {0} ／ 待生成 {1} 幕", { 0: user?.credits ?? 0, 1: pendingCount })}</span>
        <span className={`text-[10px] ${episode.status === "generating" ? "text-[#ca8a04]" : "text-[#cbd5e1]"}`}>
          {episode.status === "generating" ? tr("⟳ 執行中...") : tr("● 就緒")}
        </span>
      </div>

      </>)}

      {/* Animate Dialog */}
      <Modal open={!!animateDialog} onClose={() => setAnimateDialog(null)} title={tr("🎬 生成動畫影片")}>
        {animateDialog && (
          <div className="space-y-5">
            <div>
              <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">
                {tr("影片時長：")}<span className="text-indigo-600 font-bold">{tr("{0} 秒", { 0: animDuration })}</span>
              </label>
              <input type="range" min={4} max={12} value={animDuration}
                onChange={e => setAnimDuration(Number(e.target.value))} className="w-full accent-indigo-500" />
              <div className="flex justify-between text-xs text-[#94a3b8] mt-1"><span>{tr("4秒")}</span><span>{tr("12秒")}</span></div>
            </div>

            <div onClick={() => setAnimUseOmni(!animUseOmni)}
              className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${animUseOmni ? "border-indigo-500 bg-indigo-600/5" : "border-[#e2e8f0] hover:border-indigo-500/30"}`}>
              <div>
                <p className="text-sm font-semibold text-[#0f172a]">{tr("🌟 全能模式（WAN 3.0 暫不支援）")}</p>
                <p className="text-xs text-[#64748b] mt-0.5">{tr("WAN 3.0 僅以場景圖作為首幀，此開關目前不會加入多圖參考")}</p>
              </div>
              <div className={`w-10 h-6 rounded-full relative flex-shrink-0 transition-all ${animUseOmni ? "bg-indigo-600" : "bg-[#e2e8f0]"}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${animUseOmni ? "left-5" : "left-1"}`} />
              </div>
            </div>

            {/* First/Last frame mode (only enabled if both frames exist) */}
            {(() => {
              const ss = serverScenes[animateDialog.sceneIdx];
              const hasFrames = !!(ss?.firstFrameUrl && ss?.lastFrameUrl);
              const disabled = !hasFrames;
              return (
                <div onClick={() => !disabled && setAnimUseFirstLast(!animUseFirstLast)}
                  className={`flex items-center justify-between p-3 rounded-xl border-2 transition-all ${disabled ? "border-[#e2e8f0] bg-[#f8fafc] cursor-not-allowed opacity-60" : (animUseFirstLast ? "border-[#10b981] bg-[#10b981]/5 cursor-pointer" : "border-[#e2e8f0] hover:border-[#10b981]/30 cursor-pointer")}`}
                  data-testid="toggle-anim-first-last">
                  <div>
                    <p className="text-sm font-semibold text-[#0f172a]">{tr("🎞 首尾關鍵幀模式")}</p>
                    <p className="text-xs text-[#64748b] mt-0.5">{hasFrames ? tr("用首尾幀補間，動作最平順") : tr("請先在右側面板生成首尾幀")}</p>
                  </div>
                  <div className={`w-10 h-6 rounded-full relative flex-shrink-0 transition-all ${animUseFirstLast && !disabled ? "bg-[#10b981]" : "bg-[#e2e8f0]"}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${animUseFirstLast && !disabled ? "left-5" : "left-1"}`} />
                  </div>
                </div>
              );
            })()}

            <div>
              <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">{tr("解析度")}</label>
              <div className="grid grid-cols-2 gap-3">
                {(["720p", "1080p"] as const).map(r => {
                  const cost = r === "1080p" ? Math.ceil(animDuration * 15) : Math.ceil(animDuration * 8);
                  return (
                    <button key={r} onClick={() => setAnimResolution(r)}
                      className={`p-3 rounded-xl border-2 text-sm transition-all ${animResolution === r ? "border-indigo-500 bg-indigo-600/10 text-indigo-600" : "border-[#e2e8f0] text-[#64748b] hover:border-indigo-500/40"}`}>
                      <div className="font-bold">{r}</div>
                      <div className="text-xs text-[#94a3b8]">{tr("{0} 積分", { 0: cost })}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-[#f8fafc] rounded-lg p-3 text-sm text-[#64748b]">
              {tr("消耗")}<span className="font-bold text-indigo-600">
                {animResolution === "1080p" ? Math.ceil(animDuration * 15) : Math.ceil(animDuration * 8)} {tr("積分")}
              </span>
              {tr("（現有 {0} 積分）", { 0: user?.credits ?? 0 })}
            </div>

            <DarkButton
              onClick={() => animateSceneMutation.mutate({
                sceneIdx: animateDialog.sceneIdx, duration: animDuration,
                resolution: animResolution, useOmniMode: animUseOmni,
                useFirstLastFrame: animUseFirstLast,
              })}
              disabled={animateSceneMutation.isPending || (user?.credits ?? 0) < (animResolution === "1080p" ? Math.ceil(animDuration * 15) : Math.ceil(animDuration * 8))}
              className="w-full justify-center"
              style={{ background: "#7c3aed" }}
            >
              {animateSceneMutation.isPending ? tr("生成中...") : tr("🎬 開始生成影片")}
            </DarkButton>
          </div>
        )}
      </Modal>

      {/* AI Script Generation Dialog */}
      <AIScriptDialog
        open={showAIDialog}
        onClose={() => setShowAIDialog(false)}
        defaultSceneCount={localScenes.length || 6}
        genre={project?.genre ?? undefined}
        characterAName={project?.characterAName ?? undefined}
        characterBName={project?.characterBName ?? undefined}
        onApply={(aiScenes) => {
          // If AI returns FEWER scenes than current AND any of the trailing scenes
          // have generated media, warn user before discarding them
          const trailingWithMedia = localScenes
            .slice(aiScenes.length)
            .some(s => s.imageStatus === "completed" || s.videoStatus === "completed");

          let keepTrailing = false;
          if (aiScenes.length < localScenes.length && trailingWithMedia) {
            keepTrailing = !confirm(
              tr("AI 回傳 {0} 幕，比目前的 {1} 幕少。\n\n", { 0: aiScenes.length, 1: localScenes.length }) +
              tr("多出的尾端有已生成圖片/影片的場景。\n\n") +
              tr("確定要直接覆蓋（會丟失尾端已生成內容）？\n\n") +
              tr("按【取消】會保留尾端已生成的場景，只覆蓋前 {0} 幕。", { 0: aiScenes.length })
            );
          }

          const total = keepTrailing ? localScenes.length : aiScenes.length;
          const merged: DramaScene[] = Array.from({ length: total }, (_, i) => {
            const existing = localScenes[i];
            const ai = aiScenes[i];
            if (!ai) {
              // Past AI range — keep existing scene as-is, just renumber
              return { ...existing, sceneNumber: i + 1 };
            }
            // Preserve all media + library-link fields from existing scene; AI only overrides script content.
            return {
              ...(existing ?? {}),
              id: existing?.id ?? nid(),
              sceneNumber: i + 1,
              title: ai.title,
              description: ai.description,
              dialogue: ai.dialogue,
              cameraMovement: ai.cameraMovement,
              useCharA: ai.useCharA,
              useCharB: ai.useCharB,
              imageStatus: existing?.imageStatus ?? "pending",
            };
          });
          setLocalScenes(merged);
          saveScenesMutation.mutate(merged);
        }}
      />

      {replaceFromVault && selectedIdx !== null && (
        <VaultPicker
          onPick={url => { replaceImageMutation.mutate({ sceneIdx: selectedIdx, objectPath: url }); setReplaceFromVault(false); }}
          onClose={() => setReplaceFromVault(false)} />
      )}

      {/* Mobile-mode replace-image file input (always mounted when mobile) */}
      {isMobile && (
        <input ref={replaceFileRef} type="file" accept="image/*" className="hidden"
          onChange={async e => {
            const file = e.target.files?.[0];
            if (!file || selectedIdx === null) return;
            const path = await uploadToObjectStorage(file);
            replaceImageMutation.mutate({ sceneIdx: selectedIdx, objectPath: path });
            if (e.target) e.target.value = "";
          }} />
      )}

      {/* ── Mobile: Long-Press Action Drawer ─────────────────────────────── */}
      {isMobile && (() => {
        const idx = actionSheetIdx;
        const open = idx !== null;
        const scene = idx !== null ? localScenes[idx] : null;
        const ss = idx !== null ? serverScenes[idx] : null;
        const closeSheet = () => setActionSheetIdx(null);
        return (
          <Drawer open={open} onOpenChange={(o) => { if (!o) closeSheet(); }}>
            <DrawerContent className="bg-white">
              {scene && (
                <>
                  <DrawerHeader>
                    <DrawerTitle className="text-left flex items-center gap-2">
                      <span className="bg-[#0f172a] text-white text-xs px-2 py-0.5 rounded-full">{scene.sceneNumber}</span>
                      <span className="truncate">{scene.title}</span>
                    </DrawerTitle>
                    <p className="text-[11px] text-[#94a3b8] text-left line-clamp-2">{scene.description || tr("（尚未填寫描述）")}</p>
                  </DrawerHeader>
                  <div className="px-4 pb-2 space-y-2">
                    <button
                      onClick={() => { closeSheet(); setSelectedIdx(idx!); setMobileInspectorOpen(true); }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#f1f5f9] hover:bg-[#e2e8f0] text-[#0f172a] text-sm font-medium transition-colors"
                      data-testid="action-edit-scene"
                    >
                      <span className="text-lg">✏️</span><span>{tr("編輯場景內容")}</span>
                    </button>

                    {(ss?.imageStatus === "completed" || ss?.imageStatus === "failed") && (
                      <button
                        onClick={() => {
                          if (regenerateSceneMutation.isPending) return;
                          regenerateSceneMutation.mutate({ sceneIdx: idx! });
                          closeSheet();
                        }}
                        disabled={regenerateSceneMutation.isPending || (user?.credits ?? 0) < 3}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-indigo-600/10 text-indigo-600 text-sm font-medium disabled:opacity-50"
                        data-testid="action-regenerate"
                      >
                        <span className="text-lg">🔄</span><span>{tr("重新生成圖片 (-{0} 積分)", { 0: IMAGE_COST })}</span>
                      </button>
                    )}

                    {ss?.imageStatus === "completed" && ss?.videoStatus !== "completed" && ss?.videoStatus !== "generating" && (
                      <button
                        onClick={() => {
                          const hasFrames = !!(ss?.firstFrameUrl && ss?.lastFrameUrl);
                          setAnimUseFirstLast(!!scene.useFirstLastFrame && hasFrames);
                          setAnimateDialog({ sceneIdx: idx! });
                          closeSheet();
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#7c3aed]/10 text-[#7c3aed] text-sm font-medium"
                        data-testid="action-animate"
                      >
                        <span className="text-lg">🎬</span><span>{tr("生成動畫影片")}</span>
                      </button>
                    )}

                    {ss?.imageStatus === "completed" && (
                      <button
                        onClick={() => { closeSheet(); setSelectedIdx(idx!); replaceFileRef.current?.click(); }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0ea5e9]/10 text-[#0369a1] text-sm font-medium"
                        data-testid="action-replace"
                      >
                        <span className="text-lg">🖼</span><span>{tr("替換圖片（上傳）")}</span>
                      </button>
                    )}
                    {ss?.imageStatus === "completed" && (
                      <button
                        onClick={() => { closeSheet(); setSelectedIdx(idx!); setReplaceFromVault(true); }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-indigo-600/10 text-[#4338ca] text-sm font-medium"
                        data-testid="action-replace-from-vault"
                      >
                        <span className="text-lg">🗂</span><span>{tr("從作品選一張替換")}</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        if (!confirm(tr("確定刪除第 {0} 幕？", { 0: scene.sceneNumber }))) return;
                        removeScene(idx!);
                        closeSheet();
                      }}
                      disabled={localScenes.length <= 2}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-[#ef4444]/10 text-[#ef4444] text-sm font-medium disabled:opacity-50"
                      data-testid="action-delete"
                    >
                      <span className="text-lg">✕</span><span>{tr("刪除此幕")}</span>
                    </button>
                  </div>
                  <DrawerFooter className="pt-2">
                    <DrawerClose asChild>
                      <button className="w-full py-2.5 rounded-xl text-[#64748b] text-sm" data-testid="action-cancel">
                        {tr("取消")}
                      </button>
                    </DrawerClose>
                  </DrawerFooter>
                </>
              )}
            </DrawerContent>
          </Drawer>
        );
      })()}

      {/* ── Mobile: Inspector Sheet (slim editor) ────────────────────────── */}
      {isMobile && (
        <Sheet
          open={mobileInspectorOpen && selectedScene !== null}
          onOpenChange={(o) => { setMobileInspectorOpen(o); if (!o) setSelectedIdx(null); }}
        >
          <SheetContent side="bottom" className="h-[88vh] p-0 flex flex-col rounded-t-2xl">
            {selectedScene && (
              <>
                <SheetHeader className="px-4 py-3 border-b border-[#e2e8f0] shrink-0">
                  <SheetTitle className="text-left flex items-center gap-2">
                    <span className="text-xs text-indigo-500 font-mono">SCENE {(selectedIdx ?? 0) + 1}</span>
                    <span className="text-sm">{tr("場景屬性")}</span>
                  </SheetTitle>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {selectedServerScene && getSceneImageUrl(selectedServerScene) && (
                    <div className="rounded-xl overflow-hidden border border-[#e2e8f0]">
                      <img src={getSceneImageUrl(selectedServerScene)!} alt="scene" className="w-full object-cover" />
                    </div>
                  )}
                  {selectedServerScene && getSceneVideoUrl(selectedServerScene) && (
                    <div className="rounded-xl overflow-hidden border border-[#e2e8f0]">
                      <video src={getSceneVideoUrl(selectedServerScene)!} controls className="w-full" />
                    </div>
                  )}
                  <div>
                    <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("幕名稱")}</label>
                    <DarkInput value={selectedScene.title} onChange={v => updateScene(selectedIdx!, { title: v })} placeholder={tr("幕名稱")} />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("場景描述")}</label>
                    <DarkTextarea value={selectedScene.description} onChange={v => updateScene(selectedIdx!, { description: v })} placeholder={tr("描述場景內容...")} rows={4} />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("台詞（選填）")}</label>
                    <DarkInput value={selectedScene.dialogue || ""} onChange={v => updateScene(selectedIdx!, { dialogue: v })} placeholder={tr("人物台詞")} />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("攝影機運鏡")}</label>
                    <DarkSelect
                      value={selectedScene.cameraMovement || "none"}
                      onChange={v => updateScene(selectedIdx!, { cameraMovement: v === "none" ? "" : v })}
                      options={CAMERA_MOVEMENTS}
                    />
                  </div>
                  {((project?.characterAUrls ?? []).length > 0 || (project?.characterBUrls ?? []).length > 0) && (
                    <div>
                      <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("角色出場")}</label>
                      <div className="flex gap-2">
                        {(project?.characterAUrls ?? []).length > 0 && (
                          <button onClick={() => updateScene(selectedIdx!, { useCharA: !selectedScene.useCharA })}
                            className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${selectedScene.useCharA ? "bg-indigo-600/10 border-indigo-500/40 text-indigo-600" : "border-[#cbd5e1] text-[#94a3b8]"}`}>
                            {tr("角色A {0}", { 0: selectedScene.useCharA ? "✓" : "×" })}
                          </button>
                        )}
                        {(project?.characterBUrls ?? []).length > 0 && (
                          <button onClick={() => updateScene(selectedIdx!, { useCharB: !selectedScene.useCharB })}
                            className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${selectedScene.useCharB ? "bg-[#f59e0b]/10 border-[#f59e0b]/40 text-[#d97706]" : "border-[#cbd5e1] text-[#94a3b8]"}`}>
                            {tr("角色B {0}", { 0: selectedScene.useCharB ? "✓" : "×" })}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="border-t border-[#e2e8f0] pt-3 space-y-2">
                    <p className="text-[10px] text-[#64748b] uppercase tracking-wide">{tr("動作")}</p>
                    <button
                      onClick={() => { setMobileInspectorOpen(false); setActionSheetIdx(selectedIdx); }}
                      className="w-full py-2.5 rounded-xl bg-[#f1f5f9] text-[#0f172a] text-sm font-medium"
                    >
                      {tr("⚡ 開啟操作選單（重生／替換／刪除）")}
                    </button>
                  </div>
                </div>
                <div className="border-t border-[#e2e8f0] p-3 shrink-0 flex gap-2">
                  <button
                    onClick={() => { saveScenesMutation.mutate(localScenes); setMobileInspectorOpen(false); }}
                    disabled={saveScenesMutation.isPending}
                    className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50"
                    data-testid="mobile-inspector-save"
                  >
                    {saveScenesMutation.isPending ? tr("儲存中…") : tr("💾 儲存變更")}
                  </button>
                  <button
                    onClick={() => setMobileInspectorOpen(false)}
                    className="px-4 py-2.5 rounded-xl bg-[#f1f5f9] text-[#64748b] text-sm"
                  >
                    {tr("關閉")}
                  </button>
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>
      )}

      <style>{`
        @keyframes dash { to { stroke-dashoffset: -20; } }
      `}</style>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function DramaPage() {
  const [view, setView] = useState<View>({ kind: "projects" });

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col">
      <NavigationHeader />
      {view.kind === "projects" && (
        <div className="flex-1">
          <ProjectsView onSelect={id => setView({ kind: "project", projectId: id })} />
        </div>
      )}
      {view.kind === "project" && (
        <div className="flex-1">
          <ProjectView
            projectId={view.projectId}
            onBack={() => setView({ kind: "projects" })}
            onSelectEpisode={epId => setView({ kind: "episode", projectId: view.projectId, episodeId: epId })}
          />
        </div>
      )}
      {view.kind === "episode" && (
        <EpisodeView
          episodeId={view.episodeId}
          projectId={view.projectId}
          onBack={() => setView({ kind: "project", projectId: view.projectId })}
        />
      )}
    </div>
  );
}

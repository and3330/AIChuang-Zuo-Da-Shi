import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NavigationHeader } from "./account";
import { useUser } from "@/App";
import type { DramaProject, DramaEpisode, DramaScene, CharacterLibraryItem, FourViewUrls } from "@shared/schema";
import { Slider } from "@/components/ui/slider";

const nid = () => Math.random().toString(36).slice(2, 10);

// ─── Types ─────────────────────────────────────────────────────────────────────
type View =
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
  | { kind: "episode"; projectId: string; episodeId: string };

const CAMERA_MOVEMENTS = [
  { value: "none", label: "不指定" },
  { value: "slow push in, gentle light", label: "緩慢推進" },
  { value: "slow zoom out, fade out", label: "緩慢拉遠" },
  { value: "pan left, smooth", label: "向左平移" },
  { value: "pan right, smooth", label: "向右平移" },
  { value: "tilt up, reveal", label: "向上移動" },
  { value: "tilt down, settle", label: "向下移動" },
  { value: "orbit around subject", label: "環繞拍攝" },
  { value: "static, fixed camera", label: "固定鏡頭" },
  { value: "handheld, slight shake", label: "手持晃動" },
  { value: "drone aerial shot", label: "空拍俯視" },
];

const GENRES = ["愛情", "動作", "懸疑", "喜劇", "奇幻", "恐怖", "科幻", "歷史", "其他"];
const SIZE_LABELS: Record<string, string> = {
  "9:16": "直式 9:16",
  "16:9": "橫式 16:9",
  "1:1": "正方形 1:1",
};

// ─── Prompt Snippets Library (依 SeedDance 2.0 提示詞指南分類) ─────────────
type SnippetCategory = {
  key: string; emoji: string; label: string; color: string;
  snippets: { label: string; text: string }[];
};

const PROMPT_SNIPPETS: SnippetCategory[] = [
  {
    key: "lighting", emoji: "💡", label: "光線氛圍", color: "#ca8a04",
    snippets: [
      { label: "黃金時刻", text: "黃金時刻溫暖斜陽光，金橘色調，柔和側光" },
      { label: "霓虹冷光", text: "賽博龐克霓虹冷光，藍紫光斑反射在臉上" },
      { label: "燭光", text: "暖黃燭光搖曳，臉部柔光，背景陰影" },
      { label: "逆光剪影", text: "逆光剪影，背景過曝光暈，輪廓清晰" },
      { label: "雨夜街燈", text: "雨夜路燈反光在濕潤路面，冷暖對比" },
      { label: "晨光透窗", text: "晨光透過窗簾灑入，塵埃飄浮，柔焦" },
      { label: "戲劇打光", text: "高反差電影打光，明暗強對比，硬光" },
      { label: "辦公冷光", text: "辦公室白冷日光燈，理性科技感氛圍" },
    ],
  },
  {
    key: "camera", emoji: "🎬", label: "鏡頭運鏡", color: "#6366f1",
    snippets: [
      { label: "緩慢推進", text: "鏡頭緩慢推進，聚焦人物表情" },
      { label: "拉遠揭示", text: "鏡頭緩慢拉遠，揭示更廣場景" },
      { label: "特寫", text: "面部特寫，強調眼神情緒" },
      { label: "過肩鏡頭", text: "過肩鏡頭，呈現對話張力" },
      { label: "低角度", text: "低角度仰拍，營造氣場與壓迫感" },
      { label: "俯視", text: "俯視鏡頭，強調孤獨感或全景" },
      { label: "環繞", text: "鏡頭環繞主角，動感呈現" },
      { label: "手持晃動", text: "手持晃動鏡頭，紀實感與緊張感" },
    ],
  },
  {
    key: "emotion", emoji: "😢", label: "情緒表現", color: "#db2777",
    snippets: [
      { label: "憂鬱", text: "她眼眶泛紅，眼神空洞，低頭不語" },
      { label: "震驚", text: "他瞳孔微縮，呼吸停頓，難以置信" },
      { label: "曖昧", text: "兩人四目相接，呼吸交織，臉頰微紅" },
      { label: "憤怒", text: "他緊握雙拳，咬牙切齒，目光如刀" },
      { label: "甜蜜", text: "她嘴角上揚，眼神含笑，髮絲輕揚" },
      { label: "緊張對峙", text: "兩人對峙，空氣凝結，眼神對視不退" },
      { label: "決絕", text: "她決絕轉身，背影堅定，再不回頭" },
      { label: "崩潰", text: "他蹲跪在地，雙手掩面，肩膀顫抖" },
    ],
  },
  {
    key: "scene", emoji: "🏠", label: "場景類型", color: "#22c55e",
    snippets: [
      { label: "高級辦公室", text: "現代化高級辦公室，落地窗俯瞰城市天際線" },
      { label: "雨天街角", text: "雨夜霓虹街角，路面積水反射街燈" },
      { label: "咖啡廳窗邊", text: "復古咖啡廳窗邊角落，木質吧台暖光" },
      { label: "豪華車內", text: "黑色豪車後座，皮革座椅冷光照明" },
      { label: "醫院走廊", text: "白色醫院長廊，冷光日光燈，空曠寂靜" },
      { label: "海邊碼頭", text: "黃昏海邊碼頭，海風吹起髮絲，海浪拍岸" },
      { label: "華麗宴會", text: "華麗宴會大廳，水晶吊燈，香檳塔" },
      { label: "校園走廊", text: "陽光灑落的校園走廊，櫻花飄落，學生身影" },
    ],
  },
  {
    key: "style", emoji: "🎨", label: "畫面風格", color: "#a855f7",
    snippets: [
      { label: "電影感", text: "電影感寬銀幕構圖，戲劇性光影分級" },
      { label: "韓劇氛圍", text: "韓劇浪漫氛圍，柔焦淡彩，唯美光暈" },
      { label: "日漫風", text: "日系動漫風格，鮮明線條，鮮豔色彩" },
      { label: "寫實插畫", text: "寫實插畫風格，細膩筆觸，光影豐富" },
      { label: "復古港片", text: "復古港片美學，膠片顆粒感，霓虹色調" },
      { label: "高級時尚", text: "高級時尚雜誌風格，精緻構圖，極簡奢華" },
      { label: "黑白默劇", text: "黑白攝影，高反差，戲劇性陰影" },
      { label: "魔幻神秘", text: "魔幻奇幻氛圍，魔法光粒，神秘色彩" },
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
    key: "ceo_love", emoji: "💼", title: "霸總愛情", genre: "愛情",
    description: "霸道總裁愛上小助理的經典套路",
    scenes: [
      { title: "電梯初遇", description: "現代化高級辦公室電梯內，西裝筆挺的男主角低頭看手機，女主角抱著一疊文件慌張衝進電梯，兩人撞個正著文件散落一地。冷光打在兩人臉上，氣氛凝結。", dialogue: "對不起！我不是故意的…", cameraMovement: "slow push in, gentle light" },
      { title: "辦公室對峙", description: "落地窗俯瞰城市夜景的辦公室，男主角坐在大班椅上，神色冷冽地看著站在桌前低頭的女主角。黃金時刻陽光穿過百葉窗，光影斑駁灑在兩人之間。", dialogue: "妳知道這份合約的重要性嗎？", cameraMovement: "orbit around subject" },
      { title: "雨夜接送", description: "傾盆大雨的街頭，女主角獨自撐著破傘等公車，男主角的黑色豪車緩緩停下，車窗降下露出他擔憂的臉。霓虹燈光反射在濕潤路面。", dialogue: "上車，別淋濕了。", cameraMovement: "tilt up, reveal" },
      { title: "餐廳告白", description: "高級法式餐廳包廂，燭光搖曳，男主角從口袋拿出小盒子，眼神溫柔卻緊張地看著女主角。背景虛化，焦點在兩人交握的手。", dialogue: "我認真的，妳願意嗎？", cameraMovement: "slow push in, gentle light" },
      { title: "誤會分手", description: "男主角辦公室外走廊，女主角看到男主角和另一名美麗女子親密交談，瞬間心碎轉身奔跑。冷色調走廊燈光，背影孤獨。", dialogue: "原來我什麼都不是…", cameraMovement: "pan left, smooth" },
      { title: "機場挽回", description: "機場登機口，女主角含淚拖行李準備離開，男主角衝破人群氣喘吁吁地抓住她的手，背景旅客模糊化。", dialogue: "別走！妳就是我的全部！", cameraMovement: "slow zoom out, fade out" },
    ],
  },
  {
    key: "campus", emoji: "🌸", title: "校園青春", genre: "愛情",
    description: "陽光下的純愛校園戀曲",
    scenes: [
      { title: "教室相遇", description: "陽光透過窗戶灑入教室，櫻花瓣飄落，新轉學生女主角站在講台前自我介紹，男主角在窗邊位置抬頭驚訝地看著她。", dialogue: "大家好，請多多指教。", cameraMovement: "slow push in, gentle light" },
      { title: "圖書館巧遇", description: "安靜的圖書館書架間，兩人同時伸手拿同一本書指尖相觸。陽光從高窗斜射，灰塵在光柱中飄浮。", dialogue: "啊！對不起…", cameraMovement: "static, fixed camera" },
      { title: "操場奔跑", description: "黃昏操場跑道，男主角追上前面慢跑的女主角，並肩奔跑歡笑。夕陽金光灑在兩人身上，背景模糊。", dialogue: "妳跑得真快！", cameraMovement: "pan right, smooth" },
      { title: "雨中共傘", description: "突如其來的午後雷陣雨，校園走廊外，男主角將傘傾向女主角，自己肩膀濕透。她臉頰泛紅低頭。", dialogue: "妳會感冒的…", cameraMovement: "slow zoom out, fade out" },
      { title: "天台告白", description: "黃昏校園天台，男主角站在風中，女主角驚訝地走上來。橘紅色夕陽染滿天空，髮絲飛揚。", dialogue: "我喜歡妳，從第一眼開始。", cameraMovement: "orbit around subject" },
      { title: "畢業典禮", description: "畢業典禮後的櫻花樹下，兩人穿著畢業服相擁而笑，櫻花瓣紛飛。柔焦溫暖光影，唯美如夢。", dialogue: "謝謝你，陪我度過最美的青春。", cameraMovement: "slow zoom out, fade out" },
    ],
  },
  {
    key: "revenge", emoji: "🔪", title: "復仇懸疑", genre: "懸疑",
    description: "蛻變歸來的復仇之路",
    scenes: [
      { title: "悲慘往事", description: "陰暗潮濕地下室，年輕女主角蜷縮在角落啜泣，臉上有淚痕和傷痕。冷藍色月光從鐵窗縫隙灑入，氣氛陰鬱壓抑。", dialogue: "我絕不會放過你們…", cameraMovement: "slow push in, gentle light" },
      { title: "華麗歸來", description: "三年後高級飯店大廳，蛻變後的女主角穿著黑色禮服緩緩走下樓梯，紅唇冷艷，眼神犀利。水晶吊燈閃爍，眾人側目。", dialogue: "好久不見，各位。", cameraMovement: "tilt up, reveal" },
      { title: "首次交鋒", description: "高級餐廳包廂，女主角優雅地舉起紅酒杯，對面坐著當年的仇人，臉色驟變。燭光晃動，氣氛凝結。", dialogue: "你應該還記得我吧？", cameraMovement: "static, fixed camera" },
      { title: "佈局陷阱", description: "深夜辦公室，女主角站在落地窗前看著城市夜景，手中握著關鍵證據U盤。冷光城市燈火映照，剪影神秘。", dialogue: "棋局已經開始了。", cameraMovement: "pan left, smooth" },
      { title: "真相揭露", description: "豪華記者會現場，女主角站在台上將證據投影在大螢幕上，台下記者譁然騷動。鎂光燈閃爍。", dialogue: "這就是真相，無可辯駁。", cameraMovement: "slow zoom out, fade out" },
      { title: "復仇結局", description: "雨夜頂樓天台，仇人跪地哀求，女主角冷冷俯視。背景閃電交加，雨水滂沱，氣氛壓迫。", dialogue: "晚了，這就是你的代價。", cameraMovement: "orbit around subject" },
    ],
  },
  {
    key: "isekai", emoji: "🌌", title: "穿越奇幻", genre: "奇幻",
    description: "穿越異世界的奇幻冒險",
    scenes: [
      { title: "意外穿越", description: "現代都市夜晚街頭，女主角過馬路時被閃電擊中，身體發出金光被吸入時空漩渦。背景城市光線扭曲變形。", dialogue: "這…這是怎麼回事？", cameraMovement: "orbit around subject" },
      { title: "異世界醒來", description: "古樸森林空地，女主角穿著現代服裝醒來，周圍是高聳古樹和奇幻光點。陽光透過樹葉灑下斑駁光影，神秘氛圍。", dialogue: "我在哪裡…", cameraMovement: "tilt up, reveal" },
      { title: "邂逅王子", description: "森林小溪邊，神秘銀髮男子騎白馬出現，目光驚訝地看著倒在地上的女主角。藍紫色魔法光點圍繞。", dialogue: "妳是什麼人？", cameraMovement: "slow push in, gentle light" },
      { title: "魔法覺醒", description: "古老石塔頂端，女主角伸手間爆發出耀眼金色光芒，魔法符文圍繞她旋轉。背景天空閃電轟鳴。", dialogue: "原來這就是我的力量！", cameraMovement: "slow zoom out, fade out" },
      { title: "決戰魔王", description: "崩塌的城堡廢墟戰場，女主角和男主角並肩持劍對峙巨大魔王陰影。火焰魔法光環四射。", dialogue: "為了這個世界！", cameraMovement: "orbit around subject" },
      { title: "回到現實", description: "現代都市公園長椅，女主角醒來陽光燦爛，恍若一場夢。低頭發現手中握著異世界的銀色項鍊。", dialogue: "原來…不是夢…", cameraMovement: "slow zoom out, fade out" },
    ],
  },
  {
    key: "office", emoji: "🏢", title: "職場逆襲", genre: "其他",
    description: "小職員的職場逆襲記",
    scenes: [
      { title: "被嘲諷", description: "現代辦公室茶水間，女主角端著咖啡被同事們嘲笑奚落，她低頭強忍淚水。冷白色日光燈，背景虛化。", dialogue: "她連這種小事都做不好。", cameraMovement: "static, fixed camera" },
      { title: "深夜加班", description: "空無一人的辦公室深夜，女主角獨自在電腦前認真工作，桌面只有一盞檯燈和一杯冷掉的咖啡。", dialogue: "我一定要證明自己。", cameraMovement: "slow push in, gentle light" },
      { title: "提案展示", description: "高級會議室，女主角自信地站在投影幕前展示提案，老闆和高管們專注聆聽。落地窗外城市天際線。", dialogue: "這是我準備的方案。", cameraMovement: "orbit around subject" },
      { title: "拿下大案", description: "辦公室角落，女主角接到電話露出震驚又激動的表情，手中緊握合約。陽光從窗外灑入背影輝煌。", dialogue: "真的嗎？我們拿下了！", cameraMovement: "slow zoom out, fade out" },
      { title: "晉升宣布", description: "公司大會議室，老闆在台上宣布女主角晉升，全場鼓掌，先前嘲諷她的同事們臉色尷尬。", dialogue: "恭喜妳，新任部門總監。", cameraMovement: "tilt up, reveal" },
      { title: "夜景敬酒", description: "高樓頂層酒吧落地窗前，女主角獨自舉起香檳杯，俯瞰整座城市燈火。霓虹倒映在杯中，氣場全開。", dialogue: "這只是開始。", cameraMovement: "pan left, smooth" },
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
  if (!putRes.ok) throw new Error("上傳失敗");
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
    primary:   "bg-[#6366f1] hover:bg-[#4338ca] text-white",
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
        placeholder-[#94a3b8] focus:outline-none focus:border-[#6366f1] transition-colors ${className}`}
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
        placeholder-[#94a3b8] focus:outline-none focus:border-[#6366f1] transition-colors resize-none ${className}`}
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
        focus:outline-none focus:border-[#6366f1] transition-colors"
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
      toast({ title: "已設定自訂銜接圖" });
    } catch {
      toast({ title: "上傳失敗", variant: "destructive" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-[10px] text-[#64748b] uppercase tracking-wide">
        自訂銜接圖（會優先於上方來源）
      </label>
      <div className="flex items-center gap-2">
        {customUrl ? (
          <>
            <img
              src={customUrl}
              alt="自訂銜接圖"
              className="w-10 h-10 object-cover rounded border border-[#10b981]/40"
            />
            <button
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-[10px] text-[#0f766e] hover:text-[#115e59] underline"
              data-testid="button-replace-chain-ref-custom"
            >
              {uploading ? "上傳中…" : "換一張"}
            </button>
            <button
              onClick={() => onChange("")}
              className="text-[10px] text-[#dc2626] hover:text-[#b91c1c] underline"
              data-testid="button-clear-chain-ref-custom"
            >
              移除
            </button>
          </>
        ) : (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="text-[10px] px-2 py-1 rounded-md border border-dashed border-[#10b981]/50 text-[#0f766e] hover:bg-[#10b981]/10"
            data-testid="button-upload-chain-ref-custom"
          >
            {uploading ? "上傳中…" : "＋ 上傳自訂銜接圖"}
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
        toast({ title: "上傳失敗", variant: "destructive" });
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[#64748b] uppercase tracking-wide">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {objectPaths.map((_, i) => (
          <div key={i} className="relative w-12 h-12 rounded-lg bg-[#e2e8f0] border border-[#cbd5e1] flex items-center justify-center group">
            <span className="text-[#6366f1] text-xs font-bold">✓</span>
            <button onClick={() => onRemove(i)}
              className="absolute -top-1 -right-1 w-4 h-4 bg-[#ef4444] text-white text-xs rounded-full hidden group-hover:flex items-center justify-center">×</button>
          </div>
        ))}
        {objectPaths.length < max && (
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="w-12 h-12 rounded-lg border border-dashed border-[#cbd5e1] flex flex-col items-center justify-center text-[#94a3b8] hover:border-[#6366f1] hover:text-[#6366f1] transition-all">
            {uploading ? <span className="text-xs">...</span> : <><span className="text-lg leading-none">+</span><span className="text-[9px]">上傳</span></>}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => handleFiles(e.target.files)} />
    </div>
  );
}

// ─── Projects View ─────────────────────────────────────────────────────────────
function ProjectsView({ onSelect }: { onSelect: (id: string) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newGenre, setNewGenre] = useState("愛情");

  const { data: projects = [], isLoading } = useQuery<DramaProject[]>({
    queryKey: ["/api/drama/projects"],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/drama/projects", data).then(r => r.json()),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/projects"] });
      setShowCreate(false);
      setNewTitle("");
      toast({ title: "漫劇建立成功！" });
      onSelect(project.id);
    },
    onError: (e: any) => toast({ title: "建立失敗", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/drama/projects/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/drama/projects"] }),
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[#0f172a]">🎬 漫劇工作室</h1>
          <p className="text-sm text-[#64748b] mt-1">視覺化 AI 漫劇生成流程</p>
        </div>
        <DarkButton onClick={() => setShowCreate(true)}>＋ 新建漫劇</DarkButton>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40"><Spinner /></div>
      ) : projects.length === 0 ? (
        <div className="text-center py-24">
          <div className="text-6xl mb-4">🎬</div>
          <p className="text-lg font-medium text-[#334155] mb-2">還沒有漫劇專案</p>
          <p className="text-sm text-[#64748b] mb-6">點擊「新建漫劇」開始你的第一部 AI 漫劇</p>
          <DarkButton onClick={() => setShowCreate(true)}>＋ 新建漫劇</DarkButton>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {projects.map(p => (
            <div key={p.id} onClick={() => onSelect(p.id)}
              className="bg-[#ffffff] border border-[#e2e8f0] rounded-2xl p-5 cursor-pointer
                hover:border-[#6366f1] hover:shadow-[0_0_20px_rgba(99,102,241,0.15)] transition-all group">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-[#6366f1]/10 rounded-xl flex items-center justify-center text-xl">🎬</div>
                <button onClick={e => { e.stopPropagation(); if (confirm(`確定刪除「${p.title}」？`)) deleteMutation.mutate(p.id); }}
                  className="opacity-0 group-hover:opacity-100 text-[#94a3b8] hover:text-[#ef4444] transition-all text-sm">✕</button>
              </div>
              <h3 className="font-bold text-[#0f172a] truncate">{p.title}</h3>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {p.genre && <span className="text-xs bg-[#6366f1]/10 text-[#4f46e5] px-2 py-0.5 rounded-full">{p.genre}</span>}
                <span className="text-xs text-[#64748b]">{p.episodeCount ?? 0} 集</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建漫劇專案">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">漫劇標題</label>
            <DarkInput value={newTitle} onChange={setNewTitle} placeholder="例：霸道總裁的秘密" />
          </div>
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">類型</label>
            <div className="flex flex-wrap gap-2">
              {GENRES.map(g => (
                <button key={g} onClick={() => setNewGenre(g)}
                  className={`px-3 py-1 rounded-full text-xs border transition-all ${newGenre === g ? "bg-[#6366f1] text-white border-[#6366f1]" : "border-[#cbd5e1] text-[#64748b] hover:border-[#6366f1] hover:text-[#4f46e5]"}`}>
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
            {createMutation.isPending ? "建立中..." : "建立漫劇"}
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
  const [pGenre, setPGenre] = useState("愛情");
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
      setPGenre(project.genre ?? "愛情");
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
      toast({ title: "已儲存" });
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
      toast({ title: `第 ${ep.episodeNumber} 集已建立！` });
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
        id: nid(), sceneNumber: i + 1, title: `第 ${i + 1} 幕`,
        description: "", dialogue: "", cameraMovement: "",
        useCharA: true, useCharB: true, imageStatus: "pending",
      }));
    }

    createEpisodeMutation.mutate({
      title: newEpTitle || tpl?.title || `第 ${episodes.length + 1} 集`,
      scenes, episodeNumber: episodes.length + 1,
    });
  };

  if (loadingProject) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (!project) return <div className="text-center py-20 text-[#ef4444]">找不到漫劇</div>;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="text-[#64748b] hover:text-[#334155] text-sm transition-colors">← 返回</button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-[#0f172a]">{project.title}</h1>
            {project.genre && <span className="text-xs bg-[#6366f1]/10 text-[#4f46e5] px-2 py-0.5 rounded-full">{project.genre}</span>}
            <span className="text-xs text-[#94a3b8]">{SIZE_LABELS[project.sceneSize ?? "9:16"]}</span>
          </div>
        </div>
        <Link href="/character-library">
          <DarkButton variant="secondary">🎭 角色庫</DarkButton>
        </Link>
        <Link href="/scene-library">
          <DarkButton variant="secondary">🏞 場景庫</DarkButton>
        </Link>
        <DarkButton variant="secondary" onClick={() => setShowImportScript(true)} data-testid="button-import-script">📄 上傳劇本</DarkButton>
        <DarkButton variant="secondary" onClick={() => setShowSettings(true)}>✏️ 編輯設定</DarkButton>
        <DarkButton onClick={() => setShowNewEpisode(true)}>＋ 新增集數</DarkButton>
      </div>

      {/* Character Library */}
      <div className="bg-[#ffffff] border border-[#e2e8f0] rounded-2xl p-5">
        <h2 className="font-semibold text-[#334155] mb-4 text-sm uppercase tracking-wide">🎭 角色庫</h2>
        <div className="grid grid-cols-3 gap-6">
          {[
            { label: "角色 A", urls: project.characterAUrls ?? [], color: "#6366f1" },
            { label: "角色 B", urls: project.characterBUrls ?? [], color: "#f59e0b" },
            { label: "風格參考", urls: project.styleImageUrls ?? [], color: "#10b981" },
          ].map(({ label, urls, color }) => (
            <div key={label}>
              <p className="text-xs text-[#64748b] mb-2">{label}（{urls.length} 張）</p>
              <div className="flex flex-wrap gap-1.5">
                {urls.map((_, i) => (
                  <div key={i} className="w-10 h-10 rounded-lg flex items-center justify-center border text-xs font-bold"
                    style={{ background: `${color}15`, borderColor: `${color}40`, color }}>
                    {label[2]}{i + 1}
                  </div>
                ))}
                {urls.length === 0 && <p className="text-xs text-[#cbd5e1]">未設定</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Episodes */}
      <div className="bg-[#ffffff] border border-[#e2e8f0] rounded-2xl p-5">
        <h2 className="font-semibold text-[#334155] mb-4 text-sm uppercase tracking-wide">📋 集數列表</h2>
        {loadingEpisodes ? (
          <div className="flex items-center justify-center h-16"><Spinner /></div>
        ) : episodes.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[#94a3b8] mb-3 text-sm">還沒有集數</p>
            <DarkButton variant="secondary" onClick={() => setShowNewEpisode(true)}>＋ 新增第一集</DarkButton>
          </div>
        ) : (
          <div className="space-y-2">
            {episodes.map(ep => {
              const scenes: DramaScene[] = JSON.parse(ep.scenes || "[]");
              const done = scenes.filter(s => s.imageStatus === "completed").length;
              const statusColor = ep.status === "completed" ? "#22c55e" : ep.status === "generating" ? "#ca8a04" : ep.status === "failed" ? "#ef4444" : "#94a3b8";
              return (
                <div key={ep.id} onClick={() => onSelectEpisode(ep.id)}
                  className="flex items-center gap-4 p-4 rounded-xl border border-[#e2e8f0] hover:border-[#6366f1]/40 hover:bg-[#6366f1]/5 cursor-pointer transition-all group">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm"
                    style={{ background: "#6366f115", color: "#4f46e5" }}>
                    {ep.episodeNumber}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-[#0f172a]">{ep.title}</p>
                    <p className="text-xs text-[#94a3b8]">{ep.sceneCount} 幕 · {done} 幕已生成圖片</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full border"
                      style={{ color: statusColor, borderColor: `${statusColor}40`, background: `${statusColor}10` }}>
                      {ep.status === "generating" ? "生成中" : ep.status === "completed" ? "完成" : ep.status === "failed" ? "失敗" : "草稿"}
                    </span>
                    <button onClick={e => { e.stopPropagation(); if (confirm("確定刪除此集？")) deleteEpisodeMutation.mutate(ep.id); }}
                      className="opacity-0 group-hover:opacity-100 text-[#94a3b8] hover:text-[#ef4444] transition-all text-sm">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="編輯漫劇設定">
        <div className="space-y-5">
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">漫劇標題</label>
            <DarkInput value={pTitle} onChange={setPTitle} />
          </div>
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">類型</label>
            <div className="flex flex-wrap gap-2">
              {GENRES.map(g => (
                <button key={g} onClick={() => setPGenre(g)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-all ${pGenre === g ? "bg-[#6366f1] text-white border-[#6366f1]" : "border-[#cbd5e1] text-[#64748b] hover:border-[#6366f1]"}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">圖片尺寸</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(SIZE_LABELS).map(([val, label]) => (
                <button key={val} onClick={() => setPSceneSize(val)}
                  className={`p-2.5 rounded-xl border text-xs transition-all ${pSceneSize === val ? "border-[#6366f1] bg-[#6366f1]/10 text-[#4f46e5]" : "border-[#cbd5e1] text-[#64748b] hover:border-[#6366f1]/40"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ImageUploadButton label="角色 A 參考圖（最多 4 張）" objectPaths={pCharAUrls}
            onAdd={p => setPCharAUrls(v => [...v, p])} onRemove={i => setPCharAUrls(v => v.filter((_, idx) => idx !== i))} />
          <ImageUploadButton label="角色 B 參考圖（最多 4 張）" objectPaths={pCharBUrls}
            onAdd={p => setPCharBUrls(v => [...v, p])} onRemove={i => setPCharBUrls(v => v.filter((_, idx) => idx !== i))} />
          <ImageUploadButton label="風格參考圖（最多 4 張）" objectPaths={pStyleUrls}
            onAdd={p => setPStyleUrls(v => [...v, p])} onRemove={i => setPStyleUrls(v => v.filter((_, idx) => idx !== i))} />
          <DarkButton onClick={() => updateMutation.mutate({ title: pTitle, genre: pGenre, sceneSize: pSceneSize, characterAUrls: pCharAUrls, characterBUrls: pCharBUrls, styleImageUrls: pStyleUrls })}
            disabled={updateMutation.isPending} className="w-full justify-center">
            {updateMutation.isPending ? "儲存中..." : "儲存設定"}
          </DarkButton>
        </div>
      </Modal>

      {/* New Episode Modal */}
      <Modal open={showNewEpisode} onClose={() => { setShowNewEpisode(false); setSelectedTemplate(null); }} title="新增集數">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">集數標題</label>
            <DarkInput value={newEpTitle} onChange={setNewEpTitle} placeholder={`第 ${episodes.length + 1} 集`} />
          </div>

          {/* Template picker */}
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block flex items-center justify-between">
              <span>📚 從範本開始（選填）</span>
              {selectedTemplate && (
                <button onClick={() => setSelectedTemplate(null)} className="text-[10px] text-[#4f46e5] hover:text-[#6366f1] normal-case tracking-normal">清除</button>
              )}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {DRAMA_TEMPLATES.map(t => {
                const active = selectedTemplate === t.key;
                return (
                  <button key={t.key} onClick={() => setSelectedTemplate(t.key)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${active ? "border-[#6366f1] bg-[#6366f1]/10" : "border-[#e2e8f0] bg-[#f8fafc] hover:border-[#6366f1]/40"}`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-base">{t.emoji}</span>
                      <span className={`text-xs font-semibold ${active ? "text-[#4f46e5]" : "text-[#334155]"}`}>{t.title}</span>
                    </div>
                    <p className="text-[10px] text-[#64748b] leading-snug line-clamp-2">{t.description}</p>
                    <p className="text-[10px] text-[#94a3b8] mt-1">共 {t.scenes.length} 幕 · {t.scenes.length * 3} 積分</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scene count slider (disabled when template selected) */}
          {!selectedTemplate && (
            <div>
              <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">
                場景數量：<span className="text-[#4f46e5] font-bold">{newEpSceneCount} 幕</span>
                <span className="text-[#94a3b8] ml-2">（{newEpSceneCount * 3} 積分）</span>
              </label>
              <input type="range" min={2} max={12} value={newEpSceneCount}
                onChange={e => setNewEpSceneCount(Number(e.target.value))}
                className="w-full accent-[#6366f1]" />
              <div className="flex justify-between text-xs text-[#94a3b8] mt-1"><span>2 幕</span><span>12 幕</span></div>
              <p className="text-[10px] text-[#64748b] mt-2">💡 建立後可在編輯器中用「🤖 AI 寫腳本」一鍵生成所有幕的內容</p>
            </div>
          )}

          {selectedTemplate && (
            <div className="bg-[#6366f1]/5 border border-[#6366f1]/20 rounded-lg p-2.5 text-[11px] text-[#4f46e5]">
              ✨ 將以「{DRAMA_TEMPLATES.find(t => t.key === selectedTemplate)?.title}」範本建立完整腳本，建立後可隨時微調
            </div>
          )}

          <DarkButton onClick={handleCreateEpisode} disabled={createEpisodeMutation.isPending} className="w-full justify-center">
            {createEpisodeMutation.isPending ? "建立中..." : selectedTemplate ? "✨ 套用範本並建立" : "建立空白集數"}
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
          <label className="text-[10px] text-[#64748b] uppercase tracking-wide">角色庫角色（多選，影響出圖）</label>
          <Link href="/character-library" className="text-[10px] text-[#6366f1] hover:underline" data-testid="link-open-charlib">
            管理 →
          </Link>
        </div>
        {characters.length === 0 ? (
          <p className="text-[11px] text-[#94a3b8]">角色庫是空的，先到「角色庫」建一個角色並生成四視圖。</p>
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
                      ? "bg-[#6366f1]/10 border-[#6366f1] text-[#4f46e5]"
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
          <label className="text-[10px] text-[#64748b] uppercase tracking-wide">場景庫場景（影響出圖背景）</label>
          <Link href="/scene-library" className="text-[10px] text-[#6366f1] hover:underline" data-testid="link-open-scenelib">
            管理 →
          </Link>
        </div>
        {sceneItems.length === 0 ? (
          <p className="text-[11px] text-[#94a3b8]">場景庫是空的，先到「場景庫」建立場景。</p>
        ) : (
          <select
            value={scene.sceneLocationId ?? ""}
            onChange={e => onUpdate({ sceneLocationId: e.target.value || undefined })}
            className="w-full text-xs bg-white border border-[#cbd5e1] rounded-lg px-2 py-1.5 text-[#0f172a]"
            data-testid="select-scene-lib"
          >
            <option value="">不套用場景庫</option>
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
        title: `✨ 已建立 ${data.episodesCreated ?? 0} 集 ／ ${data.charactersCreated ?? 0} 個角色`,
        description: "可在角色庫與集數列表中查看",
      });
      setScriptText(""); setFileBase64(null); setFileName("");
      onImported();
    },
    onError: (e: any) => toast({ title: "匯入失敗", description: e.message, variant: "destructive" }),
  });

  const handleFile = (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setFileBase64(reader.result as string);
    reader.readAsDataURL(file);
  };

  return (
    <Modal open={open} onClose={onClose} title="📄 從劇本匯入">
      <div className="space-y-4">
        <p className="text-xs text-[#64748b]">
          上傳故事原文（TXT/DOCX）或直接貼入文字，AI 會自動拆集、抽出主要角色（會自動加到角色庫）並產生分鏡。
        </p>

        <div>
          <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">劇本檔案（TXT / DOCX）</label>
          <input ref={fileRef} type="file" accept=".txt,.docx" className="hidden"
            onChange={e => handleFile(e.target.files?.[0] ?? null)} />
          <button onClick={() => fileRef.current?.click()}
            className="w-full p-3 rounded-lg border-2 border-dashed border-[#cbd5e1] hover:border-[#6366f1] text-sm text-[#64748b] hover:text-[#4f46e5] transition-all"
            data-testid="button-pick-script-file">
            {fileName ? `📎 ${fileName}` : "📂 選擇檔案…"}
          </button>
        </div>

        <div className="text-center text-[10px] text-[#94a3b8]">— 或 —</div>

        <div>
          <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">直接貼入劇本文字</label>
          <DarkTextarea
            value={scriptText}
            onChange={setScriptText}
            placeholder="貼入故事大綱或完整劇本（最多 60,000 字）…"
            rows={6}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">集數</label>
            <input type="number" min={1} max={10} value={episodeCount}
              onChange={e => setEpisodeCount(Math.min(10, Math.max(1, Number(e.target.value))))}
              className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1]" />
          </div>
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">每集幕數</label>
            <input type="number" min={2} max={12} value={scenesPerEpisode}
              onChange={e => setScenesPerEpisode(Math.min(12, Math.max(2, Number(e.target.value))))}
              className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1]" />
          </div>
        </div>

        <div className="bg-[#f8fafc] rounded-lg p-2.5 text-[11px] text-[#64748b]">
          ℹ️ 預估產出：{episodeCount} 集 × {scenesPerEpisode} 幕 = {episodeCount * scenesPerEpisode} 幕分鏡（不會自動扣積分，須在編輯器中手動生成圖片）
        </div>

        <DarkButton
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending || (!scriptText.trim() && !fileBase64)}
          className="w-full justify-center"
          data-testid="button-import-script-submit"
        >
          {importMutation.isPending ? "🤖 AI 拆集中…約 30 秒" : "✨ 開始匯入"}
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
                <text x={CARD_W - 17} y={CARD_H * 0.65 - 7} textAnchor="middle" fill="#fff" fontSize="8">▶ 影</text>
              )}

              {/* Chain Mode badge — scene picks up from prev scene's tail frame */}
              {chainEffective?.[idx] && idx > 0 && (
                <g>
                  <rect x={CARD_W - 46} y={4} width={42} height={14} rx={3} fill="#10b981" />
                  <text x={CARD_W - 25} y={14} textAnchor="middle" fill="#fff" fontSize="8">🔗 銜接 #{idx}</text>
                </g>
              )}

              {/* Scene title */}
              <text x={8} y={CARD_H * 0.65 + 16} fill="#475569" fontSize="10" fontFamily="'Noto Sans TC', sans-serif">
                {scene.title.length > 7 ? scene.title.slice(0, 7) + "…" : scene.title}
              </text>

              {/* Description preview */}
              <text x={8} y={CARD_H * 0.65 + 30} fill="#94a3b8" fontSize="9" fontFamily="'Noto Sans TC', sans-serif">
                {(scene.description || "未填寫場景描述").slice(0, 10)}…
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
        toast({ title: "AI 沒有產出有效腳本", variant: "destructive" });
        return;
      }
      onApply(data.scenes);
      toast({ title: `AI 已生成 ${data.scenes.length} 幕腳本！` });
      setPitch("");
      onClose();
    },
    onError: (e: any) => toast({ title: "AI 生成失敗", description: e.message, variant: "destructive" }),
  });

  return (
    <Modal open={open} onClose={onClose} title="🤖 AI 智慧腳本助手">
      <div className="space-y-4">
        <div className="bg-[#6366f1]/5 border border-[#6366f1]/20 rounded-xl p-3 text-xs text-[#4f46e5] leading-relaxed">
          💡 用一兩句話描述劇情概念，AI 會依 SeedDance 2.0 提示詞最佳實踐自動產出整集分鏡（含場景描述、台詞、運鏡）。
        </div>

        <div>
          <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">劇情概念</label>
          <DarkTextarea
            value={pitch} onChange={setPitch}
            placeholder={`例：${genre === "懸疑" ? "失憶女記者調查三年前的命案，意外發現真兇是自己的未婚夫" : "霸道總裁愛上小助理，第一次在電梯相遇文件灑滿地"}`}
            rows={4}
          />
          <p className="text-[10px] text-[#94a3b8] mt-1.5">💬 越具體越好（角色、衝突、地點、結局想法都可以加進來）</p>
        </div>

        <div>
          <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">
            幕數：<span className="text-[#4f46e5] font-bold">{count} 幕</span>
          </label>
          <input type="range" min={2} max={12} value={count}
            onChange={e => setCount(Number(e.target.value))} className="w-full accent-[#6366f1]" />
          <div className="flex justify-between text-xs text-[#94a3b8] mt-1"><span>2 幕</span><span>12 幕</span></div>
        </div>

        {(characterAName || characterBName) && (
          <div className="bg-[#f8fafc] rounded-lg p-2.5 text-[11px] text-[#64748b] space-y-0.5">
            {characterAName && <div>🎭 角色 A：<span className="text-[#4f46e5]">{characterAName}</span></div>}
            {characterBName && <div>🎭 角色 B：<span className="text-[#d97706]">{characterBName}</span></div>}
          </div>
        )}

        <div className="bg-[#ca8a04]/5 border border-[#ca8a04]/20 rounded-lg p-2.5 text-[11px] text-[#ca8a04]">
          ⚠️ AI 會「覆蓋」當前所有幕的標題、描述、台詞、運鏡。已生成圖片的幕不會受影響但內容會被換新。
        </div>

        <DarkButton
          onClick={() => aiMutation.mutate()}
          disabled={!pitch.trim() || aiMutation.isPending}
          className="w-full justify-center"
        >
          {aiMutation.isPending ? "🤖 AI 撰寫中…約 10 秒" : "✨ 生成腳本"}
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
        <span>✨</span><span>提示詞素材庫</span>
      </p>
      <p className="text-[10px] text-[#cbd5e1] mb-2 leading-snug">點擊任一標籤快速插入到場景描述末尾</p>
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
  // Compile crossfade (ms) between adjacent scenes — sent to /compile.
  // Slider exposes 0 / 200 / 400 / 800 ms (default 400 = subtle fade).
  const [compileCrossfadeMs, setCompileCrossfadeMs] = useState<number>(400);

  useEffect(() => {
    if (episode) {
      const s: DramaScene[] = JSON.parse(episode.scenes || "[]");
      setLocalScenes(s);
    }
  }, [episode]);

  const saveScenesMutation = useMutation({
    mutationFn: (scenes: DramaScene[]) =>
      apiRequest("PATCH", `/api/drama/episodes/${episodeId}`, { scenes }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: "分鏡已儲存" });
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
      toast({ title: chainMode ? "🔗 連續模式已開啟" : "連續模式已關閉" });
    },
    onError: (e: any) => toast({ title: "設定失敗", description: e.message, variant: "destructive" }),
  });

  const generateImagesMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/generate-images`, {}).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: `開始生成！消耗 ${data.creditCost} 積分` });
    },
    onError: (e: any) => toast({ title: "生成失敗", description: e.message, variant: "destructive" }),
  });

  const regenerateSceneMutation = useMutation({
    mutationFn: ({ sceneIdx, overrides }: { sceneIdx: number; overrides?: any }) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/regenerate-scene/${sceneIdx}`, overrides || {}).then(r => r.json()),
    onSuccess: (_, { sceneIdx }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: `第 ${sceneIdx + 1} 幕重新生成中` });
    },
    onError: (e: any) => toast({ title: "生成失敗", description: e.message, variant: "destructive" }),
  });

  const animateSceneMutation = useMutation({
    mutationFn: ({ sceneIdx, duration, resolution, useOmniMode, useFirstLastFrame }: any) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/animate-scene/${sceneIdx}`, { duration, resolution, useOmniMode, useFirstLastFrame }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: `動畫生成中，消耗 ${data.creditCost} 積分` });
      setAnimateDialog(null);
    },
    onError: (e: any) => toast({ title: "動畫失敗", description: e.message, variant: "destructive" }),
  });

  // ─── First/Last Frame Generation ─────────────────────────────────────────
  const generateFramesMutation = useMutation({
    mutationFn: (sceneIdx: number) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/scenes/${sceneIdx}/generate-frames`, {}).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: `首尾關鍵幀生成中（-${data.creditsUsed} 積分）` });
    },
    onError: (e: any) => toast({ title: "首尾幀生成失敗", description: e.message, variant: "destructive" }),
  });

  // ─── AI Video Prompt Rewriter ────────────────────────────────────────────
  const generateVideoPromptMutation = useMutation({
    mutationFn: (sceneIdx: number) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/scenes/${sceneIdx}/generate-video-prompt`, {}).then(r => r.json()),
    onSuccess: (data, sceneIdx) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      // Reflect immediately in local state
      setLocalScenes(prev => prev.map((s, i) => i === sceneIdx ? { ...s, videoPrompt: data.videoPrompt } : s));
      toast({ title: "✨ AI 已寫好專業視頻提示詞" });
    },
    onError: (e: any) => toast({ title: "AI 生成提示詞失敗", description: e.message, variant: "destructive" }),
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
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({
        title: `🔁 連續模式整集重生中`,
        description: `將依序重生 ${data.sceneCount} 幕，共消耗 ${data.creditCost} 積分`,
      });
    },
    onError: (e: any) => {
      chainGeneratingObservedRef.current = false;
      setChainBatchActive(false);
      toast({ title: "整集重生失敗", description: e.message, variant: "destructive" });
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
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "🛑 已送出中止請求",
        description: "目前這幕跑完後就會停下，剩餘積分會自動退回",
      });
    },
    onError: (e: any) => toast({ title: "中止失敗", description: e.message, variant: "destructive" }),
  });

  const animateAllMutation = useMutation({
    mutationFn: ({ duration, resolution, useOmniMode }: any) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/animate-all`, { duration, resolution, useOmniMode, generateAudio: true }).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: `🎬 開始批次生成 ${data.sceneCount} 幕影片`, description: `共消耗 ${data.creditCost} 積分，請耐心等候` });
    },
    onError: (e: any) => toast({ title: "批次生成失敗", description: e.message, variant: "destructive" }),
  });

  const compileMutation = useMutation({
    mutationFn: (crossfadeMs: number) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/compile`, { crossfadeMs }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: "🎞️ 開始剪接合併", description: "完成後可在下方播放器播放與下載" });
    },
    onError: (e: any) => toast({ title: "剪接失敗", description: e.message, variant: "destructive" }),
  });

  const replaceImageMutation = useMutation({
    mutationFn: ({ sceneIdx, objectPath }: { sceneIdx: number; objectPath: string }) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/replace-scene-image/${sceneIdx}`, { objectPath }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: "圖片已替換" });
    },
  });

  const updateScene = (idx: number, updates: Partial<DramaScene>) => {
    setLocalScenes(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s));
  };

  const addScene = () => {
    if (localScenes.length >= 12) { toast({ title: "最多 12 幕" }); return; }
    const s: DramaScene = {
      id: nid(), sceneNumber: localScenes.length + 1, title: `第 ${localScenes.length + 1} 幕`,
      description: "", dialogue: "", cameraMovement: "", useCharA: true, useCharB: true, imageStatus: "pending",
    };
    setLocalScenes(prev => [...prev, s]);
  };

  const removeScene = (idx: number) => {
    if (localScenes.length <= 2) { toast({ title: "最少需要 2 幕" }); return; }
    setLocalScenes(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, sceneNumber: i + 1 })));
    if (selectedIdx === idx) setSelectedIdx(null);
    else if (selectedIdx !== null && selectedIdx > idx) setSelectedIdx(selectedIdx - 1);
  };

  const replaceFileRef = useRef<HTMLInputElement | null>(null);
  const pendingCount = localScenes.filter(s => s.imageStatus !== "completed").length;
  const creditCost = pendingCount * 3;
  const hasEnoughCredits = (user?.credits ?? 0) >= creditCost;

  const handleGenerateImages = () => {
    saveScenesMutation.mutate(localScenes, {
      onSuccess: () => generateImagesMutation.mutate(),
    });
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (!episode) return <div className="text-center py-20 text-[#ef4444]">找不到集數</div>;

  const serverScenes: DramaScene[] = JSON.parse(episode.scenes || "[]");
  const selectedScene = selectedIdx !== null ? localScenes[selectedIdx] : null;
  const selectedServerScene = selectedIdx !== null ? serverScenes[selectedIdx] : null;

  // Per-scene effective chain mode: episode-level toggle OR per-scene override
  const chainEffective: boolean[] = localScenes.map(s => {
    const ov = s.chainModeOverride ?? "inherit";
    return ov === "on" ? true : ov === "off" ? false : !!episode.chainMode;
  });

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col bg-[#f8fafc]">

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 h-12 bg-[#ffffff] border-b border-[#e2e8f0] shrink-0">
        <button onClick={onBack} className="text-[#64748b] hover:text-[#334155] text-sm transition-colors shrink-0">← 返回</button>
        <div className="w-px h-4 bg-[#e2e8f0]" />
        <div className="flex-1 min-w-0">
          <span className="text-xs text-[#94a3b8]">{project?.title} · </span>
          <span className="text-sm font-medium text-[#0f172a]">{episode.title}</span>
          {episode.status === "generating" && (
            <span className="ml-2 text-xs text-[#ca8a04] animate-pulse">● 生成中</span>
          )}
        </div>

        {/* View toggle */}
        <div className="flex gap-1 bg-[#f8fafc] rounded-lg p-0.5">
          <button onClick={() => setActiveView("flow")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeView === "flow" ? "bg-[#6366f1] text-white" : "text-[#64748b] hover:text-[#334155]"}`}>
            ⬡ 節點流
          </button>
          <button onClick={() => setActiveView("grid")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeView === "grid" ? "bg-[#6366f1] text-white" : "text-[#64748b] hover:text-[#334155]"}`}>
            ⊞ 格網
          </button>
        </div>

        <DarkButton variant="secondary" onClick={() => setShowAIDialog(true)}
          style={{ background: "#6366f110", borderColor: "#6366f140", color: "#4f46e5" }}>
          🤖 AI 寫腳本
        </DarkButton>

        {/* Episode-level Chain Mode toggle */}
        <button
          onClick={() => setChainModeMutation.mutate(!episode.chainMode)}
          disabled={setChainModeMutation.isPending}
          title={episode.chainMode
            ? "連續模式開啟中：第 N+1 幕會自動以第 N 幕的尾幀為主參考，並在 AI 寫提示詞時帶入前後幕 context"
            : "點擊開啟連續模式，讓相鄰幕之間視覺與敘事自然銜接"}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all shrink-0 ${
            episode.chainMode
              ? "bg-[#10b981]/10 border-[#10b981]/40 text-[#047857]"
              : "bg-[#f8fafc] border-[#e2e8f0] text-[#64748b] hover:border-[#10b981]/40 hover:text-[#047857]"
          } disabled:opacity-50`}
          data-testid="toggle-chain-mode"
        >
          <span>🔗</span>
          <span>連續模式</span>
          <span className={`w-7 h-3.5 rounded-full relative transition-all ${episode.chainMode ? "bg-[#10b981]" : "bg-[#cbd5e1]"}`}>
            <span className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-all ${episode.chainMode ? "left-3.5" : "left-0.5"}`} />
          </span>
        </button>

        {/* One-click: re-apply chain mode to the whole episode */}
        {episode.chainMode && serverScenes.length >= 2 && (() => {
          const firstReady = serverScenes[0]?.imageStatus === "completed" && (serverScenes[0]?.bunnyUrl || serverScenes[0]?.imageUrl);
          // Targets: scenes 2..N excluding ones already in flight
          const targets = serverScenes.slice(1).filter(s => s.imageStatus !== "generating");
          const inFlightAfterFirst = serverScenes.slice(1).filter(s => s.imageStatus === "generating").length;
          const chainCost = targets.length * 3;
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
                  🔁 整集連續重生中 {completedAfterFirst}/{totalChainTargets}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (cancelChainRegenMutation.isPending || cancelRequested) return;
                    if (!confirm("中止後，目前這幕跑完就會停下，剩下未開始的幕不再執行，已扣積分會退回。確定中止？")) return;
                    cancelChainRegenMutation.mutate();
                  }}
                  disabled={cancelChainRegenMutation.isPending || cancelRequested}
                  title={cancelRequested
                    ? "已送出中止請求，等目前這幕跑完就會停"
                    : "中止整集連續重生：跑完當前這幕後停下，未開始的幕積分會退回"}
                  className="text-xs px-2.5 py-1.5 rounded-lg border bg-[#fef2f2] border-[#fecaca] text-[#b91c1c] hover:bg-[#fee2e2] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  data-testid="button-cancel-chain-regen"
                >
                  {cancelRequested ? "⏳ 中止中…" : "🛑 中止"}
                </button>
              </div>
            );
          }

          if (!firstReady || targets.length === 0 || blockNewBatch) return null;

          return (
            <>
              <span title="從第 2 幕起，依序以上一幕尾幀為參考重生整集，讓視覺自然銜接" className="shrink-0">
                <DarkButton
                  variant="secondary"
                  onClick={() => {
                    if (!confirm(`即將從第 2 幕開始依序重生 ${targets.length} 幕，每幕以上一幕的尾幀為參考，共消耗 ${chainCost} 積分。確定？`)) return;
                    regenerateAllChainMutation.mutate();
                  }}
                  disabled={insufficient}
                  style={{ background: "#10b98110", borderColor: "#10b98140", color: "#047857" }}
                  data-testid="button-regenerate-all-chain"
                >
                  🔁 整集重生（連續）(-{chainCost})
                </DarkButton>
              </span>
              {insufficient && (
                <span className="text-xs text-[#ef4444] shrink-0">積分不足</span>
              )}
            </>
          );
        })()}

        <DarkButton variant="secondary" onClick={() => saveScenesMutation.mutate(localScenes)} disabled={saveScenesMutation.isPending}>
          {saveScenesMutation.isPending ? "儲存中..." : "💾 儲存"}
        </DarkButton>
        <DarkButton variant="secondary" onClick={addScene} disabled={localScenes.length >= 12}>＋ 新增幕</DarkButton>
        <DarkButton
          onClick={handleGenerateImages}
          disabled={!hasEnoughCredits || generateImagesMutation.isPending || pendingCount === 0}
        >
          {generateImagesMutation.isPending ? "⏳ 生成中..." : `🎨 生成圖片 (-${creditCost}積分)`}
        </DarkButton>
        {!hasEnoughCredits && creditCost > 0 && (
          <span className="text-xs text-[#ef4444] shrink-0">積分不足</span>
        )}

        {/* Batch animate all scenes */}
        {(() => {
          const animatable = serverScenes.filter(s => s.imageStatus === "completed" && s.bunnyUrl && !(s.videoStatus === "completed" && s.videoBunnyUrl) && s.videoStatus !== "generating").length;
          const generatingCount = serverScenes.filter(s => s.videoStatus === "generating").length;
          const batchCost = animatable * 5 * 8; // 5s @ 720p
          return animatable > 0 ? (
            <DarkButton
              onClick={() => {
                if (!confirm(`即將為 ${animatable} 幕生成影片（5秒 720P + AI 音效），共消耗 ${batchCost} 積分，確定？`)) return;
                animateAllMutation.mutate({ duration: 5, resolution: "720p", useOmniMode: false });
              }}
              disabled={animateAllMutation.isPending || (user?.credits ?? 0) < batchCost}
              style={{ background: "#0ea5e9", borderColor: "#0ea5e9" }}
            >
              {animateAllMutation.isPending ? "⏳ 派發中..." : `🎬 一鍵生成全部影片 (-${batchCost})`}
            </DarkButton>
          ) : generatingCount > 0 ? (
            <span className="text-xs text-[#0ea5e9] animate-pulse shrink-0">● {generatingCount} 幕影片生成中</span>
          ) : null;
        })()}

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
                title="相鄰幕之間的轉場淡入淡出時間（影像 + 音訊），0=硬切"
                data-testid="group-crossfade-slider"
              >
                <span className="text-[11px] text-[#047857] font-medium select-none whitespace-nowrap">
                  轉場
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
                  {compileCrossfadeMs === 0 ? "硬切" : `${compileCrossfadeMs}ms`}
                </span>
              </div>
              <DarkButton
                onClick={() => {
                  const fadeNote = compileCrossfadeMs > 0
                    ? `（含 ${compileCrossfadeMs}ms 轉場淡入淡出）`
                    : "（硬切）";
                  if (!confirm(`即將剪接合併 ${serverScenes.length} 幕影片並燒入字幕${fadeNote}，約需 1-3 分鐘。確定？`)) return;
                  compileMutation.mutate(compileCrossfadeMs);
                }}
                disabled={fadeDisabled}
                style={{ background: "#10b981", borderColor: "#10b981" }}
                data-testid="btn-compile-episode"
              >
                {isCompiling ? "⏳ 剪接中..." : episode.compiledVideoUrl ? "🎞 重新剪接" : "🎞 剪接合併＋字幕"}
              </DarkButton>
            </div>
          );
        })()}

        {/* Download all assets as ZIP */}
        <a
          href={`/api/drama/episodes/${episodeId}/download-zip`}
          download
          className="text-xs font-medium text-[#475569] bg-[#f1f5f9] hover:bg-[#e2e8f0] px-3 py-1.5 rounded-md transition-colors shrink-0 border border-[#e2e8f0]"
          data-testid="link-download-zip"
        >
          📦 下載素材 ZIP
        </a>
      </div>

      {/* ── Compiled Episode Player ─────────────────────────────────────────── */}
      {(episode.compiledVideoUrl || episode.compiledStatus === "compiling" || episode.compiledStatus === "failed") && (
        <div className="px-4 py-3 bg-[#ecfdf5] border-b border-[#10b98140] shrink-0">
          {episode.compiledStatus === "compiling" && (
            <div className="flex items-center gap-2 text-sm text-[#047857]">
              <Spinner /> <span>正在剪接合併並燒字幕，約需 1-3 分鐘…</span>
            </div>
          )}
          {episode.compiledStatus === "failed" && (
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm text-[#dc2626]">❌ 剪接失敗：{episode.compiledError}</div>
              <DarkButton variant="secondary" onClick={() => compileMutation.mutate(compileCrossfadeMs)}>重試</DarkButton>
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
                <div className="text-sm font-medium text-[#047857]">✅ 完整漫劇影片已生成</div>
                <div className="text-xs text-[#64748b] truncate">{episode.compiledVideoUrl}</div>
              </div>
              <a
                href={episode.compiledVideoUrl}
                download
                className="text-sm font-medium text-white bg-[#10b981] hover:bg-[#059669] px-4 py-2 rounded-md transition-colors shrink-0"
                data-testid="link-download-compiled"
              >
                ⬇ 下載 MP4
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
                {["📝 分鏡描述", "→", "🖼 SeedDream 出圖", "→", "🎬 SeedDance 動畫"].map((s, i) => (
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
                  { color: "#cbd5e1", label: "待生成" },
                  { color: "#ca8a04", label: "生成中" },
                  { color: "#22c55e", label: "完成" },
                  { color: "#ef4444", label: "失敗" },
                  { color: "#6366f1", label: "已選取" },
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
                        <img src={imgUrl} alt={scene.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center">
                          {ss?.imageStatus === "generating" ? (
                            <><Spinner color="#ca8a04" /><span className="text-xs text-[#ca8a04] mt-2">生成中</span></>
                          ) : <span className="text-3xl">🎬</span>}
                        </div>
                      )}
                      <div className="absolute top-1.5 left-1.5 bg-[#0f172a]/85 text-white text-[10px] px-1.5 py-0.5 rounded-full">{scene.sceneNumber}</div>
                      {ss?.videoStatus === "completed" && <div className="absolute top-1.5 right-1.5 bg-[#a855f7]/80 text-white text-[10px] px-1.5 py-0.5 rounded-full">▶</div>}
                      {chainEffective[idx] && idx > 0 && (
                        <div
                          className="absolute bottom-1.5 left-1.5 bg-[#10b981] text-white text-[10px] px-1.5 py-0.5 rounded-full font-medium shadow"
                          title={`銜接第 ${idx} 幕的尾幀`}
                        >
                          🔗 銜接 #{idx}
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
                <span className="text-xs text-[#6366f1] font-mono">SCENE {(selectedIdx ?? 0) + 1}</span>
                <p className="text-sm font-semibold text-[#0f172a] mt-0.5">場景屬性</p>
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
                <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">幕名稱</label>
                <DarkInput
                  value={selectedScene.title}
                  onChange={v => updateScene(selectedIdx!, { title: v })}
                  placeholder="幕名稱"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">場景描述</label>
                <DarkTextarea
                  value={selectedScene.description}
                  onChange={v => updateScene(selectedIdx!, { description: v })}
                  placeholder="描述場景內容，AI 將根據此生成圖片..."
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
                <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">台詞（選填）</label>
                <DarkInput
                  value={selectedScene.dialogue || ""}
                  onChange={v => updateScene(selectedIdx!, { dialogue: v })}
                  placeholder="人物台詞"
                />
              </div>

              {/* Camera movement */}
              <div>
                <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">攝影機運鏡</label>
                <DarkSelect
                  value={selectedScene.cameraMovement || "none"}
                  onChange={v => updateScene(selectedIdx!, { cameraMovement: v === "none" ? "" : v })}
                  options={CAMERA_MOVEMENTS}
                />
              </div>

              {/* Character toggles */}
              {((project?.characterAUrls ?? []).length > 0 || (project?.characterBUrls ?? []).length > 0) && (
                <div>
                  <label className="text-[10px] text-[#64748b] uppercase tracking-wide mb-1.5 block">角色出場</label>
                  <div className="flex gap-2">
                    {(project?.characterAUrls ?? []).length > 0 && (
                      <button onClick={() => updateScene(selectedIdx!, { useCharA: !selectedScene.useCharA })}
                        className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${selectedScene.useCharA ? "bg-[#6366f1]/10 border-[#6366f1]/40 text-[#4f46e5]" : "border-[#cbd5e1] text-[#94a3b8]"}`}>
                        角色A {selectedScene.useCharA ? "✓" : "×"}
                      </button>
                    )}
                    {(project?.characterBUrls ?? []).length > 0 && (
                      <button onClick={() => updateScene(selectedIdx!, { useCharB: !selectedScene.useCharB })}
                        className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${selectedScene.useCharB ? "bg-[#f59e0b]/10 border-[#f59e0b]/40 text-[#d97706]" : "border-[#cbd5e1] text-[#94a3b8]"}`}>
                        角色B {selectedScene.useCharB ? "✓" : "×"}
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
                  <label className="text-[10px] text-[#64748b] uppercase tracking-wide">視頻提示詞（影片生成用）</label>
                  <button
                    onClick={() => generateVideoPromptMutation.mutate(selectedIdx!)}
                    disabled={generateVideoPromptMutation.isPending || !selectedScene.description.trim()}
                    className="text-[10px] text-[#7c3aed] hover:text-[#6d28d9] disabled:text-[#cbd5e1] flex items-center gap-1"
                    data-testid="button-ai-video-prompt"
                  >
                    {generateVideoPromptMutation.isPending ? "AI 撰寫中…" : "✨ AI 寫提示詞"}
                  </button>
                </div>
                <DarkTextarea
                  value={selectedScene.videoPrompt || ""}
                  onChange={v => updateScene(selectedIdx!, { videoPrompt: v })}
                  placeholder="留空＝用場景描述。填入＝動畫優先用此（含運鏡、景別、光線）"
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
                  resolvedLabel = "自訂上傳圖";
                } else if (refSource === "custom") {
                  resolvedUrl = fallbackUrl;
                  resolvedLabel = fallbackUrl
                    ? "（尚未上傳自訂圖，暫用自動回退）"
                    : "（尚未上傳自訂圖）";
                } else if (refSource === "prevLast") {
                  resolvedUrl = prevLast || fallbackUrl;
                  resolvedLabel = prevLast ? `第 ${selectedIdx} 幕尾幀` : "（尾幀缺失，回退）";
                } else if (refSource === "prevFirst") {
                  resolvedUrl = prevFirst || fallbackUrl;
                  resolvedLabel = prevFirst ? `第 ${selectedIdx} 幕首幀` : "（首幀缺失，回退）";
                } else if (refSource === "prevMain") {
                  resolvedUrl = prevMain || fallbackUrl;
                  resolvedLabel = prevMain ? `第 ${selectedIdx} 幕主圖` : "（主圖缺失，回退）";
                } else {
                  resolvedUrl = fallbackUrl;
                  resolvedLabel = prevLast
                    ? `自動：第 ${selectedIdx} 幕尾幀`
                    : prevMain
                    ? `自動：第 ${selectedIdx} 幕主圖`
                    : "";
                }

                return (
                  <div className="rounded-xl border border-[#e2e8f0] p-3 space-y-2.5 bg-[#f0fdf4]">
                    <div>
                      <p className="text-xs font-semibold text-[#0f172a]">
                        🔗 銜接上一幕
                        {effective && <span className="ml-1 text-[10px] text-[#047857]">·啟用中</span>}
                      </p>
                      <p className="text-[10px] text-[#64748b] mt-0.5">
                        指定一張參考圖，讓本幕構圖自然延續
                      </p>
                    </div>

                    <div className="flex gap-1 bg-white rounded-lg p-0.5 border border-[#e2e8f0]">
                      {([
                        { v: "inherit", label: `跟隨集設定（目前 ${episode.chainMode ? "開" : "關"}）` },
                        { v: "on", label: "強制開" },
                        { v: "off", label: "強制關" },
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
                            銜接來源
                          </label>
                          <select
                            value={refSource}
                            onChange={e => updateScene(selectedIdx!, {
                              chainRefSource: e.target.value as DramaScene["chainRefSource"],
                            })}
                            data-testid="select-chain-ref-source"
                            className="w-full bg-white border border-[#cbd5e1] rounded-lg px-2 py-1 text-[11px] text-[#0f172a] focus:outline-none focus:border-[#10b981]"
                          >
                            <option value="auto">自動（尾幀 → 主圖）</option>
                            <option value="prevLast">上一幕尾幀</option>
                            <option value="prevFirst">上一幕首幀</option>
                            <option value="prevMain">上一幕主圖</option>
                            <option value="custom">自訂上傳圖</option>
                          </select>
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
                              alt="銜接參考"
                              className="w-12 h-20 object-cover rounded border border-[#10b981]/40 shrink-0"
                            />
                            <p className="text-[10px] text-[#475569]">
                              {resolvedLabel}<br />
                              <span className="text-[#94a3b8]">（重生本幕後構圖會接續）</span>
                            </p>
                          </div>
                        ) : (
                          <p className="text-[10px] text-[#ca8a04]">
                            ⚠ 沒有可用的銜接參考圖，請上傳自訂圖或等上一幕生成完成
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
                    <p className="text-xs font-semibold text-[#0f172a]">🎞 首尾關鍵幀模式</p>
                    <p className="text-[10px] text-[#64748b] mt-0.5">先生兩張關鍵幀，影片更平順</p>
                  </div>
                  <button
                    onClick={() => updateScene(selectedIdx!, { useFirstLastFrame: !selectedScene.useFirstLastFrame })}
                    className={`w-10 h-6 rounded-full relative shrink-0 transition-all ${selectedScene.useFirstLastFrame ? "bg-[#6366f1]" : "bg-[#e2e8f0]"}`}
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
                          <><Spinner color="#ca8a04" /><span className="text-[10px] text-[#ca8a04] mt-1">生成中</span></>
                        ) : status === "failed" ? (
                          <span className="text-[10px] text-[#ef4444]">失敗</span>
                        ) : (
                          <span className="text-[10px] text-[#94a3b8]">{which === "first" ? "首幀" : "尾幀"}</span>
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
                  {generateFramesMutation.isPending ? "派發中…" :
                   (selectedServerScene?.firstFrameUrl && selectedServerScene?.lastFrameUrl) ? "🔄 重新生成首尾幀 (-6積分)" : "🎞 生成首尾幀 (-6積分)"}
                </DarkButton>
              </div>

              {/* Separator */}
              <div className="border-t border-[#e2e8f0]" />

              {/* Actions */}
              <div className="space-y-2">
                <p className="text-[10px] text-[#64748b] uppercase tracking-wide">動作</p>

                {selectedServerScene?.imageStatus === "completed" && (
                  <DarkButton variant="secondary" className="w-full justify-center"
                    onClick={() => regenerateSceneMutation.mutate({ sceneIdx: selectedIdx! })}
                    disabled={regenerateSceneMutation.isPending}>
                    🔄 重新生成圖片 (-3積分)
                  </DarkButton>
                )}

                {selectedServerScene?.imageStatus === "failed" && (
                  <DarkButton variant="danger" className="w-full justify-center"
                    onClick={() => regenerateSceneMutation.mutate({ sceneIdx: selectedIdx! })}>
                    🔄 重試生成
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
                    🎬 生成動畫影片
                  </DarkButton>
                )}

                {selectedServerScene?.videoStatus === "generating" && (
                  <div className="text-xs text-center text-[#ca8a04] animate-pulse py-2">影片生成中...</div>
                )}

                {/* Replace image */}
                {selectedServerScene?.imageStatus === "completed" && (
                  <DarkButton variant="secondary" className="w-full justify-center"
                    onClick={() => replaceFileRef.current?.click()}>
                    🖼 替換圖片
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
                  ✕ 刪除此幕
                </DarkButton>
              </div>

              {/* Port info (like ComicFlow inspector) */}
              <div className="border-t border-[#e2e8f0] pt-3">
                <p className="text-[10px] text-[#cbd5e1] uppercase tracking-wide mb-2">連接埠</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#94a3b8] font-mono border border-[#e2e8f0] rounded px-2 py-0.5">◎ text_in</span>
                  <span className="text-[10px] text-[#6366f1] font-mono border border-[#6366f1]/20 rounded px-2 py-0.5">image_out ◉</span>
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
              <p className="text-xs text-[#cbd5e1]">點擊場景節點<br />開啟屬性面板</p>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 h-7 bg-[#f1f5f9] border-t border-[#e2e8f0] shrink-0">
        <span className="text-[10px] text-[#cbd5e1]">節點 {localScenes.length} 個 ／ 完成 {serverScenes.filter(s => s.imageStatus === "completed").length} 幕</span>
        <span className="text-[10px] text-[#cbd5e1]">積分 {user?.credits ?? 0} ／ 待生成 {pendingCount} 幕</span>
        <span className={`text-[10px] ${episode.status === "generating" ? "text-[#ca8a04]" : "text-[#cbd5e1]"}`}>
          {episode.status === "generating" ? "⟳ 執行中..." : "● 就緒"}
        </span>
      </div>

      {/* Animate Dialog */}
      <Modal open={!!animateDialog} onClose={() => setAnimateDialog(null)} title="🎬 生成動畫影片">
        {animateDialog && (
          <div className="space-y-5">
            <div>
              <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">
                影片時長：<span className="text-[#4f46e5] font-bold">{animDuration} 秒</span>
              </label>
              <input type="range" min={4} max={12} value={animDuration}
                onChange={e => setAnimDuration(Number(e.target.value))} className="w-full accent-[#6366f1]" />
              <div className="flex justify-between text-xs text-[#94a3b8] mt-1"><span>4秒</span><span>12秒</span></div>
            </div>

            <div onClick={() => setAnimUseOmni(!animUseOmni)}
              className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${animUseOmni ? "border-[#6366f1] bg-[#6366f1]/5" : "border-[#e2e8f0] hover:border-[#6366f1]/30"}`}>
              <div>
                <p className="text-sm font-semibold text-[#0f172a]">🌟 SeedDance 2.0 全能模式</p>
                <p className="text-xs text-[#64748b] mt-0.5">多圖參考，保持角色A/B一致性</p>
              </div>
              <div className={`w-10 h-6 rounded-full relative flex-shrink-0 transition-all ${animUseOmni ? "bg-[#6366f1]" : "bg-[#e2e8f0]"}`}>
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
                    <p className="text-sm font-semibold text-[#0f172a]">🎞 首尾關鍵幀模式</p>
                    <p className="text-xs text-[#64748b] mt-0.5">{hasFrames ? "用首尾幀補間，動作最平順" : "請先在右側面板生成首尾幀"}</p>
                  </div>
                  <div className={`w-10 h-6 rounded-full relative flex-shrink-0 transition-all ${animUseFirstLast && !disabled ? "bg-[#10b981]" : "bg-[#e2e8f0]"}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${animUseFirstLast && !disabled ? "left-5" : "left-1"}`} />
                  </div>
                </div>
              );
            })()}

            <div>
              <label className="text-xs text-[#64748b] uppercase tracking-wide mb-2 block">解析度</label>
              <div className="grid grid-cols-2 gap-3">
                {(["720p", "1080p"] as const).map(r => {
                  const cost = r === "1080p" ? Math.ceil(animDuration * 15) : Math.ceil(animDuration * 8);
                  return (
                    <button key={r} onClick={() => setAnimResolution(r)}
                      className={`p-3 rounded-xl border-2 text-sm transition-all ${animResolution === r ? "border-[#6366f1] bg-[#6366f1]/10 text-[#4f46e5]" : "border-[#e2e8f0] text-[#64748b] hover:border-[#6366f1]/40"}`}>
                      <div className="font-bold">{r}</div>
                      <div className="text-xs text-[#94a3b8]">{cost} 積分</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-[#f8fafc] rounded-lg p-3 text-sm text-[#64748b]">
              消耗 <span className="font-bold text-[#4f46e5]">
                {animResolution === "1080p" ? Math.ceil(animDuration * 15) : Math.ceil(animDuration * 8)} 積分
              </span>
              （現有 {user?.credits ?? 0} 積分）
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
              {animateSceneMutation.isPending ? "生成中..." : "🎬 開始生成影片"}
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
              `AI 回傳 ${aiScenes.length} 幕，比目前的 ${localScenes.length} 幕少。\n\n` +
              `多出的尾端有已生成圖片/影片的場景。\n\n` +
              `確定要直接覆蓋（會丟失尾端已生成內容）？\n\n` +
              `按【取消】會保留尾端已生成的場景，只覆蓋前 ${aiScenes.length} 幕。`
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

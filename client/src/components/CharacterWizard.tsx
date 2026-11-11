import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { useEmbed } from "@/components/EmbedBar";
import { Link } from "wouter";
import { FOUR_VIEW_COST } from "@shared/pricing";

// 上傳照片建立角色：最多 WIZARD_MAX_PHOTOS 張（圖片模型一次最多吃 10 張參考圖）。
// 第一張一定要是臉部正面照，生成時最優先參考它；其餘建議側臉、半身、全身、不同表情。
// 帳號的第一個角色至少要 FIRST_CHARACTER_MIN_PHOTOS 張（第一次建模要夠完整，免費四視圖才做得像）；之後的角色 1 張就能建。
// 能不能完整做出來取決於照片品質：畫面上會提醒，短邊小於 LOW_RES_SIDE 像素的照片會標「解析度低」。
// 照片依上傳順序成為角色圖庫，可以點「設為第一張」調整。照片越多、角度越完整，生成越像本人。
// 建立前必須確認照片是本人或已取得同意 —— 這個功能不能拿來做別人的角色。
// 按「下一步」就建立角色、開始生成四視圖，並回到角色庫。帳號的第一次免費；
// 第二個角色開始每次建立收 FOUR_VIEW_COST 積分（按鈕上寫明），積分不夠就不能建立，帶去會員商城。
// 嵌入模式（客戶小鎮工作區）維持原樣：只建立角色，四視圖在角色卡片上另外按。

export const WIZARD_MAX_PHOTOS = 10;
export const FIRST_CHARACTER_MIN_PHOTOS = 6;
const LOW_RES_SIDE = 640;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const TIPS = [
  "第一張放臉部正面：光線充足、五官清楚，不要戴墨鏡或口罩",
  "再放側臉、半身、全身、不同表情，角度越多越像",
  "不要開美顏或濾鏡，髮型跟平常一樣",
];

/** Shorter side of the image in pixels; 0 when the browser cannot read it. */
function shortSide(file: File): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(Math.min(img.naturalWidth, img.naturalHeight)); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    img.src = url;
  });
}

async function uploadToObjectStorage(file: File): Promise<string> {
  const uploadRes = await apiRequest("POST", "/api/objects/upload", {});
  const { uploadURL } = await uploadRes.json();
  const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!putRes.ok) throw new Error("上傳失敗");
  const pathRes = await apiRequest("PUT", "/api/objects/set-path", { imageURL: uploadURL });
  const { objectPath } = await pathRes.json();
  return objectPath as string;
}

export function CharacterWizard({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: string) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [lowRes, setLowRes] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const { user } = useUser();
  const embed = !!useEmbed();
  const freeFourView = !!user && !user.freeFourViewUsedAt && !embed;
  // From the second character on, creating one costs FOUR_VIEW_COST and always makes the 四視圖.
  const paidFourView = !!user && !freeFourView && !embed;
  const shortOfCredits = paidFourView && !user?.isAdmin && (user?.credits ?? 0) < FOUR_VIEW_COST;

  const room = WIZARD_MAX_PHOTOS - photos.length;
  // The account's first character (the one that gets the free 四視圖) needs a fuller set of photos.
  const minPhotos = freeFourView ? FIRST_CHARACTER_MIN_PHOTOS : 1;
  const missing = Math.max(0, minPhotos - photos.length);
  const lowResCount = photos.filter(u => lowRes.includes(u)).length;
  const ready = missing === 0 && name.trim().length > 0 && consent && !shortOfCredits;

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;
    const usable = files.filter(f => f.type.startsWith("image/") && f.size <= MAX_UPLOAD_BYTES).slice(0, room);
    if (usable.length < files.length) {
      toast({
        title: files.length > room && usable.length === room ? `最多 ${WIZARD_MAX_PHOTOS} 張，多的沒有加入` : "有些檔案沒有加入",
        description: "請上傳 20MB 以內的 JPG、PNG 或 WEBP。",
        variant: usable.length === 0 ? "destructive" : undefined,
      });
    }
    setUploading(usable.length);
    let failed = 0;
    for (const file of usable) {
      try {
        const [path, side] = await Promise.all([uploadToObjectStorage(file), shortSide(file)]);
        if (side > 0 && side < LOW_RES_SIDE) setLowRes(prev => [...prev, path]);
        setPhotos(prev => (prev.length < WIZARD_MAX_PHOTOS ? [...prev, path] : prev));
      } catch {
        failed += 1;
      } finally {
        setUploading(n => Math.max(0, n - 1));
      }
    }
    if (failed > 0) toast({ title: `${failed} 張上傳失敗`, description: "請再試一次。", variant: "destructive" });
  };

  const remove = (i: number) => setPhotos(prev => prev.filter((_, idx) => idx !== i));
  const makeFirst = (i: number) => setPhotos(prev => [prev[i], ...prev.filter((_, idx) => idx !== i)]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/character-library", { name: name.trim(), refImageUrls: photos, styleHint: "realistic" });
      const created = await res.json() as { id: string };
      // Start the 四視圖 right away (free the first time, FOUR_VIEW_COST after). If it cannot start, the character is still saved.
      let started = false;
      if (freeFourView || paidFourView) {
        try { await apiRequest("POST", `/api/character-library/${created.id}/generate-four-views`, {}); started = true; }
        catch { /* the button on the character card can start it later */ }
      }
      return { ...created, started };
    },
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast(c.started
        ? { title: "角色已建立，四視圖生成中", description: `${freeFourView ? "這次免費" : `已扣 ${FOUR_VIEW_COST} 積分`}。大約一兩分鐘後會出現在角色卡片上。` }
        : { title: "角色已建立", description: "已經放進角色庫。在角色卡片上按「生成四視圖」，之後出圖會更像本人。" });
      onCreated?.(c.id);
      onClose();
    },
    onError: () => toast({ title: "建立失敗", description: "請稍後再試。", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center md:p-4" onClick={onClose}>
      <div className="bg-white w-full md:max-w-xl max-h-[92vh] overflow-auto rounded-t-3xl md:rounded-2xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid="character-wizard">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">上傳照片建立角色</h3>
            <p className="text-sm text-slate-500 mt-1">{freeFourView ? `第一次建立角色請準備至少 ${FIRST_CHARACTER_MIN_PHOTOS} 張，最多 ${WIZARD_MAX_PHOTOS} 張。` : `最多 ${WIZARD_MAX_PHOTOS} 張。`}照片越多、角度越完整，生成的人就越像你。</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100" aria-label="關閉">×</button>
        </div>

        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => onFiles(e.target.files)} data-testid="input-wizard-file" />
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mt-4" data-testid="wizard-photos">
          {photos.map((url, i) => (
            <div key={url} className={`relative rounded-xl overflow-hidden border-2 ${i === 0 ? "border-indigo-500" : "border-slate-200"}`} style={{ aspectRatio: "3 / 4" }} data-testid={`wizard-photo-${i}`}>
              <img src={url} alt={i === 0 ? "臉部正面照" : `照片 ${i + 1}`} className="w-full h-full object-cover" />
              {lowRes.includes(url) && <span className="absolute top-0 left-0 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-br-lg">解析度低</span>}
              <button onClick={() => remove(i)} className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white text-sm rounded-bl-lg flex items-center justify-center" aria-label={`移除照片 ${i + 1}`}>×</button>
              {i === 0
                ? <span className="absolute bottom-0 inset-x-0 bg-indigo-600/90 text-white text-[10px] text-center py-0.5">第一張・臉部正面</span>
                : <button onClick={() => makeFirst(i)} className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] py-0.5 hover:bg-black/75">設為第一張</button>}
            </div>
          ))}
          {Array.from({ length: uploading }, (_, i) => (
            <div key={`u-${i}`} className="rounded-xl border-2 border-dashed border-indigo-300 flex items-center justify-center text-indigo-400" style={{ aspectRatio: "3 / 4" }}>
              <i className="fas fa-spinner fa-spin" />
            </div>
          ))}
          {room - uploading > 0 && (
            <button onClick={() => inputRef.current?.click()} disabled={uploading > 0}
              className="rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 text-slate-400 hover:text-indigo-500 flex flex-col items-center justify-center gap-1 disabled:opacity-60"
              style={{ aspectRatio: "3 / 4" }} data-testid="button-wizard-add">
              <i className="fas fa-plus text-lg" />
              <span className="text-[11px] font-medium">{photos.length === 0 ? "選擇照片" : "再加照片"}</span>
            </button>
          )}
        </div>
        <p className="text-xs font-semibold text-slate-700 mt-3" data-testid="wizard-count">
          已選 {photos.length}／{WIZARD_MAX_PHOTOS} 張
          <span className="font-normal text-slate-500">
            {missing > 0 && freeFourView ? `　還差 ${missing} 張（第一次至少 ${FIRST_CHARACTER_MIN_PHOTOS} 張）。` : photos.length === 0 ? "　可以一次選很多張。" : photos.length < 4 ? "　建議至少 4 張，會明顯更像。" : photos.length < WIZARD_MAX_PHOTOS ? "　還可以再加。" : "　已經放滿了。"}
          </span>
        </p>
        <ul className="mt-2 space-y-1">
          {TIPS.map(t => <li key={t} className="text-[11px] text-slate-500"><i className="fas fa-check text-emerald-500 mr-1.5" />{t}</li>)}
        </ul>

        <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900" data-testid="wizard-quality-note">
          <i className="fas fa-triangle-exclamation mr-1.5" />角色能不能完整做出來，要看照片品質。模糊、太暗、臉被遮住、開了濾鏡，或全部都是同一個角度的照片，做出來可能不像、也可能缺少側面或全身。
          {lowResCount > 0 && <span className="block mt-1 font-semibold" data-testid="wizard-lowres-note">有 {lowResCount} 張照片解析度偏低，建議換成更清楚的。</span>}
        </div>

        <label className="block mt-4">
          <span className="text-xs text-slate-600">角色名稱</span>
          <input value={name} onChange={e => setName(e.target.value.slice(0, 60))} placeholder="例如：小雨"
            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" data-testid="input-wizard-name" />
        </label>

        <label className="flex items-start gap-2 mt-4 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 accent-indigo-600" data-testid="checkbox-wizard-consent" />
          <span>我確認這些照片是我本人，或已取得照片中當事人的明確同意，並且當事人已成年。</span>
        </label>

        <button onClick={() => createMutation.mutate()} disabled={!ready || createMutation.isPending || uploading > 0}
          className="mt-4 w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40" data-testid="button-wizard-create">
          {createMutation.isPending ? "建立中…" : freeFourView ? "下一步：生成角色四視圖（首次免費）" : paidFourView ? `下一步：生成角色四視圖（${FOUR_VIEW_COST} 積分）` : "下一步：建立角色"}
        </button>
        {shortOfCredits && (
          <p className="text-xs text-red-600 mt-2 text-center" data-testid="wizard-short-credits">
            建立角色需要 {FOUR_VIEW_COST} 積分，目前剩 {user?.credits ?? 0}。<Link href="/store"><span className="underline cursor-pointer font-semibold">前往會員商城</span></Link>
          </p>
        )}
        <p className="text-[11px] text-slate-400 mt-2 text-center">
          {missing > 0 ? (freeFourView ? `第一次建立角色至少需要 ${FIRST_CHARACTER_MIN_PHOTOS} 張照片，還差 ${missing} 張。` : "至少需要一張臉部正面照。") : "照片只有你自己看得到。"}
        </p>
      </div>
    </div>
  );
}

import { getLang, tr } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { useEmbed } from "@/components/EmbedBar";
import { Link } from "wouter";
import { FOUR_VIEW_COST } from "@shared/pricing";
import type { PhotoAngle, PhotoTags } from "@shared/fourViews";
import { FrontConfirm } from "@/components/FrontConfirm";

// 上傳照片建立角色：最多 WIZARD_MAX_PHOTOS 張（圖片模型一次最多吃 10 張參考圖）。
// 第一張一定要是臉部正面照，生成時最優先參考它；其餘建議側臉、半身、全身、不同表情。
// 帳號的第一個角色至少要 FIRST_CHARACTER_MIN_PHOTOS 張（第一次建模要夠完整，免費四視圖才做得像）；之後的角色 1 張就能建。
// 能不能完整做出來取決於照片品質：畫面上會提醒，短邊小於 LOW_RES_SIDE 像素的照片會標「解析度低」。
// 照片依上傳順序成為角色圖庫，可以點「設為第一張」調整。照片越多、角度越完整，生成越像本人。
// 建立前必須確認照片是本人或已取得同意 —— 這個功能不能拿來做別人的角色。
// 照片全部上傳後，按「AI 判讀全部照片」才逐張判讀（/api/character-library/photo-tags，同時 3 張）；
// 全部判讀完才能按建立，之後再加的照片要再按一次。判讀結果：角度、品質與幾個外貌標籤顯示在照片下方，
// 另外每張寫一段完整的外貌描述（可展開看）；建立時全部送給伺服器，綜合成角色描述，生成時跟照片一起交給圖片模型。
// 不適合的照片會標出原因。使用者沒有自己指定第一張時，會自動把最清楚的臉部正面照排到第一張。
// 判讀失敗不影響建立，只是那張照片沒有標籤。
// 按「下一步」就建立角色並先生成正面圖，同一個視窗接著問「像不像」（components/FrontConfirm.tsx）：
// 像了才做其餘三張，不像可以換主照片重新生成。帳號的第一次免費；
// 第二個角色開始每次建立收 FOUR_VIEW_COST 積分（按鈕上寫明），積分不夠就不能建立，帶去會員商城。
// 嵌入模式（客戶小鎮工作區）維持原樣：只建立角色，四視圖在角色卡片上另外按。

export const WIZARD_MAX_PHOTOS = 10;
export const FIRST_CHARACTER_MIN_PHOTOS = 6;
const LOW_RES_SIDE = 640;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const TIPS = [
  tr("第一張放臉部正面：光線充足、五官清楚，不要戴墨鏡或口罩"),
  tr("再放側臉、半身、全身、不同表情，角度越多越像"),
  tr("不要開美顏或濾鏡，髮型跟平常一樣"),
];

const ANGLE_LABEL: Record<PhotoAngle, string> = {
  front_face: tr("正面臉"), three_quarter: tr("半側臉"), side: tr("側臉"), full_body: tr("全身"), back: tr("背面"), other: tr("其他"),
};

/** How good a photo is as the first (main) photo: a clear front face wins. */
function mainPhotoScore(t: PhotoTags | undefined): number {
  if (!t || t.angle !== "front_face") return 0;
  return t.quality === "good" ? 3 : t.quality === "fair" ? 2 : 0;
}

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
  if (!putRes.ok) throw new Error(tr("上傳失敗"));
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
  // AI reading of each photo, by its path. `null` while it is being read; missing when it failed.
  const [tags, setTags] = useState<Record<string, PhotoTags | null>>({});
  // Photos whose reading failed; they can be read again and do not block creating.
  const [readFailed, setReadFailed] = useState<string[]>([]);
  // Once the person picks or removes the first photo themselves, the order is theirs.
  const manualFirst = useRef(false);
  // Set after the character is created with its front view started: the window moves on to the likeness check.
  const [createdId, setCreatedId] = useState<string | null>(null);
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
  // Photos are read only when the person presses "AI 判讀全部照片", after uploading all of them.
  // Creating waits until every photo has been read, so every photo's description goes into the
  // character. A photo whose reading failed does not block: it is simply left out.
  const reading = photos.filter(url => tags[url] === null).length;
  const unread = photos.filter(url => tags[url] === undefined && !readFailed.includes(url)).length;
  const failedCount = photos.filter(url => readFailed.includes(url)).length;
  const ready = missing === 0 && name.trim().length > 0 && consent && !shortOfCredits && reading === 0 && unread === 0;

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0) return;
    const usable = files.filter(f => f.type.startsWith("image/") && f.size <= MAX_UPLOAD_BYTES).slice(0, room);
    if (usable.length < files.length) {
      toast({
        title: files.length > room && usable.length === room ? tr("最多 {0} 張，多的沒有加入", { 0: WIZARD_MAX_PHOTOS }) : tr("有些檔案沒有加入"),
        description: tr("請上傳 20MB 以內的 JPG、PNG 或 WEBP。"),
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
    if (failed > 0) toast({ title: tr("{0} 張上傳失敗", { 0: failed }), description: tr("請再試一次。"), variant: "destructive" });
  };

  const readPhoto = (path: string): Promise<void> => {
    setTags(prev => ({ ...prev, [path]: null }));
    setReadFailed(prev => prev.filter(u => u !== path));
    return apiRequest("POST", "/api/character-library/photo-tags", { url: path, lang: getLang() })
      .then(r => r.json())
      .then((t: PhotoTags) => setTags(prev => ({ ...prev, [path]: t })))
      .catch(() => {
        setTags(prev => { const next = { ...prev }; delete next[path]; return next; });
        setReadFailed(prev => [...prev, path]);
      });
  };

  /** Reads every photo that has not been read yet, three at a time. */
  const readAll = async () => {
    const queue = photos.filter(url => tags[url] === undefined || readFailed.includes(url));
    const worker = async () => { for (let url = queue.shift(); url; url = queue.shift()) await readPhoto(url); };
    await Promise.all([worker(), worker(), worker()]);
  };

  // Put the clearest front-face photo first, as long as the person has not chosen the order themselves
  // and the current first photo has been read and is worse.
  useEffect(() => {
    if (manualFirst.current) return;
    setPhotos(prev => {
      if (prev.length < 2 || !tags[prev[0]]) return prev;
      let best = prev[0];
      for (const url of prev) if (mainPhotoScore(tags[url] ?? undefined) > mainPhotoScore(tags[best] ?? undefined)) best = url;
      return best === prev[0] ? prev : [best, ...prev.filter(u => u !== best)];
    });
  }, [tags]);

  const remove = (i: number) => { if (i === 0) manualFirst.current = true; setPhotos(prev => prev.filter((_, idx) => idx !== i)); };
  const makeFirst = (i: number) => { manualFirst.current = true; setPhotos(prev => [prev[i], ...prev.filter((_, idx) => idx !== i)]); };

  const poorPhotos = photos.map((url, i) => ({ n: i + 1, t: tags[url] })).filter(x => x.t && x.t.quality === "poor");
  const allRead = photos.length > 0 && photos.every(url => tags[url] !== null);
  const noFrontFace = allRead && photos.some(url => tags[url]) && !photos.some(url => mainPhotoScore(tags[url] ?? undefined) > 0);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/character-library", {
        name: name.trim(), refImageUrls: photos, styleHint: "realistic",
        // What the AI read from each photo; the server writes the character's description from all of them.
        photoPrompts: photos.map(url => tags[url]?.prompt ?? "").filter(Boolean),
      });
      const created = await res.json() as { id: string };
      // Start the 四視圖 right away (free the first time, FOUR_VIEW_COST after). If it cannot start, the character is still saved.
      let started = false;
      if (freeFourView || paidFourView) {
        try { await apiRequest("POST", `/api/character-library/${created.id}/generate-four-views`, { frontFirst: true }); started = true; }
        catch { /* the button on the character card can start it later */ }
      }
      return { ...created, started };
    },
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      if (c.started) {
        // Stay open: the front view comes first and the person confirms the likeness.
        toast({ title: tr("角色已建立，正在生成正面圖"), description: freeFourView ? tr("這次免費") : tr("已扣 {0} 積分", { 0: FOUR_VIEW_COST }) });
        setCreatedId(c.id);
        return;
      }
      toast({ title: tr("角色已建立"), description: tr("已經放進角色庫。在角色卡片上按「生成四視圖」，之後出圖會更像本人。") });
      onCreated?.(c.id);
      onClose();
    },
    onError: () => toast({ title: tr("建立失敗"), description: tr("請稍後再試。"), variant: "destructive" }),
  });

  if (createdId) {
    const finish = () => { onCreated?.(createdId); onClose(); };
    return (
      <div className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center md:p-4" onClick={finish}>
        <div className="bg-white w-full md:max-w-xl max-h-[92vh] overflow-auto rounded-t-3xl md:rounded-2xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid="character-wizard">
          <FrontConfirm characterId={createdId} onDone={finish} onLater={finish} />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center md:p-4" onClick={onClose}>
      <div className="bg-white w-full md:max-w-xl max-h-[92vh] overflow-auto rounded-t-3xl md:rounded-2xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid="character-wizard">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{tr("上傳照片建立角色")}</h3>
            <p className="text-sm text-slate-500 mt-1">{freeFourView ? tr("第一次建立角色請準備至少 {0} 張，最多 {1} 張。", { 0: FIRST_CHARACTER_MIN_PHOTOS, 1: WIZARD_MAX_PHOTOS }) : tr("最多 {0} 張。", { 0: WIZARD_MAX_PHOTOS })}{tr("照片越多、角度越完整，生成的人就越像你。")}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100" aria-label={tr("關閉")}>×</button>
        </div>

        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => onFiles(e.target.files)} data-testid="input-wizard-file" />
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mt-4" data-testid="wizard-photos">
          {photos.map((url, i) => (
            <div key={url} data-testid={`wizard-photo-${i}`}>
            <div className={`relative rounded-xl overflow-hidden border-2 ${i === 0 ? "border-indigo-500" : "border-slate-200"}`} style={{ aspectRatio: "3 / 4" }}>
              <img src={url} alt={i === 0 ? tr("臉部正面照") : tr("照片 {0}", { 0: i + 1 })} className="w-full h-full object-cover" />
              {lowRes.includes(url)
                ? <span className="absolute top-0 left-0 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-br-lg">{tr("解析度低")}</span>
                : tags[url]?.quality === "poor" && <span className="absolute top-0 left-0 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-br-lg" title={tags[url]?.issue}>{tr("不建議")}</span>}
              <button onClick={() => remove(i)} className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white text-sm rounded-bl-lg flex items-center justify-center" aria-label={tr("移除照片 {0}", { 0: i + 1 })}>×</button>
              {i === 0
                ? <span className="absolute bottom-0 inset-x-0 bg-indigo-600/90 text-white text-[10px] text-center py-0.5">{tr("第一張・臉部正面")}</span>
                : <button onClick={() => makeFirst(i)} className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] py-0.5 hover:bg-black/75">{tr("設為第一張")}</button>}
            </div>
              {tags[url] === null
                ? <p className="text-[10px] text-slate-400 mt-1 leading-tight">{tr("AI 判讀中…")}</p>
                : tags[url] && <p className="text-[10px] text-slate-500 mt-1 leading-tight line-clamp-2" data-testid={`wizard-tags-${i}`}>
                    <span className="font-semibold text-indigo-600">{ANGLE_LABEL[tags[url]!.angle]}</span>{tags[url]!.tags.length > 0 && `・${tags[url]!.tags.join("・")}`}
                  </p>}
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
              <span className="text-[11px] font-medium">{photos.length === 0 ? tr("選擇照片") : tr("再加照片")}</span>
            </button>
          )}
        </div>
        {photos.some(url => tags[url]?.prompt) && (
          <details className="mt-3 rounded-xl border border-slate-200 px-3 py-2" data-testid="wizard-photo-prompts">
            <summary className="text-xs font-semibold text-slate-700 cursor-pointer">{tr("AI 讀到的外貌描述（建立角色時會一起用上）")}</summary>
            <ol className="mt-2 space-y-1.5">
              {photos.map((url, i) => tags[url]?.prompt ? (
                <li key={url} className="text-[11px] leading-relaxed text-slate-600"><span className="font-semibold text-slate-800">{tr("第 {0} 張", { 0: i + 1 })}</span>　{tags[url]!.prompt}</li>
              ) : null)}
            </ol>
          </details>
        )}
        <p className="text-xs font-semibold text-slate-700 mt-3" data-testid="wizard-count">
          {tr("已選 {0}／{1} 張", { 0: photos.length, 1: WIZARD_MAX_PHOTOS })}
          <span className="font-normal text-slate-500">
            {missing > 0 && freeFourView ? tr("　還差 {0} 張（第一次至少 {1} 張）。", { 0: missing, 1: FIRST_CHARACTER_MIN_PHOTOS }) : photos.length === 0 ? tr("　可以一次選很多張。") : photos.length < 4 ? tr("　建議至少 4 張，會明顯更像。") : photos.length < WIZARD_MAX_PHOTOS ? tr("　還可以再加。") : tr("　已經放滿了。")}
          </span>
        </p>
        <ul className="mt-2 space-y-1">
          {TIPS.map(tip => <li key={tip} className="text-[11px] text-slate-500"><i className="fas fa-check text-emerald-500 mr-1.5" />{tip}</li>)}
        </ul>

        {photos.length > 0 && (
          <div className="mt-3" data-testid="wizard-read-all">
            <button onClick={() => void readAll()} disabled={reading > 0 || uploading > 0 || (unread === 0 && failedCount === 0)}
              className="w-full h-10 rounded-xl border-2 border-indigo-500 text-indigo-600 text-sm font-semibold hover:bg-indigo-50 disabled:opacity-50 disabled:hover:bg-transparent"
              data-testid="button-wizard-read-all">
              {reading > 0
                ? <><i className="fas fa-spinner fa-spin mr-1.5" />{tr("AI 判讀中（還有 {0} 張）…", { 0: reading })}</>
                : unread > 0
                  ? <><i className="fas fa-wand-magic-sparkles mr-1.5" />{tr("照片都上傳好了：AI 判讀全部照片（{0} 張）", { 0: unread + failedCount })}</>
                  : failedCount > 0
                    ? tr("有 {0} 張判讀失敗，再判讀一次", { 0: failedCount })
                    : <><i className="fas fa-check mr-1.5" />{tr("全部照片都判讀好了")}</>}
            </button>
            {unread > 0 && reading === 0 && (
              <p className="text-[11px] text-slate-500 mt-1 text-center">{tr("先把要用的照片全部上傳，再按這裡。之後再加照片，要再按一次。")}</p>
            )}
          </div>
        )}

        <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900" data-testid="wizard-quality-note">
          <i className="fas fa-triangle-exclamation mr-1.5" />{tr("角色能不能完整做出來，要看照片品質。模糊、太暗、臉被遮住、開了濾鏡，或全部都是同一個角度的照片，做出來可能不像、也可能缺少側面或全身。")}
          {lowResCount > 0 && <span className="block mt-1 font-semibold" data-testid="wizard-lowres-note">{tr("有 {0} 張照片解析度偏低，建議換成更清楚的。", { 0: lowResCount })}</span>}
          {noFrontFace && <span className="block mt-1 font-semibold" data-testid="wizard-nofront-note">{tr("AI 沒有找到清楚的臉部正面照，請補一張，做出來才會像。")}</span>}
          {poorPhotos.map(x => (
            <span key={x.n} className="block mt-1" data-testid="wizard-poor-note">{tr("第 {0} 張不建議使用：{1}", { 0: x.n, 1: x.t!.issue || tr("品質不佳") })}</span>
          ))}
        </div>

        <label className="block mt-4">
          <span className="text-xs text-slate-600">{tr("角色名稱")}</span>
          <input value={name} onChange={e => setName(e.target.value.slice(0, 60))} placeholder={tr("例如：小雨")}
            className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" data-testid="input-wizard-name" />
        </label>

        <label className="flex items-start gap-2 mt-4 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 accent-indigo-600" data-testid="checkbox-wizard-consent" />
          <span>{tr("我確認這些照片是我本人，或已取得照片中當事人的明確同意，並且當事人已成年。")}</span>
        </label>

        <button onClick={() => createMutation.mutate()} disabled={!ready || createMutation.isPending || uploading > 0}
          className="mt-4 w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40" data-testid="button-wizard-create">
          {createMutation.isPending ? tr("建立中…") : reading > 0 ? tr("AI 正在判讀照片（還有 {0} 張），請稍候…", { 0: reading }) : unread > 0 ? tr("先判讀全部照片，才能建立角色") : freeFourView ? tr("下一步：先生成正面圖確認（首次免費）") : paidFourView ? tr("下一步：先生成正面圖確認（{0} 積分）", { 0: FOUR_VIEW_COST }) : tr("下一步：建立角色")}
        </button>
        {shortOfCredits && (
          <p className="text-xs text-red-600 mt-2 text-center" data-testid="wizard-short-credits">
            {tr("建立角色需要 {0} 積分，目前剩 {1}。", { 0: FOUR_VIEW_COST, 1: user?.credits ?? 0 })}<Link href="/store"><span className="underline cursor-pointer font-semibold">{tr("前往會員商城")}</span></Link>
          </p>
        )}
        <p className="text-[11px] text-slate-400 mt-2 text-center">
          {missing > 0 ? (freeFourView ? tr("第一次建立角色至少需要 {0} 張照片，還差 {1} 張。", { 0: FIRST_CHARACTER_MIN_PHOTOS, 1: missing }) : tr("至少需要一張臉部正面照。")) : tr("照片只有你自己看得到。")}
        </p>
      </div>
    </div>
  );
}

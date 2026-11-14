import { getLang, tr, trServer } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { useEmbed } from "@/components/EmbedBar";
import { Link } from "wouter";
import { FOUR_VIEW_COST } from "@shared/pricing";
import type { PhotoTags } from "@shared/fourViews";
import {
  attrsFor, findOption, optionImage, BODY_NUMBERS, BACKSTORY_FIELDS, MAX_FACE_PHOTOS,
  type CharacterProfile, type FaceBox, type Gender, type ProfileAttr, type BodyNumberKey, type BackstoryKey,
} from "@shared/characterProfile";
import { FrontConfirm } from "@/components/FrontConfirm";

// 角色生成器：分五步建立角色（設定見 shared/characterProfile.ts）。
//   1. 臉：1 到 MAX_FACE_PHOTOS 張臉部照片，第一張是正面。上傳後自動逐張 AI 判讀；主照片不是清楚的正面就不能往下。
//   2. 身材：正面身材照（建議）與背面身材照（選填）。照片裡的臉生成時會自動塗灰，所以臉可以入鏡也可以裁掉。
//   3. 外貌與身材：進到這步時 AI 先從照片判讀（/api/character-library/analyze-profile），使用者點標籤用範例圖修改；
//      也可以填身高、體重與三圍。
//   4. 背景故事（選填）：不影響長相，給寫真企劃等文字規劃參考。
//   5. 命名、確認同意，建立。之後先做臉卡與正面全身，確認像了才做其餘三張（components/FrontConfirm.tsx）。
// 帳號第一次建立免費，之後每次 FOUR_VIEW_COST 積分；嵌入模式只建立角色，四視圖在角色卡片上另外按。

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const LOW_RES_SIDE = 640;
const STEPS = ["臉部照片", "身材照片", "外貌與身材", "背景故事", "建立"] as const;

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

/** One option picker: example pictures in a grid. */
function AttrPicker({ attr, value, onPick, onClose }: { attr: ProfileAttr; value?: string; onPick: (v: string | undefined) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end md:items-center justify-center md:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={tr(attr.label)}>
      <div className="bg-white w-full md:max-w-lg max-h-[85vh] overflow-auto rounded-t-3xl md:rounded-2xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid={`picker-${attr.key}`}>
        <div className="flex items-center justify-between">
          <h4 className="text-base font-bold text-slate-900">{tr(attr.label)}</h4>
          <button onClick={onClose} className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100" aria-label={tr("關閉")}>×</button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {attr.options.map(op => {
            const on = op.value === value;
            return (
              <button key={op.value} onClick={() => { onPick(op.value); onClose(); }} aria-pressed={on}
                className={`relative rounded-xl overflow-hidden border-2 text-left ${on ? "border-indigo-500" : "border-transparent hover:border-indigo-200"}`}
                style={{ aspectRatio: "3 / 4" }} data-testid={`option-${attr.key}-${op.value}`}>
                <img src={optionImage(attr.key, op.value)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover bg-slate-100"
                  onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
                <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent text-white text-xs font-semibold px-2 pt-4 pb-1.5">{tr(op.label)}</span>
                {on && <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] flex items-center justify-center"><i className="fas fa-check" /></span>}
              </button>
            );
          })}
        </div>
        <button onClick={() => { onPick(undefined); onClose(); }} className="mt-3 w-full h-10 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">{tr("不指定，交給照片判斷")}</button>
      </div>
    </div>
  );
}

/** A row of setting chips; tapping one opens its picker. */
function AttrChips({ attrs, values, detected, onOpen }: { attrs: ProfileAttr[]; values: Record<string, string>; detected: Record<string, string>; onOpen: (a: ProfileAttr) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {attrs.map(a => {
        const v = values[a.key];
        const op = findOption(a.key, v);
        return (
          <button key={a.key} onClick={() => onOpen(a)} className="flex items-center gap-2 rounded-xl border border-slate-200 hover:border-indigo-300 p-1.5 text-left" data-testid={`chip-${a.key}`}>
            <span className="w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-slate-100">
              {op && <img src={optionImage(a.key, op.value)} alt="" loading="lazy" className="w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />}
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] text-slate-400 leading-tight">{tr(a.label)}</span>
              <span className="block text-sm font-semibold text-slate-800 truncate">{op ? tr(op.label) : tr("未指定")}</span>
              {op && detected[a.key] === v && <span className="block text-[10px] text-emerald-600 leading-tight">{tr("AI 判讀")}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CharacterWizard({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: string) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const faceInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLInputElement>(null);
  const bodySlot = useRef<"front" | "back">("front");
  const [step, setStep] = useState(0);

  const [facePhotos, setFacePhotos] = useState<string[]>([]);
  const [bodyPhotos, setBodyPhotos] = useState<{ front?: string; back?: string }>({});
  const [lowRes, setLowRes] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  // AI reading of each photo, by its path. `null` while it is being read; missing when it failed.
  const [tags, setTags] = useState<Record<string, PhotoTags | null>>({});

  const [gender, setGender] = useState<Gender | undefined>();
  const [looks, setLooks] = useState<Record<string, string>>({});
  const [body, setBody] = useState<Record<string, string>>({});
  const [detected, setDetected] = useState<Record<string, string>>({});
  const [numbers, setNumbers] = useState<Partial<Record<BodyNumberKey, number>>>({});
  const [backstory, setBackstory] = useState<Partial<Record<BackstoryKey, string>>>({});
  const [faceBoxes, setFaceBoxes] = useState<Record<string, FaceBox>>({});
  // The photos the last analysis was made from; analysing again only when they change.
  const [analyzedFor, setAnalyzedFor] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [picker, setPicker] = useState<ProfileAttr | null>(null);

  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const { user } = useUser();
  const embed = !!useEmbed();
  const freeFourView = !!user && !user.freeFourViewUsedAt && !embed;
  const paidFourView = !!user && !freeFourView && !embed;
  const shortOfCredits = paidFourView && !user?.isAdmin && (user?.credits ?? 0) < FOUR_VIEW_COST;

  const readPhoto = (path: string) => {
    setTags(prev => ({ ...prev, [path]: null }));
    return apiRequest("POST", "/api/character-library/photo-tags", { url: path, lang: getLang() })
      .then(r => r.json())
      .then((t: PhotoTags) => setTags(prev => ({ ...prev, [path]: t })))
      .catch(() => setTags(prev => { const next = { ...prev }; delete next[path]; return next; }));
  };

  const upload = async (files: File[]): Promise<string[]> => {
    const usable = files.filter(f => f.type.startsWith("image/") && f.size <= MAX_UPLOAD_BYTES);
    if (usable.length < files.length) toast({ title: tr("有些檔案沒有加入"), description: tr("請上傳 20MB 以內的 JPG、PNG 或 WEBP。") });
    setUploading(n => n + usable.length);
    const paths: string[] = [];
    for (const file of usable) {
      try {
        const [path, side] = await Promise.all([uploadToObjectStorage(file), shortSide(file)]);
        if (side > 0 && side < LOW_RES_SIDE) setLowRes(prev => [...prev, path]);
        paths.push(path);
        void readPhoto(path);
      } catch {
        toast({ title: tr("上傳失敗"), description: tr("請再試一次。"), variant: "destructive" });
      } finally {
        setUploading(n => Math.max(0, n - 1));
      }
    }
    return paths;
  };

  const onFaceFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []).slice(0, MAX_FACE_PHOTOS - facePhotos.length);
    if (faceInput.current) faceInput.current.value = "";
    const paths = await upload(files);
    setFacePhotos(prev => [...prev, ...paths].slice(0, MAX_FACE_PHOTOS));
  };
  const onBodyFile = async (list: FileList | null) => {
    const file = list?.[0];
    if (bodyInput.current) bodyInput.current.value = "";
    if (!file) return;
    const slot = bodySlot.current;
    const [path] = await upload([file]);
    if (path) setBodyPhotos(prev => ({ ...prev, [slot]: path }));
  };

  // The main photo must be a clear front face. A photo whose reading failed does not block.
  const main = facePhotos[0];
  const mainTags = main ? tags[main] : undefined;
  const reading = [...facePhotos, bodyPhotos.front, bodyPhotos.back].filter(u => u && tags[u] === null).length;
  const mainProblem = !main ? tr("請上傳至少一張臉部正面照。")
    : mainTags === null ? ""
    : mainTags && mainTags.angle !== "front_face" ? tr("第一張要是臉部正面照（直視鏡頭、五官完整）。請換一張，或把正面照設為第一張。")
    : mainTags && mainTags.quality === "poor" ? tr("第一張不能用：{0}", { 0: mainTags.issue || tr("品質不佳") })
    : "";

  const photosKey = JSON.stringify([facePhotos.slice(0, 3), bodyPhotos.front ?? "", bodyPhotos.back ?? ""]);
  const analyze = async () => {
    setAnalyzing(true);
    try {
      const r = await apiRequest("POST", "/api/character-library/analyze-profile", { facePhotos, bodyPhotos });
      const d = await r.json() as { gender: Gender | null; looks: Record<string, string>; body: Record<string, string>; faceBoxes: Record<string, FaceBox> };
      // AI values fill in only what the person has not chosen themselves.
      setDetected({ ...d.looks, ...d.body });
      setLooks(prev => ({ ...d.looks, ...prev }));
      setBody(prev => ({ ...d.body, ...prev }));
      if (d.gender) setGender(prev => prev ?? d.gender!);
      setFaceBoxes(d.faceBoxes ?? {});
      setAnalyzedFor(photosKey);
    } catch (e: any) {
      toast({ title: tr("AI 判讀失敗"), description: tr("可以自己選，或稍後再試一次。"), variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };
  useEffect(() => {
    if (step === 2 && analyzedFor !== photosKey && !analyzing && facePhotos.length > 0) void analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const profile = (): CharacterProfile => ({
    version: 1, gender, facePhotos, bodyPhotos, faceBoxes, looks, body, numbers, backstory,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/character-library", {
        name: name.trim(), styleHint: "realistic",
        photoPrompts: facePhotos.map(url => tags[url]?.prompt ?? "").filter(Boolean),
        profile: profile(),
      });
      const created = await res.json() as { id: string };
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
        toast({ title: tr("角色已建立，正在做臉卡與正面圖"), description: freeFourView ? tr("這次免費") : tr("已扣 {0} 積分", { 0: FOUR_VIEW_COST }) });
        setCreatedId(c.id);
        return;
      }
      toast({ title: tr("角色已建立"), description: tr("已經放進角色庫。在角色卡片上按「生成四視圖」，之後出圖會更像本人。") });
      onCreated?.(c.id);
      onClose();
    },
    onError: (e: any) => toast({ title: tr("建立失敗"), description: trServer(e?.message) || tr("請稍後再試。"), variant: "destructive" }),
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

  const canNext = step === 0 ? !mainProblem && uploading === 0 && reading === 0
    : step === 1 ? uploading === 0
    : step === 2 ? !analyzing
    : true;
  const ready = !mainProblem && name.trim().length > 0 && consent && !shortOfCredits && uploading === 0;

  const photoTile = (url: string, label: string, onRemove: () => void, extra?: React.ReactNode) => (
    <div key={url}>
      <div className="relative rounded-xl overflow-hidden border-2 border-slate-200" style={{ aspectRatio: "3 / 4" }}>
        <img src={url} alt={label} className="w-full h-full object-cover" />
        {lowRes.includes(url)
          ? <span className="absolute top-0 left-0 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-br-lg">{tr("解析度低")}</span>
          : tags[url]?.quality === "poor" && <span className="absolute top-0 left-0 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-br-lg">{tr("不建議")}</span>}
        <button onClick={onRemove} className="absolute top-0 right-0 w-6 h-6 bg-red-500 text-white text-sm rounded-bl-lg flex items-center justify-center" aria-label={tr("移除 {0}", { 0: label })}>×</button>
        {extra}
      </div>
      {tags[url] === null
        ? <p className="text-[10px] text-slate-400 mt-1">{tr("AI 檢查中…")}</p>
        : tags[url]?.quality === "poor" ? <p className="text-[10px] text-red-600 mt-1 leading-tight">{tags[url]!.issue || tr("品質不佳")}</p>
        : tags[url] ? <p className="text-[10px] text-emerald-600 mt-1">{tr("可以使用")}</p> : null}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center md:p-4" onClick={onClose}>
      <div className="bg-white w-full md:max-w-2xl max-h-[92vh] overflow-auto rounded-t-3xl md:rounded-2xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()} data-testid="character-wizard">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{tr("角色生成器")}</h3>
            <p className="text-sm text-slate-500 mt-0.5">{tr("先定臉，再合身材。設定越完整，做出來越像。")}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100" aria-label={tr("關閉")}>×</button>
        </div>

        <ol className="flex gap-1 mt-4" aria-label={tr("步驟")}>
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <button onClick={() => i < step && setStep(i)} disabled={i >= step} aria-current={i === step ? "step" : undefined}
                className={`w-full text-left rounded-lg px-2 py-1.5 text-[11px] leading-tight ${i === step ? "bg-indigo-600 text-white font-semibold" : i < step ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100" : "bg-slate-100 text-slate-400"}`}>
                <span className="block opacity-70">{i + 1}</span>{tr(s)}
              </button>
            </li>
          ))}
        </ol>

        <input ref={faceInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={e => onFaceFiles(e.target.files)} data-testid="input-wizard-face" />
        <input ref={bodyInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => onBodyFile(e.target.files)} data-testid="input-wizard-body" />

        {step === 0 && (
          <section className="mt-4" data-testid="step-face">
            <h4 className="font-semibold text-slate-900">{tr("臉部照片")}</h4>
            <p className="text-xs text-slate-500 mt-1">{tr("第一張最重要：AI 會用它做出角色的標準正臉（臉卡），之後每張圖都以臉卡為準。最多 {0} 張，其餘可以放不同角度或表情。", { 0: MAX_FACE_PHOTOS })}</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-3">
              {facePhotos.map((url, i) => photoTile(url, i === 0 ? tr("主照片") : tr("照片 {0}", { 0: i + 1 }),
                () => setFacePhotos(prev => prev.filter(u => u !== url)),
                i === 0
                  ? <span className="absolute bottom-0 inset-x-0 bg-indigo-600/90 text-white text-[10px] text-center py-0.5">{tr("主照片・正面")}</span>
                  : <button onClick={() => setFacePhotos(prev => [url, ...prev.filter(u => u !== url)])} className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] py-0.5 hover:bg-black/75">{tr("設為主照片")}</button>))}
              {Array.from({ length: uploading }, (_, i) => (
                <div key={`u-${i}`} className="rounded-xl border-2 border-dashed border-indigo-300 flex items-center justify-center text-indigo-400" style={{ aspectRatio: "3 / 4" }}><i className="fas fa-spinner fa-spin" /></div>
              ))}
              {facePhotos.length + uploading < MAX_FACE_PHOTOS && (
                <button onClick={() => faceInput.current?.click()} className="rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 text-slate-400 hover:text-indigo-500 flex flex-col items-center justify-center gap-1" style={{ aspectRatio: "3 / 4" }} data-testid="button-add-face">
                  <i className="fas fa-plus text-lg" /><span className="text-[11px] font-medium">{facePhotos.length === 0 ? tr("上傳正面照") : tr("再加一張")}</span>
                </button>
              )}
            </div>
            <div className="mt-3 grid sm:grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-emerald-900">
                <p className="font-semibold mb-1"><i className="fas fa-check mr-1" />{tr("好的主照片")}</p>
                <p>{tr("清楚、高解析度；直視鏡頭；光線均勻沒有強烈陰影；背景單純；表情自然。")}</p>
              </div>
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-900">
                <p className="font-semibold mb-1"><i className="fas fa-xmark mr-1" />{tr("不要這樣")}</p>
                <p>{tr("模糊或太暗；墨鏡、帽子、口罩；美顏濾鏡；臉被遮住或角度太斜；畫面裡有別人。照片裡的眼鏡與飾品會出現在每一張圖。")}</p>
              </div>
            </div>
            {mainProblem && facePhotos.length > 0 && <p className="mt-2 text-xs font-semibold text-red-600" data-testid="face-problem">{mainProblem}</p>}
          </section>
        )}

        {step === 1 && (
          <section className="mt-4" data-testid="step-body">
            <h4 className="font-semibold text-slate-900">{tr("身材照片")}</h4>
            <p className="text-xs text-slate-500 mt-1">{tr("決定角色的身形比例。照片裡的臉會在生成時自動遮掉，只參考身材，所以臉入鏡或裁掉都可以。沒有身材照也能建立，身材就照下一步的設定。")}</p>
            <div className="grid grid-cols-2 gap-3 mt-3 max-w-sm">
              {(["front", "back"] as const).map(slot => {
                const url = bodyPhotos[slot];
                const label = slot === "front" ? tr("正面（建議）") : tr("背面（選填）");
                return (
                  <div key={slot}>
                    <p className="text-xs font-semibold text-slate-700 mb-1">{label}</p>
                    {url ? photoTile(url, label, () => setBodyPhotos(prev => { const next = { ...prev }; delete next[slot]; return next; }))
                      : <button onClick={() => { bodySlot.current = slot; bodyInput.current?.click(); }} disabled={uploading > 0}
                          className="w-full rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 text-slate-400 hover:text-indigo-500 flex flex-col items-center justify-center gap-1 disabled:opacity-50" style={{ aspectRatio: "3 / 4" }} data-testid={`button-add-body-${slot}`}>
                          <i className={`fas ${uploading > 0 ? "fa-spinner fa-spin" : "fa-person"} text-xl`} /><span className="text-[11px] font-medium">{tr("上傳")}</span>
                        </button>}
                  </div>
                );
              })}
            </div>
            <ul className="mt-3 space-y-1 text-[12px] text-slate-600">
              <li><i className="fas fa-check text-emerald-500 mr-1.5" />{tr("從頭到腳完整入鏡，自然站立")}</li>
              <li><i className="fas fa-check text-emerald-500 mr-1.5" />{tr("穿合身的衣服（例如運動服），寬鬆衣服會看不出身形")}</li>
              <li><i className="fas fa-check text-emerald-500 mr-1.5" />{tr("光線均勻、清楚不模糊；刺青要完整入鏡")}</li>
            </ul>
          </section>
        )}

        {step === 2 && (
          <section className="mt-4" data-testid="step-traits">
            {analyzing
              ? <p className="rounded-xl bg-indigo-50 text-indigo-700 text-sm px-3 py-2"><i className="fas fa-spinner fa-spin mr-2" />{tr("AI 正在從照片判讀外貌與身材…")}</p>
              : <p className="text-xs text-slate-500">{tr("AI 已從照片判讀（標「AI 判讀」）。點一項就能用範例圖修改；照片看不出來的部分，你的選擇會讓角色更接近你要的樣子。")}</p>}
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-slate-600">{tr("性別")}</span>
              {(["female", "male"] as const).map(g => (
                <button key={g} onClick={() => setGender(g)} aria-pressed={gender === g}
                  className={`h-8 px-3 rounded-full text-sm border ${gender === g ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 text-slate-700"}`}>{g === "female" ? tr("女性") : tr("男性")}</button>
              ))}
            </div>
            <h4 className="font-semibold text-slate-900 mt-4 mb-2">{tr("臉與頭髮")}</h4>
            <AttrChips attrs={attrsFor("looks", gender)} values={looks} detected={detected} onOpen={setPicker} />
            <h4 className="font-semibold text-slate-900 mt-4 mb-1">{tr("身材比例")}</h4>
            {bodyPhotos.front && <p className="text-[11px] text-slate-500 mb-2">{tr("有身材照時以照片為準，這裡的設定用來微調。")}</p>}
            <AttrChips attrs={attrsFor("body", gender)} values={body} detected={detected} onOpen={setPicker} />
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
              {BODY_NUMBERS.filter(n => !(gender === "male" && n.key === "bustCm")).map(n => (
                <label key={n.key} className="block">
                  <span className="text-[11px] text-slate-500">{tr(n.label)}</span>
                  <input type="number" inputMode="numeric" min={n.min} max={n.max} value={numbers[n.key] ?? ""}
                    onChange={e => { const v = e.target.value === "" ? undefined : Number(e.target.value); setNumbers(prev => ({ ...prev, [n.key]: v })); }}
                    className="mt-0.5 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" data-testid={`input-${n.key}`} />
                </label>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{tr("選填。三圍要三個都填才會用上。")}</p>
          </section>
        )}

        {step === 3 && (
          <section className="mt-4" data-testid="step-backstory">
            <h4 className="font-semibold text-slate-900">{tr("背景故事（選填）")}</h4>
            <p className="text-xs text-slate-500 mt-1">{tr("不會改變角色的長相，是給 AI 規劃寫真、劇情與文案時參考的設定。")}</p>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              {BACKSTORY_FIELDS.map(f => (
                <label key={f.key} className={`block ${f.max > 200 ? "sm:col-span-2" : ""}`}>
                  <span className="text-xs text-slate-600">{tr(f.label)}</span>
                  {f.max > 60
                    ? <textarea value={backstory[f.key] ?? ""} onChange={e => setBackstory(prev => ({ ...prev, [f.key]: e.target.value.slice(0, f.max) }))} rows={f.max > 300 ? 3 : 2} placeholder={tr(f.placeholder)}
                        className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                    : <input value={backstory[f.key] ?? ""} onChange={e => setBackstory(prev => ({ ...prev, [f.key]: e.target.value.slice(0, f.max) }))} placeholder={tr(f.placeholder)}
                        className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />}
                </label>
              ))}
            </div>
          </section>
        )}

        {step === 4 && (
          <section className="mt-4" data-testid="step-create">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {[...facePhotos, bodyPhotos.front, bodyPhotos.back].filter((u): u is string => !!u).map(u => (
                <img key={u} src={u} alt="" className="w-14 shrink-0 rounded-lg object-cover border border-slate-200" style={{ aspectRatio: "3 / 4" }} />
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-2">{tr("接下來會先做臉卡（標準正臉）和正面全身圖，請你確認像不像；像了才做其餘三個角度。")}</p>
            <label className="block mt-4">
              <span className="text-xs text-slate-600">{tr("角色名稱")}</span>
              <input value={name} onChange={e => setName(e.target.value.slice(0, 60))} placeholder={tr("例如：小雨")}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" data-testid="input-wizard-name" />
            </label>
            <label className="flex items-start gap-2 mt-4 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 accent-indigo-600" data-testid="checkbox-wizard-consent" />
              <span>{tr("我確認這些照片是我本人，或已取得照片中當事人的明確同意，並且當事人已成年。")}</span>
            </label>
            <button onClick={() => createMutation.mutate()} disabled={!ready || createMutation.isPending}
              className="mt-4 w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40" data-testid="button-wizard-create">
              {createMutation.isPending ? tr("建立中…") : freeFourView ? tr("建立角色並生成（首次免費）") : paidFourView ? tr("建立角色並生成（{0} 積分）", { 0: FOUR_VIEW_COST }) : tr("建立角色")}
            </button>
            {shortOfCredits && (
              <p className="text-xs text-red-600 mt-2 text-center" data-testid="wizard-short-credits">
                {tr("建立角色需要 {0} 積分，目前剩 {1}。", { 0: FOUR_VIEW_COST, 1: user?.credits ?? 0 })}<Link href="/store"><span className="underline cursor-pointer font-semibold">{tr("前往會員商城")}</span></Link>
              </p>
            )}
            <p className="text-[11px] text-slate-400 mt-2 text-center">{tr("照片只有你自己看得到。")}</p>
          </section>
        )}

        {step < 4 && (
          <div className="flex gap-2 mt-5">
            {step > 0 && <button onClick={() => setStep(s => s - 1)} className="h-11 px-5 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold">{tr("上一步")}</button>}
            <button onClick={() => setStep(s => s + 1)} disabled={!canNext}
              className="flex-1 h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40" data-testid="button-wizard-next">
              {reading > 0 || uploading > 0 ? tr("照片檢查中…") : step === 1 && !bodyPhotos.front ? tr("先跳過，下一步") : step === 3 ? tr("下一步：命名與建立") : tr("下一步")}
            </button>
          </div>
        )}

        {picker && (
          <AttrPicker attr={picker} value={(picker.group === "looks" ? looks : body)[picker.key]} onClose={() => setPicker(null)}
            onPick={v => (picker.group === "looks" ? setLooks : setBody)(prev => { const next = { ...prev }; if (v) next[picker.key] = v; else delete next[picker.key]; return next; })} />
        )}
      </div>
    </div>
  );
}

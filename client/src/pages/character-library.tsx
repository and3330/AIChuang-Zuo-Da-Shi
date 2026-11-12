import { tr } from "@/lib/i18n";
import { FOUR_VIEW_COST } from "@shared/pricing";
import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { useEmbed } from "@/components/EmbedBar";
import { NavigationHeader } from "./account";
import { CHARACTER_PACK_MAX_IMAGES, type CharacterLibraryItem, type FourViewUrls } from "@shared/schema";
import { CharacterWizard } from "@/components/CharacterWizard";
import { FrontConfirmDialog } from "@/components/FrontConfirm";
import { awaitingFrontConfirm } from "@shared/fourViews";

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

const STYLE_HINTS = [
  { value: "", label: tr("自動") },
  { value: "anime", label: tr("動漫") },
  { value: "realistic", label: tr("寫實") },
  { value: "3d", label: "3D" },
  { value: "manga", label: tr("漫畫") },
];

function FourViewGrid({ urls, status }: { urls: FourViewUrls | null | undefined; status: string }) {
  const labels: { key: keyof FourViewUrls; label: string }[] = [
    { key: "front", label: tr("正面") },
    { key: "threeQuarter", label: tr("3/4 側") },
    { key: "side", label: tr("正側") },
    { key: "back", label: tr("背面") },
  ];
  // Click a view to see it large; arrows (or ← →) move between the views that exist.
  const ready = labels.filter(l => !!urls?.[l.key]);
  const [zoom, setZoom] = useState<keyof FourViewUrls | null>(null);
  const zoomIndex = ready.findIndex(l => l.key === zoom);
  const step = (d: number) => { if (ready.length > 0) setZoom(ready[(zoomIndex + d + ready.length) % ready.length].key); };
  useEffect(() => {
    if (zoom === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(null);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <>
      <div className="grid grid-cols-4 gap-2">
        {labels.map(({ key, label }) => {
          const url = urls?.[key];
          return (
            <div key={key} className="aspect-[3/4] rounded-lg border border-[#e2e8f0] bg-[#f8fafc] overflow-hidden flex flex-col items-center justify-center">
              {url ? (
                <button type="button" onClick={() => setZoom(key)} className="group relative w-full h-full cursor-zoom-in" aria-label={tr("放大{0}", { 0: label })} data-testid={`button-fourview-zoom-${key}`}>
                  <img src={url} alt={label} className="w-full h-full object-cover" data-testid={`img-fourview-${key}`} />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                    <i className="fas fa-magnifying-glass-plus text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </span>
                </button>
              ) : status === "generating" ? (
                <>
                  <div className="w-6 h-6 rounded-full border-2 border-t-transparent border-[#ca8a04] animate-spin" />
                  <span className="text-[10px] text-[#ca8a04] mt-1">{label}</span>
                </>
              ) : (
                <span className="text-[10px] text-[#94a3b8]">{label}</span>
              )}
            </div>
          );
        })}
      </div>

      {zoom !== null && zoomIndex >= 0 && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-4" onClick={() => setZoom(null)} role="dialog" aria-modal="true" aria-label={tr("四視圖放大")} data-testid="fourview-lightbox">
          <img src={urls![ready[zoomIndex].key]!} alt={ready[zoomIndex].label} className="max-w-full max-h-[86vh] object-contain rounded-xl" onClick={e => e.stopPropagation()} />
          <span className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-sm">{ready[zoomIndex].label}・{zoomIndex + 1}／{ready.length}</span>
          <button onClick={() => setZoom(null)} className="absolute top-3 right-3 w-11 h-11 rounded-full bg-black/60 text-white text-xl hover:bg-black/80" aria-label={tr("關閉")}>×</button>
          {ready.length > 1 && (
            <>
              <button onClick={e => { e.stopPropagation(); step(-1); }} className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 text-white hover:bg-black/80" aria-label={tr("上一張")}><i className="fas fa-chevron-left" /></button>
              <button onClick={e => { e.stopPropagation(); step(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 text-white hover:bg-black/80" aria-label={tr("下一張")}><i className="fas fa-chevron-right" /></button>
            </>
          )}
          <a href={urls![ready[zoomIndex].key]!} download target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 h-10 rounded-full bg-white text-slate-900 text-sm font-medium flex items-center gap-2">
            <i className="fas fa-download text-xs" />{tr("下載")}
          </a>
        </div>
      )}
    </>
  );
}

function CharacterCard({ character }: { character: CharacterLibraryItem }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();
  // Each account's first 四視圖 generation is free (not in a partner workspace).
  const freeFourView = !!user && !user.freeFourViewUsedAt && !useEmbed();
  const fourViewCost = FOUR_VIEW_COST;
  const [showEdit, setShowEdit] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const generateFourViews = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/character-library/${character.id}/generate-four-views`, {}).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: data.free ? tr("四視圖生成中（首次免費）") : tr("四視圖生成中（-{0} 積分）", { 0: data.creditsUsed }) });
    },
    onError: (e: any) => toast({ title: tr("生成失敗"), description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/character-library/${character.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
      toast({ title: tr("角色已刪除") });
    },
  });

  const fourViews = character.fourViewUrls as FourViewUrls | null;
  const fourViewStatus = character.fourViewStatus ?? "idle";
  // The front view is ready and waits for "does it look like you?" before the other three are made.
  const needsConfirm = awaitingFrontConfirm(fourViewStatus);
  const refCount = character.refImageUrls?.length ?? 0;
  const completedCount = fourViews ? Object.values(fourViews).filter(Boolean).length : 0;

  return (
    <div className="bg-white border border-[#e2e8f0] rounded-2xl p-5 space-y-4" data-testid={`card-character-${character.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-[#0f172a] truncate text-lg">{character.name}</h3>
          {character.description && (
            <p className="text-xs text-[#64748b] mt-1 line-clamp-2">{character.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {character.styleHint && (
              <span className="text-[10px] bg-indigo-600/10 text-indigo-600 px-2 py-0.5 rounded-full">
                {STYLE_HINTS.find(s => s.value === character.styleHint)?.label ?? character.styleHint}
              </span>
            )}
            <span className="text-[10px] text-[#94a3b8]">{tr("圖庫 {0} 張", { 0: refCount })}</span>
            {fourViewStatus === "completed" && (
              <span className="text-[10px] bg-[#22c55e]/10 text-[#16a34a] px-2 py-0.5 rounded-full">{tr("✓ 四視圖 {0}/4", { 0: completedCount })}</span>
            )}
            {fourViewStatus === "generating" && (
              <span className="text-[10px] bg-[#ca8a04]/10 text-[#a16207] px-2 py-0.5 rounded-full animate-pulse">{tr("⏳ 生成中")}</span>
            )}
            {fourViewStatus === "failed" && (
              <span className="text-[10px] bg-[#ef4444]/10 text-[#dc2626] px-2 py-0.5 rounded-full">{tr("✗ 失敗")}</span>
            )}
            {needsConfirm && (
              <span className="text-[10px] bg-[#ca8a04]/10 text-[#a16207] px-2 py-0.5 rounded-full">{tr("待確認正面圖")}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button onClick={() => setShowEdit(true)} className="text-[10px] text-[#475569] hover:text-[#0f172a]" data-testid={`button-edit-${character.id}`}>{tr("編輯")}</button>
          <button onClick={() => { if (confirm(tr("確定刪除「{0}」？", { 0: character.name }))) deleteMutation.mutate(); }}
            className="text-[10px] text-[#94a3b8] hover:text-[#ef4444]" data-testid={`button-delete-${character.id}`}>{tr("刪除")}</button>
        </div>
      </div>

      <FourViewGrid urls={fourViews} status={fourViewStatus} />

      {needsConfirm && (
        <button onClick={() => setShowConfirm(true)}
          className="w-full text-sm bg-[#ca8a04] hover:bg-[#a16207] text-white py-2 rounded-lg transition-colors" data-testid={`button-confirm-front-${character.id}`}>
          {tr("確認正面圖像不像，再生成其餘三張")}
        </button>
      )}
      {showConfirm && <FrontConfirmDialog characterId={character.id} onClose={() => setShowConfirm(false)} />}

      <button
        onClick={() => {
          if (refCount === 0) { toast({ title: tr("請先上傳至少 1 張參考圖"), variant: "destructive" }); return; }
          if (!confirm(freeFourView
            ? tr("即將生成 4 張視圖（正面/3-4側/正側/背面）。這是你的首次生成，免費。確定？")
            : tr("即將生成 4 張視圖（正面/3-4側/正側/背面），共消耗 {0} 積分，確定？", { 0: fourViewCost }))) return;
          generateFourViews.mutate();
        }}
        disabled={generateFourViews.isPending || fourViewStatus === "generating"}
        className="w-full text-sm bg-indigo-600 hover:bg-[#4338ca] text-white py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        data-testid={`button-generate-fourviews-${character.id}`}
      >
        {fourViewStatus === "generating" ? tr("⏳ 生成中…") :
         freeFourView ? tr("✨ 生成四視圖（首次免費）") :
         fourViewStatus === "completed" ? tr("🔄 重新生成四視圖 (-{0} 積分)", { 0: fourViewCost }) :
         tr("✨ 生成四視圖 (-{0} 積分)", { 0: fourViewCost })}
      </button>

      <div className="grid grid-cols-1 gap-2">
        <Link href={`/photoset?mode=kit&character=${character.id}`}>
          <span className="block text-center text-sm border border-[#e2e8f0] text-[#475569] hover:border-indigo-500 hover:text-indigo-600 py-2 rounded-lg cursor-pointer" data-testid={`link-photoset-${character.id}`}>
            {tr("📸 拍寫真")}
          </span>
        </Link>
      </div>

      {showEdit && <CharacterFormModal character={character} onClose={() => setShowEdit(false)} />}
    </div>
  );
}

function CharacterFormModal({ character, onClose }: { character?: CharacterLibraryItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(character?.name ?? "");
  const [description, setDescription] = useState(character?.description ?? "");
  const [styleHint, setStyleHint] = useState(character?.styleHint ?? "");
  const [refImageUrls, setRefImageUrls] = useState<string[]>(character?.refImageUrls ?? []);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: (data: any) =>
      character
        ? apiRequest("PATCH", `/api/character-library/${character.id}`, data).then(r => r.json())
        : apiRequest("POST", "/api/character-library", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
      toast({ title: character ? tr("已更新") : tr("角色已建立") });
      onClose();
    },
    onError: (e: any) => toast({ title: tr("儲存失敗"), description: e.message, variant: "destructive" }),
  });

  const handleUpload = async (files: FileList | null) => {
    if (!files) return;
    const remaining = CHARACTER_PACK_MAX_IMAGES - refImageUrls.length;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, remaining)) {
        const path = await uploadToObjectStorage(file);
        setRefImageUrls(prev => [...prev, path]);
      }
    } catch {
      toast({ title: tr("上傳失敗"), variant: "destructive" });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-[#0f172a]">{character ? tr("編輯角色") : tr("新增角色")}</h3>
          <button onClick={onClose} className="text-xl text-[#64748b]">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("名稱")}</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder={tr("例：林婉婷")}
              className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              data-testid="input-character-name" />
          </div>

          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("外觀描述")}</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder={tr("例：25歲女性，黑色長直髮，戴金絲眼鏡，氣質知性")}
              className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-indigo-500"
              data-testid="input-character-description" />
          </div>

          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">{tr("風格")}</label>
            <select value={styleHint} onChange={e => setStyleHint(e.target.value)}
              className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500">
              {STYLE_HINTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">
              {tr("角色圖庫（最多 {0} 張；生成時使用前 9 張，請把最清楚的正面照放前面）", { 0: CHARACTER_PACK_MAX_IMAGES })}
            </label>
            <div className="flex flex-wrap gap-2">
              {refImageUrls.map((url, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#cbd5e1] bg-[#f8fafc] group">
                  <img src={url} alt={`ref-${i}`} className="w-full h-full object-cover" />
                  <button onClick={() => setRefImageUrls(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-[#ef4444] text-white text-xs rounded-full hidden group-hover:flex items-center justify-center">×</button>
                </div>
              ))}
              {refImageUrls.length < CHARACTER_PACK_MAX_IMAGES && (
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="w-16 h-16 rounded-lg border-2 border-dashed border-[#cbd5e1] flex flex-col items-center justify-center text-[#94a3b8] hover:border-indigo-500 hover:text-indigo-500 transition-all"
                  data-testid="button-upload-ref">
                  {uploading ? <span className="text-xs">…</span> : <><span className="text-xl leading-none">+</span><span className="text-[9px]">{tr("上傳")}</span></>}
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => handleUpload(e.target.files)} />
          </div>

          <button
            onClick={() => saveMutation.mutate({ name, description, styleHint, refImageUrls })}
            disabled={!name.trim() || saveMutation.isPending}
            className="w-full bg-indigo-600 hover:bg-[#4338ca] text-white py-2 rounded-lg text-sm transition-colors disabled:opacity-40"
            data-testid="button-save-character"
          >
            {saveMutation.isPending ? tr("儲存中…") : tr("儲存")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CharacterLibraryPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  // Lightweight client-side search across name + description + styleHint.
  // We avoid a tags column for now to skip a schema migration; users can
  // type their own keywords into description and they'll be matched here.
  const [search, setSearch] = useState("");

  const { data: characters = [], isLoading } = useQuery<CharacterLibraryItem[]>({
    queryKey: ["/api/character-library"],
    refetchInterval: data => {
      const list = (data as any)?.state?.data as CharacterLibraryItem[] | undefined;
      return list?.some(c => c.fourViewStatus === "generating") ? 3000 : false;
    },
  });

  const visibleCharacters = (() => {
    const q = search.trim().toLowerCase();
    if (!q) return characters;
    return characters.filter(c =>
      (c.name || "").toLowerCase().includes(q)
      || (c.description || "").toLowerCase().includes(q)
      || (c.styleHint || "").toLowerCase().includes(q)
    );
  })();

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col">
      <NavigationHeader />
      <div className="max-w-6xl mx-auto px-4 md:px-6 py-5 md:py-8 w-full">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
          <div className="min-w-0">
            <h1 className="hidden md:block text-2xl font-bold text-[#0f172a]">{tr("角色庫")}</h1>
            <p className="text-sm text-[#64748b] md:mt-1">{tr("上傳照片建立固定角色並生成四視圖，建好就在這裡，寫真與漫劇都能重複使用。第一個角色免費，之後每個 {0} 積分。", { 0: FOUR_VIEW_COST })}</p>
          </div>
          <div className="flex gap-2 w-full sm:w-auto">
            <button onClick={() => setShowWizard(true)}
              className="flex-1 sm:flex-none h-11 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold whitespace-nowrap"
              data-testid="button-open-wizard">
              <i className="fas fa-camera mr-2 text-xs" />{tr("上傳照片建立角色")}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="h-11 px-4 rounded-xl border border-[#cbd5e1] bg-white text-[#334155] text-sm font-medium whitespace-nowrap hover:border-indigo-500"
              data-testid="button-create-character"
            >
              {tr("＋ 手動新增")}
            </button>
          </div>
        </div>

        {characters.length > 0 && (
          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={tr("🔍 搜尋角色（名稱／描述／風格）")}
              className="w-full md:w-80 px-3 py-2 rounded-lg border border-[#cbd5e1] bg-white text-sm focus:outline-none focus:border-indigo-500"
              data-testid="input-character-search"
            />
            {search && (
              <span className="ml-3 text-xs text-[#64748b]">
                {tr("找到 {0} / {1}", { 0: visibleCharacters.length, 1: characters.length })}
              </span>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 rounded-full border-2 border-t-transparent border-indigo-500 animate-spin" />
          </div>
        ) : characters.length === 0 ? (
          <div className="text-center py-24 bg-white rounded-2xl border border-[#e2e8f0]">
            <div className="text-6xl mb-4">🎭</div>
            <p className="text-lg font-medium text-[#334155] mb-2">{tr("還沒有角色")}</p>
            <p className="text-sm text-[#64748b] mb-6">{tr("建立角色後，可在漫劇場景中重複使用，並一鍵生成四視圖確保不同視角的一致性")}</p>
            <button onClick={() => setShowCreate(true)}
              className="bg-indigo-600 hover:bg-[#4338ca] text-white px-5 py-2.5 rounded-lg text-sm font-medium">
              {tr("＋ 建立第一個角色")}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {visibleCharacters.length === 0 ? (
              <div className="col-span-full text-center text-sm text-[#64748b] py-12 bg-white rounded-2xl border border-dashed border-[#cbd5e1]">
                {tr("沒有符合「{0}」的角色", { 0: search })}
              </div>
            ) : (
              visibleCharacters.map(c => <CharacterCard key={c.id} character={c} />)
            )}
          </div>
        )}

        {showCreate && <CharacterFormModal onClose={() => setShowCreate(false)} />}
        {showWizard && <CharacterWizard onClose={() => setShowWizard(false)} />}
      </div>
    </div>
  );
}

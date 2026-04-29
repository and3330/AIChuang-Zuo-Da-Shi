import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NavigationHeader } from "./account";
import type { CharacterLibraryItem, FourViewUrls } from "@shared/schema";

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

const STYLE_HINTS = [
  { value: "", label: "自動" },
  { value: "anime", label: "動漫" },
  { value: "realistic", label: "寫實" },
  { value: "3d", label: "3D" },
  { value: "manga", label: "漫畫" },
];

function FourViewGrid({ urls, status }: { urls: FourViewUrls | null | undefined; status: string }) {
  const labels: { key: keyof FourViewUrls; label: string }[] = [
    { key: "front", label: "正面" },
    { key: "threeQuarter", label: "3/4 側" },
    { key: "side", label: "正側" },
    { key: "back", label: "背面" },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {labels.map(({ key, label }) => {
        const url = urls?.[key];
        return (
          <div key={key} className="aspect-[3/4] rounded-lg border border-[#e2e8f0] bg-[#f8fafc] overflow-hidden flex flex-col items-center justify-center">
            {url ? (
              <img src={url} alt={label} className="w-full h-full object-cover" data-testid={`img-fourview-${key}`} />
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
  );
}

function CharacterCard({ character }: { character: CharacterLibraryItem }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showEdit, setShowEdit] = useState(false);

  const generateFourViews = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/character-library/${character.id}/generate-four-views`, {}).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
      toast({ title: `四視圖生成中（-${data.creditsUsed} 積分）` });
    },
    onError: (e: any) => toast({ title: "生成失敗", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/character-library/${character.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
      toast({ title: "角色已刪除" });
    },
  });

  const fourViews = character.fourViewUrls as FourViewUrls | null;
  const fourViewStatus = character.fourViewStatus ?? "idle";
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
              <span className="text-[10px] bg-[#6366f1]/10 text-[#4f46e5] px-2 py-0.5 rounded-full">
                {STYLE_HINTS.find(s => s.value === character.styleHint)?.label ?? character.styleHint}
              </span>
            )}
            <span className="text-[10px] text-[#94a3b8]">參考圖 {refCount} 張</span>
            {fourViewStatus === "completed" && (
              <span className="text-[10px] bg-[#22c55e]/10 text-[#16a34a] px-2 py-0.5 rounded-full">✓ 四視圖 {completedCount}/4</span>
            )}
            {fourViewStatus === "generating" && (
              <span className="text-[10px] bg-[#ca8a04]/10 text-[#a16207] px-2 py-0.5 rounded-full animate-pulse">⏳ 生成中</span>
            )}
            {fourViewStatus === "failed" && (
              <span className="text-[10px] bg-[#ef4444]/10 text-[#dc2626] px-2 py-0.5 rounded-full">✗ 失敗</span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button onClick={() => setShowEdit(true)} className="text-[10px] text-[#475569] hover:text-[#0f172a]" data-testid={`button-edit-${character.id}`}>編輯</button>
          <button onClick={() => { if (confirm(`確定刪除「${character.name}」？`)) deleteMutation.mutate(); }}
            className="text-[10px] text-[#94a3b8] hover:text-[#ef4444]" data-testid={`button-delete-${character.id}`}>刪除</button>
        </div>
      </div>

      <FourViewGrid urls={fourViews} status={fourViewStatus} />

      <button
        onClick={() => {
          if (refCount === 0) { toast({ title: "請先上傳至少 1 張參考圖", variant: "destructive" }); return; }
          if (!confirm(`即將生成 4 張視圖（正面/3-4側/正側/背面），共消耗 12 積分，確定？`)) return;
          generateFourViews.mutate();
        }}
        disabled={generateFourViews.isPending || fourViewStatus === "generating"}
        className="w-full text-sm bg-[#6366f1] hover:bg-[#4338ca] text-white py-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        data-testid={`button-generate-fourviews-${character.id}`}
      >
        {fourViewStatus === "generating" ? "⏳ 生成中…" :
         fourViewStatus === "completed" ? "🔄 重新生成四視圖 (-12 積分)" :
         "✨ 生成四視圖 (-12 積分)"}
      </button>

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
      toast({ title: character ? "已更新" : "角色已建立" });
      onClose();
    },
    onError: (e: any) => toast({ title: "儲存失敗", description: e.message, variant: "destructive" }),
  });

  const handleUpload = async (files: FileList | null) => {
    if (!files) return;
    const remaining = 6 - refImageUrls.length;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, remaining)) {
        const path = await uploadToObjectStorage(file);
        setRefImageUrls(prev => [...prev, path]);
      }
    } catch {
      toast({ title: "上傳失敗", variant: "destructive" });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
      <div className="relative bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-[#0f172a]">{character ? "編輯角色" : "新增角色"}</h3>
          <button onClick={onClose} className="text-xl text-[#64748b]">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">名稱</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="例：林婉婷"
              className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1]"
              data-testid="input-character-name" />
          </div>

          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">外觀描述</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder="例：25歲女性，黑色長直髮，戴金絲眼鏡，氣質知性"
              className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[#6366f1]"
              data-testid="input-character-description" />
          </div>

          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">風格</label>
            <select value={styleHint} onChange={e => setStyleHint(e.target.value)}
              className="w-full bg-[#f8fafc] border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6366f1]">
              {STYLE_HINTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-[#64748b] uppercase tracking-wide mb-1.5 block">
              參考圖（建議 1-3 張正面照，最多 6 張）
            </label>
            <div className="flex flex-wrap gap-2">
              {refImageUrls.map((url, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-[#cbd5e1] bg-[#f8fafc] group">
                  <img src={url} alt={`ref-${i}`} className="w-full h-full object-cover" />
                  <button onClick={() => setRefImageUrls(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-[#ef4444] text-white text-xs rounded-full hidden group-hover:flex items-center justify-center">×</button>
                </div>
              ))}
              {refImageUrls.length < 6 && (
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="w-16 h-16 rounded-lg border-2 border-dashed border-[#cbd5e1] flex flex-col items-center justify-center text-[#94a3b8] hover:border-[#6366f1] hover:text-[#6366f1] transition-all"
                  data-testid="button-upload-ref">
                  {uploading ? <span className="text-xs">…</span> : <><span className="text-xl leading-none">+</span><span className="text-[9px]">上傳</span></>}
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => handleUpload(e.target.files)} />
          </div>

          <button
            onClick={() => saveMutation.mutate({ name, description, styleHint, refImageUrls })}
            disabled={!name.trim() || saveMutation.isPending}
            className="w-full bg-[#6366f1] hover:bg-[#4338ca] text-white py-2 rounded-lg text-sm transition-colors disabled:opacity-40"
            data-testid="button-save-character"
          >
            {saveMutation.isPending ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CharacterLibraryPage() {
  const [showCreate, setShowCreate] = useState(false);

  const { data: characters = [], isLoading } = useQuery<CharacterLibraryItem[]>({
    queryKey: ["/api/character-library"],
    refetchInterval: data => {
      const list = (data as any)?.state?.data as CharacterLibraryItem[] | undefined;
      return list?.some(c => c.fourViewStatus === "generating") ? 3000 : false;
    },
  });

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col">
      <NavigationHeader />
      <div className="max-w-6xl mx-auto px-6 py-8 w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <Link href="/drama">
                <button className="text-sm text-[#64748b] hover:text-[#334155]">← 返回漫劇</button>
              </Link>
              <h1 className="text-2xl font-bold text-[#0f172a]">🎭 角色庫</h1>
            </div>
            <p className="text-sm text-[#64748b] mt-1">建立可跨專案、跨集數重複使用的角色，並一鍵生成四視圖確保連貫</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-[#6366f1] hover:bg-[#4338ca] text-white px-4 py-2 rounded-lg text-sm font-medium"
            data-testid="button-create-character"
          >
            ＋ 新增角色
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 rounded-full border-2 border-t-transparent border-[#6366f1] animate-spin" />
          </div>
        ) : characters.length === 0 ? (
          <div className="text-center py-24 bg-white rounded-2xl border border-[#e2e8f0]">
            <div className="text-6xl mb-4">🎭</div>
            <p className="text-lg font-medium text-[#334155] mb-2">還沒有角色</p>
            <p className="text-sm text-[#64748b] mb-6">建立角色後，可在漫劇場景中重複使用，並一鍵生成四視圖確保不同視角的一致性</p>
            <button onClick={() => setShowCreate(true)}
              className="bg-[#6366f1] hover:bg-[#4338ca] text-white px-5 py-2.5 rounded-lg text-sm font-medium">
              ＋ 建立第一個角色
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {characters.map(c => <CharacterCard key={c.id} character={c} />)}
          </div>
        )}

        {showCreate && <CharacterFormModal onClose={() => setShowCreate(false)} />}
      </div>
    </div>
  );
}

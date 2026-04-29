import { useState, useRef } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NavigationHeader } from "./account";
import type { SceneLibraryItem } from "@shared/schema";

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

function SceneCard({ scene }: { scene: SceneLibraryItem }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showEdit, setShowEdit] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/scene-library/${scene.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scene-library"] });
      toast({ title: "場景已刪除" });
    },
  });

  const refs = scene.refImageUrls ?? [];

  return (
    <div className="bg-white border border-[#e2e8f0] rounded-2xl p-5 space-y-4" data-testid={`card-scene-${scene.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-[#0f172a] truncate text-lg">{scene.name}</h3>
          {scene.description && (
            <p className="text-xs text-[#64748b] mt-1 line-clamp-2">{scene.description}</p>
          )}
          <p className="text-[10px] text-[#94a3b8] mt-2">{refs.length} 張參考圖</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <button onClick={() => setShowEdit(true)} className="text-xs text-[#6366f1] hover:underline" data-testid={`button-edit-scene-${scene.id}`}>編輯</button>
          <button
            onClick={() => { if (confirm(`刪除場景「${scene.name}」？`)) deleteMutation.mutate(); }}
            className="text-xs text-[#ef4444] hover:underline"
            data-testid={`button-delete-scene-${scene.id}`}
          >刪除</button>
        </div>
      </div>

      {refs.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {refs.slice(0, 6).map((url, i) => (
            <div key={i} className="aspect-square rounded-lg border border-[#e2e8f0] overflow-hidden bg-[#f8fafc]">
              <img src={url} alt={`ref-${i}`} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {showEdit && <SceneFormModal scene={scene} onClose={() => setShowEdit(false)} />}
    </div>
  );
}

function SceneFormModal({
  scene,
  onClose,
}: {
  scene?: SceneLibraryItem;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(scene?.name ?? "");
  const [description, setDescription] = useState(scene?.description ?? "");
  const [refImageUrls, setRefImageUrls] = useState<string[]>(scene?.refImageUrls ?? []);
  const [uploading, setUploading] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = { name, description, refImageUrls };
      if (scene) return apiRequest("PATCH", `/api/scene-library/${scene.id}`, body);
      return apiRequest("POST", "/api/scene-library", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scene-library"] });
      toast({ title: scene ? "場景已更新" : "場景已建立" });
      onClose();
    },
    onError: (e: any) => toast({ title: "儲存失敗", description: e.message, variant: "destructive" }),
  });

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files).slice(0, 6 - refImageUrls.length)) {
        uploaded.push(await uploadToObjectStorage(file));
      }
      setRefImageUrls(prev => [...prev, ...uploaded].slice(0, 6));
    } catch (e: any) {
      toast({ title: "上傳失敗", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <h2 className="text-xl font-bold text-[#0f172a]">{scene ? "編輯場景" : "新增場景"}</h2>

        <div>
          <label className="text-xs text-[#64748b] uppercase">名稱</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="例如：學校天台、雨夜街角"
            className="w-full mt-1 bg-white border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm text-[#0f172a]"
            data-testid="input-scene-name" />
        </div>

        <div>
          <label className="text-xs text-[#64748b] uppercase">描述（給 AI 的場景說明）</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="例如：暮色中的學校天台，鐵欄杆，遠處城市天際線"
            className="w-full mt-1 bg-white border border-[#cbd5e1] rounded-lg px-3 py-2 text-sm text-[#0f172a]"
            data-testid="textarea-scene-description" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-[#64748b] uppercase">參考圖（最多 6 張，第 1 張為主視覺）</label>
            <button type="button" onClick={() => fileRef.current?.click()}
              disabled={uploading || refImageUrls.length >= 6}
              className="text-xs text-[#6366f1] hover:text-[#4f46e5] disabled:text-[#cbd5e1]"
              data-testid="button-upload-scene-ref">
              {uploading ? "上傳中…" : "+ 上傳"}
            </button>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => handleFiles(e.target.files)} />
          </div>
          {refImageUrls.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {refImageUrls.map((url, i) => (
                <div key={i} className="relative aspect-square rounded-lg border border-[#e2e8f0] overflow-hidden bg-[#f8fafc]">
                  <img src={url} alt={`ref-${i}`} className="w-full h-full object-cover" />
                  <button onClick={() => setRefImageUrls(prev => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs">×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#94a3b8] text-center py-4 border border-dashed border-[#cbd5e1] rounded-lg">尚未上傳</p>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-[#cbd5e1] text-sm text-[#64748b] hover:bg-[#f8fafc]">取消</button>
          <button
            onClick={() => { if (!name.trim()) { toast({ title: "請填名稱" }); return; } saveMutation.mutate(); }}
            disabled={saveMutation.isPending}
            className="flex-1 px-4 py-2 rounded-lg bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f46e5] disabled:bg-[#cbd5e1]"
            data-testid="button-save-scene"
          >
            {saveMutation.isPending ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SceneLibraryPage() {
  const [showCreate, setShowCreate] = useState(false);
  const scenesQuery = useQuery<SceneLibraryItem[]>({ queryKey: ["/api/scene-library"] });
  const scenes = scenesQuery.data ?? [];

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <NavigationHeader />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#0f172a]">🏞 場景庫</h1>
            <p className="text-sm text-[#64748b] mt-1">把常用場景／背景存起來，跨集數重複使用，畫面更一致。</p>
          </div>
          <div className="flex gap-2">
            <Link href="/character-library">
              <button className="px-4 py-2 rounded-lg border border-[#cbd5e1] text-sm text-[#64748b] hover:bg-white" data-testid="link-go-charlib">
                🎭 角色庫
              </button>
            </Link>
            <Link href="/drama">
              <button className="px-4 py-2 rounded-lg border border-[#cbd5e1] text-sm text-[#64748b] hover:bg-white" data-testid="link-back-drama">
                ← 回漫劇工作室
              </button>
            </Link>
            <button onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-lg bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f46e5]" data-testid="button-create-scene">
              + 新增場景
            </button>
          </div>
        </div>

        {scenesQuery.isLoading ? (
          <p className="text-center text-[#94a3b8] py-8">載入中…</p>
        ) : scenes.length === 0 ? (
          <div className="bg-white border border-dashed border-[#cbd5e1] rounded-2xl p-12 text-center">
            <p className="text-[#64748b]">場景庫還沒有任何場景</p>
            <button onClick={() => setShowCreate(true)} className="mt-3 px-4 py-2 rounded-lg bg-[#6366f1] text-white text-sm">
              建立第一個場景
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {scenes.map(s => <SceneCard key={s.id} scene={s} />)}
          </div>
        )}

        {showCreate && <SceneFormModal onClose={() => setShowCreate(false)} />}
      </div>
    </div>
  );
}

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { NavigationHeader } from "./account";
import { useUser } from "@/App";
import type { DramaProject, DramaEpisode, DramaScene } from "@shared/schema";

const nid = () => Math.random().toString(36).slice(2, 10);

// ─── Types & Helpers ──────────────────────────────────────────────────────────

type View =
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
  | { kind: "episode"; projectId: string; episodeId: string };

const CAMERA_MOVEMENTS = [
  { value: "", label: "不指定" },
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
const SIZE_LABELS: Record<string, string> = { "9:16": "直式 9:16（推薦）", "16:9": "橫式 16:9", "1:1": "正方形 1:1" };

function getSceneImageUrl(scene: DramaScene): string | null {
  return scene.bunnyUrl || scene.imageUrl || null;
}
function getSceneVideoUrl(scene: DramaScene): string | null {
  return scene.videoBunnyUrl || scene.videoUrl || null;
}

function statusBadge(status: string | undefined) {
  if (!status || status === "pending") return null;
  if (status === "generating") return <Badge className="bg-yellow-100 text-yellow-700 text-xs">生成中</Badge>;
  if (status === "completed") return <Badge className="bg-green-100 text-green-700 text-xs">完成</Badge>;
  if (status === "failed") return <Badge className="bg-red-100 text-red-700 text-xs">失敗</Badge>;
  return null;
}

// ─── Shared upload helper ─────────────────────────────────────────────────────

async function uploadToObjectStorage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) throw new Error("上傳失敗");
  const data = await res.json();
  return data.objectPath as string;
}

// ─── ImageUploadButton ─────────────────────────────────────────────────────────

function ImageUploadButton({
  label, objectPaths, onAdd, onRemove, max = 4, compact = false,
}: {
  label: string; objectPaths: string[]; onAdd: (path: string, previewUrl: string) => void;
  onRemove: (idx: number) => void; max?: number; compact?: boolean;
}) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const remaining = max - objectPaths.length;
    const toUpload = Array.from(files).slice(0, remaining);
    setUploading(true);
    for (const file of toUpload) {
      try {
        const previewUrl = URL.createObjectURL(file);
        const objectPath = await uploadToObjectStorage(file);
        onAdd(objectPath, previewUrl);
        setPreviews(p => [...p, previewUrl]);
      } catch {
        toast({ title: "上傳失敗", variant: "destructive" });
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-600">{label}</p>
      <div className={`flex gap-2 flex-wrap ${compact ? "" : "min-h-[60px]"}`}>
        {objectPaths.map((_, i) => (
          <div key={i} className="relative w-14 h-14 rounded-lg overflow-hidden border-2 border-emerald-300 group">
            <div className="w-full h-full bg-emerald-100 flex items-center justify-center">
              <span className="text-emerald-600 text-xs">✓</span>
            </div>
            <button
              onClick={() => onRemove(i)}
              className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-xs rounded-bl hidden group-hover:flex items-center justify-center"
            >×</button>
          </div>
        ))}
        {objectPaths.length < max && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-14 h-14 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 hover:border-emerald-400 hover:text-emerald-500 transition-all"
          >
            {uploading ? <span className="text-xs">...</span> : <><span className="text-xl">+</span><span className="text-xs">上傳</span></>}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
        onChange={e => handleFiles(e.target.files)} />
    </div>
  );
}

// ─── Projects View ────────────────────────────────────────────────────────────

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
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🎬 漫劇工作室</h1>
          <p className="text-sm text-gray-500 mt-1">建立 AI 漫劇專案，管理多集故事</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-emerald-600 hover:bg-emerald-700">
          + 新建漫劇
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-36 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-6xl mb-4">🎬</div>
          <p className="text-lg font-medium mb-2">還沒有漫劇專案</p>
          <p className="text-sm mb-6">點擊「新建漫劇」開始你的第一部 AI 漫劇</p>
          <Button onClick={() => setShowCreate(true)} className="bg-emerald-600 hover:bg-emerald-700">
            + 新建漫劇
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {projects.map(p => (
            <div
              key={p.id}
              onClick={() => onSelect(p.id)}
              className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-emerald-400 hover:shadow-md transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="text-3xl">🎬</div>
                <button
                  onClick={e => { e.stopPropagation(); if (confirm(`確定刪除「${p.title}」及所有集數？`)) deleteMutation.mutate(p.id); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity text-sm"
                >✕</button>
              </div>
              <h3 className="font-bold text-gray-900 truncate">{p.title}</h3>
              <div className="flex items-center gap-2 mt-2">
                {p.genre && <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{p.genre}</span>}
                <span className="text-xs text-gray-500">{p.episodeCount ?? 0} 集</span>
                <span className="text-xs text-gray-400">{SIZE_LABELS[p.sceneSize ?? "9:16"]?.split("（")[0]}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>新建漫劇專案</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">漫劇標題 *</label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="例：霸道總裁的秘密" />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">類型</label>
              <div className="flex flex-wrap gap-2">
                {GENRES.map(g => (
                  <button key={g} onClick={() => setNewGenre(g)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-all ${newGenre === g ? "bg-emerald-600 text-white border-emerald-600" : "border-gray-200 hover:border-emerald-300"}`}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <Button
              onClick={() => createMutation.mutate({ title: newTitle, genre: newGenre })}
              disabled={!newTitle.trim() || createMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {createMutation.isPending ? "建立中..." : "建立漫劇"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Project Detail View ──────────────────────────────────────────────────────

function ProjectView({
  projectId, onBack, onSelectEpisode,
}: { projectId: string; onBack: () => void; onSelectEpisode: (id: string) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingProject, setEditingProject] = useState(false);
  const [showNewEpisode, setShowNewEpisode] = useState(false);
  const [newEpTitle, setNewEpTitle] = useState("");
  const [newEpSceneCount, setNewEpSceneCount] = useState(6);

  const { data: project, isLoading: loadingProject } = useQuery<DramaProject>({
    queryKey: ["/api/drama/projects", projectId],
    queryFn: () => fetch(`/api/drama/projects/${projectId}`).then(r => r.json()),
  });

  const { data: episodes = [], isLoading: loadingEpisodes } = useQuery<DramaEpisode[]>({
    queryKey: ["/api/drama/projects", projectId, "episodes"],
    queryFn: () => fetch(`/api/drama/projects/${projectId}/episodes`).then(r => r.json()),
  });

  // Project editing state
  const [pTitle, setPTitle] = useState("");
  const [pGenre, setPGenre] = useState("");
  const [pSceneSize, setPSceneSize] = useState("9:16");
  const [pCharAUrls, setPCharAUrls] = useState<string[]>([]);
  const [pCharBUrls, setPCharBUrls] = useState<string[]>([]);
  const [pStyleUrls, setPStyleUrls] = useState<string[]>([]);

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

  const updateProjectMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/drama/projects/${projectId}`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/projects", projectId] });
      queryClient.invalidateQueries({ queryKey: ["/api/drama/projects"] });
      setEditingProject(false);
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

  const handleSaveProject = () => {
    updateProjectMutation.mutate({
      title: pTitle, genre: pGenre, sceneSize: pSceneSize,
      characterAUrls: pCharAUrls, characterBUrls: pCharBUrls, styleImageUrls: pStyleUrls,
    });
  };

  const handleCreateEpisode = () => {
    const sceneCount = newEpSceneCount;
    const scenes: DramaScene[] = Array.from({ length: sceneCount }, (_, i) => ({
      id: nid(),
      sceneNumber: i + 1,
      title: `第 ${i + 1} 幕`,
      description: "",
      dialogue: "",
      cameraMovement: "",
      useCharA: true,
      useCharB: true,
      imageStatus: "pending",
    }));
    createEpisodeMutation.mutate({
      title: newEpTitle || `第 ${episodes.length + 1} 集`,
      scenes,
      episodeNumber: episodes.length + 1,
    });
  };

  if (loadingProject) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" /></div>;
  if (!project) return <div className="text-center py-20 text-red-500">找不到漫劇</div>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700 text-sm flex items-center gap-1">
          ← 返回
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-900">{project.title}</h1>
            {project.genre && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">{project.genre}</span>}
            <span className="text-xs text-gray-400">{SIZE_LABELS[project.sceneSize ?? "9:16"]}</span>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setEditingProject(true)}>✏️ 編輯設定</Button>
        <Button onClick={() => setShowNewEpisode(true)} className="bg-emerald-600 hover:bg-emerald-700">
          + 新增集數
        </Button>
      </div>

      {/* Character Library */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-4">🎭 角色庫</h2>
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-sm font-medium text-gray-600 mb-2">角色 A（{(project.characterAUrls ?? []).length} 張）</p>
            <div className="flex flex-wrap gap-2">
              {(project.characterAUrls ?? []).map((_, i) => (
                <div key={i} className="w-14 h-14 rounded-lg bg-blue-100 flex items-center justify-center border-2 border-blue-300">
                  <span className="text-blue-600 text-xs font-bold">A{i+1}</span>
                </div>
              ))}
              {(project.characterAUrls ?? []).length === 0 && (
                <p className="text-xs text-gray-400 mt-1">未設定（在編輯設定中上傳）</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-600 mb-2">角色 B（{(project.characterBUrls ?? []).length} 張）</p>
            <div className="flex flex-wrap gap-2">
              {(project.characterBUrls ?? []).map((_, i) => (
                <div key={i} className="w-14 h-14 rounded-lg bg-orange-100 flex items-center justify-center border-2 border-orange-300">
                  <span className="text-orange-600 text-xs font-bold">B{i+1}</span>
                </div>
              ))}
              {(project.characterBUrls ?? []).length === 0 && (
                <p className="text-xs text-gray-400 mt-1">未設定</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-600 mb-2">風格參考（{(project.styleImageUrls ?? []).length} 張）</p>
            <div className="flex flex-wrap gap-2">
              {(project.styleImageUrls ?? []).map((_, i) => (
                <div key={i} className="w-14 h-14 rounded-lg bg-purple-100 flex items-center justify-center border-2 border-purple-300">
                  <span className="text-purple-600 text-xs font-bold">S{i+1}</span>
                </div>
              ))}
              {(project.styleImageUrls ?? []).length === 0 && (
                <p className="text-xs text-gray-400 mt-1">未設定</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Episodes List */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-4">📋 集數列表</h2>
        {loadingEpisodes ? (
          <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />)}</div>
        ) : episodes.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <p className="mb-3">還沒有集數，點擊「新增集數」開始</p>
            <Button onClick={() => setShowNewEpisode(true)} variant="outline" className="border-emerald-300 text-emerald-700">
              + 新增第一集
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {episodes.map(ep => {
              const scenes: DramaScene[] = JSON.parse(ep.scenes || "[]");
              const completedScenes = scenes.filter(s => s.imageStatus === "completed").length;
              return (
                <div
                  key={ep.id}
                  className="flex items-center gap-4 p-4 border border-gray-200 rounded-xl hover:border-emerald-300 hover:bg-emerald-50/30 cursor-pointer transition-all group"
                  onClick={() => onSelectEpisode(ep.id)}
                >
                  <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center font-bold text-emerald-700">
                    {ep.episodeNumber}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{ep.title}</p>
                    <p className="text-xs text-gray-500">{ep.sceneCount} 幕 · {completedScenes} 幕已生成圖片</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {ep.status === "generating" && <Badge className="bg-yellow-100 text-yellow-700">生成中</Badge>}
                    {ep.status === "completed" && <Badge className="bg-green-100 text-green-700">完成</Badge>}
                    {ep.status === "failed" && <Badge className="bg-red-100 text-red-700">失敗</Badge>}
                    {ep.status === "draft" && <Badge className="bg-gray-100 text-gray-600">草稿</Badge>}
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm("確定刪除此集？")) deleteEpisodeMutation.mutate(ep.id); }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 text-sm transition-opacity"
                    >✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit Project Dialog */}
      <Dialog open={editingProject} onOpenChange={setEditingProject}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>編輯漫劇設定</DialogTitle></DialogHeader>
          <div className="space-y-5 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">漫劇標題</label>
              <Input value={pTitle} onChange={e => setPTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">類型</label>
              <div className="flex flex-wrap gap-2">
                {GENRES.map(g => (
                  <button key={g} onClick={() => setPGenre(g)}
                    className={`px-3 py-1 rounded-full text-sm border transition-all ${pGenre === g ? "bg-emerald-600 text-white border-emerald-600" : "border-gray-200 hover:border-emerald-300"}`}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">圖片尺寸</label>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(SIZE_LABELS).map(([val, label]) => (
                  <button key={val} onClick={() => setPSceneSize(val)}
                    className={`p-3 rounded-xl border-2 text-sm transition-all ${pSceneSize === val ? "border-emerald-500 bg-emerald-50 text-emerald-700 font-medium" : "border-gray-200 hover:border-emerald-200"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <ImageUploadButton
              label="角色 A 參考圖（最多 4 張）"
              objectPaths={pCharAUrls}
              onAdd={(path) => setPCharAUrls(p => [...p, path])}
              onRemove={(i) => setPCharAUrls(p => p.filter((_, idx) => idx !== i))}
            />
            <ImageUploadButton
              label="角色 B 參考圖（最多 4 張）"
              objectPaths={pCharBUrls}
              onAdd={(path) => setPCharBUrls(p => [...p, path])}
              onRemove={(i) => setPCharBUrls(p => p.filter((_, idx) => idx !== i))}
            />
            <ImageUploadButton
              label="風格參考圖（最多 4 張）"
              objectPaths={pStyleUrls}
              onAdd={(path) => setPStyleUrls(p => [...p, path])}
              onRemove={(i) => setPStyleUrls(p => p.filter((_, idx) => idx !== i))}
            />
            <Button
              onClick={handleSaveProject}
              disabled={updateProjectMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {updateProjectMutation.isPending ? "儲存中..." : "儲存設定"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Episode Dialog */}
      <Dialog open={showNewEpisode} onOpenChange={setShowNewEpisode}>
        <DialogContent>
          <DialogHeader><DialogTitle>新增集數</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">集數標題</label>
              <Input value={newEpTitle} onChange={e => setNewEpTitle(e.target.value)}
                placeholder={`第 ${episodes.length + 1} 集`} />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-2 block">
                場景數量：<span className="text-emerald-600 font-bold">{newEpSceneCount} 幕</span>
                <span className="text-xs text-gray-400 ml-2">（{newEpSceneCount * 3} 積分）</span>
              </label>
              <input type="range" min={2} max={12} value={newEpSceneCount}
                onChange={e => setNewEpSceneCount(Number(e.target.value))}
                className="w-full accent-emerald-500" />
              <div className="flex justify-between text-xs text-gray-400 mt-1"><span>2 幕</span><span>12 幕</span></div>
            </div>
            <Button
              onClick={handleCreateEpisode}
              disabled={createEpisodeMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {createEpisodeMutation.isPending ? "建立中..." : "建立集數並開始編輯"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Episode Editor ────────────────────────────────────────────────────────────

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
      const hasGenerating = scenes.some(s => s.imageStatus === "generating" || s.videoStatus === "generating") || ep.status === "generating";
      return hasGenerating ? 3000 : false;
    },
  });

  const { data: project } = useQuery<DramaProject>({
    queryKey: ["/api/drama/projects", projectId],
    queryFn: () => fetch(`/api/drama/projects/${projectId}`).then(r => r.json()),
  });

  const [localScenes, setLocalScenes] = useState<DramaScene[]>([]);
  const [activeSceneIdx, setActiveSceneIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"storyboard" | "generate">("storyboard");
  const [animateDialog, setAnimateDialog] = useState<{ sceneIdx: number } | null>(null);
  const [animDuration, setAnimDuration] = useState(5);
  const [animResolution, setAnimResolution] = useState<"720p" | "1080p">("720p");
  const [animUseOmni, setAnimUseOmni] = useState(false);

  // Sync local scenes from server data
  useEffect(() => {
    if (episode) {
      const serverScenes: DramaScene[] = JSON.parse(episode.scenes || "[]");
      setLocalScenes(serverScenes);
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

  const generateImagesMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/generate-images`, {}).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: `開始生成！消耗 ${data.creditCost} 積分` });
      setActiveTab("generate");
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
    mutationFn: ({ sceneIdx, duration, resolution, useOmniMode }: any) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/animate-scene/${sceneIdx}`, { duration, resolution, useOmniMode }).then(r => r.json()),
    onSuccess: (data, { sceneIdx }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/drama/episodes", episodeId] });
      toast({ title: `動畫生成中，消耗 ${data.creditCost} 積分` });
      setAnimateDialog(null);
    },
    onError: (e: any) => toast({ title: "動畫失敗", description: e.message, variant: "destructive" }),
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
    const newScene: DramaScene = {
      id: nid(),
      sceneNumber: localScenes.length + 1,
      title: `第 ${localScenes.length + 1} 幕`,
      description: "",
      dialogue: "",
      cameraMovement: "",
      useCharA: true,
      useCharB: true,
      imageStatus: "pending",
    };
    setLocalScenes(prev => [...prev, newScene]);
  };

  const removeScene = (idx: number) => {
    if (localScenes.length <= 2) { toast({ title: "最少需要 2 幕" }); return; }
    setLocalScenes(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, sceneNumber: i + 1 })));
  };

  const pendingCount = localScenes.filter(s => s.imageStatus !== "completed").length;
  const creditCost = pendingCount * 3;
  const hasEnoughCredits = (user?.credits ?? 0) >= creditCost;

  const handleGenerateImages = () => {
    // Save first, then generate
    saveScenesMutation.mutate(localScenes, {
      onSuccess: () => generateImagesMutation.mutate(),
    });
  };

  const replaceFileRef = useRef<{ [key: number]: HTMLInputElement | null }>({});

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full" /></div>;
  if (!episode) return <div className="text-center py-20 text-red-500">找不到集數</div>;

  const serverScenes: DramaScene[] = JSON.parse(episode.scenes || "[]");

  return (
    <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 p-4">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700 text-sm flex items-center gap-1 shrink-0">
          ← 返回
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400">{project?.title}</p>
          <h1 className="font-bold text-gray-900 truncate">{episode.title}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {episode.status === "generating" && <Badge className="bg-yellow-100 text-yellow-700 animate-pulse">生成中</Badge>}
          {/* Tabs */}
          <button onClick={() => setActiveTab("storyboard")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "storyboard" ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            📋 分鏡板
          </button>
          <button onClick={() => setActiveTab("generate")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "generate" ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            🎨 生成結果
          </button>
        </div>
      </div>

      {/* ── Storyboard Tab ─────────────────────────────────────────────────────── */}
      {activeTab === "storyboard" && (
        <div className="space-y-4">
          {/* Action bar */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">
                {localScenes.length} 幕 · {pendingCount} 幕待生成
              </span>
              <span className="text-sm font-medium text-emerald-700">需要 {creditCost} 積分</span>
              {!hasEnoughCredits && creditCost > 0 && (
                <span className="text-xs text-red-500">積分不足（現有 {user?.credits ?? 0}）</span>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => saveScenesMutation.mutate(localScenes)} disabled={saveScenesMutation.isPending}>
                {saveScenesMutation.isPending ? "儲存中..." : "💾 儲存分鏡"}
              </Button>
              <Button
                size="sm"
                onClick={handleGenerateImages}
                disabled={!hasEnoughCredits || generateImagesMutation.isPending || pendingCount === 0}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {generateImagesMutation.isPending ? "生成中..." : `🎨 生成全部圖片 (-${creditCost}積分)`}
              </Button>
              <Button variant="outline" size="sm" onClick={addScene} disabled={localScenes.length >= 12}>
                + 新增幕
              </Button>
            </div>
          </div>

          {/* Scene cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {localScenes.map((scene, idx) => {
              const serverScene = serverScenes[idx];
              const imgUrl = serverScene ? getSceneImageUrl(serverScene) : null;
              const isActive = activeSceneIdx === idx;

              return (
                <div key={scene.id}
                  className={`bg-white rounded-xl border-2 transition-all ${isActive ? "border-emerald-500 shadow-md" : "border-gray-200 hover:border-gray-300"}`}>
                  {/* Image preview */}
                  <div
                    className="relative aspect-[9/16] rounded-t-xl overflow-hidden bg-gray-100 cursor-pointer"
                    onClick={() => setActiveSceneIdx(isActive ? null : idx)}
                  >
                    {imgUrl ? (
                      <img src={imgUrl} alt={scene.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-300">
                        <span className="text-4xl mb-2">🎬</span>
                        <span className="text-xs">幕 {scene.sceneNumber}</span>
                      </div>
                    )}
                    {/* Status overlay */}
                    {serverScene?.imageStatus === "generating" && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <div className="text-white text-center">
                          <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                          <span className="text-xs">生成中</span>
                        </div>
                      </div>
                    )}
                    <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
                      {scene.sceneNumber}
                    </div>
                    {serverScene?.videoStatus === "completed" && (
                      <div className="absolute top-2 right-2 bg-purple-600/80 text-white text-xs px-2 py-0.5 rounded-full">▶ 影片</div>
                    )}
                  </div>

                  {/* Scene fields */}
                  <div className="p-3 space-y-2">
                    <Input
                      value={scene.title}
                      onChange={e => updateScene(idx, { title: e.target.value })}
                      placeholder="幕名稱"
                      className="text-sm font-medium h-8"
                    />
                    <Textarea
                      value={scene.description}
                      onChange={e => updateScene(idx, { description: e.target.value })}
                      placeholder="場景描述（AI 會據此生成圖片）"
                      className="text-xs min-h-[60px] resize-none"
                    />
                    <Input
                      value={scene.dialogue || ""}
                      onChange={e => updateScene(idx, { dialogue: e.target.value })}
                      placeholder="台詞（選填）"
                      className="text-xs h-7"
                    />
                    <Select value={scene.cameraMovement || ""} onValueChange={v => updateScene(idx, { cameraMovement: v })}>
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="攝影機運鏡" />
                      </SelectTrigger>
                      <SelectContent>
                        {CAMERA_MOVEMENTS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>

                    {/* Character toggles */}
                    <div className="flex gap-2">
                      {(project?.characterAUrls ?? []).length > 0 && (
                        <button
                          onClick={() => updateScene(idx, { useCharA: !scene.useCharA })}
                          className={`flex-1 text-xs py-1 rounded border transition-all ${scene.useCharA ? "bg-blue-100 border-blue-300 text-blue-700" : "border-gray-200 text-gray-400"}`}
                        >角色A {scene.useCharA ? "✓" : "×"}</button>
                      )}
                      {(project?.characterBUrls ?? []).length > 0 && (
                        <button
                          onClick={() => updateScene(idx, { useCharB: !scene.useCharB })}
                          className={`flex-1 text-xs py-1 rounded border transition-all ${scene.useCharB ? "bg-orange-100 border-orange-300 text-orange-700" : "border-gray-200 text-gray-400"}`}
                        >角色B {scene.useCharB ? "✓" : "×"}</button>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-1.5 pt-1">
                      {serverScene?.imageStatus === "failed" && (
                        <button
                          onClick={() => regenerateSceneMutation.mutate({ sceneIdx: idx })}
                          className="flex-1 text-xs py-1 bg-red-50 text-red-600 rounded border border-red-200 hover:bg-red-100"
                        >🔄 重試</button>
                      )}
                      {serverScene?.imageStatus === "completed" && (
                        <>
                          <button
                            onClick={() => regenerateSceneMutation.mutate({ sceneIdx: idx })}
                            disabled={regenerateSceneMutation.isPending}
                            className="flex-1 text-xs py-1 bg-gray-50 text-gray-600 rounded border border-gray-200 hover:bg-gray-100"
                          >🔄 重生 (-3)</button>
                          <button
                            onClick={() => setAnimateDialog({ sceneIdx: idx })}
                            className="flex-1 text-xs py-1 bg-purple-50 text-purple-600 rounded border border-purple-200 hover:bg-purple-100"
                          >🎬 動畫</button>
                          <button
                            onClick={() => replaceFileRef.current[idx]?.click()}
                            className="flex-1 text-xs py-1 bg-blue-50 text-blue-600 rounded border border-blue-200 hover:bg-blue-100"
                          >🖼 替換</button>
                          <input
                            ref={el => { replaceFileRef.current[idx] = el; }}
                            type="file" accept="image/*" className="hidden"
                            onChange={async e => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const objectPath = await uploadToObjectStorage(file);
                              replaceImageMutation.mutate({ sceneIdx: idx, objectPath });
                              if (e.target) e.target.value = "";
                            }}
                          />
                        </>
                      )}
                      <button
                        onClick={() => removeScene(idx)}
                        className="text-xs py-1 px-2 text-gray-400 hover:text-red-500 rounded border border-gray-200 hover:border-red-200"
                      >✕</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Generate Tab ────────────────────────────────────────────────────────── */}
      {activeTab === "generate" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-800">生成結果</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {serverScenes.filter(s => s.imageStatus === "completed").length}/{serverScenes.length} 幕圖片完成 ·
                  {serverScenes.filter(s => s.videoStatus === "completed").length} 幕影片完成
                </p>
              </div>
              <Button
                onClick={handleGenerateImages}
                disabled={!hasEnoughCredits || generateImagesMutation.isPending || pendingCount === 0}
                className="bg-emerald-600 hover:bg-emerald-700"
                size="sm"
              >
                {pendingCount > 0 ? `🎨 生成剩餘 ${pendingCount} 幕 (-${creditCost}積分)` : "✅ 全部完成"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {serverScenes.map((scene, idx) => {
              const imgUrl = getSceneImageUrl(scene);
              const vidUrl = getSceneVideoUrl(scene);
              return (
                <div key={scene.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Media preview */}
                  <div className="relative aspect-[9/16] bg-gray-100">
                    {vidUrl && scene.videoStatus === "completed" ? (
                      <video src={vidUrl} controls className="w-full h-full object-cover" />
                    ) : imgUrl ? (
                      <img src={imgUrl} alt={scene.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-300">
                        {scene.imageStatus === "generating" ? (
                          <><div className="w-8 h-8 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin mb-2" /><span className="text-xs text-emerald-500">生成中</span></>
                        ) : (
                          <><span className="text-4xl mb-2">🎬</span><span className="text-xs">待生成</span></>
                        )}
                      </div>
                    )}
                    <div className="absolute top-2 left-2 flex gap-1">
                      <span className="bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">{scene.sceneNumber}</span>
                      {statusBadge(scene.imageStatus)}
                      {scene.videoStatus === "completed" && <Badge className="bg-purple-600 text-white text-xs">▶</Badge>}
                    </div>
                  </div>

                  <div className="p-3 space-y-2">
                    <p className="text-sm font-medium text-gray-800 truncate">{scene.title}</p>
                    {scene.dialogue && <p className="text-xs text-gray-500 italic truncate">「{scene.dialogue}」</p>}

                    <div className="flex gap-1.5">
                      {scene.imageStatus === "completed" && scene.videoStatus !== "completed" && scene.videoStatus !== "generating" && (
                        <button
                          onClick={() => setAnimateDialog({ sceneIdx: idx })}
                          className="flex-1 text-xs py-1.5 bg-purple-50 text-purple-600 rounded border border-purple-200 hover:bg-purple-100 font-medium"
                        >🎬 生成影片</button>
                      )}
                      {scene.videoStatus === "generating" && (
                        <div className="flex-1 text-xs py-1.5 bg-yellow-50 text-yellow-600 rounded border border-yellow-200 text-center animate-pulse">
                          影片生成中...
                        </div>
                      )}
                      {scene.imageStatus === "failed" && (
                        <button
                          onClick={() => regenerateSceneMutation.mutate({ sceneIdx: idx })}
                          className="flex-1 text-xs py-1.5 bg-red-50 text-red-600 rounded border border-red-200 hover:bg-red-100"
                        >🔄 重試</button>
                      )}
                      {scene.imageStatus === "completed" && (
                        <button
                          onClick={() => regenerateSceneMutation.mutate({ sceneIdx: idx })}
                          disabled={regenerateSceneMutation.isPending}
                          className="text-xs py-1.5 px-2 bg-gray-50 text-gray-500 rounded border border-gray-200 hover:bg-gray-100"
                        >🔄 -3</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Animate Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={!!animateDialog} onOpenChange={open => !open && setAnimateDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>生成動畫影片</DialogTitle></DialogHeader>
          {animateDialog && (
            <div className="space-y-5 py-2">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">
                  影片時長：<span className="text-purple-600 font-bold">{animDuration} 秒</span>
                </label>
                <input type="range" min={4} max={12} value={animDuration}
                  onChange={e => setAnimDuration(Number(e.target.value))}
                  className="w-full accent-purple-500" />
                <div className="flex justify-between text-xs text-gray-400 mt-1"><span>4秒</span><span>12秒</span></div>
              </div>
              <div
                onClick={() => setAnimUseOmni(!animUseOmni)}
                className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${animUseOmni ? "border-emerald-500 bg-emerald-50" : "border-gray-200 hover:border-emerald-200"}`}
              >
                <div>
                  <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                    🌟 SeedDance 2.0 全能模式
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${animUseOmni ? "bg-emerald-200 text-emerald-800" : "bg-gray-100 text-gray-500"}`}>
                      {animUseOmni ? "啟用" : "關閉"}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">使用多圖參考，自動帶入角色A/B保持一致性</p>
                </div>
                <div className={`w-10 h-6 rounded-full transition-all relative flex-shrink-0 ${animUseOmni ? "bg-emerald-500" : "bg-gray-300"}`}>
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${animUseOmni ? "left-5" : "left-1"}`} />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-2 block">解析度</label>
                <div className="grid grid-cols-2 gap-3">
                  {(["720p", "1080p"] as const).map(r => {
                    const cost = r === "1080p" ? Math.ceil(animDuration * 6.8) : Math.ceil(animDuration * 3.4);
                    return (
                      <button key={r} onClick={() => setAnimResolution(r)}
                        className={`p-3 rounded-xl border-2 text-sm transition-all ${animResolution === r ? "border-purple-500 bg-purple-50 text-purple-700 font-medium" : "border-gray-200 hover:border-purple-200"}`}>
                        <div className="font-bold">{r}</div>
                        <div className="text-xs text-gray-500">{cost} 積分</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">
                消耗 <span className="font-bold text-purple-600">{animResolution === "1080p" ? Math.ceil(animDuration * 6.8) : Math.ceil(animDuration * 3.4)} 積分</span>
                （現有 {user?.credits ?? 0} 積分）
              </div>
              <Button
                onClick={() => animateSceneMutation.mutate({
                  sceneIdx: animateDialog.sceneIdx,
                  duration: animDuration,
                  resolution: animResolution,
                  useOmniMode: animUseOmni,
                })}
                disabled={animateSceneMutation.isPending || (user?.credits ?? 0) < (animResolution === "1080p" ? Math.ceil(animDuration * 6.8) : Math.ceil(animDuration * 3.4))}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {animateSceneMutation.isPending ? "生成中..." : "🎬 開始生成影片"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Drama Page ──────────────────────────────────────────────────────────

export default function DramaPage() {
  const [view, setView] = useState<View>({ kind: "projects" });

  return (
    <div className="bg-gray-50 min-h-screen">
      <NavigationHeader />
      <main>
        {view.kind === "projects" && (
          <ProjectsView onSelect={id => setView({ kind: "project", projectId: id })} />
        )}
        {view.kind === "project" && (
          <ProjectView
            projectId={view.projectId}
            onBack={() => setView({ kind: "projects" })}
            onSelectEpisode={epId => setView({ kind: "episode", projectId: view.projectId, episodeId: epId })}
          />
        )}
        {view.kind === "episode" && (
          <EpisodeView
            episodeId={view.episodeId}
            projectId={view.projectId}
            onBack={() => setView({ kind: "project", projectId: view.projectId })}
          />
        )}
      </main>
    </div>
  );
}

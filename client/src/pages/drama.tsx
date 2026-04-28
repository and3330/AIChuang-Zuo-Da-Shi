import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NavigationHeader } from "./account";
import { useUser } from "@/App";
import type { DramaProject, DramaEpisode, DramaScene } from "@shared/schema";

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

function getSceneImageUrl(s: DramaScene) { return s.bunnyUrl || s.imageUrl || null; }
function getSceneVideoUrl(s: DramaScene) { return s.videoBunnyUrl || s.videoUrl || null; }

async function uploadToObjectStorage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error("上傳失敗");
  const d = await res.json();
  return d.objectPath as string;
}

// ─── Shared styles ─────────────────────────────────────────────────────────────
const S = {
  root: "min-h-screen flex flex-col",
  page: "flex-1 bg-[#0a0a14] text-[#ccc]",
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
    primary:   "bg-[#6366f1] hover:bg-[#4f51c5] text-white",
    secondary: "bg-[#1a1a2e] hover:bg-[#252540] border border-[#2a2a4a] text-[#aaa]",
    danger:    "bg-[#ef4444]/10 hover:bg-[#ef4444]/20 border border-[#ef4444]/30 text-[#f87171]",
    ghost:     "hover:bg-[#1a1a2e] text-[#666] hover:text-[#aaa]",
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
      className={`w-full bg-[#111122] border border-[#2a2a4a] rounded-lg px-3 py-2 text-[#ccc] text-sm
        placeholder-[#444] focus:outline-none focus:border-[#6366f1] transition-colors ${className}`}
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
      className={`w-full bg-[#111122] border border-[#2a2a4a] rounded-lg px-3 py-2 text-[#ccc] text-sm
        placeholder-[#444] focus:outline-none focus:border-[#6366f1] transition-colors resize-none ${className}`}
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
      className="w-full bg-[#111122] border border-[#2a2a4a] rounded-lg px-3 py-2 text-[#ccc] text-sm
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#0d0d1a] border border-[#2a2a4a] rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-[#555] hover:text-[#aaa] text-xl leading-none">×</button>
        </div>
        {children}
      </div>
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
      <p className="text-xs font-medium text-[#666] uppercase tracking-wide">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {objectPaths.map((_, i) => (
          <div key={i} className="relative w-12 h-12 rounded-lg bg-[#1a1a2e] border border-[#2a2a4a] flex items-center justify-center group">
            <span className="text-[#6366f1] text-xs font-bold">✓</span>
            <button onClick={() => onRemove(i)}
              className="absolute -top-1 -right-1 w-4 h-4 bg-[#ef4444] text-white text-xs rounded-full hidden group-hover:flex items-center justify-center">×</button>
          </div>
        ))}
        {objectPaths.length < max && (
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="w-12 h-12 rounded-lg border border-dashed border-[#2a2a4a] flex flex-col items-center justify-center text-[#444] hover:border-[#6366f1] hover:text-[#6366f1] transition-all">
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
          <h1 className="text-2xl font-bold text-white">🎬 漫劇工作室</h1>
          <p className="text-sm text-[#555] mt-1">視覺化 AI 漫劇生成流程</p>
        </div>
        <DarkButton onClick={() => setShowCreate(true)}>＋ 新建漫劇</DarkButton>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40"><Spinner /></div>
      ) : projects.length === 0 ? (
        <div className="text-center py-24">
          <div className="text-6xl mb-4">🎬</div>
          <p className="text-lg font-medium text-[#aaa] mb-2">還沒有漫劇專案</p>
          <p className="text-sm text-[#555] mb-6">點擊「新建漫劇」開始你的第一部 AI 漫劇</p>
          <DarkButton onClick={() => setShowCreate(true)}>＋ 新建漫劇</DarkButton>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {projects.map(p => (
            <div key={p.id} onClick={() => onSelect(p.id)}
              className="bg-[#0d0d1a] border border-[#1a1a2e] rounded-2xl p-5 cursor-pointer
                hover:border-[#6366f1] hover:shadow-[0_0_20px_rgba(99,102,241,0.15)] transition-all group">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-[#6366f1]/10 rounded-xl flex items-center justify-center text-xl">🎬</div>
                <button onClick={e => { e.stopPropagation(); if (confirm(`確定刪除「${p.title}」？`)) deleteMutation.mutate(p.id); }}
                  className="opacity-0 group-hover:opacity-100 text-[#444] hover:text-[#ef4444] transition-all text-sm">✕</button>
              </div>
              <h3 className="font-bold text-white truncate">{p.title}</h3>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {p.genre && <span className="text-xs bg-[#6366f1]/10 text-[#a78bfa] px-2 py-0.5 rounded-full">{p.genre}</span>}
                <span className="text-xs text-[#555]">{p.episodeCount ?? 0} 集</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建漫劇專案">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#666] uppercase tracking-wide mb-2 block">漫劇標題</label>
            <DarkInput value={newTitle} onChange={setNewTitle} placeholder="例：霸道總裁的秘密" />
          </div>
          <div>
            <label className="text-xs text-[#666] uppercase tracking-wide mb-2 block">類型</label>
            <div className="flex flex-wrap gap-2">
              {GENRES.map(g => (
                <button key={g} onClick={() => setNewGenre(g)}
                  className={`px-3 py-1 rounded-full text-xs border transition-all ${newGenre === g ? "bg-[#6366f1] text-white border-[#6366f1]" : "border-[#2a2a4a] text-[#666] hover:border-[#6366f1] hover:text-[#a78bfa]"}`}>
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
  const [newEpTitle, setNewEpTitle] = useState("");
  const [newEpSceneCount, setNewEpSceneCount] = useState(6);
  const [pTitle, setPTitle] = useState("");
  const [pGenre, setPGenre] = useState("愛情");
  const [pSceneSize, setPSceneSize] = useState("9:16");
  const [pCharAUrls, setPCharAUrls] = useState<string[]>([]);
  const [pCharBUrls, setPCharBUrls] = useState<string[]>([]);
  const [pStyleUrls, setPStyleUrls] = useState<string[]>([]);

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
    const scenes: DramaScene[] = Array.from({ length: newEpSceneCount }, (_, i) => ({
      id: nid(), sceneNumber: i + 1, title: `第 ${i + 1} 幕`,
      description: "", dialogue: "", cameraMovement: "",
      useCharA: true, useCharB: true, imageStatus: "pending",
    }));
    createEpisodeMutation.mutate({
      title: newEpTitle || `第 ${episodes.length + 1} 集`,
      scenes, episodeNumber: episodes.length + 1,
    });
  };

  if (loadingProject) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (!project) return <div className="text-center py-20 text-[#ef4444]">找不到漫劇</div>;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="text-[#555] hover:text-[#aaa] text-sm transition-colors">← 返回</button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-white">{project.title}</h1>
            {project.genre && <span className="text-xs bg-[#6366f1]/10 text-[#a78bfa] px-2 py-0.5 rounded-full">{project.genre}</span>}
            <span className="text-xs text-[#444]">{SIZE_LABELS[project.sceneSize ?? "9:16"]}</span>
          </div>
        </div>
        <DarkButton variant="secondary" onClick={() => setShowSettings(true)}>✏️ 編輯設定</DarkButton>
        <DarkButton onClick={() => setShowNewEpisode(true)}>＋ 新增集數</DarkButton>
      </div>

      {/* Character Library */}
      <div className="bg-[#0d0d1a] border border-[#1a1a2e] rounded-2xl p-5">
        <h2 className="font-semibold text-[#aaa] mb-4 text-sm uppercase tracking-wide">🎭 角色庫</h2>
        <div className="grid grid-cols-3 gap-6">
          {[
            { label: "角色 A", urls: project.characterAUrls ?? [], color: "#6366f1" },
            { label: "角色 B", urls: project.characterBUrls ?? [], color: "#f59e0b" },
            { label: "風格參考", urls: project.styleImageUrls ?? [], color: "#10b981" },
          ].map(({ label, urls, color }) => (
            <div key={label}>
              <p className="text-xs text-[#555] mb-2">{label}（{urls.length} 張）</p>
              <div className="flex flex-wrap gap-1.5">
                {urls.map((_, i) => (
                  <div key={i} className="w-10 h-10 rounded-lg flex items-center justify-center border text-xs font-bold"
                    style={{ background: `${color}15`, borderColor: `${color}40`, color }}>
                    {label[2]}{i + 1}
                  </div>
                ))}
                {urls.length === 0 && <p className="text-xs text-[#333]">未設定</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Episodes */}
      <div className="bg-[#0d0d1a] border border-[#1a1a2e] rounded-2xl p-5">
        <h2 className="font-semibold text-[#aaa] mb-4 text-sm uppercase tracking-wide">📋 集數列表</h2>
        {loadingEpisodes ? (
          <div className="flex items-center justify-center h-16"><Spinner /></div>
        ) : episodes.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-[#444] mb-3 text-sm">還沒有集數</p>
            <DarkButton variant="secondary" onClick={() => setShowNewEpisode(true)}>＋ 新增第一集</DarkButton>
          </div>
        ) : (
          <div className="space-y-2">
            {episodes.map(ep => {
              const scenes: DramaScene[] = JSON.parse(ep.scenes || "[]");
              const done = scenes.filter(s => s.imageStatus === "completed").length;
              const statusColor = ep.status === "completed" ? "#22c55e" : ep.status === "generating" ? "#facc15" : ep.status === "failed" ? "#ef4444" : "#444";
              return (
                <div key={ep.id} onClick={() => onSelectEpisode(ep.id)}
                  className="flex items-center gap-4 p-4 rounded-xl border border-[#1a1a2e] hover:border-[#6366f1]/40 hover:bg-[#6366f1]/5 cursor-pointer transition-all group">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm"
                    style={{ background: "#6366f115", color: "#a78bfa" }}>
                    {ep.episodeNumber}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-[#ccc]">{ep.title}</p>
                    <p className="text-xs text-[#444]">{ep.sceneCount} 幕 · {done} 幕已生成圖片</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded-full border"
                      style={{ color: statusColor, borderColor: `${statusColor}40`, background: `${statusColor}10` }}>
                      {ep.status === "generating" ? "生成中" : ep.status === "completed" ? "完成" : ep.status === "failed" ? "失敗" : "草稿"}
                    </span>
                    <button onClick={e => { e.stopPropagation(); if (confirm("確定刪除此集？")) deleteEpisodeMutation.mutate(ep.id); }}
                      className="opacity-0 group-hover:opacity-100 text-[#444] hover:text-[#ef4444] transition-all text-sm">✕</button>
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
            <label className="text-xs text-[#666] uppercase tracking-wide mb-2 block">漫劇標題</label>
            <DarkInput value={pTitle} onChange={setPTitle} />
          </div>
          <div>
            <label className="text-xs text-[#666] uppercase tracking-wide mb-2 block">類型</label>
            <div className="flex flex-wrap gap-2">
              {GENRES.map(g => (
                <button key={g} onClick={() => setPGenre(g)}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-all ${pGenre === g ? "bg-[#6366f1] text-white border-[#6366f1]" : "border-[#2a2a4a] text-[#666] hover:border-[#6366f1]"}`}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-[#666] uppercase tracking-wide mb-2 block">圖片尺寸</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(SIZE_LABELS).map(([val, label]) => (
                <button key={val} onClick={() => setPSceneSize(val)}
                  className={`p-2.5 rounded-xl border text-xs transition-all ${pSceneSize === val ? "border-[#6366f1] bg-[#6366f1]/10 text-[#a78bfa]" : "border-[#2a2a4a] text-[#555] hover:border-[#6366f1]/40"}`}>
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
      <Modal open={showNewEpisode} onClose={() => setShowNewEpisode(false)} title="新增集數">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-[#666] uppercase tracking-wide mb-2 block">集數標題</label>
            <DarkInput value={newEpTitle} onChange={setNewEpTitle} placeholder={`第 ${episodes.length + 1} 集`} />
          </div>
          <div>
            <label className="text-xs text-[#666] uppercase tracking-wide mb-2 block">
              場景數量：<span className="text-[#a78bfa] font-bold">{newEpSceneCount} 幕</span>
              <span className="text-[#444] ml-2">（{newEpSceneCount * 3} 積分）</span>
            </label>
            <input type="range" min={2} max={12} value={newEpSceneCount}
              onChange={e => setNewEpSceneCount(Number(e.target.value))}
              className="w-full accent-[#6366f1]" />
            <div className="flex justify-between text-xs text-[#444] mt-1"><span>2 幕</span><span>12 幕</span></div>
          </div>
          <DarkButton onClick={handleCreateEpisode} disabled={createEpisodeMutation.isPending} className="w-full justify-center">
            {createEpisodeMutation.isPending ? "建立中..." : "建立集數並開始編輯"}
          </DarkButton>
        </div>
      </Modal>
    </div>
  );
}

// ─── Scene Flow Canvas (visual flow with SVG connections) ──────────────────────
function SceneFlowCanvas({
  scenes, serverScenes, selectedIdx, onSelect,
}: {
  scenes: DramaScene[]; serverScenes: DramaScene[]; selectedIdx: number | null;
  onSelect: (idx: number) => void;
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
          const color = bothDone ? "#22c55e" : "#2a2a4a";
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
          const borderColor = isSelected ? "#6366f1" : isGenerating ? "#facc15" : isDone ? "#22c55e" : isFailed ? "#ef4444" : "#2a2a4a";
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
              <rect x={3} y={3} width={CARD_W} height={CARD_H} rx={10} fill="black" fillOpacity="0.5" />

              {/* Card background */}
              <rect width={CARD_W} height={CARD_H} rx={10} fill="#0d0d1a" stroke={borderColor} strokeWidth={isSelected ? 2 : 1.5} />

              {/* Image area */}
              {imgUrl ? (
                <image href={imgUrl} x={0} y={0} width={CARD_W} height={CARD_H * 0.65}
                  preserveAspectRatio="xMidYMid slice"
                  style={{ borderRadius: 10 }} clipPath={`inset(0 0 0 0 round 10px)`} />
              ) : (
                <rect x={0} y={0} width={CARD_W} height={CARD_H * 0.65} rx={10} fill="#111122" />
              )}

              {/* Image placeholder icon */}
              {!imgUrl && (
                <text x={CARD_W / 2} y={CARD_H * 0.33} textAnchor="middle" fontSize="24" fill="#2a2a4a">🎬</text>
              )}

              {/* Generating animation */}
              {isGenerating && (
                <rect x={0} y={0} width={CARD_W} height={CARD_H * 0.65} rx={10} fill="#facc1520">
                  <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
                </rect>
              )}

              {/* Header accent */}
              <rect x={0} y={CARD_H * 0.65} width={CARD_W} height={1} fill={borderColor} fillOpacity="0.3" />

              {/* Scene number badge */}
              <rect x={4} y={4} width={22} height={16} rx={4} fill="black" fillOpacity="0.7" />
              <text x={15} y={15} textAnchor="middle" fill="#ccc" fontSize="10" fontFamily="monospace">{scene.sceneNumber}</text>

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

              {/* Scene title */}
              <text x={8} y={CARD_H * 0.65 + 16} fill="#888" fontSize="10" fontFamily="'Noto Sans TC', sans-serif">
                {scene.title.length > 7 ? scene.title.slice(0, 7) + "…" : scene.title}
              </text>

              {/* Description preview */}
              <text x={8} y={CARD_H * 0.65 + 30} fill="#444" fontSize="9" fontFamily="'Noto Sans TC', sans-serif">
                {(scene.description || "未填寫場景描述").slice(0, 10)}…
              </text>

              {/* Port connectors */}
              <circle cx={0} cy={CARD_H / 2} r={5} fill="#0d0d1a" stroke="#2a2a4a" strokeWidth={1.5} />
              <circle cx={CARD_W} cy={CARD_H / 2} r={5} fill="#0d0d1a" stroke={borderColor} strokeWidth={1.5} />
            </g>
          );
        })}
      </svg>
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
    mutationFn: ({ sceneIdx, duration, resolution, useOmniMode }: any) =>
      apiRequest("POST", `/api/drama/episodes/${episodeId}/animate-scene/${sceneIdx}`, { duration, resolution, useOmniMode }).then(r => r.json()),
    onSuccess: (data) => {
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

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col bg-[#0a0a14]">

      {/* ── Top Bar ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 h-12 bg-[#0d0d1a] border-b border-[#1a1a2e] shrink-0">
        <button onClick={onBack} className="text-[#555] hover:text-[#aaa] text-sm transition-colors shrink-0">← 返回</button>
        <div className="w-px h-4 bg-[#1a1a2e]" />
        <div className="flex-1 min-w-0">
          <span className="text-xs text-[#444]">{project?.title} · </span>
          <span className="text-sm font-medium text-[#ccc]">{episode.title}</span>
          {episode.status === "generating" && (
            <span className="ml-2 text-xs text-[#facc15] animate-pulse">● 生成中</span>
          )}
        </div>

        {/* View toggle */}
        <div className="flex gap-1 bg-[#111122] rounded-lg p-0.5">
          <button onClick={() => setActiveView("flow")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeView === "flow" ? "bg-[#6366f1] text-white" : "text-[#555] hover:text-[#aaa]"}`}>
            ⬡ 節點流
          </button>
          <button onClick={() => setActiveView("grid")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${activeView === "grid" ? "bg-[#6366f1] text-white" : "text-[#555] hover:text-[#aaa]"}`}>
            ⊞ 格網
          </button>
        </div>

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
      </div>

      {/* ── Main Workspace ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Canvas Area */}
        <div className="flex-1 overflow-auto p-6 relative">

          {/* Background grid */}
          <div className="absolute inset-0 opacity-30"
            style={{ backgroundImage: "radial-gradient(circle, #2a2a4a 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

          {activeView === "flow" ? (
            <div className="relative z-10">
              {/* Pipeline labels */}
              <div className="flex items-center gap-2 mb-4">
                {["📝 分鏡描述", "→", "🖼 SeedDream 出圖", "→", "🎬 SeedDance 動畫"].map((s, i) => (
                  <span key={i} className={`text-xs ${s === "→" ? "text-[#2a2a4a]" : "bg-[#0d0d1a] border border-[#1a1a2e] px-3 py-1 rounded-full text-[#555]"}`}>
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
              />

              {/* Legend */}
              <div className="flex items-center gap-4 mt-4">
                {[
                  { color: "#2a2a4a", label: "待生成" },
                  { color: "#facc15", label: "生成中" },
                  { color: "#22c55e", label: "完成" },
                  { color: "#ef4444", label: "失敗" },
                  { color: "#6366f1", label: "已選取" },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                    <span className="text-[10px] text-[#444]">{label}</span>
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
                const statusColor = ss?.imageStatus === "completed" ? "#22c55e" : ss?.imageStatus === "generating" ? "#facc15" : ss?.imageStatus === "failed" ? "#ef4444" : "#2a2a4a";
                return (
                  <div key={scene.id} onClick={() => setSelectedIdx(isSelected ? null : idx)}
                    className="cursor-pointer rounded-xl border-2 overflow-hidden transition-all"
                    style={{ borderColor: isSelected ? "#6366f1" : statusColor, boxShadow: isSelected ? "0 0 16px rgba(99,102,241,0.3)" : "none" }}>
                    <div className="aspect-[9/16] bg-[#111122] relative">
                      {imgUrl ? (
                        <img src={imgUrl} alt={scene.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center">
                          {ss?.imageStatus === "generating" ? (
                            <><Spinner color="#facc15" /><span className="text-xs text-[#facc15] mt-2">生成中</span></>
                          ) : <span className="text-3xl">🎬</span>}
                        </div>
                      )}
                      <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-full">{scene.sceneNumber}</div>
                      {ss?.videoStatus === "completed" && <div className="absolute top-1.5 right-1.5 bg-[#a855f7]/80 text-white text-[10px] px-1.5 py-0.5 rounded-full">▶</div>}
                    </div>
                    <div className="p-2 bg-[#0d0d1a]">
                      <p className="text-[10px] text-[#666] truncate">{scene.title}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right Inspector Panel ─────────────────────────────────────────── */}
        {selectedScene ? (
          <div className="w-72 bg-[#0d0d1a] border-l border-[#1a1a2e] flex flex-col shrink-0 overflow-hidden">
            {/* Inspector header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a2e]">
              <div>
                <span className="text-xs text-[#6366f1] font-mono">SCENE {(selectedIdx ?? 0) + 1}</span>
                <p className="text-sm font-semibold text-[#ccc] mt-0.5">場景屬性</p>
              </div>
              <button onClick={() => setSelectedIdx(null)} className="text-[#444] hover:text-[#aaa] text-lg">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">

              {/* Image preview */}
              {selectedServerScene && getSceneImageUrl(selectedServerScene) && (
                <div className="rounded-xl overflow-hidden border border-[#1a1a2e]">
                  <img src={getSceneImageUrl(selectedServerScene)!} alt="scene" className="w-full object-cover" />
                </div>
              )}
              {selectedServerScene && getSceneVideoUrl(selectedServerScene) && (
                <div className="rounded-xl overflow-hidden border border-[#1a1a2e]">
                  <video src={getSceneVideoUrl(selectedServerScene)!} controls className="w-full" />
                </div>
              )}

              {/* Scene title */}
              <div>
                <label className="text-[10px] text-[#555] uppercase tracking-wide mb-1.5 block">幕名稱</label>
                <DarkInput
                  value={selectedScene.title}
                  onChange={v => updateScene(selectedIdx!, { title: v })}
                  placeholder="幕名稱"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] text-[#555] uppercase tracking-wide mb-1.5 block">場景描述</label>
                <DarkTextarea
                  value={selectedScene.description}
                  onChange={v => updateScene(selectedIdx!, { description: v })}
                  placeholder="描述場景內容，AI 將根據此生成圖片..."
                  rows={4}
                />
              </div>

              {/* Dialogue */}
              <div>
                <label className="text-[10px] text-[#555] uppercase tracking-wide mb-1.5 block">台詞（選填）</label>
                <DarkInput
                  value={selectedScene.dialogue || ""}
                  onChange={v => updateScene(selectedIdx!, { dialogue: v })}
                  placeholder="人物台詞"
                />
              </div>

              {/* Camera movement */}
              <div>
                <label className="text-[10px] text-[#555] uppercase tracking-wide mb-1.5 block">攝影機運鏡</label>
                <DarkSelect
                  value={selectedScene.cameraMovement || "none"}
                  onChange={v => updateScene(selectedIdx!, { cameraMovement: v === "none" ? "" : v })}
                  options={CAMERA_MOVEMENTS}
                />
              </div>

              {/* Character toggles */}
              {((project?.characterAUrls ?? []).length > 0 || (project?.characterBUrls ?? []).length > 0) && (
                <div>
                  <label className="text-[10px] text-[#555] uppercase tracking-wide mb-1.5 block">角色出場</label>
                  <div className="flex gap-2">
                    {(project?.characterAUrls ?? []).length > 0 && (
                      <button onClick={() => updateScene(selectedIdx!, { useCharA: !selectedScene.useCharA })}
                        className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${selectedScene.useCharA ? "bg-[#6366f1]/10 border-[#6366f1]/40 text-[#a78bfa]" : "border-[#2a2a4a] text-[#444]"}`}>
                        角色A {selectedScene.useCharA ? "✓" : "×"}
                      </button>
                    )}
                    {(project?.characterBUrls ?? []).length > 0 && (
                      <button onClick={() => updateScene(selectedIdx!, { useCharB: !selectedScene.useCharB })}
                        className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${selectedScene.useCharB ? "bg-[#f59e0b]/10 border-[#f59e0b]/40 text-[#fbbf24]" : "border-[#2a2a4a] text-[#444]"}`}>
                        角色B {selectedScene.useCharB ? "✓" : "×"}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Separator */}
              <div className="border-t border-[#1a1a2e]" />

              {/* Actions */}
              <div className="space-y-2">
                <p className="text-[10px] text-[#555] uppercase tracking-wide">動作</p>

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
                    onClick={() => setAnimateDialog({ sceneIdx: selectedIdx! })}>
                    🎬 生成動畫影片
                  </DarkButton>
                )}

                {selectedServerScene?.videoStatus === "generating" && (
                  <div className="text-xs text-center text-[#facc15] animate-pulse py-2">影片生成中...</div>
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
              <div className="border-t border-[#1a1a2e] pt-3">
                <p className="text-[10px] text-[#333] uppercase tracking-wide mb-2">連接埠</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#444] font-mono border border-[#1a1a2e] rounded px-2 py-0.5">◎ text_in</span>
                  <span className="text-[10px] text-[#6366f1] font-mono border border-[#6366f1]/20 rounded px-2 py-0.5">image_out ◉</span>
                </div>
                {selectedServerScene?.imageStatus === "completed" && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-[#444] font-mono border border-[#1a1a2e] rounded px-2 py-0.5">◎ image_in</span>
                    <span className="text-[10px] text-[#a855f7] font-mono border border-[#a855f7]/20 rounded px-2 py-0.5">video_out ◉</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* No selection placeholder */
          <div className="w-64 bg-[#0d0d1a] border-l border-[#1a1a2e] flex items-center justify-center shrink-0">
            <div className="text-center px-6">
              <p className="text-[#2a2a4a] text-3xl mb-3">←</p>
              <p className="text-xs text-[#333]">點擊場景節點<br />開啟屬性面板</p>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 h-7 bg-[#080810] border-t border-[#1a1a2e] shrink-0">
        <span className="text-[10px] text-[#333]">節點 {localScenes.length} 個 ／ 完成 {serverScenes.filter(s => s.imageStatus === "completed").length} 幕</span>
        <span className="text-[10px] text-[#333]">積分 {user?.credits ?? 0} ／ 待生成 {pendingCount} 幕</span>
        <span className={`text-[10px] ${episode.status === "generating" ? "text-[#facc15]" : "text-[#333]"}`}>
          {episode.status === "generating" ? "⟳ 執行中..." : "● 就緒"}
        </span>
      </div>

      {/* Animate Dialog */}
      <Modal open={!!animateDialog} onClose={() => setAnimateDialog(null)} title="🎬 生成動畫影片">
        {animateDialog && (
          <div className="space-y-5">
            <div>
              <label className="text-xs text-[#666] uppercase tracking-wide mb-2 block">
                影片時長：<span className="text-[#a78bfa] font-bold">{animDuration} 秒</span>
              </label>
              <input type="range" min={4} max={12} value={animDuration}
                onChange={e => setAnimDuration(Number(e.target.value))} className="w-full accent-[#6366f1]" />
              <div className="flex justify-between text-xs text-[#444] mt-1"><span>4秒</span><span>12秒</span></div>
            </div>

            <div onClick={() => setAnimUseOmni(!animUseOmni)}
              className={`flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${animUseOmni ? "border-[#6366f1] bg-[#6366f1]/5" : "border-[#1a1a2e] hover:border-[#6366f1]/30"}`}>
              <div>
                <p className="text-sm font-semibold text-[#ccc]">🌟 SeedDance 2.0 全能模式</p>
                <p className="text-xs text-[#555] mt-0.5">多圖參考，保持角色A/B一致性</p>
              </div>
              <div className={`w-10 h-6 rounded-full relative flex-shrink-0 transition-all ${animUseOmni ? "bg-[#6366f1]" : "bg-[#1a1a2e]"}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${animUseOmni ? "left-5" : "left-1"}`} />
              </div>
            </div>

            <div>
              <label className="text-xs text-[#666] uppercase tracking-wide mb-2 block">解析度</label>
              <div className="grid grid-cols-2 gap-3">
                {(["720p", "1080p"] as const).map(r => {
                  const cost = r === "1080p" ? Math.ceil(animDuration * 6.8) : Math.ceil(animDuration * 3.4);
                  return (
                    <button key={r} onClick={() => setAnimResolution(r)}
                      className={`p-3 rounded-xl border-2 text-sm transition-all ${animResolution === r ? "border-[#6366f1] bg-[#6366f1]/10 text-[#a78bfa]" : "border-[#1a1a2e] text-[#555] hover:border-[#6366f1]/40"}`}>
                      <div className="font-bold">{r}</div>
                      <div className="text-xs text-[#444]">{cost} 積分</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="bg-[#111122] rounded-lg p-3 text-sm text-[#666]">
              消耗 <span className="font-bold text-[#a78bfa]">
                {animResolution === "1080p" ? Math.ceil(animDuration * 6.8) : Math.ceil(animDuration * 3.4)} 積分
              </span>
              （現有 {user?.credits ?? 0} 積分）
            </div>

            <DarkButton
              onClick={() => animateSceneMutation.mutate({
                sceneIdx: animateDialog.sceneIdx, duration: animDuration,
                resolution: animResolution, useOmniMode: animUseOmni,
              })}
              disabled={animateSceneMutation.isPending || (user?.credits ?? 0) < (animResolution === "1080p" ? Math.ceil(animDuration * 6.8) : Math.ceil(animDuration * 3.4))}
              className="w-full justify-center"
              style={{ background: "#7c3aed" }}
            >
              {animateSceneMutation.isPending ? "生成中..." : "🎬 開始生成影片"}
            </DarkButton>
          </div>
        )}
      </Modal>

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
    <div className="min-h-screen bg-[#0a0a14] flex flex-col">
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

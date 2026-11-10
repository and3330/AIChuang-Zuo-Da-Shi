import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/App";
import { NavigationHeader } from "./account";
import { LIBRARIES, type LibraryId } from "@shared/libraryCatalog";

// 素材圖庫瀏覽：姿勢／服裝／人像。
// 圖片由後台批次生成並存在 CDN；這一頁只負責瀏覽、搜尋與複製描述。
// 管理員可以切換顯示還沒有圖的項目，並對單張按「重生」。

type Asset = {
  id: string; library: LibraryId; category: string; name: string; adult: boolean; usage: string; tags: string[] | null;
  imageUrl: string | null; thumbUrl: string | null; width: number | null; height: number | null; status: string; error: string | null;
};
type ListResponse = { items: Asset[]; total: number; page: number; pageSize: number; categories: { category: string; adult: boolean; n: number }[] };

const PAGE_SIZE = 60;

export default function LibraryPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isAdmin = !!user?.isAdmin;
  const [library, setLibrary] = useState<LibraryId>("pose");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [showUnready, setShowUnready] = useState(false);
  const [preview, setPreview] = useState<Asset | null>(null);

  // Debounce typing so every keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ library, page: String(page), pageSize: String(PAGE_SIZE) });
  if (category) params.set("category", category);
  if (query) params.set("q", query);
  if (isAdmin && showUnready) params.set("includeUnready", "1");
  const listKey = `/api/library/assets?${params.toString()}`;

  const { data, isLoading, error } = useQuery<ListResponse>({ queryKey: [listKey] });

  const requeueMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", "/api/admin/library/requeue", { ids: [id] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [listKey] });
      toast({ title: "已排入重生", description: "到後台的「素材圖庫」按開始生成，就會重畫這一張。" });
    },
    onError: () => toast({ title: "操作失敗", variant: "destructive" }),
  });

  const switchLibrary = (id: LibraryId) => { setLibrary(id); setCategory(""); setPage(1); };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: "已複製描述" }); }
    catch { toast({ title: "無法自動複製", description: "請手動選取文字。", variant: "destructive" }); }
  };

  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const active = LIBRARIES.find(l => l.id === library)!;
  const aspect = library === "portrait" ? "1 / 1" : "2 / 3";

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-24">
      <NavigationHeader />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div>
            <h1 className="text-2xl font-bold text-[#0f172a]">🗂 素材圖庫</h1>
            <p className="text-sm text-[#64748b] mt-1">瀏覽姿勢、服裝與人像參考。點圖可放大並複製描述，貼到寫真套圖的鏡頭或風格方向裡使用。</p>
          </div>
          <Link href="/photoset"><span className="px-4 py-2 rounded-lg bg-[#6366f1] text-white text-sm font-medium hover:bg-[#4f46e5] cursor-pointer whitespace-nowrap">前往寫真套圖 →</span></Link>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {LIBRARIES.map(l => (
            <button key={l.id} onClick={() => switchLibrary(l.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${library === l.id ? "bg-[#0f172a] text-white border-[#0f172a]" : "bg-white text-[#475569] border-[#e2e8f0] hover:border-[#6366f1]/50"}`}
              data-testid={`tab-library-${l.id}`}>
              {l.label}
            </button>
          ))}
        </div>

        <div className="bg-white border border-[#e2e8f0] rounded-2xl p-4 mb-5 space-y-3">
          <p className="text-xs text-[#64748b]">{active.hint}</p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { setCategory(""); setPage(1); }}
              className={`px-3 py-1 rounded-full text-xs border ${category === "" ? "bg-[#6366f1] text-white border-[#6366f1]" : "bg-white text-[#475569] border-[#e2e8f0]"}`}>
              全部
            </button>
            {(data?.categories ?? []).map(c => (
              <button key={c.category} onClick={() => { setCategory(c.category); setPage(1); }}
                className={`px-3 py-1 rounded-full text-xs border ${category === c.category ? "bg-[#6366f1] text-white border-[#6366f1]" : "bg-white text-[#475569] border-[#e2e8f0]"}`}>
                {c.category} <span className="opacity-70">{c.n}</span>{c.adult && <span className="ml-1 opacity-70">成人向</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-3 items-center flex-wrap">
            <input value={search} onChange={e => setSearch(e.target.value.slice(0, 60))} placeholder="搜尋名稱或標籤，例如：坐姿、風衣、短髮"
              className="flex-1 min-w-[200px] px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#6366f1] focus:border-transparent" data-testid="input-library-search" />
            {isAdmin && (
              <label className="flex items-center gap-2 text-xs text-[#475569] cursor-pointer">
                <input type="checkbox" checked={showUnready} onChange={e => { setShowUnready(e.target.checked); setPage(1); }} className="accent-[#6366f1]" />
                顯示尚未生成的項目（管理員）
              </label>
            )}
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-[#94a3b8] text-center py-16">載入中…</p>
        ) : error ? (
          <p className="text-sm text-[#ef4444] text-center py-16">圖庫讀取失敗，請稍後再試。</p>
        ) : items.length === 0 ? (
          <div className="bg-white border border-[#e2e8f0] rounded-2xl p-12 text-center text-[#94a3b8]">
            <i className="fas fa-images text-3xl mb-3" />
            <p className="text-sm">{query || category ? "沒有符合條件的素材。" : "這個圖庫還沒有圖片。"}</p>
            {isAdmin && !query && !category && (
              <p className="text-xs mt-2">請到 <Link href="/admin"><span className="text-[#6366f1] underline cursor-pointer">後台 → 素材圖庫</span></Link> 同步清單並開始生成。</p>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-[#94a3b8] mb-2">共 {data!.total} 筆</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {items.map(a => (
                <button key={a.id} onClick={() => setPreview(a)} className="text-left bg-white border border-[#e2e8f0] rounded-xl overflow-hidden hover:border-[#6366f1] transition-colors" data-testid={`card-asset-${a.id}`}>
                  <div className="bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%),linear-gradient(-45deg,#f1f5f9_25%,transparent_25%)] bg-[length:16px_16px] bg-[#f8fafc] flex items-center justify-center" style={{ aspectRatio: aspect }}>
                    {a.thumbUrl || a.imageUrl ? (
                      <img src={a.thumbUrl || a.imageUrl || ""} alt={a.name} loading="lazy" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-[11px] text-[#94a3b8] px-2 text-center">{a.status === "failed" ? `生成失敗：${a.error ?? ""}` : a.status === "generating" ? "生成中…" : "尚未生成"}</span>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-medium text-[#0f172a] truncate">{a.name}</div>
                    <div className="text-[10px] text-[#94a3b8]">{a.category}{a.adult ? "・成人向" : ""}</div>
                  </div>
                </button>
              ))}
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-[#e2e8f0] text-sm disabled:opacity-40">上一頁</button>
                <span className="text-sm text-[#475569]">{page} / {pages}</span>
                <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} className="px-3 py-1.5 rounded-lg border border-[#e2e8f0] text-sm disabled:opacity-40">下一頁</button>
              </div>
            )}
          </>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-auto grid md:grid-cols-2" onClick={e => e.stopPropagation()}>
            <div className="bg-[#f1f5f9] flex items-center justify-center min-h-[240px]">
              {preview.imageUrl
                ? <img src={preview.imageUrl} alt={preview.name} className="max-w-full max-h-[80vh] object-contain" />
                : <span className="text-sm text-[#94a3b8]">尚未生成</span>}
            </div>
            <div className="p-5 space-y-3">
              <div>
                <h2 className="text-lg font-bold text-[#0f172a]">{preview.name}</h2>
                <p className="text-xs text-[#94a3b8]">{LIBRARIES.find(l => l.id === preview.library)?.label}・{preview.category}{preview.adult ? "・成人向" : ""}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#475569] mb-1">描述（可貼到鏡頭或風格方向）</p>
                <p className="text-sm text-[#334155] leading-relaxed bg-[#f8fafc] border border-[#e2e8f0] rounded-lg p-3">{preview.usage}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => copy(preview.usage)} className="px-3 py-2 rounded-lg bg-[#0f172a] text-white text-sm hover:bg-[#1e293b]" data-testid="button-asset-copy">複製描述</button>
                {preview.imageUrl && (
                  <a href={preview.imageUrl} target="_blank" rel="noreferrer" download className="px-3 py-2 rounded-lg border border-[#e2e8f0] text-sm text-[#475569] hover:border-[#6366f1]">下載圖片</a>
                )}
                {isAdmin && (
                  <button onClick={() => { requeueMutation.mutate(preview.id); setPreview(null); }} disabled={requeueMutation.isPending}
                    className="px-3 py-2 rounded-lg border border-[#e2e8f0] text-sm text-[#475569] hover:border-[#6366f1] disabled:opacity-50">
                    排入重生
                  </button>
                )}
                <button onClick={() => setPreview(null)} className="px-3 py-2 rounded-lg text-sm text-[#94a3b8] hover:text-[#475569]">關閉</button>
              </div>
              {preview.library === "pose" && preview.imageUrl && (
                <p className="text-[11px] text-[#94a3b8]">想讓生成的圖精準照這個姿勢：下載這張圖，到寫真套圖的鏡頭按「附上姿勢參考圖」上傳即可。</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

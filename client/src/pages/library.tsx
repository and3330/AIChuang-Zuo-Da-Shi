import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "./account";
import { LIBRARIES, type LibraryId } from "@shared/libraryCatalog";
import { RECIPE_SLOTS, loadRecipe, recipeCount, recipeText, saveRecipe, type Recipe, type RecipeItem } from "@/lib/recipe";

// 素材圖庫瀏覽：姿勢／服裝／人像。
//
// 分組檢視（預設）：一個姿勢／一套穿搭／一種髮型一張卡片，卡片下方可切換
//                   視角、布料細節或表情臉型。
// 單張檢視：每一張圖各自一張卡片。
//
// 「加入配方」把選中的人像、服裝、姿勢放進底部的配方槽，再帶到寫真套圖使用。
// 圖片由後台批次生成並存在 CDN；管理員可顯示尚未生成的項目並排入重生。

type Variant = { id: string; label: string; usage: string; imageUrl: string | null; thumbUrl: string | null; status: string; error: string | null };
type Group = { key: string; title: string; category: string; adult: boolean; variants: Variant[] };
type Category = { category: string; adult: boolean; n: number };
type GroupResponse = { groups: Group[]; total: number; page: number; pageSize: number; categories: Category[]; variantOptions: string[] };
type Asset = {
  id: string; library: LibraryId; category: string; name: string; adult: boolean; usage: string;
  imageUrl: string | null; thumbUrl: string | null; status: string; error: string | null;
};
type ListResponse = { items: Asset[]; total: number; page: number; pageSize: number; categories: Category[] };
type Preview = { id: string; name: string; category: string; adult: boolean; usage: string; imageUrl: string | null; thumbUrl: string | null; library: LibraryId };

const GROUP_PAGE = 30;
const SINGLE_PAGE = 60;
const CHECKER = "bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%),linear-gradient(-45deg,#f1f5f9_25%,transparent_25%)] bg-[length:16px_16px] bg-[#f8fafc]";

function statusText(status: string, error: string | null): string {
  return status === "failed" ? `生成失敗${error ? "：" + error : ""}` : status === "generating" ? "生成中…" : "尚未生成";
}

export default function LibraryPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const isAdmin = !!user?.isAdmin;

  // /library?tab=portrait|costume|pose opens that tab (links from the hub).
  const [library, setLibrary] = useState<LibraryId>(() => {
    const tab = new URLSearchParams(window.location.search).get("tab");
    return LIBRARIES.some(l => l.id === tab) ? tab as LibraryId : "portrait";
  });
  const [layout, setLayout] = useState<"group" | "single">("group");
  const [category, setCategory] = useState("");
  const [variant, setVariant] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [showUnready, setShowUnready] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  /** Which variant each group card is showing (group key → variant id). */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [recipe, setRecipe] = useState<Recipe>(() => loadRecipe());

  // Debounce typing so every keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ library, page: String(page), pageSize: String(layout === "group" ? GROUP_PAGE : SINGLE_PAGE) });
  if (category) params.set("category", category);
  if (query) params.set("q", query);
  if (isAdmin && showUnready) params.set("includeUnready", "1");
  if (layout === "group" && variant) params.set("variant", variant);
  const listKey = `/api/library/${layout === "group" ? "groups" : "assets"}?${params.toString()}`;

  const { data, isLoading, error } = useQuery<GroupResponse | ListResponse>({ queryKey: [listKey] });
  const groupData = layout === "group" ? (data as GroupResponse | undefined) : undefined;
  const listData = layout === "single" ? (data as ListResponse | undefined) : undefined;

  const requeueMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", "/api/admin/library/requeue", { ids: [id] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [listKey] });
      toast({ title: "已排入重生", description: "到後台的「素材圖庫」按開始生成，就會重畫這一張。" });
    },
    onError: () => toast({ title: "操作失敗", variant: "destructive" }),
  });

  const switchLibrary = (id: LibraryId) => { setLibrary(id); setCategory(""); setVariant(""); setPage(1); };
  const switchLayout = (l: "group" | "single") => { setLayout(l); setPage(1); };

  const updateRecipe = (next: Recipe) => { setRecipe(next); saveRecipe(next); };
  const addToRecipe = (slot: LibraryId, item: RecipeItem) => {
    if (!item.imageUrl) { toast({ title: "這個素材還沒有圖片", description: "生成完成後才能加入配方。", variant: "destructive" }); return; }
    updateRecipe({ ...recipe, [slot]: item });
    toast({ title: `已加入配方：${RECIPE_SLOTS.find(s => s.id === slot)?.label}`, description: item.name });
  };
  const removeFromRecipe = (slot: LibraryId) => { const next = { ...recipe }; delete next[slot]; updateRecipe(next); };

  const copy = async (text: string, what = "描述") => {
    try { await navigator.clipboard.writeText(text); toast({ title: `已複製${what}` }); }
    catch { toast({ title: "無法自動複製", description: "請手動選取文字。", variant: "destructive" }); }
  };

  const total = data?.total ?? 0;
  const pageSize = layout === "group" ? GROUP_PAGE : SINGLE_PAGE;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const active = LIBRARIES.find(l => l.id === library)!;
  const aspect = library === "portrait" ? "1 / 1" : "2 / 3";
  const isEmpty = !isLoading && !error && (layout === "group" ? (groupData?.groups.length ?? 0) === 0 : (listData?.items.length ?? 0) === 0);
  const inRecipe = (id: string) => recipe[library]?.id === id;
  const count = recipeCount(recipe);
  const chip = (on: boolean) => `px-3 py-1 rounded-full text-xs border ${on ? "bg-[#6366f1] text-white border-[#6366f1]" : "bg-white text-[#475569] border-[#e2e8f0] hover:border-[#6366f1]/50"}`;

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-40">
      <NavigationHeader />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
          <div>
            <h1 className="hidden md:block text-2xl font-bold text-[#0f172a]">素材圖庫</h1>
            <p className="text-sm text-[#64748b] mt-1">挑一張人像、一套服裝、一個姿勢，按「生成寫真」就會帶進寫真工作室。點圖可以放大。</p>
          </div>
          <div className="flex rounded-lg border border-[#e2e8f0] overflow-hidden bg-white">
            {(["group", "single"] as const).map(l => (
              <button key={l} onClick={() => switchLayout(l)}
                className={`px-4 py-2 text-sm font-medium ${layout === l ? "bg-[#0f172a] text-white" : "text-[#475569] hover:bg-[#f1f5f9]"}`}
                data-testid={`button-layout-${l}`}>
                {l === "group" ? "分組" : "單張"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {LIBRARIES.map(l => (
            <button key={l.id} onClick={() => switchLibrary(l.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${library === l.id ? "bg-[#0f172a] text-white border-[#0f172a]" : "bg-white text-[#475569] border-[#e2e8f0] hover:border-[#6366f1]/50"}`}
              data-testid={`tab-library-${l.id}`}>
              {l.label}{recipe[l.id] ? " ✓" : ""}
            </button>
          ))}
        </div>

        <div className="bg-white border border-[#e2e8f0] rounded-2xl p-4 mb-5 space-y-3">
          <p className="text-xs text-[#64748b]">{active.hint}</p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { setCategory(""); setPage(1); }} className={chip(category === "")}>全部</button>
            {(data?.categories ?? []).map(c => (
              <button key={c.category} onClick={() => { setCategory(c.category); setPage(1); }} className={chip(category === c.category)}>
                {c.category} <span className="opacity-70">{c.n}</span>{c.adult && <span className="ml-1 opacity-70">成人向</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-3 items-center flex-wrap">
            <input value={search} onChange={e => setSearch(e.target.value.slice(0, 60))} placeholder="搜尋名稱或標籤，例如：坐姿、風衣、短髮"
              className="flex-1 min-w-[200px] px-3 py-2 border border-[#e2e8f0] rounded-lg text-sm focus:ring-2 focus:ring-[#6366f1] focus:border-transparent" data-testid="input-library-search" />
            {layout === "group" && (groupData?.variantOptions.length ?? 0) > 0 && (
              <div className="flex gap-1 flex-wrap" data-testid="filter-variant">
                <button onClick={() => { setVariant(""); setPage(1); }} className={chip(variant === "")}>全部視角</button>
                {groupData!.variantOptions.map(v => (
                  <button key={v} onClick={() => { setVariant(v); setPage(1); }} className={chip(variant === v)}>{v}</button>
                ))}
              </div>
            )}
            {(category || variant || search) && (
              <button onClick={() => { setCategory(""); setVariant(""); setSearch(""); setPage(1); }} className="text-xs text-[#94a3b8] hover:text-[#475569]">↺ 重置</button>
            )}
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
        ) : isEmpty ? (
          <div className="bg-white border border-[#e2e8f0] rounded-2xl p-12 text-center text-[#94a3b8]">
            <i className="fas fa-images text-3xl mb-3" />
            <p className="text-sm">{query || category || variant ? "沒有符合條件的素材。" : "這個圖庫還沒有圖片。"}</p>
            {isAdmin && !query && !category && !variant && (
              <p className="text-xs mt-2">請到 <Link href="/admin"><span className="text-[#6366f1] underline cursor-pointer">後台 → 素材圖庫</span></Link> 同步清單並開始生成。</p>
            )}
          </div>
        ) : (
          <>
            <p className="text-xs text-[#94a3b8] mb-2">共 {total} {layout === "group" ? "組" : "張"}</p>

            {layout === "group" && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {groupData!.groups.map(g => {
                  const current = g.variants.find(v => v.id === picked[g.key]) ?? g.variants.find(v => !!v.imageUrl) ?? g.variants[0];
                  const fullName = `${g.title}・${current.label}`;
                  const item: RecipeItem = { id: current.id, name: fullName, usage: current.usage, imageUrl: current.imageUrl, thumbUrl: current.thumbUrl };
                  return (
                    <div key={g.key} className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden flex flex-col" data-testid={`card-group-${g.key}`}>
                      <div className={`relative ${CHECKER} flex items-center justify-center`} style={{ aspectRatio: aspect }}>
                        {current.thumbUrl || current.imageUrl ? (
                          <img src={current.thumbUrl || current.imageUrl || ""} alt={fullName} loading="lazy" className="w-full h-full object-contain cursor-zoom-in"
                            onClick={() => setPreview({ ...item, category: g.category, adult: g.adult, library })} />
                        ) : (
                          <span className="text-[11px] text-[#94a3b8] px-2 text-center">{statusText(current.status, current.error)}</span>
                        )}
                        <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-white/90 text-[10px] font-medium text-[#0f172a]">{current.label}</span>
                        {current.imageUrl && (
                          <button onClick={() => addToRecipe(library, item)}
                            className={`absolute bottom-2 left-2 px-2.5 py-1 rounded-full text-[11px] font-medium ${inRecipe(current.id) ? "bg-[#6366f1] text-white" : "bg-black/70 text-white hover:bg-black/85"}`}
                            data-testid={`button-recipe-${current.id}`}>
                            {inRecipe(current.id) ? "✓ 已在配方" : "＋ 加入配方"}
                          </button>
                        )}
                      </div>
                      <div className="p-2.5 flex-1 flex flex-col gap-2">
                        <div>
                          <div className="text-xs font-semibold text-[#0f172a] truncate" title={g.title}>{g.title}</div>
                          <div className="text-[10px] text-[#94a3b8]">{g.category}{g.adult ? "・成人向" : ""}</div>
                        </div>
                        {g.variants.length > 1 && (
                          <div className="flex gap-1 overflow-x-auto pb-1">
                            {g.variants.map(v => (
                              <button key={v.id} onClick={() => setPicked(p => ({ ...p, [g.key]: v.id }))} title={v.label}
                                className={`shrink-0 w-11 rounded-md border overflow-hidden ${v.id === current.id ? "border-[#0f172a]" : "border-[#e2e8f0] hover:border-[#6366f1]/60"}`}>
                                <div className="h-11 bg-[#f8fafc] flex items-center justify-center">
                                  {v.thumbUrl || v.imageUrl
                                    ? <img src={v.thumbUrl || v.imageUrl || ""} alt={v.label} loading="lazy" className="w-full h-full object-contain" />
                                    : <span className="text-[9px] text-[#cbd5e1]">—</span>}
                                </div>
                                <div className="text-[9px] text-center text-[#64748b] truncate px-0.5">{v.label}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {layout === "single" && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {listData!.items.map(a => {
                  const item: RecipeItem = { id: a.id, name: a.name, usage: a.usage, imageUrl: a.imageUrl, thumbUrl: a.thumbUrl };
                  return (
                    <div key={a.id} className="bg-white border border-[#e2e8f0] rounded-xl overflow-hidden" data-testid={`card-asset-${a.id}`}>
                      <div className={`relative ${CHECKER} flex items-center justify-center`} style={{ aspectRatio: aspect }}>
                        {a.thumbUrl || a.imageUrl ? (
                          <img src={a.thumbUrl || a.imageUrl || ""} alt={a.name} loading="lazy" className="w-full h-full object-contain cursor-zoom-in"
                            onClick={() => setPreview({ ...item, category: a.category, adult: a.adult, library })} />
                        ) : (
                          <span className="text-[11px] text-[#94a3b8] px-2 text-center">{statusText(a.status, a.error)}</span>
                        )}
                        {a.imageUrl && (
                          <button onClick={() => addToRecipe(library, item)}
                            className={`absolute bottom-2 left-2 px-2.5 py-1 rounded-full text-[11px] font-medium ${inRecipe(a.id) ? "bg-[#6366f1] text-white" : "bg-black/70 text-white hover:bg-black/85"}`}>
                            {inRecipe(a.id) ? "✓ 已在配方" : "＋ 加入配方"}
                          </button>
                        )}
                      </div>
                      <div className="p-2">
                        <div className="text-xs font-medium text-[#0f172a] truncate" title={a.name}>{a.name}</div>
                        <div className="text-[10px] text-[#94a3b8]">{a.category}{a.adult ? "・成人向" : ""}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-[#e2e8f0] bg-white text-sm disabled:opacity-40">上一頁</button>
                <span className="text-sm text-[#475569]">{page} / {pages}</span>
                <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} className="px-3 py-1.5 rounded-lg border border-[#e2e8f0] bg-white text-sm disabled:opacity-40">下一頁</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 配方槽 ─────────────────────────────────────────── */}
      <div className="fixed bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-4 inset-x-0 z-30 pl-3 pr-16 md:px-24 pointer-events-none">
        <div className="max-w-4xl mx-auto bg-white border border-[#e2e8f0] shadow-lg rounded-2xl p-2.5 flex items-center gap-2 flex-wrap pointer-events-auto" data-testid="bar-recipe">
          {RECIPE_SLOTS.map(slot => {
            const it = recipe[slot.id];
            return (
              <div key={slot.id} className={`flex items-center gap-2 flex-1 min-w-[96px] sm:min-w-[150px] rounded-xl border px-2 py-1.5 ${it ? "border-[#6366f1]/40 bg-[#6366f1]/5" : "border-dashed border-[#cbd5e1]"}`}>
                {it ? (
                  <>
                    <img src={it.thumbUrl || it.imageUrl || ""} alt={it.name} className="w-9 h-9 rounded-md object-contain bg-[#f8fafc] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-[#6366f1]">{slot.label}</div>
                      <div className="text-xs text-[#0f172a] truncate" title={it.name}>{it.name}</div>
                    </div>
                    <button onClick={() => removeFromRecipe(slot.id)} className="text-[#94a3b8] hover:text-[#ef4444] px-1" title="移除">×</button>
                  </>
                ) : (
                  <button onClick={() => switchLibrary(slot.id)} className="text-left flex-1">
                    <div className="text-xs text-[#475569]">＋ {slot.label}</div>
                    <div className="text-[10px] text-[#94a3b8]">{slot.emptyHint}</div>
                  </button>
                )}
              </div>
            );
          })}
          <div className="flex items-center gap-1.5">
            <button onClick={() => copy(recipeText(recipe), "配方描述")} disabled={count === 0}
              className="px-3 py-2 rounded-lg border border-[#e2e8f0] text-xs text-[#475569] hover:border-[#6366f1] disabled:opacity-40" data-testid="button-recipe-copy">複製詞</button>
            <button onClick={() => updateRecipe({})} disabled={count === 0}
              className="px-2 py-2 rounded-lg border border-[#e2e8f0] text-xs text-[#94a3b8] hover:text-[#ef4444] disabled:opacity-40" title="清空配方">清空</button>
            <button onClick={() => navigate("/photoset?recipe=1")} disabled={count === 0}
              className="px-4 py-2 rounded-lg bg-[#6366f1] text-white text-xs font-semibold disabled:opacity-40" data-testid="button-recipe-use">
              <i className="fas fa-bolt mr-1.5" />生成寫真（{count}/3）
            </button>
          </div>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-auto grid md:grid-cols-2" onClick={e => e.stopPropagation()}>
            <div className={`${CHECKER} flex items-center justify-center min-h-[240px]`}>
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
                <p className="text-xs font-semibold text-[#475569] mb-1">描述</p>
                <p className="text-sm text-[#334155] leading-relaxed bg-[#f8fafc] border border-[#e2e8f0] rounded-lg p-3">{preview.usage}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => { addToRecipe(preview.library, preview); setPreview(null); }} disabled={!preview.imageUrl}
                  className="px-3 py-2 rounded-lg bg-[#6366f1] text-white text-sm hover:bg-[#4f46e5] disabled:opacity-40">＋ 加入配方</button>
                <button onClick={() => copy(preview.usage)} className="px-3 py-2 rounded-lg border border-[#e2e8f0] text-sm text-[#475569] hover:border-[#6366f1]" data-testid="button-asset-copy">複製描述</button>
                {preview.imageUrl && (
                  <a href={preview.imageUrl} target="_blank" rel="noreferrer" download className="px-3 py-2 rounded-lg border border-[#e2e8f0] text-sm text-[#475569] hover:border-[#6366f1]">下載圖片</a>
                )}
                {isAdmin && (
                  <button onClick={() => { requeueMutation.mutate(preview.id); setPreview(null); }} disabled={requeueMutation.isPending}
                    className="px-3 py-2 rounded-lg border border-[#e2e8f0] text-sm text-[#475569] hover:border-[#6366f1] disabled:opacity-50">排入重生</button>
                )}
                <button onClick={() => setPreview(null)} className="px-3 py-2 rounded-lg text-sm text-[#94a3b8] hover:text-[#475569]">關閉</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

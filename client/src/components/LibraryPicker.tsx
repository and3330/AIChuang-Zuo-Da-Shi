import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LIBRARIES, type LibraryId } from "@shared/libraryCatalog";
import type { RecipeItem } from "@/lib/recipe";

// 素材圖庫選擇器：在寫真工作室裡直接挑人像、服裝或姿勢，不用離開頁面。
// 資料與 /library 頁面是同一份（/api/library/groups）。
// max = 1 時點一下就選好並關閉；max > 1 時可多選，按「確認」送出。

type Variant = { id: string; label: string; usage: string; imageUrl: string | null; thumbUrl: string | null };
type Group = { key: string; title: string; category: string; adult: boolean; variants: Variant[] };
type Category = { category: string; adult: boolean; n: number };
type GroupResponse = { groups: Group[]; total: number; page: number; pageSize: number; categories: Category[] };

const PAGE_SIZE = 24;

export function LibraryPicker({ library, max = 1, initial = [], onConfirm, onClose }: {
  library: LibraryId;
  max?: number;
  initial?: RecipeItem[];
  onConfirm: (items: RecipeItem[]) => void;
  onClose: () => void;
}) {
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<RecipeItem[]>(initial);
  const multi = max > 1;
  const label = LIBRARIES.find(l => l.id === library)?.label ?? "素材";

  useEffect(() => {
    const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ library, page: String(page), pageSize: String(PAGE_SIZE) });
  if (category) params.set("category", category);
  if (query) params.set("q", query);
  const { data, isLoading, error } = useQuery<GroupResponse>({ queryKey: [`/api/library/groups?${params.toString()}`] });
  const groups = data?.groups ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const toggle = (item: RecipeItem) => {
    if (!item.imageUrl) return;
    if (!multi) { onConfirm([item]); return; }
    setPicked(prev => prev.some(p => p.id === item.id)
      ? prev.filter(p => p.id !== item.id)
      : prev.length >= max ? prev : [...prev, item]);
  };
  const chip = (on: boolean) => `shrink-0 px-3 h-8 rounded-full text-xs border whitespace-nowrap ${on ? "bg-indigo-600 text-white border-transparent" : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"}`;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-end md:items-center justify-center md:p-6" onClick={onClose}>
      <div className="bg-white w-full md:max-w-4xl h-[88vh] md:h-[82vh] rounded-t-3xl md:rounded-3xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()} data-testid={`library-picker-${library}`}>
        <div className="px-4 pt-4 pb-3 border-b border-slate-100 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">從素材圖庫選{label}</h3>
              <p className="text-xs text-slate-500">{multi ? `最多選 ${max} 個，每個${label}會各出一張。` : "點一下圖片就選好。"}</p>
            </div>
            <button onClick={onClose} className="w-9 h-9 rounded-full text-slate-400 hover:bg-slate-100" aria-label="關閉"><i className="fas fa-xmark" /></button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value.slice(0, 60))} placeholder="搜尋名稱或標籤，例如：坐姿、風衣、短髮"
            className="w-full h-10 px-3 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent" data-testid="input-picker-search" />
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
            <button onClick={() => { setCategory(""); setPage(1); }} className={chip(category === "")}>全部</button>
            {(data?.categories ?? []).map(c => (
              <button key={c.category} onClick={() => { setCategory(c.category); setPage(1); }} className={chip(category === c.category)}>
                {c.category} <span className="opacity-70 ml-1">{c.n}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-16">載入中…</p>
          ) : error ? (
            <p className="text-sm text-red-500 text-center py-16">圖庫讀取失敗，請稍後再試。</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-16">{query || category ? "沒有符合條件的素材。" : "這個圖庫還沒有圖片。"}</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
              {groups.map(g => {
                const cur = g.variants.find(v => v.id === shown[g.key]) ?? g.variants.find(v => !!v.imageUrl) ?? g.variants[0];
                const item: RecipeItem = { id: cur.id, name: `${g.title}・${cur.label}`, usage: cur.usage, imageUrl: cur.imageUrl, thumbUrl: cur.thumbUrl };
                const order = picked.findIndex(p => p.id === cur.id);
                const full = multi && order < 0 && picked.length >= max;
                return (
                  <div key={g.key} className="min-w-0">
                    <button onClick={() => toggle(item)} disabled={!cur.imageUrl || full}
                      className={`relative block w-full rounded-xl overflow-hidden border-2 bg-slate-50 disabled:opacity-40 ${order >= 0 ? "border-indigo-500 shadow-glow" : "border-transparent hover:border-indigo-300"}`}
                      style={{ aspectRatio: library === "portrait" ? "1 / 1" : "2 / 3" }} data-testid={`picker-item-${cur.id}`}>
                      {cur.thumbUrl || cur.imageUrl
                        ? <img src={cur.thumbUrl || cur.imageUrl || ""} alt={item.name} loading="lazy" className="w-full h-full object-contain" />
                        : <span className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-400">尚未生成</span>}
                      {order >= 0 && (
                        <span className="absolute top-1.5 right-1.5 min-w-6 h-6 px-1 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
                          {multi ? order + 1 : <i className="fas fa-check text-[10px]" />}
                        </span>
                      )}
                    </button>
                    <p className="text-[11px] font-medium text-slate-800 truncate mt-1" title={g.title}>{g.title}</p>
                    {g.variants.length > 1 && (
                      <div className="flex gap-1 overflow-x-auto pb-0.5">
                        {g.variants.map(v => (
                          <button key={v.id} onClick={() => setShown(s => ({ ...s, [g.key]: v.id }))}
                            className={`shrink-0 px-1.5 h-5 rounded text-[10px] ${v.id === cur.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>{v.label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-5">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 h-9 rounded-lg border border-slate-200 text-sm disabled:opacity-40">上一頁</button>
              <span className="text-sm text-slate-600">{page} / {pages}</span>
              <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} className="px-3 h-9 rounded-lg border border-slate-200 text-sm disabled:opacity-40">下一頁</button>
            </div>
          )}
        </div>

        {multi && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
            <span className="text-sm text-slate-600 flex-1">已選 <b className="text-indigo-700">{picked.length}</b>／{max}</span>
            <button onClick={() => setPicked([])} disabled={picked.length === 0} className="px-3 h-10 rounded-xl text-sm text-slate-500 disabled:opacity-40">清除</button>
            <button onClick={() => onConfirm(picked)} className="px-6 h-10 rounded-xl bg-indigo-600 text-white text-sm font-semibold" data-testid="button-picker-confirm">確認</button>
          </div>
        )}
      </div>
    </div>
  );
}

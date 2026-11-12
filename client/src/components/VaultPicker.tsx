import { tr } from "@/lib/i18n";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SensitiveGate } from "@/components/SensitiveGate";

// 從作品庫選一張圖：任何需要上傳圖片的地方都可以改成直接拿自己做過的作品。
// onPick 拿到的是作品的永久網址（CDN），可以直接當參考圖送去生成。

type VaultItem = { id: string; kind: "image" | "video"; url: string; sensitive?: boolean };
type VaultResponse = { items: VaultItem[]; total: number };
const PAGE_SIZE = 48;

export function VaultPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery<VaultResponse>({ queryKey: [`/api/vault?kind=image&page=${page}&pageSize=${PAGE_SIZE}`] });
  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/60 flex items-end md:items-center justify-center md:p-6" onClick={onClose}>
      <div className="bg-white w-full md:max-w-3xl h-[85vh] md:h-[78vh] rounded-t-3xl md:rounded-3xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()} data-testid="vault-picker">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">{tr("從作品選一張")}</h3>
            <p className="text-xs text-slate-500">{tr("點一下圖片就選好。")}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full text-slate-400 hover:bg-slate-100" aria-label={tr("關閉")}><i className="fas fa-xmark" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-16">{tr("載入中…")}</p>
          ) : error ? (
            <p className="text-sm text-red-500 text-center py-16">{tr("作品讀取失敗，請稍後再試。")}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-16">{tr("你還沒有圖片作品。先生成幾張，之後就能從這裡選。")}</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5">
              {items.map(it => (
                <button key={it.id} onClick={() => onPick(it.url)} className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 border-2 border-transparent hover:border-indigo-400" data-testid={`vault-pick-${it.id}`}>
                  <SensitiveGate on={it.sensitive} compact><img src={it.url} alt="" loading="lazy" className="w-full h-full object-cover" /></SensitiveGate>
                </button>
              ))}
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 h-9 rounded-lg border border-slate-200 text-sm disabled:opacity-40">{tr("上一頁")}</button>
              <span className="text-sm text-slate-600">{page} / {pages}</span>
              <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} className="px-3 h-9 rounded-lg border border-slate-200 text-sm disabled:opacity-40">{tr("下一頁")}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

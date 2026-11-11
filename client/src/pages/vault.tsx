import { SensitiveGate } from "@/components/SensitiveGate";
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { NavigationHeader } from "@/components/AppNav";

// 作品庫：所有完成的圖片與影片集中在這裡，不管是哪個功能做出來的。
// 從這裡可以放大、下載、複製提示詞，或把圖片送到編輯器繼續修改。

type VaultItem = {
  id: string; kind: "image" | "video"; url: string; prompt: string;
  source: "image" | "edit" | "photoset" | "video"; generationId: string; createdAt: string | null; sensitive?: boolean;
};
type VaultResponse = { items: VaultItem[]; total: number; counts: { image: number; video: number }; page: number; pageSize: number };

const PAGE_SIZE = 60;
const SOURCE_LABEL: Record<VaultItem["source"], string> = { image: "文字生圖", edit: "圖片編輯", photoset: "寫真套圖", video: "影片" };

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

export default function VaultPage() {
  const { toast } = useToast();
  const [kind, setKind] = useState<"all" | "image" | "video">("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<VaultItem | null>(null);

  const { data, isLoading, error } = useQuery<VaultResponse>({
    queryKey: [`/api/vault?kind=${kind}&page=${page}&pageSize=${PAGE_SIZE}`],
  });

  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: "已複製提示詞" }); }
    catch { toast({ title: "無法自動複製", description: "請手動選取文字。", variant: "destructive" }); }
  };
  const tab = (id: typeof kind, label: string) => (
    <button key={id} onClick={() => { setKind(id); setPage(1); }}
      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${kind === id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"}`}
      data-testid={`tab-vault-${id}`}>
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <NavigationHeader />
      <main className="max-w-6xl mx-auto px-4 py-5 md:py-8">
        <div className="mb-5">
          <h1 className="hidden md:block text-2xl font-bold text-slate-900">作品庫</h1>
          <p className="text-sm text-slate-500 md:mt-1">你做過的圖片與影片都在這裡。點開可以下載、複製提示詞，或送去編輯。</p>
        </div>

        <div className="flex gap-2 mb-5 flex-wrap">
          {tab("all", `全部${data ? ` ${data.counts.image + data.counts.video}` : ""}`)}
          {tab("image", `圖片${data ? ` ${data.counts.image}` : ""}`)}
          {tab("video", `影片${data ? ` ${data.counts.video}` : ""}`)}
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-16">載入中…</p>
        ) : error ? (
          <p className="text-sm text-red-500 text-center py-16">作品庫讀取失敗，請稍後再試。</p>
        ) : items.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
            <i className="fas fa-photo-film text-3xl text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">這裡還沒有作品。</p>
            <Link href="/"><span className="inline-block mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium cursor-pointer hover:bg-indigo-700">開始創作</span></Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1.5 sm:gap-3">
              {items.map(it => (
                <button key={it.id} onClick={() => setOpen(it)} className="relative aspect-square rounded-lg sm:rounded-xl overflow-hidden bg-slate-200 group" data-testid={`vault-item-${it.id}`}>
                  {it.kind === "image"
                    ? <SensitiveGate on={it.sensitive} compact><img src={it.url} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform" /></SensitiveGate>
                    : <video src={it.url} muted playsInline preload="metadata" className="w-full h-full object-cover" />}
                  {it.kind === "video" && (
                    <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"><i className="fas fa-play text-[9px]" /></span>
                  )}
                </button>
              ))}
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm disabled:opacity-40">上一頁</button>
                <span className="text-sm text-slate-600">{page} / {pages}</span>
                <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm disabled:opacity-40">下一頁</button>
              </div>
            )}
          </>
        )}
      </main>

      {open && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-end md:items-center justify-center md:p-4" onClick={() => setOpen(null)}>
          <div className="bg-white w-full md:max-w-4xl max-h-[92vh] overflow-auto rounded-t-3xl md:rounded-2xl grid md:grid-cols-[1fr_300px]" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-900 flex items-center justify-center min-h-[240px]">
              {open.kind === "image"
                ? <div className="max-w-full"><SensitiveGate on={open.sensitive}><img src={open.url} alt="" className="max-w-full max-h-[60vh] md:max-h-[85vh] object-contain" /></SensitiveGate></div>
                : <video src={open.url} controls playsInline className="max-w-full max-h-[60vh] md:max-h-[85vh]" />}
            </div>
            <div className="p-5 space-y-4 pb-[calc(20px+env(safe-area-inset-bottom))]">
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">{SOURCE_LABEL[open.source]}</span>
                <span className="text-xs text-slate-400">{formatDate(open.createdAt)}</span>
              </div>
              {open.prompt && (
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-1">提示詞</p>
                  <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-40 overflow-auto">{open.prompt}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {open.kind === "image" && (
                  <Link href={`/edit?image=${encodeURIComponent(open.url)}`}>
                    <span className="flex items-center justify-center gap-2 h-11 rounded-xl bg-indigo-600 text-white text-sm font-medium cursor-pointer hover:bg-indigo-700" data-testid="button-vault-edit">
                      <i className="fas fa-wand-magic-sparkles text-xs" />編輯
                    </span>
                  </Link>
                )}
                <a href={open.url} download target="_blank" rel="noreferrer"
                  className="flex items-center justify-center gap-2 h-11 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:border-indigo-300">
                  <i className="fas fa-download text-xs" />下載
                </a>
                {open.prompt && (
                  <button onClick={() => copy(open.prompt)} className="h-11 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:border-indigo-300">複製提示詞</button>
                )}
                <button onClick={() => setOpen(null)} className="h-11 rounded-xl text-slate-400 text-sm hover:text-slate-600">關閉</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { tr, dateLocale } from "@/lib/i18n";
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { errorText, creatorPath } from "@/components/Showcase";

// 後台「作品牆」分頁：審核使用者投稿到作品牆的作品。
// 待審核的要按「通過」才會上牆；已上牆的也可以隨時退回。被檢舉 3 次的作品會自動回到待審核。

type Status = "pending" | "reported" | "approved" | "rejected";
type Row = {
  id: string; kind: string; mediaUrl: string; title: string; prompt: string; showPrompt: boolean; status: string;
  rejectReason: string | null; reportCount: number; likeCount: number; createdAt: string | null; username: string; email: string;
};
type Data = { items: Row[]; counts: Partial<Record<Status, number>> };

const TABS: Array<{ id: Status; label: string }> = [
  { id: "pending", label: tr("待審核") },
  { id: "reported", label: tr("被檢舉") },
  { id: "approved", label: tr("已上牆") },
  { id: "rejected", label: tr("已退回") },
];

export function ShowcaseAdminPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("pending");
  const [busy, setBusy] = useState("");

  const { data, isLoading, error } = useQuery<Data>({ queryKey: [`/api/admin/showcase?status=${status}`] });
  const items = data?.items ?? [];

  const review = async (row: Row, action: "approve" | "reject") => {
    let reason = "";
    if (action === "reject") {
      const input = window.prompt(tr("退回原因（作者看得到，可留空）："), "");
      if (input === null) return;
      reason = input.slice(0, 200);
    }
    setBusy(row.id);
    try {
      await apiRequest("POST", `/api/admin/showcase/${row.id}/review`, { action, reason });
      toast({ title: action === "approve" ? tr("已通過，作品上牆了") : tr("已退回") });
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith("/api/admin/showcase") });
    } catch (e) {
      toast({ title: tr("操作失敗"), description: errorText(e), variant: "destructive" });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5" data-testid="admin-showcase">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex gap-2 flex-wrap">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setStatus(t.id)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${status === t.id ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`} data-testid={`admin-showcase-${t.id}`}>
              {t.label}{data?.counts?.[t.id] ? ` ${data.counts[t.id]}` : ""}
            </button>
          ))}
        </div>
        <Link href="/wall"><span className="text-sm text-purple-600 hover:underline cursor-pointer whitespace-nowrap">{tr("開啟作品牆 →")}</span></Link>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-10">{tr("載入中…")}</p>
      ) : error ? (
        <p className="text-sm text-red-500 text-center py-10">{tr("讀取失敗，請稍後再試。")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">{status === "pending" ? tr("沒有待審核的作品。") : tr("這裡沒有作品。")}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map(row => (
            <div key={row.id} className="border border-gray-200 rounded-xl overflow-hidden flex flex-col" data-testid={`admin-showcase-row-${row.id}`}>
              <a href={row.mediaUrl} target="_blank" rel="noreferrer" className="block bg-gray-900">
                {row.kind === "video"
                  ? <video src={row.mediaUrl} controls playsInline preload="metadata" className="w-full h-64 object-contain" />
                  : <img src={row.mediaUrl} alt="" loading="lazy" className="w-full h-64 object-contain" />}
              </a>
              <div className="p-3 space-y-2 flex-1 flex flex-col">
                <p className="text-sm font-semibold text-gray-900">{row.title || tr("（沒有標題）")}</p>
                <p className="text-xs text-gray-500">
                  <Link href={creatorPath(row.username)}><span className="text-purple-600 hover:underline cursor-pointer">{row.username}</span></Link>
                  ・{row.email}・{row.createdAt ? new Date(row.createdAt).toLocaleString(dateLocale(), { hour12: false }) : ""}
                </p>
                <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-2 max-h-24 overflow-auto whitespace-pre-wrap flex-1">
                  {row.prompt || tr("（沒有提示詞）")}
                </p>
                <p className="text-[11px] text-gray-400">
                  {tr("提示詞{0}・讚 {1}", { 0: row.showPrompt ? tr("公開") : tr("不公開"), 1: row.likeCount })}
                  {row.reportCount > 0 && <span className="text-red-600 font-semibold">{tr("・被檢舉 {0} 次", { 0: row.reportCount })}</span>}
                  {row.rejectReason && <span>{tr("・退回原因：{0}", { 0: row.rejectReason })}</span>}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => review(row, "approve")} disabled={busy === row.id || row.status === "approved" && row.reportCount === 0}
                    className="h-9 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-40" data-testid={`admin-showcase-approve-${row.id}`}>{tr("通過")}</button>
                  <button onClick={() => review(row, "reject")} disabled={busy === row.id || row.status === "rejected"}
                    className="h-9 rounded-lg border border-red-300 text-red-600 text-sm font-medium disabled:opacity-40" data-testid={`admin-showcase-reject-${row.id}`}>{tr("退回")}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

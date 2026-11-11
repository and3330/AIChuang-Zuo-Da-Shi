import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// 後台：對外 API 建立的 AI 角色。用來處理肖像下架：
// 依 owner_ref（客戶小鎮的工作區代號）或角色代號找到角色後停用，停用後不能再用來生成。

type Row = {
  id: string;
  owner_ref: string;
  name: string;
  reference_image_urls: string[];
  four_view_urls: string[];
  disabled: boolean;
  userId: string;
  consentAt: string | null;
  disabledAt: string | null;
  disabledReason: string | null;
  created_at: string | null;
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("zh-TW", { hour12: false }) : "—");

export function PartnerCharactersPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [ownerRef, setOwnerRef] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [applied, setApplied] = useState({ ownerRef: "", id: "" });

  const params = new URLSearchParams();
  if (applied.ownerRef) params.set("owner_ref", applied.ownerRef);
  if (applied.id) params.set("id", applied.id);
  const url = `/api/admin/partner-characters${params.toString() ? `?${params}` : ""}`;
  const { data: rows = [], isLoading, isError } = useQuery<Row[]>({ queryKey: [url] });
  const refresh = () => queryClient.invalidateQueries({ queryKey: [url] });

  const toggle = useMutation({
    mutationFn: async (v: { id: string; disabled: boolean; reason?: string }) =>
      (await apiRequest("POST", `/api/admin/partner-characters/${v.id}/disable`, { disabled: v.disabled, reason: v.reason })).json(),
    onSuccess: (_d, v) => { refresh(); toast({ title: v.disabled ? "已停用" : "已重新啟用" }); },
    onError: () => toast({ title: "更新失敗", variant: "destructive" }),
  });
  const toggleOwner = useMutation({
    mutationFn: async (v: { ownerRef: string; disabled: boolean; reason?: string }) =>
      (await apiRequest("POST", `/api/admin/partner-characters/disable-by-owner`, v)).json(),
    onSuccess: (d: { affected: number }, v) => { refresh(); toast({ title: `${v.disabled ? "已停用" : "已重新啟用"} ${d.affected} 個角色` }); },
    onError: () => toast({ title: "更新失敗", variant: "destructive" }),
  });

  const askReason = () => window.prompt("停用原因（選填，只有後台看得到）：", "") ?? undefined;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden" data-testid="partner-characters-panel">
      <div className="p-5">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <i className="fas fa-user-shield text-purple-500"></i>對外 API 的 AI 角色
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          處理肖像下架用。停用後這個角色不能再用來生成或做四視圖，對方查詢時會看到 disabled；資料與圖片仍保留，重新啟用即可恢復。要連同圖片一起移除，請對方呼叫刪除端點。
        </p>
        <form className="flex flex-col md:flex-row gap-2 mt-4" onSubmit={e => { e.preventDefault(); setApplied({ ownerRef: ownerRef.trim(), id: characterId.trim() }); }}>
          <input value={ownerRef} onChange={e => setOwnerRef(e.target.value)} placeholder="owner_ref（工作區代號）"
            className="flex-1 h-10 px-3 rounded-lg border border-gray-300 text-sm" data-testid="input-partner-owner-ref" />
          <input value={characterId} onChange={e => setCharacterId(e.target.value)} placeholder="角色代號（選填）"
            className="flex-1 h-10 px-3 rounded-lg border border-gray-300 text-sm font-mono" data-testid="input-partner-character-id" />
          <button type="submit" className="h-10 px-4 rounded-lg bg-purple-600 text-white text-sm font-medium" data-testid="button-partner-character-search">搜尋</button>
        </form>
        {applied.ownerRef && rows.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            <button disabled={toggleOwner.isPending}
              onClick={() => { if (window.confirm(`確定停用「${applied.ownerRef}」的全部 ${rows.length} 個角色？`)) toggleOwner.mutate({ ownerRef: applied.ownerRef, disabled: true, reason: askReason() }); }}
              className="h-9 px-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-medium" data-testid="button-disable-owner">
              停用這個單位的全部角色
            </button>
            <button disabled={toggleOwner.isPending} onClick={() => toggleOwner.mutate({ ownerRef: applied.ownerRef, disabled: false })}
              className="h-9 px-3 rounded-lg border border-gray-200 text-gray-600 text-xs" data-testid="button-enable-owner">
              全部重新啟用
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="px-5 pb-5 text-sm text-gray-400">讀取中…</p>
      ) : isError ? (
        <p className="px-5 pb-5 text-sm text-red-500">讀取失敗。資料表可能尚未建立，請先執行 npm run db:push。</p>
      ) : rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-gray-400">{applied.ownerRef || applied.id ? "找不到符合的角色。" : "還沒有角色。"}</p>
      ) : (
        <div className="overflow-x-auto border-t border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">角色</th>
                <th className="text-left px-4 py-2 font-medium">owner_ref</th>
                <th className="text-left px-4 py-2 font-medium">同意時間</th>
                <th className="text-left px-4 py-2 font-medium">狀態</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id} className={r.disabled ? "bg-gray-50" : ""} data-testid={`row-partner-character-${r.id}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {r.reference_image_urls[0]
                        ? <img src={r.reference_image_urls[0]} alt="" className="w-10 h-10 rounded-lg object-cover bg-gray-100" />
                        : <div className="w-10 h-10 rounded-lg bg-gray-100" />}
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">{r.name}</div>
                        <div className="text-[11px] font-mono text-gray-400 truncate">{r.id}</div>
                        <div className="text-[11px] text-gray-400">參考圖 {r.reference_image_urls.length}・四視圖 {r.four_view_urls.length}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono break-all">{r.owner_ref}</td>
                  <td className="px-4 py-3 text-xs">{fmt(r.consentAt)}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.disabled
                      ? <span className="text-red-600">已停用<br />{fmt(r.disabledAt)}{r.disabledReason ? <><br /><span className="text-gray-500">{r.disabledReason}</span></> : null}</span>
                      : <span className="text-green-600">可使用</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {r.disabled ? (
                      <button disabled={toggle.isPending} onClick={() => toggle.mutate({ id: r.id, disabled: false })}
                        className="text-xs text-gray-600 hover:underline" data-testid={`button-enable-${r.id}`}>重新啟用</button>
                    ) : (
                      <button disabled={toggle.isPending}
                        onClick={() => { if (window.confirm(`確定停用「${r.name}」？停用後不能再用來生成。`)) toggle.mutate({ id: r.id, disabled: true, reason: askReason() }); }}
                        className="text-xs text-red-600 hover:underline" data-testid={`button-disable-${r.id}`}>停用</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-5 py-3 border-t border-gray-100 text-[11px] text-gray-400">最多顯示 200 筆，請用 owner_ref 或角色代號縮小範圍。</p>
    </div>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// 後台：素材圖庫的清單同步與批次生成。
// 生成一定由管理員手動啟動，且每次都要填「這次最多幾張」，那就是這次的花費上限。

type LibraryRow = { id: string; label: string; total: number; ready: number; pending: number; generating: number; failed: number; inCatalog: number };
type Status = {
  model: string;
  priceUsdPerImage: number;
  configured: { atlas: boolean; cdn: boolean };
  libraries: LibraryRow[];
  run: { running: boolean; stopRequested: boolean; library: string; target: number; done: number; failed: number; startedAt: number | null; finishedAt: number | null; lastError: string | null };
};

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\{[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (typeof j.error === "string") return j.error; } catch { /* fall through */ }
  }
  return msg;
}

export function LibraryAdminPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [library, setLibrary] = useState("all");
  const [limit, setLimit] = useState("20");
  const [concurrency, setConcurrency] = useState("8");

  const { data: status, error, isLoading } = useQuery<Status>({
    queryKey: ["/api/admin/library/status"],
    refetchInterval: (query) => (query.state.data?.run.running ? 2500 : false),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/library/status"] });

  const syncMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/library/sync")).json() as Promise<{ added: number; updated: number; total: number }>,
    onSuccess: (r) => { refresh(); toast({ title: "清單已同步", description: `清單共 ${r.total} 筆，新增 ${r.added} 筆${r.updated ? `，${r.updated} 筆提示詞有更新（需要時請個別重生）` : ""}。` }); },
    onError: (e) => toast({ title: "同步失敗", description: errorText(e), variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const n = Number(limit);
      const c = Number(concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 5000) throw new Error("「這次最多幾張」請填 1–5000 的整數");
      return (await apiRequest("POST", "/api/admin/library/generate", { library, limit: n, concurrency: c })).json();
    },
    onSuccess: () => { refresh(); toast({ title: "已開始生成", description: "可以離開這個頁面，生成會在背景繼續。" }); },
    onError: (e) => toast({ title: "無法開始", description: errorText(e), variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/library/stop"),
    onSuccess: () => { refresh(); toast({ title: "停止中", description: "正在生成的幾張完成後就會停下。" }); },
  });

  const requeueMutation = useMutation({
    mutationFn: async (failedIn: string) => (await apiRequest("POST", "/api/admin/library/requeue", { failedIn })).json() as Promise<{ requeued: number }>,
    onSuccess: (r) => { refresh(); toast({ title: `已將 ${r.requeued} 筆失敗項目排回待生成` }); },
    onError: (e) => toast({ title: "操作失敗", description: errorText(e), variant: "destructive" }),
  });

  if (isLoading) return <p className="text-sm text-gray-500">載入中…</p>;
  if (error || !status) return <p className="text-sm text-red-600">{errorText(error)}</p>;

  const run = status.run;
  const totals = status.libraries.reduce((a, l) => ({ total: a.total + l.total, ready: a.ready + l.ready, todo: a.todo + l.pending + l.failed, catalog: a.catalog + l.inCatalog }), { total: 0, ready: 0, todo: 0, catalog: 0 });
  const selected = library === "all" ? null : status.libraries.find(l => l.id === library);
  const waiting = selected ? selected.pending + selected.failed : totals.todo;
  const n = Number(limit) || 0;
  const willGenerate = Math.min(n, waiting);
  const estimate = (willGenerate * status.priceUsdPerImage).toFixed(2);
  const unsynced = totals.catalog - totals.total;
  const progress = run.target > 0 ? Math.round(((run.done + run.failed) / run.target) * 100) : 0;
  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent";

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><i className="fas fa-images text-purple-500"></i>素材圖庫</h3>
            <p className="text-sm text-gray-500 mt-1">
              姿勢、服裝、人像的預覽圖。清單寫在程式裡，這裡負責把還沒有圖的項目補上。
              使用模型 <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{status.model}</code>，每張約 {status.priceUsdPerImage} 美元。
            </p>
          </div>
          <Link href="/library"><span className="text-sm text-purple-600 hover:underline cursor-pointer whitespace-nowrap">開啟圖庫瀏覽頁 →</span></Link>
        </div>

        {(!status.configured.atlas || !status.configured.cdn) && (
          <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {!status.configured.atlas && "尚未設定 ATLASCLOUD_API_KEY。"}{!status.configured.cdn && "尚未設定 Bunny CDN。"}設定完成前無法生成。
          </p>
        )}

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">圖庫</th>
                <th className="text-right px-3 py-2 font-medium">清單</th>
                <th className="text-right px-3 py-2 font-medium">已完成</th>
                <th className="text-right px-3 py-2 font-medium">待生成</th>
                <th className="text-right px-3 py-2 font-medium">失敗</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {status.libraries.map(l => (
                <tr key={l.id} data-testid={`row-library-${l.id}`}>
                  <td className="px-3 py-2 font-medium text-gray-900">{l.label}</td>
                  <td className="px-3 py-2 text-right">{l.inCatalog}{l.total < l.inCatalog && <span className="text-amber-600 text-xs">（{l.inCatalog - l.total} 筆未同步）</span>}</td>
                  <td className="px-3 py-2 text-right text-green-700">{l.ready}</td>
                  <td className="px-3 py-2 text-right">{l.pending + l.generating}</td>
                  <td className="px-3 py-2 text-right text-red-600">{l.failed}</td>
                  <td className="px-3 py-2 text-right">
                    {l.failed > 0 && (
                      <button onClick={() => requeueMutation.mutate(l.id)} disabled={requeueMutation.isPending || run.running} className="text-xs text-purple-600 hover:underline disabled:opacity-40">重試失敗項目</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || run.running}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50" data-testid="button-library-sync">
            {syncMutation.isPending ? "同步中…" : "① 同步清單"}
          </button>
          <span className="text-xs text-gray-500">
            {unsynced > 0 ? `清單有 ${unsynced} 筆還沒進資料庫，請先同步。` : "把程式裡的清單寫進資料庫，只新增缺少的，不會動到已生成的圖，也不花錢。"}
          </span>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h4 className="text-sm font-semibold text-gray-900">② 批次生成</h4>
        <div className="grid sm:grid-cols-3 gap-4 mt-3">
          <div>
            <label className="text-xs text-gray-600 block mb-1">圖庫</label>
            <select value={library} onChange={e => setLibrary(e.target.value)} disabled={run.running} className={inputCls} data-testid="select-library">
              <option value="all">全部圖庫</option>
              {status.libraries.map(l => <option key={l.id} value={l.id}>{l.label}（待生成 {l.pending + l.failed}）</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">這次最多幾張（花費上限）</label>
            <input value={limit} onChange={e => setLimit(e.target.value)} inputMode="numeric" disabled={run.running} className={inputCls} data-testid="input-library-limit" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">同時生成幾張</label>
            <select value={concurrency} onChange={e => setConcurrency(e.target.value)} disabled={run.running} className={inputCls}>
              {[1, 2, 4, 8, 12, 16, 24, 32].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <p className="text-sm text-gray-700 mt-3">
          待生成 <b>{waiting}</b> 張，這次會生成 <b>{willGenerate}</b> 張，預估最多 <b className="text-purple-700">{estimate} 美元</b>。
          <span className="text-xs text-gray-500 ml-1">建議先用 20 張試跑，確認風格滿意再放大。每張約半分鐘到一分鐘。同時 8 張時一千張大約一到兩小時，同時 32 張大約二十到三十分鐘。遇到供應商限流會自動暫停 20 秒並把同時張數減半；連續失敗多次會自動停止。</span>
        </p>

        <div className="mt-3 flex items-center gap-3">
          {run.running ? (
            <button onClick={() => stopMutation.mutate()} disabled={run.stopRequested}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50" data-testid="button-library-stop">
              {run.stopRequested ? "停止中…" : "停止"}
            </button>
          ) : (
            <button
              onClick={() => { if (window.confirm(`確定要生成最多 ${willGenerate} 張、預估最多 ${estimate} 美元嗎？`)) generateMutation.mutate(); }}
              disabled={generateMutation.isPending || willGenerate === 0 || !status.configured.atlas || !status.configured.cdn}
              className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50" data-testid="button-library-generate">
              開始生成
            </button>
          )}
          {willGenerate === 0 && !run.running && <span className="text-xs text-gray-500">沒有待生成的項目。</span>}
        </div>

        {(run.running || run.finishedAt) && (
          <div className="mt-4 bg-gray-50 border border-gray-200 rounded-lg p-3" data-testid="panel-library-progress">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-900">{run.running ? "生成中" : "上一批已結束"}</span>
              <span className="text-gray-600">完成 {run.done}・失敗 {run.failed}・目標 {run.target}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-purple-500 transition-all" style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
            {run.lastError && <p className="text-xs text-red-600 mt-2">最近一次失敗原因：{run.lastError}</p>}
            {!run.running && run.stopRequested && run.done + run.failed < run.target && (
              <p className="text-xs text-amber-700 mt-2">這一批提前停止了（手動停止，或整批都失敗時自動停下以免浪費）。排除問題後再按開始即可續跑。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MEMBERSHIP } from "@shared/pricing";

// 後台：成本與毛利。
// 上半部是 AtlasCloud 帳務 API 回報的真實餘額與花費；下半部是本站自己記的每次生成估算成本，
// 以及「每種生成賺不賺錢」的試算。估算用的單價可以用環境變數修正。

type EconomicsRow = { name: string; credits: number; revenueUsd: number; costUsd: number; profitUsd: number; marginPct: number; note: string };
type CostData = {
  days: number;
  settings: { seedreamImageUsd: number; seedreamInputImageUsd: number; wanSecondUsd: Record<string, number>; libraryImageUsd: number; creditPriceTwd: number; usdTwd: number; paymentFeeRate: number };
  ledger: { byModel: { model: string; kind: string; calls: number; units: number; inputImages: number; costUsd: number }[]; byDay: { day: string; calls: number; costUsd: number }[]; totalUsd: number; error: string | null };
  credits: { consumed: number; refunded: number; toppedUp: number; net: number; valueUsd: number };
  estimatedProfitUsd: number;
  economics: { creditNetUsd: number; memberCreditNetUsd: number; rows: EconomicsRow[]; freebies: { signupCredits: number; signupWorstCostUsd: number; membershipNetUsd: number; membershipWorstCostUsd: number } };
  atlas: { balance: any; balanceError: string | null; costs: any; costsError: string | null };
};

const usd = (n: number, digits = 2) => `$${Number(n || 0).toFixed(digits)}`;
const KIND: Record<string, string> = { image: "圖片", video: "影片", library: "素材圖庫" };

/** AtlasCloud's bucket format is not fixed in their docs, so read it tolerantly. */
function atlasRows(costs: any): { day: string; model: string; amount: number }[] {
  const out: { day: string; model: string; amount: number }[] = [];
  const pick = (o: any, keys: string[]) => keys.map(k => o?.[k]).find(v => v !== undefined && v !== null);
  const amountOf = (o: any): number => {
    const v = pick(o, ["cost", "amount", "value", "total_cost", "total"]);
    if (v && typeof v === "object") return Number(pick(v, ["value", "amount"]) ?? 0);
    return Number(v ?? 0);
  };
  const buckets: any[] = Array.isArray(costs) ? costs : Array.isArray(costs?.data) ? costs.data : Array.isArray(costs?.buckets) ? costs.buckets : [];
  for (const b of buckets) {
    const day = String(pick(b, ["date", "start_date", "day", "start_time", "bucket"]) ?? "").slice(0, 10);
    const groups: any[] = Array.isArray(b?.results) ? b.results : Array.isArray(b?.groups) ? b.groups : Array.isArray(b?.items) ? b.items : [b];
    for (const g of groups) {
      const amount = amountOf(g);
      if (!Number.isFinite(amount)) continue;
      out.push({ day, model: String(pick(g, ["model", "model_id", "model_name"]) ?? "全部"), amount });
    }
  }
  return out;
}

export function CostPanel() {
  const [days, setDays] = useState(30);
  const { data, isLoading, isError, refetch, isFetching } = useQuery<CostData>({ queryKey: [`/api/admin/costs?days=${days}`] });

  if (isLoading) return <p className="text-sm text-gray-400 p-5">讀取中…</p>;
  if (isError || !data) return <p className="text-sm text-red-500 p-5">讀取成本資料失敗。</p>;

  const s = data.settings;
  const real = atlasRows(data.atlas.costs);
  const realTotal = real.reduce((n, r) => n + r.amount, 0);
  const realByModel = Object.entries(real.reduce<Record<string, number>>((m, r) => { m[r.model] = (m[r.model] ?? 0) + r.amount; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const balanceValue = data.atlas.balance?.value ?? data.atlas.balance?.balance ?? null;
  // Credits are sold in TWD and the provider bills in USD: show both sides in TWD.
  const twd = (usdAmount: number) => `NT$${(Number(usdAmount || 0) * s.usdTwd).toFixed(2)}`;
  const card = "bg-white border border-gray-200 rounded-xl p-5";
  const th = "text-left px-3 py-2 font-medium";
  const td = "px-3 py-2";

  return (
    <div className="space-y-6" data-testid="cost-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-lg font-semibold text-gray-900 mr-auto"><i className="fas fa-coins text-purple-500 mr-2"></i>成本與毛利</h3>
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => setDays(d)} className={`h-9 px-3 rounded-lg text-xs font-medium ${days === d ? "bg-purple-600 text-white" : "bg-white border border-gray-200 text-gray-600"}`} data-testid={`cost-days-${d}`}>近 {d} 天</button>
        ))}
        <button onClick={() => refetch()} disabled={isFetching} className="h-9 px-3 rounded-lg text-xs border border-gray-200 bg-white text-gray-600">{isFetching ? "更新中…" : "重新整理"}</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className={card}>
          <p className="text-xs text-gray-500">AtlasCloud 餘額（真實）</p>
          <p className="text-2xl font-bold text-gray-900 mt-1" data-testid="cost-atlas-balance">{balanceValue !== null ? usd(Number(balanceValue)) : "—"}</p>
          {data.atlas.balanceError && <p className="text-[11px] text-red-500 mt-1">{data.atlas.balanceError}</p>}
        </div>
        <div className={card}>
          <p className="text-xs text-gray-500">AtlasCloud 花費（真實，近 {data.days} 天）</p>
          <p className="text-2xl font-bold text-gray-900 mt-1" data-testid="cost-atlas-total">{data.atlas.costs ? usd(realTotal) : "—"}</p>
          {data.atlas.costsError && <p className="text-[11px] text-red-500 mt-1">{data.atlas.costsError}</p>}
        </div>
        <div className={card}>
          <p className="text-xs text-gray-500">本站估算成本（近 {data.days} 天）</p>
          <p className="text-2xl font-bold text-gray-900 mt-1" data-testid="cost-ledger-total">{usd(data.ledger.totalUsd)}</p>
          <p className="text-[11px] text-gray-400 mt-1">依下方單價計算</p>
        </div>
        <div className={card}>
          <p className="text-xs text-gray-500">估算毛利（近 {data.days} 天）</p>
          <p className={`text-2xl font-bold mt-1 ${data.estimatedProfitUsd < 0 ? "text-red-600" : "text-green-600"}`} data-testid="cost-profit">{usd(data.estimatedProfitUsd)}</p>
          <p className="text-[11px] text-gray-400 mt-1">用掉 {data.credits.net} 積分 ≈ {usd(data.credits.valueUsd)}（已扣手續費）</p>
        </div>
      </div>

      <div className={card}>
        <h4 className="font-semibold text-gray-900">每種生成賺不賺錢</h4>
        <p className="text-xs text-gray-500 mt-1">
          1 積分以 NT${s.creditPriceTwd}、匯率 {s.usdTwd}、金流手續費 {Math.round(s.paymentFeeRate * 100)}% 計，實收約 {usd(data.economics.creditNetUsd, 4)}。會員首購的積分實收約 {usd(data.economics.memberCreditNetUsd, 4)}。不含主機、CDN、AI 規劃文字與稅。
        </p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className={th}>項目</th><th className={th}>收積分</th><th className={th}>實收</th><th className={th}>成本</th><th className={th}>毛利</th><th className={th}>毛利率</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {data.economics.rows.map(r => (
                <tr key={r.name} data-testid={`economics-${r.name}`}>
                  <td className={td}>{r.name}{r.note && <span className="ml-2 text-[11px] text-amber-600">{r.note}</span>}</td>
                  <td className={td}>{r.credits}</td>
                  <td className={td}>{twd(r.revenueUsd)}</td>
                  <td className={td}>{twd(r.costUsd)} <span className="text-[11px] text-gray-400">({usd(r.costUsd, 3)})</span></td>
                  <td className={`${td} font-medium ${r.profitUsd < 0 ? "text-red-600" : "text-green-600"}`}>{twd(r.profitUsd)}</td>
                  <td className={`${td} ${r.marginPct < 20 ? "text-red-600 font-semibold" : ""}`}>{r.marginPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          免費額度：註冊送 {data.economics.freebies.signupCredits} 積分，最壞情況成本約 {usd(data.economics.freebies.signupWorstCostUsd, 3)}／人。
          會員首購實收約 {usd(data.economics.freebies.membershipNetUsd)}，{MEMBERSHIP.credits} 積分全部拿去做最貴的圖，成本約 {usd(data.economics.freebies.membershipWorstCostUsd)}。
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className={card}>
          <h4 className="font-semibold text-gray-900">本站紀錄：各模型用量（估算）</h4>
          {data.ledger.error ? <p className="text-sm text-red-500 mt-2">{data.ledger.error}</p> : data.ledger.byModel.length === 0 ? (
            <p className="text-sm text-gray-400 mt-2">這段期間還沒有紀錄。紀錄從這個功能上線後開始累積。</p>
          ) : (
            <table className="w-full text-sm mt-3">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className={th}>模型</th><th className={th}>次數</th><th className={th}>用量</th><th className={th}>參考圖</th><th className={th}>估算成本</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {data.ledger.byModel.map(r => (
                  <tr key={r.model + r.kind}>
                    <td className={td}><span className="text-[11px] text-gray-400 mr-1">{KIND[r.kind] ?? r.kind}</span><span className="font-mono text-xs break-all">{r.model}</span></td>
                    <td className={td}>{r.calls}</td>
                    <td className={td}>{Math.round(r.units)}{r.kind === "video" ? " 秒" : " 張"}</td>
                    <td className={td}>{r.inputImages || "—"}</td>
                    <td className={td}>{usd(r.costUsd, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={card}>
          <h4 className="font-semibold text-gray-900">AtlasCloud 帳務：各模型花費（真實）</h4>
          {data.atlas.costsError ? <p className="text-sm text-red-500 mt-2">{data.atlas.costsError}</p> : realByModel.length === 0 ? (
            <p className="text-sm text-gray-400 mt-2">這段期間沒有花費，或回傳格式無法辨識。</p>
          ) : (
            <table className="w-full text-sm mt-3">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className={th}>模型</th><th className={th}>花費</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {realByModel.map(([model, amount]) => <tr key={model}><td className={`${td} font-mono text-xs break-all`}>{model}</td><td className={td}>{usd(amount, 3)}</td></tr>)}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-gray-400 mt-3">兩邊數字差很多時，以這一欄為準，並用環境變數修正估算單價。</p>
        </div>
      </div>

      <div className={card}>
        <h4 className="font-semibold text-gray-900">估算用的單價</h4>
        <p className="text-sm text-gray-600 mt-2">
          Seedream 每張 {usd(s.seedreamImageUsd, 4)}、每張參考圖 {usd(s.seedreamInputImageUsd, 4)}；WAN 720p 每秒 {usd(s.wanSecondUsd["720p"], 3)}、1080p 每秒 {usd(s.wanSecondUsd["1080p"], 3)}；素材圖庫每張 {usd(s.libraryImageUsd, 4)}。
        </p>
        <p className="text-xs text-gray-500 mt-2">
          這些是 AtlasCloud 公開頁面上的牌價，實際帳單可能不同。可在 Replit 的 Secrets 設定 <code className="bg-gray-100 px-1 rounded">COST_SEEDREAM_IMAGE_USD</code>、<code className="bg-gray-100 px-1 rounded">COST_SEEDREAM_INPUT_IMAGE_USD</code>、<code className="bg-gray-100 px-1 rounded">COST_WAN_720P_SECOND_USD</code>、<code className="bg-gray-100 px-1 rounded">COST_WAN_1080P_SECOND_USD</code>、<code className="bg-gray-100 px-1 rounded">COST_LIBRARY_IMAGE_USD</code>、<code className="bg-gray-100 px-1 rounded">USD_TWD_RATE</code>、<code className="bg-gray-100 px-1 rounded">PAYMENT_FEE_RATE</code> 來修正。
        </p>
      </div>
    </div>
  );
}

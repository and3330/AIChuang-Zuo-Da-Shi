import { tr } from "@/lib/i18n";
import { useMemo, useState } from "react";

// 後台「訂單」分頁上方的統計：依日、週、月、季彙總。
// 資料就是下面訂單列表那一份（type = topup 的積分異動），在瀏覽器裡分組，不另外查資料庫。
//   Stripe 訂單   說明含「Stripe」的列：筆數、售出積分、實收金額（新台幣與美金分開）
//   手動加值     管理員在用戶頁加的積分，不算營收，另列一欄
// 實收金額從 2026-11 這次改版後才開始記錄（credit_transactions.paid_amount），更早的訂單只有積分。
// 日期一律用瀏覽器的當地時間；一週從星期一開始。

export type OrderRow = {
  amount: number; description: string | null; createdAt: string;
  paidAmount?: number | null; paidCurrency?: string | null;
};
type Period = "day" | "week" | "month" | "quarter";
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "day", label: tr("日") }, { id: "week", label: tr("週") }, { id: "month", label: tr("月") }, { id: "quarter", label: tr("季") },
];
const ROWS_SHOWN: Record<Period, number> = { day: 31, week: 16, month: 12, quarter: 8 };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Sortable key and the label shown for the period a date falls in. */
function periodOf(date: Date, period: Period): { key: string; label: string } {
  if (period === "day") return { key: ymd(date), label: ymd(date) };
  if (period === "month") { const k = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`; return { key: k, label: k }; }
  if (period === "quarter") {
    const q = Math.floor(date.getMonth() / 3) + 1;
    return { key: `${date.getFullYear()}-Q${q}`, label: tr("{0} 第 {1} 季", { 0: date.getFullYear(), 1: q }) };
  }
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { key: ymd(monday), label: `${ymd(monday)} ～ ${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}` };
}

type Bucket = { key: string; label: string; orders: number; credits: number; twd: number; usd: number; unpriced: number; manual: number };

export function OrderStatsPanel({ orders }: { orders: OrderRow[] }) {
  const [period, setPeriod] = useState<Period>("day");

  const buckets = useMemo(() => {
    const map = new Map<string, Bucket>();
    for (const o of orders) {
      const date = new Date(o.createdAt);
      if (Number.isNaN(date.getTime())) continue;
      const { key, label } = periodOf(date, period);
      let b = map.get(key);
      if (!b) { b = { key, label, orders: 0, credits: 0, twd: 0, usd: 0, unpriced: 0, manual: 0 }; map.set(key, b); }
      if (o.description?.includes("Stripe")) {
        b.orders += 1;
        b.credits += o.amount;
        const currency = (o.paidCurrency ?? "").toLowerCase();
        if (o.paidAmount && currency === "twd") b.twd += o.paidAmount / 100;
        else if (o.paidAmount && currency === "usd") b.usd += o.paidAmount / 100;
        else b.unpriced += 1;
      } else {
        b.manual += o.amount;
      }
    }
    return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [orders, period]);

  const shown = buckets.slice(0, ROWS_SHOWN[period]);
  const total = shown.reduce((t, b) => ({ orders: t.orders + b.orders, credits: t.credits + b.credits, twd: t.twd + b.twd, usd: t.usd + b.usd, unpriced: t.unpriced + b.unpriced, manual: t.manual + b.manual }),
    { orders: 0, credits: 0, twd: 0, usd: 0, unpriced: 0, manual: 0 });
  const money = (n: number, symbol: string) => (n > 0 ? `${symbol}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—");
  const num = (n: number) => (n !== 0 ? n.toLocaleString() : "—");

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6" data-testid="order-stats">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h3 className="text-lg font-semibold flex items-center gap-2"><i className="fas fa-chart-column text-green-500"></i>{tr("訂單統計")}</h3>
        <div className="flex gap-1" role="tablist" aria-label={tr("統計區間")}>
          {PERIODS.map(p => (
            <button key={p.id} role="tab" aria-selected={period === p.id} onClick={() => setPeriod(p.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium border ${period === p.id ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`} data-testid={`order-stats-${p.id}`}>
              {p.label}{tr("統計")}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">{tr("還沒有訂單。")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                <th className="py-2 pr-3 font-medium">{tr("期間")}</th>
                <th className="py-2 px-3 font-medium text-right">{tr("付款筆數")}</th>
                <th className="py-2 px-3 font-medium text-right">{tr("售出積分")}</th>
                <th className="py-2 px-3 font-medium text-right">{tr("實收 NT$")}</th>
                <th className="py-2 px-3 font-medium text-right">{tr("實收 US$")}</th>
                <th className="py-2 pl-3 font-medium text-right">{tr("手動加值積分")}</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {shown.map(b => (
                <tr key={b.key} className="border-b border-gray-100">
                  <td className="py-2 pr-3 whitespace-nowrap">{b.label}</td>
                  <td className="py-2 px-3 text-right">{num(b.orders)}</td>
                  <td className="py-2 px-3 text-right">{num(b.credits)}</td>
                  <td className="py-2 px-3 text-right">{money(b.twd, "NT$")}</td>
                  <td className="py-2 px-3 text-right">{money(b.usd, "US$")}{b.unpriced > 0 && <span className="ml-1 text-[11px] text-amber-600" title={tr("這幾筆是改版前的訂單，沒有記錄金額")}>{tr("（{0} 筆無金額）", { 0: b.unpriced })}</span>}</td>
                  <td className="py-2 pl-3 text-right text-gray-500">{num(b.manual)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="tabular-nums font-semibold">
              <tr>
                <td className="py-2 pr-3">{tr("以上合計")}</td>
                <td className="py-2 px-3 text-right">{num(total.orders)}</td>
                <td className="py-2 px-3 text-right">{num(total.credits)}</td>
                <td className="py-2 px-3 text-right">{money(total.twd, "NT$")}</td>
                <td className="py-2 px-3 text-right">{money(total.usd, "US$")}</td>
                <td className="py-2 pl-3 text-right text-gray-500">{num(total.manual)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-3">
        {tr("顯示最近")} {ROWS_SHOWN[period]} {tr("個")}{PERIODS.find(p => p.id === period)?.label}{tr("。實收金額是 Stripe 收到的金額（未扣手續費），這次改版之後的訂單才有記錄；手動加值是管理員加的積分，不算營收。")}
      </p>
    </div>
  );
}

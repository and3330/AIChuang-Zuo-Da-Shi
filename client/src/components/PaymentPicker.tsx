import { tr } from "@/lib/i18n";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

// 付款方式：Stripe 與 Airwallex 並存。伺服器沒設定 Airwallex 時只有 Stripe，選擇器也不顯示。
// 上次選的方式記在這台裝置的瀏覽器裡。

export type PaymentProvider = "stripe" | "airwallex";
const KEY = "payment-provider";

export function usePaymentProvider() {
  const { data } = useQuery<{ available: boolean }>({ queryKey: ["/api/airwallex/available"], staleTime: 5 * 60_000 });
  const airwallexOn = !!data?.available;
  const [chosen, setChosen] = useState<PaymentProvider>(() => {
    try { return localStorage.getItem(KEY) === "airwallex" ? "airwallex" : "stripe"; } catch { return "stripe"; }
  });
  const provider: PaymentProvider = airwallexOn ? chosen : "stripe";
  const choose = (p: PaymentProvider) => {
    setChosen(p);
    try { localStorage.setItem(KEY, p); } catch { /* private window: just not remembered */ }
  };
  return {
    provider, choose, airwallexOn,
    checkoutPath: provider === "airwallex" ? "/api/airwallex/create-checkout" : "/api/stripe/create-checkout",
    /** "付款由 Stripe 處理。" for the chosen method. */
    note: tr("付款由 {0} 處理。", { 0: provider === "airwallex" ? "Airwallex" : "Stripe" }),
  };
}

export function PaymentPicker({ provider, choose, airwallexOn, className = "" }: {
  provider: PaymentProvider; choose: (p: PaymentProvider) => void; airwallexOn: boolean; className?: string;
}) {
  if (!airwallexOn) return null;
  const options: { id: PaymentProvider; label: string }[] = [
    { id: "stripe", label: "Stripe" },
    { id: "airwallex", label: "Airwallex" },
  ];
  return (
    <div className={className} data-testid="payment-picker">
      <p className="text-xs font-semibold text-slate-600 mb-1.5">{tr("付款方式")}</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={tr("付款方式")}>
        {options.map(o => (
          <button key={o.id} type="button" role="radio" aria-checked={provider === o.id} onClick={() => choose(o.id)}
            className={`h-11 rounded-xl border-2 text-sm font-semibold flex items-center justify-center gap-2 ${provider === o.id ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:border-indigo-300"}`}
            data-testid={`payment-${o.id}`}>
            <i className={`fas ${provider === o.id ? "fa-circle-check" : "fa-credit-card"} text-xs`} />{o.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 mt-1.5">{tr("兩種都可以刷信用卡，選你方便的就好。")}</p>
    </div>
  );
}

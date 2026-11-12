import { tr } from "@/lib/i18n";
import { useState, type ReactNode } from "react";

// 黃金專區的成品先模糊顯示。使用者按「顯示圖片」才看得到，
// 避免在公共場合、螢幕分享或截圖時不小心露出來。
// 用法：<SensitiveGate on={generation.sensitive}><img … /></SensitiveGate>
// 外層要有尺寸（這個元件會填滿它）。

export function SensitiveGate({ on, children, compact }: { on: boolean | null | undefined; children: ReactNode; compact?: boolean }) {
  const [shown, setShown] = useState(false);
  if (!on || shown) return <>{children}</>;
  return (
    <div className="relative w-full h-full overflow-hidden" data-testid="sensitive-gate">
      <div className="w-full h-full blur-2xl scale-110 pointer-events-none select-none" aria-hidden="true">{children}</div>
      <div className="absolute inset-0 bg-slate-900/55 flex flex-col items-center justify-center gap-2 p-2 text-center text-white">
        <i className={`fas fa-eye-slash ${compact ? "text-sm" : "text-xl"}`} />
        {!compact && <p className="text-xs leading-snug max-w-[220px]">{tr("這張圖預設隱藏。請確認周圍環境後再顯示。")}</p>}
        <button onClick={(e) => { e.stopPropagation(); setShown(true); }}
          className={`rounded-full bg-white text-slate-900 font-semibold ${compact ? "px-2 h-6 text-[10px]" : "px-4 h-8 text-xs"}`} data-testid="button-show-sensitive">
          {tr("顯示圖片")}
        </button>
      </div>
    </div>
  );
}

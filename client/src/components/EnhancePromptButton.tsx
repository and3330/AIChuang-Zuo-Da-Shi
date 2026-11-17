import { tr } from "@/lib/i18n";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// 「強化提示詞」按鈕：把旁邊輸入框的內容交給 POST /api/prompts/enhance，用對應的強化模組改寫後填回去。
// 免費。改寫後可以按「復原」回到原本的文字。
//   kind  image（圖片／關鍵幀）・video（影片動態，英文）・copy（賣點、要求）・subtitle（一句字幕）
//   context  只當事實參考的補充資訊（例如商品名稱與賣點），不會被當成指令。

export type EnhanceKind = "image" | "video" | "copy" | "subtitle";

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\{[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (typeof j.error === "string") return j.error; } catch { /* fall through */ }
  }
  return msg;
}

export function EnhancePromptButton({ value, onChange, kind, context, disabled, className = "", testId }: {
  value: string;
  onChange: (next: string) => void;
  kind: EnhanceKind;
  context?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [before, setBefore] = useState<string | null>(null);

  const run = async () => {
    const text = value.trim();
    if (!text) { toast({ title: tr("先寫一點內容再強化") }); return; }
    setBusy(true);
    try {
      const res = await apiRequest("POST", "/api/prompts/enhance", { text, kind, context: context?.trim() || undefined });
      const data = await res.json() as { text: string };
      if (data.text && data.text !== text) { setBefore(value); onChange(data.text); }
    } catch (e) {
      toast({ title: tr("強化沒有成功"), description: errorText(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <button type="button" onClick={run} disabled={disabled || busy || !value.trim()}
        className="h-8 px-2.5 rounded-lg border border-violet-200 bg-violet-50 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-40"
        data-testid={testId}>
        <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-wand-magic-sparkles"} mr-1`} />{busy ? tr("強化中…") : tr("強化提示詞")}
      </button>
      {before !== null && !busy && (
        <button type="button" onClick={() => { onChange(before); setBefore(null); }} disabled={disabled}
          className="text-[11px] text-slate-500 underline">{tr("復原")}</button>
      )}
    </span>
  );
}

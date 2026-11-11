import { useState } from "react";
import { useUser } from "@/hooks/use-user";
import { useToast } from "@/hooks/use-toast";
import { VaultPicker } from "@/components/VaultPicker";

// 嵌入模式：客戶小鎮的工作區從 /embed/enter 進來時才會出現。
// 讓使用者從作品庫挑成品送回客戶小鎮（window.postMessage 給開啟這個視窗的頁面）。

export type EmbedInfo = { returnOrigin: string };

/** The embed info of the signed-in session, or null on a normal sign-in. */
export function useEmbed(): EmbedInfo | null {
  const { user } = useUser();
  return ((user as { embed?: EmbedInfo | null } | null | undefined)?.embed) ?? null;
}

export default function EmbedBar() {
  const embed = useEmbed();
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  if (!embed) return null;

  const send = (message: Record<string, unknown>): boolean => {
    const opener = window.opener as Window | null;
    if (!opener || opener.closed) return false;
    opener.postMessage({ source: "ai-studio", ...message }, embed.returnOrigin);
    return true;
  };
  const pick = (url: string) => {
    setPicking(false);
    if (send({ type: "pick", url })) {
      toast({ title: "已送回客戶小鎮", description: "可以繼續挑，或按「完成」回去。" });
    } else {
      navigator.clipboard?.writeText(url).catch(() => undefined);
      toast({ title: "找不到客戶小鎮的視窗", description: "已複製成品網址，請回客戶小鎮貼到貼文的媒體欄。" });
    }
  };
  const done = () => {
    send({ type: "done" });
    window.close();
    // Browsers refuse to close a tab the user opened themselves.
    toast({ title: "可以關閉這個分頁了", description: "回到客戶小鎮後會自動結算這次用掉的點數。" });
  };

  return (
    <>
      <div className="fixed left-3 right-3 md:left-auto md:right-4 bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-4 z-[60] flex items-center gap-2 rounded-full bg-slate-900/95 text-white shadow-xl pl-4 pr-1.5 py-1.5" data-testid="embed-bar">
        <span className="text-xs font-medium flex-1 md:flex-none">客戶小鎮創作模式</span>
        <button onClick={() => setPicking(true)} className="h-9 px-3 rounded-full bg-white text-slate-900 text-sm font-semibold active:bg-slate-100" data-testid="embed-pick">
          挑成品送回小鎮
        </button>
        <button onClick={done} className="h-9 px-3 rounded-full bg-indigo-500 text-white text-sm font-semibold active:bg-indigo-600" data-testid="embed-done">
          完成
        </button>
      </div>
      {picking && <VaultPicker onPick={pick} onClose={() => setPicking(false)} />}
    </>
  );
}

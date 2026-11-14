import { tr, trServer } from "@/lib/i18n";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { IMAGE_COST } from "@shared/pricing";
import { FRONT_FREE_RETRIES, awaitingFrontConfirm, frontRetriesUsed } from "@shared/fourViews";
import type { CharacterLibraryItem, FourViewUrls } from "@shared/schema";
import type { CharacterProfile } from "@shared/characterProfile";

// 「先確認正面圖」：建立角色後只先做正面圖，這裡把它跟使用者的主照片並排，問像不像。
// 像 → 繼續做其餘三張（不再扣積分）。不像 → 重新生成，可以先換一張主照片；
// 前 FRONT_FREE_RETRIES 次免費，之後每次 IMAGE_COST 積分。也可以先關掉，之後在角色庫的卡片上再確認。
// 只有內容，不含遮罩：角色建立視窗直接接著顯示，角色庫則包在自己的彈窗裡（FrontConfirmDialog）。

export function FrontConfirm({ characterId, onDone, onLater }: {
  characterId: string;
  /** The person confirmed; the other three views are being made. */
  onDone: () => void;
  /** Closed without deciding. */
  onLater: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mainPhoto, setMainPhoto] = useState<string | null>(null);
  // Builder characters only: make the face card again too (when the face itself is wrong).
  const [redoFace, setRedoFace] = useState(false);

  const { data: character } = useQuery<CharacterLibraryItem & { profile?: CharacterProfile | null }>({
    queryKey: ["/api/character-library", characterId],
    refetchInterval: query => ((query.state.data as CharacterLibraryItem | undefined)?.fourViewStatus === "generating" ? 3000 : false),
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/character-library"] });
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  };

  const confirm = useMutation({
    mutationFn: () => apiRequest("POST", `/api/character-library/${characterId}/four-views/confirm`, {}),
    onSuccess: () => {
      refresh();
      toast({ title: tr("好，繼續生成其餘三張"), description: tr("大約一兩分鐘後會出現在角色卡片上。") });
      onDone();
    },
    onError: (e: any) => toast({ title: tr("無法繼續"), description: trServer(e.message), variant: "destructive" }),
  });
  const retry = useMutation({
    mutationFn: () => apiRequest("POST", `/api/character-library/${characterId}/four-views/retry-front`, { ...(mainPhoto ? { mainPhoto } : {}), ...(redoFace ? { redoFace: true } : {}) }),
    onSuccess: () => { setMainPhoto(null); setRedoFace(false); refresh(); },
    onError: (e: any) => toast({ title: tr("無法重新生成"), description: trServer(e.message), variant: "destructive" }),
  });

  const status = character?.fourViewStatus ?? "generating";
  const profile = character?.profile && character.profile.facePhotos?.length ? character.profile : null;
  // Builder characters choose among their face photos; the face card is shown beside the result.
  const photos = (profile ? profile.facePhotos : character?.refImageUrls ?? []).slice(0, 10);
  const faceCard = profile?.faceCardUrl;
  const front = ((character?.fourViewUrls ?? {}) as FourViewUrls).front;
  const waiting = awaitingFrontConfirm(status) && !!front;
  const working = !character || status === "generating" || retry.isPending;
  const freeLeft = Math.max(0, FRONT_FREE_RETRIES - frontRetriesUsed(status));
  const chosen = mainPhoto ?? photos[0];

  return (
    <div data-testid="front-confirm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">{tr("先確認正面圖像不像")}</h3>
          <p className="text-sm text-slate-500 mt-1">{tr("像了再往下生成其餘三張，角色才會穩定。")}</p>
        </div>
        <button onClick={onLater} className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100" aria-label={tr("關閉")}>×</button>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <figure>
          <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50" style={{ aspectRatio: "3 / 4" }}>
            {chosen && <img src={chosen} alt={tr("你的主照片")} className="w-full h-full object-cover" />}
          </div>
          <figcaption className="text-[11px] text-slate-500 text-center mt-1">{tr("你的主照片")}</figcaption>
        </figure>
        <figure>
          <div className="rounded-xl overflow-hidden border border-indigo-300 bg-slate-50 flex items-center justify-center" style={{ aspectRatio: "3 / 4" }}>
            {working
              ? <div className="text-center text-indigo-500 px-3"><i className="fas fa-spinner fa-spin text-xl" /><p className="text-xs mt-2">{tr("正面圖生成中，大約一分鐘…")}</p></div>
              : front
                ? <img src={front} alt={tr("AI 生成的正面圖")} className="w-full h-full object-cover" data-testid="img-front-confirm" />
                : <p className="text-xs text-slate-400 px-3 text-center">{tr("還沒有正面圖")}</p>}
          </div>
          <figcaption className="text-[11px] text-slate-500 text-center mt-1">{tr("AI 生成的正面圖")}</figcaption>
        </figure>
      </div>
      {faceCard && !working && (
        <div className="flex items-center gap-3 mt-3 rounded-xl bg-slate-50 border border-slate-200 p-2" data-testid="front-confirm-facecard">
          <img src={faceCard} alt={tr("臉卡")} className="w-16 h-16 rounded-lg object-cover" />
          <p className="text-[11px] text-slate-600 leading-relaxed">{tr("這是 AI 從你的臉部照片做出的臉卡（標準正臉）。角色之後的每張圖都會以它為準。")}</p>
        </div>
      )}

      {!working && character?.fourViewError && (waiting || status === "failed") && (
        <p className="mt-3 text-xs text-red-600" data-testid="front-confirm-error">{trServer(character.fourViewError)}</p>
      )}

      {!working && waiting && (
        <>
          <button onClick={() => confirm.mutate()} disabled={confirm.isPending}
            className="mt-4 w-full h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40" data-testid="button-front-yes">
            {confirm.isPending ? tr("處理中…") : tr("像，繼續生成其餘三張")}
          </button>

          {photos.length > 1 && (
            <div className="mt-4">
              <p className="text-xs text-slate-600">{tr("不像的話，可以先換一張主照片（選臉最清楚的正面照）：")}</p>
              <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                {photos.map((url, i) => (
                  <button key={url} onClick={() => setMainPhoto(url === photos[0] ? null : url)} aria-pressed={url === chosen}
                    aria-label={tr("照片 {0}", { 0: i + 1 })}
                    className={`shrink-0 w-14 rounded-lg overflow-hidden border-2 ${url === chosen ? "border-indigo-500" : "border-slate-200"}`} style={{ aspectRatio: "3 / 4" }}>
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {faceCard && (
            <label className="flex items-start gap-2 mt-3 text-xs text-slate-700 cursor-pointer">
              <input type="checkbox" checked={redoFace || !!mainPhoto} disabled={!!mainPhoto} onChange={e => setRedoFace(e.target.checked)} className="mt-0.5 accent-indigo-600" data-testid="checkbox-redo-face" />
              <span>{tr("連臉卡一起重做（臉不像的時候勾；只是身材或衣服不對就不用勾）")}</span>
            </label>
          )}
          <button onClick={() => retry.mutate()} disabled={confirm.isPending}
            className="mt-3 w-full h-11 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40" data-testid="button-front-retry">
            {freeLeft > 0 ? tr("不像，重新生成（還可免費 {0} 次）", { 0: freeLeft }) : tr("不像，重新生成（{0} 積分）", { 0: IMAGE_COST })}
          </button>
          <p className="text-[11px] text-slate-400 mt-2 text-center">{tr("也可以先關掉，之後在角色庫的角色卡片上再確認。")}</p>
        </>
      )}

      {!working && !waiting && (
        <button onClick={onLater} className="mt-4 w-full h-11 rounded-xl border border-slate-300 text-slate-700 text-sm font-semibold" data-testid="button-front-close">
          {status === "failed" ? tr("關閉，稍後在角色卡片上重新生成") : tr("關閉")}
        </button>
      )}
    </div>
  );
}

/** The same step as a pop-up, opened from a character card that is waiting for confirmation. */
export function FrontConfirmDialog({ characterId, onClose }: { characterId: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end md:items-center justify-center md:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-white w-full md:max-w-xl max-h-[92vh] overflow-auto rounded-t-3xl md:rounded-2xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))]" onClick={e => e.stopPropagation()}>
        <FrontConfirm characterId={characterId} onDone={onClose} onLater={onClose} />
      </div>
    </div>
  );
}

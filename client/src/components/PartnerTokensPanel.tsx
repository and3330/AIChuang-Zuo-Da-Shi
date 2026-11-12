import { tr, dateLocale } from "@/lib/i18n";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PartnerCharactersPanel } from "./PartnerCharactersPanel";

// 後台：對外服務 API 的權杖管理。
// 權杖明文只在建立當下顯示一次（伺服器只存 SHA-256），關閉視窗後無法再取得。

type TokenRow = {
  id: string;
  name: string;
  userId: string;
  tokenPrefix: string;
  allowNsfw: boolean;
  rateLimitPerMinute: number;
  dailyImageLimit: number | null;
  dailyVideoLimit: number | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
type UserRow = { id: string; username: string; email: string | null; credits: number };

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\{[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (typeof j.error === "string") return j.error; } catch { /* fall through */ }
  }
  return msg;
}

function fmt(d: string | null): string {
  return d ? new Date(d).toLocaleString(dateLocale(), { hour12: false }) : "—";
}

/** "" → null (no limit); otherwise a positive integer, or undefined when invalid. */
function parseLimit(v: string): number | null | undefined {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

export function PartnerTokensPanel({ users }: { users: UserRow[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [allowNsfw, setAllowNsfw] = useState(false);
  const [rate, setRate] = useState("60");
  const [dailyImages, setDailyImages] = useState("");
  const [dailyVideos, setDailyVideos] = useState("");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: tokens = [], isLoading, error } = useQuery<TokenRow[]>({ queryKey: ["/api/admin/partner-tokens"] });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-tokens"] });
  const userLabel = (id: string) => {
    const u = users.find(x => x.id === id);
    return u ? `${u.username}${u.email ? `（${u.email}）` : ""}` : id;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const rateN = Number(rate);
      const img = parseLimit(dailyImages);
      const vid = parseLimit(dailyVideos);
      if (!name.trim()) throw new Error(tr("請填寫權杖名稱"));
      if (!userId) throw new Error(tr("請選擇要綁定的帳號"));
      if (!Number.isInteger(rateN) || rateN < 1) throw new Error(tr("每分鐘請求數必須是正整數"));
      if (img === undefined || vid === undefined) throw new Error(tr("每日上限必須是正整數，或留空表示不限制"));
      const res = await apiRequest("POST", "/api/admin/partner-tokens", {
        name: name.trim(), userId, allowNsfw, rateLimitPerMinute: rateN, dailyImageLimit: img, dailyVideoLimit: vid,
      });
      return res.json() as Promise<TokenRow & { token: string }>;
    },
    onSuccess: (data) => {
      setFresh({ name: data.name, token: data.token });
      setCopied(false);
      setName(""); setAllowNsfw(false); setDailyImages(""); setDailyVideos("");
      refresh();
    },
    onError: (e) => toast({ title: tr("建立失敗"), description: errorText(e), variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: async (v: { id: string; body: Record<string, unknown> }) => apiRequest("PATCH", `/api/admin/partner-tokens/${v.id}`, v.body),
    onSuccess: () => { refresh(); toast({ title: tr("已更新") }); },
    onError: (e) => toast({ title: tr("更新失敗"), description: errorText(e), variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/admin/partner-tokens/${id}/revoke`),
    onSuccess: () => { refresh(); toast({ title: tr("權杖已撤銷"), description: tr("使用這個權杖的請求會立即失效。") }); },
    onError: (e) => toast({ title: tr("撤銷失敗"), description: errorText(e), variant: "destructive" }),
  });

  const editLimit = (t: TokenRow, field: "dailyImageLimit" | "dailyVideoLimit" | "rateLimitPerMinute", label: string) => {
    const current = t[field];
    const input = window.prompt(`${label}${field === "rateLimitPerMinute" ? "" : tr("（留空 = 不限制）")}`, current === null ? "" : String(current));
    if (input === null) return;
    const parsed = parseLimit(input);
    if (parsed === undefined || (field === "rateLimitPerMinute" && parsed === null)) {
      toast({ title: tr("請輸入正整數"), variant: "destructive" });
      return;
    }
    patchMutation.mutate({ id: t.id, body: { [field]: parsed } });
  };

  const inputCls = "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent";

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <i className="fas fa-key text-purple-500"></i>{tr("對外服務權杖")}
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          {tr("給其他系統的後端呼叫")}<code className="text-xs bg-gray-100 px-1 py-0.5 rounded">/api/v1/partner/*</code> {tr("使用。")}
          {tr("每個權杖綁定一個帳號，生成時扣該帳號的積分，紀錄也記在該帳號下。說明文件在專案的")}<code className="text-xs bg-gray-100 px-1 py-0.5 rounded">docs/partner-api.md</code>。
        </p>

        <div className="grid md:grid-cols-2 gap-4 mt-5">
          <div>
            <label className="text-xs text-gray-600 block mb-1">{tr("權杖名稱")}</label>
            <input value={name} onChange={e => setName(e.target.value.slice(0, 80))} placeholder={tr("例如：客戶小鎮 正式環境")} className={inputCls} data-testid="input-token-name" />
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">{tr("綁定帳號（扣這個帳號的積分）")}</label>
            <select value={userId} onChange={e => setUserId(e.target.value)} className={inputCls + " bg-white"} data-testid="select-token-user">
              <option value="">{tr("請選擇帳號")}</option>
              {users.map(u => <option key={u.id} value={u.id}>{tr("{0}{1}・{2} 積分", { 0: u.username, 1: u.email ? `（${u.email}）` : "", 2: u.credits })}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 block mb-1">{tr("每分鐘可建立的任務數")}</label>
            <input value={rate} onChange={e => setRate(e.target.value)} inputMode="numeric" className={inputCls} />
            <p className="text-[11px] text-gray-400 mt-1">{tr("查詢任務、餘額等讀取請求的額度是這個數字的 10 倍。")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 block mb-1">{tr("每日圖片上限")}</label>
              <input value={dailyImages} onChange={e => setDailyImages(e.target.value)} inputMode="numeric" placeholder={tr("不限制")} className={inputCls} />
            </div>
            <div>
              <label className="text-xs text-gray-600 block mb-1">{tr("每日影片上限")}</label>
              <input value={dailyVideos} onChange={e => setDailyVideos(e.target.value)} inputMode="numeric" placeholder={tr("不限制")} className={inputCls} />
            </div>
          </div>
        </div>

        <label className="flex items-start gap-2 mt-4 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={allowNsfw} onChange={e => setAllowNsfw(e.target.checked)} className="mt-1 accent-purple-600" data-testid="checkbox-token-nsfw" />
          <span>
            {tr("允許 NSFW 提示詞強化")}
            <span className="block text-xs text-gray-500">
              {tr("預設關閉。開啟後，對方還必須在個別請求加上")}<code className="bg-gray-100 px-1 rounded">"nsfw": true</code> {tr("才會套用；成品會發到公開社群的用途請保持關閉。")}
            </span>
          </span>
        </label>

        <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}
          className="mt-4 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-50" data-testid="button-create-token">
          {createMutation.isPending ? tr("建立中…") : tr("建立權杖")}
        </button>
      </div>

      {fresh && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-5" data-testid="panel-fresh-token">
          <p className="text-sm font-semibold text-amber-900">{tr("「{0}」的權杖（只會顯示這一次）", { 0: fresh.name })}</p>
          <p className="text-xs text-amber-800 mt-1">{tr("請立刻複製並存到對方系統的機密設定中。關閉後無法再次查看，遺失只能撤銷並重新建立。")}</p>
          <div className="mt-3 flex gap-2">
            <code className="flex-1 min-w-0 break-all bg-white border border-amber-200 rounded-lg px-3 py-2 text-xs font-mono select-all">{fresh.token}</code>
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(fresh.token); setCopied(true); }
                catch { toast({ title: tr("無法自動複製"), description: tr("請手動選取文字複製。"), variant: "destructive" }); }
              }}
              className="shrink-0 px-3 py-2 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700">
              {copied ? tr("已複製") : tr("複製")}
            </button>
          </div>
          <button onClick={() => setFresh(null)} className="mt-3 text-xs text-amber-900 underline">{tr("我已保存，關閉")}</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200 text-sm font-semibold text-gray-900">{tr("現有權杖")}</div>
        {isLoading ? (
          <p className="p-5 text-sm text-gray-500">{tr("載入中…")}</p>
        ) : error ? (
          <p className="p-5 text-sm text-red-600">{errorText(error)}</p>
        ) : tokens.length === 0 ? (
          <p className="p-5 text-sm text-gray-500">{tr("還沒有權杖。")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">{tr("名稱")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("綁定帳號")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("限制")}</th>
                  <th className="text-left px-4 py-2 font-medium">NSFW</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("最後使用")}</th>
                  <th className="text-left px-4 py-2 font-medium">{tr("狀態")}</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tokens.map(t => {
                  const revoked = !!t.revokedAt;
                  return (
                    <tr key={t.id} className={revoked ? "bg-gray-50 text-gray-400" : ""} data-testid={`row-token-${t.id}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{t.name}</div>
                        <div className="text-xs font-mono text-gray-400">{t.tokenPrefix}…</div>
                        <div className="text-[11px] text-gray-400">{tr("建立於 {0}", { 0: fmt(t.createdAt) })}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">{userLabel(t.userId)}</td>
                      <td className="px-4 py-3 text-xs space-y-0.5">
                        <button disabled={revoked} onClick={() => editLimit(t, "rateLimitPerMinute", tr("每分鐘可建立的任務數"))} className="block hover:text-purple-600 disabled:hover:text-inherit">{tr("每分鐘 {0} 次", { 0: t.rateLimitPerMinute })}</button>
                        <button disabled={revoked} onClick={() => editLimit(t, "dailyImageLimit", tr("每日圖片上限"))} className="block hover:text-purple-600 disabled:hover:text-inherit">{tr("每日圖片 {0}", { 0: t.dailyImageLimit ?? tr("不限") })}</button>
                        <button disabled={revoked} onClick={() => editLimit(t, "dailyVideoLimit", tr("每日影片上限"))} className="block hover:text-purple-600 disabled:hover:text-inherit">{tr("每日影片 {0}", { 0: t.dailyVideoLimit ?? tr("不限") })}</button>
                      </td>
                      <td className="px-4 py-3">
                        <button disabled={revoked || patchMutation.isPending}
                          onClick={() => {
                            if (!t.allowNsfw && !window.confirm(tr("確定要讓「{0}」可以使用 NSFW 提示詞強化嗎？", { 0: t.name }))) return;
                            patchMutation.mutate({ id: t.id, body: { allowNsfw: !t.allowNsfw } });
                          }}
                          className={`px-2 py-0.5 rounded-full text-xs ${t.allowNsfw ? "bg-rose-100 text-rose-700" : "bg-gray-100 text-gray-600"}`}>
                          {t.allowNsfw ? tr("已開放") : tr("關閉")}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs">{fmt(t.lastUsedAt)}</td>
                      <td className="px-4 py-3 text-xs">
                        {revoked
                          ? <span className="text-red-500">{tr("已撤銷")}<br />{fmt(t.revokedAt)}</span>
                          : <span className="text-green-600">{tr("使用中")}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!revoked && (
                          <button disabled={revokeMutation.isPending}
                            onClick={() => { if (window.confirm(tr("確定撤銷「{0}」？撤銷後無法復原，使用它的系統會立即無法呼叫。", { 0: t.name }))) revokeMutation.mutate(t.id); }}
                            className="text-xs text-red-600 hover:underline" data-testid={`button-revoke-${t.id}`}>
                            {tr("撤銷")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-5 py-3 border-t border-gray-100 text-[11px] text-gray-400">{tr("點擊限制數字可以修改。伺服器只保存權杖的 SHA-256，這裡看到的是開頭幾個字，僅供辨識。")}</p>
      </div>
      <PartnerCharactersPanel />
    </div>
  );
}

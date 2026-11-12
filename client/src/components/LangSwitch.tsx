import { LANGS, getLang, setLang, type Lang } from "@/lib/i18n";

// 語言切換：地球圖示加下拉選單。選了就存起來並重新載入頁面（見 lib/i18n.ts）。
// 放在首頁導覽列、登入頁，以及登入後的「我的」選單與帳戶設定。

export function LangSwitch({ className = "" }: { className?: string }) {
  return (
    <label className={`inline-flex items-center gap-1.5 text-sm cursor-pointer ${className}`} data-testid="lang-switch">
      <i className="fas fa-globe text-xs" aria-hidden="true" />
      <span className="sr-only">Language / 語言</span>
      <select value={getLang()} onChange={e => setLang(e.target.value as Lang)}
        className="bg-transparent text-sm font-medium cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded">
        {LANGS.map(l => <option key={l.id} value={l.id} className="text-slate-900">{l.label}</option>)}
      </select>
    </label>
  );
}

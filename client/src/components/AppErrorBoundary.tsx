import { Component, type ErrorInfo, type ReactNode } from "react";
import { tr } from "@/lib/i18n";

/** A render failure must not leave the entire application blank. */
export default class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    // Do not include props, account details or prompts in diagnostics.
    console.error("[app-render-error]", error.name);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-slate-900">
          <h1 className="text-xl font-bold">{tr("畫面暫時無法顯示")}</h1>
          <p className="mt-3 text-sm text-slate-600">
            {tr("請重新載入頁面。尚未送出的輸入可能需要重新填寫。")}
          </p>
          <button type="button" onClick={() => window.location.reload()}
            className="mt-5 min-h-11 rounded-lg bg-indigo-600 px-5 py-2 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
            {tr("重新載入頁面")}
          </button>
        </div>
      </main>
    );
  }
}

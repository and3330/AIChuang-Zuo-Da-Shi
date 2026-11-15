import { createRoot } from "react-dom/client";
import { loadLanguage } from "./lib/i18n";
import "./index.css";

// The interface language is downloaded first; only then are the app's modules loaded, because many of
// them translate their text once, when they are first imported.
loadLanguage().finally(async () => {
  await import("./lib/i18n-shared");
  const [{ default: App }, { default: AppErrorBoundary }] = await Promise.all([
    import("./App"),
    import("./components/AppErrorBoundary"),
  ]);
  createRoot(document.getElementById("root")!).render(
    <AppErrorBoundary><App /></AppErrorBoundary>,
  );
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
  document.body.classList.add('pwa-standalone');
}

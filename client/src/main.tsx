import "./lib/i18n-shared";
import { createRoot } from "react-dom/client";
import App from "./App";
import AppErrorBoundary from "./components/AppErrorBoundary";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary><App /></AppErrorBoundary>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
  document.body.classList.add('pwa-standalone');
}

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
  document.body.classList.add('pwa-standalone');
}

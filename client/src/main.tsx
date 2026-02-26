import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Service worker registration temporarily disabled for debugging
// if ("serviceWorker" in navigator) {
//   window.addEventListener("load", () => {
//     navigator.serviceWorker.register("/sw.js").catch(() => {});
//   });
// }

if (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone) {
  document.body.classList.add('pwa-standalone');
}

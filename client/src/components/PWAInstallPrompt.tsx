import { tr } from "@/lib/i18n";
import { useState, useEffect } from "react";
import { X, Download, Smartphone } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone;
    if (isStandalone) return;

    const dismissed = localStorage.getItem("pwa-install-dismissed");
    if (dismissed) {
      const dismissedTime = parseInt(dismissed, 10);
      if (Date.now() - dismissedTime < 7 * 24 * 60 * 60 * 1000) return;
    }

    const ua = navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIOS(iosDevice);

    if (iosDevice) {
      const timer = setTimeout(() => setShowBanner(true), 3000);
      return () => clearTimeout(timer);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShowBanner(true), 3000);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setShowBanner(false);
      }
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setShowIOSGuide(false);
    localStorage.setItem("pwa-install-dismissed", String(Date.now()));
  };

  if (!showBanner) return null;

  if (isIOS && showIOSGuide) {
    return (
      <div className="fixed inset-0 bg-black/50 z-[9999] flex items-end justify-center p-4">
        <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in slide-in-from-bottom duration-300">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-lg font-bold text-gray-900">{tr("安裝到主畫面")}</h3>
            <button onClick={handleDismiss} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-sm font-bold text-purple-600">1</span>
              </div>
              <p className="text-sm text-gray-700">
                {tr("點擊底部的")}<span className="inline-flex items-center"><svg className="w-5 h-5 text-blue-500 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg></span> <strong>{tr("分享")}</strong>{tr("按鈕")}
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-sm font-bold text-purple-600">2</span>
              </div>
              <p className="text-sm text-gray-700">
                {tr("向下滑動選擇「")}<strong>{tr("加入主畫面")}</strong>」
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 bg-purple-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-sm font-bold text-purple-600">3</span>
              </div>
              <p className="text-sm text-gray-700">
                {tr("點擊右上角「")}<strong>{tr("新增")}</strong>{tr("」即可完成")}
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="w-full mt-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200 transition"
          >
            {tr("我知道了")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-20 left-4 right-4 z-[9998] md:left-auto md:right-6 md:bottom-6 md:max-w-sm animate-in slide-in-from-bottom duration-500">
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-2xl p-4 shadow-2xl text-white">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
            <Smartphone className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm">{tr("安裝 AI 創意工坊 APP")}</h3>
            <p className="text-xs text-white/80 mt-0.5">
              {tr("加入主畫面，享受原生 APP 體驗，隨時隨地 AI 創作")}
            </p>
          </div>
          <button onClick={handleDismiss} className="text-white/60 hover:text-white flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          {isIOS ? (
            <button
              onClick={() => setShowIOSGuide(true)}
              className="flex-1 bg-white text-purple-700 font-semibold text-sm py-2 rounded-xl flex items-center justify-center gap-1.5 hover:bg-purple-50 transition"
            >
              <Download className="w-4 h-4" />
              {tr("查看安裝步驟")}
            </button>
          ) : (
            <button
              onClick={handleInstall}
              className="flex-1 bg-white text-purple-700 font-semibold text-sm py-2 rounded-xl flex items-center justify-center gap-1.5 hover:bg-purple-50 transition"
            >
              <Download className="w-4 h-4" />
              {tr("立即安裝")}
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="px-4 text-white/80 text-sm font-medium hover:text-white transition"
          >
            {tr("稍後")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Only fixed event names are sent. Never forward form values or API responses. */
export type MetaEvent =
  | "PageView" | "CompleteRegistration" | "InitiateCheckout"
  | "AuthEntryClick" | "RegistrationStart" | "LoginSuccess" | "GoogleLoginClick"
  | "ImageToolOpen" | "VideoToolOpen" | "PhotosetToolOpen" | "StoreOpen"
  | "ImageGenerationSubmitted" | "VideoGenerationSubmitted" | "PaymentConfirmed";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

const standard = new Set<MetaEvent>(["PageView", "CompleteRegistration", "InitiateCheckout"]);
const paidSessions = new Set<string>();
const safePaths = new Set([
  "/", "/login", "/create/image", "/create/video", "/photoset",
  "/product", "/ugc", "/drama", "/library", "/character-library", "/store",
]);

export function sendMetaEvent(event: MetaEvent): boolean {
  try {
    if (typeof window === "undefined" || !safePaths.has(window.location.pathname) || !window.fbq) return false;
    window.fbq(standard.has(event) ? "track" : "trackCustom", event);
    return true;
  } catch {
    // A blocked Pixel must never prevent login, generation or checkout.
    return false;
  }
}

/** A successful submission is not the same thing as a completed generation. */
export async function trackGenerationSubmission(method: string, url: string, response: Response) {
  const event = url === "/api/image-generations" ? "ImageGenerationSubmitted"
    : url === "/api/video-generations" ? "VideoGenerationSubmitted" : null;
  if (method !== "POST" || !event || !response.ok) return;
  try {
    const result = await response.clone().json();
    if (!result.error && (result.id || result.batchId)) sendMetaEvent(event);
  } catch { /* Analytics must not affect the original response body. */ }
}

/** Only called after server verification; session IDs stay local, never in Pixel payloads. */
export function trackPaymentConfirmed(sessionId: string) {
  const key = `meta-paid:${sessionId}`;
  try {
    if (paidSessions.has(sessionId)) return;
    try { if (sessionStorage.getItem(key)) return; } catch { /* Private browsing. */ }
    if (!sendMetaEvent("PaymentConfirmed")) return;
    paidSessions.add(sessionId);
    try { sessionStorage.setItem(key, "1"); } catch { /* In-memory deduplication remains. */ }
  } catch { /* Never interrupt payment confirmation. */ }
}

const linkEvents: Record<string, MetaEvent> = {
  "/login": "AuthEntryClick",
  "/create/image": "ImageToolOpen",
  "/create/video": "VideoToolOpen",
  "/photoset": "PhotosetToolOpen",
  "/store": "StoreOpen",
};

/** Capture before SPA navigation; covers mouse, touch and keyboard-activated links. */
export function installMetaButtonEvents() {
  const onClick = (event: MouseEvent) => {
    try {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!link) return;
      const url = new URL(link.getAttribute("href")!, window.location.href);
      if (url.origin !== window.location.origin) return;
      const name = linkEvents[url.pathname];
      if (name) sendMetaEvent(name);
    } catch { /* Nonessential analytics. */ }
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}

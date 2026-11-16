/** Fixed event names; Purchase sends only an allowlisted amount, currency and opaque event ID. */
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
const conversionReceipts = new Set<string>();
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

function sendConversionOnce(event: "CompleteRegistration" | "Purchase", eventId: string, value?: { value: number; currency: string }): boolean {
  const key = `meta-conversion:${event}:${eventId}`;
  try {
    if (conversionReceipts.has(key)) return true;
    try { if (localStorage.getItem(key)) return true; } catch { /* Storage may be blocked. */ }
    if (typeof window === "undefined" || !safePaths.has(window.location.pathname) || !window.fbq) return false;
    window.fbq("track", event, value ?? {}, { eventID: eventId });
    conversionReceipts.add(key);
    try { localStorage.setItem(key, "1"); } catch { /* Memory still prevents duplicate effects. */ }
    return true;
  } catch { return false; }
}

/** Uses only server-verified paid totals, never prices or flags from the return URL. */
export function trackPurchase(purchase: unknown): boolean {
  if (!purchase || typeof purchase !== "object") return false;
  const { value, currency, eventId } = purchase as Record<string, unknown>;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return false;
  if (currency !== "USD" && currency !== "TWD") return false;
  if (typeof eventId !== "string" || !/^purchase_[a-f0-9]{64}$/.test(eventId)) return false;
  return sendConversionOnce("Purchase", eventId, { value, currency });
}

/** Read a session-bound receipt; acknowledge only after fbq accepted it locally. */
export async function trackPendingGoogleRegistration() {
  try {
    const response = await fetch("/api/auth/meta-registration", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const { eventId } = await response.json();
    if (typeof eventId !== "string" || !/^[a-f0-9]{32}$/.test(eventId)) return;
    if (!sendConversionOnce("CompleteRegistration", `registration_${eventId}`)) return;
    await fetch("/api/auth/meta-registration", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId }),
    });
  } catch { /* Analytics must not interrupt sign-in. Retry on a later page load. */ }
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

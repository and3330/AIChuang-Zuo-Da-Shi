// Airwallex: the second way to pay (Stripe stays). The server creates a PaymentIntent, the browser goes to
// Airwallex's hosted payment page, and credits are added when Airwallex reports the intent SUCCEEDED
// (webhook, or the store page checking on its way back). Same approach as the 營業-AI創業家 project.
//
// Environment (names only; values live in Replit Secrets):
//   AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY   API login
//   AIRWALLEX_WEBHOOK_SECRET                 signs webhook calls; without it the webhook refuses everything
//   AIRWALLEX_ENV                            "prod" for real payments; anything else uses the demo environment

import crypto from "node:crypto";

const isProd = () => process.env.AIRWALLEX_ENV === "prod";
const apiBase = () => (isProd() ? "https://api.airwallex.com" : "https://api-demo.airwallex.com");
const checkoutBase = () => (isProd() ? "https://checkout.airwallex.com" : "https://checkout-demo.airwallex.com");

export function airwallexConfigured(): boolean {
  return !!(process.env.AIRWALLEX_CLIENT_ID && process.env.AIRWALLEX_API_KEY);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function token(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const clientId = process.env.AIRWALLEX_CLIENT_ID, apiKey = process.env.AIRWALLEX_API_KEY;
  if (!clientId || !apiKey) throw new Error("Airwallex 尚未設定");
  const res = await fetch(`${apiBase()}/api/v1/authentication/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-client-id": clientId, "x-api-key": apiKey },
  });
  // The response body is not logged: it may echo account details.
  if (!res.ok) throw new Error(`Airwallex login failed (${res.status})`);
  const data = await res.json() as { token: string; expires_at: string };
  cachedToken = { token: data.token, expiresAt: new Date(data.expires_at).getTime() - 60_000 };
  return data.token;
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`Airwallex ${method} ${path.split("?")[0]} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

export type AirwallexIntent = {
  id: string;
  client_secret?: string;
  status: string;
  /** In the currency's major unit (NT$ 500 → 500, US$ 9.99 → 9.99). */
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
};

export async function createIntent(o: {
  amount: number; currency: string; orderId: string; metadata: Record<string, string>;
}): Promise<AirwallexIntent> {
  return call<AirwallexIntent>("POST", "/api/v1/pa/payment_intents/create", {
    request_id: crypto.randomUUID(),
    amount: o.amount,
    currency: o.currency,
    merchant_order_id: o.orderId,
    metadata: o.metadata,
  });
}

export async function getIntent(id: string): Promise<AirwallexIntent> {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) throw new Error("bad intent id");
  return call<AirwallexIntent>("GET", `/api/v1/pa/payment_intents/${id}`);
}

/** Airwallex's hosted payment page for an intent. */
export function hostedCheckoutUrl(o: { intent: AirwallexIntent; successUrl: string; failUrl: string; email?: string | null }): string {
  const qs = new URLSearchParams({
    intent_id: o.intent.id,
    client_secret: o.intent.client_secret ?? "",
    mode: "payment",
    currency: o.intent.currency,
    env: isProd() ? "prod" : "demo",
    successUrl: o.successUrl,
    failUrl: o.failUrl,
  });
  if (o.email) qs.set("customer_email", o.email);
  return `${checkoutBase()}/#/standalone/checkout?${qs.toString()}`;
}

/**
 * Checks a webhook call: HMAC-SHA256 (hex) of the x-timestamp header followed by the raw body, keyed with
 * AIRWALLEX_WEBHOOK_SECRET. Calls older than 10 minutes are refused so a captured call cannot be replayed later.
 */
export function webhookIsGenuine(rawBody: Buffer, timestamp: string | undefined, signature: string | undefined): boolean {
  const secret = process.env.AIRWALLEX_WEBHOOK_SECRET;
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10 * 60_000) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp + rawBody.toString("utf8")).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

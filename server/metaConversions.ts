import { createHash } from "node:crypto";
import type { Express, RequestHandler } from "express";

/** Only actual, paid checkout totals in the currencies this store sells in. */
export function metaPurchase(session: {
  id: string;
  payment_status: string;
  amount_total: number | null;
  currency: string | null;
  metadata: { [key: string]: string } | null;
}) {
  if (session.payment_status !== "paid" || session.metadata?.kind === "gold") return null;
  if (!Number.isSafeInteger(session.amount_total) || session.amount_total! <= 0) return null;
  const currency = session.currency?.toUpperCase();
  if (currency !== "USD" && currency !== "TWD") return null;
  return {
    value: session.amount_total! / 100,
    currency,
    // Do not expose a Stripe checkout ID to Meta.
    eventId: `purchase_${createHash("sha256").update(session.id).digest("hex")}`,
  };
}

export function registerMetaRegistrationRoutes(app: Express, requireAuth: RequestHandler) {
  app.get("/api/auth/meta-registration", requireAuth, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const pending = req.session.pendingMetaRegistration;
    res.json({ eventId: pending && pending.userId === req.session.userId ? pending.eventId : null });
  });

  app.post("/api/auth/meta-registration", requireAuth, (req, res) => {
    const pending = req.session.pendingMetaRegistration;
    if (pending && pending.userId === req.session.userId && pending.eventId === req.body?.eventId) {
      delete req.session.pendingMetaRegistration;
    }
    res.json({ success: true });
  });
}

/**
 * Shared wallet for partner embed sub-accounts.
 *
 * A workspace that enters through /embed/enter has no credits of its own here:
 * its money lives in the partner's system. Every deduction and refund for such
 * an account is forwarded to the partner's wallet endpoint, and the local
 * `credits` column is only a mirror of the partner's balance for display.
 *
 * Configure with PARTNER_WALLET_URL (https) and PARTNER_WALLET_SECRET. The
 * secret is sent as a bearer token and never logged.
 */

import { randomUUID } from "crypto";

export class PartnerWalletError extends Error {
  constructor(public kind: "insufficient" | "unavailable", message: string) { super(message); }
}

function config(): { url: string; secret: string } | null {
  const raw = process.env.PARTNER_WALLET_URL?.trim() ?? "", secret = process.env.PARTNER_WALLET_SECRET?.trim() ?? "";
  if (!raw || !secret) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return { url: url.toString(), secret };
  } catch { return null; }
}
export const partnerWalletConfigured = () => config() !== null;

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** One wallet call. The same `ref` is sent on every retry so the partner can apply it once. */
async function call(action: "charge" | "refund" | "balance", ownerRef: string, amount: number, description: string, attempts: number, timeoutMs = 10_000): Promise<number> {
  const cfg = config();
  if (!cfg) throw new PartnerWalletError("unavailable", "尚未設定對方的錢包端點。");
  const body = JSON.stringify({ action, owner_ref: ownerRef, amount, ref: randomUUID(), description: description.slice(0, 200) });
  for (let attempt = 1; ; attempt++) {
    let status = 0, data: any = null;
    try {
      const res = await fetch(cfg.url, {
        method: "POST", headers: { Authorization: `Bearer ${cfg.secret}`, "Content-Type": "application/json" }, body,
        signal: AbortSignal.timeout(timeoutMs), redirect: "error",
      });
      status = res.status;
      try { data = await res.json(); } catch { data = null; }
    } catch { status = 0; }
    if (status === 200 && typeof data?.balance === "number") return Math.max(0, Math.round(data.balance));
    if (status === 402) throw new PartnerWalletError("insufficient", `積分不足，需要 ${amount} 積分`);
    // 4xx other than 402 will not get better by trying again.
    if ((status >= 400 && status < 500) || attempt >= attempts) throw new PartnerWalletError("unavailable", "暫時無法連上客戶小鎮的點數，請稍後再試。");
    await wait(400 * attempt);
  }
}

export const walletCharge = (ownerRef: string, amount: number, description: string) => call("charge", ownerRef, amount, description, 2);
/** Refunds try harder: a lost refund is the customer's money. */
export const walletRefund = (ownerRef: string, amount: number, description: string) => call("refund", ownerRef, amount, description, 4);
/** Display only, so it gives up quickly instead of holding a page up. */
export const walletBalance = (ownerRef: string) => call("balance", ownerRef, 0, "", 1, 3_000);

const lastBalanceCheck = new Map<string, number>();
/**
 * Refreshes a sub-account's displayed balance in the background, at most once every 20 seconds.
 * Never awaited by a request: pages must not wait on the partner's server just to show a number.
 */
export function refreshBalanceSoon(userId: string, apply: (balance: number) => Promise<void>): void {
  const now = Date.now();
  if (now - (lastBalanceCheck.get(userId) ?? 0) < 20_000) return;
  lastBalanceCheck.set(userId, now);
  void (async () => {
    try {
      const wallet = await walletAccountFor(userId);
      if (wallet) await apply(await walletBalance(wallet.ownerRef));
    } catch { /* keep showing the last known balance */ }
  })();
}

/* ── which local accounts use the partner wallet ── */

export type WalletAccount = { ownerRef: string; serviceUserId: string };
type Lookup = (userId: string) => Promise<WalletAccount | null>;
let lookup: Lookup = async () => null;
const cache = new Map<string, { at: number; value: WalletAccount | null }>();

/** Wired once at startup with the database lookup (kept out of this file so it stays testable). */
export function setWalletAccountLookup(fn: Lookup) { lookup = fn; cache.clear(); }
/** Call when a sub-account is created or first used, so it is recognised right away. */
export function forgetWalletAccount(userId: string) { cache.delete(userId); }

export async function walletAccountFor(userId: string): Promise<WalletAccount | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < (hit.value ? 600_000 : 30_000)) return hit.value;
  const value = await lookup(userId);
  cache.set(userId, { at: Date.now(), value });
  return value;
}

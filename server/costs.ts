/**
 * Provider cost tracking (後台「成本」分頁).
 *
 * Two sources, shown side by side:
 *   1. Our own ledger (provider_costs): one row per successful AtlasCloud
 *      generation, priced with the table below. It is an ESTIMATE — the unit
 *      prices are list prices and can be overridden with environment
 *      variables once the real ones are known.
 *   2. AtlasCloud's billing API (/public/v1/balance and /model-costs): what
 *      the provider actually charged. Shown as returned.
 *
 * Nothing here ever throws into a generation: recording a cost is best effort.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { and, gte, sql } from "drizzle-orm";
import { db } from "./db";
import { providerCosts, creditTransactions } from "@shared/schema";
import { IMAGE_COST, WATERMARK_REMOVAL_COST, VIDEO_COST_PER_SECOND, MEMBERSHIP, SIGNUP_CREDITS } from "@shared/pricing";

const num = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback;
};

/** Unit prices in USD. Defaults are AtlasCloud list prices seen 2026-11; override with env. */
export function costSettings() {
  return {
    /** Seedream 5.5, one output image (2K tier). */
    seedreamImageUsd: num("COST_SEEDREAM_IMAGE_USD", 0.027),
    /** Seedream 5.5 edit, each reference image sent along. */
    seedreamInputImageUsd: num("COST_SEEDREAM_INPUT_IMAGE_USD", 0.0075),
    wanSecondUsd: { "720p": num("COST_WAN_720P_SECOND_USD", 0.05), "1080p": num("COST_WAN_1080P_SECOND_USD", 0.05) } as Record<string, number>,
    libraryImageUsd: num("COST_LIBRARY_IMAGE_USD", 0.004),
    /** What one credit sells for when topped up. */
    creditPriceTwd: num("CREDIT_PRICE_TWD", 1),
    usdTwd: num("USD_TWD_RATE", 32),
    /** Payment processing fee taken from every payment. */
    paymentFeeRate: num("PAYMENT_FEE_RATE", 0.08),
  };
}

export type ProviderUsage =
  | { kind: "image"; model: string; images: number; inputImages: number }
  | { kind: "video"; model: string; seconds: number; resolution: string }
  | { kind: "library"; model: string; images: number };

export function estimateUsd(u: ProviderUsage): number {
  const s = costSettings();
  if (u.kind === "image") return u.images * s.seedreamImageUsd + u.inputImages * s.seedreamInputImageUsd;
  if (u.kind === "video") return u.seconds * (s.wanSecondUsd[u.resolution] ?? s.wanSecondUsd["1080p"]);
  return u.images * s.libraryImageUsd;
}

/** Best effort: a failure to record must never fail a generation. */
export function recordProviderUsage(u: ProviderUsage): void {
  const units = u.kind === "video" ? u.seconds : u.images;
  db.insert(providerCosts).values({
    provider: "atlascloud",
    model: u.model,
    kind: u.kind,
    units,
    unit: u.kind === "video" ? "second" : "image",
    inputImages: u.kind === "image" ? u.inputImages : 0,
    detail: u.kind === "video" ? u.resolution : null,
    costUsd: Number(estimateUsd(u).toFixed(6)),
  }).catch((e) => {
    console.warn("[Costs] could not record usage:", e instanceof Error ? e.message.slice(0, 120) : "unknown");
  });
}

/* ───────── AtlasCloud billing API (real charges) ───────── */

const ATLAS_PUBLIC = "https://api.atlascloud.ai/public/v1";

async function atlasBilling(path: string): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  const key = process.env.ATLASCLOUD_BILLING_API_KEY || process.env.ATLASCLOUD_API_KEY;
  if (!key) return { ok: false, error: "尚未設定 ATLASCLOUD_API_KEY。" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const resp = await fetch(`${ATLAS_PUBLIC}${path}`, { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal });
    if (!resp.ok) {
      const reason = resp.status === 401 || resp.status === 403 ? "這把金鑰沒有讀取帳務的權限" : resp.status === 429 ? "查詢過於頻繁，請稍後再試" : `HTTP ${resp.status}`;
      return { ok: false, error: `AtlasCloud 帳務 API 回應失敗：${reason}。` };
    }
    return { ok: true, data: await resp.json() };
  } catch {
    return { ok: false, error: "連不上 AtlasCloud 帳務 API。" };
  } finally {
    clearTimeout(timer);
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/* ───────── unit economics (does each product make money?) ───────── */

export function unitEconomics() {
  const s = costSettings();
  const creditUsd = (s.creditPriceTwd / s.usdTwd) * (1 - s.paymentFeeRate);
  const memberCreditUsd = (MEMBERSHIP.priceUsd / MEMBERSHIP.credits) * (1 - s.paymentFeeRate);
  const row = (name: string, credits: number, costUsd: number, note = "") => {
    const revenueUsd = credits * creditUsd;
    return {
      name, credits, note,
      revenueUsd: Number(revenueUsd.toFixed(4)),
      costUsd: Number(costUsd.toFixed(4)),
      profitUsd: Number((revenueUsd - costUsd).toFixed(4)),
      marginPct: revenueUsd > 0 ? Math.round(((revenueUsd - costUsd) / revenueUsd) * 100) : 0,
    };
  };
  const img = (inputs: number) => s.seedreamImageUsd + inputs * s.seedreamInputImageUsd;
  return {
    creditNetUsd: Number(creditUsd.toFixed(5)),
    memberCreditNetUsd: Number(memberCreditUsd.toFixed(5)),
    rows: [
      row("文字生圖（有浮水印）", IMAGE_COST, img(0)),
      row("圖片帶 1 張參考圖", IMAGE_COST, img(1)),
      row("寫真 1 張（帶滿 10 張參考圖）", IMAGE_COST, img(10), "最吃成本的情況"),
      row("去浮水印 1 張（帶 4 張參考圖）", IMAGE_COST + WATERMARK_REMOVAL_COST, img(4)),
      row("角色四視圖（4 張，各帶 6 張參考圖）", 4 * IMAGE_COST, 4 * img(6)),
      row("影片 720p 5 秒", 5 * VIDEO_COST_PER_SECOND["720p"], 5 * s.wanSecondUsd["720p"]),
      row("影片 1080p 5 秒", 5 * VIDEO_COST_PER_SECOND["1080p"], 5 * s.wanSecondUsd["1080p"]),
    ],
    freebies: {
      signupCredits: SIGNUP_CREDITS,
      signupWorstCostUsd: Number(((SIGNUP_CREDITS / IMAGE_COST) * img(10)).toFixed(4)),
      membershipNetUsd: Number((MEMBERSHIP.priceUsd * (1 - s.paymentFeeRate)).toFixed(2)),
      membershipWorstCostUsd: Number(((MEMBERSHIP.credits / IMAGE_COST) * img(10)).toFixed(2)),
    },
  };
}

/* ───────── routes ───────── */

export function registerCostRoutes(app: Express, deps: {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
}) {
  app.get("/api/admin/costs", deps.requireAuth, deps.requireAdmin, async (req, res) => {
    const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const settings = costSettings();

    let ledger: { byModel: any[]; byDay: any[]; totalUsd: number; error: string | null } = { byModel: [], byDay: [], totalUsd: 0, error: null };
    try {
      const byModel = await db.select({
        model: providerCosts.model, kind: providerCosts.kind,
        calls: sql<number>`count(*)::int`, units: sql<number>`coalesce(sum(${providerCosts.units}),0)::float`,
        inputImages: sql<number>`coalesce(sum(${providerCosts.inputImages}),0)::int`,
        costUsd: sql<number>`coalesce(sum(${providerCosts.costUsd}),0)::float`,
      }).from(providerCosts).where(gte(providerCosts.createdAt, since)).groupBy(providerCosts.model, providerCosts.kind);
      const byDay = await db.select({
        day: sql<string>`to_char(${providerCosts.createdAt}, 'YYYY-MM-DD')`,
        calls: sql<number>`count(*)::int`, costUsd: sql<number>`coalesce(sum(${providerCosts.costUsd}),0)::float`,
      }).from(providerCosts).where(gte(providerCosts.createdAt, since))
        .groupBy(sql`to_char(${providerCosts.createdAt}, 'YYYY-MM-DD')`).orderBy(sql`1 desc`);
      ledger = { byModel, byDay, totalUsd: byModel.reduce((n, r) => n + Number(r.costUsd), 0), error: null };
    } catch {
      ledger.error = "讀取成本紀錄失敗（資料表可能尚未建立，請先執行 npm run db:push）。";
    }

    // Credits actually spent by users in the same period (consumed minus refunded).
    let credits = { consumed: 0, refunded: 0, toppedUp: 0 };
    try {
      const rows = await db.select({ type: creditTransactions.type, total: sql<number>`coalesce(sum(${creditTransactions.amount}),0)::int` })
        .from(creditTransactions).where(and(gte(creditTransactions.createdAt, since))).groupBy(creditTransactions.type);
      const of = (t: string) => Math.abs(rows.find(r => r.type === t)?.total ?? 0);
      credits = { consumed: of("consume"), refunded: of("refund"), toppedUp: of("topup") };
    } catch { /* leave zeros */ }
    const netCredits = Math.max(0, credits.consumed - credits.refunded);
    const creditNetUsd = (settings.creditPriceTwd / settings.usdTwd) * (1 - settings.paymentFeeRate);

    const end = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [balance, atlasCosts] = await Promise.all([
      atlasBilling("/balance"),
      atlasBilling(`/model-costs?start_date=${ymd(since)}&end_date=${ymd(end)}&group_by[]=model&limit=1000`),
    ]);

    res.setHeader("Cache-Control", "no-store");
    res.json({
      days,
      settings,
      ledger,
      credits: { ...credits, net: netCredits, valueUsd: Number((netCredits * creditNetUsd).toFixed(2)) },
      estimatedProfitUsd: Number((netCredits * creditNetUsd - ledger.totalUsd).toFixed(2)),
      economics: unitEconomics(),
      atlas: {
        balance: balance.ok ? balance.data : null, balanceError: balance.ok ? null : balance.error,
        costs: atlasCosts.ok ? atlasCosts.data : null, costsError: atlasCosts.ok ? null : atlasCosts.error,
      },
    });
  });
}

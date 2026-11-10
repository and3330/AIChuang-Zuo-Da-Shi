/**
 * End-to-end checks for the partner API (server/partnerApi.ts) over real HTTP,
 * with the database, CDN, planner and image/video workers replaced by
 * in-memory fakes. Nothing here touches the network beyond localhost, and no
 * credits or provider calls are involved.
 *
 *   npx tsx scripts/test-partner-api.ts
 *
 * What this does NOT cover: the real Postgres store (server/partnerStore.ts),
 * the real SSRF-guarded download + Bunny upload, the real Claude planner and
 * the real AtlasCloud workers.
 */

import express from "express";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import {
  registerPartnerRoutes, generatePartnerToken, hashPartnerToken,
  PartnerIdempotencyRace, PartnerIngestError, type PartnerStore, type PartnerDeps,
} from "../server/partnerApi";
import type { PartnerJob, PartnerToken } from "../shared/schema";

/* ───────── tiny assertion helpers ───────── */
let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name}${detail !== undefined ? "  → " + JSON.stringify(detail) : ""}`); }
}
function section(title: string) { console.log(`\n${title}`); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ───────── in-memory fakes ───────── */
const CDN = "https://cdn.example.test";
const users = new Map<string, { id: string; credits: number; email: string }>();
const tokens = new Map<string, PartnerToken>();
const jobs = new Map<string, PartnerJob>();
const images = new Map<string, any>();
const videos = new Map<string, any>();
const calls = { runImage: [] as any[], runVideo: [] as any[], ingest: [] as string[], plan: [] as any[], ledger: [] as string[] };
/** How the fake workers behave for the next generations. */
const behaviour = { image: "succeed" as "succeed" | "fail" | "hang" | "partial", video: "succeed" as "succeed" | "fail", plan: "ok" as "ok" | "fail" | "short", storage: true, sessionAdmin: true };
let clock = Date.now();

const store: PartnerStore = {
  async findTokenByHash(hash) { return [...tokens.values()].find(t => t.tokenHash === hash); },
  async touchToken(id) { const t = tokens.get(id); if (t) t.lastUsedAt = new Date(clock); },
  async listTokens() { return [...tokens.values()]; },
  async createToken(d) {
    const row = { id: randomUUID(), ...d, createdAt: new Date(clock), lastUsedAt: null, revokedAt: null } as PartnerToken;
    tokens.set(row.id, row); return row;
  },
  async updateToken(id, u) { const t = tokens.get(id); if (!t) return undefined; Object.assign(t, u); return t; },
  async revokeToken(id) { const t = tokens.get(id); if (!t) return undefined; t.revokedAt = t.revokedAt ?? new Date(clock); return t; },
  async createJob(d) {
    if (d.idempotencyKey && [...jobs.values()].some(j => j.tokenId === d.tokenId && j.idempotencyKey === d.idempotencyKey)) {
      throw new PartnerIdempotencyRace();
    }
    const row = {
      id: randomUUID(), ...d, phase: "queued", generationIds: [], creditsCharged: 0, creditsRefundedExtra: 0,
      error: null, errorCode: null, createdAt: new Date(clock), finishedAt: null,
    } as unknown as PartnerJob;
    jobs.set(row.id, row); return { ...row };
  },
  async getJob(id) { const j = jobs.get(id); return j ? { ...j } : undefined; },
  async findJobByIdempotencyKey(tokenId, key) { const j = [...jobs.values()].find(x => x.tokenId === tokenId && x.idempotencyKey === key); return j ? { ...j } : undefined; },
  async clearIdempotencyKey(id) { const j = jobs.get(id); if (j) j.idempotencyKey = null; },
  async updateJob(id, u) { const j = jobs.get(id); if (j) Object.assign(j, u); },
  async deleteJob(id) { jobs.delete(id); },
};

function addCredits(userId: string, amount: number, why: string) {
  users.get(userId)!.credits += amount;
  calls.ledger.push(`${amount > 0 ? "+" : ""}${amount} ${why}`);
}

const deps: PartnerDeps = {
  store,
  core: {
    async getUser(id) { return users.get(id); },
    async getUserByEmail(email) { return [...users.values()].find(u => u.email === email); },
    async atomicDeductCredits(userId, amount, description) {
      const u = users.get(userId)!;
      if (u.credits < amount) throw new Error("insufficient");
      addCredits(userId, -amount, description);
      return { newBalance: u.credits };
    },
    async atomicAddCredits(userId, amount, description) { addCredits(userId, amount, description); },
    async createImageGeneration(d) {
      const row = { id: randomUUID(), status: "pending", generatedImageUrls: [], bunnyImageUrls: null, bunnyImageUrl: null, errorMessage: null, updatedAt: new Date(clock), ...d };
      images.set(row.id, row); return row as any;
    },
    async getImageGeneration(id) { return images.get(id); },
    async createVideoGeneration(d) {
      const perSec = d.resolution === "720p" ? 8 : 15;
      const row = { id: randomUUID(), status: "pending", bunnyVideoUrl: null, errorMessage: null, updatedAt: new Date(clock), creditsUsed: Math.round(d.duration * perSec), ...d };
      videos.set(row.id, row); return row as any;
    },
    async getVideoGeneration(id) { return videos.get(id); },
    async getUserDailyImageCount(userId) {
      return [...images.values()].filter(g => g.userId === userId).reduce((n, g) => n + Math.max(1, g.maxImages ?? 1), 0);
    },
    async getUserDailyVideoCount(userId) { return [...videos.values()].filter(g => g.userId === userId).length; },
  },
  // Fake workers: mimic what the real ones do to the rows (incl. refunds).
  runImage(id, opts) {
    calls.runImage.push({ id, ...opts });
    const mode = behaviour.image;
    setTimeout(() => {
      const g = images.get(id); if (!g || mode === "hang") { if (g) g.status = "processing"; return; }
      const wanted = Math.max(1, g.maxImages ?? 1);
      if (mode === "fail") {
        g.status = "failed"; g.errorMessage = "AtlasCloud 任務失敗：InputTextSensitiveContentDetected at /internal/path key=sk-SECRET";
        addCredits(g.userId, g.creditsUsed, "worker refund");
      } else {
        const made = mode === "partial" ? Math.max(1, wanted - 1) : wanted;
        g.generatedImageUrls = Array.from({ length: made }, (_, i) => `https://provider.example/tmp/${id}_${i}.jpg`);
        g.bunnyImageUrls = wanted > 1 ? Array.from({ length: made }, (_, i) => `https://storage.bunnycdn.com/users/x/${id}_${i}.jpg`) : null;
        g.bunnyImageUrl = `https://storage.bunnycdn.com/users/x/${id}${wanted > 1 ? "_0" : ""}.jpg`;
        if (made < wanted) addCredits(g.userId, Math.floor(g.creditsUsed / wanted) * (wanted - made), "worker partial refund");
        g.status = "completed";
      }
      g.updatedAt = new Date(clock);
    }, 15);
  },
  runVideo(id, opts) {
    calls.runVideo.push({ id, ...opts });
    const mode = behaviour.video;
    setTimeout(() => {
      const g = videos.get(id); if (!g) return;
      if (mode === "fail") { g.status = "failed"; g.errorMessage = "AtlasCloud 任務輪詢逾時 (last status: processing)"; addCredits(g.userId, g.creditsUsed, "worker refund"); }
      else { g.status = "completed"; g.bunnyVideoUrl = `https://storage.bunnycdn.com/users/x/${id}.mp4`; }
      g.updatedAt = new Date(clock);
    }, 15);
  },
  async ingestImage(url, folder) {
    calls.ingest.push(url);
    if (url.includes("private-host")) throw new PartnerIngestError("invalid_image_url", "圖片網址必須是可公開存取的 https 網址。");
    if (url.includes("not-an-image")) throw new PartnerIngestError("image_download_failed", "無法下載圖片：請確認網址可公開存取、內容是圖片且小於 25MB。");
    return `${CDN}/${folder}/${randomUUID()}.jpg`;
  },
  storageReady: () => behaviour.storage,
  async planPhotoset(input) {
    calls.plan.push(input);
    if (behaviour.plan === "fail") throw new Error("Claude exploded with secret stack at /home/runner/app/server/photoset.ts:99");
    const n = behaviour.plan === "short" ? input.count - 1 : input.count;
    return { analysis: "分析", shots: Array.from({ length: n }, (_, i) => ({ title: `鏡頭 ${i + 1}`, prompt: `鏡頭 ${i + 1} 的描述` })) };
  },
  sizeDimensions(size) { const [w, h] = size.split("x").map(Number); return { width: w, height: h }; },
  cdnUrl: (u) => (u ? u.replace("https://storage.bunnycdn.com", CDN) : u),
  requireAuth: (_req, _res, next) => next(),
  requireAdmin: (_req, res, next) => (behaviour.sessionAdmin ? next() : res.status(403).json({ error: "需要管理員權限" })),
  now: () => clock,
};

/* ───────── harness ───────── */
async function main() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: "admin-1", isAdmin: true }; next(); });
  registerPartnerRoutes(app, deps);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const everyBody: string[] = [];

  async function call(method: string, path: string, opts: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const text = await res.text();
    everyBody.push(text);
    let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers, text };
  }
  async function waitForJob(token: string, id: string) {
    for (let i = 0; i < 100; i++) {
      const r = await call("GET", `/api/v1/partner/jobs/${id}`, { token });
      if (r.json?.status === "succeeded" || r.json?.status === "failed") return r;
      await sleep(10);
    }
    return call("GET", `/api/v1/partner/jobs/${id}`, { token });
  }
  const P = "/api/v1/partner";

  /* accounts + tokens (through the admin API, like a real admin would) */
  users.set("svc", { id: "svc", credits: 1000, email: "svc@example.test" });
  users.set("other", { id: "other", credits: 1000, email: "other@example.test" });
  users.set("poor", { id: "poor", credits: 5, email: "poor@example.test" });

  section("後台：建立與列出權杖");
  const created = await call("POST", "/api/admin/partner-tokens", { body: { name: "客戶小鎮", userEmail: "svc@example.test" } });
  const TOKEN: string = created.json?.token;
  check("建立權杖回傳明文一次", created.status === 200 && typeof TOKEN === "string" && TOKEN.startsWith("ptk_") && TOKEN.length > 40, created.json);
  check("資料庫只存 SHA-256，不存明文", [...tokens.values()].some(t => t.tokenHash === hashPartnerToken(TOKEN)) && /^[0-9a-f]{64}$/.test([...tokens.values()][0].tokenHash) && ![...tokens.values()].some(t => JSON.stringify(t).includes(TOKEN)));
  const listed = await call("GET", "/api/admin/partner-tokens");
  check("列表不含明文或雜湊", listed.status === 200 && !listed.text.includes(TOKEN) && !listed.text.includes("tokenHash") && !listed.text.includes(hashPartnerToken(TOKEN)), listed.text.slice(0, 200));
  check("新權杖預設不開放 NSFW、無每日上限", listed.json?.[0]?.allowNsfw === false && listed.json?.[0]?.dailyImageLimit === null);
  const badUser = await call("POST", "/api/admin/partner-tokens", { body: { name: "x", userEmail: "nobody@example.test" } });
  check("綁定不存在的帳號被拒絕", badUser.status === 400);
  behaviour.sessionAdmin = false;
  const notAdmin = await call("POST", "/api/admin/partner-tokens", { body: { name: "x", userEmail: "svc@example.test" } });
  check("非管理員不能建立權杖", notAdmin.status === 403);
  behaviour.sessionAdmin = true;
  const OTHER: string = (await call("POST", "/api/admin/partner-tokens", { body: { name: "另一家", userId: "other" } })).json.token;
  const POOR: string = (await call("POST", "/api/admin/partner-tokens", { body: { name: "沒錢", userId: "poor" } })).json.token;
  const nsfwCreated = await call("POST", "/api/admin/partner-tokens", { body: { name: "可 NSFW", userId: "other", allowNsfw: true } });
  const NSFW_TOKEN: string = nsfwCreated.json.token;

  section("驗證");
  const noAuth = await call("GET", `${P}/balance`);
  check("沒有權杖 → 401 unauthorized", noAuth.status === 401 && noAuth.json?.code === "unauthorized" && typeof noAuth.json?.error === "string", noAuth.json);
  check("401 帶 WWW-Authenticate", noAuth.headers.get("www-authenticate") === "Bearer");
  const wrong = await call("GET", `${P}/balance`, { token: "ptk_" + "x".repeat(43) });
  check("錯誤權杖 → 401", wrong.status === 401 && wrong.json?.code === "unauthorized");
  const viaOrigin = await call("GET", `${P}/balance`, { token: TOKEN, headers: { Origin: "https://evil.example" } });
  check("帶 Origin 的瀏覽器請求 → 403", viaOrigin.status === 403 && viaOrigin.json?.code === "browser_requests_not_allowed", viaOrigin.json);
  const unknownPath = await call("GET", `${P}/nope`, { token: TOKEN });
  check("未知端點回 JSON 404", unknownPath.status === 404 && unknownPath.json?.code === "not_found");

  section("餘額與價目");
  const bal = await call("GET", `${P}/balance`, { token: TOKEN });
  check("balance 回傳綁定帳號積分", bal.status === 200 && bal.json?.credits === 1000, bal.json);
  const pricing = await call("GET", `${P}/pricing`, { token: TOKEN });
  check("pricing 列出 24 種尺寸與影片費率", pricing.status === 200 && pricing.json?.images?.sizes?.length === 24 && pricing.json?.videos?.per_second?.["1080p"] === 15 && pricing.json?.images?.per_image?.without_watermark === 8, pricing.json?.images?.per_image);
  check("pricing 列出姿勢代號與畫面質感", pricing.json?.photosets?.poses?.length >= 40 && pricing.json?.photosets?.quality_styles?.length === 4);

  section("圖片：輸入驗證（都不應扣點）");
  const before = users.get("svc")!.credits;
  const v1 = await call("POST", `${P}/images`, { token: TOKEN, body: {} });
  check("缺 prompt → 400 invalid_request", v1.status === 400 && v1.json?.code === "invalid_request", v1.json);
  const v2 = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "貓", size: "999x999" } });
  check("不支援的 size → 400", v2.status === 400 && v2.json?.code === "invalid_request");
  const v3 = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "貓", reference_image_urls: ["http://insecure.example/a.jpg"] } });
  check("http 參考圖 → 400", v3.status === 400 && v3.json?.code === "invalid_request");
  const v4 = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "貓", count: 9 } });
  check("count 超過 4 → 400", v4.status === 400);
  const v5 = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "貓", surprise: 1 } });
  check("未知欄位 → 400", v5.status === 400 && /不支援的欄位/.test(v5.json?.error ?? ""), v5.json);
  const v6 = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "貓", reference_image_urls: ["https://private-host.example/a.jpg"] } });
  check("被 SSRF 防護擋下的網址 → 400 invalid_image_url", v6.status === 400 && v6.json?.code === "invalid_image_url", v6.json);
  const v7 = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "貓", reference_image_urls: ["https://files.example/not-an-image.txt"] } });
  check("下載不到圖片 → 422 image_download_failed", v7.status === 422 && v7.json?.code === "image_download_failed", v7.json);
  check("以上失敗都沒有扣點、沒有建立任務", users.get("svc")!.credits === before && jobs.size === 0 && images.size === 0, { credits: users.get("svc")!.credits, jobs: jobs.size });

  section("圖片：文字生圖成功");
  const t2i = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "一隻橘貓坐在窗邊", count: 2, size: "1776x2368", external_ref: "ws_12/post_88" } });
  check("202 + job_id + queued + credits_charged 16", t2i.status === 202 && !!t2i.json?.job_id && t2i.json?.status === "queued" && t2i.json?.credits_charged === 16, t2i.json);
  check("扣了 16 積分", users.get("svc")!.credits === before - 16);
  const t2iRow = [...images.values()].at(-1);
  check("建立的是 text-to-image、無浮水印、2 張", t2iRow.type === "text-to-image" && t2iRow.watermark === false && t2iRow.maxImages === 2 && t2iRow.creditsUsed === 16, t2iRow);
  check("預設不套用提示詞強化（rawPrompt=true）", calls.runImage.at(-1)?.rawPrompt === true);
  const t2iDone = await waitForJob(TOKEN, t2i.json.job_id);
  check("任務 succeeded，2 筆結果", t2iDone.json?.status === "succeeded" && t2iDone.json?.results?.length === 2, t2iDone.json);
  check("結果是 CDN https 網址並帶寬高", t2iDone.json?.results?.every((r: any) => r.url.startsWith(CDN + "/") && r.type === "image" && r.width === 1776 && r.height === 2368), t2iDone.json?.results);
  check("回傳 external_ref、時間與退點 0", t2iDone.json?.external_ref === "ws_12/post_88" && !!t2iDone.json?.created_at && !!t2iDone.json?.finished_at && t2iDone.json?.credits_refunded === 0 && t2iDone.json?.error === null);

  section("圖片：圖生圖、NSFW 控制");
  const i2i = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "換成夜景", reference_image_urls: ["https://img.example/a.jpg", "https://img.example/b.jpg"] } });
  const i2iRow = [...images.values()].at(-1);
  check("有參考圖 → image-to-image，參考圖已轉存 CDN", i2i.status === 202 && i2iRow.type === "image-to-image" && i2iRow.originalImageUrl.startsWith(CDN) && i2iRow.additionalImageUrls.length === 1 && i2iRow.additionalImageUrls[0].startsWith(CDN), i2iRow);
  const creditsBeforeNsfw = users.get("svc")!.credits;
  const nsfwDenied = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "x", nsfw: true } });
  check("權杖未開放卻要求 nsfw → 403 nsfw_not_allowed，不扣點", nsfwDenied.status === 403 && nsfwDenied.json?.code === "nsfw_not_allowed" && users.get("svc")!.credits === creditsBeforeNsfw, nsfwDenied.json);
  const nsfwOk = await call("POST", `${P}/images`, { token: NSFW_TOKEN, body: { prompt: "x", nsfw: true } });
  check("權杖開放且請求指定 nsfw → 套用強化（rawPrompt=false）", nsfwOk.status === 202 && calls.runImage.at(-1)?.rawPrompt === false);
  const nsfwDefault = await call("POST", `${P}/images`, { token: NSFW_TOKEN, body: { prompt: "x" } });
  check("權杖開放但請求未指定 → 仍不套用", nsfwDefault.status === 202 && calls.runImage.at(-1)?.rawPrompt === true);

  section("積分不足");
  const poorBefore = users.get("poor")!.credits;
  const jobsBefore = jobs.size;
  const broke = await call("POST", `${P}/images`, { token: POOR, body: { prompt: "貓" } });
  check("402 insufficient_credits", broke.status === 402 && broke.json?.code === "insufficient_credits" && typeof broke.json?.error === "string", broke.json);
  check("沒有扣點也沒有留下任務", users.get("poor")!.credits === poorBefore && jobs.size === jobsBefore);

  section("Idempotency-Key");
  const runsBefore = calls.runImage.length; const credBefore = users.get("svc")!.credits;
  const idem1 = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "重送測試" }, headers: { "Idempotency-Key": "post-88-img-1" } });
  const idem2 = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "重送測試" }, headers: { "Idempotency-Key": "post-88-img-1" } });
  check("同 key 重送回同一個 job_id", idem1.status === 202 && idem2.status === 202 && idem1.json.job_id === idem2.json.job_id, [idem1.json, idem2.json]);
  check("只扣一次、只生成一次", users.get("svc")!.credits === credBefore - 8 && calls.runImage.length === runsBefore + 1);
  const idem3 = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "內容不同" }, headers: { "Idempotency-Key": "post-88-img-1" } });
  check("同 key 不同內容 → 409 idempotency_key_conflict", idem3.status === 409 && idem3.json?.code === "idempotency_key_conflict", idem3.json);
  const idemOther = await call("POST", `${P}/images`, { token: OTHER, body: { prompt: "重送測試" }, headers: { "Idempotency-Key": "post-88-img-1" } });
  check("不同權杖用同一個 key 互不影響", idemOther.status === 202 && idemOther.json.job_id !== idem1.json.job_id);
  clock += 25 * 60 * 60 * 1000;
  const idemLater = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "重送測試" }, headers: { "Idempotency-Key": "post-88-img-1" } });
  check("超過 24 小時後同 key 視為新請求", idemLater.status === 202 && idemLater.json.job_id !== idem1.json.job_id);
  const [raceA, raceB] = await Promise.all([
    call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "同時送" }, headers: { "Idempotency-Key": "race-1" } }),
    call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "同時送" }, headers: { "Idempotency-Key": "race-1" } }),
  ]);
  check("同時送出的兩個相同請求只產生一個任務", raceA.json?.job_id === raceB.json?.job_id && [...jobs.values()].filter(j => j.idempotencyKey === "race-1").length === 1, [raceA.json, raceB.json]);

  section("任務失敗與退點");
  behaviour.image = "fail";
  const credBeforeFail = users.get("svc")!.credits;
  const failing = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "會失敗" } });
  const failed = await waitForJob(TOKEN, failing.json.job_id);
  check("任務 failed，results 為空", failed.json?.status === "failed" && failed.json?.results?.length === 0, failed.json);
  check("credits_refunded 等於扣的積分，餘額還原", failed.json?.credits_refunded === 8 && failed.json?.credits_charged === 8 && users.get("svc")!.credits === credBeforeFail, { json: failed.json, credits: users.get("svc")!.credits });
  check("錯誤是中文說明＋代碼，且不洩漏內部訊息", failed.json?.code === "content_rejected" && /[一-鿿]/.test(failed.json?.error) && !/sk-SECRET|internal\/path|AtlasCloud/.test(failed.text), failed.json);
  behaviour.image = "partial";
  const part = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "部分成功", count: 3 } });
  const partDone = await waitForJob(TOKEN, part.json.job_id);
  check("部分成功：succeeded、2 筆結果、退 1 張的積分", partDone.json?.status === "succeeded" && partDone.json?.results?.length === 2 && partDone.json?.credits_refunded === 8 && partDone.json?.credits_charged === 24, partDone.json);
  behaviour.image = "hang";
  const hang = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "進行中" } });
  await sleep(40);
  const hanging = await call("GET", `${P}/jobs/${hang.json.job_id}`, { token: TOKEN });
  check("進行中的任務回 processing、沒有 finished_at", hanging.json?.status === "processing" && hanging.json?.finished_at === null && hanging.json?.results?.length === 0, hanging.json);
  behaviour.image = "succeed";

  section("任務隔離");
  const foreign = await call("GET", `${P}/jobs/${t2i.json.job_id}`, { token: OTHER });
  check("別的帳號查不到 → 404 not_found", foreign.status === 404 && foreign.json?.code === "not_found");
  const missing = await call("GET", `${P}/jobs/${randomUUID()}`, { token: TOKEN });
  check("不存在的任務 → 404，與上面無法區分", missing.status === 404 && missing.text === foreign.text);
  const weird = await call("GET", `${P}/jobs/..%2f..%2fetc`, { token: TOKEN });
  check("奇怪的任務代號 → 404", weird.status === 404);

  section("影片");
  const vBad = await call("POST", `${P}/videos`, { token: TOKEN, body: { type: "image-to-video", prompt: "動起來" } });
  check("image-to-video 缺 image_url → 400", vBad.status === 400 && vBad.json?.code === "invalid_request");
  const vBad2 = await call("POST", `${P}/videos`, { token: TOKEN, body: { type: "text-to-video", prompt: "海", duration: 30 } });
  check("duration 超出範圍 → 400", vBad2.status === 400);
  const credBeforeVid = users.get("svc")!.credits;
  const t2v = await call("POST", `${P}/videos`, { token: TOKEN, body: { type: "text-to-video", prompt: "海浪", duration: 5, quality: "1080p", ratio: "9:16", external_ref: "post_9" } });
  check("text-to-video：202，扣 75（5 秒 × 15）", t2v.status === 202 && t2v.json?.credits_charged === 75 && users.get("svc")!.credits === credBeforeVid - 75, t2v.json);
  const t2vDone = await waitForJob(TOKEN, t2v.json.job_id);
  check("影片 succeeded，結果是 CDN mp4 且帶寬高", t2vDone.json?.status === "succeeded" && t2vDone.json?.type === "video" && t2vDone.json?.results?.[0]?.url.startsWith(CDN) && t2vDone.json?.results?.[0]?.type === "video" && t2vDone.json?.results?.[0]?.width === 1080 && t2vDone.json?.results?.[0]?.height === 1920, t2vDone.json);
  const i2v = await call("POST", `${P}/videos`, { token: TOKEN, body: { type: "image-to-video", prompt: "轉頭", image_url: "https://img.example/first.jpg", duration: 4, quality: "720p" } });
  const i2vRow = [...videos.values()].at(-1);
  check("image-to-video：首幀已轉存 CDN，扣 32（4 秒 × 8）", i2v.status === 202 && i2v.json?.credits_charged === 32 && i2vRow.originalImageUrl.startsWith(CDN), i2v.json);
  behaviour.video = "fail";
  const credBeforeVfail = users.get("svc")!.credits;
  const vFail = await call("POST", `${P}/videos`, { token: TOKEN, body: { type: "text-to-video", prompt: "會逾時" } });
  const vFailed = await waitForJob(TOKEN, vFail.json.job_id);
  check("影片失敗：failed、全額退點、逾時代碼", vFailed.json?.status === "failed" && vFailed.json?.credits_refunded === 75 && vFailed.json?.code === "generation_timeout" && users.get("svc")!.credits === credBeforeVfail, vFailed.json);
  behaviour.video = "succeed";

  section("寫真套圖");
  const psBad = await call("POST", `${P}/photosets`, { token: TOKEN, body: { mode: "scene" } });
  check("scene 缺 scene_image_url → 400", psBad.status === 400);
  const psBad2 = await call("POST", `${P}/photosets`, { token: TOKEN, body: { mode: "character" } });
  check("character 沒有參考圖 → 400", psBad2.status === 400);
  const psBad3 = await call("POST", `${P}/photosets`, { token: TOKEN, body: { mode: "scene", scene_image_url: "https://img.example/s.jpg", poses: ["no-such-pose", "stand-relaxed"] } });
  check("未知姿勢代號 → 400", psBad3.status === 400 && /未知的姿勢代號/.test(psBad3.json?.error ?? ""), psBad3.json);
  const credBeforePs = users.get("svc")!.credits;
  const ps = await call("POST", `${P}/photosets`, { token: TOKEN, body: { mode: "scene", scene_image_url: "https://img.example/scene.jpg", reference_image_urls: ["https://img.example/c1.jpg", "https://img.example/c2.jpg"], count: 4, quality_style: "phone", size: "1584x2816", external_ref: "post_set_1" } });
  check("202 queued，扣 32（4 張 × 8）", ps.status === 202 && ps.json?.status === "queued" && ps.json?.credits_charged === 32 && users.get("svc")!.credits === credBeforePs - 32, ps.json);
  const psDone = await waitForJob(TOKEN, ps.json.job_id);
  check("套圖 succeeded，4 筆結果帶寬高", psDone.json?.status === "succeeded" && psDone.json?.type === "photoset" && psDone.json?.results?.length === 4 && psDone.json?.results?.[0]?.width === 1584 && psDone.json?.results?.[0]?.height === 2816, psDone.json);
  const psRows = [...images.values()].slice(-4);
  check("每張都帶情境圖＋角色參考圖，順序正確", psRows.every(r => r.originalImageUrl.startsWith(CDN) && r.additionalImageUrls.length === 2 && r.creditsUsed === 8 && r.type === "image-to-image"));
  check("提示詞附上圖片用途說明與畫面質感", psRows.every(r => r.prompt.includes("第 1 張圖是情境參考") && r.prompt.includes("【質感】手機隨手拍")), psRows[0]?.prompt);
  check("規劃收到正確的模式、張數與比例", calls.plan.at(-1)?.mode === "scene" && calls.plan.at(-1)?.count === 4 && calls.plan.at(-1)?.aspectRatio === "9:16" && calls.plan.at(-1)?.look === "phone", calls.plan.at(-1));
  const psPose = await call("POST", `${P}/photosets`, { token: TOKEN, body: { mode: "character", reference_image_urls: ["https://img.example/c1.jpg"], poses: ["stand-relaxed", "sit-floor-knee", "face-smile"], count: 9 } });
  check("指定 3 個姿勢 → 以姿勢數計費（24）", psPose.status === 202 && psPose.json?.credits_charged === 24 && calls.plan.at(-1)?.count === 3, psPose.json);
  await waitForJob(TOKEN, psPose.json.job_id);
  behaviour.plan = "fail";
  const credBeforePlanFail = users.get("svc")!.credits;
  const psFail = await call("POST", `${P}/photosets`, { token: TOKEN, body: { mode: "character", reference_image_urls: ["https://img.example/c1.jpg"], count: 4 } });
  const psFailed = await waitForJob(TOKEN, psFail.json.job_id);
  check("規劃失敗：failed、planning_failed、全額退點", psFailed.json?.status === "failed" && psFailed.json?.code === "planning_failed" && psFailed.json?.credits_refunded === 32 && users.get("svc")!.credits === credBeforePlanFail, psFailed.json);
  check("規劃失敗不洩漏內部錯誤", !/secret stack|\/home\/runner/.test(psFailed.text));
  behaviour.plan = "short";
  const credBeforeShort = users.get("svc")!.credits;
  const psShort = await call("POST", `${P}/photosets`, { token: TOKEN, body: { mode: "character", reference_image_urls: ["https://img.example/c1.jpg"], count: 4 } });
  const psShortDone = await waitForJob(TOKEN, psShort.json.job_id);
  check("少規劃 1 張：3 筆結果，退 1 張積分", psShortDone.json?.status === "succeeded" && psShortDone.json?.results?.length === 3 && psShortDone.json?.credits_refunded === 8 && users.get("svc")!.credits === credBeforeShort - 24, psShortDone.json);
  behaviour.plan = "ok";

  section("儲存服務未就緒");
  behaviour.storage = false;
  const credBeforeStorage = users.get("svc")!.credits;
  const noStore = await call("POST", `${P}/images`, { token: TOKEN, body: { prompt: "貓" } });
  check("503 storage_unavailable，不扣點", noStore.status === 503 && noStore.json?.code === "storage_unavailable" && users.get("svc")!.credits === credBeforeStorage, noStore.json);
  behaviour.storage = true;

  section("每日上限與頻率限制（針對權杖設定）");
  const limitedRes = await call("POST", "/api/admin/partner-tokens", { body: { name: "有限額", userId: "other", dailyImageLimit: 1_000_000, rateLimitPerMinute: 2 } });
  const LIMITED: string = limitedRes.json.token;
  const r1 = await call("POST", `${P}/images`, { token: LIMITED, body: { prompt: "1" } });
  const r2 = await call("POST", `${P}/images`, { token: LIMITED, body: { prompt: "2" } });
  const r3 = await call("POST", `${P}/images`, { token: LIMITED, body: { prompt: "3" } });
  check("每分鐘 2 次：第 3 次 → 429 rate_limited + Retry-After", r1.status === 202 && r2.status === 202 && r3.status === 429 && r3.json?.code === "rate_limited" && Number(r3.headers.get("retry-after")) >= 1, { s: [r1.status, r2.status, r3.status], ra: r3.headers.get("retry-after") });
  const readStillOk = await call("GET", `${P}/balance`, { token: LIMITED });
  check("查詢端點有較寬的額度，不受影響", readStillOk.status === 200);
  clock += 61_000;
  const afterWindow = await call("POST", `${P}/images`, { token: LIMITED, body: { prompt: "4" } });
  check("過了一分鐘後恢復", afterWindow.status === 202);
  const used = [...images.values()].filter(g => g.userId === "other").reduce((n, g) => n + Math.max(1, g.maxImages ?? 1), 0);
  await call("PATCH", `/api/admin/partner-tokens/${limitedRes.json.id}`, { body: { dailyImageLimit: used + 1, rateLimitPerMinute: 100 } });
  const dOk = await call("POST", `${P}/images`, { token: LIMITED, body: { prompt: "剛好" } });
  const dOver = await call("POST", `${P}/images`, { token: LIMITED, body: { prompt: "超過" } });
  check("每日圖片上限：超過 → 429 daily_limit_reached + Retry-After", dOk.status === 202 && dOver.status === 429 && dOver.json?.code === "daily_limit_reached" && Number(dOver.headers.get("retry-after")) >= 1, [dOk.status, dOver.json]);
  check("未設定上限的權杖不受每日上限限制", (await call("POST", `${P}/images`, { token: OTHER, body: { prompt: "無上限" } })).status === 202);

  section("撤銷權杖");
  const revoke = await call("POST", `/api/admin/partner-tokens/${created.json.id}/revoke`);
  check("撤銷成功並記錄時間", revoke.status === 200 && !!revoke.json?.revokedAt && !revoke.text.includes(TOKEN));
  const afterRevoke = await call("GET", `${P}/balance`, { token: TOKEN });
  check("撤銷後立即失效 → 401", afterRevoke.status === 401 && afterRevoke.json?.code === "unauthorized");
  for (let i = 0; i < 25; i++) await call("GET", `${P}/balance`, { token: "ptk_bad" });
  const flood = await call("GET", `${P}/balance`, { token: "ptk_bad" });
  check("連續驗證失敗會被限流 → 429 + Retry-After", flood.status === 429 && !!flood.headers.get("retry-after"), flood.json);

  section("整體檢查");
  const allText = everyBody.join("\n");
  const partnerBodies = everyBody.filter(b => b.includes('"code"'));
  check("所有錯誤回應都是 { error, code }", partnerBodies.every(b => { try { const j = JSON.parse(b); return typeof j.error === "string" || j.error === null; } catch { return false; } }));
  check("沒有任何回應出現堆疊、金鑰或內部路徑", !/\bat .*\(.*:\d+:\d+\)|ATLASCLOUD|sk-SECRET|\/home\/|node_modules|tokenHash/.test(allText));
  const tokenEchoes = [TOKEN, OTHER, POOR, NSFW_TOKEN, LIMITED].map(t => allText.split(t).length - 1);
  check("明文權杖只在各自的建立回應出現一次", tokenEchoes.every(n => n === 1), tokenEchoes);
  check("所有結果網址都是 CDN https，沒有 /objects/ 或供應商暫時網址", !/provider\.example|"\/objects\//.test(allText));
  const ledgerSum = calls.ledger.reduce((n, l) => n + Number(l.split(" ")[0]), 0);
  check("積分帳目前後一致（起始 + 異動 = 目前）", 2005 + ledgerSum === [...users.values()].reduce((n, u) => n + u.credits, 0), { ledgerSum });

  server.close();
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log("FAILED:\n - " + failures.join("\n - ")); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });

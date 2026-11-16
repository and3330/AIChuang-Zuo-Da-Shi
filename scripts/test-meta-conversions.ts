import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { metaPurchase, registerMetaRegistrationRoutes } from "../server/metaConversions";
import { trackPurchase, trackPendingGoogleRegistration } from "../client/src/lib/metaPixel";

const calls: unknown[][] = [];
const local = new Map<string, string>();
const browser = {
  location: { pathname: "/", href: "https://example.test/", origin: "https://example.test" },
  fbq: (...args: unknown[]) => calls.push(args),
};
Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => local.get(key) ?? null,
  setItem: (key: string, value: string) => local.set(key, value),
} });

const paid = { id: "private-checkout", payment_status: "paid", amount_total: 1999, currency: "usd", metadata: { kind: "membership", userId: "private-user" } };
const purchase = metaPurchase(paid)!;
assert.equal(purchase.value, 19.99);
assert.equal(purchase.currency, "USD");
assert.equal(metaPurchase({ ...paid, amount_total: 50000, currency: "twd" })!.value, 500);
assert.equal(metaPurchase({ ...paid, payment_status: "unpaid" }), null);
assert.equal(metaPurchase({ ...paid, amount_total: null }), null);
assert.equal(metaPurchase({ ...paid, amount_total: 0 }), null);
assert.equal(metaPurchase({ ...paid, currency: "jpy" }), null);
assert.equal(metaPurchase({ ...paid, metadata: { kind: "gold" } }), null);
assert(trackPurchase(purchase));
assert(trackPurchase(purchase));
assert.deepEqual(calls.splice(0), [["track", "Purchase", { value: 19.99, currency: "USD" }, { eventID: purchase.eventId }]]);
assert(!JSON.stringify(purchase).includes("private"));
assert.equal(trackPurchase({ ...purchase, value: NaN }), false);
assert.equal(trackPurchase({ ...purchase, currency: "INVALID" }), false);
assert.equal(trackPurchase({ ...purchase, eventId: "raw-checkout-id" }), false);
browser.location.pathname = "/gold/photoset";
assert.equal(trackPurchase(metaPurchase({ ...paid, id: "another-payment" })), false);
browser.location.pathname = "/";

// Run the actual OAuth callback body with network/storage fakes: no Google calls or user writes.
const source = readFileSync("server/routes.ts", "utf8");
const ast = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
function routeHandler(method: string, path: string, deps: Record<string, unknown>) {
  let handler: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(ast) === "app" && node.expression.name.text === method
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path) {
      handler = node.arguments[node.arguments.length - 1] as ts.ArrowFunction;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(handler, `Missing ${path}`);
  const js = ts.transpileModule(`(${handler!.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(deps), `return ${js}`)(...Object.values(deps));
}

const silentConsole = { log() {}, error() {} };
let mode: "new" | "google" | "email" = "new";
let creations = 0;
const user = { id: "test-user", email: "test@example.invalid", username: "test", isAdmin: false };
const storage = {
  getUserByGoogleId: async () => mode === "google" ? user : undefined,
  getUserByEmail: async () => mode === "email" ? user : undefined,
  getUserByUsername: async () => undefined,
  updateUserGoogleId: async () => {},
  createUser: async () => { creations++; return user; },
  updateUserCredits: async () => {},
  createCreditTransaction: async () => {},
  getUser: async () => user,
};
let oauthRequests = 0;
const oauth = routeHandler("get", "/api/auth/google/callback", {
  storage, randomBytes: () => ({ toString: () => "a".repeat(32) }),
  fetch: async () => Response.json(++oauthRequests % 2 === 1
    ? { access_token: "fake-test-token" } : { id: "test-google", email: user.email, name: "test" }),
  process: { env: {} }, GOOGLE_CLIENT_ID: "test", GOOGLE_CLIENT_SECRET: "test",
  GOOGLE_REDIRECT_URI: "https://example.invalid/callback", SIGNUP_CREDITS: 10, console: silentConsole,
});
for (const scenario of ["new", "google", "email"] as const) {
  mode = scenario;
  const req = { query: { code: "fake", state: "state" }, session: { oauthState: "state" } as Record<string, any> };
  let redirect = "";
  await oauth(req, { redirect: (value: string) => { redirect = value; } });
  assert.equal(redirect, "/");
  assert.equal(req.session.userId, user.id);
  assert.equal(Boolean(req.session.pendingMetaRegistration), scenario === "new");
}
assert.equal(creations, 1, "Existing Google users and email-linked users are not new registrations");
oauthRequests = 0;
await oauth({ query: { code: "fake", state: "wrong" }, session: { oauthState: "state" } }, { redirect: () => {} });
assert.equal(oauthRequests, 0, "Invalid OAuth state must not create a receipt or call Google");

// Verify both real verify-session response branches use Stripe totals after ownership checks.
for (const alreadyProcessed of [false, true]) {
  const verify = routeHandler("post", "/api/stripe/verify-session", {
    stripe: { checkout: { sessions: { retrieve: async () => ({ ...paid, metadata: { userId: user.id, credits: "10", kind: "membership" } }) } } },
    storage: {
      getCreditTransactionByDescription: async () => alreadyProcessed ? {} : undefined,
      getUser: async () => user, atomicAddCredits: async () => {}, setTransactionPayment: async () => {},
    },
    applyPurchasedTier: async () => {}, metaPurchase, console: silentConsole,
  });
  const res = { code: 200, body: null as any, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; } };
  await verify({ body: { sessionId: paid.id }, session: { userId: user.id } }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.purchase, purchase);
  await verify({ body: { sessionId: paid.id }, session: { userId: "someone-else" } }, res);
  assert.equal(res.code, 403);
  assert.equal(res.body.purchase, undefined);
}

const handlers = new Map<string, Function>();
registerMetaRegistrationRoutes({
  get: (path: string, _auth: unknown, fn: Function) => handlers.set(`GET ${path}`, fn),
  post: (path: string, _auth: unknown, fn: Function) => handlers.set(`POST ${path}`, fn),
} as any, (() => {}) as any);
const session: any = { userId: user.id, pendingMetaRegistration: { userId: user.id, eventId: "b".repeat(32) } };
const realFetch = globalThis.fetch;
let acknowledged = 0;
globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
  let body: unknown;
  const post = init?.method === "POST";
  if (post) acknowledged++;
  handlers.get(`${post ? "POST" : "GET"} /api/auth/meta-registration`)!(
    { session, body: post ? JSON.parse(init!.body as string) : undefined },
    { setHeader() {}, json: (value: unknown) => { body = value; } },
  );
  return Response.json(body);
}) as typeof fetch;
await trackPendingGoogleRegistration();
await trackPendingGoogleRegistration();
assert.equal(acknowledged, 1);
assert.equal(session.pendingMetaRegistration, undefined);
assert.deepEqual(calls.splice(0), [["track", "CompleteRegistration", {}, { eventID: `registration_${"b".repeat(32)}` }]]);
session.pendingMetaRegistration = { userId: user.id, eventId: "c".repeat(32) };
browser.fbq = () => { throw new Error("blocked"); };
await trackPendingGoogleRegistration();
assert(session.pendingMetaRegistration, "Blocked Pixel leaves receipt available for retry");
assert.equal(acknowledged, 1);
browser.fbq = (...args) => calls.push(args);
await trackPendingGoogleRegistration();
assert.equal(calls.length, 1);
assert.equal(acknowledged, 2);
session.pendingMetaRegistration = { userId: "someone-else", eventId: "d".repeat(32) };
await trackPendingGoogleRegistration();
assert.equal(calls.length, 1, "Receipts cannot cross user sessions");
globalThis.fetch = realFetch;
console.log("Meta conversions passed: new Google accounts only, session receipt/ack, blocked Pixel retry, paid totals/currencies, both verification branches, ownership, privacy and deduplication");

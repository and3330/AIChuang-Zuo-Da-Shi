import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installMetaButtonEvents, sendMetaEvent, trackGenerationSubmission, trackPaymentConfirmed } from "../client/src/lib/metaPixel";

const calls: unknown[][] = [];
const storage = new Map<string, string>();
const fakeWindow = {
  location: { pathname: "/login", href: "https://example.com/login", origin: "https://example.com" },
  fbq: (...args: unknown[]) => calls.push(args),
};
Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
} });

assert(sendMetaEvent("CompleteRegistration"));
assert.deepEqual(calls.pop(), ["track", "CompleteRegistration"]);
fakeWindow.location.pathname = "/gold/photoset";
assert.equal(sendMetaEvent("ImageGenerationSubmitted"), false);
fakeWindow.location.pathname = "/account";
assert.equal(sendMetaEvent("PageView"), false);
fakeWindow.location.pathname = "/create/image";
const response = Response.json({ id: "private-job", prompt: "private prompt", email: "never-send@example.com" });
await trackGenerationSubmission("POST", "/api/image-generations", response);
assert.deepEqual(calls.pop(), ["trackCustom", "ImageGenerationSubmitted"]);
assert.equal((await response.json()).id, "private-job", "Original body remains readable");
await trackGenerationSubmission("POST", "/api/video-generations", Response.json({ id: "test" }));
assert.deepEqual(calls.pop(), ["trackCustom", "VideoGenerationSubmitted"]);
await trackGenerationSubmission("POST", "/api/image-generations", Response.json({ batchId: "test" }));
assert.deepEqual(calls.pop(), ["trackCustom", "ImageGenerationSubmitted"]);
await trackGenerationSubmission("POST", "/api/image-generations", Response.json({ error: "failure" }, { status: 402 }));
await trackGenerationSubmission("POST", "/api/image-generations", Response.json({ error: "failure" }));
await trackGenerationSubmission("GET", "/api/video-generations", Response.json({ id: "test" }));
await trackGenerationSubmission("POST", "/api/unrelated", Response.json({ id: "test" }));
assert.equal(calls.length, 0, "Errors, reads and unrelated requests must not become conversions");

fakeWindow.location.pathname = "/store";
trackPaymentConfirmed("local-only-session");
trackPaymentConfirmed("local-only-session");
assert.deepEqual(calls.splice(0), [["trackCustom", "PaymentConfirmed"]]);
assert(!JSON.stringify(calls).includes("local-only-session"));
fakeWindow.fbq = () => { throw new Error("Pixel blocked"); };
assert.doesNotThrow(() => sendMetaEvent("InitiateCheckout"));
trackPaymentConfirmed("blocked-session");
fakeWindow.fbq = (...args: unknown[]) => calls.push(args);
trackPaymentConfirmed("blocked-session");
assert.deepEqual(calls.splice(0), [["trackCustom", "PaymentConfirmed"]], "A blocked event was not marked as delivered");

let listener: ((event: unknown) => void) | undefined;
class FakeElement {
  constructor(private href: string) {}
  closest() { return this; }
  getAttribute() { return this.href; }
}
Object.defineProperty(globalThis, "Element", { configurable: true, value: FakeElement });
Object.defineProperty(globalThis, "document", { configurable: true, value: {
  addEventListener: (_name: string, fn: typeof listener, capture: boolean) => { assert(capture); listener = fn; },
  removeEventListener: (_name: string, fn: typeof listener) => { assert.equal(fn, listener); listener = undefined; },
} });
const uninstall = installMetaButtonEvents();
listener!({ target: new FakeElement("/login?email=never-send@example.com") });
listener!({ target: new FakeElement("https://external.example/login") });
assert.deepEqual(calls.splice(0), [["trackCustom", "AuthEntryClick"]], "Only a fixed event, not the URL or user data, is sent");
uninstall();
assert.equal(listener, undefined);

const store = readFileSync("client/src/pages/store.tsx", "utf8");
assert.match(store, /data\.success && !data\.gold && data\.kind !== "gold"/);
const auth = readFileSync("client/src/App.tsx", "utf8");
assert.match(auth, /if \(userData\) sendMetaEvent\(activeTab === "register" \? "CompleteRegistration" : "LoginSuccess"\)/);
console.log("Meta events passed: button routing, success-only submissions, private payload exclusion, payment deduplication, blocked Pixel safety");

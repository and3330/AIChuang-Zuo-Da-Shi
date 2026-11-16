import assert from "node:assert/strict";
import { resolvePaymentProvider } from "../shared/paymentProvider";

for (const zone of [
  "Asia/Bangkok", "Asia/Ho_Chi_Minh", "Asia/Phnom_Penh", "Asia/Vientiane",
  "Asia/Yangon", "Asia/Kuala_Lumpur", "Asia/Singapore", "Asia/Brunei",
  "Asia/Manila", "Asia/Jakarta", "Asia/Pontianak", "Asia/Makassar",
  "Asia/Jayapura", "Asia/Dili", "Asia/Saigon", "Asia/Rangoon",
]) {
  assert.equal(resolvePaymentProvider(true, null, zone), "airwallex", zone);
  assert.equal(resolvePaymentProvider(true, "stripe", zone), "stripe");
  assert.equal(resolvePaymentProvider(false, "airwallex", zone), "stripe");
}
for (const zone of ["Asia/Taipei", "Asia/Tokyo", "America/New_York", "", "unknown"]) {
  assert.equal(resolvePaymentProvider(true, null, zone), "stripe", zone);
  assert.equal(resolvePaymentProvider(true, "airwallex", zone), "airwallex");
}
assert.equal(resolvePaymentProvider(true, "invalid", "Asia/Bangkok"), "airwallex");
console.log("Payment defaults: Southeast Asia, manual overrides and unavailable-provider checks passed.");

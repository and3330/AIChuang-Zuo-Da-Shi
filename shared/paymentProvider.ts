export type PaymentProvider = "stripe" | "airwallex";

// Browser time zones are a default-selection hint, not verified geolocation.
const southeastAsiaTimeZones = new Set([
  "Asia/Bangkok", "Asia/Ho_Chi_Minh", "Asia/Saigon",
  "Asia/Phnom_Penh", "Asia/Vientiane",
  "Asia/Yangon", "Asia/Rangoon",
  "Asia/Kuala_Lumpur", "Asia/Kuching", "Asia/Singapore",
  "Singapore", "Asia/Brunei", "Asia/Manila",
  "Asia/Jakarta", "Asia/Pontianak", "Asia/Makassar",
  "Asia/Ujung_Pandang", "Asia/Jayapura", "Asia/Dili",
]);

export function resolvePaymentProvider(
  available: boolean,
  saved: string | null,
  timeZone: string,
): PaymentProvider {
  if (!available) return "stripe";
  if (saved === "stripe" || saved === "airwallex") return saved;
  return southeastAsiaTimeZones.has(timeZone) ? "airwallex" : "stripe";
}

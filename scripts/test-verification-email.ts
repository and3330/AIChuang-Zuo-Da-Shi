import assert from "node:assert/strict";
import { sendVerificationEmail, verificationSender } from "../server/verificationEmail";

const email = { to: "test@example.invalid", code: "123456", html: "<p>123456</p>" };
await sendVerificationEmail(email, async message => {
  assert.equal(message.from, verificationSender);
  assert.equal(message.to, email.to);
  assert.match(message.text, /123456/);
  assert.match(message.text, /10 分鐘/);
  assert.equal(message.html, email.html);
  return { data: { id: "test-message" }, error: null };
});
await assert.rejects(sendVerificationEmail(email, async () => ({
  data: null, error: { message: "domain not verified" },
})), /did not accept/);
await assert.rejects(sendVerificationEmail(email, async () => ({
  data: null, error: null,
})), /did not accept/);
await assert.rejects(sendVerificationEmail(email, async () => {
  throw new Error("network failed");
}), /network failed/);
console.log("Verification email checks passed (no real emails sent)");

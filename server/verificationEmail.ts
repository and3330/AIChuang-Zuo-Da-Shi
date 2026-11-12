import { Resend } from "resend";

export const verificationSender = "AI 創意工坊 <noreply@cmai-marker.com>";

type VerificationEmail = {
  to: string; code: string; html: string;
  /** "註冊" by default; the word before 驗證碼 in the subject and text. */
  purpose?: string;
  /** "en" sends the English e-mail (subject, text and body) instead of the Chinese one. */
  lang?: "zh" | "en";
};

/** Body of the English verification e-mail. */
export function englishVerificationHtml(code: string): string {
  return `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f5f3ff; border-radius: 16px;">
      <h1 style="font-size: 22px; color: #7c3aed; text-align: center; margin: 0 0 20px;">AI Creative Studio</h1>
      <div style="background: white; border-radius: 12px; padding: 24px; text-align: center;">
        <p style="color: #374151; font-size: 16px; margin-bottom: 8px;">Your verification code is:</p>
        <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #7c3aed; padding: 16px; background: #f5f3ff; border-radius: 8px; margin: 16px 0;">${code}</div>
        <p style="color: #6b7280; font-size: 14px; margin-top: 16px;">The code is valid for 10 minutes.</p>
        <p style="color: #9ca3af; font-size: 12px; margin-top: 8px;">If you did not request this, you can ignore this e-mail.</p>
      </div>
    </div>
  `;
}
type Message = { from: string; to: string; subject: string; text: string; html: string };
type Send = (message: Message) => Promise<{
  data: { id: string } | null;
  error: { message: string } | null;
}>;

const sendWithResend: Send = async message => {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(process.env.RESEND_API_KEY).emails.send(message);
};

export async function sendVerificationEmail(email: VerificationEmail, send: Send = sendWithResend): Promise<void> {
  const result = await send({
    from: verificationSender,
    to: email.to,
    subject: email.lang === "en" ? "AI Creative Studio - Verification code" : `AI 創意工坊 - ${email.purpose ?? "註冊"}驗證碼`,
    text: email.lang === "en"
      ? `Your verification code is ${email.code}. It is valid for 10 minutes. If you did not request this, you can ignore this e-mail.`
      : `您的${email.purpose ?? "註冊"}驗證碼為：${email.code}。有效期為 10 分鐘。如果這不是您本人的操作，請忽略此郵件。`,
    html: email.lang === "en" ? englishVerificationHtml(email.code) : email.html,
  });
  // The SDK returns API failures as `error`; it does not always throw.
  if (result.error || !result.data?.id) {
    throw new Error("Resend did not accept the verification email");
  }
}

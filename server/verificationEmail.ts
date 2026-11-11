import { Resend } from "resend";

export const verificationSender = "AI 創意工坊 <noreply@cmai-marker.com>";

type VerificationEmail = { to: string; code: string; html: string; /** "註冊" by default; the word before 驗證碼 in the subject and text. */ purpose?: string };
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
    subject: `AI 創意工坊 - ${email.purpose ?? "註冊"}驗證碼`,
    text: `您的${email.purpose ?? "註冊"}驗證碼為：${email.code}。有效期為 10 分鐘。如果這不是您本人的操作，請忽略此郵件。`,
    html: email.html,
  });
  // The SDK returns API failures as `error`; it does not always throw.
  if (result.error || !result.data?.id) {
    throw new Error("Resend did not accept the verification email");
  }
}

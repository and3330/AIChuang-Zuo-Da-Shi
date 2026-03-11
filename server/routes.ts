import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import { insertUserSchema, loginSchema, insertImageGenerationSchema, insertTextToImageSchema, insertImageToImageSchema, insertBatchImageToImageSchema, insertImageToVideoSchema, insertTextToVideoSchema, sendVerificationCodeSchema, registerWithVerificationSchema, insertStoryGenerationSchema, type StoryScene } from "@shared/schema";
import nodemailer from "nodemailer";
import { ObjectStorageService } from "./objectStorage";
import { BunnyStorageService, addWatermark } from "./bunnyStorage";
import sharp from "sharp";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

function fixBunnyCdnUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url;
  const cdnHost = process.env.BUNNY_CDN_HOST || "";
  if (!cdnHost) return url;
  const correctHost = cdnHost.startsWith("http") ? cdnHost : `https://${cdnHost}`;
  return url.replace(/https?:\/\/storage\.bunnycdn\.com/, correctHost);
}

function fixBunnyCdnUrls(urls: string[] | null | undefined): string[] | null | undefined {
  if (!urls) return urls;
  return urls.map(u => fixBunnyCdnUrl(u) as string);
}

const gmailTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER || "",
    pass: process.env.GMAIL_APP_PASSWORD || "",
  },
});

function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
    isAdmin: boolean;
  }
}

function convertAspectRatioToSize(size: string): string {
  return size;
}

const SEEDDANCE_MODEL = "ep-20251223142939-njrkd";
const ARK_API_ENDPOINT = "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";

const VIDEO_MODEL = process.env.ARK_VIDEO_MODEL || "ep-20250813120833-g4mpb";
const VIDEO_API_ENDPOINT = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "未登录，请先登录" });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();
  const bunnyStorage = new BunnyStorageService();
  if (bunnyStorage.isConfigured()) {
    console.log("✅ Bunny.net storage configured");
  } else {
    console.log("⚠️ Bunny.net storage not configured - files will not be persisted to CDN");
  }

  const BASE_URL = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : process.env.REPL_SLUG
      ? `https://${process.env.REPL_SLUG}.replit.app`
      : "https://ai-creative-workshop.replit.app";

  app.get("/sitemap.xml", (_req, res) => {
    const pages = [
      { loc: "/", priority: "1.0", changefreq: "daily" },
      { loc: "/login", priority: "0.8", changefreq: "monthly" },
      { loc: "/account", priority: "0.6", changefreq: "monthly" },
      { loc: "/transactions", priority: "0.4", changefreq: "weekly" },
      { loc: "/privacy", priority: "0.3", changefreq: "yearly" },
      { loc: "/terms", priority: "0.3", changefreq: "yearly" },
    ];

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${BASE_URL}${p.loc}</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join("\n")}
</urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(sitemap);
  });

  app.get("/robots.txt", (_req, res) => {
    const robots = `User-agent: *
Allow: /
Allow: /login
Disallow: /admin
Disallow: /api/

Sitemap: ${BASE_URL}/sitemap.xml`;

    res.header("Content-Type", "text/plain");
    res.send(robots);
  });

  // ===== AUTH ROUTES =====

  app.post("/api/auth/send-verification", async (req, res) => {
    try {
      const { email } = sendVerificationCodeSchema.parse(req.body);

      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(400).json({ error: "此電子郵件已被註冊" });
      }

      const recentCode = await storage.getRecentVerificationCode(email);
      if (recentCode) {
        const elapsed = Date.now() - new Date(recentCode.createdAt!).getTime();
        if (elapsed < 60000) {
          const remaining = Math.ceil((60000 - elapsed) / 1000);
          return res.status(429).json({ error: `請等待 ${remaining} 秒後再重新發送` });
        }
      }

      storage.deleteExpiredVerificationCodes().catch(() => {});

      const code = generateVerificationCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await storage.createVerificationCode(email, code, expiresAt);

      const gmailUser = process.env.GMAIL_USER || "";
      await gmailTransporter.sendMail({
        from: `AI 創意工坊 <${gmailUser}>`,
        to: email,
        subject: "AI 創意工坊 - 註冊驗證碼",
        html: `
          <div style="font-family: 'Microsoft JhengHei', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: linear-gradient(135deg, #f5f3ff, #ede9fe); border-radius: 16px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <span style="font-size: 36px;">✨</span>
              <h1 style="font-size: 24px; background: linear-gradient(to right, #7c3aed, #2563eb); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin: 8px 0;">AI 創意工坊</h1>
            </div>
            <div style="background: white; border-radius: 12px; padding: 24px; text-align: center;">
              <p style="color: #374151; font-size: 16px; margin-bottom: 8px;">您的註冊驗證碼為：</p>
              <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #7c3aed; padding: 16px; background: #f5f3ff; border-radius: 8px; margin: 16px 0;">
                ${code}
              </div>
              <p style="color: #6b7280; font-size: 14px; margin-top: 16px;">驗證碼有效期為 10 分鐘，請盡快完成註冊。</p>
              <p style="color: #9ca3af; font-size: 12px; margin-top: 8px;">如果這不是您本人的操作，請忽略此郵件。</p>
            </div>
          </div>
        `,
      });

      console.log(`Verification code sent to ${email}`);
      res.json({ success: true, message: "驗證碼已發送至您的電子郵件" });
    } catch (error: any) {
      console.error("Error sending verification code:", error);
      res.status(500).json({ error: "驗證碼發送失敗，請稍後再試" });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const validatedData = registerWithVerificationSchema.parse(req.body);

      const existingUsername = await storage.getUserByUsername(validatedData.username);
      if (existingUsername) {
        return res.status(400).json({ error: "用户名已存在" });
      }

      const existingEmail = await storage.getUserByEmail(validatedData.email);
      if (existingEmail) {
        return res.status(400).json({ error: "此電子郵件已被註冊" });
      }

      const validCode = await storage.getValidVerificationCode(validatedData.email, validatedData.verificationCode);
      if (!validCode) {
        return res.status(400).json({ error: "驗證碼無效或已過期，請重新獲取" });
      }

      await storage.markVerificationCodeUsed(validCode.id);

      const hashedPassword = await bcrypt.hash(validatedData.password, 10);
      const user = await storage.createUser({ username: validatedData.username, email: validatedData.email, password: hashedPassword });

      const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
      if (adminEmails.includes(validatedData.email.toLowerCase())) {
        await storage.setUserAdmin(user.id, true);
      }

      const welcomeCredits = 10;
      await storage.updateUserCredits(user.id, welcomeCredits);

      await storage.createCreditTransaction({
        userId: user.id,
        type: "topup",
        amount: welcomeCredits,
        balance: welcomeCredits,
        description: "注册欢迎奖励",
      });

      const finalUser = await storage.getUser(user.id);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = finalUser?.isAdmin || false;

      res.json({
        user: {
          id: finalUser!.id,
          username: finalUser!.username,
          email: finalUser!.email,
          credits: finalUser!.credits,
          isAdmin: finalUser!.isAdmin || false,
        },
      });
    } catch (error) {
      console.error("Error registering user:", error);
      res.status(500).json({ error: "注册失败" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const validatedData = loginSchema.parse(req.body);

      const user = await storage.getUserByUsername(validatedData.username);
      if (!user) {
        return res.status(401).json({ error: "用户名或密码错误" });
      }
      if (!user.password) {
        return res.status(401).json({ error: "此帳號使用 Google 登入，請點擊 Google 登入按鈕" });
      }
      const isValid = await bcrypt.compare(validatedData.password, user.password);
      if (!isValid) {
        return res.status(401).json({ error: "用户名或密码错误" });
      }

      const adminEmailList = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
      let isAdminUser = user.isAdmin || false;
      if (adminEmailList.includes(user.email.toLowerCase()) && !user.isAdmin) {
        await storage.setUserAdmin(user.id, true);
        isAdminUser = true;
      }

      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = isAdminUser;

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          credits: user.credits,
          isAdmin: isAdminUser,
        },
      });
    } catch (error) {
      console.error("Error logging in:", error);
      res.status(500).json({ error: "登录失败" });
    }
  });

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
  const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "https://cmai-marker.com/api/auth/google/callback";

  app.get("/api/auth/google", (req, res) => {
    if (!GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: "Google OAuth 未設定" });
    }
    const state = randomBytes(32).toString("hex");
    (req.session as any).oauthState = state;
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      prompt: "select_account",
      state,
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    try {
      const { code, state } = req.query;
      if (!code || typeof code !== "string") {
        return res.redirect("/login?error=google_failed");
      }

      const savedState = (req.session as any).oauthState;
      if (!state || state !== savedState) {
        console.error("OAuth state mismatch");
        return res.redirect("/login?error=google_failed");
      }
      delete (req.session as any).oauthState;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: GOOGLE_REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });

      const tokenData = await tokenRes.json() as any;
      if (!tokenData.access_token) {
        console.error("Google token exchange failed:", tokenData);
        return res.redirect("/login?error=google_failed");
      }

      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const googleUser = await userInfoRes.json() as any;

      if (!googleUser.id || !googleUser.email) {
        return res.redirect("/login?error=google_failed");
      }

      let user = await storage.getUserByGoogleId(googleUser.id);

      if (!user) {
        user = await storage.getUserByEmail(googleUser.email);
        if (user) {
          await storage.updateUserGoogleId(user.id, googleUser.id, googleUser.picture);
        }
      }

      if (!user) {
        let baseUsername = googleUser.name || googleUser.email.split("@")[0];
        let username = baseUsername;
        let suffix = 1;
        while (await storage.getUserByUsername(username)) {
          username = `${baseUsername}_${suffix}`;
          suffix++;
        }

        user = await storage.createUser({
          username,
          email: googleUser.email,
          password: "",
        });

        if (googleUser.picture) {
          await storage.updateUserGoogleId(user.id, googleUser.id, googleUser.picture);
        } else {
          await storage.updateUserGoogleId(user.id, googleUser.id);
        }

        const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
        if (adminEmails.includes(googleUser.email.toLowerCase())) {
          await storage.setUserAdmin(user.id, true);
        }

        const welcomeCredits = 10;
        await storage.updateUserCredits(user.id, welcomeCredits);
        await storage.createCreditTransaction({
          userId: user.id,
          type: "topup",
          amount: welcomeCredits,
          balance: welcomeCredits,
          description: "Google 註冊歡迎獎勵",
        });
        user = await storage.getUser(user.id);
      }

      if (user) {
        const adminEmailsGoogle = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
        if (adminEmailsGoogle.includes(user.email.toLowerCase()) && !user.isAdmin) {
          await storage.setUserAdmin(user.id, true);
          user = { ...user, isAdmin: true };
        }
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.isAdmin = user.isAdmin || false;
      }

      res.redirect("/");
    } catch (error) {
      console.error("Google OAuth error:", error);
      res.redirect("/login?error=google_failed");
    }
  });

  app.post("/api/auth/logout", async (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "登出失败" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "未登录" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "用户不存在" });
    }

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      credits: user.credits,
      isAdmin: user.isAdmin || false,
    });
  });

  // ===== CREDIT ROUTES =====

  app.post("/api/credits/topup", requireAuth, async (req, res) => {
    try {
      const { amount } = req.body;
      if (!amount || !Number.isInteger(amount) || amount <= 0) {
        return res.status(400).json({ error: "充值金额必须为正整数" });
      }

      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ error: "用户不存在" });
      }

      const newBalance = (user.credits || 0) + amount;
      const updatedUser = await storage.updateUserCredits(user.id, newBalance);

      await storage.createCreditTransaction({
        userId: user.id,
        type: "topup",
        amount,
        balance: newBalance,
        description: `充值 ${amount} 积分`,
      });

      res.json({
        user: {
          id: updatedUser!.id,
          username: updatedUser!.username,
          email: updatedUser!.email,
          credits: updatedUser!.credits,
        },
      });
    } catch (error) {
      console.error("Error topping up credits:", error);
      res.status(500).json({ error: "充值失败" });
    }
  });

  app.get("/api/credits/transactions", requireAuth, async (req, res) => {
    try {
      const transactions = await storage.getCreditTransactions(req.session.userId!);
      res.json(transactions);
    } catch (error) {
      console.error("Error getting transactions:", error);
      res.status(500).json({ error: "获取交易记录失败" });
    }
  });

  app.get("/api/credits/balance", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ error: "用户不存在" });
      }
      res.json({ credits: user.credits || 0 });
    } catch (error) {
      console.error("Error getting balance:", error);
      res.status(500).json({ error: "获取余额失败" });
    }
  });

  // ===== STRIPE PAYMENT ROUTES =====

  app.post("/api/stripe/create-checkout", requireAuth, async (req, res) => {
    try {
      const { amount } = req.body;
      if (!amount || !Number.isInteger(amount) || amount < 50) {
        return res.status(400).json({ error: "充值金額最少 50 積分" });
      }

      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ error: "用戶不存在" });
      }

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const baseUrl = `${protocol}://${host}`;

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "twd",
              product_data: {
                name: `AI 創意工坊 - ${amount} 積分`,
                description: `充值 ${amount} 積分（1 積分 = 1 元新台幣）`,
              },
              unit_amount: amount * 100,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${baseUrl}/account?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/account?payment=cancelled`,
        metadata: {
          userId: user.id,
          credits: amount.toString(),
        },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Error creating checkout session:", error?.message || error);
      console.error("Stripe error details:", JSON.stringify(error?.raw || error?.statusCode || "unknown"));
      const message = error?.message || "無法建立付款頁面";
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/stripe/webhook", async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event: Stripe.Event;

    try {
      if (webhookSecret) {
        const sig = req.headers["stripe-signature"] as string;
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else {
        const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
        event = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
      }
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.payment_status !== "paid") {
        return res.json({ received: true });
      }
      const userId = session.metadata?.userId;
      const credits = parseInt(session.metadata?.credits || "0");

      if (userId && credits > 0) {
        try {
          const stripeDesc = `Stripe 付款 ${session.id}`;
          const existingTx = await storage.getCreditTransactionByDescription(stripeDesc);
          if (!existingTx) {
            await storage.atomicAddCredits(userId, credits, stripeDesc);
            console.log(`Stripe webhook: credited ${credits} to user ${userId}`);
          } else {
            console.log(`Stripe webhook: session ${session.id} already processed, skipping`);
          }
        } catch (error) {
          console.error("Error processing Stripe webhook:", error);
        }
      }
    }

    res.json({ received: true });
  });

  app.post("/api/stripe/verify-session", requireAuth, async (req, res) => {
    try {
      const { sessionId } = req.body;
      if (!sessionId) {
        return res.status(400).json({ error: "缺少 session ID" });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(`Stripe verify session: ${sessionId}, status: ${session.payment_status}, metadata:`, session.metadata);

      if (session.payment_status !== "paid") {
        return res.status(400).json({ error: "付款尚未完成" });
      }

      const userId = session.metadata?.userId;
      const credits = parseInt(session.metadata?.credits || "0");

      if (!userId || credits <= 0) {
        return res.status(400).json({ error: "付款資訊無效" });
      }

      if (userId !== req.session.userId) {
        return res.status(403).json({ error: "付款用戶不匹配" });
      }

      const stripeDesc = `Stripe 付款 ${sessionId}`;
      const existingTx = await storage.getCreditTransactionByDescription(stripeDesc);
      if (existingTx) {
        console.log(`Stripe session ${sessionId} already processed, skipping`);
        return res.json({ success: true, credits, alreadyProcessed: true });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "用戶不存在" });
      }

      await storage.atomicAddCredits(userId, credits, stripeDesc);

      const updatedUser = await storage.getUser(userId);
      console.log(`Stripe verify: credited ${credits} to user ${userId}, new balance: ${updatedUser?.credits}`);
      res.json({ success: true, credits, newBalance: updatedUser?.credits });
    } catch (error: any) {
      console.error("Error verifying Stripe session:", error?.message || error);
      res.status(500).json({ error: "驗證付款失敗" });
    }
  });

  // ===== OBJECT STORAGE ROUTES (no auth) =====

  app.get("/public-objects/:filePath(*)", async (req, res) => {
    const filePath = req.params.filePath;
    try {
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        return res.status(404).json({ error: "File not found" });
      }
      objectStorageService.downloadObject(file, res);
    } catch (error) {
      console.error("Error searching for public object:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/objects/:objectPath(*)", async (req, res) => {
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(req.path);
      objectStorageService.downloadObject(objectFile, res);
    } catch (error) {
      console.error("Error accessing object:", error);
      return res.status(404).json({ error: "File not found" });
    }
  });

  app.post("/api/objects/upload", async (req, res) => {
    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      res.json({ uploadURL });
    } catch (error) {
      console.error("Error getting upload URL:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  app.put("/api/objects/set-path", async (req, res) => {
    if (!req.body.imageURL) {
      return res.status(400).json({ error: "imageURL is required" });
    }

    try {
      const objectPath = objectStorageService.normalizeObjectEntityPath(req.body.imageURL);
      res.status(200).json({ objectPath });
    } catch (error) {
      console.error("Error setting object path:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ===== IMAGE GENERATION ROUTES =====

  app.post("/api/image-generations", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "用户不存在" });
      }

      let creditsNeeded: number;
      const WATERMARK_REMOVAL_COST = 5;
      const hasWatermark = req.body.watermark !== false;
      const perImageCost = hasWatermark ? 3 : 3 + WATERMARK_REMOVAL_COST;

      if (req.body.prompts && Array.isArray(req.body.prompts)) {
        creditsNeeded = perImageCost * req.body.prompts.length;
      } else if (req.body.sequentialGeneration && req.body.maxImages && req.body.maxImages > 1) {
        creditsNeeded = perImageCost * req.body.maxImages;
      } else {
        creditsNeeded = perImageCost;
      }

      if ((user.credits || 0) < creditsNeeded) {
        return res.status(402).json({
          error: "积分不足",
          required: creditsNeeded,
          current: user.credits || 0,
        });
      }

      const newBalance = (user.credits || 0) - creditsNeeded;
      await storage.updateUserCredits(userId, newBalance);
      const watermarkNote = hasWatermark ? "" : "（含去浮水印）";
      await storage.createCreditTransaction({
        userId,
        type: "consume",
        amount: -creditsNeeded,
        balance: newBalance,
        description: `圖片生成消耗 ${creditsNeeded} 積分${watermarkNote}`,
      });

      if (req.body.prompts && Array.isArray(req.body.prompts)) {
        const validatedData = insertBatchImageToImageSchema.parse(req.body);
        const generations = await storage.createBatchImageGenerations({ ...validatedData, userId });

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        generations.forEach(gen => {
          processImageGeneration(gen.id, baseUrl).catch(console.error);
        });

        res.json({
          batchId: generations[0].batchId,
          generations,
          totalCount: generations.length,
          totalCost: generations.length * 0.05,
        });
      } else {
        const requestType = req.body.type || "image-to-image";
        let validatedData;

        if (requestType === "text-to-image") {
          validatedData = insertTextToImageSchema.parse(req.body);
        } else {
          validatedData = insertImageToImageSchema.parse(req.body);
        }

        const generation = await storage.createImageGeneration({ ...validatedData, userId });

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        processImageGeneration(generation.id, baseUrl).catch(console.error);

        res.json(generation);
      }
    } catch (error: any) {
      console.error("Error creating image generation:", error);
      const errorMsg = error?.issues ? `驗證失敗: ${error.issues.map((i: any) => i.message).join(', ')}` :
                       error?.message || "圖片生成請求失敗";
      res.status(500).json({ error: errorMsg });
    }
  });

  app.get("/api/image-generations/:id", requireAuth, async (req, res) => {
    try {
      const generation = await storage.getImageGeneration(req.params.id);
      if (!generation) {
        return res.status(404).json({ error: "Generation not found" });
      }
      const result = { ...generation };
      result.bunnyImageUrl = fixBunnyCdnUrl(result.bunnyImageUrl) as string;
      result.bunnyImageUrls = fixBunnyCdnUrls(result.bunnyImageUrls) as string[];
      if (result.bunnyImageUrl) {
        result.generatedImageUrl = result.bunnyImageUrl;
      }
      if (result.bunnyImageUrls && result.bunnyImageUrls.length > 0) {
        result.generatedImageUrls = result.bunnyImageUrls;
      }
      res.json(result);
    } catch (error) {
      console.error("Error getting image generation:", error);
      res.status(500).json({ error: "Failed to get image generation" });
    }
  });

  app.get("/api/batch-generations/:batchId", requireAuth, async (req, res) => {
    try {
      const rawGenerations = await storage.getImageGenerationsByBatchId(req.params.batchId);
      if (rawGenerations.length === 0) {
        return res.status(404).json({ error: "Batch not found" });
      }
      const generations = rawGenerations.map(g => {
        const r = { ...g };
        r.bunnyImageUrl = fixBunnyCdnUrl(r.bunnyImageUrl) as string;
        r.bunnyImageUrls = fixBunnyCdnUrls(r.bunnyImageUrls) as string[];
        if (r.bunnyImageUrl) r.generatedImageUrl = r.bunnyImageUrl;
        if (r.bunnyImageUrls && r.bunnyImageUrls.length > 0) r.generatedImageUrls = r.bunnyImageUrls;
        return r;
      });
      res.json({
        batchId: req.params.batchId,
        generations,
        totalCount: generations.length,
        completedCount: generations.filter(g => g.status === 'completed').length,
        failedCount: generations.filter(g => g.status === 'failed').length,
        totalCost: generations.reduce((sum, gen) => sum + (gen.cost || 0), 0),
      });
    } catch (error) {
      console.error("Error getting batch generations:", error);
      res.status(500).json({ error: "Failed to get batch generations" });
    }
  });

  app.get("/api/image-generations", async (req, res) => {
    try {
      const rawGenerations = await storage.getAllImageGenerations();
      const generations = rawGenerations.map(g => {
        const r = { ...g };
        r.bunnyImageUrl = fixBunnyCdnUrl(r.bunnyImageUrl) as string;
        r.bunnyImageUrls = fixBunnyCdnUrls(r.bunnyImageUrls) as string[];
        if (r.bunnyImageUrl) r.generatedImageUrl = r.bunnyImageUrl;
        if (r.bunnyImageUrls && r.bunnyImageUrls.length > 0) r.generatedImageUrls = r.bunnyImageUrls;
        return r;
      });
      res.json(generations);
    } catch (error) {
      console.error("Error getting image generations:", error);
      res.status(500).json({ error: "Failed to get image generations" });
    }
  });

  // ===== STATS =====

  app.get("/api/stats", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      const stats = await storage.getUserStats(userId);
      res.json({ ...stats, credits: user?.credits || 0 });
    } catch (error) {
      console.error("Error getting stats:", error);
      res.status(500).json({ error: "Failed to get statistics" });
    }
  });

  // ===== IMAGE GENERATION PROCESSING =====

  async function processImageGeneration(generationId: string, baseUrl?: string) {
    try {
      await storage.updateImageGeneration(generationId, { status: "processing" });
      
      const generation = await storage.getImageGeneration(generationId);
      if (!generation) return;

      const generationUser = await storage.getUser(generation.userId);
      const userFolder = generationUser?.username || generation.userId;

      const startTime = Date.now();
      
      let requestBody: any;
      let apiKey: string | undefined;
      
      apiKey = process.env.ARK_API_KEY;
      
      if (generation.type === "text-to-image") {
        const aspectRatio = generation.size || "1:1";
        const sizeValue = convertAspectRatioToSize(aspectRatio);
        
        const isSequential = generation.sequentialGeneration && generation.maxImages && generation.maxImages > 1;
        
        requestBody = {
          model: SEEDDANCE_MODEL,
          prompt: generation.prompt,
          response_format: "url",
          size: sizeValue,
          sequential_image_generation: isSequential ? "auto" : "disabled",
          stream: isSequential,
          watermark: generation.watermark !== false
        };
        
        if (isSequential) {
          requestBody.sequential_image_generation_options = {
            max_images: generation.maxImages
          };
        }
      } else {
        if (!generation.originalImageUrl) {
          throw new Error("Original image URL is required for image-to-image generation");
        }
        
        const getImageAsDataUri = async (imageUrl: string): Promise<string> => {
          console.log(`Getting image from object storage: ${imageUrl}`);
          const objectFile = await objectStorageService.getObjectEntityFile(imageUrl);
          const chunks: Buffer[] = [];
          const stream = objectFile.createReadStream();
          
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          
          const imageBuffer = Buffer.concat(chunks);
          const base64Image = imageBuffer.toString('base64');
          return `data:image/jpeg;base64,${base64Image}`;
        };
        
        const primaryDataUri = await getImageAsDataUri(generation.originalImageUrl);
        console.log(`✅ Primary image converted to base64`);
        
        const hasMultipleImages = generation.additionalImageUrls && generation.additionalImageUrls.length > 0;
        
        let imageParam: string | string[];
        
        if (hasMultipleImages) {
          const additionalDataUris: string[] = [];
          for (const additionalUrl of generation.additionalImageUrls!) {
            const dataUri = await getImageAsDataUri(additionalUrl);
            additionalDataUris.push(dataUri);
            console.log(`✅ Additional image converted to base64`);
          }
          imageParam = [primaryDataUri, ...additionalDataUris];
          console.log(`Using multi-image input with ${imageParam.length} images`);
        } else {
          imageParam = primaryDataUri;
        }
        
        const aspectRatio = generation.size || "2K";
        const sizeValue = convertAspectRatioToSize(aspectRatio);
        
        const isSequentialI2I = generation.sequentialGeneration && generation.maxImages && generation.maxImages > 1;
        
        requestBody = {
          model: SEEDDANCE_MODEL,
          prompt: generation.prompt,
          image: imageParam,
          response_format: "url",
          size: sizeValue,
          sequential_image_generation: isSequentialI2I ? "auto" : "disabled",
          stream: isSequentialI2I,
          watermark: generation.watermark !== false
        };
        
        if (isSequentialI2I) {
          requestBody.sequential_image_generation_options = {
            max_images: generation.maxImages
          };
        }
      }

      console.log(`API Request Body:`, JSON.stringify(requestBody, null, 2));

      console.log(`Using ARK_API_KEY for ${generation.type}: ${apiKey ? 'SET' : 'NOT SET'}`);
      
      if (!apiKey) {
        throw new Error(`ARK_API_KEY environment variable is not set. Please configure your API key for Seedream 5.0.`);
      }
      
      const response = await fetch(ARK_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
      
      console.log(`API response status: ${response.status}`);
      const responseHeaders = Object.fromEntries(response.headers.entries());
      console.log(`API response headers:`, JSON.stringify(responseHeaders, null, 2));

      const processingTime = (Date.now() - startTime) / 1000;

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`❌ BytePlus API Error ${response.status}:`);
        console.log(errorText);
        await storage.updateImageGeneration(generationId, {
          status: "failed",
          errorMessage: `API Error: ${response.status} ${errorText}`,
          processingTime
        });
        return;
      }

      const isSequential = generation.sequentialGeneration && generation.maxImages && generation.maxImages > 1;
      
      if (isSequential) {
        const responseText = await response.text();
        console.log(`Sequential raw response (full length ${responseText.length}):`);
        console.log(responseText.substring(0, 2000));
        if (responseText.length > 2000) {
          console.log(`... (truncated, showing last 1000 chars):`);
          console.log(responseText.substring(responseText.length - 1000));
        }
        const lines = responseText.split('\n').filter(line => line.trim());
        const generatedImageUrls: string[] = [];
        
        const urlRegex = /https?:\/\/[^\s"',\}]+/g;
        
        for (const line of lines) {
          console.log(`Parsing line: ${line.substring(0, 200)}`);
          
          if (line.startsWith('data: ') || line.startsWith('data:')) {
            const jsonStr = line.startsWith('data: ') ? line.slice(6) : line.slice(5);
            if (jsonStr.trim() === '[DONE]') continue;
            
            try {
              const data = JSON.parse(jsonStr);
              console.log(`Parsed streaming data keys: ${Object.keys(data).join(', ')}`);
              
              if (data.url) {
                generatedImageUrls.push(data.url.replace(/&amp;/g, '&'));
                console.log(`Found URL in data.url`);
              }
              if (data.data && Array.isArray(data.data)) {
                for (const item of data.data) {
                  if (item.url) {
                    generatedImageUrls.push(item.url.replace(/&amp;/g, '&'));
                    console.log(`Found URL in data.data[].url`);
                  }
                  if (item.b64_json) {
                    console.log(`Found b64_json in data.data[] (not URL)`);
                  }
                }
              }
              if (data.output && data.output.data && Array.isArray(data.output.data)) {
                for (const item of data.output.data) {
                  if (item.url) {
                    generatedImageUrls.push(item.url.replace(/&amp;/g, '&'));
                    console.log(`Found URL in data.output.data[].url`);
                  }
                }
              }
              if (data.choices && Array.isArray(data.choices)) {
                for (const choice of data.choices) {
                  if (choice.image_url) {
                    generatedImageUrls.push(choice.image_url.replace(/&amp;/g, '&'));
                    console.log(`Found URL in data.choices[].image_url`);
                  }
                }
              }
            } catch (e) {
              console.log(`Failed to parse streaming JSON, trying regex: ${jsonStr.substring(0, 200)}`);
              const matches = jsonStr.match(urlRegex);
              if (matches) {
                for (const match of matches) {
                  if (match.includes('ark-content-generation') || match.includes('.jpeg') || match.includes('.png')) {
                    generatedImageUrls.push(match.replace(/&amp;/g, '&'));
                    console.log(`Found URL via regex fallback`);
                  }
                }
              }
            }
          }
        }
        
        console.log(`Sequential generation completed with ${generatedImageUrls.length} images`);
        
        if (generatedImageUrls.length === 0) {
          await storage.updateImageGeneration(generationId, {
            status: "failed",
            errorMessage: "No generated images in streaming response",
            processingTime
          });
          return;
        }
        
        let bunnyImageUrl: string | undefined;
        let bunnyImageUrls: string[] | undefined;
        if (bunnyStorage.isConfigured()) {
          bunnyImageUrls = [];
          for (let i = 0; i < generatedImageUrls.length; i++) {
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                const imgResp = await fetch(generatedImageUrls[i]);
                let imgBuffer = Buffer.from(await imgResp.arrayBuffer());
                if (generation.watermark !== false) {
                  imgBuffer = await addWatermark(imgBuffer);
                  console.log(`✅ Watermark added to sequential image ${i + 1}`);
                }
                const filename = `${generationId}_${i}.jpg`;
                const remotePath = `users/${userFolder}/images/${filename}`;
                const cdnUrl = await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
                bunnyImageUrls.push(cdnUrl);
                break;
              } catch (e) {
                console.error(`Bunny upload failed (sequential img ${i + 1}, attempt ${attempt}):`, e);
                if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
              }
            }
          }
          if (bunnyImageUrls.length > 0) {
            bunnyImageUrl = bunnyImageUrls[0];
            console.log(`✅ Uploaded ${bunnyImageUrls.length} images to Bunny.net for user ${userFolder}`);
          }
        }

        await storage.updateImageGeneration(generationId, {
          status: "completed",
          generatedImageUrl: generatedImageUrls[0],
          generatedImageUrls,
          bunnyImageUrl,
          bunnyImageUrls,
          processingTime,
          cost: 0.05 * generatedImageUrls.length
        });
      } else {
        const result = await response.json();
        console.log(`📋 API response model info:`, JSON.stringify({
          model: result.model,
          created: result.created,
          object: result.object,
          usage: result.usage
        }, null, 2));
        const generatedImageUrl = result.data?.[0]?.url;

        if (!generatedImageUrl) {
          await storage.updateImageGeneration(generationId, {
            status: "failed",
            errorMessage: "No generated image URL in response",
            processingTime
          });
          return;
        }

        let bunnyImageUrl: string | undefined;
        if (bunnyStorage.isConfigured()) {
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const imgResp = await fetch(generatedImageUrl);
              let imgBuffer = Buffer.from(await imgResp.arrayBuffer());
              if (generation.watermark !== false) {
                imgBuffer = await addWatermark(imgBuffer);
                console.log(`✅ Watermark added to image`);
              }
              const remotePath = `users/${userFolder}/images/${generationId}.jpg`;
              bunnyImageUrl = await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
              console.log(`✅ Uploaded image to Bunny.net for user ${userFolder}: ${bunnyImageUrl}`);
              break;
            } catch (e) {
              console.error(`Bunny upload failed (single, attempt ${attempt}):`, e);
              if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
            }
          }
        }

        await storage.updateImageGeneration(generationId, {
          status: "completed",
          generatedImageUrl,
          bunnyImageUrl,
          processingTime,
          cost: 0.05
        });
      }

    } catch (error) {
      console.error("Error processing image generation:", error);
      try {
        const refunded = await storage.failImageGenerationAndRefund(
          generationId,
          error instanceof Error ? error.message : "Unknown error",
          0
        );
        if (refunded) console.log(`✅ Image generation failed and credits refunded for ${generationId}`);
      } catch (refundError) {
        console.error("Error in failImageGenerationAndRefund:", refundError);
      }
    }
  }

  // ===== VIDEO GENERATION ROUTES =====

  app.post("/api/video-generations", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "用户不存在" });
      }

      const duration = Math.max(4, Math.min(12, req.body.duration || 5));
      const resolution = req.body.resolution === "720p" ? "720p" : "1080p";
      const VIDEO_CREDITS_PER_SECOND = resolution === "720p" ? 3.4 : 6.8;
      const creditsNeeded = Math.round(duration * VIDEO_CREDITS_PER_SECOND);

      if ((user.credits || 0) < creditsNeeded) {
        return res.status(402).json({
          error: "积分不足",
          required: creditsNeeded,
          current: user.credits || 0,
        });
      }

      const newBalance = (user.credits || 0) - creditsNeeded;
      await storage.updateUserCredits(userId, newBalance);
      await storage.createCreditTransaction({
        userId,
        type: "consume",
        amount: -creditsNeeded,
        balance: newBalance,
        description: `视频生成消耗 ${creditsNeeded} 积分`,
      });

      const videoType = req.body.type || "image-to-video";
      const validatedData = videoType === "text-to-video" 
        ? insertTextToVideoSchema.parse(req.body)
        : insertImageToVideoSchema.parse(req.body);
      const generation = await storage.createVideoGeneration({ ...validatedData, userId });

      processVideoGeneration(generation.id, objectStorageService).catch(console.error);

      res.json(generation);
    } catch (error: any) {
      console.error("Error creating video generation:", error);
      const errorMsg = error?.issues ? `驗證失敗: ${error.issues.map((i: any) => i.message).join(', ')}` :
                       error?.message || "影片生成請求失敗";
      res.status(500).json({ error: errorMsg });
    }
  });

  app.get("/api/video-generations/:id", requireAuth, async (req, res) => {
    try {
      const generation = await storage.getVideoGeneration(req.params.id);
      if (!generation) {
        return res.status(404).json({ error: "Video generation not found" });
      }
      const result = { ...generation };
      result.bunnyVideoUrl = fixBunnyCdnUrl(result.bunnyVideoUrl) as string;
      if (result.bunnyVideoUrl) {
        result.generatedVideoUrl = result.bunnyVideoUrl;
      }
      res.json(result);
    } catch (error) {
      console.error("Error getting video generation:", error);
      res.status(500).json({ error: "Failed to get video generation" });
    }
  });

  app.get("/api/video-generations", async (req, res) => {
    try {
      const rawGenerations = await storage.getAllVideoGenerations();
      const generations = rawGenerations.map(g => {
        const r = { ...g };
        r.bunnyVideoUrl = fixBunnyCdnUrl(r.bunnyVideoUrl) as string;
        if (r.bunnyVideoUrl) r.generatedVideoUrl = r.bunnyVideoUrl;
        return r;
      });
      res.json(generations);
    } catch (error) {
      console.error("Error getting video generations:", error);
      res.status(500).json({ error: "Failed to get video generations" });
    }
  });

  async function processVideoGeneration(generationId: string, objectStorageService: ObjectStorageService) {
    try {
      await storage.updateVideoGeneration(generationId, { status: "processing" });
      
      const generation = await storage.getVideoGeneration(generationId);
      if (!generation) return;

      const videoUser = await storage.getUser(generation.userId);
      const userFolder = videoUser?.username || generation.userId;

      const startTime = Date.now();
      const apiKey = process.env.ARK_API_KEY;
      
      if (!apiKey) {
        throw new Error("ARK_API_KEY environment variable is not set");
      }

      let promptText = generation.prompt;
      promptText += ` --duration ${generation.duration}`;
      promptText += ` --camerafixed ${generation.cameraFixed}`;
      promptText += ` --resolution ${generation.resolution || '1080p'}`;
      if (generation.aspectRatio) {
        promptText += ` --ratio ${generation.aspectRatio}`;
      }

      const contentItems: any[] = [
        {
          type: "text",
          text: promptText
        }
      ];

      const loadImageAsBase64 = async (imagePath: string): Promise<string> => {
        const objectFile = await objectStorageService.getObjectEntityFile(imagePath);
        const chunks: Buffer[] = [];
        const stream = objectFile.createReadStream();
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk));
        }
        let imageBuffer = Buffer.concat(chunks);

        const MIN_RATIO = 0.40;
        const MAX_RATIO = 2.50;

        const meta = await sharp(imageBuffer).metadata();
        const w = meta.width || 1;
        const h = meta.height || 1;
        const ratio = w / h;

        if (ratio > MAX_RATIO) {
          const newW = Math.floor(h * MAX_RATIO);
          const offsetX = Math.floor((w - newW) / 2);
          console.log(`⚠️ Image aspect ratio ${ratio.toFixed(2)} > 2.50, cropping width ${w} → ${newW}`);
          imageBuffer = await sharp(imageBuffer)
            .extract({ left: offsetX, top: 0, width: newW, height: h })
            .jpeg()
            .toBuffer();
        } else if (ratio < MIN_RATIO) {
          const newH = Math.floor(w / MIN_RATIO);
          const offsetY = Math.floor((h - newH) / 2);
          console.log(`⚠️ Image aspect ratio ${ratio.toFixed(2)} < 0.40, cropping height ${h} → ${newH}`);
          imageBuffer = await sharp(imageBuffer)
            .extract({ left: 0, top: offsetY, width: w, height: newH })
            .jpeg()
            .toBuffer();
        }

        return `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
      };

      if (generation.originalImageUrl) {
        console.log(`Getting main image from object storage: ${generation.originalImageUrl}`);
        const imageDataUri = await loadImageAsBase64(generation.originalImageUrl);
        contentItems.push({
          type: "image_url",
          image_url: { url: imageDataUri }
        });
      }


      const requestBody = {
        model: VIDEO_MODEL,
        content: contentItems
      };

      console.log(`Creating video generation task...`);
      console.log(`Prompt: ${promptText}`);

      const createResponse = await fetch(VIDEO_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.log(`❌ Video API Error ${createResponse.status}:`, errorText);
        throw new Error(`Video API error: ${createResponse.status} - ${errorText}`);
      }

      const createResult = await createResponse.json();
      const taskId = createResult.id;
      
      if (!taskId) {
        throw new Error("No task ID returned from video generation API");
      }

      console.log(`✅ Video task created with ID: ${taskId}`);
      await storage.updateVideoGeneration(generationId, { taskId });

      let attempts = 0;
      const maxAttempts = 180;
      let videoUrl: string | null = null;

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        attempts++;

        const pollResponse = await fetch(`${VIDEO_API_ENDPOINT}/${taskId}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          }
        });

        if (!pollResponse.ok) {
          console.log(`Poll attempt ${attempts} failed: ${pollResponse.status}`);
          continue;
        }

        const pollResult = await pollResponse.json();
        console.log(`Poll attempt ${attempts}: status = ${pollResult.status}`);

        if (pollResult.status === "succeeded") {
          console.log("Video task succeeded, full response:", JSON.stringify(pollResult, null, 2));
          
          if (pollResult.content?.video_url && typeof pollResult.content.video_url === "string") {
            videoUrl = pollResult.content.video_url.replace(/&amp;/g, '&');
          }
          else if (pollResult.content && Array.isArray(pollResult.content)) {
            for (const item of pollResult.content) {
              if (item.type === "video_url" && item.video_url?.url) {
                videoUrl = item.video_url.url.replace(/&amp;/g, '&');
                break;
              }
            }
          }
          
          console.log("Extracted video URL:", videoUrl);
          break;
        } else if (pollResult.status === "failed") {
          throw new Error(pollResult.error?.message || "Video generation failed");
        }
      }

      const processingTime = (Date.now() - startTime) / 1000;

      if (!videoUrl) {
        throw new Error("Video generation timed out or no video URL returned");
      }

      console.log(`✅ Video generation completed: ${videoUrl}`);

      let bunnyVideoUrl: string | undefined;
      if (bunnyStorage.isConfigured()) {
        try {
          bunnyVideoUrl = await bunnyStorage.uploadVideoFromUrl(videoUrl, userFolder, generationId);
          console.log(`✅ Uploaded video to Bunny.net for user ${userFolder}: ${bunnyVideoUrl}`);
        } catch (e) {
          console.error("Bunny video upload failed:", e);
        }
      }
      
      const duration = generation.duration || 5;
      const vidRes = generation.resolution || '1080p';
      const vidAspect = generation.aspectRatio || '16:9';
      let vidW: number, vidH: number;
      if (vidRes === '720p') {
        if (vidAspect === '16:9') { vidW = 1280; vidH = 720; }
        else if (vidAspect === '9:16') { vidW = 720; vidH = 1280; }
        else { vidW = 720; vidH = 720; }
      } else {
        if (vidAspect === '16:9') { vidW = 1920; vidH = 1080; }
        else if (vidAspect === '9:16') { vidW = 1080; vidH = 1920; }
        else { vidW = 1080; vidH = 1080; }
      }
      const tokenConsumption = (vidW * vidH * 24 * duration) / 1024;
      const videoCostUsd = (tokenConsumption / 1_000_000) * 2.4;
      await storage.updateVideoGeneration(generationId, {
        status: "completed",
        generatedVideoUrl: videoUrl,
        bunnyVideoUrl,
        processingTime,
        cost: parseFloat(videoCostUsd.toFixed(4))
      });

    } catch (error) {
      console.error("Error processing video generation:", error);
      try {
        const refunded = await storage.failVideoGenerationAndRefund(
          generationId,
          error instanceof Error ? error.message : "Unknown error",
          0
        );
        if (refunded) console.log(`✅ Video generation failed and credits refunded for ${generationId}`);
      } catch (refundError) {
        console.error("Error in failVideoGenerationAndRefund:", refundError);
      }
    }
  }

  // ===== STORY ANIMATION =====

  app.post("/api/story-generations/:storyId/animate", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { storyId } = req.params;
      const duration = Math.max(4, Math.min(12, Number(req.body.duration) || 5));
      const resolution = req.body.resolution === "720p" ? "720p" : "1080p";
      const aspectRatio = ["16:9", "9:16", "1:1"].includes(req.body.aspectRatio) ? req.body.aspectRatio : "16:9";
      const animationPrompt = (req.body.animationPrompt || "").trim();
      const perScenePrompts: string[] = Array.isArray(req.body.perScenePrompts) ? req.body.perScenePrompts : [];

      const story = await storage.getStoryGeneration(storyId);
      if (!story) return res.status(404).json({ error: "找不到故事" });
      if (story.userId !== userId) return res.status(403).json({ error: "無存取權限" });
      if (!["completed", "generating"].includes(story.status)) return res.status(400).json({ error: "故事尚未開始生成" });

      const scenes: StoryScene[] = JSON.parse(story.scenes || "[]");
      const completedScenes = scenes.filter(s => s.status === "completed" && (s.bunnyUrl || s.imageUrl));
      if (completedScenes.length === 0) return res.status(400).json({ error: "沒有可生成動畫的場景" });

      const VIDEO_CREDITS_PER_SECOND = resolution === "720p" ? 3.4 : 6.8;
      const creditsPerScene = Math.round(duration * VIDEO_CREDITS_PER_SECOND);
      const totalCredits = creditsPerScene * completedScenes.length;

      const user = await storage.getUser(userId);
      if (!user || (user.credits ?? 0) < totalCredits) {
        return res.status(400).json({ error: `積分不足，需要 ${totalCredits} 積分` });
      }

      await storage.atomicAddCredits(userId, -totalCredits, `故事「${story.title}」批量動畫生成 ${completedScenes.length} 幕`);

      const storyUser = await storage.getUser(userId);
      const userFolder = storyUser?.username || userId;
      const jobs: { sceneIdx: number; sceneTitle: string; videoId: string }[] = [];

      for (let si = 0; si < completedScenes.length; si++) {
        const scene = completedScenes[si];
        const sceneIdx = scenes.indexOf(scene);
        const imageUrl = scene.bunnyUrl || scene.imageUrl!;
        const prompt = perScenePrompts[si]?.trim() || animationPrompt || scene.description;

        const videoGen = await storage.createVideoGeneration({
          userId,
          type: "image-to-video",
          prompt,
          originalImageUrl: imageUrl,
          duration,
          resolution,
          aspectRatio,
          cameraFixed: false,
        });

        jobs.push({ sceneIdx, sceneTitle: scene.title || `第 ${sceneIdx + 1} 幕`, videoId: videoGen.id });
        processSceneAnimation(videoGen.id, imageUrl, bunnyStorage, userFolder, storyId, sceneIdx, creditsPerScene).catch(console.error);
      }

      res.json({ jobs, totalCredits });
    } catch (error: any) {
      console.error("Error starting story animation:", error);
      res.status(500).json({ error: error.message || "批量動畫生成失敗" });
    }
  });

  async function processSceneAnimation(
    videoId: string,
    imageUrl: string,
    bunnyStorage: BunnyStorageService,
    userFolder: string,
    storyId: string,
    sceneIdx: number,
    creditsPerScene: number
  ) {
    const startTime = Date.now();
    try {
      await storage.updateVideoGeneration(videoId, { status: "processing" });
      const generation = await storage.getVideoGeneration(videoId);
      if (!generation) return;

      const apiKey = process.env.ARK_API_KEY;
      if (!apiKey) throw new Error("ARK_API_KEY 未設定");

      const imgResponse = await fetch(imageUrl);
      if (!imgResponse.ok) throw new Error(`無法下載場景圖片: ${imgResponse.status}`);
      let imageBuffer = Buffer.from(await imgResponse.arrayBuffer());

      const MIN_RATIO = 0.40;
      const MAX_RATIO = 2.50;
      const meta = await sharp(imageBuffer).metadata();
      const w = meta.width || 1;
      const h = meta.height || 1;
      const ratio = w / h;
      if (ratio > MAX_RATIO) {
        const newW = Math.floor(h * MAX_RATIO);
        const offsetX = Math.floor((w - newW) / 2);
        imageBuffer = await sharp(imageBuffer).extract({ left: offsetX, top: 0, width: newW, height: h }).jpeg().toBuffer();
      } else if (ratio < MIN_RATIO) {
        const newH = Math.floor(w / MIN_RATIO);
        const offsetY = Math.floor((h - newH) / 2);
        imageBuffer = await sharp(imageBuffer).extract({ left: 0, top: offsetY, width: w, height: newH }).jpeg().toBuffer();
      }

      const imageDataUri = `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;

      let promptText = generation.prompt || "";
      promptText += ` --duration ${generation.duration}`;
      promptText += ` --camerafixed false`;
      promptText += ` --resolution ${generation.resolution || "720p"}`;
      if (generation.aspectRatio) promptText += ` --ratio ${generation.aspectRatio}`;

      const requestBody = {
        model: VIDEO_MODEL,
        content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: imageDataUri } },
        ],
      };

      const createResponse = await fetch(VIDEO_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(requestBody),
      });

      if (!createResponse.ok) {
        const errText = await createResponse.text();
        throw new Error(`Video API error ${createResponse.status}: ${errText}`);
      }

      const createResult = await createResponse.json();
      const taskId = createResult.id;
      if (!taskId) throw new Error("API 未回傳 taskId");
      await storage.updateVideoGeneration(videoId, { taskId });
      console.log(`✅ Story scene animation task created: ${taskId} (scene ${sceneIdx})`);

      let videoUrl: string | null = null;
      let attempts = 0;
      const maxAttempts = 180;

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 5000));
        attempts++;

        const pollResponse = await fetch(`${VIDEO_API_ENDPOINT}/${taskId}`, {
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        });
        if (!pollResponse.ok) { console.log(`Poll ${attempts} failed`); continue; }

        const pollResult = await pollResponse.json();
        console.log(`Story scene ${sceneIdx} poll ${attempts}: ${pollResult.status}`);

        if (pollResult.status === "succeeded") {
          if (pollResult.content?.video_url && typeof pollResult.content.video_url === "string") {
            videoUrl = pollResult.content.video_url.replace(/&amp;/g, "&");
          } else if (pollResult.content && Array.isArray(pollResult.content)) {
            for (const item of pollResult.content) {
              if (item.type === "video_url" && item.video_url?.url) {
                videoUrl = item.video_url.url.replace(/&amp;/g, "&");
                break;
              }
            }
          }
          break;
        } else if (pollResult.status === "failed") {
          throw new Error(pollResult.error?.message || "影片生成 API 失敗");
        }
      }

      if (!videoUrl) throw new Error("影片生成超時");

      const processingTime = (Date.now() - startTime) / 1000;
      let bunnyVideoUrl: string | undefined;
      if (bunnyStorage.isConfigured()) {
        try {
          const remotePath = `users/${userFolder}/story-videos/${storyId}_${sceneIdx}.mp4`;
          bunnyVideoUrl = await bunnyStorage.uploadVideoFromUrl(videoUrl, userFolder, `story-anim-${storyId}-${sceneIdx}`);
          console.log(`✅ Story scene animation uploaded to Bunny: ${bunnyVideoUrl}`);
        } catch (e) {
          console.error("Bunny video upload failed for story scene animation:", e);
        }
      }

      const duration = generation.duration || 5;
      const vidRes = generation.resolution || "720p";
      const vidAspect = generation.aspectRatio || "16:9";
      let vidW: number, vidH: number;
      if (vidRes === "720p") {
        if (vidAspect === "16:9") { vidW = 1280; vidH = 720; }
        else if (vidAspect === "9:16") { vidW = 720; vidH = 1280; }
        else { vidW = 720; vidH = 720; }
      } else {
        if (vidAspect === "16:9") { vidW = 1920; vidH = 1080; }
        else if (vidAspect === "9:16") { vidW = 1080; vidH = 1920; }
        else { vidW = 1080; vidH = 1080; }
      }
      const tokenConsumption = (vidW * vidH * 24 * duration) / 1024;
      const videoCostUsd = (tokenConsumption / 1_000_000) * 2.4;

      await storage.updateVideoGeneration(videoId, {
        status: "completed",
        generatedVideoUrl: videoUrl,
        bunnyVideoUrl,
        processingTime,
        cost: parseFloat(videoCostUsd.toFixed(4)),
      });

      console.log(`✅ Story scene ${sceneIdx} animation completed!`);
    } catch (error: any) {
      console.error(`❌ Story scene ${sceneIdx} animation failed:`, error.message);
      try {
        await storage.failVideoGenerationAndRefund(videoId, error.message, creditsPerScene);
      } catch (e) {
        console.error("Refund failed for scene animation:", e);
      }
    }
  }

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!req.session.userId || !req.session.isAdmin) {
      return res.status(403).json({ error: "需要管理員權限" });
    }
    next();
  }

  // ===== ADMIN ROUTES =====

  app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const usersWithStats = await Promise.all(
        users.map(async (user) => {
          const stats = await storage.getUserStats(user.id);
          return {
            id: user.id,
            username: user.username,
            email: user.email,
            credits: user.credits || 0,
            isAdmin: user.isAdmin || false,
            createdAt: user.createdAt,
            totalGenerations: stats.totalGenerations,
            totalCreditsUsed: stats.totalCreditsUsed,
          };
        })
      );
      res.json(usersWithStats);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "獲取用戶列表失敗" });
    }
  });

  app.get("/api/admin/users/:userId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.params.userId);
      if (!user) {
        return res.status(404).json({ error: "用戶不存在" });
      }
      const stats = await storage.getUserStats(user.id);
      const transactions = await storage.getCreditTransactions(user.id);
      const rawImageGenerations = await storage.getUserImageGenerations(user.id);
      const rawVideoGenerations = await storage.getUserVideoGenerations(user.id);

      const imageGenerations = rawImageGenerations.map(g => {
        const r = { ...g };
        r.bunnyImageUrl = fixBunnyCdnUrl(r.bunnyImageUrl) as string;
        r.bunnyImageUrls = fixBunnyCdnUrls(r.bunnyImageUrls) as string[];
        if (r.bunnyImageUrl) r.generatedImageUrl = r.bunnyImageUrl;
        if (r.bunnyImageUrls && r.bunnyImageUrls.length > 0) r.generatedImageUrls = r.bunnyImageUrls;
        return r;
      });
      const videoGenerations = rawVideoGenerations.map(g => {
        const r = { ...g };
        r.bunnyVideoUrl = fixBunnyCdnUrl(r.bunnyVideoUrl) as string;
        if (r.bunnyVideoUrl) r.generatedVideoUrl = r.bunnyVideoUrl;
        return r;
      });

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          credits: user.credits || 0,
          isAdmin: user.isAdmin || false,
          createdAt: user.createdAt,
        },
        stats,
        transactions,
        imageGenerations,
        videoGenerations,
      });
    } catch (error) {
      console.error("Error fetching user details:", error);
      res.status(500).json({ error: "獲取用戶詳情失敗" });
    }
  });

  app.post("/api/admin/users/:userId/credits", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { amount, description } = req.body;
      if (!amount || typeof amount !== "number") {
        return res.status(400).json({ error: "請提供有效的積分數量" });
      }

      const user = await storage.getUser(req.params.userId);
      if (!user) {
        return res.status(404).json({ error: "用戶不存在" });
      }

      const newBalance = (user.credits || 0) + amount;
      if (newBalance < 0) {
        return res.status(400).json({ error: "扣除後積分不能為負數" });
      }

      await storage.updateUserCredits(user.id, newBalance);
      await storage.createCreditTransaction({
        userId: user.id,
        type: amount > 0 ? "topup" : "consume",
        amount,
        balance: newBalance,
        description: description || (amount > 0 ? "管理員手動加值" : "管理員手動扣除"),
      });

      res.json({ credits: newBalance });
    } catch (error) {
      console.error("Error adjusting credits:", error);
      res.status(500).json({ error: "調整積分失敗" });
    }
  });

  app.get("/api/admin/orders", requireAuth, requireAdmin, async (req, res) => {
    try {
      const orders = await storage.getAllTopupTransactions();
      res.json(orders);
    } catch (error) {
      console.error("Error fetching admin orders:", error);
      res.status(500).json({ error: "獲取訂單資料失敗" });
    }
  });

  app.get("/api/admin/generations", requireAuth, requireAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, { username: u.username, email: u.email }]));

      const rawImages = await storage.getAllImageGenerations();
      const rawVideos = await storage.getAllVideoGenerations();
      const rawStories = await storage.getAllStoryGenerations();

      const images = rawImages.map(g => {
        const r = { ...g };
        r.bunnyImageUrl = fixBunnyCdnUrl(r.bunnyImageUrl) as string;
        r.bunnyImageUrls = fixBunnyCdnUrls(r.bunnyImageUrls) as string[];
        const userInfo = userMap.get(r.userId);
        return {
          id: r.id,
          userId: r.userId,
          username: userInfo?.username || "未知",
          email: userInfo?.email || "",
          category: "image" as const,
          type: r.type,
          prompt: r.prompt,
          status: r.status,
          creditsUsed: r.creditsUsed || 3,
          createdAt: r.createdAt,
          thumbnailUrl: r.bunnyImageUrl || (r.bunnyImageUrls && r.bunnyImageUrls[0]) || null,
        };
      });

      const videos = rawVideos.map(g => {
        const r = { ...g };
        r.bunnyVideoUrl = fixBunnyCdnUrl(r.bunnyVideoUrl) as string;
        const userInfo = userMap.get(r.userId);
        return {
          id: r.id,
          userId: r.userId,
          username: userInfo?.username || "未知",
          email: userInfo?.email || "",
          category: "video" as const,
          type: r.type,
          prompt: r.prompt,
          status: r.status,
          creditsUsed: r.creditsUsed || Math.round((r.duration || 5) * 6.8),
          duration: r.duration,
          createdAt: r.createdAt,
          thumbnailUrl: r.bunnyVideoUrl || null,
        };
      });

      const stories = rawStories.map(g => {
        const userInfo = userMap.get(g.userId);
        const scenes: StoryScene[] = (() => { try { return JSON.parse(g.scenes || "[]"); } catch { return []; } })();
        const firstScene = scenes.find(s => s.bunnyUrl || s.imageUrl);
        const sceneCount = scenes.length;
        const completedCount = scenes.filter(s => s.status === "completed").length;
        return {
          id: g.id,
          userId: g.userId,
          username: userInfo?.username || "未知",
          email: userInfo?.email || "",
          category: "story" as const,
          type: `故事（${sceneCount}幕）`,
          prompt: g.title,
          status: g.status,
          creditsUsed: g.creditsUsed || sceneCount * 3,
          sceneCount,
          completedCount,
          createdAt: g.createdAt,
          thumbnailUrl: firstScene?.bunnyUrl || firstScene?.imageUrl || null,
        };
      });

      const all = [...images, ...videos, ...stories].sort((a, b) =>
        new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
      );

      res.json(all);
    } catch (error) {
      console.error("Error fetching admin generations:", error);
      res.status(500).json({ error: "獲取生成紀錄失敗" });
    }
  });

  app.get("/api/admin/stats", requireAuth, requireAdmin, async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      const globalStats = await storage.getStats();
      const totalCredits = users.reduce((sum, u) => sum + (u.credits || 0), 0);

      res.json({
        totalUsers: users.length,
        totalCreditsInCirculation: totalCredits,
        ...globalStats,
      });
    } catch (error) {
      console.error("Error fetching admin stats:", error);
      res.status(500).json({ error: "獲取統計資料失敗" });
    }
  });

  app.post("/api/chat/send", requireAuth, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "請輸入訊息" });
      }
      const msg = await storage.createChatMessage(req.session.userId!, message.trim(), false);
      res.json(msg);
    } catch (error) {
      console.error("Error sending chat message:", error);
      res.status(500).json({ error: "發送訊息失敗" });
    }
  });

  app.get("/api/chat/messages", requireAuth, async (req, res) => {
    try {
      const messages = await storage.getChatMessages(req.session.userId!);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching chat messages:", error);
      res.status(500).json({ error: "獲取訊息失敗" });
    }
  });

  app.get("/api/chat/unread", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadCount(req.session.userId!);
      res.json({ count });
    } catch (error) {
      res.json({ count: 0 });
    }
  });

  app.post("/api/chat/mark-read", requireAuth, async (req, res) => {
    try {
      await storage.markChatMessagesRead(req.session.userId!);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "操作失敗" });
    }
  });

  app.get("/api/admin/chats", requireAuth, requireAdmin, async (req, res) => {
    try {
      const chats = await storage.getChatsOverview();
      res.json(chats);
    } catch (error) {
      console.error("Error fetching admin chats:", error);
      res.status(500).json({ error: "獲取對話列表失敗" });
    }
  });

  app.get("/api/admin/chats/:userId", requireAuth, requireAdmin, async (req, res) => {
    try {
      const messages = await storage.getChatMessages(req.params.userId);
      await storage.markChatMessagesRead(req.params.userId);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching chat messages:", error);
      res.status(500).json({ error: "獲取對話訊息失敗" });
    }
  });

  app.post("/api/admin/chats/:userId/reply", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== "string" || !message.trim()) {
        return res.status(400).json({ error: "請輸入訊息" });
      }
      const msg = await storage.createChatMessage(req.params.userId, message.trim(), true);
      res.json(msg);
    } catch (error) {
      console.error("Error sending admin reply:", error);
      res.status(500).json({ error: "回覆訊息失敗" });
    }
  });

  app.post("/api/story-generations", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const validated = insertStoryGenerationSchema.safeParse(req.body);
      if (!validated.success) {
        return res.status(400).json({ error: "參數錯誤", details: validated.error.flatten() });
      }
      const { title, style, scenes, referenceImageUrls, sceneSize, characterImageUrls, sceneRefImageUrls, styleImageUrls } = validated.data;
      const creditsNeeded = scenes.length * 3;

      const user = await storage.getUser(userId);
      if (!user || (user.credits ?? 0) < creditsNeeded) {
        return res.status(400).json({ error: `積分不足，需要 ${creditsNeeded} 積分` });
      }

      await storage.atomicAddCredits(userId, -creditsNeeded, `故事生成「${title}」${scenes.length} 幕`);

      const storyGen = await storage.createStoryGeneration({
        userId,
        title,
        style,
        scenes,
        referenceImageUrls: referenceImageUrls ?? [],
        sceneSize: sceneSize ?? "1:1",
        characterImageUrls: characterImageUrls ?? [],
        sceneRefImageUrls: sceneRefImageUrls ?? [],
        styleImageUrls: styleImageUrls ?? [],
        creditsUsed: creditsNeeded,
      });

      processStoryGeneration(storyGen.id, objectStorageService, bunnyStorage).catch(console.error);

      res.json(storyGen);
    } catch (error) {
      console.error("Error creating story generation:", error);
      res.status(500).json({ error: "故事生成建立失敗" });
    }
  });

  app.get("/api/story-generations/:id", requireAuth, async (req, res) => {
    try {
      const story = await storage.getStoryGeneration(req.params.id);
      if (!story) return res.status(404).json({ error: "找不到故事生成記錄" });
      if (story.userId !== req.session.userId!) return res.status(403).json({ error: "無存取權限" });
      res.json(story);
    } catch (error) {
      console.error("Error getting story generation:", error);
      res.status(500).json({ error: "查詢失敗" });
    }
  });

  // List user's story generations (history)
  app.get("/api/story-generations", requireAuth, async (req, res) => {
    try {
      const stories = await storage.getUserStoryGenerations(req.session.userId!);
      res.json(stories);
    } catch (error) {
      console.error("Error listing story generations:", error);
      res.status(500).json({ error: "查詢失敗" });
    }
  });

  // Update story title (inline edit)
  app.patch("/api/story-generations/:storyId", requireAuth, async (req, res) => {
    try {
      const { storyId } = req.params;
      const story = await storage.getStoryGeneration(storyId);
      if (!story) return res.status(404).json({ error: "找不到故事" });
      if (story.userId !== req.session.userId!) return res.status(403).json({ error: "無存取權限" });
      const updates: Partial<typeof story> = {};
      if (typeof req.body.title === "string" && req.body.title.trim()) updates.title = req.body.title.trim();
      const updated = await storage.updateStoryGeneration(storyId, updates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "更新失敗" });
    }
  });

  // Animate a single scene
  app.post("/api/story-generations/:storyId/animate-scene/:sceneIdx", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { storyId, sceneIdx: sceneIdxStr } = req.params;
      const sceneIdx = parseInt(sceneIdxStr, 10);
      const duration = Math.max(4, Math.min(12, Number(req.body.duration) || 5));
      const resolution = req.body.resolution === "720p" ? "720p" : "1080p";
      const aspectRatio = ["16:9", "9:16", "1:1"].includes(req.body.aspectRatio) ? req.body.aspectRatio : "16:9";
      const animationPrompt = (req.body.animationPrompt || "").trim();

      const story = await storage.getStoryGeneration(storyId);
      if (!story) return res.status(404).json({ error: "找不到故事" });
      if (story.userId !== userId) return res.status(403).json({ error: "無存取權限" });

      const scenes: StoryScene[] = JSON.parse(story.scenes || "[]");
      if (isNaN(sceneIdx) || sceneIdx < 0 || sceneIdx >= scenes.length) {
        return res.status(400).json({ error: "場景索引無效" });
      }
      const scene = scenes[sceneIdx];
      if (scene.status !== "completed" || !(scene.bunnyUrl || scene.imageUrl)) {
        return res.status(400).json({ error: "此幕圖片尚未生成完成" });
      }

      const VIDEO_CREDITS_PER_SECOND = resolution === "720p" ? 3.4 : 6.8;
      const credits = Math.round(duration * VIDEO_CREDITS_PER_SECOND);
      const user = await storage.getUser(userId);
      if (!user || (user.credits ?? 0) < credits) {
        return res.status(400).json({ error: `積分不足，需要 ${credits} 積分` });
      }

      await storage.atomicAddCredits(userId, -credits, `故事「${story.title}」第 ${sceneIdx + 1} 幕動畫生成`);

      const storyUser = await storage.getUser(userId);
      const userFolder = storyUser?.username || userId;
      const imageUrl = scene.bunnyUrl || scene.imageUrl!;
      const prompt = animationPrompt || scene.description;

      const videoGen = await storage.createVideoGeneration({
        userId,
        type: "image-to-video",
        prompt,
        originalImageUrl: imageUrl,
        duration,
        resolution,
        aspectRatio,
        cameraFixed: false,
      });

      processSceneAnimation(videoGen.id, imageUrl, bunnyStorage, userFolder, storyId, sceneIdx, credits).catch(console.error);

      res.json({
        sceneIdx,
        sceneTitle: scene.title || `第 ${sceneIdx + 1} 幕`,
        videoId: videoGen.id,
        credits,
      });
    } catch (error: any) {
      console.error("Error starting single scene animation:", error);
      res.status(500).json({ error: error.message || "動畫生成失敗" });
    }
  });

  app.post("/api/story-generations/:storyId/generate-animation-prompts", requireAuth, async (req, res) => {
    try {
      const { storyId } = req.params;
      const story = await storage.getStoryGeneration(storyId);
      if (!story) return res.status(404).json({ error: "找不到故事" });
      if (story.userId !== req.session.userId!) return res.status(403).json({ error: "無存取權限" });

      const scenes: StoryScene[] = JSON.parse(story.scenes || "[]");
      const completedScenes = scenes.filter(s => s.status === "completed");
      if (completedScenes.length === 0) return res.status(400).json({ error: "沒有已完成的場景" });

      const duration = Math.max(4, Math.min(12, Number(req.body.duration) || 5));

      // Assign narrative arc roles for animation pacing
      const animTotal = completedScenes.length;
      const getAnimNarrativeRole = (i: number): string => {
        if (animTotal === 1) return "完整故事";
        if (animTotal === 2) return i === 0 ? "起（開場，輕鬆節奏）" : "合（結局，緩慢收尾）";
        if (animTotal === 3) return ["起（開場）", "轉（高潮）", "合（結局）"][i] ?? "承";
        const ratio = i / (animTotal - 1);
        if (i === 0) return "起（開場，建立氛圍，鏡頭緩慢推進）";
        if (i === animTotal - 1) return "合（結局，鏡頭緩慢拉遠或淡出，情緒平靜圓滿）";
        if (ratio < 0.35) return "承（故事發展，節奏逐漸加快）";
        if (ratio < 0.72) return "轉（高潮轉折，動態強烈，戲劇性鏡頭）";
        return "合前段（衝突化解，節奏放緩）";
      };

      const prompt = `你是一位專業的影片分鏡師，擅長為 AI 影片生成工具撰寫動態提示詞。請根據以下故事資訊，為每個場景生成符合影片動畫的英文提示詞，並確保整體動畫節奏符合「起承轉合」的故事弧線。

故事標題：${story.title}
畫風設定：${story.style}
每幕影片時長：${duration} 秒
總幕數：${animTotal} 幕

場景列表（每幕附有敘事節奏角色）：
${completedScenes.map((s, i) => `第 ${i + 1} 幕《${s.title}》[節奏角色：${getAnimNarrativeRole(i)}]：${s.description}`).join("\n")}

請為每個場景生成專業的英文影片動畫提示詞，要求：
1. 鏡頭節奏必須符合該幕的節奏角色（起：緩慢建立、承：穩定推進、轉：強烈動態、合：緩慢收尾）
2. 最後一幕必須有明確的「結束感」：鏡頭緩慢拉遠或淡出，情緒趨於平靜
3. 包含具體的鏡頭運動（如：slow push in, gentle pan left, dramatic zoom out, slow fade 等）
4. 描述 ${duration} 秒內主要的動態變化（人物動作、場景變化、光影流動）
5. 每個提示詞 30-60 個英文單字，簡潔但具體
6. 提示詞適合圖轉影片（image-to-video）生成，圖片已固定，描述動態即可

請嚴格用以下 JSON 格式回應，不要有任何其他文字：
{
  "scenes": [
    { "index": 0, "sceneTitle": "...", "animation_prompt": "..." },
    { "index": 1, "sceneTitle": "...", "animation_prompt": "..." }
  ]
}`;

      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: "Claude 回應格式錯誤" });

      const parsed = JSON.parse(jsonMatch[0]);
      res.json(parsed);
    } catch (error: any) {
      console.error("Error generating animation prompts:", error);
      res.status(500).json({ error: error.message || "生成動畫提示詞失敗" });
    }
  });

  app.post("/api/claude/enhance-story-prompts", requireAuth, async (req, res) => {
    try {
      const { title, style, scenes, storyContent } = req.body as {
        title: string;
        style: string;
        scenes: Array<{ title: string; description: string }>;
        storyContent?: string;
      };

      if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
        return res.status(400).json({ error: "請提供場景資料" });
      }

      const styleGuide: Record<string, string> = {
        watercolor: "水彩畫風格，柔和色調，透明感，水漬邊緣效果",
        cinematic: "電影感風格，寬銀幕構圖，戲劇性光影，電影色調分級",
        anime: "日系動漫風格，清晰線條，鮮豔色彩，精緻細節",
        oil_painting: "油畫風格，厚重筆觸，豐富紋理，古典繪畫質感",
        line_art: "線條藝術風格，黑白或簡單色彩，乾淨的輪廓線",
        custom: style,
      };

      const styleDesc = styleGuide[style] || style;
      const storyContentSection = storyContent?.trim()
        ? `\n故事全文內容（請參考以下內容理解故事背景、角色與細節）：\n${storyContent.trim()}\n`
        : "";

      // Assign narrative arc roles based on scene position
      const total = scenes.length;
      const getNarrativeRole = (i: number): string => {
        if (total === 1) return "完整故事（起承轉合）";
        if (total === 2) return i === 0 ? "起（開場，建立角色與世界觀）" : "合（結局，故事完整結束）";
        if (total === 3) return ["起（開場）", "轉（高潮轉折）", "合（結局圓滿）"][i] ?? "承";
        const ratio = i / (total - 1);
        if (i === 0) return "起（開場，建立世界觀與角色，吸引觀眾）";
        if (i === total - 1) return "合（結局，故事圓滿落幕，給觀眾完整感）";
        if (ratio < 0.35) return "承（故事發展，鋪陳情節、建立張力）";
        if (ratio < 0.72) return "轉（情節轉折或高潮，衝突達到頂點）";
        return "合前段（走向結局，衝突逐漸化解）";
      };

      const prompt = `你是一位專業的 AI 圖像生成提示詞設計師，同時也是資深故事敘事師。請根據以下故事資訊，為每個場景生成高品質的英文圖片生成提示詞，並確保所有幕合起來形成完整的「起承轉合」故事弧線，有明確的結局。

故事標題：${title}
畫風設定：${styleDesc}
總幕數：${total} 幕${storyContentSection}

場景列表（每幕附有敘事結構角色，請確保提示詞的視覺內容與情緒符合該角色）：
${scenes.map((s, i) => `第 ${i + 1} 幕《${s.title}》[敘事角色：${getNarrativeRole(i)}]：${s.description}`).join("\n")}

請為每個場景生成一個專業的英文提示詞，要求：
1. 包含畫風關鍵詞（對應「${styleDesc}」）
2. 視覺內容與情緒必須符合該幕的敘事角色（起：輕鬆建立、承：發展緊張、轉：戲劇衝突、合：平靜圓滿）
3. 最後一幕（結局）必須有明顯的「結束感」，如：溫暖光芒、人物滿足表情、場景回歸平靜等視覺元素
4. 描述場景主體、環境、光線、情緒
5. 加入畫質提升詞（如 masterpiece, high quality, detailed 等）
6. 保持場景間的視覺風格一致性，讓觀眾能感受到故事的流動
7. 每個提示詞 50-100 個英文單字
8. 不要加入任何暴力、色情等不當內容

請嚴格用以下 JSON 格式回應，不要有任何其他文字：
{
  "scenes": [
    { "index": 0, "enhanced_prompt": "..." },
    { "index": 1, "enhanced_prompt": "..." }
  ]
}`;

      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(500).json({ error: "Claude 回應格式錯誤" });
      }

      const parsed = JSON.parse(jsonMatch[0]);
      res.json(parsed);
    } catch (error) {
      console.error("Claude enhance story prompts error:", error);
      res.status(500).json({ error: "Claude 提示詞優化失敗，請稍後再試" });
    }
  });

  // Regenerate a single scene
  app.post("/api/story-generations/:storyId/regenerate-scene/:sceneIdx", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { storyId, sceneIdx: sceneIdxStr } = req.params;
      const sceneIdx = parseInt(sceneIdxStr, 10);

      const story = await storage.getStoryGeneration(storyId);
      if (!story) return res.status(404).json({ error: "找不到故事" });
      if (story.userId !== userId) return res.status(403).json({ error: "無存取權限" });

      const scenes: StoryScene[] = JSON.parse(story.scenes || "[]");
      if (isNaN(sceneIdx) || sceneIdx < 0 || sceneIdx >= scenes.length) {
        return res.status(400).json({ error: "場景索引無效" });
      }

      const user = await storage.getUser(userId);
      if (!user || (user.credits ?? 0) < 3) {
        return res.status(400).json({ error: "積分不足，重新生成需要 3 積分" });
      }

      await storage.atomicAddCredits(userId, -3, `故事「${story.title}」第 ${sceneIdx + 1} 幕重新生成`);

      scenes[sceneIdx].status = "generating";
      scenes[sceneIdx].imageUrl = undefined;
      scenes[sceneIdx].bunnyUrl = undefined;
      await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes) });

      res.json({ ok: true });

      regenerateStoryScene(storyId, sceneIdx, objectStorageService, bunnyStorage).catch(console.error);
    } catch (error: any) {
      console.error("Error triggering scene regeneration:", error);
      res.status(500).json({ error: error.message || "重新生成失敗" });
    }
  });

  async function regenerateStoryScene(
    storyId: string,
    sceneIdx: number,
    objectStorageService: ObjectStorageService,
    bunnyStorage: BunnyStorageService
  ) {
    try {
      const story = await storage.getStoryGeneration(storyId);
      if (!story) return;

      const storyUser = await storage.getUser(story.userId);
      const userFolder = storyUser?.username || story.userId;
      const apiKey = process.env.ARK_API_KEY;
      if (!apiKey) throw new Error("圖片生成 API Key 未設定");

      const scenes: StoryScene[] = JSON.parse(story.scenes);

      const sceneSizeMap: Record<string, string> = {
        "1:1": "2048x2048",
        "9:16": "1440x2560",
        "16:9": "2560x1440",
      };
      const imageSize = sceneSizeMap[story.sceneSize ?? "1:1"] || "2048x2048";

      const loadRefImageAsBase64 = async (imagePath: string): Promise<string> => {
        const objectFile = await objectStorageService.getObjectEntityFile(imagePath);
        const chunks: Buffer[] = [];
        const stream = objectFile.createReadStream();
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return `data:image/jpeg;base64,${Buffer.concat(chunks).toString("base64")}`;
      };

      const loadImageList = async (urls: string[]): Promise<string[]> => {
        if (!urls || urls.length === 0) return [];
        try { return await Promise.all(urls.map(loadRefImageAsBase64)); }
        catch { return []; }
      };

      const characterBase64s = await loadImageList(story.characterImageUrls ?? []);
      const sceneRefBase64sGlobal = await loadImageList(story.sceneRefImageUrls ?? []);
      const styleBase64s = await loadImageList(story.styleImageUrls ?? []);

      const scene = scenes[sceneIdx];
      const scenePrompt = `${story.style}, ${scene.description}`;
      let globalBase64s = [...characterBase64s, ...sceneRefBase64sGlobal, ...styleBase64s];
      if (scene.sceneReferenceImageUrl) {
        try {
          const perSceneBase64 = await loadRefImageAsBase64(scene.sceneReferenceImageUrl);
          globalBase64s = [...characterBase64s, perSceneBase64, ...styleBase64s];
        } catch { /* use global refs */ }
      }

      let requestBody: any;
      if (globalBase64s.length > 0) {
        requestBody = {
          model: "ep-20251223142939-njrkd",
          prompt: scenePrompt,
          image: globalBase64s.length === 1 ? globalBase64s[0] : globalBase64s,
          response_format: "url",
          size: imageSize,
          watermark: true,
        };
      } else {
        requestBody = {
          model: "ep-20251223142939-njrkd",
          prompt: scenePrompt,
          response_format: "url",
          size: imageSize,
          watermark: true,
        };
      }

      const apiResp = await fetch(ARK_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(requestBody),
      });

      if (!apiResp.ok) {
        const errText = await apiResp.text();
        throw new Error(`API error ${apiResp.status}: ${errText}`);
      }

      const apiResult = await apiResp.json();
      const imageUrl = apiResult.data?.[0]?.url;
      if (!imageUrl) throw new Error("API 未回傳圖片 URL");

      scenes[sceneIdx].imageUrl = imageUrl;

      if (bunnyStorage.isConfigured()) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const imgResp = await fetch(imageUrl);
            const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
            const remotePath = `users/${userFolder}/stories/${storyId}_${sceneIdx}.jpg`;
            const cdnUrl = await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
            scenes[sceneIdx].bunnyUrl = cdnUrl;
            break;
          } catch (e) {
            if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
          }
        }
      }

      scenes[sceneIdx].status = "completed";
      await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes) });
      console.log(`✅ Scene ${sceneIdx + 1} regenerated for story ${storyId}`);
    } catch (error: any) {
      console.error(`❌ Scene ${sceneIdx + 1} regeneration failed:`, error.message);
      try {
        const story = await storage.getStoryGeneration(storyId);
        if (story) {
          const scenes: StoryScene[] = JSON.parse(story.scenes);
          scenes[sceneIdx].status = "failed";
          await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes) });
        }
        await storage.atomicAddCredits(story?.userId || "", 3, `退款：故事第 ${sceneIdx + 1} 幕重新生成失敗`);
      } catch { /* ignore refund error */ }
    }
  }

  // Generate story scene outline with Claude
  app.post("/api/claude/generate-story-outline", requireAuth, async (req, res) => {
    try {
      const { title, style, sceneCount, storyContent } = req.body as {
        title: string;
        style: string;
        sceneCount: number;
        storyContent?: string;
      };

      if (!title || !sceneCount || sceneCount < 2 || sceneCount > 8) {
        return res.status(400).json({ error: "請提供標題與幕數（2-8 幕）" });
      }

      const styleGuide: Record<string, string> = {
        watercolor: "水彩畫風格，柔和色調",
        cinematic: "電影感風格，戲劇性光影",
        anime: "日系動漫風格",
        oil_painting: "油畫風格",
        line_art: "線條藝術風格",
        custom: style,
      };
      const styleDesc = styleGuide[style] || style;

      const total = sceneCount;
      const getNarrativeRole = (i: number): string => {
        if (total === 2) return i === 0 ? "起（開場）" : "合（結局）";
        if (total === 3) return ["起（開場）", "轉（高潮）", "合（結局）"][i] ?? "承";
        const ratio = i / (total - 1);
        if (i === 0) return "起（開場）";
        if (i === total - 1) return "合（結局）";
        if (ratio < 0.35) return "承（發展）";
        if (ratio < 0.72) return "轉（高潮）";
        return "合前段（化解）";
      };

      const storyContentSection = storyContent?.trim()
        ? `\n故事全文：\n${storyContent.trim()}\n`
        : "";

      const prompt = `你是專業的故事編劇。請根據以下資訊，為圖片故事生成 ${total} 幕的場景大綱，確保有完整的「起承轉合」故事弧線，最後一幕有明確的結局。

故事標題：${title}
畫風：${styleDesc}
總幕數：${total} 幕${storyContentSection}

每幕的敘事角色：
${Array.from({ length: total }, (_, i) => `第 ${i + 1} 幕：${getNarrativeRole(i)}`).join("\n")}

請為每幕生成：
1. 簡短的幕名（3-8 字，中文）
2. 場景描述（20-60 字，描述畫面中的主要視覺元素、人物動作、環境氣氛）
3. 描述要具體且適合生成圖片
4. 最後一幕必須有明確的故事結局感

請嚴格用以下 JSON 格式回應，不要有任何其他文字：
{
  "scenes": [
    { "index": 0, "title": "...", "description": "..." }
  ]
}`;

      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ error: "Claude 回應格式錯誤" });

      res.json(JSON.parse(jsonMatch[0]));
    } catch (error: any) {
      console.error("Error generating story outline:", error);
      res.status(500).json({ error: error.message || "生成大綱失敗" });
    }
  });

  async function processStoryGeneration(
    storyId: string,
    objectStorageService: ObjectStorageService,
    bunnyStorage: BunnyStorageService
  ) {
    try {
      await storage.updateStoryGeneration(storyId, { status: "generating" });
      const story = await storage.getStoryGeneration(storyId);
      if (!story) return;

      const storyUser = await storage.getUser(story.userId);
      const userFolder = storyUser?.username || story.userId;
      const apiKey = process.env.ARK_API_KEY;
      if (!apiKey) throw new Error("圖片生成 API Key 未設定");

      const scenes: StoryScene[] = JSON.parse(story.scenes);
      const referenceImageUrls = story.referenceImageUrls ?? [];
      let totalCost = 0;

      const sceneSizeMap: Record<string, string> = {
        "1:1": "2048x2048",
        "9:16": "1440x2560",
        "16:9": "2560x1440",
      };
      const imageSize = sceneSizeMap[story.sceneSize ?? "1:1"] || "2048x2048";

      const loadRefImageAsBase64 = async (imagePath: string): Promise<string> => {
        const objectFile = await objectStorageService.getObjectEntityFile(imagePath);
        const chunks: Buffer[] = [];
        const stream = objectFile.createReadStream();
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return `data:image/jpeg;base64,${Buffer.concat(chunks).toString("base64")}`;
      };

      // Load all three reference image categories
      const loadImageList = async (urls: string[]): Promise<string[]> => {
        if (!urls || urls.length === 0) return [];
        try {
          return await Promise.all(urls.map(loadRefImageAsBase64));
        } catch (e) {
          console.error("Failed to load reference images:", e);
          return [];
        }
      };

      const characterBase64s = await loadImageList(story.characterImageUrls ?? []);
      const sceneRefBase64s = await loadImageList(story.sceneRefImageUrls ?? []);
      const styleBase64s = await loadImageList(story.styleImageUrls ?? []);

      for (let i = 0; i < scenes.length; i++) {
        scenes[i].status = "generating";
        await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes) });

        try {
          const scenePrompt = `${story.style}, ${scenes[i].description}`;
          let requestBody: any;

          // Combine all global reference images in order: character → scene → style
          let globalBase64s = [...characterBase64s, ...sceneRefBase64s, ...styleBase64s];

          // Per-scene reference image overrides only the scene ref slot
          if (scenes[i].sceneReferenceImageUrl) {
            try {
              const perSceneBase64 = await loadRefImageAsBase64(scenes[i].sceneReferenceImageUrl!);
              globalBase64s = [...characterBase64s, perSceneBase64, ...styleBase64s];
            } catch (e) {
              console.error(`Failed to load scene ${i} reference image:`, e);
            }
          }

          if (globalBase64s.length > 0) {
            // Build an explicit prompt labeling what each reference image is for
            const labelParts: string[] = [];
            let imgIdx = 1;
            if (characterBase64s.length > 0) {
              labelParts.push(`第 ${imgIdx}${characterBase64s.length > 1 ? `-${imgIdx + characterBase64s.length - 1}` : ""} 張圖為主角外貌，保持角色一致`);
              imgIdx += characterBase64s.length;
            }
            const sceneCount = scenes[i].sceneReferenceImageUrl ? 1 : sceneRefBase64s.length;
            if (sceneCount > 0) {
              labelParts.push(`第 ${imgIdx}${sceneCount > 1 ? `-${imgIdx + sceneCount - 1}` : ""} 張圖為場景構圖參考`);
              imgIdx += sceneCount;
            }
            if (styleBase64s.length > 0) {
              labelParts.push(`第 ${imgIdx}${styleBase64s.length > 1 ? `-${imgIdx + styleBase64s.length - 1}` : ""} 張圖為畫風風格參考`);
            }
            const labelNote = labelParts.length > 0 ? `（${labelParts.join("；")}）` : "";
            const fullPrompt = `${scenePrompt}${labelNote}`;
            requestBody = {
              model: "ep-20251223142939-njrkd",
              prompt: fullPrompt,
              image: globalBase64s.length === 1 ? globalBase64s[0] : globalBase64s,
              response_format: "url",
              size: imageSize,
              watermark: true,
            };
          } else {
            requestBody = {
              model: "ep-20251223142939-njrkd",
              prompt: scenePrompt,
              response_format: "url",
              size: imageSize,
              watermark: true,
            };
          }

          const apiResp = await fetch(ARK_API_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify(requestBody),
          });

          if (!apiResp.ok) {
            const errText = await apiResp.text();
            throw new Error(`API error ${apiResp.status}: ${errText}`);
          }

          const apiResult = await apiResp.json();
          const imageUrl = apiResult.data?.[0]?.url;
          if (!imageUrl) throw new Error("API 未回傳圖片 URL");

          totalCost += 0.05;
          scenes[i].imageUrl = imageUrl;

          if (bunnyStorage.isConfigured()) {
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                const imgResp = await fetch(imageUrl);
                const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
                const remotePath = `users/${userFolder}/stories/${storyId}_${i}.jpg`;
                const cdnUrl = await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
                scenes[i].bunnyUrl = cdnUrl;
                break;
              } catch (e) {
                console.error(`Bunny upload failed (story scene ${i}, attempt ${attempt}):`, e);
                if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
              }
            }
          }

          scenes[i].status = "completed";
          console.log(`✅ Story scene ${i + 1}/${scenes.length} completed for story ${storyId}`);
        } catch (sceneError: any) {
          console.error(`❌ Story scene ${i + 1} failed:`, sceneError.message);
          scenes[i].status = "failed";
          scenes[i].imageUrl = undefined;
        }

        await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes), cost: totalCost });
      }

      const allFailed = scenes.every(s => s.status === "failed");
      if (allFailed) {
        await storage.failStoryGenerationAndRefund(storyId, "所有場景生成失敗");
      } else {
        await storage.updateStoryGeneration(storyId, { status: "completed", scenes: JSON.stringify(scenes), cost: totalCost });
        console.log(`✅ Story generation ${storyId} completed`);
      }
    } catch (error: any) {
      console.error("❌ Story generation failed:", error.message);
      await storage.failStoryGenerationAndRefund(storyId, error.message);
    }
  }

  const httpServer = createServer(app);
  return httpServer;
}

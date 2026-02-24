import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import { storage } from "./storage";
import { insertUserSchema, loginSchema, insertImageGenerationSchema, insertTextToImageSchema, insertImageToImageSchema, insertBatchImageToImageSchema, insertImageToVideoSchema, insertTextToVideoSchema, sendVerificationCodeSchema, registerWithVerificationSchema } from "@shared/schema";
import nodemailer from "nodemailer";
import { ObjectStorageService } from "./objectStorage";
import { BunnyStorageService } from "./bunnyStorage";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

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
      const isValid = await bcrypt.compare(validatedData.password, user.password);
      if (!isValid) {
        return res.status(401).json({ error: "用户名或密码错误" });
      }

      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.isAdmin = user.isAdmin || false;

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          credits: user.credits,
          isAdmin: user.isAdmin || false,
        },
      });
    } catch (error) {
      console.error("Error logging in:", error);
      res.status(500).json({ error: "登录失败" });
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
          totalCost: generations.length * 0.03,
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

  app.get("/api/image-generations/:id", async (req, res) => {
    try {
      const generation = await storage.getImageGeneration(req.params.id);
      if (!generation) {
        return res.status(404).json({ error: "Generation not found" });
      }
      const result = { ...generation };
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

  app.get("/api/batch-generations/:batchId", async (req, res) => {
    try {
      const rawGenerations = await storage.getImageGenerationsByBatchId(req.params.batchId);
      if (rawGenerations.length === 0) {
        return res.status(404).json({ error: "Batch not found" });
      }
      const generations = rawGenerations.map(g => {
        const r = { ...g };
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
      const generations = await storage.getAllImageGenerations();
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
          try {
            bunnyImageUrls = [];
            for (let i = 0; i < generatedImageUrls.length; i++) {
              const cdnUrl = await bunnyStorage.uploadImageFromUrl(generatedImageUrls[i], generation.userId, generationId, i);
              bunnyImageUrls.push(cdnUrl);
            }
            bunnyImageUrl = bunnyImageUrls[0];
            console.log(`✅ Uploaded ${bunnyImageUrls.length} images to Bunny.net for user ${generation.userId}`);
          } catch (e) {
            console.error("Bunny upload failed (sequential):", e);
          }
        }

        await storage.updateImageGeneration(generationId, {
          status: "completed",
          generatedImageUrl: generatedImageUrls[0],
          generatedImageUrls,
          bunnyImageUrl,
          bunnyImageUrls,
          processingTime,
          cost: 0.03 * generatedImageUrls.length
        });
      } else {
        const result = await response.json();
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
          try {
            bunnyImageUrl = await bunnyStorage.uploadImageFromUrl(generatedImageUrl, generation.userId, generationId);
            console.log(`✅ Uploaded image to Bunny.net for user ${generation.userId}: ${bunnyImageUrl}`);
          } catch (e) {
            console.error("Bunny upload failed (single):", e);
          }
        }

        await storage.updateImageGeneration(generationId, {
          status: "completed",
          generatedImageUrl,
          bunnyImageUrl,
          processingTime,
          cost: 0.03
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

  app.get("/api/video-generations/:id", async (req, res) => {
    try {
      const generation = await storage.getVideoGeneration(req.params.id);
      if (!generation) {
        return res.status(404).json({ error: "Video generation not found" });
      }
      const result = { ...generation };
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
      const generations = await storage.getAllVideoGenerations();
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
        const imageBuffer = Buffer.concat(chunks);
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
          bunnyVideoUrl = await bunnyStorage.uploadVideoFromUrl(videoUrl, generation.userId, generationId);
          console.log(`✅ Uploaded video to Bunny.net for user ${generation.userId}: ${bunnyVideoUrl}`);
        } catch (e) {
          console.error("Bunny video upload failed:", e);
        }
      }
      
      const videoCostUsd = (generation.duration || 5) * 0.0408;
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
      const imageGenerations = await storage.getUserImageGenerations(user.id);
      const videoGenerations = await storage.getUserVideoGenerations(user.id);

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

  const httpServer = createServer(app);
  return httpServer;
}

import { fallbackMotionPrompt } from "@shared/dramaMotion";
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { randomBytes, randomInt } from "crypto";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import { insertUserSchema, loginSchema, insertImageGenerationSchema, insertTextToImageSchema, insertImageToImageSchema, insertBatchImageToImageSchema, insertImageToVideoSchema, insertTextToVideoSchema, sendVerificationCodeSchema, registerWithVerificationSchema, insertStoryGenerationSchema, type StoryScene, type DramaScene } from "@shared/schema";
import { sendVerificationEmail } from "./verificationEmail";
import { ObjectStorageService } from "./objectStorage";
import { BunnyStorageService, addWatermark } from "./bunnyStorage";
import { enhanceImagePrompt, enhanceVideoPrompt, plainImagePrompt } from "./promptEnhancer";
import { GOLD_MEMBERSHIP, IMAGE_COST, MEMBERSHIP, MIN_TOPUP, TRIAL, topupCredits, SIGNUP_CREDITS, VIDEO_COST_PER_SECOND, imageCost } from "@shared/pricing";
import { ADULT_AGE, GOLD_ZONE_HEADER, GOLD_ZONE_VALUE, ageFromBirthDate, canUseNsfw, containsMinorTerms, containsNsfw, goldApplicationDone, hasAdultConsent } from "@shared/safety";
import sharp from "sharp";
import { registerDramaLibraryRoutes } from "./dramaLibrary";
import { registerPhotosetRoutes, createPhotosetPlanner } from "./photoset";
import { registerPartnerRoutes, partnerEmbedGuard } from "./partnerApi";
import { partnerWalletConfigured, setWalletAccountLookup, forgetWalletAccount, refreshBalanceSoon } from "./partnerWallet";
import { registerAssetLibraryRoutes } from "./assetLibrary";
import { registerVaultRoutes } from "./vault";
import { registerShowcaseRoutes } from "./showcase";
import { registerCostRoutes, recordProviderUsage } from "./costs";
import { setAtlasUsageListener } from "./atlasProvider";
import { partnerStore, embedWalletAccount, createPartnerImageIngestor, createPartnerUploadStore } from "./partnerStore";
import { atlasSizeDimensions } from "./atlasProvider";
import { assertAllowedRemoteUrl as ssrfAssertAllowedRemoteUrl, assertPublicHttpsUrl, fetchImageWithLimits } from "./ssrfGuard";
import { atlasGenerateImage, atlasGenerateVideo, atlasGenerateTextVideo, atlasIsConfigured, ATLAS_EDIT_MODEL, ATLAS_T2I_MODEL, ATLAS_I2V_MODEL, ATLAS_T2V_MODEL, ATLAS_MAX_REFERENCE_IMAGES } from "./atlasProvider";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

function translateApiError(rawError: string): string {
  const lower = rawError.toLowerCase();
  if (lower.includes("inputtextsensitivecontentdetected") || lower.includes("input text may contain sensitive")) {
    return "提示詞包含敏感內容被系統攔截，請修改用詞後重試（避免暴力、色情、政治、名人姓名等敏感字眼）";
  }
  if (lower.includes("inputimagesensitivecontentdetected") || lower.includes("input image may contain sensitive")) {
    return "上傳圖片包含敏感內容被系統攔截，請更換圖片後重試";
  }
  if (lower.includes("outputimagesensitivecontentdetected") || lower.includes("outputvideosensitivecontentdetected") || lower.includes("output may contain sensitive")) {
    return "生成結果被系統判定含敏感內容，已自動攔截。請調整提示詞後重試";
  }
  if (lower.includes("ratelimit") || lower.includes("rate limit") || lower.includes("too many requests")) {
    return "API 請求過於頻繁，請稍後再試";
  }
  if (lower.includes("invalidparameter") || lower.includes("invalid parameter")) {
    return "請求參數錯誤，請檢查輸入內容（例如圖片格式、解析度、長度）";
  }
  if (lower.includes("imagesizeexceeded") || lower.includes("image size") || lower.includes("filesizetoolarge")) {
    return "圖片檔案過大，請壓縮後再上傳";
  }
  if (lower.includes("unsupportedimageformat") || lower.includes("unsupported image")) {
    return "不支援的圖片格式，請改用 JPG / PNG";
  }
  if (lower.includes("aspectratio") || lower.includes("aspect ratio")) {
    return "圖片長寬比超出範圍，請使用接近正方形或標準比例的圖片";
  }
  if (lower.includes("timeout")) {
    return "影片生成超時，請稍後重試";
  }
  return rawError;
}

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

function generateVerificationCode(): string {
  return randomInt(100000, 1000000).toString();
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
    isAdmin: boolean;
    /** Set when a partner workspace entered through /embed/enter. */
    embed?: { sessionId: string; returnOrigin: string };
  }
}

/**
 * True when the request comes from the gold zone AND the account may use it.
 * Adult prompts are accepted only then; every other page refuses them.
 */
function inGoldZone(req: Request, user: { isAdmin?: boolean | null; isGold?: boolean | null; birthDate?: string | null; nsfwEnabled?: boolean | null }): boolean {
  return req.get(GOLD_ZONE_HEADER) === GOLD_ZONE_VALUE && (!!user.isAdmin || canUseNsfw(user));
}

/** What a paid Stripe session unlocks besides credits: "trial" → 小試身手 used up, "membership" → 正式會員, "gold" → 黃金會員. */
async function applyPurchasedTier(userId: string, kind: string | undefined): Promise<void> {
  if (kind !== "trial" && kind !== "membership" && kind !== "gold") return;
  const buyer = await storage.getUser(userId);
  if (!buyer) return;
  const now = new Date();
  if (kind === "trial") {
    await storage.updateUserProfile(userId, { trialUsedAt: buyer.trialUsedAt ?? now });
    return;
  }
  await storage.updateUserProfile(userId, {
    isMember: true,
    memberSince: buyer.memberSince ?? now,
    ...(kind === "gold" ? { isGold: true, goldSince: buyer.goldSince ?? now } : {}),
  });
}

/**
 * Refusal for a prompt the current page does not accept. Null when it may go ahead.
 * Admins are not held to the ordinary-page rule: their adult prompts go through anywhere.
 */
function promptRefusal(promptText: string, goldZone: boolean, isAdmin: boolean = false): { status: number; body: { error: string; code: string } } | null {
  if (goldZone) {
    return containsMinorTerms(promptText)
      ? { status: 400, body: { error: "這裡不接受與未成年人或學生相關的內容，請修改提示詞。", code: "minor_content" } }
      : null;
  }
  return containsNsfw(promptText) && !isAdmin
    ? { status: 403, body: { error: "這段提示詞包含目前無法生成的內容，請修改後再試。", code: "content_not_allowed" } }
    : null;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "未登录，请先登录" });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();
  const bunnyStorage = new BunnyStorageService();
  app.use(partnerEmbedGuard);
  setWalletAccountLookup(embedWalletAccount);
  if (bunnyStorage.isConfigured()) {
    console.log("✅ Bunny.net storage configured");
  } else {
    console.log("⚠️ Bunny.net storage not configured - files will not be persisted to CDN");
  }

  const CANONICAL_URL = "https://cmai-marker.com";
  const BASE_URL = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : CANONICAL_URL;

  app.get("/sitemap.xml", (_req, res) => {
    const today = new Date().toISOString().split("T")[0];
    const pages = [
      { loc: "/", priority: "1.0", changefreq: "daily" },
      { loc: "/account", priority: "0.6", changefreq: "monthly" },
      { loc: "/transactions", priority: "0.4", changefreq: "weekly" },
    ];

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.map(p => `  <url>
    <loc>${CANONICAL_URL}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
    <xhtml:link rel="alternate" hreflang="zh-TW" href="${CANONICAL_URL}${p.loc}" />
  </url>`).join("\n")}
</urlset>`;

    res.header("Content-Type", "application/xml; charset=utf-8");
    res.send(sitemap);
  });

  app.get("/robots.txt", (_req, res) => {
    const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${CANONICAL_URL}/sitemap.xml`;

    res.header("Content-Type", "text/plain; charset=utf-8");
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

      await sendVerificationEmail({
        to: email,
        code,
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

      console.log("Verification email accepted by Resend");
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

      const welcomeCredits = SIGNUP_CREDITS;
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

        const welcomeCredits = SIGNUP_CREDITS;
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
    // Answer with the last known balance right away; the partner's live balance is fetched in the background.
    if (req.session.embed) refreshBalanceSoon(user.id, (balance) => storage.setCreditsMirror(user.id, balance));

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      credits: user.credits,
      isAdmin: user.isAdmin || false,
      createdAt: user.createdAt,
      isMember: user.isMember || false,
      isGold: user.isGold || false,
      trialUsedAt: user.trialUsedAt ?? null,
      freeFourViewUsedAt: user.freeFourViewUsedAt ?? null,
      birthDate: user.birthDate ?? null,
      nsfwEnabled: hasAdultConsent(user),
      realName: user.realName ?? null,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
      onboardedAt: user.onboardedAt ?? null,
      embed: req.session.embed ? { returnOrigin: req.session.embed.returnOrigin } : null,
    });
  });

  // ===== ACCOUNT: SAFETY & PRIVACY =====

  // Birthday (set once), real name, and the application for the gold tier
  // (nsfwEnabled: true). The application needs an 18+ birthday, a confirmed
  // e-mail, a real name and acceptance of GOLD_TERMS_OF_USE; it is required
  // before the gold tier can be bought.
  app.patch("/api/account/safety", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ error: "用戶不存在" });
      const { birthDate, nsfwEnabled, acceptTerms, realName } = req.body ?? {};
      const patch: Parameters<typeof storage.updateUserProfile>[1] = {};

      if (birthDate !== undefined && birthDate !== user.birthDate) {
        if (user.birthDate) return res.status(400).json({ error: "生日設定後無法自行修改，如需更正請聯繫客服。" });
        if (typeof birthDate !== "string" || ageFromBirthDate(birthDate) === null) {
          return res.status(400).json({ error: "請輸入正確的生日。" });
        }
        patch.birthDate = birthDate;
      }
      const effectiveBirthDate = patch.birthDate ?? user.birthDate;

      if (realName !== undefined) {
        const name = typeof realName === "string" ? realName.trim() : "";
        if (name.length < 2 || name.length > 40) return res.status(400).json({ error: "請填寫真實姓名（2 到 40 個字）。" });
        patch.realName = name;
      }

      if (nsfwEnabled === true) {
        const age = ageFromBirthDate(effectiveBirthDate);
        if (age === null) return res.status(400).json({ error: "請先設定生日。" });
        if (age < ADULT_AGE) return res.status(403).json({ error: `未滿 ${ADULT_AGE} 歲無法加入。` });
        if (!user.emailVerifiedAt) return res.status(400).json({ error: "請先完成 Email 認證。" });
        if (!(patch.realName ?? user.realName)) return res.status(400).json({ error: "請先填寫真實姓名。" });
        if (acceptTerms !== true) return res.status(400).json({ error: "請先閱讀並同意使用條款。" });
        patch.nsfwEnabled = true;
        patch.nsfwConsentAt = new Date();
      } else if (nsfwEnabled === false) {
        patch.nsfwEnabled = false;
      }

      const updated = Object.keys(patch).length > 0 ? await storage.updateUserProfile(user.id, patch) : user;
      res.json({ birthDate: updated?.birthDate ?? null, nsfwEnabled: hasAdultConsent(updated) });
    } catch (error) {
      console.error("Error updating safety settings:", error);
      res.status(500).json({ error: "設定儲存失敗，請稍後再試。" });
    }
  });

  // E-mail confirmation for the gold tier: a 6-digit code sent to the account's own address.
  app.post("/api/account/email-code", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ error: "用戶不存在" });
      if (user.emailVerifiedAt) return res.json({ success: true, alreadyVerified: true });

      const recentCode = await storage.getRecentVerificationCode(user.email);
      if (recentCode) {
        const elapsed = Date.now() - new Date(recentCode.createdAt!).getTime();
        if (elapsed < 60000) return res.status(429).json({ error: `請等待 ${Math.ceil((60000 - elapsed) / 1000)} 秒後再重新寄送` });
      }
      storage.deleteExpiredVerificationCodes().catch(() => {});

      const code = generateVerificationCode();
      await storage.createVerificationCode(user.email, code, new Date(Date.now() + 10 * 60 * 1000));
      await gmailTransporter.sendMail({
        from: `AI 創意工坊 <${process.env.GMAIL_USER || ""}>`,
        to: user.email,
        subject: "AI 創意工坊 - Email 驗證碼",
        html: `
          <div style="font-family: 'Microsoft JhengHei', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f5f3ff; border-radius: 16px;">
            <div style="background: white; border-radius: 12px; padding: 24px; text-align: center;">
              <p style="color: #374151; font-size: 16px; margin-bottom: 8px;">您的 Email 驗證碼為：</p>
              <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #7c3aed; padding: 16px; background: #f5f3ff; border-radius: 8px; margin: 16px 0;">${code}</div>
              <p style="color: #6b7280; font-size: 14px; margin-top: 16px;">驗證碼有效期為 10 分鐘。</p>
              <p style="color: #9ca3af; font-size: 12px; margin-top: 8px;">如果這不是您本人的操作，請忽略此郵件。</p>
            </div>
          </div>
        `,
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Error sending account email code:", error);
      res.status(500).json({ error: "驗證碼發送失敗，請稍後再試" });
    }
  });

  app.post("/api/account/verify-email", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ error: "用戶不存在" });
      if (user.emailVerifiedAt) return res.json({ success: true });
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "請輸入 6 位數驗證碼。" });
      const valid = await storage.getValidVerificationCode(user.email, code);
      if (!valid) return res.status(400).json({ error: "驗證碼不正確或已過期，請重新寄送。" });
      await storage.markVerificationCodeUsed(valid.id);
      await storage.updateUserProfile(user.id, { emailVerifiedAt: new Date() });
      res.json({ success: true });
    } catch (error) {
      console.error("Error verifying account email:", error);
      res.status(500).json({ error: "驗證失敗，請稍後再試。" });
    }
  });

  app.post("/api/account/onboarded", requireAuth, async (req, res) => {
    try {
      await storage.updateUserProfile(req.session.userId!, { onboardedAt: new Date() });
      res.json({ ok: true });
    } catch (error) {
      console.error("Error marking onboarding done:", error);
      res.status(500).json({ error: "儲存失敗" });
    }
  });

  // Lightweight personal video history feed for the home.tsx "我的影片"
  // sheet. Returns the caller's most recent video generations with Bunny
  // CDN URLs normalized so the frontend can render thumbnails / players
  // without an extra round trip.
  app.get("/api/my-videos", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "未登入" });
    }
    try {
      const raw = await storage.getUserVideoGenerations(req.session.userId);
      const videoGenerations = raw.slice(0, 50).map(g => {
        const r: any = { ...g };
        r.bunnyVideoUrl = fixBunnyCdnUrl(r.bunnyVideoUrl) as string;
        if (r.bunnyVideoUrl) r.generatedVideoUrl = r.bunnyVideoUrl;
        return r;
      });
      res.json({ videoGenerations });
    } catch (error) {
      console.error("Error fetching my videos:", error);
      res.status(500).json({ error: "獲取影片列表失敗" });
    }
  });

  // ===== CREDIT ROUTES =====

  // Manual credit adjustment. Admins only: customers pay through Stripe.
  app.post("/api/credits/topup", requireAuth, async (req, res) => {
    try {
      if (!req.session.isAdmin) {
        return res.status(403).json({ error: "請透過付款頁面加購積分。" });
      }
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
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ error: "用戶不存在" });
      }
      const isMembership = req.body?.kind === "membership";
      const isGoldUpgrade = req.body?.kind === "gold";
      const isTrial = req.body?.kind === "trial";
      const amount = req.body?.amount;

      if (isTrial) {
        if (user.isMember) return res.status(400).json({ error: "你已經是會員了，直接加購積分即可。" });
        if (user.trialUsedAt) return res.status(400).json({ error: "小試身手每個帳號只能買一次，歡迎開通會員。" });
      } else if (isGoldUpgrade) {
        if (user.isGold) return res.status(400).json({ error: "你已經是黃金會員了。" });
        if (!user.isMember && !user.isAdmin) {
          return res.status(403).json({ error: "請先開通會員，才能升級黃金會員。", code: "membership_required" });
        }
        if (!goldApplicationDone(user)) {
          return res.status(403).json({ error: "請先到帳戶設定完成 Email 認證、真實姓名與條款確認。", code: "gold_application_required" });
        }
      } else if (isMembership) {
        if (user.isMember) return res.status(400).json({ error: "你已經是會員了，直接加購積分即可。" });
      } else {
        if (!user.isMember && !user.isAdmin) {
          return res.status(403).json({ error: "請先開通會員，之後就能加購積分。", code: "membership_required" });
        }
        if (!amount || !Number.isInteger(amount) || amount < MIN_TOPUP) {
          return res.status(400).json({ error: `儲值金額最少 NT$${MIN_TOPUP}` });
        }
      }

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const baseUrl = `${protocol}://${host}`;
      const credits = isTrial ? TRIAL.credits : isGoldUpgrade ? GOLD_MEMBERSHIP.credits : isMembership ? MEMBERSHIP.credits : topupCredits(amount);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: isTrial
              ? {
                  currency: "usd",
                  product_data: {
                    name: "AI 創意工坊 - 小試身手",
                    description: `${TRIAL.credits} 積分，每個帳號限購一次`,
                  },
                  unit_amount: Math.round(TRIAL.priceUsd * 100),
                }
              : isGoldUpgrade
              ? {
                  currency: "usd",
                  product_data: {
                    name: "AI 創意工坊 - 黃金會員",
                    description: `一次性升級黃金會員，含 ${GOLD_MEMBERSHIP.credits} 積分`,
                  },
                  unit_amount: Math.round(GOLD_MEMBERSHIP.priceUsd * 100),
                }
              : isMembership
              ? {
                  currency: "usd",
                  product_data: {
                    name: "AI 創意工坊 - 開通會員",
                    description: `一次性開通會員，含 ${MEMBERSHIP.credits} 積分`,
                  },
                  unit_amount: Math.round(MEMBERSHIP.priceUsd * 100),
                }
              : {
                  currency: "twd",
                  product_data: {
                    name: `AI 創意工坊 - ${credits} 積分`,
                    description: `儲值 NT$${amount}，獲得 ${credits} 積分`,
                  },
                  unit_amount: amount * 100,
                },
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: `${baseUrl}/store?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/store?payment=cancelled`,
        metadata: {
          userId: user.id,
          credits: String(credits),
          kind: isTrial ? "trial" : isGoldUpgrade ? "gold" : isMembership ? "membership" : "topup",
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
            await storage.setTransactionPayment(stripeDesc, session.amount_total ?? 0, session.currency ?? "").catch(() => {});
            await applyPurchasedTier(userId, session.metadata?.kind);
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
        return res.json({ success: true, credits, alreadyProcessed: true, membership: session.metadata?.kind === "membership", gold: session.metadata?.kind === "gold", kind: session.metadata?.kind ?? "topup" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "用戶不存在" });
      }

      await storage.atomicAddCredits(userId, credits, stripeDesc);
      await storage.setTransactionPayment(stripeDesc, session.amount_total ?? 0, session.currency ?? "").catch(() => {});
      await applyPurchasedTier(userId, session.metadata?.kind);

      const updatedUser = await storage.getUser(userId);
      console.log(`Stripe verify: credited ${credits} to user ${userId}, new balance: ${updatedUser?.credits}`);
      res.json({ success: true, credits, newBalance: updatedUser?.credits, membership: session.metadata?.kind === "membership", gold: session.metadata?.kind === "gold", kind: session.metadata?.kind ?? "topup" });
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

      // Daily abuse cap (admins bypass). Counts rows the user has already
      // started today (UTC), regardless of status, to also throttle bursts
      // that haven't completed yet. Tuned generous for normal heavy use.
      if (!user.isAdmin) {
        const DAILY_IMAGE_LIMIT = 50;
        const todayCount = await storage.getUserDailyImageCount(userId);
        // Sanitize: clamp requestedCount to a positive integer in [1, limit]
        // so a malformed/string maxImages from raw body can't bypass or
        // distort the cap. Falls back to 1 for unknown shapes.
        const rawRequested = Array.isArray(req.body.prompts)
          ? req.body.prompts.length
          : (req.body.sequentialGeneration && req.body.maxImages)
            ? Number(req.body.maxImages)
            : 1;
        const requestedCount = Math.min(
          DAILY_IMAGE_LIMIT,
          Math.max(1, Number.isFinite(rawRequested) ? Math.floor(rawRequested) : 1),
        );
        if (todayCount + requestedCount > DAILY_IMAGE_LIMIT) {
          return res.status(429).json({
            error: `今日圖片生成次數已達上限（${DAILY_IMAGE_LIMIT} 張/日），請明天再試或聯繫客服提升額度。`,
            limit: DAILY_IMAGE_LIMIT,
            used: todayCount,
          });
        }
      }

      // ----- Validate FIRST, then deduct credits -----
      // The previous order (deduct → parse) could charge users for malformed
      // requests because zod errors raised after deduction were not refunded.
      // Now we parse schemas up front, derive the true per-image cost from
      // validated data, and only then move money. Batch and single paths are
      // validated separately so each gets its proper schema.
      const isBatch = Array.isArray(req.body.prompts);
      let batchValidated: ReturnType<typeof insertBatchImageToImageSchema.parse> | null = null;
      let singleValidated:
        | ReturnType<typeof insertTextToImageSchema.parse>
        | ReturnType<typeof insertImageToImageSchema.parse>
        | null = null;
      if (isBatch) {
        batchValidated = insertBatchImageToImageSchema.parse(req.body);
      } else {
        const requestType = req.body.type || "image-to-image";
        singleValidated = requestType === "text-to-image"
          ? insertTextToImageSchema.parse(req.body)
          : insertImageToImageSchema.parse(req.body);
      }

      // All image generation runs on AtlasCloud Seedream 5.5. Any legacy
      // `provider` / `model` fields sent by an old client are ignored.
      // Per-image credit cost honours the watermark removal premium.
      const hasWatermark = req.body.watermark !== false;
      const perImageCost = imageCost(hasWatermark, inGoldZone(req, user));

      // Adult prompts are accepted only from the gold zone, by a gold member
      // (18+ and terms accepted). Checked before any credits move. Everything
      // made in the gold zone is stored as sensitive (blurred until opened).
      const promptText = batchValidated ? batchValidated.prompts.join("\n") : String((singleValidated as any)?.prompt ?? "");
      const goldZone = inGoldZone(req, user);
      const refusal = promptRefusal(promptText, goldZone, !!user.isAdmin);
      if (refusal) return res.status(refusal.status).json(refusal.body);
      // Also sensitive: an admin's adult prompt sent from an ordinary page.
      const sensitive = goldZone || containsNsfw(promptText);

      let creditsNeeded: number;
      if (batchValidated) {
        creditsNeeded = perImageCost * batchValidated.prompts.length;
      } else if (singleValidated && (singleValidated as any).sequentialGeneration && (singleValidated as any).maxImages && (singleValidated as any).maxImages > 1) {
        creditsNeeded = perImageCost * (singleValidated as any).maxImages;
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

      if (batchValidated) {
        const generations = await storage.createBatchImageGenerations({ ...batchValidated, userId });
        await Promise.all(generations.map(gen =>
          // creditsUsed per row, so a failed shot refunds exactly what it cost.
          storage.updateImageGeneration(gen.id, { provider: "atlas", model: ATLAS_EDIT_MODEL, creditsUsed: perImageCost, sensitive } as any)));
        generations.forEach(gen => { gen.creditsUsed = perImageCost; gen.sensitive = sensitive; });

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
        // Persist provider / model / creditsUsed so the worker branches
        // correctly and any failure refunds the right amount.
        const generation = await storage.createImageGeneration({
          ...(singleValidated as any),
          userId,
          provider: "atlas",
          model: (singleValidated as any).type === "text-to-image" ? ATLAS_T2I_MODEL : ATLAS_EDIT_MODEL,
          // Store the actual amount charged (which for sequential
          // generation is perImageCost × maxImages) so a failure refunds
          // exactly what was deducted.
          creditsUsed: creditsNeeded,
          sensitive,
        });

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

  /** opts.rawPrompt: send the prompt as written, without the prompt enhancer
   *  (used by the partner API, whose output goes to public social accounts). */
  async function processImageGeneration(generationId: string, baseUrl?: string, opts: { rawPrompt?: boolean } = {}) {
    try {
      await storage.updateImageGeneration(generationId, { status: "processing" });
      
      const generation = await storage.getImageGeneration(generationId);
      if (!generation) return;

      const generationUser = await storage.getUser(generation.userId);
      const userFolder = generationUser?.username || generation.userId;

      const startTime = Date.now();

      if (!atlasIsConfigured()) {
        throw new Error("ATLASCLOUD_API_KEY environment variable is not set. Please configure your AtlasCloud API key for Seedream 5.5.");
      }

      // Reference images (image-to-image). Seedream 5.5 edit takes 1–10
      // references as base64 data URIs; text-to-image sends none.
      let referenceImages: string[] = [];
      if (generation.type !== "text-to-image") {
        if (!generation.originalImageUrl) {
          throw new Error("Original image URL is required for image-to-image generation");
        }

        const getImageAsDataUri = async (imageUrl: string): Promise<string> => {
          // Images already on our CDN (e.g. a library character's generated
          // pack) are public, so hand the URL to Atlas as-is. The allowlist
          // keeps arbitrary user-supplied hosts out.
          if (/^https?:\/\//i.test(imageUrl)) {
            return ssrfAssertAllowedRemoteUrl(imageUrl).toString();
          }
          console.log(`Getting image from object storage: ${imageUrl}`);
          const objectFile = await objectStorageService.getObjectEntityFile(imageUrl);
          const chunks: Buffer[] = [];
          for await (const chunk of objectFile.createReadStream()) {
            chunks.push(Buffer.from(chunk));
          }
          return `data:image/jpeg;base64,${Buffer.concat(chunks).toString("base64")}`;
        };

        const sourceUrls = [generation.originalImageUrl, ...(generation.additionalImageUrls ?? [])]
          .slice(0, ATLAS_MAX_REFERENCE_IMAGES);
        for (const url of sourceUrls) {
          referenceImages.push(await getImageAsDataUri(url));
        }
        console.log(`Using ${referenceImages.length} reference image(s)`);
      }

      const sizeValue = generation.size || (generation.type === "text-to-image" ? "1:1" : "2K");
      // The adult prefix goes on every image sent from the gold zone (stored as sensitive), and on nothing else.
      const finalPrompt = opts.rawPrompt || !generation.sensitive ? generation.prompt : enhanceImagePrompt(generation.prompt);

      // One Seedream 5.5 image via AtlasCloud (submit + poll). Throws on any
      // failure so the outer catch refunds the user's credits.
      const generateOneImage = (): Promise<string> =>
        atlasGenerateImage({ prompt: finalPrompt, images: referenceImages, size: sizeValue });

      const isSequential = generation.sequentialGeneration && generation.maxImages && generation.maxImages > 1;
      
      if (isSequential) {
        // Seedream 5.5 generates one image per request, so fan out N
        // parallel single-image requests and collect whatever succeeds.
        const count = generation.maxImages!;
        console.log(`Sequential mode: issuing ${count} parallel single-image requests`);
        const settled = await Promise.allSettled(
          Array.from({ length: count }, () => generateOneImage())
        );
        const generatedImageUrls = settled
          .filter((s): s is PromiseFulfilledResult<string> => s.status === "fulfilled")
          .map(s => s.value);
        const processingTime = (Date.now() - startTime) / 1000;

        console.log(`Sequential generation completed with ${generatedImageUrls.length}/${count} images`);

        if (generatedImageUrls.length === 0) {
          const firstRejection = settled.find(s => s.status === "rejected") as PromiseRejectedResult | undefined;
          const reason = firstRejection?.reason instanceof Error
            ? firstRejection.reason.message
            : "No generated images";
          throw new Error(reason);
        }

        // Partial success: refund the credits for the images that failed,
        // since the user was pre-charged for all `count` images.
        const failedCount = count - generatedImageUrls.length;
        if (failedCount > 0 && generation.userId) {
          const perImage = Math.floor((generation.creditsUsed || 0) / count);
          const refundAmount = perImage * failedCount;
          if (refundAmount > 0) {
            try {
              await storage.atomicAddCredits(
                generation.userId,
                refundAmount,
                `組圖部分失敗退還 ${failedCount} 張共 ${refundAmount} 積分`
              );
              console.log(`✅ Refunded ${refundAmount} credits for ${failedCount} failed sequential images`);
            } catch (refundErr) {
              console.error("Partial refund failed:", refundErr);
            }
          }
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
        const generatedImageUrl = await generateOneImage();
        const processingTime = (Date.now() - startTime) / 1000;

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

      // Daily abuse cap (admins bypass). Mirrors the image endpoint cap;
      // videos are far more expensive (15 credits/sec at 1080P) so the
      // cap is tighter even though credits already constrain spend.
      if (!user.isAdmin) {
        const DAILY_VIDEO_LIMIT = 10;
        const todayCount = await storage.getUserDailyVideoCount(userId);
        if (todayCount >= DAILY_VIDEO_LIMIT) {
          return res.status(429).json({
            error: `今日影片生成次數已達上限（${DAILY_VIDEO_LIMIT} 支/日），請明天再試或聯繫客服提升額度。`,
            limit: DAILY_VIDEO_LIMIT,
            used: todayCount,
          });
        }
      }

      // Validate first so a malformed request (e.g. >3 reference images, bad
      // audio URL, missing main image) cannot consume credits.
      const videoType = req.body.type || "image-to-video";
      const validatedData = videoType === "text-to-video"
        ? insertTextToVideoSchema.parse(req.body)
        : insertImageToVideoSchema.parse(req.body);

      // All video generation runs on AtlasCloud WAN 3.0. Any legacy
      // `provider` / `model` fields sent by an old client are ignored.
      const provider = "atlas";
      const modelId = videoType === "image-to-video" ? ATLAS_I2V_MODEL : ATLAS_T2V_MODEL;
      const duration = Math.max(4, Math.min(12, req.body.duration || 5));
      const resolution = req.body.resolution === "720p" ? "720p" : "1080p";
      const VIDEO_CREDITS_PER_SECOND = VIDEO_COST_PER_SECOND[resolution];
      const videoRefusal = promptRefusal(String(req.body.prompt ?? ""), inGoldZone(req, user), !!user.isAdmin);
      if (videoRefusal) return res.status(videoRefusal.status).json(videoRefusal.body);
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

      const generation = await storage.createVideoGeneration({
        ...validatedData,
        userId,
        provider,
        model: modelId,
      } as any);

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

  /**
   * WAN image-to-video needs a publicly reachable image URL. Public https
   * URLs pass through; object-storage paths are copied to Bunny CDN first.
   */
  async function toPublicImageUrl(
    urlOrPath: string,
    objectStorageService: ObjectStorageService,
    bunnyRemotePath: string,
  ): Promise<string> {
    if (/^https:\/\//i.test(urlOrPath)) return urlOrPath;
    if (!bunnyStorage.isConfigured()) {
      throw new Error("圖生影片需要可公開存取的圖片網址，但 Bunny CDN 尚未設定，無法轉存上傳的圖片。");
    }
    const objectFile = await objectStorageService.getObjectEntityFile(urlOrPath);
    const chunks: Buffer[] = [];
    for await (const chunk of objectFile.createReadStream()) {
      chunks.push(Buffer.from(chunk));
    }
    // Normalise to JPEG: WAN rejects alpha channels and exotic formats.
    const jpeg = await sharp(Buffer.concat(chunks)).rotate().flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
    return fixBunnyCdnUrl(await bunnyStorage.uploadBuffer(jpeg, bunnyRemotePath)) as string;
  }

  /** opts.rawPrompt: see processImageGeneration. */
  async function processVideoGeneration(generationId: string, objectStorageService: ObjectStorageService, opts: { rawPrompt?: boolean } = {}) {
    try {
      await storage.updateVideoGeneration(generationId, { status: "processing" });

      const generation = await storage.getVideoGeneration(generationId);
      if (!generation) return;

      const videoUser = await storage.getUser(generation.userId);
      const userFolder = videoUser?.username || generation.userId;

      // ---- Image-to-video: AtlasCloud WAN 3.0 ----
      // WAN takes exactly one first frame as a PUBLIC URL, so the uploaded
      // image is re-hosted on Bunny first. It has no extra-reference-image or
      // reference-audio inputs — those fields are ignored for image-to-video.
      if (generation.originalImageUrl) {
        if (!atlasIsConfigured()) {
          throw new Error("ATLASCLOUD_API_KEY environment variable is not set");
        }
        if ((generation.additionalImageUrls?.length ?? 0) > 0 || generation.referenceAudioUrl) {
          console.warn(`[Atlas] WAN 3.0 image-to-video ignores extra reference images / reference audio (generation ${generationId})`);
        }
        const firstFrameUrl = await toPublicImageUrl(
          generation.originalImageUrl,
          objectStorageService,
          `users/${userFolder}/video-inputs/${generationId}.jpg`,
        );
        const { videoUrl, predictionId, processingTime } = await atlasGenerateVideo({
          prompt: opts.rawPrompt || !containsNsfw(generation.prompt) ? generation.prompt : enhanceVideoPrompt(generation.prompt),
          image: firstFrameUrl,
          resolution: generation.resolution || "1080p",
          duration: generation.duration || 5,
        });
        await storage.updateVideoGeneration(generationId, { taskId: predictionId });
        console.log(`✅ WAN video generation completed: ${videoUrl}`);

        // Re-host on Bunny CDN so the provider's short-lived URL doesn't 404.
        assertPublicHttpsUrl(videoUrl);
        let bunnyVideoUrl: string | undefined;
        if (bunnyStorage.isConfigured()) {
          try {
            bunnyVideoUrl = await bunnyStorage.uploadVideoFromUrl(videoUrl, userFolder, generationId);
            console.log(`✅ WAN video re-hosted on Bunny: ${bunnyVideoUrl}`);
          } catch (e) {
            console.error("Bunny upload of WAN video failed (will keep original URL):", e);
          }
        }

        const costPerSec = (generation.resolution || "1080p") === "720p" ? 5.5 : 11;
        await storage.updateVideoGeneration(generationId, {
          status: "completed",
          generatedVideoUrl: videoUrl,
          bunnyVideoUrl,
          processingTime,
          cost: parseFloat(((generation.duration || 5) * costPerSec).toFixed(4)),
        });
        return;
      }

      // ---- Text-to-video: AtlasCloud WAN 3.0 ----
      // WAN has no reference-audio input; the native audio track is on.
      if (!atlasIsConfigured()) {
        throw new Error("ATLASCLOUD_API_KEY environment variable is not set");
      }
      if (generation.referenceAudioUrl) {
        console.warn(`[Atlas] WAN 3.0 text-to-video ignores reference audio (generation ${generationId})`);
      }
      const t2v = await atlasGenerateTextVideo({
        prompt: opts.rawPrompt || !containsNsfw(generation.prompt) ? generation.prompt : enhanceVideoPrompt(generation.prompt),
        resolution: generation.resolution || "1080p",
        duration: generation.duration || 5,
        aspectRatio: generation.aspectRatio || "16:9",
      });
      await storage.updateVideoGeneration(generationId, { taskId: t2v.predictionId });
      console.log(`✅ WAN text-to-video completed: ${t2v.videoUrl}`);

      assertPublicHttpsUrl(t2v.videoUrl);
      let t2vBunnyUrl: string | undefined;
      if (bunnyStorage.isConfigured()) {
        try {
          t2vBunnyUrl = await bunnyStorage.uploadVideoFromUrl(t2v.videoUrl, userFolder, generationId);
          console.log(`✅ Uploaded video to Bunny.net for user ${userFolder}: ${t2vBunnyUrl}`);
        } catch (e) {
          console.error("Bunny video upload failed:", e);
        }
      }

      const t2vCostPerSec = (generation.resolution || "1080p") === "720p" ? 5.5 : 11;
      await storage.updateVideoGeneration(generationId, {
        status: "completed",
        generatedVideoUrl: t2v.videoUrl,
        bunnyVideoUrl: t2vBunnyUrl,
        processingTime: t2v.processingTime,
        cost: parseFloat(((generation.duration || 5) * t2vCostPerSec).toFixed(4)),
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
      const perScenePromptsByActual: Record<string, string> = (typeof req.body.perScenePromptsByActual === "object" && !Array.isArray(req.body.perScenePromptsByActual)) ? req.body.perScenePromptsByActual : {};
      const perSceneResolutions: Record<string, string> = (typeof req.body.perSceneResolutions === "object" && !Array.isArray(req.body.perSceneResolutions)) ? req.body.perSceneResolutions : {};
      const perSceneDurations: Record<string, number> = (typeof req.body.perSceneDurations === "object" && !Array.isArray(req.body.perSceneDurations)) ? req.body.perSceneDurations : {};

      const story = await storage.getStoryGeneration(storyId);
      if (!story) return res.status(404).json({ error: "找不到故事" });
      if (story.userId !== userId) return res.status(403).json({ error: "無存取權限" });
      if (!["completed", "generating"].includes(story.status)) return res.status(400).json({ error: "故事尚未開始生成" });

      const scenes: StoryScene[] = JSON.parse(story.scenes || "[]");
      const completedScenes = scenes.filter(s => s.status === "completed" && (s.bunnyUrl || s.imageUrl));
      if (completedScenes.length === 0) return res.status(400).json({ error: "沒有可生成動畫的場景" });

      // Calculate per-scene credits using individual durations
      const sceneInfos = completedScenes.map(scene => {
        const sceneIdx = scenes.indexOf(scene);
        const sceneResolution: "720p" | "1080p" = perSceneResolutions[String(sceneIdx)] === "720p" ? "720p" : perSceneResolutions[String(sceneIdx)] === "1080p" ? "1080p" : resolution;
        const rawDuration = Number(perSceneDurations[String(sceneIdx)]);
        const sceneDuration = (rawDuration >= 4 && rawDuration <= 12) ? rawDuration : duration;
        const sceneCredits = Math.round(sceneDuration * (sceneResolution === "720p" ? 8 : 15));
        return { scene, sceneIdx, sceneResolution, sceneDuration, sceneCredits };
      });
      const totalCredits = sceneInfos.reduce((sum, s) => sum + s.sceneCredits, 0);

      const user = await storage.getUser(userId);
      if (!user || (user.credits ?? 0) < totalCredits) {
        return res.status(400).json({ error: `積分不足，需要 ${totalCredits} 積分` });
      }

      await storage.atomicAddCredits(userId, -totalCredits, `故事「${story.title}」批量動畫生成 ${completedScenes.length} 幕`);

      const storyUser = await storage.getUser(userId);
      const userFolder = storyUser?.username || userId;
      const jobs: { sceneIdx: number; sceneTitle: string; videoId: string }[] = [];

      for (const { scene, sceneIdx, sceneResolution, sceneDuration, sceneCredits } of sceneInfos) {
        const imageUrl = scene.bunnyUrl || scene.imageUrl!;
        const prompt = perScenePromptsByActual[String(sceneIdx)]?.trim() || animationPrompt || scene.description;

        const videoGen = await storage.createVideoGeneration({
          userId,
          type: "image-to-video",
          prompt,
          originalImageUrl: imageUrl,
          duration: sceneDuration,
          resolution: sceneResolution,
          aspectRatio,
          cameraFixed: false,
        });

        jobs.push({ sceneIdx, sceneTitle: scene.title || `第 ${sceneIdx + 1} 幕`, videoId: videoGen.id });
        processSceneAnimation(videoGen.id, imageUrl, bunnyStorage, userFolder, storyId, sceneIdx, sceneCredits).catch(console.error);
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
    creditsPerScene: number,
    tailImageUrl?: string
  ) {
    const startTime = Date.now();
    try {
      await storage.updateVideoGeneration(videoId, { status: "processing" });
      const generation = await storage.getVideoGeneration(videoId);
      if (!generation) return;

      if (!atlasIsConfigured()) throw new Error("ATLASCLOUD_API_KEY 未設定");

      const imgResponse = await fetch(imageUrl);
      if (!imgResponse.ok) throw new Error(`無法下載場景圖片: ${imgResponse.status}`);
      const imageBuffer = Buffer.from(await imgResponse.arrayBuffer());

      // Detect the actual image ratio (WAN output follows the first frame).
      const meta = await sharp(imageBuffer).metadata();
      const w = meta.width || 1;
      const h = meta.height || 1;

      // Auto-detect closest standard ratio from actual image dimensions
      const detectedRatio = w / h;
      let autoAspect: string;
      if (detectedRatio >= 1.4) autoAspect = "16:9";
      else if (detectedRatio <= 0.75) autoAspect = "9:16";
      else autoAspect = "1:1";

      // Update the DB record with the detected aspect ratio
      await storage.updateVideoGeneration(videoId, { aspectRatio: autoAspect });
      console.log(`🎬 Scene animation: image ${w}x${h} (ratio ${detectedRatio.toFixed(2)}) → auto aspect ${autoAspect}`);

      const promptText = enhanceVideoPrompt(generation.prompt || "");
      console.log(`🎬 Story scene ${sceneIdx}: prompt="${promptText.substring(0, 100)}..." | duration=${generation.duration}s | ratio=${autoAspect} | tail=${!!tailImageUrl}`);

      // AtlasCloud WAN 3.0: scene image is the first frame; the next scene's
      // image (when supplied) is the last frame for a smooth transition.
      // Both are already public CDN / provider URLs.
      const wan = await atlasGenerateVideo({
        prompt: promptText,
        image: imageUrl,
        lastImage: tailImageUrl,
        resolution: generation.resolution || "720p",
        duration: generation.duration || 5,
      });
      const videoUrl = wan.videoUrl;
      await storage.updateVideoGeneration(videoId, { taskId: wan.predictionId });
      console.log(`✅ Story scene animation done: ${wan.predictionId} (scene ${sceneIdx})`);

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
      const costPerSec = vidRes === "720p" ? 5.5 : 11;
      const videoCostTwd = duration * costPerSec;

      await storage.updateVideoGeneration(videoId, {
        status: "completed",
        generatedVideoUrl: videoUrl,
        bunnyVideoUrl,
        processingTime,
        cost: parseFloat(videoCostTwd.toFixed(4)),
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
            isMember: user.isMember || false,
            isGold: user.isGold || false,
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
          isMember: user.isMember || false,
          isGold: user.isGold || false,
          memberSince: user.memberSince ?? null,
          goldSince: user.goldSince ?? null,
          birthDate: user.birthDate ?? null,
          adultConfirmed: hasAdultConsent(user),
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

  // Set a user's tier by hand: none → 未開通, member → 正式會員, gold → 黃金會員.
  // Gold still needs the user to be 18+ and to accept the terms before the zone opens.
  app.patch("/api/admin/users/:userId/membership", requireAuth, requireAdmin, async (req, res) => {
    try {
      const tier = req.body?.tier;
      if (tier !== "none" && tier !== "member" && tier !== "gold") {
        return res.status(400).json({ error: "請選擇會員階級。" });
      }
      const user = await storage.getUser(req.params.userId);
      if (!user) return res.status(404).json({ error: "用戶不存在" });
      const now = new Date();
      const updated = await storage.updateUserProfile(user.id, {
        isMember: tier !== "none",
        memberSince: tier === "none" ? null : user.memberSince ?? now,
        isGold: tier === "gold",
        goldSince: tier === "gold" ? user.goldSince ?? now : null,
      });
      console.log(`Admin ${req.session.userId} set user ${user.id} tier to ${tier}`);
      res.json({ isMember: updated?.isMember || false, isGold: updated?.isGold || false, adultConfirmed: hasAdultConsent(updated) });
    } catch (error) {
      console.error("Error updating membership:", error);
      res.status(500).json({ error: "調整會員階級失敗" });
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
          creditsUsed: r.creditsUsed || IMAGE_COST,
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
          creditsUsed: r.creditsUsed || Math.round((r.duration || 5) * 15),
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
          creditsUsed: g.creditsUsed || sceneCount * IMAGE_COST,
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
      const { title, style, scenes, referenceImageUrls, sceneSize, characterImageUrls, characterBImageUrls, sceneRefImageUrls, styleImageUrls, globalSeed } = validated.data;
      const creditsNeeded = scenes.length * IMAGE_COST;

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
        characterBImageUrls: characterBImageUrls ?? [],
        sceneRefImageUrls: sceneRefImageUrls ?? [],
        styleImageUrls: styleImageUrls ?? [],
        globalSeed: globalSeed ?? undefined,
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
      // tailSceneIdx: server resolves the tail image URL from story data to prevent SSRF
      const rawTailIdx = req.body.tailSceneIdx;
      const tailSceneIdx = (rawTailIdx !== undefined && rawTailIdx !== null && !isNaN(Number(rawTailIdx))) ? Number(rawTailIdx) : undefined;

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

      // Resolve tail image URL from story's own scenes (no client-supplied URL)
      let tailImageUrl: string | undefined;
      if (tailSceneIdx !== undefined && tailSceneIdx >= 0 && tailSceneIdx < scenes.length) {
        const tailScene = scenes[tailSceneIdx];
        if (tailScene?.status === "completed" && (tailScene.bunnyUrl || tailScene.imageUrl)) {
          tailImageUrl = tailScene.bunnyUrl || tailScene.imageUrl || undefined;
        }
      }

      const VIDEO_CREDITS_PER_SECOND = VIDEO_COST_PER_SECOND[resolution];
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

      processSceneAnimation(videoGen.id, imageUrl, bunnyStorage, userFolder, storyId, sceneIdx, credits, tailImageUrl || undefined).catch(console.error);

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
      // Map Claude's 0-based completed-scene indices back to ACTUAL scene indices in the full array
      const completedWithActualIdx = completedScenes.map((s, ci) => ({
        completedIdx: ci,
        actualIdx: scenes.indexOf(s),
      }));
      const mappedScenes = (parsed.scenes || []).map((s: any, fi: number) => {
        const mapping = completedWithActualIdx[fi];
        return {
          actualSceneIndex: mapping?.actualIdx ?? fi,
          sceneTitle: s.sceneTitle || completedScenes[fi]?.title || `第 ${fi + 1} 幕`,
          animation_prompt: s.animation_prompt || "",
        };
      });
      res.json({ scenes: mappedScenes });
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
      const rawScenes: Array<{ enhanced_prompt: string }> = parsed.scenes || [];
      const fixedScenes = rawScenes.slice(0, scenes.length).map((s, i) => ({
        index: i,
        enhanced_prompt: s.enhanced_prompt || "",
      }));
      res.json({ scenes: fixedScenes });
    } catch (error) {
      console.error("Claude enhance story prompts error:", error);
      res.status(500).json({ error: "Claude 提示詞優化失敗，請稍後再試" });
    }
  });

  // Video prompt enhancement - two steps
  app.post("/api/claude/enhance-video-prompt", requireAuth, async (req, res) => {
    try {
      const { prompt, step, mode } = req.body as {
        prompt: string;
        step: "ai" | "claude";
        mode: "text-to-video" | "image-to-video";
      };
      if (!prompt?.trim()) return res.status(400).json({ error: "請先填寫提示詞" });

      let systemPrompt: string;
      if (step === "ai") {
        // Step 1: AI enrichment - enhance in Chinese, more vivid and detailed
        systemPrompt = mode === "image-to-video"
          ? `你是一位專業的影片動態提示詞設計師。用戶提供了一段描述圖片動態效果的中文提示詞，請幫他補充細節，讓它更生動具體。

要求：
1. 補充鏡頭運動方式（如：緩慢推進、環繞、跟拍、拉遠）
2. 加入光影細節（如：陽光斑駁、柔和側光、黃昏暖光）
3. 加入動態細節（如：物體緩慢移動、水波蕩漾、葉片微動）
4. 保持中文，長度約 50-80 字
5. 只回覆優化後的提示詞，不要其他文字`
          : `你是一位專業的影片提示詞設計師。用戶提供了一段中文影片描述，請幫他補充細節，讓畫面更豐富生動。

要求：
1. 補充場景環境細節（光線、氣氛、天氣）
2. 加入鏡頭運動（如：緩慢推進、旋轉升起、跟拍）
3. 加入動態效果（人物動作、物品移動、自然元素）
4. 保持中文，長度約 60-100 字
5. 只回覆優化後的提示詞，不要其他文字`;
      } else {
        // Step 2: Claude professional English optimization for AI video generation
        systemPrompt = mode === "image-to-video"
          ? `You are a professional AI video prompt engineer specializing in image-to-video generation. Convert the following Chinese description into a professional English video generation prompt.

Requirements:
1. Describe the motion/animation of the image (camera movement, object movement)
2. Include specific camera movements (slow push in, gentle pan, orbit, zoom out, etc.)
3. Include lighting and atmosphere
4. Add quality keywords: cinematic, smooth motion, high quality
5. Keep it concise: 40-70 words
6. Only return the English prompt, nothing else`
          : `You are a professional AI video prompt engineer. Convert the following Chinese video description into a professional English prompt for AI video generation.

Requirements:
1. Describe the main subject, action, and environment clearly
2. Include specific camera movements (slow push in, aerial shot, tracking shot, etc.)
3. Include lighting and cinematic mood
4. Add quality descriptors: cinematic, 4K, smooth motion, highly detailed
5. Keep it 50-80 words
6. Only return the English prompt, nothing else`;
      }

      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 512,
        messages: [
          { role: "user", content: `${systemPrompt}\n\n原始提示詞：${prompt.trim()}` }
        ],
      });

      const enhanced = message.content[0].type === "text" ? message.content[0].text.trim() : "";
      res.json({ enhanced });
    } catch (error: any) {
      console.error("Claude enhance video prompt error:", error);
      res.status(500).json({ error: "提示詞優化失敗，請稍後再試" });
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
      if (!user || (user.credits ?? 0) < IMAGE_COST) {
        return res.status(400).json({ error: `積分不足，重新生成需要 ${IMAGE_COST} 積分` });
      }

      await storage.atomicAddCredits(userId, -IMAGE_COST, `故事「${story.title}」第 ${sceneIdx + 1} 幕重新生成`);

      // Allow overriding description, dialogue, and scene reference image before regeneration
      const newDescription = (typeof req.body.description === "string" && req.body.description.trim()) ? req.body.description.trim() : undefined;
      const newDialogue = typeof req.body.dialogue === "string" ? req.body.dialogue.trim() : undefined;
      const newSceneRefUrl = (typeof req.body.sceneReferenceImageUrl === "string" && req.body.sceneReferenceImageUrl.trim()) ? req.body.sceneReferenceImageUrl.trim() : undefined;
      if (newDescription) scenes[sceneIdx].description = newDescription;
      if (newDialogue !== undefined) scenes[sceneIdx].dialogue = newDialogue || undefined;
      if (newSceneRefUrl) scenes[sceneIdx].sceneReferenceImageUrl = newSceneRefUrl;

      const useCharA = req.body.useCharA !== false;
      const useCharB = req.body.useCharB !== false;
      const newSeed = req.body.newSeed === true;

      scenes[sceneIdx].status = "generating";
      scenes[sceneIdx].imageUrl = undefined;
      scenes[sceneIdx].bunnyUrl = undefined;
      await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes) });

      res.json({ ok: true });

      regenerateStoryScene(storyId, sceneIdx, objectStorageService, bunnyStorage, useCharA, useCharB, newSeed).catch(console.error);
    } catch (error: any) {
      console.error("Error triggering scene regeneration:", error);
      res.status(500).json({ error: error.message || "重新生成失敗" });
    }
  });

  // Replace scene image with a user-uploaded file (no credit cost)
  app.post("/api/story-generations/:storyId/replace-scene-image/:sceneIdx", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { storyId, sceneIdx: sceneIdxStr } = req.params;
      const sceneIdx = parseInt(sceneIdxStr, 10);
      const { objectPath } = req.body;
      if (!objectPath) return res.status(400).json({ error: "缺少 objectPath" });

      const story = await storage.getStoryGeneration(storyId);
      if (!story) return res.status(404).json({ error: "找不到故事" });
      if (story.userId !== userId) return res.status(403).json({ error: "無存取權限" });

      const scenes: StoryScene[] = JSON.parse(story.scenes || "[]");
      if (isNaN(sceneIdx) || sceneIdx < 0 || sceneIdx >= scenes.length) {
        return res.status(400).json({ error: "場景索引無效" });
      }

      // Load the uploaded image from object storage
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const chunks: Buffer[] = [];
      const stream = objectFile.createReadStream();
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const imgBuffer = Buffer.concat(chunks);

      const storyUser = await storage.getUser(story.userId);
      const userFolder = storyUser?.username || story.userId;

      let bunnyUrl: string | undefined;
      if (bunnyStorage.isConfigured()) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const remotePath = `users/${userFolder}/stories/${storyId}_${sceneIdx}.jpg`;
            bunnyUrl = await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
            break;
          } catch (e) {
            if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
          }
        }
      }

      // Append cache-busting param so browser/CDN fetches the new image instead of the old cached one
      const versionedBunnyUrl = bunnyUrl ? `${bunnyUrl}?v=${Date.now()}` : bunnyUrl;
      scenes[sceneIdx].imageUrl = objectPath;
      scenes[sceneIdx].bunnyUrl = versionedBunnyUrl;
      scenes[sceneIdx].status = "completed";
      await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes) });

      res.json({ ok: true, bunnyUrl: versionedBunnyUrl });
    } catch (error: any) {
      console.error("Error replacing scene image:", error);
      res.status(500).json({ error: error.message || "替換圖片失敗" });
    }
  });

  async function regenerateStoryScene(
    storyId: string,
    sceneIdx: number,
    objectStorageService: ObjectStorageService,
    bunnyStorage: BunnyStorageService,
    useCharA: boolean = true,
    useCharB: boolean = true,
    newSeed: boolean = false
  ) {
    try {
      const story = await storage.getStoryGeneration(storyId);
      if (!story) return;

      const storyUser = await storage.getUser(story.userId);
      const userFolder = storyUser?.username || story.userId;
      if (!atlasIsConfigured()) throw new Error("圖片生成 API Key 未設定 (ATLASCLOUD_API_KEY)");

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

      const characterABase64s = useCharA ? await loadImageList(story.characterImageUrls ?? []) : [];
      const characterBBase64s = useCharB ? await loadImageList(story.characterBImageUrls ?? []) : [];
      const sceneRefBase64sGlobal = await loadImageList(story.sceneRefImageUrls ?? []);
      const styleBase64s = await loadImageList(story.styleImageUrls ?? []);

      const scene = scenes[sceneIdx];
      const dialoguePart = scene.dialogue?.trim() ? `，台詞：「${scene.dialogue}」` : "";
      const scenePrompt = `${story.style}, ${scene.description}${dialoguePart}`;
      let globalBase64s = [...characterABase64s, ...characterBBase64s, ...sceneRefBase64sGlobal, ...styleBase64s];
      if (scene.sceneReferenceImageUrl) {
        try {
          const perSceneBase64 = await loadRefImageAsBase64(scene.sceneReferenceImageUrl);
          globalBase64s = [...characterABase64s, ...characterBBase64s, perSceneBase64, ...styleBase64s];
        } catch { /* use global refs */ }
      }

      const seedValue = newSeed
        ? Math.floor(Math.random() * 999000) + 1000
        : (story.globalSeed ?? undefined);

      let requestBody: any;
      const enhancedScenePrompt = plainImagePrompt(scenePrompt);
      if (globalBase64s.length > 0) {
        requestBody = {
          prompt: enhancedScenePrompt,
          image: globalBase64s.length === 1 ? globalBase64s[0] : globalBase64s,
          size: imageSize,
        };
      } else {
        requestBody = {
          prompt: enhancedScenePrompt,
          size: imageSize,
        };
      }

      const imageUrl = await atlasGenerateImage({ prompt: requestBody.prompt, images: requestBody.image, size: requestBody.size });

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
      let storyForRefund: Awaited<ReturnType<typeof storage.getStoryGeneration>> | undefined;
      try {
        storyForRefund = await storage.getStoryGeneration(storyId);
        if (storyForRefund) {
          const scenes: StoryScene[] = JSON.parse(storyForRefund.scenes);
          scenes[sceneIdx].status = "failed";
          await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes) });
        }
      } catch (statusErr) {
        console.error("Failed to mark story scene as failed:", statusErr);
      }
      // Refund credits on story scene regeneration failure
      try {
        const story2 = storyForRefund ?? await storage.getStoryGeneration(storyId);
        if (story2) {
          const creditCost = IMAGE_COST;
          await storage.atomicAddCredits(
            story2.userId,
            creditCost,
            `故事「${story2.title}」第 ${sceneIdx + 1} 幕重生失敗退款`,
          );
          console.log(`✅ Refunded ${creditCost} credits for failed story scene ${sceneIdx + 1} regen`);
        }
      } catch (refundErr) {
        console.error("Failed to refund story scene regen credits:", refundErr);
      }
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

      if (!title || !sceneCount || sceneCount < 2 || sceneCount > 12) {
        return res.status(400).json({ error: "請提供標題與幕數（2-12 幕）" });
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

      const parsed = JSON.parse(jsonMatch[0]);
      const rawScenes: Array<{ title: string; description: string }> = parsed.scenes || [];
      const scenes = rawScenes.slice(0, total).map((s, i) => ({
        index: i,
        title: s.title || `第 ${i + 1} 幕`,
        description: s.description || "",
      }));
      res.json({ scenes });
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
      if (!atlasIsConfigured()) throw new Error("圖片生成 API Key 未設定 (ATLASCLOUD_API_KEY)");

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

      const characterABase64s = await loadImageList(story.characterImageUrls ?? []);
      const characterBBase64s = await loadImageList(story.characterBImageUrls ?? []);
      const sceneRefBase64s = await loadImageList(story.sceneRefImageUrls ?? []);
      const styleBase64s = await loadImageList(story.styleImageUrls ?? []);

      for (let i = 0; i < scenes.length; i++) {
        scenes[i].status = "generating";
        await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes) });

        try {
          const dialoguePart = scenes[i].dialogue?.trim() ? `，台詞：「${scenes[i].dialogue}」` : "";
          const scenePrompt = `${story.style}, ${scenes[i].description}${dialoguePart}`;
          let requestBody: any;

          // Combine all global reference images in order: charA → charB → scene → style
          let globalBase64s = [...characterABase64s, ...characterBBase64s, ...sceneRefBase64s, ...styleBase64s];

          // Per-scene reference image overrides only the scene ref slot
          if (scenes[i].sceneReferenceImageUrl) {
            try {
              const perSceneBase64 = await loadRefImageAsBase64(scenes[i].sceneReferenceImageUrl!);
              globalBase64s = [...characterABase64s, ...characterBBase64s, perSceneBase64, ...styleBase64s];
            } catch (e) {
              console.error(`Failed to load scene ${i} reference image:`, e);
            }
          }

          if (globalBase64s.length > 0) {
            // Build an explicit prompt labeling what each reference image is for
            const labelParts: string[] = [];
            let imgIdx = 1;
            if (characterABase64s.length > 0) {
              const end = imgIdx + characterABase64s.length - 1;
              labelParts.push(`第 ${imgIdx}${characterABase64s.length > 1 ? `-${end}` : ""} 張圖為角色 A 外貌，保持角色一致`);
              imgIdx += characterABase64s.length;
            }
            if (characterBBase64s.length > 0) {
              const end = imgIdx + characterBBase64s.length - 1;
              labelParts.push(`第 ${imgIdx}${characterBBase64s.length > 1 ? `-${end}` : ""} 張圖為角色 B 外貌，保持角色一致`);
              imgIdx += characterBBase64s.length;
            }
            const sceneCount = scenes[i].sceneReferenceImageUrl ? 1 : sceneRefBase64s.length;
            if (sceneCount > 0) {
              const end = imgIdx + sceneCount - 1;
              labelParts.push(`第 ${imgIdx}${sceneCount > 1 ? `-${end}` : ""} 張圖為場景構圖參考`);
              imgIdx += sceneCount;
            }
            if (styleBase64s.length > 0) {
              const end = imgIdx + styleBase64s.length - 1;
              labelParts.push(`第 ${imgIdx}${styleBase64s.length > 1 ? `-${end}` : ""} 張圖為畫風風格參考`);
            }
            const labelNote = labelParts.length > 0 ? `（${labelParts.join("；")}）` : "";
            const fullPrompt = `${scenePrompt}${labelNote}`;
            requestBody = {
              prompt: plainImagePrompt(fullPrompt),
              image: globalBase64s.length === 1 ? globalBase64s[0] : globalBase64s,
              size: imageSize,
            };
          } else {
            requestBody = {
              prompt: plainImagePrompt(scenePrompt),
              size: imageSize,
            };
          }

          const imageUrl = await atlasGenerateImage({ prompt: requestBody.prompt, images: requestBody.image, size: requestBody.size });

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

  // ═══════════════════════════════════════════════════════════════════════════
  // DRAMA STUDIO — 漫劇工作室
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Projects CRUD ────────────────────────────────────────────────────────

  app.get("/api/drama/projects", requireAuth, async (req, res) => {
    try {
      const projects = await storage.getUserDramaProjects(req.session.userId!);
      res.json(projects);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/drama/projects", requireAuth, async (req, res) => {
    try {
      const { insertDramaProjectSchema } = await import("@shared/schema");
      const data = insertDramaProjectSchema.parse(req.body);
      const project = await storage.createDramaProject({ ...data, userId: req.session.userId! });
      res.json(project);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/drama/projects/:projectId", requireAuth, async (req, res) => {
    try {
      const project = await storage.getDramaProject(req.params.projectId);
      if (!project || project.userId !== req.session.userId!) return res.status(404).json({ error: "找不到漫劇" });
      res.json(project);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/drama/projects/:projectId", requireAuth, async (req, res) => {
    try {
      const project = await storage.getDramaProject(req.params.projectId);
      if (!project || project.userId !== req.session.userId!) return res.status(404).json({ error: "找不到漫劇" });
      const { updateDramaProjectSchema } = await import("@shared/schema");
      const data = updateDramaProjectSchema.parse(req.body);
      const updated = await storage.updateDramaProject(req.params.projectId, data);
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/drama/projects/:projectId", requireAuth, async (req, res) => {
    try {
      const project = await storage.getDramaProject(req.params.projectId);
      if (!project || project.userId !== req.session.userId!) return res.status(404).json({ error: "找不到漫劇" });
      await storage.deleteDramaProject(req.params.projectId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Episodes CRUD ────────────────────────────────────────────────────────

  app.get("/api/drama/projects/:projectId/episodes", requireAuth, async (req, res) => {
    try {
      const project = await storage.getDramaProject(req.params.projectId);
      if (!project || project.userId !== req.session.userId!) return res.status(404).json({ error: "找不到漫劇" });
      const episodes = await storage.getDramaEpisodesByProject(req.params.projectId);
      res.json(episodes);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/drama/projects/:projectId/episodes", requireAuth, async (req, res) => {
    try {
      const project = await storage.getDramaProject(req.params.projectId);
      if (!project || project.userId !== req.session.userId!) return res.status(404).json({ error: "找不到漫劇" });

      const body = req.body as {
        episodeNumber?: number;
        title: string;
        scenes: any[];
        globalSeed?: number;
      };

      const existingEpisodes = await storage.getDramaEpisodesByProject(req.params.projectId);
      const episodeNumber = body.episodeNumber ?? existingEpisodes.length + 1;

      const episode = await storage.createDramaEpisode({
        projectId: req.params.projectId,
        userId: req.session.userId!,
        episodeNumber,
        title: body.title || `第 ${episodeNumber} 集`,
        scenes: JSON.stringify(body.scenes || []),
        sceneCount: (body.scenes || []).length,
        globalSeed: body.globalSeed,
      });
      res.json(episode);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/drama/episodes/:episodeId", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) return res.status(404).json({ error: "找不到集數" });
      res.json(episode);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/drama/episodes/:episodeId", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) return res.status(404).json({ error: "找不到集數" });
      const updated = await storage.updateDramaEpisode(req.params.episodeId, {
        ...req.body,
        scenes: req.body.scenes ? JSON.stringify(req.body.scenes) : episode.scenes,
      });
      res.json(updated);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/drama/episodes/:episodeId", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) return res.status(404).json({ error: "找不到集數" });
      await storage.deleteDramaEpisode(req.params.episodeId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── AI Script Generator (Claude) ─────────────────────────────────────────
  app.post("/api/drama/ai-generate-script", requireAuth, async (req, res) => {
    try {
      const { pitch, sceneCount, genre, characterAName, characterBName } = req.body as {
        pitch: string;
        sceneCount: number;
        genre?: string;
        characterAName?: string;
        characterBName?: string;
      };

      if (!pitch || !pitch.trim()) {
        return res.status(400).json({ error: "請提供劇情概念" });
      }
      const count = Math.max(2, Math.min(12, Number(sceneCount) || 6));

      const charA = characterAName?.trim() || "角色A";
      const charB = characterBName?.trim() || "角色B";
      const genreText = genre?.trim() || "短劇";

      const prompt = `你是 WAN 3.0 與 Seedream 5.5 的資深短劇分鏡編劇，熟悉抖音/TikTok 直式短劇（漫劇）的爆款敘事節奏與 BytePlus ARK 圖生影片的提示詞最佳實踐。

請依下列概念，產出一集完整 ${count} 幕的短劇分鏡腳本：

【劇情概念】${pitch.trim()}
【類型】${genreText}
【角色 A 名稱】${charA}
【角色 B 名稱】${charB}
【總幕數】${count}

撰寫規則：
1. 嚴格遵守「起承轉合」節奏：第 1 幕建立鉤子（hook，前 3 秒抓住觀眾）；中段加深衝突；最後 1-2 幕高潮反轉並收尾
2. 每幕的 description 用繁體中文，60-120 字，須包含：
   - 場景地點（具體：高級辦公室、雨夜街角、咖啡廳窗邊…）
   - 角色動作與表情（不寫角色名，寫「他/她」或具體稱謂）
   - 光線與氛圍（黃金時刻、霓虹冷光、燭光、逆光剪影…）
   - 構圖（特寫、過肩、低角度、俯視…）
3. dialogue 寫一句最具戲劇張力的台詞（10-30 字），可以為空字串
4. cameraMovement 從以下選一個：none / push_in / pull_out / pan_left / pan_right / tilt_up / tilt_down / orbit / zoom_in / zoom_out / static
5. title 用 4-8 字精煉幕名（如：電梯初遇、雨中告白、真相揭穿）
6. 同一集中的場景需有畫面變化（不同地點、不同光線、不同情緒）
7. useCharA 與 useCharB：依劇情判斷該幕是否需要該角色出現（boolean）

請只回傳 JSON，不要任何其他說明文字：
{
  "scenes": [
    {
      "title": "幕名稱",
      "description": "場景描述...",
      "dialogue": "一句台詞或空字串",
      "cameraMovement": "push_in",
      "useCharA": true,
      "useCharB": true
    }
  ]
}`;

      const message = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      });

      // Combine all text blocks (model may return multiple text segments)
      const allText = message.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("\n");

      // Try multiple extraction strategies
      const tryParse = (s: string): any | null => { try { return JSON.parse(s); } catch { return null; } };
      const fencedMatch = allText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const candidates: string[] = [];
      if (fencedMatch?.[1]) candidates.push(fencedMatch[1].trim());
      // Greedy match for largest JSON object containing "scenes"
      const greedyMatch = allText.match(/\{[\s\S]*"scenes"[\s\S]*\}/);
      if (greedyMatch) candidates.push(greedyMatch[0]);
      const firstMatch = allText.match(/\{[\s\S]*\}/);
      if (firstMatch) candidates.push(firstMatch[0]);

      let parsed: any = null;
      for (const c of candidates) {
        parsed = tryParse(c);
        if (parsed && Array.isArray(parsed.scenes)) break;
      }
      if (!parsed || !Array.isArray(parsed.scenes)) {
        console.error("AI script JSON parse failed. Raw response:", allText.slice(0, 500));
        return res.status(500).json({ error: "AI 回應格式錯誤，請再試一次" });
      }

      // Whitelist validation
      const validCameras = new Set([
        "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down",
        "orbit", "zoom_in", "zoom_out", "static",
        // Tolerate frontend-style camera values too
        "slow push in, gentle light", "slow zoom out, fade out",
        "pan left, smooth", "pan right, smooth", "tilt up, reveal", "tilt down, settle",
        "orbit around subject", "static, fixed camera", "handheld, slight shake", "drone aerial shot",
      ]);

      const scenes = (parsed.scenes as any[]).slice(0, count).map((s: any, i: number) => {
        const title = String(s?.title ?? "").trim().slice(0, 30) || `第 ${i + 1} 幕`;
        const description = String(s?.description ?? "").trim().slice(0, 500);
        const dialogue = String(s?.dialogue ?? "").trim().slice(0, 100);
        const cmRaw = String(s?.cameraMovement ?? "").trim();
        const cameraMovement = cmRaw === "none" || !validCameras.has(cmRaw) ? "" : cmRaw;
        return {
          title, description, dialogue, cameraMovement,
          useCharA: s?.useCharA !== false,
          useCharB: s?.useCharB !== false,
        };
      });

      if (scenes.length === 0) {
        return res.status(500).json({ error: "AI 沒有產出有效幕，請更具體描述劇情" });
      }

      res.json({ scenes });
    } catch (e: any) {
      console.error("AI script generation error:", e);
      res.status(500).json({ error: e.message || "AI 生成失敗" });
    }
  });

  // ─── Episode Image Generation ─────────────────────────────────────────────

  app.post("/api/drama/episodes/:episodeId/generate-images", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) return res.status(404).json({ error: "找不到集數" });

      const project = await storage.getDramaProject(episode.projectId);
      if (!project) return res.status(404).json({ error: "找不到漫劇專案" });

      const scenes: any[] = JSON.parse(episode.scenes);
      const pendingScenes = scenes.filter(s => s.imageStatus !== "completed");
      const creditCost = pendingScenes.length * IMAGE_COST;

      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.credits ?? 0) < creditCost) {
        return res.status(400).json({ error: `積分不足，需要 ${creditCost} 積分` });
      }

      // Deduct credits
      const newBalance = (user.credits ?? 0) - creditCost;
      await storage.updateUserCredits(req.session.userId!, newBalance);
      await storage.createCreditTransaction({
        userId: req.session.userId!,
        type: "consume",
        amount: -creditCost,
        balance: newBalance,
        description: `漫劇「${project.title}」第 ${episode.episodeNumber} 集生成 ${pendingScenes.length} 幕圖片`,
      });

      await storage.updateDramaEpisode(req.params.episodeId, {
        status: "generating",
        creditsUsed: (episode.creditsUsed ?? 0) + creditCost,
      });

      // Run generation in background
      processDramaEpisode(req.params.episodeId, episode.projectId, objectStorageService, bunnyStorage).catch(console.error);
      res.json({ ok: true, creditCost, episodeId: req.params.episodeId });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Single Scene Regenerate ───────────────────────────────────────────────

  app.post("/api/drama/episodes/:episodeId/regenerate-scene/:sceneIdx", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) return res.status(404).json({ error: "找不到集數" });

      const sceneIdx = parseInt(req.params.sceneIdx);
      const scenes: any[] = JSON.parse(episode.scenes);
      if (sceneIdx < 0 || sceneIdx >= scenes.length) return res.status(400).json({ error: "幕索引超出範圍" });

      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.credits ?? 0) < IMAGE_COST) return res.status(400).json({ error: `積分不足，需要 ${IMAGE_COST} 積分` });

      const project = await storage.getDramaProject(episode.projectId);
      const newBalance = (user.credits ?? 0) - IMAGE_COST;
      await storage.updateUserCredits(req.session.userId!, newBalance);
      await storage.createCreditTransaction({
        userId: req.session.userId!,
        type: "consume",
        amount: -IMAGE_COST,
        balance: newBalance,
        description: `漫劇重生第 ${sceneIdx + 1} 幕`,
      });

      // Merge request overrides into scene
      const overrides = req.body || {};
      if (overrides.description) scenes[sceneIdx].description = overrides.description;
      if (overrides.dialogue !== undefined) scenes[sceneIdx].dialogue = overrides.dialogue;
      if (overrides.cameraMovement !== undefined) scenes[sceneIdx].cameraMovement = overrides.cameraMovement;
      if (overrides.useCharA !== undefined) scenes[sceneIdx].useCharA = overrides.useCharA;
      if (overrides.useCharB !== undefined) scenes[sceneIdx].useCharB = overrides.useCharB;
      if (overrides.sceneRefImageUrl !== undefined) scenes[sceneIdx].sceneRefImageUrl = overrides.sceneRefImageUrl;
      if (overrides.newSeed) scenes[sceneIdx]._tempSeed = Math.floor(Math.random() * 998000) + 1000;

      scenes[sceneIdx].imageStatus = "generating";
      await storage.updateDramaEpisode(req.params.episodeId, { scenes: JSON.stringify(scenes) });

      regenerateDramaScene(req.params.episodeId, episode.projectId, sceneIdx, objectStorageService, bunnyStorage).catch(console.error);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Batch: Re-apply Chain Mode to whole episode ───────────────────────────
  // Sequentially regenerates scenes 2..N so each one uses the previous (now
  // freshly regenerated) scene's last frame as its continuity reference.
  // Scene 1 stays as the anchor.
  app.post("/api/drama/episodes/:episodeId/regenerate-all-chain", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) return res.status(404).json({ error: "找不到集數" });
      if (!episode.chainMode) return res.status(400).json({ error: "請先開啟連續模式" });

      const scenes: any[] = JSON.parse(episode.scenes);
      if (scenes.length < 2) return res.status(400).json({ error: "至少需要 2 幕才能套用連續模式" });

      // Scene 1 must already have a usable image — it is the anchor reference.
      const first = scenes[0];
      if (first.imageStatus !== "completed" || (!first.bunnyUrl && !first.imageUrl)) {
        return res.status(400).json({ error: "請先完成第 1 幕的圖片生成（作為連續模式的起點）" });
      }

      // Reject the whole batch if *any* scene 2..N is already generating —
      // partial 2..N runs would break deterministic chain continuity (a later
      // scene could be regen'd before its predecessor finishes).
      for (let i = 1; i < scenes.length; i++) {
        if (scenes[i].imageStatus === "generating") {
          return res.status(409).json({ error: `第 ${i + 1} 幕正在生成中，請等候完成後再啟動整集連續重生` });
        }
      }
      // Targets are deterministic: every scene 2..N.
      const targets: number[] = [];
      for (let i = 1; i < scenes.length; i++) targets.push(i);

      const perSceneCost = IMAGE_COST;
      const totalCost = perSceneCost * targets.length;

      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.credits ?? 0) < totalCost) {
        return res.status(400).json({ error: `積分不足，需要 ${totalCost} 積分` });
      }

      // Snapshot each target's pre-batch status so we can restore it on cancel
      // (without this, cancelled scenes stay stuck on `generating` forever).
      const preStatusByIdx: Record<number, string> = {};
      for (const i of targets) preStatusByIdx[i] = scenes[i].imageStatus ?? "pending";

      // Mark all targets as generating + deduct credits up-front
      let balance = user.credits ?? 0;
      for (const i of targets) {
        scenes[i].imageStatus = "generating";
        delete scenes[i].imageError;
        balance -= perSceneCost;
        await storage.updateUserCredits(req.session.userId!, balance);
        await storage.createCreditTransaction({
          userId: req.session.userId!,
          type: "consume",
          amount: -perSceneCost,
          balance,
          description: `漫劇連續模式整集重生第 ${i + 1} 幕`,
        });
      }
      // Reset any stale cancel flag from a previous batch before kicking off.
      await storage.updateDramaEpisode(req.params.episodeId, {
        scenes: JSON.stringify(scenes),
        chainRegenCancelRequested: false,
      });

      const userId = req.session.userId!;
      const episodeId = req.params.episodeId;

      // Strictly sequential — each scene N+1 reads scene N's freshly written
      // last-frame / main image from storage as continuity reference.
      // Between scenes we re-fetch the episode to honor a user-issued cancel
      // request: the in-flight scene finishes, but remaining un-started scenes
      // are skipped and their pre-deducted credits refunded.
      (async () => {
        const skipped: number[] = [];
        let cancelled = false;
        for (let t = 0; t < targets.length; t++) {
          const i = targets[t];
          if (!cancelled) {
            const fresh = await storage.getDramaEpisode(episodeId);
            if (fresh?.chainRegenCancelRequested) {
              cancelled = true;
            }
          }
          if (cancelled) {
            skipped.push(i);
            continue;
          }
          try {
            await regenerateDramaScene(
              episodeId, episode.projectId, i,
              objectStorageService, bunnyStorage
            );
          } catch (err) {
            console.error(`[Drama chain regen-all] scene ${i} failed:`, err);
          }
        }

        if (skipped.length > 0) {
          // Refund credits for every scene we never started, restore their
          // pre-batch imageStatus, and clear the cancel flag.
          try {
            const u = await storage.getUser(userId);
            let bal = u?.credits ?? 0;
            for (const i of skipped) {
              bal += perSceneCost;
              await storage.updateUserCredits(userId, bal);
              await storage.createCreditTransaction({
                userId,
                type: "refund",
                amount: perSceneCost,
                balance: bal,
                description: `漫劇連續模式整集重生中止退款（第 ${i + 1} 幕）`,
              });
            }
            const ep2 = await storage.getDramaEpisode(episodeId);
            if (ep2) {
              const sc: any[] = JSON.parse(ep2.scenes);
              for (const i of skipped) {
                if (sc[i]) {
                  sc[i].imageStatus = preStatusByIdx[i] ?? "pending";
                  delete sc[i].imageError;
                }
              }
              await storage.updateDramaEpisode(episodeId, {
                scenes: JSON.stringify(sc),
                chainRegenCancelRequested: false,
              });
            }
            console.log(`[Drama chain regen-all] episode ${episodeId} cancelled — refunded ${skipped.length} scenes (${skipped.length * perSceneCost} credits)`);
          } catch (refundErr) {
            console.error(`[Drama chain regen-all] refund failed:`, refundErr);
          }
        } else {
          // Make sure the cancel flag is cleared after a clean run too.
          await storage.updateDramaEpisode(episodeId, { chainRegenCancelRequested: false }).catch(() => {});
          console.log(`[Drama chain regen-all] episode ${episodeId} done (${targets.length} scenes)`);
        }
      })().catch(console.error);

      res.json({ ok: true, sceneCount: targets.length, creditCost: totalCost });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Cancel an in-flight chain regen-all batch ────────────────────────────
  // Sets chainRegenCancelRequested=true so the background loop skips remaining
  // un-started scenes after the current one finishes; refund happens there.
  app.post("/api/drama/episodes/:episodeId/cancel-chain-regen", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) return res.status(404).json({ error: "找不到集數" });

      const scenes: any[] = JSON.parse(episode.scenes);
      // No-op if nothing past scene 1 is currently generating — there is no
      // batch to stop, and we don't want to leave the flag stuck on for the
      // next batch.
      const inFlight = scenes.slice(1).some(s => s.imageStatus === "generating");
      if (!inFlight) {
        return res.json({ ok: true, alreadyDone: true });
      }

      await storage.updateDramaEpisode(req.params.episodeId, { chainRegenCancelRequested: true });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Replace Scene Image (free) ────────────────────────────────────────────

  app.post("/api/drama/episodes/:episodeId/replace-scene-image/:sceneIdx", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) return res.status(404).json({ error: "找不到集數" });

      const sceneIdx = parseInt(req.params.sceneIdx);
      const scenes: any[] = JSON.parse(episode.scenes);
      if (sceneIdx < 0 || sceneIdx >= scenes.length) return res.status(400).json({ error: "幕索引超出範圍" });

      const { objectPath } = req.body;
      if (!objectPath) return res.status(400).json({ error: "缺少 objectPath" });

      let bunnyUrl: string | null = null;
      // 從作品選：只接受我們自己 CDN 上的 https 網址，直接沿用，不再下載。
      const fromWorks = typeof objectPath === "string" && /^https:\/\//i.test(objectPath);
      if (fromWorks) {
        try { bunnyUrl = ssrfAssertAllowedRemoteUrl(objectPath).toString(); }
        catch { return res.status(400).json({ error: "只能使用作品庫裡的圖片。" }); }
      } else if (bunnyStorage.isConfigured()) {
        const user = await storage.getUser(req.session.userId!);
        const userFolder = user?.username || req.session.userId!;
        const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
        const chunks: Buffer[] = [];
        for await (const chunk of objectFile.createReadStream()) chunks.push(Buffer.from(chunk));
        const imgBuffer = Buffer.concat(chunks);
        const remotePath = `users/${userFolder}/drama/${episode.projectId}_ep${episode.episodeNumber}_scene${sceneIdx}.jpg`;
        bunnyUrl = await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
      }

      const versionedUrl = fromWorks ? bunnyUrl : bunnyUrl ? `${bunnyUrl}?v=${Date.now()}` : null;
      scenes[sceneIdx].imageUrl = objectPath;
      scenes[sceneIdx].bunnyUrl = versionedUrl;
      scenes[sceneIdx].imageStatus = "completed";
      await storage.updateDramaEpisode(req.params.episodeId, { scenes: JSON.stringify(scenes) });

      res.json({ ok: true, bunnyUrl: versionedUrl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Batch animate ALL scenes in an episode ───────────────────────────────
  app.post("/api/drama/episodes/:episodeId/animate-all", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) {
        return res.status(404).json({ error: "找不到集數" });
      }
      const { duration = 5, resolution = "720p", useOmniMode = false, generateAudio = true, onlyMissing = true } = req.body;

      const scenes: any[] = JSON.parse(episode.scenes);
      // Pick scenes that need animating
      const targets: number[] = [];
      for (let i = 0; i < scenes.length; i++) {
        const s = scenes[i];
        if (s.imageStatus !== "completed" || !s.bunnyUrl) continue; // need image first
        if (onlyMissing && s.videoStatus === "completed" && s.videoBunnyUrl) continue;
        if (s.videoStatus === "generating") continue; // already in flight
        targets.push(i);
      }
      if (targets.length === 0) {
        return res.status(400).json({ error: "沒有需要生成影片的場景（請先完成圖片生成）" });
      }

      const perSceneCost = resolution === "1080p" ? Math.ceil(duration * 15) : Math.ceil(duration * 8);
      const totalCost = perSceneCost * targets.length;

      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.credits ?? 0) < totalCost) {
        return res.status(400).json({ error: `積分不足，需要 ${totalCost} 積分` });
      }

      // Snapshot each target's pre-batch videoStatus so we can restore it on
      // cancel (without this, cancelled scenes stay stuck on `generating`).
      const preStatusByIdx: Record<number, string> = {};
      for (const i of targets) preStatusByIdx[i] = scenes[i].videoStatus ?? "pending";

      // Mark all targets as generating + deduct credits up-front (refund per-scene on failure)
      let balance = user.credits ?? 0;
      for (const i of targets) {
        scenes[i].videoStatus = "generating";
        scenes[i].videoDuration = duration;
        scenes[i].videoResolution = resolution;
        delete scenes[i].videoError;
        balance -= perSceneCost;
        await storage.updateUserCredits(req.session.userId!, balance);
        await storage.createCreditTransaction({
          userId: req.session.userId!,
          type: "consume",
          amount: -perSceneCost,
          balance,
          description: `漫劇動畫第 ${i + 1} 幕（${duration}秒 ${resolution}，批次）`,
        });
      }
      // Reset any stale cancel flag from a previous batch before kicking off,
      // and mark the batch as in-progress (authoritative signal for the cancel
      // endpoint + UI; distinguishes a real batch from concurrent per-scene
      // animations).
      await storage.updateDramaEpisode(req.params.episodeId, {
        scenes: JSON.stringify(scenes),
        animateAllInProgress: true,
        animateAllCancelRequested: false,
      });

      const userId = req.session.userId!;
      const episodeId = req.params.episodeId;

      // Sequential background processing (avoid overwhelming the API).
      // Between scenes we re-fetch the episode to honor a user-issued cancel
      // request: the in-flight scene finishes, but remaining un-started scenes
      // are skipped and their pre-deducted credits refunded.
      // Wrapped in try/finally so animateAllInProgress is always cleared,
      // even on unexpected errors — otherwise a stale flag would keep the
      // cancel UI showing forever and block the next batch.
      (async () => {
        const skipped: number[] = [];
        try {
          let cancelled = false;
          for (let t = 0; t < targets.length; t++) {
            const i = targets[t];
            if (!cancelled) {
              const fresh = await storage.getDramaEpisode(episodeId);
              if (fresh?.animateAllCancelRequested) {
                cancelled = true;
              }
            }
            if (cancelled) {
              skipped.push(i);
              continue;
            }
            try {
              await animateDramaScene(
                episodeId, episode.projectId, i,
                { duration, resolution, useOmniMode, generateAudio },
                objectStorageService, bunnyStorage
              );
            } catch (err) {
              console.error(`[Drama batch animate] scene ${i} failed:`, err);
            }
          }

          if (skipped.length > 0) {
            // Refund credits for every scene we never started + restore their
            // pre-batch videoStatus.
            try {
              const u = await storage.getUser(userId);
              let bal = u?.credits ?? 0;
              for (const i of skipped) {
                bal += perSceneCost;
                await storage.updateUserCredits(userId, bal);
                await storage.createCreditTransaction({
                  userId,
                  type: "refund",
                  amount: perSceneCost,
                  balance: bal,
                  description: `漫劇整集動畫批次中止退款（第 ${i + 1} 幕）`,
                });
              }
              const ep2 = await storage.getDramaEpisode(episodeId);
              if (ep2) {
                const sc: any[] = JSON.parse(ep2.scenes);
                for (const i of skipped) {
                  if (sc[i]) {
                    sc[i].videoStatus = preStatusByIdx[i] === "generating" ? "pending" : (preStatusByIdx[i] ?? "pending");
                    delete sc[i].videoError;
                  }
                }
                await storage.updateDramaEpisode(episodeId, { scenes: JSON.stringify(sc) });
              }
              console.log(`[Drama batch animate] episode ${episodeId} cancelled — refunded ${skipped.length} scenes (${skipped.length * perSceneCost} credits)`);
            } catch (refundErr) {
              console.error(`[Drama batch animate] refund failed:`, refundErr);
            }
          } else {
            console.log(`[Drama batch animate] episode ${episodeId} done (${targets.length} scenes)`);
          }
        } finally {
          // Always clear both flags so the next batch starts fresh and the
          // cancel UI doesn't get stuck on after a crash.
          await storage.updateDramaEpisode(episodeId, {
            animateAllInProgress: false,
            animateAllCancelRequested: false,
          }).catch(() => {});
        }
      })().catch(console.error);

      res.json({ ok: true, sceneCount: targets.length, creditCost: totalCost });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Cancel an in-flight animate-all batch ────────────────────────────────
  // Sets animateAllCancelRequested=true so the background loop skips remaining
  // un-started scenes after the current one finishes; refund happens there.
  // Only operates when an actual /animate-all batch is running — never when
  // the user just happens to have multiple per-scene animations in flight,
  // since those are not driven by the cancellable loop and have no refund
  // path. Authority is the persisted `animateAllInProgress` flag.
  app.post("/api/drama/episodes/:episodeId/cancel-animate-all", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) return res.status(404).json({ error: "找不到集數" });

      if (!episode.animateAllInProgress) {
        // Nothing to cancel: no /animate-all loop is currently running. Treat
        // as success so a stale UI click is harmless.
        return res.json({ ok: true, alreadyDone: true });
      }

      await storage.updateDramaEpisode(req.params.episodeId, { animateAllCancelRequested: true });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Compile episode: stitch all scene videos + burn dialogue subtitles ──
  app.post("/api/drama/episodes/:episodeId/compile", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) {
        return res.status(404).json({ error: "找不到集數" });
      }
      if (episode.compiledStatus === "compiling") {
        return res.status(400).json({ error: "正在剪接中，請稍候" });
      }

      const scenes: any[] = JSON.parse(episode.scenes);
      if (scenes.length === 0) return res.status(400).json({ error: "沒有可剪接的場景" });

      const missing = scenes.filter(s => !s.videoBunnyUrl && !s.videoUrl).map((_, i) => i + 1);
      const notReadyIdxs: number[] = [];
      scenes.forEach((s, i) => { if (!s.videoBunnyUrl && !s.videoUrl) notReadyIdxs.push(i + 1); });
      if (notReadyIdxs.length > 0) {
        return res.status(400).json({ error: `第 ${notReadyIdxs.join("、")} 幕還沒生成影片，請先完成` });
      }

      // Crossfade duration (ms) between adjacent scenes; default 400ms,
      // clamped to [0, 2000]. Frontend slider sends 0/200/400/800.
      const rawCf = Number(req.body?.crossfadeMs);
      const crossfadeMs = Number.isFinite(rawCf)
        ? Math.max(0, Math.min(2000, Math.round(rawCf)))
        : 400;

      await storage.updateDramaEpisode(req.params.episodeId, {
        compiledStatus: "compiling",
        compiledError: null,
      });

      // Background processing
      (async () => {
        try {
          const { compileEpisode } = await import("./dramaCompiler");
          const user = await storage.getUser(episode.userId);
          const userFolder = user?.username || episode.userId;

          const compileScenes = scenes.map((s, i) => ({
            sceneNumber: i + 1,
            videoUrl: (s.videoBunnyUrl || s.videoUrl).split("?")[0],
            duration: s.videoDuration || 5,
            dialogue: s.dialogue || "",
          }));

          const result = await compileEpisode({
            episodeId: req.params.episodeId,
            userFolder,
            scenes: compileScenes,
            bunny: bunnyStorage,
            crossfadeMs,
            outputName: `drama_${episode.projectId}_ep${episode.episodeNumber}_${Date.now()}`,
          });

          await storage.updateDramaEpisode(req.params.episodeId, {
            compiledVideoUrl: result.videoUrl,
            compiledStatus: "completed",
            compiledError: null,
            compiledAt: new Date(),
          });
          console.log(`✅ Drama episode ${req.params.episodeId} compiled (${result.totalDuration}s)`);
        } catch (err: any) {
          console.error(`❌ Drama compile failed:`, err);
          await storage.updateDramaEpisode(req.params.episodeId, {
            compiledStatus: "failed",
            compiledError: err.message || "剪接失敗",
          });
        }
      })().catch(console.error);

      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Animate Scene with WAN 3.0 ─────────────────────────────────────

  app.post("/api/drama/episodes/:episodeId/animate-scene/:sceneIdx", requireAuth, async (req, res) => {
    try {
      const episode = await storage.getDramaEpisode(req.params.episodeId);
      if (!episode || episode.userId !== req.session.userId!) return res.status(404).json({ error: "找不到集數" });

      const sceneIdx = parseInt(req.params.sceneIdx);
      const scenes: any[] = JSON.parse(episode.scenes);
      if (sceneIdx < 0 || sceneIdx >= scenes.length) return res.status(400).json({ error: "幕索引超出範圍" });

      const scene = scenes[sceneIdx];
      if (scene.imageStatus !== "completed" || !scene.bunnyUrl) {
        return res.status(400).json({ error: "請先完成圖片生成" });
      }

      const { duration = 5, resolution = "720p", prompt, useOmniMode = false, generateAudio = true, useFirstLastFrame = false } = req.body;
      const creditCost = resolution === "1080p"
        ? Math.ceil(duration * 15)
        : Math.ceil(duration * 8);

      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.credits ?? 0) < creditCost) {
        return res.status(400).json({ error: `積分不足，需要 ${creditCost} 積分` });
      }

      const project = await storage.getDramaProject(episode.projectId);
      const newBalance = (user.credits ?? 0) - creditCost;
      await storage.updateUserCredits(req.session.userId!, newBalance);
      await storage.createCreditTransaction({
        userId: req.session.userId!,
        type: "consume",
        amount: -creditCost,
        balance: newBalance,
        description: `漫劇動畫第 ${sceneIdx + 1} 幕（${duration}秒 ${resolution}）`,
      });

      scenes[sceneIdx].videoStatus = "generating";
      scenes[sceneIdx].videoDuration = duration;
      scenes[sceneIdx].videoResolution = resolution;
      await storage.updateDramaEpisode(req.params.episodeId, { scenes: JSON.stringify(scenes) });

      animateDramaScene(
        req.params.episodeId, episode.projectId, sceneIdx,
        { duration, resolution, prompt, useOmniMode, generateAudio, useFirstLastFrame },
        objectStorageService, bunnyStorage
      ).catch(console.error);

      res.json({ ok: true, creditCost });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Background processing functions ──────────────────────────────────────

  async function processDramaEpisode(
    episodeId: string,
    projectId: string,
    objectStorage: ObjectStorageService,
    bunny: BunnyStorageService
  ) {
    try {
      const episode = await storage.getDramaEpisode(episodeId);
      if (!episode) return;
      const project = await storage.getDramaProject(projectId);
      if (!project) return;

      const user = await storage.getUser(episode.userId);
      const userFolder = user?.username || episode.userId;
      if (!atlasIsConfigured()) throw new Error("ATLASCLOUD_API_KEY 未設定");

      const scenes: any[] = JSON.parse(episode.scenes);
      const sceneSizeMap: Record<string, string> = {
        "1:1": "2048x2048", "9:16": "1440x2560", "16:9": "2560x1440",
      };
      const imageSize = sceneSizeMap[project.sceneSize ?? "9:16"] || "1440x2560";

      const loadRefImageAsBase64 = async (imagePath: string): Promise<string> => {
        const objectFile = await objectStorage.getObjectEntityFile(imagePath);
        const chunks: Buffer[] = [];
        for await (const chunk of objectFile.createReadStream()) chunks.push(Buffer.from(chunk));
        return `data:image/jpeg;base64,${Buffer.concat(chunks).toString("base64")}`;
      };

      const loadImageList = async (urls: string[]): Promise<string[]> => {
        if (!urls || urls.length === 0) return [];
        try { return await Promise.all(urls.map(loadRefImageAsBase64)); } catch { return []; }
      };

      // Accepts either a stored object-storage path or an allowlisted CDN https URL.
      // Uses the shared SSRF guard (Bunny pull zone + ARK image hosts only,
      // private/internal hosts blocked).
      const loadAnyImageAsBase64 = async (
        url: string,
        _objStorage: ObjectStorageService
      ): Promise<string | null> => {
        try {
          if (!url) return null;
          if (url.startsWith("data:")) return url;
          if (url.startsWith("/objects/") || url.startsWith("/object-entities/")) {
            return await loadRefImageAsBase64(url);
          }
          let safeUrl: URL;
          try { safeUrl = ssrfAssertAllowedRemoteUrl(url); }
          catch { return null; }
          const resp = await fetch(safeUrl.toString(), { redirect: "error" });
          if (!resp.ok) return null;
          const buf = Buffer.from(await resp.arrayBuffer());
          return `data:image/jpeg;base64,${buf.toString("base64")}`;
        } catch {
          return null;
        }
      };

      const characterABase64s = await loadImageList(project.characterAUrls ?? []);
      const characterBBase64s = await loadImageList(project.characterBUrls ?? []);
      const styleBase64s = await loadImageList(project.styleImageUrls ?? []);

      // Cross-scene Chain Mode helpers — see Drama Studio "連續模式" feature.
      const episodeChainOn = !!episode.chainMode;
      const isSceneChainOn = (sc: DramaScene) => {
        const ov = sc?.chainModeOverride ?? "inherit";
        if (ov === "on") return true;
        if (ov === "off") return false;
        return episodeChainOn;
      };
      // NOTE: image generation has always been sequential here and remains so
      // — chain mode strictly REQUIRES sequential ordering (scene N+1 reads
      // scene N's last frame), and provider rate limits make parallel
      // batching risky. Conditional parallelism is intentionally out of scope
      // for the chain-mode feature.
      // Resolves the continuity reference image for `curr` based on its
      // user-configured override. Priority: curr.chainRefCustomUrl >
      // curr.chainRefSource (specific previous frame) > default fallback chain
      // (prev last frame → main image).
      const getSceneContinuityUrl = (prev: any, curr: any): string | null => {
        const fallback =
          prev?.lastFrameBunnyUrl
            || prev?.lastFrameUrl
            || prev?.bunnyUrl
            || prev?.imageUrl
            || null;
        if (curr?.chainRefCustomUrl) return curr.chainRefCustomUrl;
        const src = curr?.chainRefSource ?? "auto";
        switch (src) {
          case "prevLast":
            return prev?.lastFrameBunnyUrl || prev?.lastFrameUrl || fallback;
          case "prevFirst":
            return prev?.firstFrameBunnyUrl || prev?.firstFrameUrl || fallback;
          case "prevMain":
            return prev?.bunnyUrl || prev?.imageUrl || fallback;
          case "custom":
          case "auto":
          default:
            return fallback;
        }
      };

      // ─── Pre-load all global library refs referenced anywhere in this episode ──
      // For each character pick the front 4-view if available, otherwise its first
      // uploaded reference image. For each scene location pick the first ref image.
      const wantedCharIds = new Set<string>();
      const wantedSceneIds = new Set<string>();
      for (const sc of scenes) {
        for (const id of (sc.characterIds ?? [])) wantedCharIds.add(id);
        if (sc.sceneLocationId) wantedSceneIds.add(sc.sceneLocationId);
      }
      const charLibCache = new Map<string, string>(); // charId → base64
      const sceneLibCache = new Map<string, string>();
      for (const id of Array.from(wantedCharIds)) {
        try {
          const ch = await storage.getCharacter(id);
          if (!ch || ch.userId !== episode.userId) continue;
          const fv = (ch.fourViewUrls ?? {}) as Record<string, string | undefined>;
          const url = fv.front || fv.threeQuarter || ch.refImageUrls?.[0];
          if (!url) continue;
          const b64 = await loadAnyImageAsBase64(url, objectStorage);
          if (b64) charLibCache.set(id, b64);
        } catch (e: any) {
          console.warn(`[Drama] failed to load library char ${id}:`, e.message);
        }
      }
      for (const id of Array.from(wantedSceneIds)) {
        try {
          const sl = await storage.getSceneLibraryItem(id);
          if (!sl || sl.userId !== episode.userId) continue;
          const url = sl.refImageUrls?.[0];
          if (!url) continue;
          const b64 = await loadAnyImageAsBase64(url, objectStorage);
          if (b64) sceneLibCache.set(id, b64);
        } catch (e: any) {
          console.warn(`[Drama] failed to load library scene ${id}:`, e.message);
        }
      }

      let totalCost = 0;
      for (let i = 0; i < scenes.length; i++) {
        if (scenes[i].imageStatus === "completed") continue;
        scenes[i].imageStatus = "generating";
        await storage.updateDramaEpisode(episodeId, { scenes: JSON.stringify(scenes) });

        try {
          const dialoguePart = scenes[i].dialogue?.trim() ? `，台詞：「${scenes[i].dialogue}」` : "";
          const scenePrompt = `${scenes[i].description}${dialoguePart}`;

          const useA = scenes[i].useCharA !== false;
          const useB = scenes[i].useCharB !== false;
          const charAList = useA ? characterABase64s : [];
          const charBList = useB ? characterBBase64s : [];

          // Per-scene global library refs (override / supplement project-level chars)
          const libraryCharRefs: string[] = [];
          for (const id of (scenes[i].characterIds ?? [])) {
            const b64 = charLibCache.get(id);
            if (b64) libraryCharRefs.push(b64);
          }
          let libraryLocationRef: string | undefined;
          if (scenes[i].sceneLocationId) {
            libraryLocationRef = sceneLibCache.get(scenes[i].sceneLocationId);
          }

          let sceneRefList: string[] = [];
          if (scenes[i].sceneRefImageUrl) {
            try { sceneRefList = [await loadRefImageAsBase64(scenes[i].sceneRefImageUrl)]; } catch {}
          }
          if (libraryLocationRef) sceneRefList.unshift(libraryLocationRef);

          // Chain Mode: pull previous scene's last frame (or main image fallback)
          // and place it FIRST so Seedream treats it as the strongest visual anchor.
          // The user can override the source via chainRefSource / chainRefCustomUrl.
          let continuityRef: string | null = null;
          if (i > 0 && isSceneChainOn(scenes[i])) {
            const prevUrl = getSceneContinuityUrl(scenes[i - 1], scenes[i]);
            if (prevUrl) {
              continuityRef = await loadAnyImageAsBase64(prevUrl, objectStorage);
            }
          }

          const allRefs = [
            ...(continuityRef ? [continuityRef] : []),
            ...charAList,
            ...charBList,
            ...libraryCharRefs,
            ...sceneRefList,
            ...styleBase64s,
          ];

          let requestBody: any;
          if (allRefs.length > 0) {
            const labelParts: string[] = [];
            let idx = 1;
            if (continuityRef) {
              labelParts.push(`第 ${idx} 張圖為上一幕的結尾畫面，本幕需從這個畫面自然延續構圖、角色站位、視線與光線`);
              idx += 1;
            }
            if (charAList.length > 0) {
              const end = idx + charAList.length - 1;
              labelParts.push(`第 ${idx}${charAList.length > 1 ? `-${end}` : ""} 張圖為角色 A 外貌，保持角色一致`);
              idx += charAList.length;
            }
            if (charBList.length > 0) {
              const end = idx + charBList.length - 1;
              labelParts.push(`第 ${idx}${charBList.length > 1 ? `-${end}` : ""} 張圖為角色 B 外貌，保持角色一致`);
              idx += charBList.length;
            }
            if (sceneRefList.length > 0) {
              labelParts.push(`第 ${idx} 張圖為場景構圖參考`);
              idx += sceneRefList.length;
            }
            if (styleBase64s.length > 0) {
              const end = idx + styleBase64s.length - 1;
              labelParts.push(`第 ${idx}${styleBase64s.length > 1 ? `-${end}` : ""} 張圖為畫風風格參考`);
            }
            const labelNote = labelParts.length > 0 ? `（${labelParts.join("；")}）` : "";
            requestBody = {
              prompt: plainImagePrompt(`${scenePrompt}${labelNote}`),
              image: allRefs.length === 1 ? allRefs[0] : allRefs,
              size: imageSize,
            };
          } else {
            requestBody = {
              prompt: plainImagePrompt(scenePrompt),
              size: imageSize,
            };
          }

          const imageUrl = await atlasGenerateImage({ prompt: requestBody.prompt, images: requestBody.image, size: requestBody.size });

          totalCost += 0.05;
          scenes[i].imageUrl = imageUrl;

          if (bunny.isConfigured()) {
            for (let attempt = 1; attempt <= 2; attempt++) {
              try {
                const imgResp = await fetch(imageUrl);
                const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
                const remotePath = `users/${userFolder}/drama/${projectId}_ep${episode.episodeNumber}_scene${i}.jpg`;
                const cdnUrl = await bunny.uploadBuffer(imgBuffer, remotePath);
                scenes[i].bunnyUrl = cdnUrl;
                break;
              } catch (e) {
                if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
              }
            }
          }

          scenes[i].imageStatus = "completed";
          console.log(`✅ Drama episode ${episodeId} scene ${i + 1}/${scenes.length} completed`);
        } catch (sceneErr: any) {
          console.error(`❌ Drama scene ${i + 1} failed:`, sceneErr.message);
          scenes[i].imageStatus = "failed";
          scenes[i].imageError = sceneErr.message;
        }

        await storage.updateDramaEpisode(episodeId, { scenes: JSON.stringify(scenes) });
      }

      const allFailed = scenes.every(s => s.imageStatus === "failed");
      if (allFailed) {
        // Refund credits
        const ep = await storage.getDramaEpisode(episodeId);
        if (ep && ep.creditsUsed && ep.creditsUsed > 0) {
          await storage.atomicAddCredits(ep.userId, ep.creditsUsed, `漫劇生成失敗退還 ${ep.creditsUsed} 積分`);
        }
        await storage.updateDramaEpisode(episodeId, { status: "failed", errorMessage: "所有場景生成失敗" });
      } else {
        await storage.updateDramaEpisode(episodeId, { status: "completed", scenes: JSON.stringify(scenes) });
        console.log(`✅ Drama episode ${episodeId} generation completed`);
      }
    } catch (err: any) {
      console.error("❌ Drama episode generation failed:", err.message);
      await storage.updateDramaEpisode(episodeId, { status: "failed", errorMessage: err.message });
    }
  }

  async function regenerateDramaScene(
    episodeId: string,
    projectId: string,
    sceneIdx: number,
    objectStorage: ObjectStorageService,
    bunny: BunnyStorageService
  ) {
    try {
      const episode = await storage.getDramaEpisode(episodeId);
      if (!episode) return;
      const project = await storage.getDramaProject(projectId);
      if (!project) return;

      const user = await storage.getUser(episode.userId);
      const userFolder = user?.username || episode.userId;
      if (!atlasIsConfigured()) throw new Error("ATLASCLOUD_API_KEY 未設定");

      const scenes: any[] = JSON.parse(episode.scenes);
      const scene = scenes[sceneIdx];
      const sceneSizeMap: Record<string, string> = {
        "1:1": "2048x2048", "9:16": "1440x2560", "16:9": "2560x1440",
      };
      const imageSize = sceneSizeMap[project.sceneSize ?? "9:16"] || "1440x2560";

      const loadRefImageAsBase64 = async (imagePath: string): Promise<string> => {
        const objectFile = await objectStorage.getObjectEntityFile(imagePath);
        const chunks: Buffer[] = [];
        for await (const chunk of objectFile.createReadStream()) chunks.push(Buffer.from(chunk));
        return `data:image/jpeg;base64,${Buffer.concat(chunks).toString("base64")}`;
      };

      const loadImageList = async (urls: string[]): Promise<string[]> => {
        if (!urls || urls.length === 0) return [];
        try { return await Promise.all(urls.map(loadRefImageAsBase64)); } catch { return []; }
      };

      const useA = scene.useCharA !== false;
      const useB = scene.useCharB !== false;
      const charAList = useA ? await loadImageList(project.characterAUrls ?? []) : [];
      const charBList = useB ? await loadImageList(project.characterBUrls ?? []) : [];
      const styleList = await loadImageList(project.styleImageUrls ?? []);

      let sceneRefList: string[] = [];
      if (scene.sceneRefImageUrl) {
        try { sceneRefList = [await loadRefImageAsBase64(scene.sceneRefImageUrl)]; } catch {}
      }

      // Chain Mode: insert prev scene's last frame (or main image) at front
      const episodeChainOn = !!episode.chainMode;
      const ov = scene?.chainModeOverride ?? "inherit";
      const sceneChainOn = ov === "on" ? true : ov === "off" ? false : episodeChainOn;
      // Resolve continuity source — same priority as processDramaEpisode:
      // chainRefCustomUrl > chainRefSource > default fallback chain.
      const resolveContinuityUrl = (prev: any, curr: any): string | null => {
        const fallback =
          prev?.lastFrameBunnyUrl
            || prev?.lastFrameUrl
            || prev?.bunnyUrl
            || prev?.imageUrl
            || null;
        if (curr?.chainRefCustomUrl) return curr.chainRefCustomUrl;
        const src = curr?.chainRefSource ?? "auto";
        switch (src) {
          case "prevLast":
            return prev?.lastFrameBunnyUrl || prev?.lastFrameUrl || fallback;
          case "prevFirst":
            return prev?.firstFrameBunnyUrl || prev?.firstFrameUrl || fallback;
          case "prevMain":
            return prev?.bunnyUrl || prev?.imageUrl || fallback;
          default:
            return fallback;
        }
      };
      let continuityRef: string | null = null;
      if (sceneChainOn && sceneIdx > 0) {
        const prev = scenes[sceneIdx - 1];
        const prevUrl = resolveContinuityUrl(prev, scene);
        if (prevUrl) {
          try {
            if (prevUrl.startsWith("/objects/") || prevUrl.startsWith("/object-entities/")) {
              continuityRef = await loadRefImageAsBase64(prevUrl);
            } else if (prevUrl.startsWith("data:")) {
              continuityRef = prevUrl;
            } else {
              const safe = ssrfAssertAllowedRemoteUrl(prevUrl);
              const r = await fetch(safe.toString(), { redirect: "error" });
              if (r.ok) {
                const buf = Buffer.from(await r.arrayBuffer());
                continuityRef = `data:image/jpeg;base64,${buf.toString("base64")}`;
              }
            }
          } catch (e: any) {
            console.warn(`[Drama] regen continuity ref failed: ${e.message}`);
          }
        }
      }

      const allRefs = [
        ...(continuityRef ? [continuityRef] : []),
        ...charAList,
        ...charBList,
        ...sceneRefList,
        ...styleList,
      ];
      const dialoguePart = scene.dialogue?.trim() ? `，台詞：「${scene.dialogue}」` : "";
      const scenePrompt = `${scene.description}${dialoguePart}`;
      const useSeed = scene._tempSeed || episode.globalSeed;

      let requestBody: any;
      if (allRefs.length > 0) {
        const labelParts: string[] = [];
        let idx = 1;
        if (continuityRef) { labelParts.push(`第 ${idx} 張圖為上一幕的結尾畫面，本幕需從這個畫面自然延續構圖、角色站位、視線與光線`); idx += 1; }
        if (charAList.length > 0) { labelParts.push(`第 ${idx}${charAList.length > 1 ? `-${idx + charAList.length - 1}` : ""} 張圖為角色 A 外貌，保持角色一致`); idx += charAList.length; }
        if (charBList.length > 0) { labelParts.push(`第 ${idx}${charBList.length > 1 ? `-${idx + charBList.length - 1}` : ""} 張圖為角色 B 外貌，保持角色一致`); idx += charBList.length; }
        if (sceneRefList.length > 0) { labelParts.push(`第 ${idx} 張圖為場景構圖參考`); idx += sceneRefList.length; }
        if (styleList.length > 0) { labelParts.push(`第 ${idx}${styleList.length > 1 ? `-${idx + styleList.length - 1}` : ""} 張圖為畫風風格參考`); }
        requestBody = {
          prompt: plainImagePrompt(`${scenePrompt}（${labelParts.join("；")}）`),
          image: allRefs.length === 1 ? allRefs[0] : allRefs,
          size: imageSize,
        };
      } else {
        requestBody = {
          prompt: plainImagePrompt(scenePrompt),
          size: imageSize,
        };
      }

      const imageUrl = await atlasGenerateImage({ prompt: requestBody.prompt, images: requestBody.image, size: requestBody.size });

      scenes[sceneIdx].imageUrl = imageUrl;
      delete scenes[sceneIdx]._tempSeed;

      if (bunny.isConfigured()) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const imgResp = await fetch(imageUrl);
            const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
            const remotePath = `users/${userFolder}/drama/${projectId}_ep${episode.episodeNumber}_scene${sceneIdx}.jpg`;
            const cdnUrl = await bunny.uploadBuffer(imgBuffer, remotePath);
            scenes[sceneIdx].bunnyUrl = cdnUrl;
            break;
          } catch (e) {
            if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
          }
        }
      }

      scenes[sceneIdx].imageStatus = "completed";
      delete scenes[sceneIdx].imageError;
      await storage.updateDramaEpisode(episodeId, { scenes: JSON.stringify(scenes) });
      console.log(`✅ Drama scene ${sceneIdx + 1} regenerated`);
    } catch (err: any) {
      console.error(`❌ Drama scene ${sceneIdx + 1} regen failed:`, err.message);
      const ep = await storage.getDramaEpisode(episodeId);
      if (ep) {
        const scenes: any[] = JSON.parse(ep.scenes);
        scenes[sceneIdx].imageStatus = "failed";
        scenes[sceneIdx].imageError = err.message;
        await storage.updateDramaEpisode(episodeId, { scenes: JSON.stringify(scenes) });
      }
      // Refund credits on drama scene image regeneration failure
      try {
        const ep2 = ep ?? await storage.getDramaEpisode(episodeId);
        if (ep2) {
          const user = await storage.getUser(ep2.userId);
          const creditCost = IMAGE_COST;
          if (user) {
            const newBalance = (user.credits ?? 0) + creditCost;
            await storage.updateUserCredits(ep2.userId, newBalance);
            await storage.createCreditTransaction({
              userId: ep2.userId,
              type: "refund",
              amount: creditCost,
              balance: newBalance,
              description: `漫劇第 ${ep2.episodeNumber} 集第 ${sceneIdx + 1} 幕重生失敗退款`,
            });
            console.log(`✅ Refunded ${creditCost} credits for failed drama scene ${sceneIdx + 1} regen`);
          }
        }
      } catch (refundErr) {
        console.error("Failed to refund drama scene regen credits:", refundErr);
      }
    }
  }

  async function animateDramaScene(
    episodeId: string,
    projectId: string,
    sceneIdx: number,
    opts: { duration: number; resolution: string; prompt?: string; useOmniMode?: boolean; generateAudio?: boolean; useFirstLastFrame?: boolean },
    objectStorage: ObjectStorageService,
    bunny: BunnyStorageService
  ) {
    try {
      const episode = await storage.getDramaEpisode(episodeId);
      if (!episode) return;
      const project = await storage.getDramaProject(projectId);
      if (!project) return;

      const user = await storage.getUser(episode.userId);
      const userFolder = user?.username || episode.userId;
      const scenes: any[] = JSON.parse(episode.scenes);
      const scene = scenes[sceneIdx];

      // Decide first/last frame mode (auto-on if scene has both frames)
      const hasBothFrames = !!(
        (scene.firstFrameBunnyUrl || scene.firstFrameUrl) &&
        (scene.lastFrameBunnyUrl || scene.lastFrameUrl)
      );
      const useFirstLast = (opts.useFirstLastFrame ?? scene.useFirstLastFrame ?? false) && hasBothFrames;

      const mainImageUrl = scene.bunnyUrl?.split("?")[0] || scene.imageUrl;

      // Prefer AI-generated video prompt → caller-supplied prompt → description
      // The scene description describes a still picture, so it is not used as
      // the motion prompt: without a written one we fall back to a safe motion.
      const videoPrompt = opts.prompt || scene.videoPrompt || fallbackMotionPrompt(scene);

      // AtlasCloud WAN 3.0 image-to-video: one first frame plus an optional
      // last frame, both public URLs; output ratio follows the first frame.
      // WAN has no multi-reference ("omni") input, so opts.useOmniMode no
      // longer adds character / scene reference images.
      let firstImageUrl: string = mainImageUrl;
      let lastImageUrl: string | undefined;
      if (useFirstLast) {
        firstImageUrl = (scene.firstFrameBunnyUrl || scene.firstFrameUrl).split("?")[0];
        lastImageUrl = (scene.lastFrameBunnyUrl || scene.lastFrameUrl).split("?")[0];
      }
      if (!firstImageUrl) throw new Error("此幕尚未生成圖片，無法製作動畫");

      const result = await atlasGenerateVideo({
        prompt: videoPrompt,
        image: firstImageUrl,
        lastImage: lastImageUrl,
        resolution: opts.resolution,
        duration: opts.duration,
        audio: opts.generateAudio ?? true,
      });

      let videoBunnyUrl: string | undefined;
      if (bunny.isConfigured()) {
        try {
          videoBunnyUrl = await bunny.uploadVideoFromUrl(
            result.videoUrl,
            userFolder,
            `drama_${projectId}_ep${episode.episodeNumber}_scene${sceneIdx}`
          );
        } catch (e) { console.error("Bunny video upload failed:", e); }
      }

      scenes[sceneIdx].videoUrl = result.videoUrl;
      scenes[sceneIdx].videoBunnyUrl = videoBunnyUrl || result.videoUrl;
      scenes[sceneIdx].videoStatus = "completed";
      scenes[sceneIdx].videoDuration = opts.duration;
      scenes[sceneIdx].videoResolution = opts.resolution;
      delete scenes[sceneIdx].videoError;
      await storage.updateDramaEpisode(episodeId, { scenes: JSON.stringify(scenes) });
      console.log(`✅ Drama scene ${sceneIdx + 1} animated`);
    } catch (err: any) {
      const friendlyMessage = translateApiError(err.message || "未知錯誤");
      console.error(`❌ Drama scene ${sceneIdx + 1} animation failed:`, err.message);
      const ep = await storage.getDramaEpisode(episodeId);
      if (ep) {
        const scenes: any[] = JSON.parse(ep.scenes);
        scenes[sceneIdx].videoStatus = "failed";
        scenes[sceneIdx].videoError = friendlyMessage;
        await storage.updateDramaEpisode(episodeId, { scenes: JSON.stringify(scenes) });
      }
      // Refund credits on drama scene animation failure
      try {
        const ep2 = await storage.getDramaEpisode(episodeId);
        if (ep2) {
          const user = await storage.getUser(ep2.userId);
          const creditCost = opts.resolution === "1080p" ? Math.ceil(opts.duration * 15) : Math.ceil(opts.duration * 8);
          if (user) {
            const newBalance = (user.credits ?? 0) + creditCost;
            await storage.updateUserCredits(ep2.userId, newBalance);
            await storage.createCreditTransaction({
              userId: ep2.userId,
              type: "refund",
              amount: creditCost,
              balance: newBalance,
              description: `漫劇動畫第 ${sceneIdx + 1} 幕失敗退款（${friendlyMessage}）`,
            });
            console.log(`✅ Refunded ${creditCost} credits for failed drama scene ${sceneIdx + 1}`);
          }
        }
      } catch (refundErr) {
        console.error("Failed to refund drama scene credits:", refundErr);
      }
    }
  }

  // ─── Drama Studio extensions: character/scene library, script import,
  //     AI video prompt, first/last frames, ZIP download ─────────────────────
  registerDramaLibraryRoutes(app, { requireAuth, objectStorageService, bunnyStorage });

  // ─── 寫真套圖：情境圖分析 + 鏡頭規劃（生成走既有批次端點）─────────────
  registerPhotosetRoutes(app, { requireAuth, objectStorageService });

  // ─── 作品庫：使用者所有完成的圖片與影片 ───────────────────────────────
  registerVaultRoutes(app, {
    requireAuth,
    getUserImageGenerations: (userId) => storage.getUserImageGenerations(userId),
    getUserVideoGenerations: (userId) => storage.getUserVideoGenerations(userId),
    cdnUrl: fixBunnyCdnUrl,
  });

  // ─── 作品牆：公開作品、讚、留言、追蹤、創作者主頁、審核 ─────────────────
  registerShowcaseRoutes(app, { requireAuth, requireAdmin, cdnUrl: fixBunnyCdnUrl });

  // ─── 素材圖庫：清單同步、批次生成預覽圖、瀏覽 ───────────────────────────
  registerAssetLibraryRoutes(app, { requireAuth, requireAdmin, bunnyStorage, cdnUrl: fixBunnyCdnUrl });

  // ─── 成本紀錄：每次成功的生成記一筆，後台「成本」分頁查看 ─────────────
  setAtlasUsageListener(recordProviderUsage);
  registerCostRoutes(app, { requireAuth, requireAdmin });

  // ─── 對外服務 API（/api/v1/partner/*）與後台權杖管理 ─────────────────────
  // Reuses the workers above; see server/partnerApi.ts and docs/partner-api.md.
  registerPartnerRoutes(app, {
    store: partnerStore,
    core: {
      getUser: (id) => storage.getUser(id),
      getUserByEmail: (email) => storage.getUserByEmail(email),
      setCreditsMirror: async (userId, credits) => { forgetWalletAccount(userId); await storage.setCreditsMirror(userId, credits); },
      setPartnerUserAdult: async (userId, birthDate) => {
        // Adult prompts are only accepted from the gold zone, by a gold account:
        // a workspace the partner opened them for becomes one, and stops being one when turned off.
        await storage.updateUserProfile(userId, birthDate
          ? { birthDate, nsfwEnabled: true, nsfwConsentAt: new Date(), isGold: true, goldSince: new Date() }
          : { nsfwEnabled: false, isGold: false, goldSince: null });
      },
      createPartnerUser: async ({ username, email }) => {
        // "!" can never match a bcrypt hash, so this account has no password sign-in.
        const user = await storage.createUser({ username, email, password: "!" + randomBytes(24).toString("hex") });
        await storage.updateUserProfile(user.id, { onboardedAt: new Date() });
        return { id: user.id };
      },
      atomicDeductCredits: (userId, amount, description) => storage.atomicDeductCredits(userId, amount, description),
      atomicAddCredits: (userId, amount, description) => storage.atomicAddCredits(userId, amount, description),
      createImageGeneration: (data) => storage.createImageGeneration(data as any),
      getImageGeneration: (id) => storage.getImageGeneration(id),
      createVideoGeneration: (data) => storage.createVideoGeneration(data as any),
      getVideoGeneration: (id) => storage.getVideoGeneration(id),
      getUserDailyImageCount: (userId) => storage.getUserDailyImageCount(userId),
      getUserDailyVideoCount: (userId) => storage.getUserDailyVideoCount(userId),
    },
    runImage: (id, opts) => { processImageGeneration(id, undefined, opts).catch(console.error); },
    runVideo: (id, opts) => { processVideoGeneration(id, objectStorageService, opts).catch(console.error); },
    ingestImage: createPartnerImageIngestor(bunnyStorage, fixBunnyCdnUrl),
    storeUpload: createPartnerUploadStore(bunnyStorage, fixBunnyCdnUrl),
    isCdnUrl: (url) => bunnyStorage.isOwnCdnUrl(url),
    deleteStored: (url) => bunnyStorage.deleteByCdnUrl(url),
    storageReady: () => bunnyStorage.isConfigured(),
    walletReady: partnerWalletConfigured,
    planPhotoset: (input) => createPhotosetPlanner(objectStorageService).plan(input),
    sizeDimensions: atlasSizeDimensions,
    cdnUrl: fixBunnyCdnUrl,
    requireAuth,
    requireAdmin,
  });

  const httpServer = createServer(app);
  return httpServer;
}

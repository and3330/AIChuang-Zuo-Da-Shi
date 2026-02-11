import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import bcrypt from "bcryptjs";
import Stripe from "stripe";
import { storage } from "./storage";
import { insertUserSchema, loginSchema, insertImageGenerationSchema, insertTextToImageSchema, insertImageToImageSchema, insertBatchImageToImageSchema, insertImageToVideoSchema } from "@shared/schema";
import { ObjectStorageService } from "./objectStorage";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2026-01-28.clover" as any,
});

declare module "express-session" {
  interface SessionData {
    userId: string;
    username: string;
  }
}

function convertAspectRatioToSize(size: string): string {
  return size;
}

const SEEDDANCE_MODEL = "ep-20251223142939-njrkd";
const ARK_API_ENDPOINT = "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";

const VIDEO_MODEL = "ep-20250813120833-g4mpb";
const VIDEO_API_ENDPOINT = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "未登录，请先登录" });
  }
  next();
}

export async function registerRoutes(app: Express): Promise<Server> {
  const objectStorageService = new ObjectStorageService();

  // ===== AUTH ROUTES =====

  app.post("/api/auth/register", async (req, res) => {
    try {
      const validatedData = insertUserSchema.parse(req.body);

      const existingUsername = await storage.getUserByUsername(validatedData.username);
      if (existingUsername) {
        return res.status(400).json({ error: "用户名已存在" });
      }

      const existingEmail = await storage.getUserByEmail(validatedData.email);
      if (existingEmail) {
        return res.status(400).json({ error: "邮箱已被注册" });
      }

      const hashedPassword = await bcrypt.hash(validatedData.password, 10);
      const user = await storage.createUser({ ...validatedData, password: hashedPassword });

      const welcomeCredits = 10;
      const updatedUser = await storage.updateUserCredits(user.id, welcomeCredits);

      await storage.createCreditTransaction({
        userId: user.id,
        type: "topup",
        amount: welcomeCredits,
        balance: welcomeCredits,
        description: "注册欢迎奖励",
      });

      req.session.userId = user.id;
      req.session.username = user.username;

      res.json({
        user: {
          id: updatedUser!.id,
          username: updatedUser!.username,
          email: updatedUser!.email,
          credits: updatedUser!.credits,
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

      res.json({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          credits: user.credits,
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
      if (!amount || !Number.isInteger(amount) || amount < 10) {
        return res.status(400).json({ error: "充值金額最少 10 積分" });
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
        success_url: `${baseUrl}/account?payment=success&amount=${amount}`,
        cancel_url: `${baseUrl}/account?payment=cancelled`,
        metadata: {
          userId: user.id,
          credits: amount.toString(),
        },
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Error creating checkout session:", error);
      res.status(500).json({ error: "無法建立付款頁面" });
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
          const user = await storage.getUser(userId);
          if (user) {
            const newBalance = (user.credits || 0) + credits;
            await storage.updateUserCredits(user.id, newBalance);
            await storage.createCreditTransaction({
              userId: user.id,
              type: "topup",
              amount: credits,
              balance: newBalance,
              description: `Stripe 付款充值 ${credits} 積分`,
            });
            console.log(`Stripe webhook: credited ${credits} to user ${userId}`);
          }
        } catch (error) {
          console.error("Error processing Stripe webhook:", error);
        }
      }
    }

    res.json({ received: true });
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

      if (req.body.prompts && Array.isArray(req.body.prompts)) {
        creditsNeeded = 3 * req.body.prompts.length;
      } else if (req.body.sequentialGeneration && req.body.maxImages && req.body.maxImages > 1) {
        creditsNeeded = 3 * req.body.maxImages;
      } else {
        creditsNeeded = 3;
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
      await storage.createCreditTransaction({
        userId,
        type: "consume",
        amount: -creditsNeeded,
        balance: newBalance,
        description: `图片生成消耗 ${creditsNeeded} 积分`,
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
    } catch (error) {
      console.error("Error creating image generation:", error);
      res.status(500).json({ error: "Failed to create image generation" });
    }
  });

  app.get("/api/image-generations/:id", async (req, res) => {
    try {
      const generation = await storage.getImageGeneration(req.params.id);
      if (!generation) {
        return res.status(404).json({ error: "Generation not found" });
      }
      res.json(generation);
    } catch (error) {
      console.error("Error getting image generation:", error);
      res.status(500).json({ error: "Failed to get image generation" });
    }
  });

  app.get("/api/batch-generations/:batchId", async (req, res) => {
    try {
      const generations = await storage.getImageGenerationsByBatchId(req.params.batchId);
      if (generations.length === 0) {
        return res.status(404).json({ error: "Batch not found" });
      }
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
        throw new Error(`ARK_API_KEY environment variable is not set. Please configure your API key for SeedDance 4.5.`);
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
        const lines = responseText.split('\n').filter(line => line.trim());
        const generatedImageUrls: string[] = [];
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6);
            if (jsonStr === '[DONE]') continue;
            
            try {
              const data = JSON.parse(jsonStr);
              if (data.data && Array.isArray(data.data)) {
                for (const item of data.data) {
                  if (item.url) {
                    generatedImageUrls.push(item.url);
                  }
                }
              }
            } catch (e) {
              console.log(`Failed to parse streaming line: ${jsonStr}`);
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
        
        await storage.updateImageGeneration(generationId, {
          status: "completed",
          generatedImageUrl: generatedImageUrls[0],
          generatedImageUrls,
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

        await storage.updateImageGeneration(generationId, {
          status: "completed",
          generatedImageUrl,
          processingTime,
          cost: 0.03
        });
      }

    } catch (error) {
      console.error("Error processing image generation:", error);
      await storage.updateImageGeneration(generationId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        processingTime: 0
      });
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

      const duration = req.body.duration || 5;
      const creditsNeeded = duration === 5 ? 10 : 18;

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

      const validatedData = insertImageToVideoSchema.parse(req.body);
      const generation = await storage.createVideoGeneration({ ...validatedData, userId });

      processVideoGeneration(generation.id, objectStorageService).catch(console.error);

      res.json(generation);
    } catch (error) {
      console.error("Error creating video generation:", error);
      res.status(500).json({ error: "Failed to create video generation" });
    }
  });

  app.get("/api/video-generations/:id", async (req, res) => {
    try {
      const generation = await storage.getVideoGeneration(req.params.id);
      if (!generation) {
        return res.status(404).json({ error: "Video generation not found" });
      }
      res.json(generation);
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

      console.log(`Getting image from object storage: ${generation.originalImageUrl}`);
      const objectFile = await objectStorageService.getObjectEntityFile(generation.originalImageUrl);
      const chunks: Buffer[] = [];
      const stream = objectFile.createReadStream();
      
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      
      const imageBuffer = Buffer.concat(chunks);
      const base64Image = imageBuffer.toString('base64');
      const imageDataUri = `data:image/jpeg;base64,${base64Image}`;

      let promptText = generation.prompt;
      promptText += ` --duration ${generation.duration}`;
      promptText += ` --camerafixed ${generation.cameraFixed}`;

      const requestBody = {
        model: VIDEO_MODEL,
        content: [
          {
            type: "text",
            text: promptText
          },
          {
            type: "image_url",
            image_url: {
              url: imageDataUri
            }
          }
        ]
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
      const maxAttempts = 120;
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
      
      await storage.updateVideoGeneration(generationId, {
        status: "completed",
        generatedVideoUrl: videoUrl,
        processingTime,
        cost: 0.10
      });

    } catch (error) {
      console.error("Error processing video generation:", error);
      await storage.updateVideoGeneration(generationId, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        processingTime: 0
      });
    }
  }

  const httpServer = createServer(app);
  return httpServer;
}

import { type User, type InsertUser, type ImageGeneration, type InsertImageGeneration, type InsertBatchImageToImage, type VideoGeneration, type InsertImageToVideo, type InsertTextToVideo, type CreditTransaction, type VerificationCode, type ChatMessage, type StoryGeneration, type InsertStoryGeneration, type StoryScene, users, creditTransactions, imageGenerations, videoGenerations, verificationCodes, chatMessages, storyGenerations } from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, gt, like } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserGoogleId(userId: string, googleId: string, avatarUrl?: string): Promise<User | undefined>;
  updateUserCredits(userId: string, credits: number): Promise<User | undefined>;
  setUserAdmin(userId: string, isAdmin: boolean): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;

  createCreditTransaction(transaction: { userId: string; type: string; amount: number; balance: number; description: string | null }): Promise<CreditTransaction>;
  getCreditTransactions(userId: string): Promise<CreditTransaction[]>;
  getCreditTransactionByDescription(description: string): Promise<CreditTransaction | undefined>;
  getAllTopupTransactions(): Promise<(CreditTransaction & { username?: string; email?: string })[]>;

  createImageGeneration(generation: InsertImageGeneration & { userId: string; sequentialGeneration?: boolean; maxImages?: number | null; additionalImageUrls?: string[] }): Promise<ImageGeneration>;
  createBatchImageGenerations(batchData: InsertBatchImageToImage & { userId: string }): Promise<ImageGeneration[]>;
  getImageGeneration(id: string): Promise<ImageGeneration | undefined>;
  getImageGenerationsByBatchId(batchId: string): Promise<ImageGeneration[]>;
  updateImageGeneration(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | undefined>;
  getAllImageGenerations(): Promise<ImageGeneration[]>;
  getUserImageGenerations(userId: string): Promise<ImageGeneration[]>;
  getUserStats(userId: string): Promise<{ totalGenerations: number; totalCost: number; totalCreditsUsed: number }>;

  createVideoGeneration(generation: (InsertImageToVideo | InsertTextToVideo) & { userId: string }): Promise<VideoGeneration>;
  getVideoGeneration(id: string): Promise<VideoGeneration | undefined>;
  updateVideoGeneration(id: string, updates: Partial<VideoGeneration>): Promise<VideoGeneration | undefined>;
  getAllVideoGenerations(): Promise<VideoGeneration[]>;
  getUserVideoGenerations(userId: string): Promise<VideoGeneration[]>;
  getStats(): Promise<{ totalGenerations: number; totalCost: number }>;
  atomicAddCredits(userId: string, amount: number, description: string): Promise<void>;
  fixStripeTransactionTypes(): Promise<number>;

  createVerificationCode(email: string, code: string, expiresAt: Date): Promise<VerificationCode>;
  getValidVerificationCode(email: string, code: string): Promise<VerificationCode | undefined>;
  getRecentVerificationCode(email: string): Promise<VerificationCode | undefined>;
  markVerificationCodeUsed(id: string): Promise<void>;
  deleteExpiredVerificationCodes(): Promise<void>;

  getUserByTelegramChatId(chatId: string): Promise<User | undefined>;
  bindTelegramChatId(userId: string, chatId: string): Promise<User | undefined>;

  createChatMessage(userId: string, message: string, isAdmin: boolean): Promise<ChatMessage>;
  getChatMessages(userId: string): Promise<ChatMessage[]>;
  getChatsOverview(): Promise<{ userId: string; username: string; email: string; lastMessage: string; lastMessageAt: Date | null; unreadCount: number }[]>;
  markChatMessagesRead(userId: string): Promise<void>;
  getUnreadCount(userId: string): Promise<number>;

  createStoryGeneration(data: InsertStoryGeneration & { userId: string; creditsUsed: number }): Promise<StoryGeneration>;
  getStoryGeneration(id: string): Promise<StoryGeneration | undefined>;
  updateStoryGeneration(id: string, updates: Partial<StoryGeneration>): Promise<StoryGeneration | undefined>;
  getUserStoryGenerations(userId: string): Promise<StoryGeneration[]>;
  failStoryGenerationAndRefund(id: string, errorMessage: string): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async getUserByTelegramChatId(chatId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId));
    return user;
  }

  async bindTelegramChatId(userId: string, chatId: string): Promise<User | undefined> {
    const [user] = await db.update(users).set({ telegramChatId: chatId }).where(eq(users.id, userId)).returning();
    return user;
  }

  async updateUserGoogleId(userId: string, googleId: string, avatarUrl?: string): Promise<User | undefined> {
    const updates: any = { googleId };
    if (avatarUrl) updates.avatarUrl = avatarUrl;
    const [user] = await db.update(users).set(updates).where(eq(users.id, userId)).returning();
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values({
      username: insertUser.username,
      password: insertUser.password,
      email: insertUser.email,
      credits: 0,
      isAdmin: false,
    }).returning();
    return user;
  }

  async updateUserCredits(userId: string, credits: number): Promise<User | undefined> {
    const [user] = await db.update(users).set({ credits }).where(eq(users.id, userId)).returning();
    return user;
  }

  async atomicAddCredits(userId: string, amount: number, description: string): Promise<void> {
    const isStripePayment = description.startsWith("Stripe");
    const [updated] = await db.update(users)
      .set({ credits: sql`${users.credits} + ${amount}` })
      .where(eq(users.id, userId))
      .returning();
    if (updated) {
      await db.insert(creditTransactions).values({
        userId,
        type: isStripePayment ? "topup" : (amount > 0 ? "refund" : "consume"),
        amount,
        balance: updated.credits || 0,
        description,
      });
    }
  }

  async fixStripeTransactionTypes(): Promise<number> {
    const result = await db.update(creditTransactions)
      .set({ type: "topup" })
      .where(
        and(
          like(creditTransactions.description, "Stripe%"),
          eq(creditTransactions.type, "refund")
        )
      )
      .returning();
    return result.length;
  }

  async setUserAdmin(userId: string, isAdmin: boolean): Promise<User | undefined> {
    const [user] = await db.update(users).set({ isAdmin }).where(eq(users.id, userId)).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async createCreditTransaction(transaction: { userId: string; type: string; amount: number; balance: number; description: string | null }): Promise<CreditTransaction> {
    const [ct] = await db.insert(creditTransactions).values({
      userId: transaction.userId,
      type: transaction.type,
      amount: transaction.amount,
      balance: transaction.balance,
      description: transaction.description,
    }).returning();
    return ct;
  }

  async getCreditTransactions(userId: string): Promise<CreditTransaction[]> {
    return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId)).orderBy(desc(creditTransactions.createdAt));
  }

  async getCreditTransactionByDescription(description: string): Promise<CreditTransaction | undefined> {
    const [row] = await db.select().from(creditTransactions).where(eq(creditTransactions.description, description));
    return row;
  }

  async getAllTopupTransactions(): Promise<(CreditTransaction & { username?: string; email?: string })[]> {
    const rows = await db
      .select({
        id: creditTransactions.id,
        userId: creditTransactions.userId,
        type: creditTransactions.type,
        amount: creditTransactions.amount,
        balance: creditTransactions.balance,
        description: creditTransactions.description,
        createdAt: creditTransactions.createdAt,
        username: users.username,
        email: users.email,
      })
      .from(creditTransactions)
      .leftJoin(users, eq(creditTransactions.userId, users.id))
      .where(eq(creditTransactions.type, "topup"))
      .orderBy(desc(creditTransactions.createdAt));
    return rows as any;
  }

  async createImageGeneration(insertGeneration: InsertImageGeneration & { userId: string; sequentialGeneration?: boolean; maxImages?: number | null; additionalImageUrls?: string[] }): Promise<ImageGeneration> {
    const [row] = await db.insert(imageGenerations).values({
      userId: insertGeneration.userId,
      batchId: insertGeneration.batchId ?? null,
      type: insertGeneration.type ?? "image-to-image",
      originalImageUrl: insertGeneration.originalImageUrl ?? null,
      prompt: insertGeneration.prompt,
      guidanceScale: insertGeneration.guidanceScale ?? 5.5,
      seed: insertGeneration.seed ?? 21,
      watermark: insertGeneration.watermark ?? true,
      size: insertGeneration.size ?? "2K",
      sequentialGeneration: insertGeneration.sequentialGeneration ?? false,
      maxImages: insertGeneration.maxImages ?? 1,
      additionalImageUrls: insertGeneration.additionalImageUrls ?? [],
      generatedImageUrls: [],
      status: "pending",
      cost: 0.05,
      creditsUsed: 3,
    }).returning();

    return row;
  }

  async createBatchImageGenerations(batchData: InsertBatchImageToImage & { userId: string }): Promise<ImageGeneration[]> {
    const batchId = randomUUID();
    const generations: ImageGeneration[] = [];

    for (const prompt of batchData.prompts) {
      const gen = await this.createImageGeneration({
        userId: batchData.userId,
        type: batchData.type,
        batchId,
        originalImageUrl: batchData.originalImageUrl,
        prompt,
        guidanceScale: batchData.guidanceScale,
        seed: batchData.seed,
        watermark: batchData.watermark,
        size: batchData.size,
      });
      generations.push(gen);
    }

    return generations;
  }

  async getImageGeneration(id: string): Promise<ImageGeneration | undefined> {
    const [row] = await db.select().from(imageGenerations).where(eq(imageGenerations.id, id));
    return row;
  }

  async getImageGenerationsByBatchId(batchId: string): Promise<ImageGeneration[]> {
    return db.select().from(imageGenerations).where(eq(imageGenerations.batchId, batchId)).orderBy(imageGenerations.createdAt);
  }

  async updateImageGeneration(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | undefined> {
    const dbUpdates: any = { updatedAt: new Date() };
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.generatedImageUrl !== undefined) dbUpdates.generatedImageUrl = updates.generatedImageUrl;
    if (updates.errorMessage !== undefined) dbUpdates.errorMessage = updates.errorMessage;
    if (updates.processingTime !== undefined) dbUpdates.processingTime = updates.processingTime;
    if (updates.cost !== undefined) dbUpdates.cost = updates.cost;
    if (updates.creditsUsed !== undefined) dbUpdates.creditsUsed = updates.creditsUsed;
    if (updates.generatedImageUrls !== undefined) dbUpdates.generatedImageUrls = updates.generatedImageUrls;
    if (updates.bunnyImageUrl !== undefined) dbUpdates.bunnyImageUrl = updates.bunnyImageUrl;
    if (updates.bunnyImageUrls !== undefined) dbUpdates.bunnyImageUrls = updates.bunnyImageUrls;

    const [row] = await db.update(imageGenerations).set(dbUpdates).where(eq(imageGenerations.id, id)).returning();
    return row;
  }

  async failImageGenerationAndRefund(id: string, errorMessage: string, processingTime: number): Promise<boolean> {
    const [updated] = await db.update(imageGenerations)
      .set({ status: "failed", errorMessage, processingTime, updatedAt: new Date() })
      .where(sql`${imageGenerations.id} = ${id} AND ${imageGenerations.status} != 'failed'`)
      .returning();

    if (!updated) return false;

    if (updated.userId) {
      const refundAmount = updated.creditsUsed || 3;
      await this.atomicAddCredits(updated.userId, refundAmount, `圖片生成失敗退還 ${refundAmount} 積分`);
    }
    return true;
  }

  async failVideoGenerationAndRefund(id: string, errorMessage: string, processingTime: number): Promise<boolean> {
    const [updated] = await db.update(videoGenerations)
      .set({ status: "failed", errorMessage, processingTime, updatedAt: new Date() })
      .where(sql`${videoGenerations.id} = ${id} AND ${videoGenerations.status} != 'failed'`)
      .returning();

    if (!updated) return false;

    if (updated.userId) {
      const creditsPerSec = updated.resolution === "720p" ? 3.4 : 6.8;
      const refundAmount = updated.creditsUsed || Math.round((updated.duration || 5) * creditsPerSec);
      await this.atomicAddCredits(updated.userId, refundAmount, `影片生成失敗退還 ${refundAmount} 積分`);
    }
    return true;
  }

  async getAllImageGenerations(): Promise<ImageGeneration[]> {
    return db.select().from(imageGenerations).orderBy(desc(imageGenerations.createdAt));
  }

  async getUserImageGenerations(userId: string): Promise<ImageGeneration[]> {
    return db.select().from(imageGenerations).where(eq(imageGenerations.userId, userId)).orderBy(desc(imageGenerations.createdAt));
  }

  async getUserStats(userId: string): Promise<{ totalGenerations: number; totalCost: number; totalCreditsUsed: number }> {
    const userImages = await db.select().from(imageGenerations).where(eq(imageGenerations.userId, userId));
    const userVideos = await db.select().from(videoGenerations).where(eq(videoGenerations.userId, userId));
    const totalGenerations = userImages.length + userVideos.length;
    const completedUserImages = userImages.filter(g => g.status === 'completed');
    const completedUserVideos = userVideos.filter(g => g.status === 'completed');
    const imageCost = completedUserImages.length * 0.05;
    const videoCost = completedUserVideos.reduce((sum, gen) => {
      const dur = gen.duration || 5;
      const r = gen.resolution || '1080p';
      const ar = gen.aspectRatio || '16:9';
      let w: number, h: number;
      if (r === '720p') {
        if (ar === '16:9') { w = 1280; h = 720; }
        else if (ar === '9:16') { w = 720; h = 1280; }
        else { w = 720; h = 720; }
      } else {
        if (ar === '16:9') { w = 1920; h = 1080; }
        else if (ar === '9:16') { w = 1080; h = 1920; }
        else { w = 1080; h = 1080; }
      }
      const tokens = (w * h * 24 * dur) / 1024;
      return sum + (tokens / 1_000_000) * 2.4;
    }, 0);
    const imageCredits = completedUserImages.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);
    const videoCredits = completedUserVideos.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);
    return { totalGenerations, totalCost: imageCost + videoCost, totalCreditsUsed: imageCredits + videoCredits };
  }

  async createVideoGeneration(insertGeneration: (InsertImageToVideo | InsertTextToVideo) & { userId: string }): Promise<VideoGeneration> {
    const duration = insertGeneration.duration ?? 5;
    const resolution = insertGeneration.resolution ?? "1080p";
    const aspectRatio = insertGeneration.aspectRatio ?? "16:9";
    const creditsPerSecond = resolution === "720p" ? 3.4 : 6.8;

    const fps = 24;
    let width: number, height: number;
    if (resolution === "720p") {
      if (aspectRatio === "16:9") { width = 1280; height = 720; }
      else if (aspectRatio === "9:16") { width = 720; height = 1280; }
      else { width = 720; height = 720; }
    } else {
      if (aspectRatio === "16:9") { width = 1920; height = 1080; }
      else if (aspectRatio === "9:16") { width = 1080; height = 1920; }
      else { width = 1080; height = 1080; }
    }
    const tokenConsumption = (width * height * fps * duration) / 1024;
    const videoCost = (tokenConsumption / 1_000_000) * 2.4;

    const [row] = await db.insert(videoGenerations).values({
      userId: insertGeneration.userId,
      type: insertGeneration.type,
      originalImageUrl: "originalImageUrl" in insertGeneration ? insertGeneration.originalImageUrl : null,
      additionalImageUrls: "additionalImageUrls" in insertGeneration ? (insertGeneration.additionalImageUrls ?? []) : [],
      prompt: insertGeneration.prompt,
      duration,
      cameraFixed: insertGeneration.cameraFixed ?? false,
      aspectRatio,
      resolution,
      status: "pending",
      cost: Math.round(videoCost * 10000) / 10000,
      creditsUsed: Math.round(duration * creditsPerSecond),
    }).returning();
    return row;
  }

  async getVideoGeneration(id: string): Promise<VideoGeneration | undefined> {
    const [row] = await db.select().from(videoGenerations).where(eq(videoGenerations.id, id));
    return row;
  }

  async updateVideoGeneration(id: string, updates: Partial<VideoGeneration>): Promise<VideoGeneration | undefined> {
    const dbUpdates: any = { updatedAt: new Date() };
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.taskId !== undefined) dbUpdates.taskId = updates.taskId;
    if (updates.generatedVideoUrl !== undefined) dbUpdates.generatedVideoUrl = updates.generatedVideoUrl;
    if (updates.errorMessage !== undefined) dbUpdates.errorMessage = updates.errorMessage;
    if (updates.processingTime !== undefined) dbUpdates.processingTime = updates.processingTime;
    if (updates.cost !== undefined) dbUpdates.cost = updates.cost;
    if (updates.bunnyVideoUrl !== undefined) dbUpdates.bunnyVideoUrl = updates.bunnyVideoUrl;

    const [row] = await db.update(videoGenerations).set(dbUpdates).where(eq(videoGenerations.id, id)).returning();
    return row;
  }

  async getAllVideoGenerations(): Promise<VideoGeneration[]> {
    return db.select().from(videoGenerations).orderBy(desc(videoGenerations.createdAt));
  }

  async getUserVideoGenerations(userId: string): Promise<VideoGeneration[]> {
    return db.select().from(videoGenerations).where(eq(videoGenerations.userId, userId)).orderBy(desc(videoGenerations.createdAt));
  }

  async getStats(): Promise<{
    totalGenerations: number;
    totalCost: number;
    totalImages: number;
    totalVideos: number;
    completedImages: number;
    completedVideos: number;
    failedImages: number;
    failedVideos: number;
    imageCost: number;
    videoCost: number;
    imageCreditsUsed: number;
    videoCreditsUsed: number;
    totalCreditsUsed: number;
  }> {
    const allImages = await db.select().from(imageGenerations);
    const allVideos = await db.select().from(videoGenerations);

    const completedImages = allImages.filter(g => g.status === "completed");
    const completedVideos = allVideos.filter(g => g.status === "completed");
    const failedImages = allImages.filter(g => g.status === "failed").length;
    const failedVideos = allVideos.filter(g => g.status === "failed").length;

    const IMAGE_COST_USD = 0.05;
    const imageCost = completedImages.length * IMAGE_COST_USD;

    const videoCost = completedVideos.reduce((sum, gen) => {
      const dur = gen.duration || 5;
      const r = gen.resolution || '1080p';
      const ar = gen.aspectRatio || '16:9';
      let w: number, h: number;
      if (r === '720p') {
        if (ar === '16:9') { w = 1280; h = 720; }
        else if (ar === '9:16') { w = 720; h = 1280; }
        else { w = 720; h = 720; }
      } else {
        if (ar === '16:9') { w = 1920; h = 1080; }
        else if (ar === '9:16') { w = 1080; h = 1920; }
        else { w = 1080; h = 1080; }
      }
      const tokens = (w * h * 24 * dur) / 1024;
      return sum + (tokens / 1_000_000) * 2.4;
    }, 0);

    const imageCreditsUsed = completedImages.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);
    const videoCreditsUsed = completedVideos.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);

    return {
      totalGenerations: allImages.length + allVideos.length,
      totalCost: imageCost + videoCost,
      totalImages: allImages.length,
      totalVideos: allVideos.length,
      completedImages: completedImages.length,
      completedVideos: completedVideos.length,
      failedImages,
      failedVideos,
      imageCost,
      videoCost,
      imageCreditsUsed,
      videoCreditsUsed,
      totalCreditsUsed: imageCreditsUsed + videoCreditsUsed,
    };
  }

  async createVerificationCode(email: string, code: string, expiresAt: Date): Promise<VerificationCode> {
    await db.delete(verificationCodes).where(
      and(eq(verificationCodes.email, email), eq(verificationCodes.used, false))
    );
    const [row] = await db.insert(verificationCodes).values({
      email,
      code,
      expiresAt,
    }).returning();
    return row;
  }

  async getRecentVerificationCode(email: string): Promise<VerificationCode | undefined> {
    const [row] = await db.select().from(verificationCodes)
      .where(eq(verificationCodes.email, email))
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);
    return row;
  }

  async getValidVerificationCode(email: string, code: string): Promise<VerificationCode | undefined> {
    const [row] = await db.select().from(verificationCodes).where(
      and(
        eq(verificationCodes.email, email),
        eq(verificationCodes.code, code),
        eq(verificationCodes.used, false),
        gt(verificationCodes.expiresAt, new Date())
      )
    );
    return row;
  }

  async markVerificationCodeUsed(id: string): Promise<void> {
    await db.update(verificationCodes).set({ used: true }).where(eq(verificationCodes.id, id));
  }

  async deleteExpiredVerificationCodes(): Promise<void> {
    await db.delete(verificationCodes).where(
      sql`${verificationCodes.expiresAt} < NOW() OR ${verificationCodes.used} = true`
    );
  }

  async createChatMessage(userId: string, message: string, isAdmin: boolean): Promise<ChatMessage> {
    const [msg] = await db.insert(chatMessages).values({
      userId,
      message,
      isAdmin,
      isRead: isAdmin,
    }).returning();
    return msg;
  }

  async getChatMessages(userId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).where(eq(chatMessages.userId, userId)).orderBy(chatMessages.createdAt);
  }

  async getChatsOverview(): Promise<{ userId: string; username: string; email: string; lastMessage: string; lastMessageAt: Date | null; unreadCount: number }[]> {
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const allMessages = await db.select().from(chatMessages).orderBy(desc(chatMessages.createdAt));

    const chatMap = new Map<string, { lastMessage: string; lastMessageAt: Date | null; unreadCount: number }>();
    for (const msg of allMessages) {
      if (!chatMap.has(msg.userId)) {
        chatMap.set(msg.userId, {
          lastMessage: msg.message,
          lastMessageAt: msg.createdAt,
          unreadCount: 0,
        });
      }
      if (!msg.isAdmin && !msg.isRead) {
        const entry = chatMap.get(msg.userId)!;
        entry.unreadCount++;
      }
    }

    return Array.from(chatMap.entries())
      .map(([userId, data]) => {
        const user = userMap.get(userId);
        return {
          userId,
          username: user?.username || "未知",
          email: user?.email || "",
          ...data,
        };
      })
      .sort((a, b) => (b.lastMessageAt?.getTime() || 0) - (a.lastMessageAt?.getTime() || 0));
  }

  async markChatMessagesRead(userId: string): Promise<void> {
    await db.update(chatMessages).set({ isRead: true }).where(
      and(eq(chatMessages.userId, userId), eq(chatMessages.isAdmin, false))
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    const msgs = await db.select().from(chatMessages).where(
      and(eq(chatMessages.userId, userId), eq(chatMessages.isAdmin, true), eq(chatMessages.isRead, false))
    );
    return msgs.length;
  }

  async createStoryGeneration(data: InsertStoryGeneration & { userId: string; creditsUsed: number }): Promise<StoryGeneration> {
    const scenes: StoryScene[] = data.scenes.map((s, i) => ({
      id: `scene_${i}`,
      title: s.title || `第 ${i + 1} 幕`,
      description: s.description,
      sceneReferenceImageUrl: (s as any).sceneReferenceImageUrl || undefined,
      status: "pending" as const,
    }));
    const [row] = await db.insert(storyGenerations).values({
      userId: data.userId,
      title: data.title,
      style: data.style,
      sceneCount: data.scenes.length,
      referenceImageUrls: data.referenceImageUrls ?? [],
      scenes: JSON.stringify(scenes),
      status: "pending",
      creditsUsed: data.creditsUsed,
      cost: 0,
      sceneSize: (data as any).sceneSize ?? "1:1",
    }).returning();
    return row;
  }

  async getStoryGeneration(id: string): Promise<StoryGeneration | undefined> {
    const [row] = await db.select().from(storyGenerations).where(eq(storyGenerations.id, id));
    return row;
  }

  async updateStoryGeneration(id: string, updates: Partial<StoryGeneration>): Promise<StoryGeneration | undefined> {
    const dbUpdates: any = { updatedAt: new Date() };
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.scenes !== undefined) dbUpdates.scenes = updates.scenes;
    if (updates.errorMessage !== undefined) dbUpdates.errorMessage = updates.errorMessage;
    if (updates.cost !== undefined) dbUpdates.cost = updates.cost;
    if (updates.creditsUsed !== undefined) dbUpdates.creditsUsed = updates.creditsUsed;
    const [row] = await db.update(storyGenerations).set(dbUpdates).where(eq(storyGenerations.id, id)).returning();
    return row;
  }

  async getUserStoryGenerations(userId: string): Promise<StoryGeneration[]> {
    return db.select().from(storyGenerations).where(eq(storyGenerations.userId, userId)).orderBy(desc(storyGenerations.createdAt));
  }

  async failStoryGenerationAndRefund(id: string, errorMessage: string): Promise<boolean> {
    const [updated] = await db.update(storyGenerations)
      .set({ status: "failed", errorMessage, updatedAt: new Date() })
      .where(sql`${storyGenerations.id} = ${id} AND ${storyGenerations.status} != 'failed'`)
      .returning();
    if (!updated) return false;
    if (updated.userId && updated.creditsUsed && updated.creditsUsed > 0) {
      await this.atomicAddCredits(updated.userId, updated.creditsUsed, `故事生成失敗退還 ${updated.creditsUsed} 積分`);
    }
    return true;
  }
}

export const storage = new DatabaseStorage();

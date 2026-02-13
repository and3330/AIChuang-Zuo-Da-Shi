import { type User, type InsertUser, type ImageGeneration, type InsertImageGeneration, type InsertBatchImageToImage, type VideoGeneration, type InsertImageToVideo, type InsertTextToVideo, type CreditTransaction, users, creditTransactions, imageGenerations, videoGenerations } from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserCredits(userId: string, credits: number): Promise<User | undefined>;
  setUserAdmin(userId: string, isAdmin: boolean): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;

  createCreditTransaction(transaction: { userId: string; type: string; amount: number; balance: number; description: string | null }): Promise<CreditTransaction>;
  getCreditTransactions(userId: string): Promise<CreditTransaction[]>;
  getCreditTransactionByDescription(description: string): Promise<CreditTransaction | undefined>;

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
    const [updated] = await db.update(users)
      .set({ credits: sql`${users.credits} + ${amount}` })
      .where(eq(users.id, userId))
      .returning();
    if (updated) {
      await db.insert(creditTransactions).values({
        userId,
        type: amount > 0 ? "refund" : "consume",
        amount,
        balance: updated.credits || 0,
        description,
      });
    }
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
      cost: 0.03,
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
      const refundAmount = updated.creditsUsed || Math.round((updated.duration || 5) * 3.4);
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
    const imageCost = userImages.reduce((sum, gen) => sum + (gen.cost || 0), 0);
    const videoCost = userVideos.reduce((sum, gen) => sum + (gen.cost || 0), 0);
    const imageCredits = userImages.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);
    const videoCredits = userVideos.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);
    return { totalGenerations, totalCost: imageCost + videoCost, totalCreditsUsed: imageCredits + videoCredits };
  }

  async createVideoGeneration(insertGeneration: (InsertImageToVideo | InsertTextToVideo) & { userId: string }): Promise<VideoGeneration> {
    const duration = insertGeneration.duration ?? 5;
    const [row] = await db.insert(videoGenerations).values({
      userId: insertGeneration.userId,
      type: insertGeneration.type,
      originalImageUrl: "originalImageUrl" in insertGeneration ? insertGeneration.originalImageUrl : null,
      prompt: insertGeneration.prompt,
      duration,
      cameraFixed: insertGeneration.cameraFixed ?? false,
      status: "pending",
      cost: 0.10,
      creditsUsed: Math.round(duration * 3.4),
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

    const [row] = await db.update(videoGenerations).set(dbUpdates).where(eq(videoGenerations.id, id)).returning();
    return row;
  }

  async getAllVideoGenerations(): Promise<VideoGeneration[]> {
    return db.select().from(videoGenerations).orderBy(desc(videoGenerations.createdAt));
  }

  async getUserVideoGenerations(userId: string): Promise<VideoGeneration[]> {
    return db.select().from(videoGenerations).where(eq(videoGenerations.userId, userId)).orderBy(desc(videoGenerations.createdAt));
  }

  async getStats(): Promise<{ totalGenerations: number; totalCost: number }> {
    const allImages = await db.select().from(imageGenerations);
    const allVideos = await db.select().from(videoGenerations);
    const totalGenerations = allImages.length + allVideos.length;
    const imageCost = allImages.reduce((sum, gen) => sum + (gen.cost || 0), 0);
    const videoCost = allVideos.reduce((sum, gen) => sum + (gen.cost || 0), 0);
    return { totalGenerations, totalCost: imageCost + videoCost };
  }
}

export const storage = new DatabaseStorage();

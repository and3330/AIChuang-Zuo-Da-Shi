import { type User, type InsertUser, type ImageGeneration, type InsertImageGeneration, type InsertBatchImageToImage, type VideoGeneration, type InsertImageToVideo, type CreditTransaction } from "@shared/schema";
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

  createImageGeneration(generation: InsertImageGeneration & { userId: string; sequentialGeneration?: boolean; maxImages?: number | null; additionalImageUrls?: string[] }): Promise<ImageGeneration>;
  createBatchImageGenerations(batchData: InsertBatchImageToImage & { userId: string }): Promise<ImageGeneration[]>;
  getImageGeneration(id: string): Promise<ImageGeneration | undefined>;
  getImageGenerationsByBatchId(batchId: string): Promise<ImageGeneration[]>;
  updateImageGeneration(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | undefined>;
  getAllImageGenerations(): Promise<ImageGeneration[]>;
  getUserImageGenerations(userId: string): Promise<ImageGeneration[]>;
  getUserStats(userId: string): Promise<{ totalGenerations: number; totalCost: number; totalCreditsUsed: number }>;

  createVideoGeneration(generation: InsertImageToVideo & { userId: string }): Promise<VideoGeneration>;
  getVideoGeneration(id: string): Promise<VideoGeneration | undefined>;
  updateVideoGeneration(id: string, updates: Partial<VideoGeneration>): Promise<VideoGeneration | undefined>;
  getAllVideoGenerations(): Promise<VideoGeneration[]>;
  getUserVideoGenerations(userId: string): Promise<VideoGeneration[]>;
  getStats(): Promise<{ totalGenerations: number; totalCost: number }>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private imageGenerations: Map<string, ImageGeneration>;
  private videoGenerations: Map<string, VideoGeneration>;
  private creditTransactions: Map<string, CreditTransaction>;

  constructor() {
    this.users = new Map();
    this.imageGenerations = new Map();
    this.videoGenerations = new Map();
    this.creditTransactions = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = {
      id,
      username: insertUser.username,
      password: insertUser.password,
      email: insertUser.email,
      credits: 0,
      isAdmin: false,
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  async setUserAdmin(userId: string, isAdmin: boolean): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    const updated: User = { ...user, isAdmin };
    this.users.set(userId, updated);
    return updated;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async updateUserCredits(userId: string, credits: number): Promise<User | undefined> {
    const user = this.users.get(userId);
    if (!user) return undefined;
    const updated: User = { ...user, credits };
    this.users.set(userId, updated);
    return updated;
  }

  async createCreditTransaction(transaction: { userId: string; type: string; amount: number; balance: number; description: string | null }): Promise<CreditTransaction> {
    const id = randomUUID();
    const creditTransaction: CreditTransaction = {
      id,
      userId: transaction.userId,
      type: transaction.type,
      amount: transaction.amount,
      balance: transaction.balance,
      description: transaction.description,
      createdAt: new Date(),
    };
    this.creditTransactions.set(id, creditTransaction);
    return creditTransaction;
  }

  async getCreditTransactions(userId: string): Promise<CreditTransaction[]> {
    return Array.from(this.creditTransactions.values())
      .filter(t => t.userId === userId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createImageGeneration(insertGeneration: InsertImageGeneration & { userId: string; sequentialGeneration?: boolean; maxImages?: number | null; additionalImageUrls?: string[] }): Promise<ImageGeneration> {
    const id = randomUUID();
    const generation: ImageGeneration = {
      id,
      userId: insertGeneration.userId,
      batchId: insertGeneration.batchId ?? null,
      type: insertGeneration.type ?? "image-to-image",
      originalImageUrl: insertGeneration.originalImageUrl ?? null,
      generatedImageUrl: null,
      generatedImageUrls: [],
      prompt: insertGeneration.prompt,
      guidanceScale: insertGeneration.guidanceScale ?? 5.5,
      seed: insertGeneration.seed ?? 21,
      watermark: insertGeneration.watermark ?? true,
      size: insertGeneration.size ?? "1:1",
      status: "pending",
      errorMessage: null,
      processingTime: null,
      cost: 0.03,
      creditsUsed: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
      sequentialGeneration: insertGeneration.sequentialGeneration ?? false,
      maxImages: insertGeneration.maxImages ?? 1,
      additionalImageUrls: insertGeneration.additionalImageUrls ?? [],
    };
    this.imageGenerations.set(id, generation);
    return generation;
  }

  async createBatchImageGenerations(batchData: InsertBatchImageToImage & { userId: string }): Promise<ImageGeneration[]> {
    const batchId = randomUUID();
    const generations: ImageGeneration[] = [];

    for (const prompt of batchData.prompts) {
      const generation = await this.createImageGeneration({
        userId: batchData.userId,
        type: batchData.type,
        batchId,
        originalImageUrl: batchData.originalImageUrl,
        prompt,
        guidanceScale: batchData.guidanceScale,
        seed: batchData.seed,
        watermark: batchData.watermark,
      });
      generations.push(generation);
    }

    return generations;
  }

  async getImageGeneration(id: string): Promise<ImageGeneration | undefined> {
    return this.imageGenerations.get(id);
  }

  async getImageGenerationsByBatchId(batchId: string): Promise<ImageGeneration[]> {
    return Array.from(this.imageGenerations.values())
      .filter(generation => generation.batchId === batchId)
      .sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));
  }

  async updateImageGeneration(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | undefined> {
    const existing = this.imageGenerations.get(id);
    if (!existing) return undefined;

    const updated: ImageGeneration = {
      ...existing,
      ...updates,
      updatedAt: new Date()
    };
    this.imageGenerations.set(id, updated);
    return updated;
  }

  async getAllImageGenerations(): Promise<ImageGeneration[]> {
    return Array.from(this.imageGenerations.values()).sort(
      (a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getUserImageGenerations(userId: string): Promise<ImageGeneration[]> {
    return Array.from(this.imageGenerations.values())
      .filter(gen => gen.userId === userId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getUserStats(userId: string): Promise<{ totalGenerations: number; totalCost: number; totalCreditsUsed: number }> {
    const userImages = Array.from(this.imageGenerations.values()).filter(gen => gen.userId === userId);
    const userVideos = Array.from(this.videoGenerations.values()).filter(gen => gen.userId === userId);
    const totalGenerations = userImages.length + userVideos.length;
    const imageCost = userImages.reduce((sum, gen) => sum + (gen.cost || 0), 0);
    const videoCost = userVideos.reduce((sum, gen) => sum + (gen.cost || 0), 0);
    const imageCredits = userImages.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);
    const videoCredits = userVideos.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);
    return { totalGenerations, totalCost: imageCost + videoCost, totalCreditsUsed: imageCredits + videoCredits };
  }

  async createVideoGeneration(insertGeneration: InsertImageToVideo & { userId: string }): Promise<VideoGeneration> {
    const id = randomUUID();
    const generation: VideoGeneration = {
      id,
      userId: insertGeneration.userId,
      taskId: null,
      type: "image-to-video",
      originalImageUrl: insertGeneration.originalImageUrl,
      generatedVideoUrl: null,
      prompt: insertGeneration.prompt,
      duration: insertGeneration.duration ?? 5,
      cameraFixed: insertGeneration.cameraFixed ?? false,
      status: "pending",
      errorMessage: null,
      processingTime: null,
      cost: 0.10,
      creditsUsed: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.videoGenerations.set(id, generation);
    return generation;
  }

  async getVideoGeneration(id: string): Promise<VideoGeneration | undefined> {
    return this.videoGenerations.get(id);
  }

  async updateVideoGeneration(id: string, updates: Partial<VideoGeneration>): Promise<VideoGeneration | undefined> {
    const existing = this.videoGenerations.get(id);
    if (!existing) return undefined;

    const updated: VideoGeneration = {
      ...existing,
      ...updates,
      updatedAt: new Date()
    };
    this.videoGenerations.set(id, updated);
    return updated;
  }

  async getAllVideoGenerations(): Promise<VideoGeneration[]> {
    return Array.from(this.videoGenerations.values()).sort(
      (a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0)
    );
  }

  async getUserVideoGenerations(userId: string): Promise<VideoGeneration[]> {
    return Array.from(this.videoGenerations.values())
      .filter(gen => gen.userId === userId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getStats(): Promise<{ totalGenerations: number; totalCost: number }> {
    const allImages = Array.from(this.imageGenerations.values());
    const allVideos = Array.from(this.videoGenerations.values());
    const totalGenerations = allImages.length + allVideos.length;
    const imageCost = allImages.reduce((sum, gen) => sum + (gen.cost || 0), 0);
    const videoCost = allVideos.reduce((sum, gen) => sum + (gen.cost || 0), 0);
    return { totalGenerations, totalCost: imageCost + videoCost };
  }
}

export const storage = new MemStorage();

import { type User, type InsertUser, type ImageGeneration, type InsertImageGeneration, type InsertBatchImageToImage } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  createImageGeneration(generation: InsertImageGeneration): Promise<ImageGeneration>;
  createBatchImageGenerations(batchData: InsertBatchImageToImage): Promise<ImageGeneration[]>;
  getImageGeneration(id: string): Promise<ImageGeneration | undefined>;
  getImageGenerationsByBatchId(batchId: string): Promise<ImageGeneration[]>;
  updateImageGeneration(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | undefined>;
  getAllImageGenerations(): Promise<ImageGeneration[]>;
  getStats(): Promise<{ totalGenerations: number; totalCost: number }>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private imageGenerations: Map<string, ImageGeneration>;

  constructor() {
    this.users = new Map();
    this.imageGenerations = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async createImageGeneration(insertGeneration: InsertImageGeneration & { sequentialGeneration?: boolean; maxImages?: number }): Promise<ImageGeneration> {
    const id = randomUUID();
    const generation: ImageGeneration = {
      id,
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
      cost: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      sequentialGeneration: insertGeneration.sequentialGeneration ?? false,
      maxImages: insertGeneration.maxImages ?? 1,
    };
    this.imageGenerations.set(id, generation);
    return generation;
  }

  async createBatchImageGenerations(batchData: InsertBatchImageToImage): Promise<ImageGeneration[]> {
    const batchId = randomUUID();
    const generations: ImageGeneration[] = [];
    
    for (const prompt of batchData.prompts) {
      const generation = await this.createImageGeneration({
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

  async getStats(): Promise<{ totalGenerations: number; totalCost: number }> {
    const generations = Array.from(this.imageGenerations.values());
    const totalGenerations = generations.length;
    const totalCost = generations.reduce((sum, gen) => sum + (gen.cost || 0), 0);
    return { totalGenerations, totalCost };
  }
}

export const storage = new MemStorage();

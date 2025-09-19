import { type User, type InsertUser, type ImageGeneration, type InsertImageGeneration } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  createImageGeneration(generation: InsertImageGeneration): Promise<ImageGeneration>;
  getImageGeneration(id: string): Promise<ImageGeneration | undefined>;
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

  async createImageGeneration(insertGeneration: InsertImageGeneration): Promise<ImageGeneration> {
    const id = randomUUID();
    const generation: ImageGeneration = {
      id,
      type: insertGeneration.type ?? "image-to-image",
      originalImageUrl: insertGeneration.originalImageUrl ?? null,
      generatedImageUrl: null,
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
      updatedAt: new Date()
    };
    this.imageGenerations.set(id, generation);
    return generation;
  }

  async getImageGeneration(id: string): Promise<ImageGeneration | undefined> {
    return this.imageGenerations.get(id);
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

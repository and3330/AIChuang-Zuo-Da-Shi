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
      ...insertGeneration,
      id,
      generatedImageUrl: null,
      status: "pending",
      errorMessage: null,
      processingTime: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      seed: insertGeneration.seed ?? 21,
      guidanceScale: insertGeneration.guidanceScale ?? 5.5,
      watermark: insertGeneration.watermark ?? true
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
}

export const storage = new MemStorage();

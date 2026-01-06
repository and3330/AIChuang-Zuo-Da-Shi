import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const imageGenerations = pgTable("image_generations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: varchar("batch_id"), // For grouping related generations together
  type: text("type").notNull().default("image-to-image"), // image-to-image, text-to-image
  originalImageUrl: text("original_image_url"), // Optional for text-to-image
  generatedImageUrl: text("generated_image_url"),
  prompt: text("prompt").notNull(),
  guidanceScale: real("guidance_scale").default(5.5),
  seed: real("seed").default(21),
  watermark: boolean("watermark").default(true),
  size: text("size").default("1:1"), // For text-to-image (aspect ratio)
  status: text("status").notNull().default("pending"), // pending, processing, completed, failed
  errorMessage: text("error_message"),
  processingTime: real("processing_time"),
  cost: real("cost").default(0.03),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertImageGenerationSchema = createInsertSchema(imageGenerations).pick({
  type: true,
  batchId: true,
  originalImageUrl: true,
  prompt: true,
  guidanceScale: true,
  seed: true,
  watermark: true,
  size: true,
});

// Text-to-image specific schema
export const insertTextToImageSchema = createInsertSchema(imageGenerations).pick({
  prompt: true,
  guidanceScale: true,
  seed: true,
  watermark: true,
  size: true,
}).extend({
  type: z.literal("text-to-image"),
  sequentialGeneration: z.boolean().optional(),
  maxImages: z.number().min(2).max(10).optional().nullable(),
});

// Image-to-image specific schema  
export const insertImageToImageSchema = createInsertSchema(imageGenerations).pick({
  originalImageUrl: true,
  prompt: true,
  guidanceScale: true,
  seed: true,
  watermark: true,
  batchId: true,
  size: true,
}).extend({
  type: z.literal("image-to-image"),
  sequentialGeneration: z.boolean().optional(),
  maxImages: z.number().min(2).max(10).optional().nullable(),
  additionalImageUrls: z.array(z.string()).optional(),
});

// Batch image generation schema
export const insertBatchImageToImageSchema = z.object({
  type: z.literal("image-to-image"),
  originalImageUrl: z.string(),
  prompts: z.array(z.string()).min(2).max(10),
  guidanceScale: z.number().optional(),
  seed: z.number().optional(),
  watermark: z.boolean().optional(),
});

// Image-to-video specific schema
export const insertImageToVideoSchema = z.object({
  type: z.literal("image-to-video"),
  originalImageUrl: z.string(),
  prompt: z.string(),
  duration: z.number().min(5).max(10).optional().default(5),
  cameraFixed: z.boolean().optional().default(false),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertImageGeneration = z.infer<typeof insertImageGenerationSchema>;
export type InsertTextToImage = z.infer<typeof insertTextToImageSchema>;
export type InsertImageToImage = z.infer<typeof insertImageToImageSchema>;
export type InsertBatchImageToImage = z.infer<typeof insertBatchImageToImageSchema>;
export type InsertImageToVideo = z.infer<typeof insertImageToVideoSchema>;
export type ImageGeneration = typeof imageGenerations.$inferSelect & {
  generatedImageUrls?: string[];
  sequentialGeneration?: boolean;
  maxImages?: number;
  additionalImageUrls?: string[];
};

// Video generation type (for in-memory storage)
export type VideoGeneration = {
  id: string;
  taskId: string | null;
  type: "image-to-video";
  originalImageUrl: string;
  generatedVideoUrl: string | null;
  prompt: string;
  duration: number;
  cameraFixed: boolean;
  status: "pending" | "processing" | "completed" | "failed";
  errorMessage: string | null;
  processingTime: number | null;
  cost: number;
  createdAt: Date;
  updatedAt: Date;
};

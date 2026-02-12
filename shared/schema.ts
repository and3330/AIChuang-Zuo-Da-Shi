import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  credits: integer("credits").default(0),
  isAdmin: boolean("is_admin").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const creditTransactions = pgTable("credit_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: text("type").notNull(), // 'topup' | 'consume' | 'refund'
  amount: integer("amount").notNull(),
  balance: integer("balance").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const imageGenerations = pgTable("image_generations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  batchId: varchar("batch_id"),
  type: text("type").notNull().default("image-to-image"),
  originalImageUrl: text("original_image_url"),
  generatedImageUrl: text("generated_image_url"),
  prompt: text("prompt").notNull(),
  guidanceScale: real("guidance_scale").default(5.5),
  seed: real("seed").default(21),
  watermark: boolean("watermark").default(true),
  size: text("size").default("1:1"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  processingTime: real("processing_time"),
  cost: real("cost").default(0.03),
  creditsUsed: integer("credits_used").default(3),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const videoGenerations = pgTable("video_generations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  taskId: text("task_id"),
  type: text("type").notNull().default("image-to-video"),
  originalImageUrl: text("original_image_url").notNull(),
  generatedVideoUrl: text("generated_video_url"),
  prompt: text("prompt").notNull(),
  duration: integer("duration").default(5),
  cameraFixed: boolean("camera_fixed").default(false),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  processingTime: real("processing_time"),
  cost: real("cost").default(0.10),
  creditsUsed: integer("credits_used").default(10),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
});

export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({
  id: true,
  createdAt: true,
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

export const insertBatchImageToImageSchema = z.object({
  type: z.literal("image-to-image"),
  originalImageUrl: z.string(),
  prompts: z.array(z.string()).min(2).max(10),
  guidanceScale: z.number().optional(),
  seed: z.number().optional(),
  watermark: z.boolean().optional(),
});

export const insertImageToVideoSchema = z.object({
  type: z.literal("image-to-video"),
  originalImageUrl: z.string(),
  prompt: z.string(),
  duration: z.number().min(5).max(10).optional().default(5),
  cameraFixed: z.boolean().optional().default(false),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
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
export type VideoGeneration = typeof videoGenerations.$inferSelect & {
  generatedImageUrls?: string[];
  sequentialGeneration?: boolean;
};

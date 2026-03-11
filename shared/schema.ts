import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, real, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull().default(""),
  email: text("email").notNull().unique(),
  googleId: text("google_id").unique(),
  avatarUrl: text("avatar_url"),
  credits: integer("credits").default(0),
  isAdmin: boolean("is_admin").default(false),
  telegramChatId: text("telegram_chat_id").unique(),
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
  bunnyImageUrl: text("bunny_image_url"),
  bunnyImageUrls: text("bunny_image_urls").array(),
  prompt: text("prompt").notNull(),
  guidanceScale: real("guidance_scale").default(5.5),
  seed: real("seed").default(21),
  watermark: boolean("watermark").default(true),
  size: text("size").default("2K"),
  sequentialGeneration: boolean("sequential_generation").default(false),
  maxImages: integer("max_images").default(1),
  additionalImageUrls: text("additional_image_urls").array(),
  generatedImageUrls: text("generated_image_urls").array(),
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
  originalImageUrl: text("original_image_url"),
  additionalImageUrls: text("additional_image_urls").array(),
  generatedVideoUrl: text("generated_video_url"),
  bunnyVideoUrl: text("bunny_video_url"),
  prompt: text("prompt").notNull(),
  duration: integer("duration").default(5),
  cameraFixed: boolean("camera_fixed").default(false),
  aspectRatio: text("aspect_ratio").default("16:9"),
  resolution: text("resolution").default("1080p"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  processingTime: real("processing_time"),
  cost: real("cost").default(0.10),
  creditsUsed: integer("credits_used").default(10),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const storyGenerations = pgTable("story_generations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  style: text("style").notNull(),
  sceneCount: integer("scene_count").notNull().default(4),
  referenceImageUrls: text("reference_image_urls").array(),
  scenes: text("scenes").notNull().default("[]"),
  status: text("status").notNull().default("pending"),
  creditsUsed: integer("credits_used").default(0),
  cost: real("cost").default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const verificationCodes = pgTable("verification_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  code: text("code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  isAdmin: boolean("is_admin").default(false),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
}).extend({
  password: z.string(),
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
  size: z.string().optional(),
});

export const insertImageToVideoSchema = z.object({
  type: z.literal("image-to-video"),
  originalImageUrl: z.string(),
  additionalImageUrls: z.array(z.string()).optional(),
  prompt: z.string(),
  duration: z.number().min(2).max(12).optional().default(5),
  cameraFixed: z.boolean().optional().default(false),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9"),
  resolution: z.enum(["720p", "1080p"]).optional().default("1080p"),
});

export const insertTextToVideoSchema = z.object({
  type: z.literal("text-to-video"),
  prompt: z.string(),
  duration: z.number().min(2).max(12).optional().default(5),
  cameraFixed: z.boolean().optional().default(false),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9"),
  resolution: z.enum(["720p", "1080p"]).optional().default("1080p"),
});

export const insertStoryGenerationSchema = z.object({
  title: z.string().min(1).max(100),
  style: z.string().min(1),
  scenes: z.array(z.object({
    title: z.string(),
    description: z.string().min(1),
    sceneReferenceImageUrl: z.string().optional(),
  })).min(2).max(8),
  referenceImageUrls: z.array(z.string()).max(4).optional(),
  storyContent: z.string().optional(),
});

export const sendVerificationCodeSchema = z.object({
  email: z.string().email(),
});

export const verifyCodeSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

export const registerWithVerificationSchema = insertUserSchema.extend({
  verificationCode: z.string().length(6),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type VerificationCode = typeof verificationCodes.$inferSelect;
export type User = typeof users.$inferSelect;
export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type InsertImageGeneration = z.infer<typeof insertImageGenerationSchema>;
export type InsertTextToImage = z.infer<typeof insertTextToImageSchema>;
export type InsertImageToImage = z.infer<typeof insertImageToImageSchema>;
export type InsertBatchImageToImage = z.infer<typeof insertBatchImageToImageSchema>;
export type InsertImageToVideo = z.infer<typeof insertImageToVideoSchema>;
export type InsertTextToVideo = z.infer<typeof insertTextToVideoSchema>;
export type InsertStoryGeneration = z.infer<typeof insertStoryGenerationSchema>;
export type ImageGeneration = typeof imageGenerations.$inferSelect;
export type VideoGeneration = typeof videoGenerations.$inferSelect;
export type StoryGeneration = typeof storyGenerations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;

export type StoryScene = {
  id: string;
  title: string;
  description: string;
  sceneReferenceImageUrl?: string;
  imageUrl?: string;
  bunnyUrl?: string;
  status: "pending" | "generating" | "completed" | "failed";
};

export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6, mode: "date" }).notNull(),
});

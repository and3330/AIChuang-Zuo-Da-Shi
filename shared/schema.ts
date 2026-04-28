import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, real, integer, json, serial } from "drizzle-orm/pg-core";
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
  sceneSize: text("scene_size").default("1:1"),
  characterImageUrls: text("character_image_urls").array(),
  characterBImageUrls: text("character_b_image_urls").array(),
  sceneRefImageUrls: text("scene_ref_image_urls").array(),
  styleImageUrls: text("style_image_urls").array(),
  globalSeed: integer("global_seed"),
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
    dialogue: z.string().optional(),
    sceneReferenceImageUrl: z.string().optional(),
  })).min(2).max(12),
  referenceImageUrls: z.array(z.string()).max(4).optional(),
  storyContent: z.string().optional(),
  sceneSize: z.enum(["1:1", "9:16", "16:9"]).optional().default("1:1"),
  characterImageUrls: z.array(z.string()).max(2).optional(),
  characterBImageUrls: z.array(z.string()).max(2).optional(),
  sceneRefImageUrls: z.array(z.string()).max(3).optional(),
  styleImageUrls: z.array(z.string()).max(3).optional(),
  globalSeed: z.number().int().min(1000).max(999999).optional(),
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
  dialogue?: string;
  sceneReferenceImageUrl?: string;
  imageUrl?: string;
  bunnyUrl?: string;
  status: "pending" | "generating" | "completed" | "failed";
};

export type DramaScene = {
  id: string;
  sceneNumber: number;
  title: string;
  description: string;
  dialogue?: string;
  cameraMovement?: string;
  useCharA: boolean;
  useCharB: boolean;
  sceneRefImageUrl?: string;
  // Image
  imageUrl?: string;
  bunnyUrl?: string;
  imageStatus: "pending" | "generating" | "completed" | "failed";
  imageError?: string;
  // Video
  videoUrl?: string;
  videoBunnyUrl?: string;
  videoStatus?: "pending" | "generating" | "completed" | "failed";
  videoError?: string;
  videoDuration?: number;
  videoResolution?: "720p" | "1080p";
};

// ─── Drama Studio ─────────────────────────────────────────────────────────────

export const dramaProjects = pgTable("drama_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  genre: text("genre").default(""),
  description: text("description").default(""),
  characterAName: text("character_a_name").default("角色A"),
  characterAUrls: text("character_a_urls").array().default([]),
  characterBName: text("character_b_name").default("角色B"),
  characterBUrls: text("character_b_urls").array().default([]),
  styleImageUrls: text("style_image_urls").array().default([]),
  sceneSize: text("scene_size").default("9:16"),
  episodeCount: integer("episode_count").default(0),
  status: text("status").default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const dramaEpisodes = pgTable("drama_episodes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull(),
  userId: varchar("user_id").notNull(),
  episodeNumber: integer("episode_number").notNull(),
  title: text("title").notNull(),
  scenes: text("scenes").notNull().default("[]"),
  sceneCount: integer("scene_count").default(0),
  globalSeed: integer("global_seed"),
  status: text("status").default("draft"),
  creditsUsed: integer("credits_used").default(0),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const session = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6, mode: "date" }).notNull(),
});

// ─── Drama Studio Schemas & Types ─────────────────────────────────────────────

export const insertDramaProjectSchema = z.object({
  title: z.string().min(1).max(60),
  genre: z.string().optional().default(""),
  description: z.string().optional().default(""),
  characterAName: z.string().optional().default("角色A"),
  characterAUrls: z.array(z.string()).max(4).optional().default([]),
  characterBName: z.string().optional().default("角色B"),
  characterBUrls: z.array(z.string()).max(4).optional().default([]),
  styleImageUrls: z.array(z.string()).max(4).optional().default([]),
  sceneSize: z.enum(["1:1", "9:16", "16:9"]).optional().default("9:16"),
});

export const updateDramaProjectSchema = insertDramaProjectSchema.partial();

export const insertDramaEpisodeSchema = z.object({
  projectId: z.string(),
  episodeNumber: z.number().int().min(1),
  title: z.string().min(1).max(60),
  scenes: z.array(z.object({
    id: z.string(),
    sceneNumber: z.number(),
    title: z.string(),
    description: z.string().min(1),
    dialogue: z.string().optional(),
    cameraMovement: z.string().optional(),
    useCharA: z.boolean().default(true),
    useCharB: z.boolean().default(true),
    sceneRefImageUrl: z.string().optional(),
    imageStatus: z.enum(["pending", "generating", "completed", "failed"]).default("pending"),
    videoStatus: z.enum(["pending", "generating", "completed", "failed"]).optional(),
    videoDuration: z.number().optional().default(5),
    videoResolution: z.enum(["720p", "1080p"]).optional().default("720p"),
  })).min(2).max(12),
  globalSeed: z.number().int().min(1000).max(999999).optional(),
});

export const updateDramaEpisodeSchema = insertDramaEpisodeSchema.partial().omit({ projectId: true });

export type DramaProject = typeof dramaProjects.$inferSelect;
export type DramaEpisode = typeof dramaEpisodes.$inferSelect;
export type InsertDramaProject = z.infer<typeof insertDramaProjectSchema>;
export type InsertDramaEpisode = z.infer<typeof insertDramaEpisodeSchema>;

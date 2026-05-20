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
  /** Generation backend: "byteplus" (default, BytePlus ARK Seedream 5.0) or
   *  "gmi" (GMI Cloud, model selected via the `model` column). */
  provider: text("provider").default("byteplus"),
  /** Provider-specific model id, e.g. "Z-Image" / "wan2.7-image" /
   *  "flux-kontext-pro". Null = provider default. */
  model: text("model"),
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
  /** Optional reference audio (object-storage path or HTTP URL). When set,
   *  the request is routed through the SeedDance 2.0 omni endpoint with a
   *  role:"reference_audio" content part. */
  referenceAudioUrl: text("reference_audio_url"),
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
  /** Provider routing: "byteplus" (SeedDance, default) or "gmi" (Wan 2.x i2v
   *  via GMI Cloud). Drives the processVideoGeneration branch and pricing. */
  provider: text("provider").default("byteplus"),
  /** Provider-specific model id, e.g. "wan2.7-i2v" for GMI. NULL/empty for
   *  default SeedDance which uses the global VIDEO_MODEL endpoint. */
  model: text("model"),
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
  // Provider routing: "byteplus" (default, BytePlus ARK Seedream 5.0) or
  // "gmi" (GMI Cloud). When "gmi", `model` must be a registered GMI model id.
  provider: z.enum(["byteplus", "gmi"]).optional(),
  model: z.string().max(64).optional(),
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
  provider: z.enum(["byteplus", "gmi"]).optional(),
  model: z.string().max(64).optional(),
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
  additionalImageUrls: z.array(z.string()).max(3).optional(),
  referenceAudioUrl: z.string().optional(),
  prompt: z.string(),
  duration: z.number().min(2).max(12).optional().default(5),
  cameraFixed: z.boolean().optional().default(false),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9"),
  resolution: z.enum(["720p", "1080p"]).optional().default("1080p"),
  /** "byteplus" (SeedDance 2.0, default) or "gmi" (Wan 2.x via GMI Cloud).
   *  GMI route only supports image-to-video and the model id whitelist in
   *  server/gmiProvider.ts; mis-routed requests are rejected with 400.
   *  Kept truly optional (no .default) so internal callers — drama studio,
   *  story animator — don't have to specify it. The route handler defaults
   *  to "byteplus" when absent. */
  provider: z.enum(["byteplus", "gmi"]).optional(),
  model: z.string().optional(),
});

export const insertTextToVideoSchema = z.object({
  type: z.literal("text-to-video"),
  prompt: z.string(),
  /** Optional reference audio (object-storage path or HTTP URL). When set,
   *  text-to-video also routes through the SeedDance 2.0 omni endpoint with
   *  generate_audio=true so the supplied audio drives the soundtrack. */
  referenceAudioUrl: z.string().optional(),
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
  /** Optional global library refs (cross-episode reuse) */
  characterIds?: string[];
  sceneLocationId?: string;
  // Image (single key frame, used in legacy single-frame mode)
  imageUrl?: string;
  bunnyUrl?: string;
  imageStatus: "pending" | "generating" | "completed" | "failed";
  imageError?: string;
  // First / Last frame mode (AIComicBuilder-style 首尾幀插值)
  useFirstLastFrame?: boolean;
  firstFrameUrl?: string;
  firstFrameBunnyUrl?: string;
  firstFrameStatus?: "pending" | "generating" | "completed" | "failed";
  lastFrameUrl?: string;
  lastFrameBunnyUrl?: string;
  lastFrameStatus?: "pending" | "generating" | "completed" | "failed";
  /** AI-generated professional video prompt (overrides description if present) */
  videoPrompt?: string;
  /** Per-scene chain-mode override. "inherit" follows the episode-level toggle. */
  chainModeOverride?: "on" | "off" | "inherit";
  /** Per-scene override for which image is fed in as the continuity reference.
   *  "auto" (default) = previous scene's last frame → main image fallback chain.
   *  "prevLast" / "prevFirst" / "prevMain" = explicitly pick a frame of the
   *  previous scene. "custom" = user-uploaded `chainRefCustomUrl`. */
  chainRefSource?: "auto" | "prevLast" | "prevFirst" | "prevMain" | "custom";
  /** Optional user-uploaded continuity reference image (object-storage path
   *  or CDN URL). When set, takes priority over `chainRefSource`. */
  chainRefCustomUrl?: string;
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
  /** Episode-level Chain Mode toggle: when on, scene N+1 receives scene N's
   *  last frame (or main image fallback) as a Seedream reference, and Claude
   *  video-prompt rewriting uses prev/next scenes as narrative context. */
  chainMode: boolean("chain_mode").default(false),
  /** When true, the in-flight chain regen-all background loop should stop
   *  after the current scene finishes; remaining un-started scenes get their
   *  pre-deducted credits refunded. Reset to false at the start of every new
   *  regenerate-all-chain run. */
  chainRegenCancelRequested: boolean("chain_regen_cancel_requested").default(false),
  /** True while an /animate-all batch background loop is actively running on
   *  this episode. Used as the authoritative signal for both the cancel
   *  endpoint and the UI's progress badge — distinguishes a real batch from
   *  multiple ad-hoc per-scene animate calls (which can also leave several
   *  scenes in videoStatus=generating concurrently). Set true when the batch
   *  is dispatched, cleared when the loop ends (or is cancelled). */
  animateAllInProgress: boolean("animate_all_in_progress").default(false),
  /** When true, the in-flight animate-all batch loop should stop after the
   *  current scene's video finishes; remaining un-started scenes get their
   *  pre-deducted credits refunded. Reset to false at the start of every new
   *  animate-all run, and only meaningful when animateAllInProgress is true. */
  animateAllCancelRequested: boolean("animate_all_cancel_requested").default(false),
  // Final compiled video (all scenes stitched + subtitles burned in)
  compiledVideoUrl: text("compiled_video_url"),
  compiledStatus: text("compiled_status").default("idle"), // idle | compiling | completed | failed
  compiledError: text("compiled_error"),
  compiledAt: timestamp("compiled_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Global Asset Libraries (cross-episode/project reuse) ────────────────────

export const characterLibrary = pgTable("character_library", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").default(""),
  /** Reference image URLs uploaded by user (Bunny CDN) */
  refImageUrls: text("ref_image_urls").array().default([]),
  /** Generated 4-view URLs: { front, threeQuarter, side, back } */
  fourViewUrls: json("four_view_urls"),
  fourViewStatus: text("four_view_status").default("idle"), // idle | generating | completed | failed
  fourViewError: text("four_view_error"),
  styleHint: text("style_hint").default(""), // e.g. "anime", "realistic"
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const sceneLibrary = pgTable("scene_library", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").default(""),
  refImageUrls: text("ref_image_urls").array().default([]),
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
    chainModeOverride: z.enum(["on", "off", "inherit"]).optional(),
    chainRefSource: z.enum(["auto", "prevLast", "prevFirst", "prevMain", "custom"]).optional(),
    chainRefCustomUrl: z.string().optional(),
  })).min(2).max(12),
  globalSeed: z.number().int().min(1000).max(999999).optional(),
  chainMode: z.boolean().optional(),
});

export const updateDramaEpisodeSchema = insertDramaEpisodeSchema.partial().omit({ projectId: true });

export type DramaProject = typeof dramaProjects.$inferSelect;
export type DramaEpisode = typeof dramaEpisodes.$inferSelect;
export type InsertDramaProject = z.infer<typeof insertDramaProjectSchema>;
export type InsertDramaEpisode = z.infer<typeof insertDramaEpisodeSchema>;

// ─── Asset Library Schemas ────────────────────────────────────────────────────

export const insertCharacterLibrarySchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().optional().default(""),
  refImageUrls: z.array(z.string()).max(6).optional().default([]),
  styleHint: z.string().optional().default(""),
});

export const updateCharacterLibrarySchema = insertCharacterLibrarySchema.partial();

export const insertSceneLibrarySchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().optional().default(""),
  refImageUrls: z.array(z.string()).max(6).optional().default([]),
});

export const updateSceneLibrarySchema = insertSceneLibrarySchema.partial();

export type CharacterLibraryItem = typeof characterLibrary.$inferSelect;
export type SceneLibraryItem = typeof sceneLibrary.$inferSelect;
export type InsertCharacterLibrary = z.infer<typeof insertCharacterLibrarySchema>;
export type InsertSceneLibrary = z.infer<typeof insertSceneLibrarySchema>;
export type FourViewUrls = {
  front?: string;
  threeQuarter?: string;
  side?: string;
  back?: string;
};

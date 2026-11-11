import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, real, integer, json, serial, uniqueIndex, index } from "drizzle-orm/pg-core";
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
  /** One-time membership (see MEMBERSHIP in shared/pricing.ts). Members can buy credits. */
  isMember: boolean("is_member").default(false),
  memberSince: timestamp("member_since"),
  /** Second tier (see GOLD_MEMBERSHIP in shared/pricing.ts): opens the gold zone. */
  isGold: boolean("is_gold").default(false),
  goldSince: timestamp("gold_since"),
  /** When the one-time 小試身手 pack (TRIAL in shared/pricing.ts) was bought. */
  trialUsedAt: timestamp("trial_used_at"),
  /** When the one free 四視圖 generation (first character) was used. */
  freeFourViewUsedAt: timestamp("free_four_view_used_at"),
  /** Shown on the creator's public page (作品牆). */
  bio: text("bio"),
  /** "YYYY-MM-DD". Set once in 安全與隱私; needed before the gold tier can be bought. */
  birthDate: text("birth_date"),
  /** The user confirmed being 18+ and accepted the gold-zone terms. */
  nsfwEnabled: boolean("nsfw_enabled").default(false),
  /** When the user accepted GOLD_TERMS_OF_USE. */
  nsfwConsentAt: timestamp("nsfw_consent_at"),
  /** Given when applying for the gold tier. Never shown publicly. */
  realName: text("real_name"),
  /** When the account e-mail was confirmed with a code for the gold tier. */
  emailVerifiedAt: timestamp("email_verified_at"),
  /** When the first-login tour was finished or skipped. */
  onboardedAt: timestamp("onboarded_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const creditTransactions = pgTable("credit_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: text("type").notNull(), // 'topup' | 'consume' | 'refund'
  amount: integer("amount").notNull(),
  balance: integer("balance").notNull(),
  description: text("description"),
  /** What Stripe collected for this row, in the currency's smallest unit (cents). Only on paid orders. */
  paidAmount: integer("paid_amount"),
  /** "twd" | "usd" */
  paidCurrency: text("paid_currency"),
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
  /** Made in the gold zone: the UI blurs the result until the user asks to see it. */
  sensitive: boolean("sensitive").default(false),
  /** Generation backend. New rows are always "atlas" (AtlasCloud Seedream
   *  5.5); "byteplus" / "gmi" only appear on historical rows. */
  provider: text("provider").default("byteplus"),
  /** Provider-specific model id, e.g. "bytedance/seedream-v5.5/edit". */
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
   *  the request WAS routed through the old SeedDance omni endpoint with a
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
  /** Backend. New rows are always "atlas" (AtlasCloud WAN 3.0); "byteplus" /
   *  "gmi" only appear on historical rows. */
  provider: text("provider").default("byteplus"),
  /** Provider-specific model id, e.g. "alibaba/wan-3.0/image-to-video". */
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
  // Legacy fields from old clients — accepted but ignored. All image
  // generation runs on AtlasCloud Seedream 5.5.
  provider: z.enum(["byteplus", "gmi", "atlas"]).optional(),
  model: z.string().max(80).optional(),
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
  provider: z.enum(["byteplus", "gmi", "atlas"]).optional(),
  model: z.string().max(80).optional(),
});

export const insertBatchImageToImageSchema = z.object({
  type: z.literal("image-to-image"),
  originalImageUrl: z.string(),
  prompts: z.array(z.string()).min(2).max(10),
  /** Extra reference images shared by every prompt (e.g. character refs).
   *  With originalImageUrl that is at most 10 images for the edit model. */
  additionalImageUrls: z.array(z.string()).max(9).optional(),
  /** Optional reference image for ONE prompt only (same index as `prompts`,
   *  null = none), appended after the shared references — e.g. a pose
   *  reference that differs per shot. */
  promptImageUrls: z.array(z.string().nullable()).max(10).optional(),
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
  duration: z.number().min(4).max(12).optional().default(5),
  cameraFixed: z.boolean().optional().default(false),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]).optional().default("16:9"),
  resolution: z.enum(["720p", "1080p"]).optional().default("1080p"),
  /** Which model runs the job: see VIDEO_MODELS in shared/pricing.ts. */
  videoModel: z.enum(["wan", "kling"]).optional().default("wan"),
  /** Legacy fields from old clients — accepted but ignored (videoModel picks the model). */
  provider: z.enum(["byteplus", "gmi", "atlas"]).optional(),
  model: z.string().optional(),
});

export const insertTextToVideoSchema = z.object({
  type: z.literal("text-to-video"),
  prompt: z.string(),
  /** Optional reference audio (object-storage path or HTTP URL). When set,
   *  text-to-video USED to route through the old SeedDance omni endpoint with
   *  generate_audio=true so the supplied audio drives the soundtrack. */
  referenceAudioUrl: z.string().optional(),
  duration: z.number().min(4).max(12).optional().default(5),
  cameraFixed: z.boolean().optional().default(false),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]).optional().default("16:9"),
  resolution: z.enum(["720p", "1080p"]).optional().default("1080p"),
  /** Which model runs the job: see VIDEO_MODELS in shared/pricing.ts. */
  videoModel: z.enum(["wan", "kling"]).optional().default("wan"),
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
export type InsertImageToVideo = Omit<z.infer<typeof insertImageToVideoSchema>, "videoModel"> & { videoModel?: "wan" | "kling" };
export type InsertTextToVideo = Omit<z.infer<typeof insertTextToVideoSchema>, "videoModel"> & { videoModel?: "wan" | "kling" };
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
  /** Character image pack: object-storage paths of uploads and Bunny CDN
   *  URLs of generated images. */
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

/** Max images in one character's reference pack. */
export const CHARACTER_PACK_MAX_IMAGES = 30;

export const insertCharacterLibrarySchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().optional().default(""),
  /** The character's image pack: uploads plus generated sheet images. The
   *  image model uses the first 10 as references, so order matters. */
  refImageUrls: z.array(z.string()).max(CHARACTER_PACK_MAX_IMAGES).optional().default([]),
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

// ─── Partner (server-to-server) API ──────────────────────────────────────────
// Used by /api/v1/partner/*. These are NEW tables; no existing table changes,
// so the website keeps working even before `npm run db:push` has been run
// (only the partner API needs them).

/** Service tokens. Only the SHA-256 of a token is stored. */
export const partnerTokens = pgTable("partner_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  /** The account whose credits are charged and that owns the generations. */
  userId: varchar("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  /** First characters of the token, for recognising it in the admin list. */
  tokenPrefix: text("token_prefix").notNull(),
  /** When false (default) requests can never use the NSFW prompt enhancer. */
  allowNsfw: boolean("allow_nsfw").notNull().default(false),
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
  /** null = no daily cap for this token's account. */
  dailyImageLimit: integer("daily_image_limit"),
  dailyVideoLimit: integer("daily_video_limit"),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
});

/** One row per partner request; status is derived from its generations. */
export const partnerJobs = pgTable("partner_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenId: varchar("token_id").notNull(),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(), // image | video | photoset | four_views
  /** 客戶小鎮的工作區代號。有值時，查詢這個任務必須帶同一個 owner_ref。 */
  ownerRef: text("owner_ref"),
  /** 這個任務使用（或產生四視圖）的對外角色。 */
  characterIds: text("character_ids").array().default([]),
  /** queued | planning | running | failed (failed = failed before/without generations) */
  phase: text("phase").notNull().default("queued"),
  /** ids in image_generations (image, photoset) or video_generations (video) */
  generationIds: text("generation_ids").array().default([]),
  requestedCount: integer("requested_count").notNull().default(1),
  creditsCharged: integer("credits_charged").notNull().default(0),
  /** Refunds made by the partner layer itself (e.g. planning failed). */
  creditsRefundedExtra: integer("credits_refunded_extra").notNull().default(0),
  externalRef: text("external_ref"),
  idempotencyKey: text("idempotency_key"),
  requestHash: text("request_hash"),
  error: text("error"),
  errorCode: text("error_code"),
  /** { width, height, nsfw } — presentation details for results. */
  meta: json("meta"),
  createdAt: timestamp("created_at").defaultNow(),
  finishedAt: timestamp("finished_at"),
}, (t) => ({
  idempotencyUnique: uniqueIndex("partner_jobs_token_idem_key").on(t.tokenId, t.idempotencyKey),
  userIdx: index("partner_jobs_user_idx").on(t.userId),
}));

/**
 * AI characters created through the partner API. Every character belongs to
 * exactly one owner_ref (a partner-side workspace); all access is filtered by
 * (userId, ownerRef), so workspaces sharing one service account stay apart.
 */
export const partnerCharacters = pgTable("partner_characters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** The service account the token is bound to. */
  userId: varchar("user_id").notNull(),
  /** The token that created it (for audit only; access is by userId + ownerRef). */
  tokenId: varchar("token_id"),
  ownerRef: text("owner_ref").notNull(),
  name: text("name").notNull(),
  description: text("description").default(""),
  styleHint: text("style_hint").default(""),
  /** CDN URLs only. */
  refImageUrls: text("ref_image_urls").array().default([]),
  /** { front, threeQuarter, side, back } */
  fourViewUrls: json("four_view_urls"),
  fourViewStatus: text("four_view_status").default("idle"), // idle | generating | completed | failed
  /** The partner job currently drawing the four views, if any. */
  fourViewJobId: varchar("four_view_job_id"),
  /** When the partner confirmed likeness consent (consent: true). */
  consentAt: timestamp("consent_at").notNull(),
  /** Set by an admin; a disabled character cannot be used to generate. */
  disabledAt: timestamp("disabled_at"),
  disabledBy: varchar("disabled_by"),
  disabledReason: text("disabled_reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  ownerIdx: index("partner_characters_owner_idx").on(t.userId, t.ownerRef),
}));

/**
 * A partner workspace opening this site's own UI ("embed mode"). Each owner_ref
 * gets its own sub-account, so everything it makes stays apart from other
 * workspaces. `budget` credits are moved from the service account to the
 * sub-account when the session is created and whatever is left is moved back
 * when it is settled.
 */
export const partnerEmbedSessions = pgTable("partner_embed_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tokenId: varchar("token_id").notNull(),
  ownerRef: text("owner_ref").notNull(),
  /** The sub-account the browser is signed in as. */
  userId: varchar("user_id").notNull(),
  /** SHA-256 of the one-time entry ticket. */
  ticketHash: text("ticket_hash").notNull().unique(),
  budget: integer("budget").notNull(),
  /** Set when settled: budget minus what was left. */
  spent: integer("spent"),
  /** Origin that may receive the picked results (window.postMessage target). */
  returnOrigin: text("return_origin").notNull(),
  /** open | settling | settled */
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow(),
  redeemedAt: timestamp("redeemed_at"),
  settledAt: timestamp("settled_at"),
}, (t) => ({
  ownerIdx: index("partner_embed_sessions_owner_idx").on(t.tokenId, t.ownerRef),
}));

/** One row per successful provider generation, with an estimated cost (後台「成本」). */
export const providerCosts = pgTable("provider_costs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull().default("atlascloud"),
  model: text("model").notNull(),
  kind: text("kind").notNull(), // image | video | library
  /** Images, or seconds of video. */
  units: real("units").notNull().default(1),
  unit: text("unit").notNull().default("image"),
  inputImages: integer("input_images").notNull().default(0),
  /** e.g. the video resolution. */
  detail: text("detail"),
  /** Estimate from the price table in server/costs.ts. */
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  createdIdx: index("provider_costs_created_idx").on(t.createdAt),
}));

// ─── Asset library (素材圖庫) ────────────────────────────────────────────────
// One row per catalog entry (shared/libraryCatalog.ts). NEW table; nothing
// existing changes. Preview images live on the CDN.
export const libraryAssets = pgTable("library_assets", {
  /** Stable catalog id, e.g. "pose:stand-relaxed:front". */
  id: varchar("id").primaryKey(),
  library: text("library").notNull(), // pose | costume | portrait
  category: text("category").notNull(),
  name: text("name").notNull(),
  /** Prompt used to draw the preview image. */
  prompt: text("prompt").notNull(),
  /** Text to use when a generator applies this asset. */
  usage: text("usage").notNull().default(""),
  tags: text("tags").array().default([]),
  adult: boolean("adult").notNull().default(false),
  size: text("size").notNull().default("1024x1536"),
  transparent: boolean("transparent").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  /** pending | generating | ready | failed */
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  imageUrl: text("image_url"),
  thumbUrl: text("thumb_url"),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => ({
  libraryIdx: index("library_assets_library_idx").on(t.library, t.status, t.sortOrder),
}));

export type LibraryAsset = typeof libraryAssets.$inferSelect;
export type PartnerToken = typeof partnerTokens.$inferSelect;
export type PartnerJob = typeof partnerJobs.$inferSelect;
export type PartnerCharacter = typeof partnerCharacters.$inferSelect;
export type PartnerEmbedSession = typeof partnerEmbedSessions.$inferSelect;

// ─── 作品牆 (showcase): works published by their makers, plus likes, comments, follows ───

export const showcasePosts = pgTable("showcase_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  /** image | video */
  kind: text("kind").notNull().default("image"),
  /** The image_generations / video_generations row it came from. */
  generationId: varchar("generation_id").notNull(),
  /** Permanent CDN url. One post per picture. */
  mediaUrl: text("media_url").notNull().unique(),
  title: text("title").notNull().default(""),
  prompt: text("prompt").notNull().default(""),
  /** When false the prompt is never sent to anyone but admins. */
  showPrompt: boolean("show_prompt").notNull().default(true),
  /** pending (waiting for review) | approved (on the wall) | rejected */
  status: text("status").notNull().default("pending"),
  rejectReason: text("reject_reason"),
  likeCount: integer("like_count").notNull().default(0),
  commentCount: integer("comment_count").notNull().default(0),
  reportCount: integer("report_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
}, (t) => ({
  wallIdx: index("showcase_posts_wall_idx").on(t.status, t.createdAt),
  userIdx: index("showcase_posts_user_idx").on(t.userId),
}));

export const showcaseLikes = pgTable("showcase_likes", {
  postId: varchar("post_id").notNull(),
  userId: varchar("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  once: uniqueIndex("showcase_likes_once").on(t.postId, t.userId),
}));

export const showcaseComments = pgTable("showcase_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull(),
  userId: varchar("user_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  postIdx: index("showcase_comments_post_idx").on(t.postId, t.createdAt),
}));

export const showcaseReports = pgTable("showcase_reports", {
  postId: varchar("post_id").notNull(),
  userId: varchar("user_id").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  once: uniqueIndex("showcase_reports_once").on(t.postId, t.userId),
}));

export const userFollows = pgTable("user_follows", {
  followerId: varchar("follower_id").notNull(),
  followingId: varchar("following_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => ({
  once: uniqueIndex("user_follows_once").on(t.followerId, t.followingId),
  followingIdx: index("user_follows_following_idx").on(t.followingId),
}));

export type ShowcasePost = typeof showcasePosts.$inferSelect;

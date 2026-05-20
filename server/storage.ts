import { type User, type InsertUser, type ImageGeneration, type InsertImageGeneration, type InsertBatchImageToImage, type VideoGeneration, type InsertImageToVideo, type InsertTextToVideo, type CreditTransaction, type VerificationCode, type ChatMessage, type StoryGeneration, type InsertStoryGeneration, type StoryScene, type DramaProject, type DramaEpisode, type InsertDramaProject, type InsertDramaEpisode, type CharacterLibraryItem, type SceneLibraryItem, type InsertCharacterLibrary, type InsertSceneLibrary, users, creditTransactions, imageGenerations, videoGenerations, verificationCodes, chatMessages, storyGenerations, dramaProjects, dramaEpisodes, characterLibrary, sceneLibrary } from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, gt, gte, like } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserGoogleId(userId: string, googleId: string, avatarUrl?: string): Promise<User | undefined>;
  updateUserCredits(userId: string, credits: number): Promise<User | undefined>;
  setUserAdmin(userId: string, isAdmin: boolean): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;

  createCreditTransaction(transaction: { userId: string; type: string; amount: number; balance: number; description: string | null }): Promise<CreditTransaction>;
  getCreditTransactions(userId: string): Promise<CreditTransaction[]>;
  getCreditTransactionByDescription(description: string): Promise<CreditTransaction | undefined>;
  getAllTopupTransactions(): Promise<(CreditTransaction & { username?: string; email?: string })[]>;

  createImageGeneration(generation: InsertImageGeneration & { userId: string; sequentialGeneration?: boolean; maxImages?: number | null; additionalImageUrls?: string[] }): Promise<ImageGeneration>;
  createBatchImageGenerations(batchData: InsertBatchImageToImage & { userId: string }): Promise<ImageGeneration[]>;
  getImageGeneration(id: string): Promise<ImageGeneration | undefined>;
  getImageGenerationsByBatchId(batchId: string): Promise<ImageGeneration[]>;
  updateImageGeneration(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | undefined>;
  getAllImageGenerations(): Promise<ImageGeneration[]>;
  getUserImageGenerations(userId: string): Promise<ImageGeneration[]>;
  getUserStats(userId: string): Promise<{ totalGenerations: number; totalCost: number; totalCreditsUsed: number }>;
  /** Daily generation counters for rate limiting. Counts rows whose
   *  createdAt >= start of UTC day. Used by the per-user 50 imgs / 10
   *  videos daily cap (admins bypassed). */
  getUserDailyImageCount(userId: string): Promise<number>;
  getUserDailyVideoCount(userId: string): Promise<number>;

  createVideoGeneration(generation: (InsertImageToVideo | InsertTextToVideo) & { userId: string }): Promise<VideoGeneration>;
  getVideoGeneration(id: string): Promise<VideoGeneration | undefined>;
  updateVideoGeneration(id: string, updates: Partial<VideoGeneration>): Promise<VideoGeneration | undefined>;
  getAllVideoGenerations(): Promise<VideoGeneration[]>;
  getUserVideoGenerations(userId: string): Promise<VideoGeneration[]>;
  getStats(): Promise<{ totalGenerations: number; totalCost: number }>;
  atomicAddCredits(userId: string, amount: number, description: string): Promise<void>;
  atomicDeductCredits(userId: string, amount: number, description: string): Promise<{ newBalance: number }>;
  claimCharacterFourViewGeneration(id: string, userId: string): Promise<{ ok: boolean; previousStatus?: string | null }>;
  releaseCharacterFourViewGeneration(id: string, restoreStatus: string | null): Promise<void>;
  claimSceneFrameGeneration(episodeId: string, sceneIdx: number, userId: string): Promise<{ ok: boolean; reason?: "not_found" | "in_flight" | "out_of_range"; previousFirstStatus?: string | null; previousLastStatus?: string | null }>;
  releaseSceneFrameGeneration(episodeId: string, sceneIdx: number, restoreFirst: string | null, restoreLast: string | null): Promise<void>;
  fixStripeTransactionTypes(): Promise<number>;

  createVerificationCode(email: string, code: string, expiresAt: Date): Promise<VerificationCode>;
  getValidVerificationCode(email: string, code: string): Promise<VerificationCode | undefined>;
  getRecentVerificationCode(email: string): Promise<VerificationCode | undefined>;
  markVerificationCodeUsed(id: string): Promise<void>;
  deleteExpiredVerificationCodes(): Promise<void>;

  getUserByTelegramChatId(chatId: string): Promise<User | undefined>;
  bindTelegramChatId(userId: string, chatId: string): Promise<User | undefined>;

  createChatMessage(userId: string, message: string, isAdmin: boolean): Promise<ChatMessage>;
  getChatMessages(userId: string): Promise<ChatMessage[]>;
  getChatsOverview(): Promise<{ userId: string; username: string; email: string; lastMessage: string; lastMessageAt: Date | null; unreadCount: number }[]>;
  markChatMessagesRead(userId: string): Promise<void>;
  getUnreadCount(userId: string): Promise<number>;

  createStoryGeneration(data: InsertStoryGeneration & { userId: string; creditsUsed: number }): Promise<StoryGeneration>;
  getStoryGeneration(id: string): Promise<StoryGeneration | undefined>;
  updateStoryGeneration(id: string, updates: Partial<StoryGeneration>): Promise<StoryGeneration | undefined>;
  getUserStoryGenerations(userId: string): Promise<StoryGeneration[]>;
  getAllStoryGenerations(): Promise<StoryGeneration[]>;
  failStoryGenerationAndRefund(id: string, errorMessage: string): Promise<boolean>;

  // Drama Studio
  createDramaProject(data: InsertDramaProject & { userId: string }): Promise<DramaProject>;
  getDramaProject(id: string): Promise<DramaProject | undefined>;
  updateDramaProject(id: string, updates: Partial<DramaProject>): Promise<DramaProject | undefined>;
  deleteDramaProject(id: string): Promise<void>;
  getUserDramaProjects(userId: string): Promise<DramaProject[]>;
  createDramaEpisode(data: { projectId: string; userId: string; episodeNumber: number; title: string; scenes: string; sceneCount: number; globalSeed?: number }): Promise<DramaEpisode>;
  getDramaEpisode(id: string): Promise<DramaEpisode | undefined>;
  updateDramaEpisode(id: string, updates: Partial<DramaEpisode>): Promise<DramaEpisode | undefined>;
  deleteDramaEpisode(id: string): Promise<void>;
  getDramaEpisodesByProject(projectId: string): Promise<DramaEpisode[]>;
  getAllDramaEpisodes(): Promise<DramaEpisode[]>;

  // Character & Scene Library (global, cross-episode reuse)
  createCharacter(data: InsertCharacterLibrary & { userId: string }): Promise<CharacterLibraryItem>;
  getCharacter(id: string): Promise<CharacterLibraryItem | undefined>;
  getUserCharacters(userId: string): Promise<CharacterLibraryItem[]>;
  updateCharacter(id: string, updates: Partial<CharacterLibraryItem>): Promise<CharacterLibraryItem | undefined>;
  deleteCharacter(id: string): Promise<void>;

  createSceneLibraryItem(data: InsertSceneLibrary & { userId: string }): Promise<SceneLibraryItem>;
  getSceneLibraryItem(id: string): Promise<SceneLibraryItem | undefined>;
  getUserSceneLibrary(userId: string): Promise<SceneLibraryItem[]>;
  updateSceneLibraryItem(id: string, updates: Partial<SceneLibraryItem>): Promise<SceneLibraryItem | undefined>;
  deleteSceneLibraryItem(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user;
  }

  async getUserByTelegramChatId(chatId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.telegramChatId, chatId));
    return user;
  }

  async bindTelegramChatId(userId: string, chatId: string): Promise<User | undefined> {
    const [user] = await db.update(users).set({ telegramChatId: chatId }).where(eq(users.id, userId)).returning();
    return user;
  }

  async updateUserGoogleId(userId: string, googleId: string, avatarUrl?: string): Promise<User | undefined> {
    const updates: any = { googleId };
    if (avatarUrl) updates.avatarUrl = avatarUrl;
    const [user] = await db.update(users).set(updates).where(eq(users.id, userId)).returning();
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values({
      username: insertUser.username,
      password: insertUser.password,
      email: insertUser.email,
      credits: 0,
      isAdmin: false,
    }).returning();
    return user;
  }

  async updateUserCredits(userId: string, credits: number): Promise<User | undefined> {
    const [user] = await db.update(users).set({ credits }).where(eq(users.id, userId)).returning();
    return user;
  }

  async atomicAddCredits(userId: string, amount: number, description: string): Promise<void> {
    const isStripePayment = description.startsWith("Stripe");
    const [updated] = await db.update(users)
      .set({ credits: sql`${users.credits} + ${amount}` })
      .where(eq(users.id, userId))
      .returning();
    if (updated) {
      await db.insert(creditTransactions).values({
        userId,
        type: isStripePayment ? "topup" : (amount > 0 ? "refund" : "consume"),
        amount,
        balance: updated.credits || 0,
        description,
      });
    }
  }

  /**
   * Atomically deduct credits with a row-level guard so concurrent requests can
   * never over-deduct or push the balance negative. Throws if balance < amount.
   */
  async atomicDeductCredits(userId: string, amount: number, description: string): Promise<{ newBalance: number }> {
    if (amount <= 0) throw new Error("Deduct amount must be positive");
    // Conditional update: only succeeds when current balance is sufficient.
    const [updated] = await db.update(users)
      .set({ credits: sql`${users.credits} - ${amount}` })
      .where(and(eq(users.id, userId), sql`${users.credits} >= ${amount}`))
      .returning();
    if (!updated) {
      throw new Error(`積分不足，需要 ${amount} 積分`);
    }
    await db.insert(creditTransactions).values({
      userId,
      type: "consume",
      amount: -amount,
      balance: updated.credits || 0,
      description,
    });
    return { newBalance: updated.credits || 0 };
  }

  /**
   * Atomic compare-and-set: claim the four-view generation slot for a character.
   * Returns true if this caller successfully transitioned the row out of an
   * idle/completed/failed state into "generating". Returns false if another
   * request already holds the slot (status is already "generating").
   */
  async claimCharacterFourViewGeneration(id: string, userId: string): Promise<{ ok: boolean; previousStatus?: string | null }> {
    return await db.transaction(async (tx) => {
      const [current] = await tx.select({ status: characterLibrary.fourViewStatus, userId: characterLibrary.userId })
        .from(characterLibrary)
        .where(eq(characterLibrary.id, id))
        .for("update");
      if (!current || current.userId !== userId) return { ok: false };
      if (current.status === "generating") return { ok: false, previousStatus: current.status };
      await tx.update(characterLibrary)
        .set({ fourViewStatus: "generating", fourViewError: null, updatedAt: new Date() })
        .where(eq(characterLibrary.id, id));
      return { ok: true, previousStatus: current.status ?? null };
    });
  }

  async releaseCharacterFourViewGeneration(id: string, restoreStatus: string | null): Promise<void> {
    await db.update(characterLibrary)
      .set({ fourViewStatus: restoreStatus ?? "idle", updatedAt: new Date() })
      .where(eq(characterLibrary.id, id));
  }

  /**
   * Atomic claim of the first/last keyframe slots for one scene of an episode.
   * Uses a serializable transaction with row-level locking so two concurrent
   * requests cannot both observe an idle status and both write "generating".
   */
  async claimSceneFrameGeneration(
    episodeId: string,
    sceneIdx: number,
    userId: string,
  ): Promise<{ ok: boolean; reason?: "not_found" | "in_flight" | "out_of_range"; previousFirstStatus?: string | null; previousLastStatus?: string | null }> {
    return await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT id, user_id, scenes
        FROM ${dramaEpisodes}
        WHERE id = ${episodeId}
        FOR UPDATE
      `);
      const row: any = (rows as any).rows?.[0] ?? (rows as any)[0];
      if (!row) return { ok: false, reason: "not_found" as const };
      if (row.user_id !== userId) return { ok: false, reason: "not_found" as const };
      let scenes: any[];
      try { scenes = JSON.parse(row.scenes); } catch { return { ok: false, reason: "not_found" as const }; }
      if (sceneIdx < 0 || sceneIdx >= scenes.length) return { ok: false, reason: "out_of_range" as const };
      const sc = scenes[sceneIdx];
      if (sc.firstFrameStatus === "generating" || sc.lastFrameStatus === "generating") {
        return { ok: false, reason: "in_flight" as const };
      }
      const previousFirstStatus = sc.firstFrameStatus ?? null;
      const previousLastStatus = sc.lastFrameStatus ?? null;
      scenes[sceneIdx] = { ...sc, firstFrameStatus: "generating", lastFrameStatus: "generating" };
      await tx.update(dramaEpisodes)
        .set({ scenes: JSON.stringify(scenes) })
        .where(eq(dramaEpisodes.id, episodeId));
      return { ok: true, previousFirstStatus, previousLastStatus };
    });
  }

  /**
   * Revert the in-flight markers for one scene back to the previous values
   * captured at claim time (preserves prior `completed`/`failed` states).
   */
  async releaseSceneFrameGeneration(
    episodeId: string,
    sceneIdx: number,
    restoreFirst: string | null,
    restoreLast: string | null,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        SELECT scenes FROM ${dramaEpisodes} WHERE id = ${episodeId} FOR UPDATE
      `);
      const row: any = (rows as any).rows?.[0] ?? (rows as any)[0];
      if (!row) return;
      let scenes: any[];
      try { scenes = JSON.parse(row.scenes); } catch { return; }
      if (sceneIdx < 0 || sceneIdx >= scenes.length) return;
      scenes[sceneIdx] = {
        ...scenes[sceneIdx],
        firstFrameStatus: restoreFirst ?? "idle",
        lastFrameStatus: restoreLast ?? "idle",
      };
      await tx.update(dramaEpisodes)
        .set({ scenes: JSON.stringify(scenes) })
        .where(eq(dramaEpisodes.id, episodeId));
    });
  }

  async fixStripeTransactionTypes(): Promise<number> {
    const result = await db.update(creditTransactions)
      .set({ type: "topup" })
      .where(
        and(
          like(creditTransactions.description, "Stripe%"),
          eq(creditTransactions.type, "refund")
        )
      )
      .returning();
    return result.length;
  }

  async setUserAdmin(userId: string, isAdmin: boolean): Promise<User | undefined> {
    const [user] = await db.update(users).set({ isAdmin }).where(eq(users.id, userId)).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async createCreditTransaction(transaction: { userId: string; type: string; amount: number; balance: number; description: string | null }): Promise<CreditTransaction> {
    const [ct] = await db.insert(creditTransactions).values({
      userId: transaction.userId,
      type: transaction.type,
      amount: transaction.amount,
      balance: transaction.balance,
      description: transaction.description,
    }).returning();
    return ct;
  }

  async getCreditTransactions(userId: string): Promise<CreditTransaction[]> {
    return db.select().from(creditTransactions).where(eq(creditTransactions.userId, userId)).orderBy(desc(creditTransactions.createdAt));
  }

  async getCreditTransactionByDescription(description: string): Promise<CreditTransaction | undefined> {
    const [row] = await db.select().from(creditTransactions).where(eq(creditTransactions.description, description));
    return row;
  }

  async getAllTopupTransactions(): Promise<(CreditTransaction & { username?: string; email?: string })[]> {
    const rows = await db
      .select({
        id: creditTransactions.id,
        userId: creditTransactions.userId,
        type: creditTransactions.type,
        amount: creditTransactions.amount,
        balance: creditTransactions.balance,
        description: creditTransactions.description,
        createdAt: creditTransactions.createdAt,
        username: users.username,
        email: users.email,
      })
      .from(creditTransactions)
      .leftJoin(users, eq(creditTransactions.userId, users.id))
      .where(eq(creditTransactions.type, "topup"))
      .orderBy(desc(creditTransactions.createdAt));
    return rows as any;
  }

  async createImageGeneration(insertGeneration: InsertImageGeneration & {
    userId: string;
    sequentialGeneration?: boolean;
    maxImages?: number | null;
    additionalImageUrls?: string[];
    /** Persisted so processImageGeneration() can branch on it. */
    provider?: string;
    /** Provider-specific model id (e.g. GMI "Z-Image"). */
    model?: string;
    /** True per-row credit cost. Used by failImageGenerationAndRefund so
     *  the user gets back exactly what they paid (not a hard-coded 3). */
    creditsUsed?: number;
  }): Promise<ImageGeneration> {
    const [row] = await db.insert(imageGenerations).values({
      userId: insertGeneration.userId,
      batchId: insertGeneration.batchId ?? null,
      type: insertGeneration.type ?? "image-to-image",
      originalImageUrl: insertGeneration.originalImageUrl ?? null,
      prompt: insertGeneration.prompt,
      guidanceScale: insertGeneration.guidanceScale ?? 5.5,
      seed: insertGeneration.seed ?? 21,
      watermark: insertGeneration.watermark ?? true,
      size: insertGeneration.size ?? "2K",
      sequentialGeneration: insertGeneration.sequentialGeneration ?? false,
      maxImages: insertGeneration.maxImages ?? 1,
      additionalImageUrls: insertGeneration.additionalImageUrls ?? [],
      generatedImageUrls: [],
      status: "pending",
      cost: 0.05,
      creditsUsed: insertGeneration.creditsUsed ?? 3,
      provider: insertGeneration.provider ?? "byteplus",
      model: insertGeneration.model ?? null,
    }).returning();

    return row;
  }

  async createBatchImageGenerations(batchData: InsertBatchImageToImage & { userId: string }): Promise<ImageGeneration[]> {
    const batchId = randomUUID();
    const generations: ImageGeneration[] = [];

    for (const prompt of batchData.prompts) {
      const gen = await this.createImageGeneration({
        userId: batchData.userId,
        type: batchData.type,
        batchId,
        originalImageUrl: batchData.originalImageUrl,
        prompt,
        guidanceScale: batchData.guidanceScale,
        seed: batchData.seed,
        watermark: batchData.watermark,
        size: batchData.size,
      });
      generations.push(gen);
    }

    return generations;
  }

  async getImageGeneration(id: string): Promise<ImageGeneration | undefined> {
    const [row] = await db.select().from(imageGenerations).where(eq(imageGenerations.id, id));
    return row;
  }

  async getImageGenerationsByBatchId(batchId: string): Promise<ImageGeneration[]> {
    return db.select().from(imageGenerations).where(eq(imageGenerations.batchId, batchId)).orderBy(imageGenerations.createdAt);
  }

  async updateImageGeneration(id: string, updates: Partial<ImageGeneration>): Promise<ImageGeneration | undefined> {
    const dbUpdates: any = { updatedAt: new Date() };
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.generatedImageUrl !== undefined) dbUpdates.generatedImageUrl = updates.generatedImageUrl;
    if (updates.errorMessage !== undefined) dbUpdates.errorMessage = updates.errorMessage;
    if (updates.processingTime !== undefined) dbUpdates.processingTime = updates.processingTime;
    if (updates.cost !== undefined) dbUpdates.cost = updates.cost;
    if (updates.creditsUsed !== undefined) dbUpdates.creditsUsed = updates.creditsUsed;
    if (updates.generatedImageUrls !== undefined) dbUpdates.generatedImageUrls = updates.generatedImageUrls;
    if (updates.bunnyImageUrl !== undefined) dbUpdates.bunnyImageUrl = updates.bunnyImageUrl;
    if (updates.bunnyImageUrls !== undefined) dbUpdates.bunnyImageUrls = updates.bunnyImageUrls;

    const [row] = await db.update(imageGenerations).set(dbUpdates).where(eq(imageGenerations.id, id)).returning();
    return row;
  }

  async failImageGenerationAndRefund(id: string, errorMessage: string, processingTime: number): Promise<boolean> {
    const [updated] = await db.update(imageGenerations)
      .set({ status: "failed", errorMessage, processingTime, updatedAt: new Date() })
      .where(sql`${imageGenerations.id} = ${id} AND ${imageGenerations.status} != 'failed'`)
      .returning();

    if (!updated) return false;

    if (updated.userId) {
      const refundAmount = updated.creditsUsed || 3;
      await this.atomicAddCredits(updated.userId, refundAmount, `圖片生成失敗退還 ${refundAmount} 積分`);
    }
    return true;
  }

  async failVideoGenerationAndRefund(id: string, errorMessage: string, processingTime: number): Promise<boolean> {
    const [updated] = await db.update(videoGenerations)
      .set({ status: "failed", errorMessage, processingTime, updatedAt: new Date() })
      .where(sql`${videoGenerations.id} = ${id} AND ${videoGenerations.status} != 'failed'`)
      .returning();

    if (!updated) return false;

    if (updated.userId) {
      const creditsPerSec = updated.resolution === "720p" ? 8 : 15;
      const refundAmount = updated.creditsUsed || Math.round((updated.duration || 5) * creditsPerSec);
      await this.atomicAddCredits(updated.userId, refundAmount, `影片生成失敗退還 ${refundAmount} 積分`);
    }
    return true;
  }

  async getAllImageGenerations(): Promise<ImageGeneration[]> {
    return db.select().from(imageGenerations).orderBy(desc(imageGenerations.createdAt));
  }

  async getUserImageGenerations(userId: string): Promise<ImageGeneration[]> {
    return db.select().from(imageGenerations).where(eq(imageGenerations.userId, userId)).orderBy(desc(imageGenerations.createdAt));
  }

  async getUserStats(userId: string): Promise<{ totalGenerations: number; totalCost: number; totalCreditsUsed: number }> {
    const userImages = await db.select().from(imageGenerations).where(eq(imageGenerations.userId, userId));
    const userVideos = await db.select().from(videoGenerations).where(eq(videoGenerations.userId, userId));
    const totalGenerations = userImages.length + userVideos.length;
    const completedUserImages = userImages.filter(g => g.status === 'completed');
    const completedUserVideos = userVideos.filter(g => g.status === 'completed');
    const imageCost = completedUserImages.length * 0.05;
    const videoCost = completedUserVideos.reduce((sum, gen) => {
      const dur = gen.duration || 5;
      const r = gen.resolution || '1080p';
      const costPerSec = r === '720p' ? 5.5 : 11;
      return sum + dur * costPerSec;
    }, 0);
    const imageCredits = completedUserImages.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);
    const videoCredits = completedUserVideos.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);
    return { totalGenerations, totalCost: imageCost + videoCost, totalCreditsUsed: imageCredits + videoCredits };
  }

  async createVideoGeneration(insertGeneration: (InsertImageToVideo | InsertTextToVideo) & { userId: string }): Promise<VideoGeneration> {
    const duration = insertGeneration.duration ?? 5;
    const resolution = insertGeneration.resolution ?? "1080p";
    const aspectRatio = insertGeneration.aspectRatio ?? "16:9";
    // Provider-aware pricing. GMI Wan i2v is cheaper than SeedDance.
    // Keep these tables in sync with server/gmiProvider.ts GMI_VIDEO_MODELS
    // and the /api/video-generations route handler.
    const provider = (insertGeneration as any).provider === "gmi" ? "gmi" : "byteplus";
    const model = (insertGeneration as any).model ?? null;
    const creditsPerSecond = provider === "gmi"
      ? (resolution === "720p" ? 6 : 10)
      : (resolution === "720p" ? 8 : 15);

    const fps = 24;
    let width: number, height: number;
    if (resolution === "720p") {
      if (aspectRatio === "16:9") { width = 1280; height = 720; }
      else if (aspectRatio === "9:16") { width = 720; height = 1280; }
      else { width = 720; height = 720; }
    } else {
      if (aspectRatio === "16:9") { width = 1920; height = 1080; }
      else if (aspectRatio === "9:16") { width = 1080; height = 1920; }
      else { width = 1080; height = 1080; }
    }
    const costPerSec = resolution === "720p" ? 5.5 : 11;
    const videoCost = duration * costPerSec;

    const [row] = await db.insert(videoGenerations).values({
      userId: insertGeneration.userId,
      type: insertGeneration.type,
      originalImageUrl: "originalImageUrl" in insertGeneration ? insertGeneration.originalImageUrl : null,
      additionalImageUrls: "additionalImageUrls" in insertGeneration ? (insertGeneration.additionalImageUrls ?? []) : [],
      // Persist reference audio for BOTH image-to-video and text-to-video
      // omni paths. Without this, the field is dropped at the DB layer and
      // processVideoGeneration never sees it (omni audio silently disabled).
      referenceAudioUrl: (insertGeneration as any).referenceAudioUrl ?? null,
      prompt: insertGeneration.prompt,
      duration,
      cameraFixed: insertGeneration.cameraFixed ?? false,
      aspectRatio,
      resolution,
      status: "pending",
      cost: Math.round(videoCost * 10000) / 10000,
      creditsUsed: Math.round(duration * creditsPerSecond),
      provider,
      model,
    }).returning();
    return row;
  }

  async getVideoGeneration(id: string): Promise<VideoGeneration | undefined> {
    const [row] = await db.select().from(videoGenerations).where(eq(videoGenerations.id, id));
    return row;
  }

  async updateVideoGeneration(id: string, updates: Partial<VideoGeneration>): Promise<VideoGeneration | undefined> {
    const dbUpdates: any = { updatedAt: new Date() };
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.taskId !== undefined) dbUpdates.taskId = updates.taskId;
    if (updates.generatedVideoUrl !== undefined) dbUpdates.generatedVideoUrl = updates.generatedVideoUrl;
    if (updates.errorMessage !== undefined) dbUpdates.errorMessage = updates.errorMessage;
    if (updates.processingTime !== undefined) dbUpdates.processingTime = updates.processingTime;
    if (updates.cost !== undefined) dbUpdates.cost = updates.cost;
    if (updates.bunnyVideoUrl !== undefined) dbUpdates.bunnyVideoUrl = updates.bunnyVideoUrl;

    const [row] = await db.update(videoGenerations).set(dbUpdates).where(eq(videoGenerations.id, id)).returning();
    return row;
  }

  async getAllVideoGenerations(): Promise<VideoGeneration[]> {
    return db.select().from(videoGenerations).orderBy(desc(videoGenerations.createdAt));
  }

  async getUserVideoGenerations(userId: string): Promise<VideoGeneration[]> {
    return db.select().from(videoGenerations).where(eq(videoGenerations.userId, userId)).orderBy(desc(videoGenerations.createdAt));
  }

  async getUserDailyImageCount(userId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    // Sum actual image units (not row count) so a single sequential row
    // with maxImages=10 counts as 10 against the daily cap. Falls back to
    // generated_image_urls length if maxImages is null, then to 1.
    const rows = await db
      .select({
        c: sql<number>`COALESCE(SUM(GREATEST(
          COALESCE(${imageGenerations.maxImages}, COALESCE(array_length(${imageGenerations.generatedImageUrls}, 1), 1)),
          1
        )), 0)::int`,
      })
      .from(imageGenerations)
      .where(
        and(
          eq(imageGenerations.userId, userId),
          gte(imageGenerations.createdAt, startOfDay),
        ),
      );
    return rows[0]?.c ?? 0;
  }

  async getUserDailyVideoCount(userId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(videoGenerations)
      .where(
        and(
          eq(videoGenerations.userId, userId),
          gte(videoGenerations.createdAt, startOfDay),
        ),
      );
    return rows[0]?.c ?? 0;
  }

  async getStats(): Promise<{
    totalGenerations: number;
    totalCost: number;
    totalImages: number;
    totalVideos: number;
    completedImages: number;
    completedVideos: number;
    failedImages: number;
    failedVideos: number;
    imageCost: number;
    videoCost: number;
    imageCreditsUsed: number;
    videoCreditsUsed: number;
    totalCreditsUsed: number;
  }> {
    const allImages = await db.select().from(imageGenerations);
    const allVideos = await db.select().from(videoGenerations);

    const completedImages = allImages.filter(g => g.status === "completed");
    const completedVideos = allVideos.filter(g => g.status === "completed");
    const failedImages = allImages.filter(g => g.status === "failed").length;
    const failedVideos = allVideos.filter(g => g.status === "failed").length;

    const IMAGE_COST_USD = 0.05;
    const imageCost = completedImages.length * IMAGE_COST_USD;

    const videoCost = completedVideos.reduce((sum, gen) => {
      const dur = gen.duration || 5;
      const r = gen.resolution || '1080p';
      const costPerSec = r === '720p' ? 5.5 : 11;
      return sum + dur * costPerSec;
    }, 0);

    const imageCreditsUsed = completedImages.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);
    const videoCreditsUsed = completedVideos.reduce((sum, gen) => sum + (gen.creditsUsed || 0), 0);

    return {
      totalGenerations: allImages.length + allVideos.length,
      totalCost: imageCost + videoCost,
      totalImages: allImages.length,
      totalVideos: allVideos.length,
      completedImages: completedImages.length,
      completedVideos: completedVideos.length,
      failedImages,
      failedVideos,
      imageCost,
      videoCost,
      imageCreditsUsed,
      videoCreditsUsed,
      totalCreditsUsed: imageCreditsUsed + videoCreditsUsed,
    };
  }

  async createVerificationCode(email: string, code: string, expiresAt: Date): Promise<VerificationCode> {
    await db.delete(verificationCodes).where(
      and(eq(verificationCodes.email, email), eq(verificationCodes.used, false))
    );
    const [row] = await db.insert(verificationCodes).values({
      email,
      code,
      expiresAt,
    }).returning();
    return row;
  }

  async getRecentVerificationCode(email: string): Promise<VerificationCode | undefined> {
    const [row] = await db.select().from(verificationCodes)
      .where(eq(verificationCodes.email, email))
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1);
    return row;
  }

  async getValidVerificationCode(email: string, code: string): Promise<VerificationCode | undefined> {
    const [row] = await db.select().from(verificationCodes).where(
      and(
        eq(verificationCodes.email, email),
        eq(verificationCodes.code, code),
        eq(verificationCodes.used, false),
        gt(verificationCodes.expiresAt, new Date())
      )
    );
    return row;
  }

  async markVerificationCodeUsed(id: string): Promise<void> {
    await db.update(verificationCodes).set({ used: true }).where(eq(verificationCodes.id, id));
  }

  async deleteExpiredVerificationCodes(): Promise<void> {
    await db.delete(verificationCodes).where(
      sql`${verificationCodes.expiresAt} < NOW() OR ${verificationCodes.used} = true`
    );
  }

  async createChatMessage(userId: string, message: string, isAdmin: boolean): Promise<ChatMessage> {
    const [msg] = await db.insert(chatMessages).values({
      userId,
      message,
      isAdmin,
      isRead: isAdmin,
    }).returning();
    return msg;
  }

  async getChatMessages(userId: string): Promise<ChatMessage[]> {
    return db.select().from(chatMessages).where(eq(chatMessages.userId, userId)).orderBy(chatMessages.createdAt);
  }

  async getChatsOverview(): Promise<{ userId: string; username: string; email: string; lastMessage: string; lastMessageAt: Date | null; unreadCount: number }[]> {
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map(u => [u.id, u]));
    const allMessages = await db.select().from(chatMessages).orderBy(desc(chatMessages.createdAt));

    const chatMap = new Map<string, { lastMessage: string; lastMessageAt: Date | null; unreadCount: number }>();
    for (const msg of allMessages) {
      if (!chatMap.has(msg.userId)) {
        chatMap.set(msg.userId, {
          lastMessage: msg.message,
          lastMessageAt: msg.createdAt,
          unreadCount: 0,
        });
      }
      if (!msg.isAdmin && !msg.isRead) {
        const entry = chatMap.get(msg.userId)!;
        entry.unreadCount++;
      }
    }

    return Array.from(chatMap.entries())
      .map(([userId, data]) => {
        const user = userMap.get(userId);
        return {
          userId,
          username: user?.username || "未知",
          email: user?.email || "",
          ...data,
        };
      })
      .sort((a, b) => (b.lastMessageAt?.getTime() || 0) - (a.lastMessageAt?.getTime() || 0));
  }

  async markChatMessagesRead(userId: string): Promise<void> {
    await db.update(chatMessages).set({ isRead: true }).where(
      and(eq(chatMessages.userId, userId), eq(chatMessages.isAdmin, false))
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    const msgs = await db.select().from(chatMessages).where(
      and(eq(chatMessages.userId, userId), eq(chatMessages.isAdmin, true), eq(chatMessages.isRead, false))
    );
    return msgs.length;
  }

  async createStoryGeneration(data: InsertStoryGeneration & { userId: string; creditsUsed: number }): Promise<StoryGeneration> {
    const scenes: StoryScene[] = data.scenes.map((s, i) => ({
      id: `scene_${i}`,
      title: s.title || `第 ${i + 1} 幕`,
      description: s.description,
      sceneReferenceImageUrl: (s as any).sceneReferenceImageUrl || undefined,
      status: "pending" as const,
    }));
    const [row] = await db.insert(storyGenerations).values({
      userId: data.userId,
      title: data.title,
      style: data.style,
      sceneCount: data.scenes.length,
      referenceImageUrls: data.referenceImageUrls ?? [],
      scenes: JSON.stringify(scenes),
      status: "pending",
      creditsUsed: data.creditsUsed,
      cost: 0,
      sceneSize: (data as any).sceneSize ?? "1:1",
      characterImageUrls: (data as any).characterImageUrls ?? [],
      characterBImageUrls: (data as any).characterBImageUrls ?? [],
      sceneRefImageUrls: (data as any).sceneRefImageUrls ?? [],
      styleImageUrls: (data as any).styleImageUrls ?? [],
      globalSeed: (data as any).globalSeed ?? undefined,
    }).returning();
    return row;
  }

  async getStoryGeneration(id: string): Promise<StoryGeneration | undefined> {
    const [row] = await db.select().from(storyGenerations).where(eq(storyGenerations.id, id));
    return row;
  }

  async updateStoryGeneration(id: string, updates: Partial<StoryGeneration>): Promise<StoryGeneration | undefined> {
    const dbUpdates: any = { updatedAt: new Date() };
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.scenes !== undefined) dbUpdates.scenes = updates.scenes;
    if (updates.errorMessage !== undefined) dbUpdates.errorMessage = updates.errorMessage;
    if (updates.cost !== undefined) dbUpdates.cost = updates.cost;
    if (updates.creditsUsed !== undefined) dbUpdates.creditsUsed = updates.creditsUsed;
    const [row] = await db.update(storyGenerations).set(dbUpdates).where(eq(storyGenerations.id, id)).returning();
    return row;
  }

  async getUserStoryGenerations(userId: string): Promise<StoryGeneration[]> {
    return db.select().from(storyGenerations).where(eq(storyGenerations.userId, userId)).orderBy(desc(storyGenerations.createdAt));
  }

  async getAllStoryGenerations(): Promise<StoryGeneration[]> {
    return db.select().from(storyGenerations).orderBy(desc(storyGenerations.createdAt));
  }

  async failStoryGenerationAndRefund(id: string, errorMessage: string): Promise<boolean> {
    const [updated] = await db.update(storyGenerations)
      .set({ status: "failed", errorMessage, updatedAt: new Date() })
      .where(sql`${storyGenerations.id} = ${id} AND ${storyGenerations.status} != 'failed'`)
      .returning();
    if (!updated) return false;
    if (updated.userId && updated.creditsUsed && updated.creditsUsed > 0) {
      await this.atomicAddCredits(updated.userId, updated.creditsUsed, `故事生成失敗退還 ${updated.creditsUsed} 積分`);
    }
    return true;
  }

  // ─── Drama Studio ──────────────────────────────────────────────────────────

  async createDramaProject(data: InsertDramaProject & { userId: string }): Promise<DramaProject> {
    const [project] = await db.insert(dramaProjects).values({
      userId: data.userId,
      title: data.title,
      genre: data.genre ?? "",
      description: data.description ?? "",
      characterAName: data.characterAName ?? "角色A",
      characterAUrls: data.characterAUrls ?? [],
      characterBName: data.characterBName ?? "角色B",
      characterBUrls: data.characterBUrls ?? [],
      styleImageUrls: data.styleImageUrls ?? [],
      sceneSize: data.sceneSize ?? "9:16",
      episodeCount: 0,
      status: "active",
    }).returning();
    return project;
  }

  async getDramaProject(id: string): Promise<DramaProject | undefined> {
    const [project] = await db.select().from(dramaProjects).where(eq(dramaProjects.id, id));
    return project;
  }

  async updateDramaProject(id: string, updates: Partial<DramaProject>): Promise<DramaProject | undefined> {
    const [project] = await db.update(dramaProjects)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(dramaProjects.id, id))
      .returning();
    return project;
  }

  async deleteDramaProject(id: string): Promise<void> {
    await db.delete(dramaEpisodes).where(eq(dramaEpisodes.projectId, id));
    await db.delete(dramaProjects).where(eq(dramaProjects.id, id));
  }

  async getUserDramaProjects(userId: string): Promise<DramaProject[]> {
    return db.select().from(dramaProjects)
      .where(eq(dramaProjects.userId, userId))
      .orderBy(desc(dramaProjects.updatedAt));
  }

  async createDramaEpisode(data: { projectId: string; userId: string; episodeNumber: number; title: string; scenes: string; sceneCount: number; globalSeed?: number }): Promise<DramaEpisode> {
    const [episode] = await db.insert(dramaEpisodes).values({
      projectId: data.projectId,
      userId: data.userId,
      episodeNumber: data.episodeNumber,
      title: data.title,
      scenes: data.scenes,
      sceneCount: data.sceneCount,
      globalSeed: data.globalSeed,
      status: "draft",
      creditsUsed: 0,
    }).returning();
    await db.update(dramaProjects)
      .set({ episodeCount: sql`${dramaProjects.episodeCount} + 1`, updatedAt: new Date() })
      .where(eq(dramaProjects.id, data.projectId));
    return episode;
  }

  async getDramaEpisode(id: string): Promise<DramaEpisode | undefined> {
    const [episode] = await db.select().from(dramaEpisodes).where(eq(dramaEpisodes.id, id));
    return episode;
  }

  async updateDramaEpisode(id: string, updates: Partial<DramaEpisode>): Promise<DramaEpisode | undefined> {
    const [episode] = await db.update(dramaEpisodes)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(dramaEpisodes.id, id))
      .returning();
    return episode;
  }

  async deleteDramaEpisode(id: string): Promise<void> {
    const [ep] = await db.select().from(dramaEpisodes).where(eq(dramaEpisodes.id, id));
    await db.delete(dramaEpisodes).where(eq(dramaEpisodes.id, id));
    if (ep) {
      await db.update(dramaProjects)
        .set({ episodeCount: sql`GREATEST(${dramaProjects.episodeCount} - 1, 0)`, updatedAt: new Date() })
        .where(eq(dramaProjects.id, ep.projectId));
    }
  }

  async getDramaEpisodesByProject(projectId: string): Promise<DramaEpisode[]> {
    return db.select().from(dramaEpisodes)
      .where(eq(dramaEpisodes.projectId, projectId))
      .orderBy(dramaEpisodes.episodeNumber);
  }

  async getAllDramaEpisodes(): Promise<DramaEpisode[]> {
    return db.select().from(dramaEpisodes).orderBy(desc(dramaEpisodes.createdAt));
  }

  // ── Character Library ──────────────────────────────────────────────────────

  async createCharacter(data: InsertCharacterLibrary & { userId: string }): Promise<CharacterLibraryItem> {
    const [c] = await db.insert(characterLibrary).values({
      userId: data.userId,
      name: data.name,
      description: data.description ?? "",
      refImageUrls: data.refImageUrls ?? [],
      styleHint: data.styleHint ?? "",
    }).returning();
    return c;
  }

  async getCharacter(id: string): Promise<CharacterLibraryItem | undefined> {
    const [c] = await db.select().from(characterLibrary).where(eq(characterLibrary.id, id));
    return c;
  }

  async getUserCharacters(userId: string): Promise<CharacterLibraryItem[]> {
    return db.select().from(characterLibrary)
      .where(eq(characterLibrary.userId, userId))
      .orderBy(desc(characterLibrary.createdAt));
  }

  async updateCharacter(id: string, updates: Partial<CharacterLibraryItem>): Promise<CharacterLibraryItem | undefined> {
    const [c] = await db.update(characterLibrary)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(characterLibrary.id, id))
      .returning();
    return c;
  }

  async deleteCharacter(id: string): Promise<void> {
    await db.delete(characterLibrary).where(eq(characterLibrary.id, id));
  }

  // ── Scene Library ──────────────────────────────────────────────────────────

  async createSceneLibraryItem(data: InsertSceneLibrary & { userId: string }): Promise<SceneLibraryItem> {
    const [s] = await db.insert(sceneLibrary).values({
      userId: data.userId,
      name: data.name,
      description: data.description ?? "",
      refImageUrls: data.refImageUrls ?? [],
    }).returning();
    return s;
  }

  async getSceneLibraryItem(id: string): Promise<SceneLibraryItem | undefined> {
    const [s] = await db.select().from(sceneLibrary).where(eq(sceneLibrary.id, id));
    return s;
  }

  async getUserSceneLibrary(userId: string): Promise<SceneLibraryItem[]> {
    return db.select().from(sceneLibrary)
      .where(eq(sceneLibrary.userId, userId))
      .orderBy(desc(sceneLibrary.createdAt));
  }

  async updateSceneLibraryItem(id: string, updates: Partial<SceneLibraryItem>): Promise<SceneLibraryItem | undefined> {
    const [s] = await db.update(sceneLibrary)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(sceneLibrary.id, id))
      .returning();
    return s;
  }

  async deleteSceneLibraryItem(id: string): Promise<void> {
    await db.delete(sceneLibrary).where(eq(sceneLibrary.id, id));
  }
}

export const storage = new DatabaseStorage();

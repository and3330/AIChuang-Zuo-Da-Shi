/**
 * 作品牆 (Showcase): works their makers chose to publish, shown to everyone.
 *
 *   publish   a finished image or video from the maker's own 作品庫; it waits as
 *             "pending" until an admin approves it. Works made in the gold zone
 *             (sensitive) and works whose prompt is adult content can never be published.
 *   wall      approved works: latest, hot, or from people the viewer follows.
 *   social    likes, comments, follows, reports, a public page per creator.
 *   remix     the prompt is shown only when the maker chose to share it.
 *
 * Reading the wall needs no sign-in; everything that writes does. Partner
 * workspace sessions (embed mode) cannot write here: they are not people.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  imageGenerations, videoGenerations, users,
  showcasePosts, showcaseLikes, showcaseComments, showcaseReports, userFollows,
  type ShowcasePost,
} from "@shared/schema";
import { containsMinorTerms, containsNsfw } from "@shared/safety";

const PAGE_SIZE = 30;
const TITLE_MAX = 40;
const COMMENT_MAX = 300;
const BIO_MAX = 160;
/** Reports at which an approved work goes back to "pending" until an admin looks. */
const REPORTS_TO_HIDE = 3;

const listQuery = z.object({
  sort: z.enum(["latest", "hot", "following"]).default("latest"),
  author: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});
const publishBody = z.object({
  /** 作品庫 item id: "<generationId>:<index>" for an image, "<generationId>" for a video. */
  itemId: z.string().min(1).max(80),
  title: z.string().trim().max(TITLE_MAX).default(""),
  showPrompt: z.boolean().default(true),
});
const commentBody = z.object({ body: z.string().trim().min(1).max(COMMENT_MAX) });
const reportBody = z.object({ reason: z.string().trim().max(200).default("") });
const profileBody = z.object({ bio: z.string().trim().max(BIO_MAX) });
const reviewBody = z.object({ action: z.enum(["approve", "reject"]), reason: z.string().trim().max(200).default("") });

/** Plain-language refusal for text that may not be shown in public. */
function publicTextProblem(text: string): string | null {
  return containsNsfw(text) || containsMinorTerms(text) ? "內容包含不適合公開的字詞，請修改後再試。" : null;
}

export function registerShowcaseRoutes(
  app: Express,
  deps: {
    requireAuth: (req: Request, res: Response, next: NextFunction) => void;
    requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
    cdnUrl: (url: string | null | undefined) => string | null | undefined;
  },
) {
  const { requireAuth, requireAdmin, cdnUrl } = deps;
  const viewerId = (req: Request): string | null => req.session?.userId ?? null;
  const isAdmin = (req: Request): boolean => !!(req.session as any)?.isAdmin;

  /** Signed in as a person (not a partner workspace). */
  const requirePerson = (req: Request, res: Response, next: NextFunction) => {
    if ((req.session as any)?.embed) return res.status(403).json({ error: "這個功能在客戶小鎮的創作模式中無法使用。", code: "embed_not_allowed" });
    return requireAuth(req, res, next);
  };

  // A small in-memory brake on comments: 6 per minute per account.
  const commentTimes = new Map<string, number[]>();
  const commentAllowed = (userId: string): boolean => {
    const now = Date.now();
    const recent = (commentTimes.get(userId) ?? []).filter(t => now - t < 60_000);
    if (recent.length >= 6) { commentTimes.set(userId, recent); return false; }
    recent.push(now); commentTimes.set(userId, recent);
    return true;
  };

  type Card = {
    id: string; kind: string; mediaUrl: string; title: string; likeCount: number; commentCount: number;
    status: string; createdAt: string | null; author: { username: string; avatarUrl: string | null }; liked: boolean;
  };
  const cardColumns = {
    id: showcasePosts.id, kind: showcasePosts.kind, mediaUrl: showcasePosts.mediaUrl, title: showcasePosts.title,
    likeCount: showcasePosts.likeCount, commentCount: showcasePosts.commentCount, status: showcasePosts.status,
    createdAt: showcasePosts.createdAt, username: users.username, avatarUrl: users.avatarUrl,
  };
  type CardRow = { id: string; kind: string; mediaUrl: string; title: string; likeCount: number; commentCount: number; status: string; createdAt: Date | null; username: string; avatarUrl: string | null };

  async function toCards(rows: CardRow[], viewer: string | null): Promise<Card[]> {
    const liked = new Set<string>();
    if (viewer && rows.length > 0) {
      const mine = await db.select({ postId: showcaseLikes.postId }).from(showcaseLikes)
        .where(and(eq(showcaseLikes.userId, viewer), inArray(showcaseLikes.postId, rows.map(r => r.id))));
      mine.forEach(m => liked.add(m.postId));
    }
    return rows.map(r => ({
      id: r.id, kind: r.kind, mediaUrl: r.mediaUrl, title: r.title, likeCount: r.likeCount, commentCount: r.commentCount,
      status: r.status, createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      author: { username: r.username, avatarUrl: r.avatarUrl }, liked: liked.has(r.id),
    }));
  }

  async function findUserByName(username: string) {
    const [u] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return u;
  }

  /** A post the viewer may see: approved, or their own, or any for an admin. */
  async function visiblePost(req: Request, id: string): Promise<ShowcasePost | null> {
    const [post] = await db.select().from(showcasePosts).where(eq(showcasePosts.id, id)).limit(1);
    if (!post) return null;
    if (post.status === "approved" || post.userId === viewerId(req) || isAdmin(req)) return post;
    return null;
  }

  async function recount(postId: string) {
    await db.update(showcasePosts).set({
      likeCount: sql`(select count(*)::int from ${showcaseLikes} where ${showcaseLikes.postId} = ${postId})`,
      commentCount: sql`(select count(*)::int from ${showcaseComments} where ${showcaseComments.postId} = ${postId})`,
    }).where(eq(showcasePosts.id, postId));
  }

  /* ───────────────────────── the wall (no sign-in needed) ───────────────────────── */

  app.get("/api/showcase/posts", async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "查詢參數有誤。" });
    const { sort, author, page } = parsed.data;
    const viewer = viewerId(req);
    try {
      const filters = [eq(showcasePosts.status, "approved")];
      if (author) {
        const u = await findUserByName(author);
        if (!u) return res.json({ items: [], total: 0, page, pageSize: PAGE_SIZE });
        filters.push(eq(showcasePosts.userId, u.id));
      }
      if (sort === "following") {
        if (!viewer) return res.json({ items: [], total: 0, page, pageSize: PAGE_SIZE });
        const following = await db.select({ id: userFollows.followingId }).from(userFollows).where(eq(userFollows.followerId, viewer));
        if (following.length === 0) return res.json({ items: [], total: 0, page, pageSize: PAGE_SIZE });
        filters.push(inArray(showcasePosts.userId, following.map(f => f.id)));
      }
      const where = and(...filters);
      // Hot: likes and comments, fading with age.
      const hot = sql`(${showcasePosts.likeCount} * 2 + ${showcasePosts.commentCount} + 1) / power(extract(epoch from (now() - ${showcasePosts.createdAt})) / 3600 + 2, 1.2)`;
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(showcasePosts).where(where);
      const rows = await db.select(cardColumns).from(showcasePosts).innerJoin(users, eq(users.id, showcasePosts.userId))
        .where(where).orderBy(sort === "hot" ? desc(hot) : desc(showcasePosts.createdAt))
        .limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE);
      res.json({ items: await toCards(rows, viewer), total: n, page, pageSize: PAGE_SIZE });
    } catch (e) {
      console.error("[Showcase] list failed:", e instanceof Error ? e.message : e);
      res.status(500).json({ error: "作品牆讀取失敗。" });
    }
  });

  app.get("/api/showcase/posts/:id", async (req, res) => {
    try {
      const post = await visiblePost(req, req.params.id);
      if (!post) return res.status(404).json({ error: "找不到這件作品。" });
      const viewer = viewerId(req);
      const [author] = await db.select({ username: users.username, avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, post.userId)).limit(1);
      const comments = await db.select({
        id: showcaseComments.id, body: showcaseComments.body, createdAt: showcaseComments.createdAt,
        userId: showcaseComments.userId, username: users.username, avatarUrl: users.avatarUrl,
      }).from(showcaseComments).innerJoin(users, eq(users.id, showcaseComments.userId))
        .where(eq(showcaseComments.postId, post.id)).orderBy(desc(showcaseComments.createdAt)).limit(200);
      const liked = viewer
        ? (await db.select({ postId: showcaseLikes.postId }).from(showcaseLikes).where(and(eq(showcaseLikes.postId, post.id), eq(showcaseLikes.userId, viewer))).limit(1)).length > 0
        : false;
      const following = viewer && viewer !== post.userId
        ? (await db.select({ id: userFollows.followingId }).from(userFollows).where(and(eq(userFollows.followerId, viewer), eq(userFollows.followingId, post.userId))).limit(1)).length > 0
        : false;
      const isOwner = viewer === post.userId;
      res.json({
        id: post.id, kind: post.kind, mediaUrl: post.mediaUrl, title: post.title, status: post.status,
        rejectReason: isOwner || isAdmin(req) ? post.rejectReason : null,
        prompt: post.showPrompt ? post.prompt : null,
        likeCount: post.likeCount, commentCount: post.commentCount,
        createdAt: post.createdAt ? new Date(post.createdAt).toISOString() : null,
        author: { username: author?.username ?? "", avatarUrl: author?.avatarUrl ?? null },
        liked, following, isOwner, canModerate: isAdmin(req),
        comments: comments.map(c => ({
          id: c.id, body: c.body, createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
          author: { username: c.username, avatarUrl: c.avatarUrl },
          canDelete: !!viewer && (c.userId === viewer || isOwner || isAdmin(req)),
        })),
      });
    } catch (e) {
      console.error("[Showcase] detail failed:", e instanceof Error ? e.message : e);
      res.status(500).json({ error: "作品讀取失敗。" });
    }
  });

  app.get("/api/showcase/users/:username", async (req, res) => {
    try {
      const u = await findUserByName(req.params.username);
      if (!u) return res.status(404).json({ error: "找不到這位創作者。" });
      const viewer = viewerId(req);
      const one = async (q: Promise<Array<{ n: number }>>) => (await q)[0]?.n ?? 0;
      const posts = await one(db.select({ n: sql<number>`count(*)::int` }).from(showcasePosts).where(and(eq(showcasePosts.userId, u.id), eq(showcasePosts.status, "approved"))));
      const likes = await one(db.select({ n: sql<number>`coalesce(sum(${showcasePosts.likeCount}), 0)::int` }).from(showcasePosts).where(and(eq(showcasePosts.userId, u.id), eq(showcasePosts.status, "approved"))));
      const followers = await one(db.select({ n: sql<number>`count(*)::int` }).from(userFollows).where(eq(userFollows.followingId, u.id)));
      const followingCount = await one(db.select({ n: sql<number>`count(*)::int` }).from(userFollows).where(eq(userFollows.followerId, u.id)));
      const isFollowing = viewer && viewer !== u.id
        ? (await db.select({ id: userFollows.followingId }).from(userFollows).where(and(eq(userFollows.followerId, viewer), eq(userFollows.followingId, u.id))).limit(1)).length > 0
        : false;
      res.json({
        username: u.username, avatarUrl: u.avatarUrl ?? null, bio: u.bio ?? "",
        joinedAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
        counts: { posts, likes, followers, following: followingCount },
        isSelf: viewer === u.id, isFollowing,
      });
    } catch (e) {
      console.error("[Showcase] profile failed:", e instanceof Error ? e.message : e);
      res.status(500).json({ error: "創作者資料讀取失敗。" });
    }
  });

  /* ───────────────────────── publishing ───────────────────────── */

  // The viewer's own posts with their review status (the 作品庫 uses it to label items).
  app.get("/api/showcase/mine", requirePerson, async (req, res) => {
    try {
      const rows = await db.select({
        id: showcasePosts.id, kind: showcasePosts.kind, mediaUrl: showcasePosts.mediaUrl, title: showcasePosts.title,
        status: showcasePosts.status, rejectReason: showcasePosts.rejectReason, likeCount: showcasePosts.likeCount,
        commentCount: showcasePosts.commentCount, createdAt: showcasePosts.createdAt,
      }).from(showcasePosts).where(eq(showcasePosts.userId, req.session.userId!)).orderBy(desc(showcasePosts.createdAt)).limit(500);
      res.json({ items: rows });
    } catch {
      res.status(500).json({ error: "讀取失敗。" });
    }
  });

  app.post("/api/showcase/posts", requirePerson, async (req, res) => {
    const parsed = publishBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: `標題最多 ${TITLE_MAX} 個字。` });
    const { itemId, title, showPrompt } = parsed.data;
    const userId = req.session.userId!;
    try {
      const [genId, indexRaw] = itemId.split(":");
      let kind: "image" | "video"; let mediaUrl: string | null | undefined; let prompt = "";

      const [img] = await db.select().from(imageGenerations).where(and(eq(imageGenerations.id, genId), eq(imageGenerations.userId, userId))).limit(1);
      if (img) {
        if (img.status !== "completed") return res.status(400).json({ error: "這件作品還沒完成。" });
        if (img.sensitive) return res.status(403).json({ error: "這件作品無法公開。", code: "not_publishable" });
        const urls = (img.bunnyImageUrls?.length ? img.bunnyImageUrls
          : img.bunnyImageUrl ? [img.bunnyImageUrl]
          : img.generatedImageUrls?.length ? img.generatedImageUrls
          : img.generatedImageUrl ? [img.generatedImageUrl] : []).map(u => cdnUrl(u));
        kind = "image"; mediaUrl = urls[Number(indexRaw ?? 0)] ?? null; prompt = img.prompt ?? "";
      } else {
        const [vid] = await db.select().from(videoGenerations).where(and(eq(videoGenerations.id, genId), eq(videoGenerations.userId, userId))).limit(1);
        if (!vid) return res.status(404).json({ error: "找不到這件作品。" });
        if (vid.status !== "completed") return res.status(400).json({ error: "這件作品還沒完成。" });
        kind = "video"; mediaUrl = cdnUrl(vid.bunnyVideoUrl); prompt = vid.prompt ?? "";
      }

      // Only permanent CDN copies go on the wall, never a provider's temporary link.
      if (!mediaUrl || !/^https:\/\//.test(mediaUrl) || mediaUrl.includes("/objects/")) {
        return res.status(400).json({ error: "這件作品還沒有永久網址，請稍後再試。" });
      }
      if (containsNsfw(prompt) || containsMinorTerms(prompt)) return res.status(403).json({ error: "這件作品無法公開。", code: "not_publishable" });
      const titleProblem = publicTextProblem(title);
      if (titleProblem) return res.status(400).json({ error: titleProblem });

      const [existing] = await db.select({ id: showcasePosts.id, status: showcasePosts.status }).from(showcasePosts).where(eq(showcasePosts.mediaUrl, mediaUrl)).limit(1);
      if (existing) return res.status(409).json({ error: existing.status === "rejected" ? "這件作品沒有通過審核，無法再次公開。" : "這件作品已經公開過了。", id: existing.id });

      const [post] = await db.insert(showcasePosts).values({ userId, kind, generationId: genId, mediaUrl, title, prompt, showPrompt }).returning();
      res.json({ id: post.id, status: post.status });
    } catch (e) {
      console.error("[Showcase] publish failed:", e instanceof Error ? e.message : e);
      res.status(500).json({ error: "公開失敗，請稍後再試。" });
    }
  });

  // Take a work off the wall: its maker, or an admin.
  app.delete("/api/showcase/posts/:id", requirePerson, async (req, res) => {
    try {
      const [post] = await db.select().from(showcasePosts).where(eq(showcasePosts.id, req.params.id)).limit(1);
      if (!post) return res.status(404).json({ error: "找不到這件作品。" });
      if (post.userId !== req.session.userId && !isAdmin(req)) return res.status(403).json({ error: "只有作者可以取消公開。" });
      await db.delete(showcaseLikes).where(eq(showcaseLikes.postId, post.id));
      await db.delete(showcaseComments).where(eq(showcaseComments.postId, post.id));
      await db.delete(showcaseReports).where(eq(showcaseReports.postId, post.id));
      await db.delete(showcasePosts).where(eq(showcasePosts.id, post.id));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "取消公開失敗。" });
    }
  });

  /* ───────────────────────── likes, comments, reports ───────────────────────── */

  const approvedPost = async (id: string): Promise<ShowcasePost | null> => {
    const [post] = await db.select().from(showcasePosts).where(and(eq(showcasePosts.id, id), eq(showcasePosts.status, "approved"))).limit(1);
    return post ?? null;
  };

  app.post("/api/showcase/posts/:id/like", requirePerson, async (req, res) => {
    try {
      const post = await approvedPost(req.params.id);
      if (!post) return res.status(404).json({ error: "找不到這件作品。" });
      await db.insert(showcaseLikes).values({ postId: post.id, userId: req.session.userId! }).onConflictDoNothing();
      await recount(post.id);
      const [p] = await db.select({ n: showcasePosts.likeCount }).from(showcasePosts).where(eq(showcasePosts.id, post.id));
      res.json({ liked: true, likeCount: p?.n ?? 0 });
    } catch {
      res.status(500).json({ error: "按讚失敗。" });
    }
  });

  app.delete("/api/showcase/posts/:id/like", requirePerson, async (req, res) => {
    try {
      await db.delete(showcaseLikes).where(and(eq(showcaseLikes.postId, req.params.id), eq(showcaseLikes.userId, req.session.userId!)));
      await recount(req.params.id);
      const [p] = await db.select({ n: showcasePosts.likeCount }).from(showcasePosts).where(eq(showcasePosts.id, req.params.id));
      res.json({ liked: false, likeCount: p?.n ?? 0 });
    } catch {
      res.status(500).json({ error: "取消讚失敗。" });
    }
  });

  app.post("/api/showcase/posts/:id/comments", requirePerson, async (req, res) => {
    const parsed = commentBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: `留言需要 1 到 ${COMMENT_MAX} 個字。` });
    const problem = publicTextProblem(parsed.data.body);
    if (problem) return res.status(400).json({ error: problem });
    const userId = req.session.userId!;
    if (!commentAllowed(userId)) return res.status(429).json({ error: "留言太頻繁了，請稍等一下再留言。" });
    try {
      const post = await approvedPost(req.params.id);
      if (!post) return res.status(404).json({ error: "找不到這件作品。" });
      const [c] = await db.insert(showcaseComments).values({ postId: post.id, userId, body: parsed.data.body }).returning();
      await recount(post.id);
      res.json({ id: c.id });
    } catch {
      res.status(500).json({ error: "留言失敗。" });
    }
  });

  // Delete a comment: its writer, the work's maker, or an admin.
  app.delete("/api/showcase/comments/:id", requirePerson, async (req, res) => {
    try {
      const [c] = await db.select().from(showcaseComments).where(eq(showcaseComments.id, req.params.id)).limit(1);
      if (!c) return res.status(404).json({ error: "找不到這則留言。" });
      const [post] = await db.select({ userId: showcasePosts.userId }).from(showcasePosts).where(eq(showcasePosts.id, c.postId)).limit(1);
      const me = req.session.userId;
      if (c.userId !== me && post?.userId !== me && !isAdmin(req)) return res.status(403).json({ error: "無法刪除這則留言。" });
      await db.delete(showcaseComments).where(eq(showcaseComments.id, c.id));
      await recount(c.postId);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "刪除留言失敗。" });
    }
  });

  app.post("/api/showcase/posts/:id/report", requirePerson, async (req, res) => {
    const parsed = reportBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "檢舉原因太長了。" });
    try {
      const post = await approvedPost(req.params.id);
      if (!post) return res.status(404).json({ error: "找不到這件作品。" });
      await db.insert(showcaseReports).values({ postId: post.id, userId: req.session.userId!, reason: parsed.data.reason }).onConflictDoNothing();
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(showcaseReports).where(eq(showcaseReports.postId, post.id));
      // Enough reports take the work off the wall until an admin has looked at it.
      await db.update(showcasePosts).set({ reportCount: n, ...(n >= REPORTS_TO_HIDE ? { status: "pending" } : {}) }).where(eq(showcasePosts.id, post.id));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "檢舉失敗。" });
    }
  });

  /* ───────────────────────── follows and profile ───────────────────────── */

  app.post("/api/showcase/users/:username/follow", requirePerson, async (req, res) => {
    try {
      const u = await findUserByName(req.params.username);
      if (!u) return res.status(404).json({ error: "找不到這位創作者。" });
      if (u.id === req.session.userId) return res.status(400).json({ error: "不能追蹤自己。" });
      await db.insert(userFollows).values({ followerId: req.session.userId!, followingId: u.id }).onConflictDoNothing();
      res.json({ following: true });
    } catch {
      res.status(500).json({ error: "追蹤失敗。" });
    }
  });

  app.delete("/api/showcase/users/:username/follow", requirePerson, async (req, res) => {
    try {
      const u = await findUserByName(req.params.username);
      if (!u) return res.status(404).json({ error: "找不到這位創作者。" });
      await db.delete(userFollows).where(and(eq(userFollows.followerId, req.session.userId!), eq(userFollows.followingId, u.id)));
      res.json({ following: false });
    } catch {
      res.status(500).json({ error: "取消追蹤失敗。" });
    }
  });

  app.patch("/api/showcase/profile", requirePerson, async (req, res) => {
    const parsed = profileBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: `自我介紹最多 ${BIO_MAX} 個字。` });
    const problem = publicTextProblem(parsed.data.bio);
    if (problem) return res.status(400).json({ error: problem });
    try {
      await db.update(users).set({ bio: parsed.data.bio }).where(eq(users.id, req.session.userId!));
      res.json({ bio: parsed.data.bio });
    } catch {
      res.status(500).json({ error: "儲存失敗。" });
    }
  });

  /* ───────────────────────── review (admin) ───────────────────────── */

  app.get("/api/admin/showcase", requireAuth, requireAdmin, async (req, res) => {
    const status = z.enum(["pending", "approved", "rejected", "reported"]).catch("pending").parse(req.query.status);
    try {
      const where = status === "reported" ? gt(showcasePosts.reportCount, 0) : eq(showcasePosts.status, status);
      const rows = await db.select({
        id: showcasePosts.id, kind: showcasePosts.kind, mediaUrl: showcasePosts.mediaUrl, title: showcasePosts.title,
        prompt: showcasePosts.prompt, showPrompt: showcasePosts.showPrompt, status: showcasePosts.status,
        rejectReason: showcasePosts.rejectReason, reportCount: showcasePosts.reportCount, likeCount: showcasePosts.likeCount,
        createdAt: showcasePosts.createdAt, username: users.username, email: users.email,
      }).from(showcasePosts).innerJoin(users, eq(users.id, showcasePosts.userId))
        .where(where).orderBy(desc(showcasePosts.createdAt)).limit(200);
      const counts = await db.select({ status: showcasePosts.status, n: sql<number>`count(*)::int` }).from(showcasePosts).groupBy(showcasePosts.status);
      const [{ n: reported }] = await db.select({ n: sql<number>`count(*)::int` }).from(showcasePosts).where(gt(showcasePosts.reportCount, 0));
      res.json({ items: rows, counts: { ...Object.fromEntries(counts.map(c => [c.status, c.n])), reported } });
    } catch (e) {
      console.error("[Showcase] admin list failed:", e instanceof Error ? e.message : e);
      res.status(500).json({ error: "讀取失敗。" });
    }
  });

  app.post("/api/admin/showcase/:id/review", requireAuth, requireAdmin, async (req, res) => {
    const parsed = reviewBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "請選擇通過或退回。" });
    try {
      const [post] = await db.update(showcasePosts).set({
        status: parsed.data.action === "approve" ? "approved" : "rejected",
        rejectReason: parsed.data.action === "reject" ? parsed.data.reason || "不符合作品牆的公開規範" : null,
        reviewedAt: new Date(),
        // An approval after reports clears them: an admin has looked.
        ...(parsed.data.action === "approve" ? { reportCount: 0 } : {}),
      }).where(eq(showcasePosts.id, req.params.id)).returning();
      if (!post) return res.status(404).json({ error: "找不到這件作品。" });
      if (parsed.data.action === "approve") await db.delete(showcaseReports).where(eq(showcaseReports.postId, post.id));
      res.json({ id: post.id, status: post.status });
    } catch {
      res.status(500).json({ error: "審核失敗。" });
    }
  });
}

import { Link } from "wouter";
import { useUser } from "@/hooks/use-user";
import { NavigationHeader } from "@/components/AppNav";

// 作品牆共用的小元件：頁首（未登入也能看）、頭像、作品卡片。
// 頁面在 pages/wall.tsx、pages/wall-post.tsx、pages/creator.tsx，資料來自 server/showcase.ts。

export type Author = { username: string; avatarUrl: string | null };
export type PostCardData = {
  id: string; kind: string; mediaUrl: string; title: string; likeCount: number; commentCount: number;
  status: string; createdAt: string | null; author: Author; liked: boolean;
};
export type PostList = { items: PostCardData[]; total: number; page: number; pageSize: number };

/** Where a remixed prompt waits for the image page to pick it up (see pages/home.tsx). */
export const REMIX_KEY = "remixPrompt";

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/\{[\s\S]*\}/);
  if (m) {
    try { const j = JSON.parse(m[0]); if (typeof j.error === "string") return j.error; } catch { /* fall through */ }
  }
  return msg;
}

export function creatorPath(username: string): string {
  return `/u/${encodeURIComponent(username)}`;
}

/** Signed-in visitors get the normal navigation; everyone else a small bar with a sign-in button. */
export function ShowcaseHeader() {
  const { user } = useUser();
  if (user) return <NavigationHeader />;
  return (
    <header className="sticky top-0 z-40 glass border-b border-indigo-100/70" data-testid="showcase-public-header">
      <div className="max-w-7xl mx-auto h-14 px-4 md:px-6 flex items-center gap-4">
        <Link href="/">
          <span className="flex items-center gap-2.5 cursor-pointer">
            <span className="w-8 h-8 rounded-xl bg-brand shadow-glow text-white text-sm flex items-center justify-center"><i className="fas fa-wand-magic-sparkles" /></span>
            <span className="text-base font-bold text-slate-900">AI 創意工坊</span>
          </span>
        </Link>
        <Link href="/wall"><span className="text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer">作品牆</span></Link>
        <span className="flex-1" />
        <Link href="/login">
          <span className="inline-flex items-center h-9 px-4 rounded-full bg-indigo-600 text-white text-sm font-semibold cursor-pointer" data-testid="showcase-login">免費註冊／登入</span>
        </Link>
      </div>
    </header>
  );
}

export function Avatar({ author, size = "w-7 h-7 text-xs" }: { author: Author; size?: string }) {
  return author.avatarUrl
    ? <img src={author.avatarUrl} alt="" className={`${size} rounded-full object-cover shrink-0`} />
    : <span className={`${size} rounded-full bg-brand text-white font-semibold flex items-center justify-center shrink-0`}>{(author.username || "?").slice(0, 1).toUpperCase()}</span>;
}

export function PostCard({ post, showStatus = false }: { post: PostCardData; showStatus?: boolean }) {
  return (
    <Link href={`/wall/${post.id}`}>
      <span className="group block mb-3 break-inside-avoid rounded-2xl overflow-hidden bg-white border border-slate-200 cursor-pointer transition-all hover:border-indigo-300 hover:shadow-glow" data-testid={`wall-post-${post.id}`}>
        <span className="relative block bg-slate-100">
          {post.kind === "video"
            ? <video src={post.mediaUrl} muted playsInline preload="metadata" className="w-full block" />
            : <img src={post.mediaUrl} alt={post.title || "作品"} loading="lazy" className="w-full block" />}
          {post.kind === "video" && <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center"><i className="fas fa-play text-[10px]" /></span>}
          {showStatus && post.status !== "approved" && (
            <span className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] font-semibold ${post.status === "pending" ? "bg-amber-400 text-amber-950" : "bg-red-500 text-white"}`}>
              {post.status === "pending" ? "審核中" : "未通過"}
            </span>
          )}
        </span>
        <span className="block p-2.5">
          {post.title && <span className="block text-sm font-semibold text-slate-900 truncate">{post.title}</span>}
          <span className="flex items-center gap-2 mt-1 text-xs text-slate-500">
            <Avatar author={post.author} size="w-5 h-5 text-[10px]" />
            <span className="flex-1 min-w-0 truncate">{post.author.username}</span>
            <span className={post.liked ? "text-rose-500" : ""}><i className={`${post.liked ? "fas" : "far"} fa-heart mr-1`} />{post.likeCount}</span>
            <span><i className="far fa-comment mr-1" />{post.commentCount}</span>
          </span>
        </span>
      </span>
    </Link>
  );
}

/** Pinterest-style columns. */
export function PostGrid({ posts, showStatus }: { posts: PostCardData[]; showStatus?: boolean }) {
  return (
    <div className="columns-2 sm:columns-3 lg:columns-4 xl:columns-5 gap-3">
      {posts.map(p => <PostCard key={p.id} post={p} showStatus={showStatus} />)}
    </div>
  );
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 mt-6">
      <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm disabled:opacity-40">上一頁</button>
      <span className="text-sm text-slate-600">{page} / {pages}</span>
      <button onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages} className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-sm disabled:opacity-40">下一頁</button>
    </div>
  );
}

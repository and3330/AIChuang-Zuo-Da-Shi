import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/use-seo";
import { Avatar, REMIX_KEY, ShowcaseHeader, creatorPath, errorText, type Author } from "@/components/Showcase";

// 作品頁（/wall/:id）：大圖、作者、提示詞（作者有公開才看得到）、讚、留言、檢舉、做同款。
// 未登入也能看；要按讚、留言、追蹤、做同款會請你先登入。

type Comment = { id: string; body: string; createdAt: string | null; author: Author; canDelete: boolean };
type Post = {
  id: string; kind: string; mediaUrl: string; title: string; status: string; rejectReason: string | null;
  prompt: string | null; likeCount: number; commentCount: number; createdAt: string | null; author: Author;
  liked: boolean; following: boolean; isOwner: boolean; canModerate: boolean; comments: Comment[];
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-TW", { hour12: false, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function WallPostPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const key = `/api/showcase/posts/${id}`;
  const { data: post, isLoading, error } = useQuery<Post>({ queryKey: [key], queryFn: getQueryFn({ on401: "throw" }) });

  useSeo({
    title: `${post?.title || "作品"} - ${post?.author.username ?? ""} | AI 創意工坊作品牆`,
    description: post?.prompt ? post.prompt.slice(0, 120) : "AI 創意工坊作品牆上的公開作品。",
    keywords: "AI 作品,提示詞,作品牆",
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [key] });
    queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith("/api/showcase/posts?") });
  };
  /** Runs a signed-in action; sends visitors to sign in instead. */
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    if (!user) { navigate("/login"); return; }
    setBusy(true);
    try { await fn(); if (done) toast({ title: done }); refresh(); }
    catch (e) { toast({ title: "沒有完成", description: errorText(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  if (isLoading) return <div className="min-h-screen"><ShowcaseHeader /><p className="text-sm text-slate-400 text-center py-16">載入中…</p></div>;
  if (error || !post) {
    return (
      <div className="min-h-screen"><ShowcaseHeader />
        <div className="max-w-md mx-auto text-center py-16 px-4">
          <p className="text-sm text-slate-500">找不到這件作品，可能已經取消公開。</p>
          <Link href="/wall"><span className="inline-block mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium cursor-pointer">回作品牆</span></Link>
        </div>
      </div>
    );
  }

  const remix = () => {
    if (!post.prompt) return;
    try { window.sessionStorage.setItem(REMIX_KEY, post.prompt); } catch { /* storage blocked: the prompt can still be copied */ }
    navigate(user ? "/create/image" : "/login");
  };
  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(post.prompt ?? ""); toast({ title: "已複製提示詞" }); }
    catch { toast({ title: "無法自動複製", description: "請手動選取文字。", variant: "destructive" }); }
  };
  const submitComment = () => act(async () => {
    await apiRequest("POST", `${key}/comments`, { body: draft.trim() });
    setDraft("");
  });
  const unpublish = () => {
    if (!window.confirm("確定要把這件作品從作品牆拿掉嗎？讚和留言會一起刪除。")) return;
    act(async () => { await apiRequest("DELETE", key); navigate("/wall"); }, "已取消公開");
  };
  const report = () => {
    const reason = window.prompt("請簡單說明檢舉原因（可留空）：", "");
    if (reason === null) return;
    act(() => apiRequest("POST", `${key}/report`, { reason: reason.slice(0, 200) }), "已收到檢舉，我們會盡快查看");
  };

  return (
    <div className="min-h-screen pb-10">
      <ShowcaseHeader />
      <main className="max-w-6xl mx-auto px-3 sm:px-6 py-4 md:py-8">
        <Link href="/wall"><span className="inline-block text-sm text-slate-500 hover:text-slate-800 cursor-pointer mb-3">← 回作品牆</span></Link>

        {post.status !== "approved" && (
          <p className={`text-sm rounded-2xl px-4 py-3 mb-4 border ${post.status === "pending" ? "text-amber-800 bg-amber-50 border-amber-200" : "text-red-700 bg-red-50 border-red-200"}`} data-testid="post-status">
            {post.status === "pending" ? "這件作品正在審核中，通過後才會出現在作品牆。現在只有你看得到。" : `這件作品沒有通過審核${post.rejectReason ? `：${post.rejectReason}` : "。"}`}
          </p>
        )}

        <div className="grid lg:grid-cols-[1fr_380px] gap-5 items-start">
          <div className="bg-slate-900 rounded-3xl overflow-hidden flex items-center justify-center min-h-[240px]">
            {post.kind === "video"
              ? <video src={post.mediaUrl} controls playsInline className="max-w-full max-h-[80vh]" />
              : <img src={post.mediaUrl} alt={post.title || "作品"} className="max-w-full max-h-[80vh] object-contain" />}
          </div>

          <div className="space-y-4">
            <section className="bg-white border border-slate-200 rounded-3xl p-5">
              {post.title && <h1 className="text-lg font-bold text-slate-900 mb-3">{post.title}</h1>}
              <div className="flex items-center gap-3">
                <Link href={creatorPath(post.author.username)}>
                  <span className="flex items-center gap-2.5 min-w-0 cursor-pointer" data-testid="post-author">
                    <Avatar author={post.author} size="w-10 h-10 text-sm" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900 truncate">{post.author.username}</span>
                      <span className="block text-xs text-slate-400">{when(post.createdAt)}</span>
                    </span>
                  </span>
                </Link>
                <span className="flex-1" />
                {!post.isOwner && (
                  <button disabled={busy} onClick={() => act(() => apiRequest(post.following ? "DELETE" : "POST", `/api/showcase/users/${encodeURIComponent(post.author.username)}/follow`))}
                    className={`h-9 px-4 rounded-full text-sm font-semibold ${post.following ? "border border-slate-200 text-slate-600" : "bg-slate-900 text-white"}`} data-testid="post-follow">
                    {post.following ? "追蹤中" : "追蹤"}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 mt-4">
                <button disabled={busy || post.status !== "approved"} onClick={() => act(() => apiRequest(post.liked ? "DELETE" : "POST", `${key}/like`))}
                  className={`h-11 rounded-xl border text-sm font-semibold disabled:opacity-40 ${post.liked ? "border-rose-300 bg-rose-50 text-rose-600" : "border-slate-200 text-slate-700 hover:border-rose-300"}`} data-testid="post-like">
                  <i className={`${post.liked ? "fas" : "far"} fa-heart mr-2`} />{post.likeCount}
                </button>
                {post.prompt ? (
                  <button onClick={remix} className="h-11 rounded-xl bg-indigo-600 text-white text-sm font-semibold" data-testid="post-remix">
                    <i className="fas fa-wand-magic-sparkles mr-2 text-xs" />{user ? "做同款" : "登入做同款"}
                  </button>
                ) : (
                  <span className="h-11 rounded-xl bg-slate-100 text-slate-400 text-xs flex items-center justify-center">作者沒有公開提示詞</span>
                )}
              </div>

              {post.prompt && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-slate-600">提示詞</p>
                    <button onClick={copyPrompt} className="text-xs text-indigo-600 hover:underline" data-testid="post-copy-prompt">複製</button>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-48 overflow-auto whitespace-pre-wrap">{post.prompt}</p>
                </div>
              )}

              <div className="flex items-center gap-4 mt-4 text-xs text-slate-400">
                {(post.isOwner || post.canModerate) && <button onClick={unpublish} className="hover:text-red-600" data-testid="post-unpublish"><i className="fas fa-eye-slash mr-1" />取消公開</button>}
                {!post.isOwner && post.status === "approved" && <button onClick={report} className="hover:text-red-600" data-testid="post-report"><i className="far fa-flag mr-1" />檢舉</button>}
              </div>
            </section>

            <section className="bg-white border border-slate-200 rounded-3xl p-5" data-testid="post-comments">
              <h2 className="text-sm font-bold text-slate-900 mb-3">留言 {post.commentCount}</h2>
              {post.status === "approved" && (
                user ? (
                  <div className="flex gap-2 mb-4">
                    <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={300} placeholder="說點什麼…"
                      onKeyDown={e => { if (e.key === "Enter" && draft.trim() && !busy) submitComment(); }}
                      className="flex-1 min-w-0 h-11 px-3 border border-slate-200 rounded-xl text-sm" data-testid="input-comment" />
                    <button onClick={submitComment} disabled={busy || !draft.trim()} className="h-11 px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-comment">送出</button>
                  </div>
                ) : (
                  <Link href="/login"><span className="block text-center text-sm text-indigo-600 border border-indigo-200 rounded-xl py-2.5 mb-4 cursor-pointer">登入後可以留言</span></Link>
                )
              )}
              {post.comments.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">還沒有留言。</p>
              ) : (
                <ul className="space-y-3">
                  {post.comments.map(c => (
                    <li key={c.id} className="flex gap-2.5" data-testid={`comment-${c.id}`}>
                      <Link href={creatorPath(c.author.username)}><span className="cursor-pointer"><Avatar author={c.author} /></span></Link>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-500">
                          <Link href={creatorPath(c.author.username)}><span className="font-semibold text-slate-800 cursor-pointer">{c.author.username}</span></Link>
                          <span className="ml-2 text-slate-400">{when(c.createdAt)}</span>
                          {c.canDelete && <button onClick={() => act(() => apiRequest("DELETE", `/api/showcase/comments/${c.id}`))} className="ml-2 text-slate-400 hover:text-red-600">刪除</button>}
                        </p>
                        <p className="text-sm text-slate-700 break-words whitespace-pre-wrap">{c.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

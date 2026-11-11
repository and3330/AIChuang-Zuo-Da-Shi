import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/use-seo";
import { Avatar, Pager, PostGrid, ShowcaseHeader, errorText, type PostCardData, type PostList } from "@/components/Showcase";

// 創作者主頁（/u/:username）：頭像、自我介紹、作品數／獲讚／粉絲／追蹤中、追蹤按鈕、公開作品。
// 自己的主頁可以改自我介紹，並多一個「我的投稿」分頁看審核中與未通過的作品。

type Profile = {
  username: string; avatarUrl: string | null; bio: string; joinedAt: string | null;
  counts: { posts: number; likes: number; followers: number; following: number };
  isSelf: boolean; isFollowing: boolean;
};
type Mine = { items: Array<Omit<PostCardData, "author" | "liked"> & { rejectReason: string | null }> };

export default function CreatorPage() {
  const { username = "" } = useParams<{ username: string }>();
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"public" | "mine">("public");
  const [editing, setEditing] = useState(false);
  const [bioDraft, setBioDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const profileKey = `/api/showcase/users/${encodeURIComponent(username)}`;
  const { data: profile, isLoading, error } = useQuery<Profile>({ queryKey: [profileKey], queryFn: getQueryFn({ on401: "throw" }) });
  const { data: posts } = useQuery<PostList>({
    queryKey: [`/api/showcase/posts?sort=latest&author=${encodeURIComponent(username)}&page=${page}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const { data: mine } = useQuery<Mine>({ queryKey: ["/api/showcase/mine"], enabled: !!profile?.isSelf });

  useSeo({
    title: `${username} 的作品 | AI 創意工坊作品牆`,
    description: profile?.bio || `${username} 在 AI 創意工坊公開分享的 AI 作品。`,
    keywords: "AI 創作者,AI 作品,作品牆",
  });

  if (isLoading) return <div className="min-h-screen"><ShowcaseHeader /><p className="text-sm text-slate-400 text-center py-16">載入中…</p></div>;
  if (error || !profile) {
    return (
      <div className="min-h-screen"><ShowcaseHeader />
        <div className="max-w-md mx-auto text-center py-16 px-4">
          <p className="text-sm text-slate-500">找不到這位創作者。</p>
          <Link href="/wall"><span className="inline-block mt-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium cursor-pointer">回作品牆</span></Link>
        </div>
      </div>
    );
  }

  const toggleFollow = async () => {
    if (!user) { navigate("/login"); return; }
    setBusy(true);
    try {
      await apiRequest(profile.isFollowing ? "DELETE" : "POST", `${profileKey}/follow`);
      queryClient.invalidateQueries({ queryKey: [profileKey] });
    } catch (e) { toast({ title: "沒有完成", description: errorText(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const saveBio = async () => {
    setBusy(true);
    try {
      await apiRequest("PATCH", "/api/showcase/profile", { bio: bioDraft.trim() });
      queryClient.invalidateQueries({ queryKey: [profileKey] });
      setEditing(false);
      toast({ title: "自我介紹已更新" });
    } catch (e) { toast({ title: "沒有儲存", description: errorText(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const author = { username: profile.username, avatarUrl: profile.avatarUrl };
  const minePosts: PostCardData[] = (mine?.items ?? []).map(m => ({ ...m, createdAt: m.createdAt ? String(m.createdAt) : null, author, liked: false }));
  const waiting = minePosts.filter(m => m.status !== "approved").length;
  const stat = (n: number, label: string) => (
    <span className="text-center"><span className="block text-lg font-bold text-slate-900 tabular-nums">{n.toLocaleString()}</span><span className="block text-[11px] text-slate-500">{label}</span></span>
  );
  const items = posts?.items ?? [];
  const pages = posts ? Math.max(1, Math.ceil(posts.total / posts.pageSize)) : 1;

  return (
    <div className="min-h-screen pb-10">
      <ShowcaseHeader />
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-5 md:py-8">
        <section className="bg-white border border-indigo-100 rounded-3xl p-5 md:p-6 mb-5" data-testid="creator-profile">
          <div className="flex items-start gap-4 flex-wrap">
            <Avatar author={author} size="w-16 h-16 text-2xl" />
            <div className="flex-1 min-w-[200px]">
              <h1 className="text-xl font-bold text-slate-900 break-all">{profile.username}</h1>
              {editing ? (
                <div className="mt-2">
                  <textarea value={bioDraft} onChange={e => setBioDraft(e.target.value)} maxLength={160} rows={3} placeholder="介紹一下你自己和你的創作風格（最多 160 字）"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" data-testid="input-bio" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={saveBio} disabled={busy} className="h-9 px-4 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-40" data-testid="button-save-bio">儲存</button>
                    <button onClick={() => setEditing(false)} className="h-9 px-4 rounded-lg border border-slate-200 text-sm text-slate-600">取消</button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap break-words">{profile.bio || (profile.isSelf ? "還沒有自我介紹。" : "這位創作者還沒有寫自我介紹。")}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {profile.isSelf ? (
                !editing && <button onClick={() => { setBioDraft(profile.bio); setEditing(true); }} className="h-10 px-4 rounded-full border border-slate-200 text-sm text-slate-700 hover:border-indigo-300" data-testid="button-edit-bio">編輯自我介紹</button>
              ) : (
                <button onClick={toggleFollow} disabled={busy} className={`h-10 px-6 rounded-full text-sm font-semibold ${profile.isFollowing ? "border border-slate-200 text-slate-600" : "bg-slate-900 text-white"}`} data-testid="button-follow">
                  {profile.isFollowing ? "追蹤中" : "追蹤"}
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-5 max-w-md">
            {stat(profile.counts.posts, "作品")}
            {stat(profile.counts.likes, "獲讚")}
            {stat(profile.counts.followers, "粉絲")}
            {stat(profile.counts.following, "追蹤中")}
          </div>
        </section>

        {profile.isSelf && (
          <div className="flex gap-2 mb-5 flex-wrap">
            {(["public", "mine"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-full text-sm font-medium border ${tab === t ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"}`} data-testid={`creator-tab-${t}`}>
                {t === "public" ? "公開作品" : `我的投稿${waiting ? `（${waiting} 件審核中或未通過）` : ""}`}
              </button>
            ))}
            <Link href="/vault"><span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-600 text-white text-sm font-semibold cursor-pointer"><i className="fas fa-upload text-xs" />公開更多作品</span></Link>
          </div>
        )}

        {profile.isSelf && tab === "mine" ? (
          minePosts.length === 0
            ? <p className="text-sm text-slate-400 text-center py-12">你還沒有投稿。到作品庫打開一件作品，按「公開到作品牆」。</p>
            : <PostGrid posts={minePosts} showStatus />
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-12">還沒有公開作品。</p>
        ) : (
          <>
            <PostGrid posts={items} />
            <Pager page={page} pages={pages} onPage={setPage} />
          </>
        )}
      </main>
    </div>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { useSeo } from "@/hooks/use-seo";
import { Pager, PostGrid, ShowcaseHeader, creatorPath, type PostList } from "@/components/Showcase";

// 作品牆（/wall）：創作者自己選擇公開、且通過審核的作品。未登入也能看。
// 最新、熱門、追蹤中三種排序；點作品進作品頁（/wall/:id）。

type Sort = "latest" | "hot" | "following";

export default function WallPage() {
  const { user } = useUser();
  const [sort, setSort] = useState<Sort>("hot");
  const [page, setPage] = useState(1);

  useSeo({
    title: "作品牆 - 看看大家用 AI 做了什麼 | AI 創意工坊",
    description: "AI 創意工坊作品牆：創作者公開分享的 AI 圖片與影片，可以看提示詞、一鍵做同款。",
    keywords: "AI 作品,AI 圖片,提示詞,作品牆",
  });

  const { data, isLoading, error } = useQuery<PostList>({
    queryKey: [`/api/showcase/posts?sort=${sort}&page=${page}`],
    queryFn: getQueryFn({ on401: "throw" }),
  });
  const items = data?.items ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const tab = (id: Sort, label: string, icon: string) => (
    <button key={id} onClick={() => { setSort(id); setPage(1); }}
      className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors ${sort === id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300"}`}
      data-testid={`wall-tab-${id}`}>
      <i className={`fas ${icon} text-xs`} />{label}
    </button>
  );

  return (
    <div className="min-h-screen pb-10">
      <ShowcaseHeader />
      <main className="max-w-7xl mx-auto px-3 sm:px-6 py-5 md:py-8">
        <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">作品牆</h1>
            <p className="text-sm text-slate-500 mt-1">大家公開分享的作品。看到喜歡的，點進去可以看提示詞、做同款。</p>
          </div>
          {user ? (
            <div className="flex items-center gap-2">
              <Link href={creatorPath(user.username)}><span className="inline-flex items-center h-10 px-4 rounded-full border border-slate-200 bg-white text-sm text-slate-700 cursor-pointer hover:border-indigo-300" data-testid="wall-my-page">我的主頁</span></Link>
              <Link href="/vault"><span className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-indigo-600 text-white text-sm font-semibold cursor-pointer" data-testid="wall-publish"><i className="fas fa-upload text-xs" />公開我的作品</span></Link>
            </div>
          ) : (
            <Link href="/login"><span className="inline-flex items-center h-10 px-5 rounded-full bg-indigo-600 text-white text-sm font-semibold cursor-pointer">免費註冊，開始創作</span></Link>
          )}
        </div>

        <div className="flex gap-2 mb-5 flex-wrap">
          {tab("hot", "熱門", "fa-fire")}
          {tab("latest", "最新", "fa-clock")}
          {user && tab("following", "追蹤中", "fa-user-check")}
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-400 text-center py-16">載入中…</p>
        ) : error ? (
          <p className="text-sm text-red-500 text-center py-16">作品牆讀取失敗，請稍後再試。</p>
        ) : items.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
            <i className="fas fa-images text-3xl text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">
              {sort === "following" ? "你追蹤的創作者還沒有公開作品。到熱門看看，追蹤喜歡的創作者。" : "這裡還沒有作品，來當第一個公開作品的人。"}
            </p>
            {user && sort !== "following" && <p className="text-xs text-slate-400 mt-2">到作品庫打開一件作品，按「公開到作品牆」。</p>}
          </div>
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

import { useState } from "react";
import { useEmbed } from "@/components/EmbedBar";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { hasGoldAccess, inGoldZone } from "@/lib/zone";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// 全站唯一的導覽。所有登入後的頁面都用這一組，不要在個別頁面另外寫頁首。
//
// 模組分層：
//   主要模組   創作（圖片／影片）、寫真工作室、漫劇工作室、素材圖庫 —— 桌面導覽列與手機底部分頁
//   個人專區   作品庫、編輯器、帳戶與儲值、交易記錄 —— 桌面的使用者選單、手機的「我的」
//   次要素材   角色庫、場景庫 —— 桌面的「素材」選單、手機的「我的」
//
//   桌面（md 以上）：頂部導覽列。
//   手機（md 以下）：上方精簡標題列（子頁面有返回鍵），下方五格底部分頁列。
//
// 新增頁面時只要在 DESTINATIONS 加一筆，桌面與手機的導覽、頁面標題就會一起更新。

type Group = "main" | "me" | "assets" | "admin";
type Destination = {
  href: string;
  label: string;
  /** Short label for the mobile tab bar. */
  short?: string;
  icon: string;
  group: Group;
  adminOnly?: boolean;
  /** Listed only for gold members (and admins). */
  goldOnly?: boolean;
};

export const DESTINATIONS: Destination[] = [
  { href: "/", label: "創作", icon: "fa-wand-magic-sparkles", group: "main" },
  { href: "/photoset", label: "寫真工作室", short: "寫真", icon: "fa-camera-retro", group: "main" },
  { href: "/product", label: "商品帶貨", short: "商品", icon: "fa-bag-shopping", group: "main" },
  { href: "/drama", label: "漫劇工作室", short: "漫劇", icon: "fa-film", group: "main" },
  { href: "/library", label: "素材圖庫", short: "圖庫", icon: "fa-images", group: "main" },
  { href: "/wall", label: "作品牆", icon: "fa-globe", group: "main" },
  { href: "/vault", label: "作品庫", icon: "fa-photo-film", group: "me" },
  { href: "/edit", label: "編輯器", icon: "fa-pen-ruler", group: "me" },
  { href: "/store", label: "會員商城", icon: "fa-store", group: "me" },
  { href: "/account", label: "帳戶設定", icon: "fa-user-gear", group: "me" },
  { href: "/transactions", label: "交易記錄", icon: "fa-receipt", group: "me" },
  { href: "/character-library", label: "角色庫", icon: "fa-user-group", group: "assets" },
  { href: "/scene-library", label: "場景庫", icon: "fa-mountain-sun", group: "assets" },
  { href: "/gold", label: "黃金專區", icon: "fa-crown", group: "admin", goldOnly: true },
  { href: "/admin", label: "管理後台", icon: "fa-gear", group: "admin", adminOnly: true },
];

/** The main modules: desktop bar and the first four mobile tabs. */
const PRIMARY = ["/", "/photoset", "/drama", "/library"];
/** Desktop bar only: the phone tab bar has room for four, so 商品帶貨 and 作品牆 are in the 「我的」 sheet there. */
const DESKTOP_PRIMARY = ["/", "/photoset", "/product", "/drama", "/library", "/wall"];
/** Shortcuts shown as tiles at the top of the mobile 「我的」 sheet. */
const QUICK = ["/vault", "/edit", "/character-library", "/scene-library"];

/** The gold zone: the same pages as the ordinary ones, under /gold. */
const GOLD_PAGES = [
  { href: "/gold/image", label: "圖片生成", icon: "fa-image" },
  { href: "/gold/video", label: "影片生成", icon: "fa-clapperboard" },
  { href: "/gold/photoset", label: "寫真工作室", icon: "fa-camera-retro" },
  { href: "/gold/library", label: "素材圖庫", icon: "fa-images" },
];

/** Pages reached from another page. They show a back button on phones. */
const SUBPAGES: Destination[] = [
  { href: "/ugc", label: "UGC 實拍短片", icon: "fa-mobile-screen", group: "main" },
  { href: "/create/image", label: "圖片生成", icon: "fa-image", group: "main" },
  { href: "/create/video", label: "影片生成", icon: "fa-clapperboard", group: "main" },
  ...GOLD_PAGES.map(g => ({ href: g.href, label: `黃金・${g.label}`, icon: g.icon, group: "admin" as Group })),
];

function find(href: string): Destination {
  return DESTINATIONS.find(d => d.href === href)!;
}

function isActive(location: string, href: string): boolean {
  if (href === "/") return location === "/" || location.startsWith("/create/");
  return location === href || location.startsWith(href + "/");
}

function currentDestination(location: string): Destination | undefined {
  return SUBPAGES.find(d => location === d.href) ?? DESTINATIONS.find(d => isActive(location, d.href));
}

function useLogout() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  return async () => {
    try { await apiRequest("POST", "/api/auth/logout"); } catch { /* the session may already be gone */ }
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    setLocation("/");
  };
}

function Logo({ size = "w-8 h-8 text-sm" }: { size?: string }) {
  return (
    <span className={`${size} rounded-xl bg-brand shadow-glow text-white flex items-center justify-center shrink-0`}>
      <i className="fas fa-wand-magic-sparkles" />
    </span>
  );
}

function CreditsPill({ credits }: { credits: number }) {
  const embed = useEmbed();
  // 從客戶小鎮進來的工作區：點數在小鎮，這裡不能儲值，點了回小鎮看點數。
  if (embed) return (
    <a href={`${embed.returnOrigin}/insights`} target="_blank" rel="noreferrer"
      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold hover:border-amber-300" data-testid="pill-credits-embed" title="這是你在客戶小鎮的點數，點擊回小鎮儲值">
      <i className="fas fa-coins text-amber-500 text-xs" />
      {credits.toLocaleString()}
      <span className="text-[11px] font-medium text-amber-600">回小鎮儲值</span>
    </a>
  );
  return (
    <Link href="/store">
      <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold cursor-pointer hover:border-amber-300" data-testid="pill-credits" title="積分餘額，點擊前往儲值">
        <i className="fas fa-coins text-amber-500 text-xs" />
        {credits.toLocaleString()}
      </span>
    </Link>
  );
}

function MenuLink({ d }: { d: Destination }) {
  return (
    <Link href={d.href}>
      <DropdownMenuItem className="cursor-pointer gap-2" data-testid={`menu-${d.href}`}>
        <i className={`fas ${d.icon} w-4 text-center text-slate-400`} />{d.label}
      </DropdownMenuItem>
    </Link>
  );
}

/* ───────────────────────── top bar (desktop nav + mobile title bar) ───────────────────────── */

export function NavigationHeader() {
  const { user } = useUser();
  const [location] = useLocation();
  const logout = useLogout();
  if (!user) return null;

  const visible = DESTINATIONS.filter(d => (!d.adminOnly || user.isAdmin) && (!d.goldOnly || hasGoldAccess(user)));
  const inGroup = (g: Group) => visible.filter(d => d.group === g);
  const here = currentDestination(location);
  const isRootTab = !!here && PRIMARY.includes(here.href) && !SUBPAGES.includes(here);
  const assetsActive = [...inGroup("assets"), ...inGroup("admin")].some(d => isActive(location, d.href));
  const meActive = inGroup("me").some(d => isActive(location, d.href));
  const navCls = (active: boolean) =>
    `relative inline-flex items-center gap-2 h-9 px-2.5 lg:px-3 rounded-lg text-sm font-medium cursor-pointer whitespace-nowrap transition-colors ${active ? "text-indigo-700 bg-indigo-50" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`;

  return (
    <header className="sticky top-0 z-40 glass border-b border-indigo-100/70 pt-[env(safe-area-inset-top)]" data-testid="app-header">
      {/* ── 手機：標題列 ── */}
      <div className="md:hidden h-12 px-2 flex items-center gap-1.5">
        {isRootTab || !here ? (
          <Link href="/"><span className="w-10 h-10 flex items-center justify-center cursor-pointer" aria-label="回到首頁"><Logo size="w-7 h-7 text-xs" /></span></Link>
        ) : (
          <button onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.href = "/"))}
            className="w-10 h-10 flex items-center justify-center rounded-full text-slate-700 active:bg-slate-100" aria-label="返回" data-testid="button-back">
            <i className="fas fa-chevron-left" />
          </button>
        )}
        <h1 className="flex-1 min-w-0 text-[17px] font-semibold text-slate-900 truncate">{here?.href === "/" ? "AI 創意工坊" : here?.label ?? "AI 創意工坊"}</h1>
        <CreditsPill credits={user.credits ?? 0} />
      </div>

      {/* ── 桌面：導覽列 ── */}
      <div className="hidden md:flex max-w-7xl mx-auto h-14 px-6 items-center gap-5">
        <Link href="/">
          <span className="flex items-center gap-2.5 cursor-pointer shrink-0">
            <Logo />
            <span className="text-base font-bold text-slate-900 hidden lg:inline">AI 創意工坊</span>
          </span>
        </Link>
        <nav className="flex items-center gap-0.5 lg:gap-1 flex-1 min-w-0">
          {DESKTOP_PRIMARY.map(find).map(d => {
            const active = isActive(location, d.href);
            return (
              <Link key={d.href} href={d.href}>
                <span className={navCls(active)} aria-current={active ? "page" : undefined} data-testid={`nav-${d.href}`}>
                  <i className={`fas ${d.icon} text-xs hidden lg:inline-block ${active ? "text-indigo-600" : "text-slate-400"}`} />
                  {/* Six entries only fit with the full names on wide screens. */}
                  <span className="xl:hidden">{d.short ?? d.label}</span>
                  <span className="hidden xl:inline">{d.label}</span>
                  {active && <span className="absolute -bottom-[11px] inset-x-3 h-0.5 rounded-full bg-brand" />}
                </span>
              </Link>
            );
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={navCls(assetsActive)} data-testid="nav-more">
                <i className={`fas fa-layer-group text-xs hidden lg:inline-block ${assetsActive ? "text-indigo-600" : "text-slate-400"}`} />
                角色與場景 <i className="fas fa-chevron-down text-[10px]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {inGroup("assets").map(d => <MenuLink key={d.href} d={d} />)}
              {inGroup("admin").length > 0 && <DropdownMenuSeparator />}
              {inGroup("admin").map(d => <MenuLink key={d.href} d={d} />)}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        <div className="flex items-center gap-3 shrink-0">
          <CreditsPill credits={user.credits ?? 0} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={`flex items-center gap-2 h-9 pl-1 pr-2.5 rounded-full border ${meActive ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:border-indigo-300"}`} data-testid="button-user-menu">
                <span className="w-7 h-7 rounded-full bg-brand text-white text-xs font-semibold flex items-center justify-center">
                  {(user.username || "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="text-sm font-medium text-slate-700">我的</span>
                <i className="fas fa-chevron-down text-[10px] text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="truncate">{user.username}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {inGroup("me").map(d => <MenuLink key={d.href} d={d} />)}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="cursor-pointer gap-2 text-red-600 focus:text-red-600" data-testid="button-logout">
                <i className="fas fa-arrow-right-from-bracket w-4 text-center" />登出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* ── 黃金專區：專區內的頁面切換 ── */}
      {inGoldZone(location) && hasGoldAccess(user) && (
        <div className="border-t border-amber-200/70 bg-amber-50/90" data-testid="gold-zone-bar">
          <div className="max-w-7xl mx-auto h-10 px-2 md:px-6 flex items-center gap-1 overflow-x-auto whitespace-nowrap text-sm">
            <Link href="/gold">
              <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-amber-400 text-amber-950 text-xs font-bold cursor-pointer shrink-0">
                <i className="fas fa-crown text-[10px]" />黃金專區
              </span>
            </Link>
            {GOLD_PAGES.map(g => {
              const active = location === g.href;
              return (
                <Link key={g.href} href={g.href}>
                  <span className={`inline-flex items-center h-7 px-2.5 rounded-full cursor-pointer shrink-0 ${active ? "bg-white text-amber-900 font-semibold shadow-sm" : "text-amber-800 hover:bg-white/70"}`} aria-current={active ? "page" : undefined} data-testid={`gold-nav-${g.href}`}>
                    {g.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}

/* ───────────────────────── mobile bottom tab bar ───────────────────────── */

export default function MobileTabBar() {
  const { user } = useUser();
  const [location] = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const logout = useLogout();
  if (!user) return null;

  const tabs = PRIMARY.map(find);
  const visible = DESTINATIONS.filter(d => (!d.adminOnly || user.isAdmin) && (!d.goldOnly || hasGoldAccess(user)));
  const rest = visible.filter(d => !PRIMARY.includes(d.href));
  const meActive = rest.some(d => isActive(location, d.href));
  const quick = QUICK.map(find);
  const listed = rest.filter(d => !QUICK.includes(d.href));

  const tabCls = (active: boolean) => `flex-1 h-full flex flex-col items-center justify-center gap-0.5 select-none ${active ? "text-indigo-600" : "text-slate-400 active:text-slate-600"}`;
  const iconCls = (active: boolean) => `h-7 w-12 rounded-full flex items-center justify-center transition-all ${active ? "bg-brand text-white shadow-glow" : ""}`;

  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 glass border-t border-indigo-100/70 pb-[env(safe-area-inset-bottom)]" aria-label="主要導覽" data-testid="mobile-tab-bar">
        <div className="flex items-stretch h-14">
          {tabs.map(tab => {
            const active = isActive(location, tab.href);
            return (
              <Link key={tab.href} href={tab.href} className={tabCls(active)} aria-current={active ? "page" : undefined} data-testid={`tab-${tab.href}`}>
                <span className={iconCls(active)}><i className={`fas ${tab.icon} text-[16px]`} /></span>
                <span className={`text-[10px] leading-none ${active ? "font-semibold" : "font-medium"}`}>{tab.short ?? tab.label}</span>
              </Link>
            );
          })}
          <button onClick={() => setSheetOpen(true)} className={tabCls(meActive)} aria-haspopup="dialog" data-testid="tab-me">
            <span className={iconCls(meActive)}><i className="fas fa-user text-[16px]" /></span>
            <span className={`text-[10px] leading-none ${meActive ? "font-semibold" : "font-medium"}`}>我的</span>
          </button>
        </div>
      </nav>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="md:hidden rounded-t-3xl px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))] max-h-[85vh] overflow-y-auto">
          <div className="mx-auto w-10 h-1 rounded-full bg-slate-200 mb-3" />
          <SheetHeader className="text-left mb-3">
            <SheetTitle className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-full bg-brand text-white text-base font-semibold flex items-center justify-center">{(user.username || "?").slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-base text-slate-900 truncate">{user.username}</span>
                <span className="block text-xs font-normal text-slate-500">積分 {(user.credits ?? 0).toLocaleString()}</span>
              </span>
              <Link href="/store" onClick={() => setSheetOpen(false)}>
                <span className="h-9 px-4 rounded-full bg-brand text-white text-xs font-semibold flex items-center shadow-glow">儲值</span>
              </Link>
            </SheetTitle>
          </SheetHeader>

          {/* 最常去的四個地方：一按就到 */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            {quick.map(d => {
              const active = isActive(location, d.href);
              return (
                <Link key={d.href} href={d.href} onClick={() => setSheetOpen(false)}>
                  <span className={`flex flex-col items-center gap-1.5 py-3 rounded-2xl border ${active ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white active:bg-slate-50"}`} data-testid={`quick-${d.href}`}>
                    <span className="w-9 h-9 rounded-xl bg-brand-soft text-indigo-600 flex items-center justify-center"><i className={`fas ${d.icon}`} /></span>
                    <span className="text-[11px] font-medium text-slate-700">{d.label}</span>
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="bg-slate-50 rounded-2xl divide-y divide-slate-200/70 overflow-hidden mb-3">
            {listed.map(d => (
              <Link key={d.href} href={d.href} onClick={() => setSheetOpen(false)}>
                <span className={`flex items-center gap-3 h-12 px-4 active:bg-slate-100 ${isActive(location, d.href) ? "text-indigo-700 font-semibold" : "text-slate-800"}`} data-testid={`menu-${d.href}`}>
                  <i className={`fas ${d.icon} w-5 text-center text-slate-400`} />
                  <span className="flex-1 text-[15px]">{d.label}</span>
                  <i className="fas fa-chevron-right text-xs text-slate-300" />
                </span>
              </Link>
            ))}
          </div>
          <button onClick={() => { setSheetOpen(false); logout(); }} className="w-full h-12 rounded-2xl bg-slate-50 text-red-600 text-[15px] font-medium active:bg-slate-100" data-testid="button-logout-mobile">
            登出
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}

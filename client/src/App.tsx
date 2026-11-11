import { useState, useEffect, type ReactNode } from "react";
import { Switch, Route, Link, Redirect, useLocation } from "wouter";
import { queryClient, apiRequest, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import Home from "@/pages/home";
import CreateHub from "@/pages/create-hub";
import AccountPage from "@/pages/account";
import TransactionsPage from "@/pages/transactions";
import LandingPage from "@/pages/landing";
import AdminPage from "@/pages/admin";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
import DramaPage from "@/pages/drama";
import CharacterLibraryPage from "@/pages/character-library";
import SceneLibraryPage from "@/pages/scene-library";
import GoldHub from "@/pages/gold-hub";
import StorePage from "@/pages/store";
import WallPage from "@/pages/wall";
import WallPostPage from "@/pages/wall-post";
import CreatorPage from "@/pages/creator";
import { hasGoldAccess, inGoldZone } from "@/lib/zone";
import PhotosetPage from "@/pages/photoset";
import LibraryPage from "@/pages/library";
import VaultPage from "@/pages/vault";
import EditPage from "@/pages/edit";
import NotFound from "@/pages/not-found";
import ChatWidget from "@/components/ChatWidget";
import MobileTabBar from "@/components/MobileTabBar";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";
import EmbedBar, { useEmbed } from "@/components/EmbedBar";
import type { User } from "@shared/schema";

// Kept as a re-export so existing imports from "@/App" keep working.
export { useUser } from "@/hooks/use-user";
import { useUser } from "@/hooks/use-user";

function AuthPage() {
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendCode = async () => {
    if (!email) {
      setError("請先輸入電子郵件");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("請輸入有效的電子郵件地址");
      return;
    }

    setError("");
    setIsSendingCode(true);

    try {
      const res = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "驗證碼發送失敗");
        return;
      }
      setCodeSent(true);
      setCountdown(60);
      toast({ title: "驗證碼已發送", description: "請查看您的電子郵件信箱" });
    } catch {
      setError("驗證碼發送失敗，請稍後再試");
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      let userData: any;
      if (activeTab === "login") {
        const res = await apiRequest("POST", "/api/auth/login", { username, password });
        const data = await res.json();
        userData = data.user;
      } else {
        if (!email) {
          setError("請輸入電子郵件");
          setIsSubmitting(false);
          return;
        }
        if (!verificationCode || verificationCode.length !== 6) {
          setError("請輸入 6 位數驗證碼");
          setIsSubmitting(false);
          return;
        }
        const res = await apiRequest("POST", "/api/auth/register", { username, email, password, verificationCode });
        const data = await res.json();
        userData = data.user;
      }
      queryClient.setQueryData(["/api/auth/me"], userData);
      toast({
        title: activeTab === "login" ? "登入成功" : "註冊成功",
        description: activeTab === "register" ? "歡迎加入！已獲得 10 積分" : "歡迎回來！",
      });
    } catch (err: any) {
      const message = err?.message || "操作失敗，請稍後再試";
      if (message.includes("401") || message.includes("Unauthorized")) {
        setError("帳號或密碼錯誤");
      } else if (message.includes("已被註冊") || message.includes("already exists")) {
        setError("此帳號或電子郵件已被註冊");
      } else if (message.includes("驗證碼")) {
        setError("驗證碼無效或已過期，請重新獲取");
      } else if (message.includes("400")) {
        setError("請填寫所有必要欄位");
      } else {
        setError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const switchTab = (tab: "login" | "register") => {
    setActiveTab(tab);
    setError("");
    setUsername("");
    setEmail("");
    setPassword("");
    setVerificationCode("");
    setCodeSent(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <Card className="w-full max-w-md mx-4 shadow-xl">
        <CardHeader className="text-center pb-2">
          <Link href="/" className="text-sm text-gray-400 hover:text-purple-600 mb-3 inline-flex items-center gap-1">
            <i className="fas fa-arrow-left"></i> 返回首頁
          </Link>
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="text-3xl">✨</span>
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              AI 創意工坊
            </CardTitle>
          </div>
          <p className="text-gray-500 text-sm">AI 圖片與影片生成平台</p>
        </CardHeader>
        <CardContent>
          <div className="flex mb-6 bg-gray-100 rounded-lg p-1">
            <button
              type="button"
              onClick={() => switchTab("login")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === "login"
                  ? "bg-white text-purple-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              登入
            </button>
            <button
              type="button"
              onClick={() => switchTab("register")}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === "register"
                  ? "bg-white text-purple-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              註冊
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">帳號</label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="請輸入帳號"
                required
              />
            </div>

            {activeTab === "register" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">電子郵件</label>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="請輸入電子郵件"
                      required
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleSendCode}
                      disabled={isSendingCode || countdown > 0}
                      className="shrink-0 text-sm border-purple-300 text-purple-600 hover:bg-purple-50"
                    >
                      {isSendingCode
                        ? "發送中..."
                        : countdown > 0
                          ? `${countdown}s`
                          : codeSent
                            ? "重新發送"
                            : "取得驗證碼"}
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">驗證碼</label>
                  <Input
                    type="text"
                    value={verificationCode}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setVerificationCode(val);
                    }}
                    placeholder="請輸入 6 位數驗證碼"
                    required
                    maxLength={6}
                    className="tracking-[0.3em] text-center text-lg font-mono"
                  />
                  {codeSent && (
                    <p className="text-xs text-green-600 mt-1">驗證碼已發送至 {email}，有效期 10 分鐘</p>
                  )}
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="請輸入密碼"
                required
              />
            </div>

            {error && (
              <p className="text-red-500 text-sm text-center">{error}</p>
            )}

            {activeTab === "register" && (
              <p className="text-center text-sm text-purple-600 font-medium">
                🎁 註冊即送 10 積分！
              </p>
            )}

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              disabled={isSubmitting || (activeTab === "register" && !codeSent)}
            >
              {isSubmitting
                ? "處理中..."
                : activeTab === "login"
                  ? "登入"
                  : "註冊"}
            </Button>
          </form>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-3 text-gray-400">或</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full flex items-center justify-center gap-3 border-gray-300 hover:bg-gray-50 py-5"
            onClick={() => { window.location.href = "/api/auth/google"; }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            <span className="text-gray-700 font-medium">使用 Google 帳號登入</span>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser();
  if (isLoading) return null;
  if (!user?.isAdmin) return <Redirect to="/" />;
  return <>{children}</>;
}

/** Anyone who is not a gold member gets the ordinary 404, so the zone does not show it exists. */
function GoldOnly({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser();
  if (isLoading) return null;
  if (!hasGoldAccess(user)) return <NotFound />;
  return <>{children}</>;
}

// 嵌入模式（客戶小鎮的工作區）不能儲值、改帳號或進後台。成人內容由對方平台為該工作區開啟：
// 開啟後該子帳號就是黃金會員，一樣到黃金專區使用。
const EMBED_HIDDEN = ["/account", "/store", "/transactions", "/admin", "/wall", "/u"];

/** Support chat and the install prompt are for people with their own account. */
function PersonalExtras() {
  if (useEmbed()) return null;
  return (
    <>
      <ChatWidget />
      <PWAInstallPrompt />
    </>
  );
}

function Router() {
  const embed = useEmbed();
  const [location] = useLocation();
  // Gold-zone pages are the ordinary pages in gold: the class recolours the brand palette.
  const { user } = useUser();
  const gold = inGoldZone(location) && hasGoldAccess(user);
  useEffect(() => {
    document.documentElement.classList.toggle("gold-zone", gold);
    return () => document.documentElement.classList.remove("gold-zone");
  }, [gold]);

  if (embed && EMBED_HIDDEN.some(p => location === p || location.startsWith(p + "/"))) return <Redirect to="/" />;
  return (
    <Switch>
      <Route path="/" component={CreateHub} />
      <Route path="/create/image">{() => <Home key="image" section="image" />}</Route>
      <Route path="/create/video">{() => <Home key="video" section="video" />}</Route>
      <Route path="/drama" component={DramaPage} />
      <Route path="/character-library/sheet">{() => <PhotosetPage variant="sheet" />}</Route>
      <Route path="/character-library" component={CharacterLibraryPage} />
      <Route path="/scene-library" component={SceneLibraryPage} />
      <Route path="/photoset">{() => <PhotosetPage />}</Route>
      <Route path="/library" component={LibraryPage} />
      <Route path="/vault" component={VaultPage} />
      <Route path="/edit" component={EditPage} />
      {/* 黃金專區：和一般區同一套頁面，只有黃金會員進得來 */}
      <Route path="/gold">{() => <GoldOnly><GoldHub /></GoldOnly>}</Route>
      <Route path="/gold/image">{() => <GoldOnly><Home key="gold-image" section="image" /></GoldOnly>}</Route>
      <Route path="/gold/video">{() => <GoldOnly><Home key="gold-video" section="video" /></GoldOnly>}</Route>
      <Route path="/gold/photoset">{() => <GoldOnly><PhotosetPage key="gold-photoset" /></GoldOnly>}</Route>
      <Route path="/gold/library">{() => <GoldOnly><LibraryPage key="gold-library" /></GoldOnly>}</Route>
      <Route path="/wall" component={WallPage} />
      <Route path="/wall/:id" component={WallPostPage} />
      <Route path="/u/:username" component={CreatorPage} />
      <Route path="/store" component={StorePage} />
      <Route path="/account" component={AccountPage} />
      <Route path="/transactions" component={TransactionsPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/login">{() => <Redirect to="/" />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  const { user, isLoading } = useUser();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500">載入中...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={AuthPage} />
        {/* 作品牆不用登入也能看 */}
        <Route path="/wall" component={WallPage} />
        <Route path="/wall/:id" component={WallPostPage} />
        <Route path="/u/:username" component={CreatorPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/terms" component={TermsPage} />
        <Route component={LandingPage} />
      </Switch>
    );
  }

  return (
    <TooltipProvider>
      <Toaster />
      {/* On phones every page ends above the bottom tab bar. */}
      <div className="pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
        <Router />
      </div>
    </TooltipProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <AppContent />
      <MobileTabBar />
      <EmbedBar />
      <PersonalExtras />
    </QueryClientProvider>
  );
}

export default App;

import { useState, useEffect } from "react";
import { Switch, Route, Link, Redirect } from "wouter";
import { queryClient, apiRequest, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import Home from "@/pages/home";
import AccountPage from "@/pages/account";
import TransactionsPage from "@/pages/transactions";
import LandingPage from "@/pages/landing";
import AdminPage from "@/pages/admin";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
import NotFound from "@/pages/not-found";
import type { User } from "@shared/schema";

export function useUser() {
  const { data: user, isLoading, error } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });
  return { user, isLoading };
}

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
      if (activeTab === "login") {
        await apiRequest("POST", "/api/auth/login", { username, password });
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
        await apiRequest("POST", "/api/auth/register", { username, email, password, verificationCode });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
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
        </CardContent>
      </Card>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
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
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/terms" component={TermsPage} />
        <Route component={LandingPage} />
      </Switch>
    );
  }

  return (
    <TooltipProvider>
      <Toaster />
      <Router />
    </TooltipProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;

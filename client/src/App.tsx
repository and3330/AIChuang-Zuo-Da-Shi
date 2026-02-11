import { useState } from "react";
import { Switch, Route, Link } from "wouter";
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
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

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
        await apiRequest("POST", "/api/auth/register", { username, email, password });
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
      } else if (message.includes("409") || message.includes("already exists") || message.includes("Conflict")) {
        setError("此帳號或電子郵件已被註冊");
      } else if (message.includes("400")) {
        setError("請填寫所有必要欄位");
      } else {
        setError("操作失敗，請稍後再試");
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">電子郵件</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="請輸入電子郵件"
                  required
                />
              </div>
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
              disabled={isSubmitting}
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

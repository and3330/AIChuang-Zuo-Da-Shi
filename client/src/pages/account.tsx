import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import type { User } from "@shared/schema";

function NavigationHeader() {
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const handleLogout = async () => {
    await apiRequest("POST", "/api/auth/logout");
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    setLocation("/");
  };

  if (!user) return null;

  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl">✨</span>
            <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              AI 創意工坊
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <nav className="hidden sm:flex items-center gap-1">
              <Link href="/">
                <Button variant="ghost" size="sm" className="text-gray-600 hover:text-purple-600">
                  <i className="fas fa-home mr-1"></i> 首頁
                </Button>
              </Link>
              <Link href="/account">
                <Button variant="ghost" size="sm" className="text-purple-600 font-medium">
                  <i className="fas fa-user mr-1"></i> 帳戶
                </Button>
              </Link>
              <Link href="/transactions">
                <Button variant="ghost" size="sm" className="text-gray-600 hover:text-purple-600">
                  <i className="fas fa-history mr-1"></i> 交易記錄
                </Button>
              </Link>
            </nav>
            <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
              <span className="text-sm text-gray-600">{user.username}</span>
              <span className="flex items-center gap-1 bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 text-yellow-700 px-3 py-1 rounded-full text-sm font-medium">
                <i className="fas fa-coins text-yellow-500"></i>
                {user.credits ?? 0}
              </span>
              <Button variant="outline" size="sm" onClick={handleLogout} className="text-gray-500 hover:text-red-500">
                <i className="fas fa-sign-out-alt mr-1"></i> 登出
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export { NavigationHeader };

export default function AccountPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [isTopingUp, setIsTopingUp] = useState(false);
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get("payment");
    const amount = params.get("amount");
    if (payment === "success" && amount) {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/credits/transactions"] });
      toast({ title: "付款成功", description: `已成功充值 ${amount} 積分，積分將在幾秒內到帳` });
      window.history.replaceState({}, "", "/account");
    } else if (payment === "cancelled") {
      toast({ title: "付款已取消", description: "您可以隨時重新充值", variant: "destructive" });
      window.history.replaceState({}, "", "/account");
    }
  }, []);

  if (!user) return null;

  const presetAmounts = [50, 100, 200, 500];

  const finalAmount = selectedAmount ?? (customAmount ? parseInt(customAmount) : 0);

  const handleTopup = async () => {
    if (!finalAmount || finalAmount < 10) {
      toast({ title: "錯誤", description: "充值金額最少 10 積分", variant: "destructive" });
      return;
    }
    setIsTopingUp(true);
    try {
      const response = await apiRequest("POST", "/api/stripe/create-checkout", { amount: finalAmount });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast({ title: "錯誤", description: "無法建立付款頁面", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "充值失敗", description: err?.message || "請稍後再試", variant: "destructive" });
    } finally {
      setIsTopingUp(false);
    }
  };

  const registrationDate = user.createdAt ? new Date(user.createdAt).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }) : "未知";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <NavigationHeader />

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <i className="fas fa-user-circle text-purple-600"></i>
              帳戶資訊
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <i className="fas fa-user text-gray-400 w-5 text-center"></i>
                  <span className="text-sm text-gray-500">用戶名稱</span>
                  <span className="font-medium">{user.username}</span>
                </div>
                <div className="flex items-center gap-2">
                  <i className="fas fa-envelope text-gray-400 w-5 text-center"></i>
                  <span className="text-sm text-gray-500">電子郵件</span>
                  <span className="font-medium">{user.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <i className="fas fa-calendar text-gray-400 w-5 text-center"></i>
                  <span className="text-sm text-gray-500">註冊日期</span>
                  <span className="font-medium">{registrationDate}</span>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl p-6 border border-yellow-200">
                <i className="fas fa-coins text-4xl text-yellow-500 mb-2"></i>
                <span className="text-sm text-gray-500 mb-1">帳戶餘額</span>
                <span className="text-4xl font-bold text-yellow-600">{user.credits ?? 0}</span>
                <span className="text-sm text-gray-500">積分</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <i className="fas fa-plus-circle text-green-600"></i>
              積分充值
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-sm text-gray-500 mb-3">選擇充值金額</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {presetAmounts.map((amount) => (
                  <button
                    key={amount}
                    onClick={() => { setSelectedAmount(amount); setCustomAmount(""); }}
                    className={`py-3 px-4 rounded-lg border-2 text-center font-medium transition-all ${
                      selectedAmount === amount
                        ? "border-purple-500 bg-purple-50 text-purple-700"
                        : "border-gray-200 bg-white text-gray-700 hover:border-purple-300 hover:bg-purple-50"
                    }`}
                  >
                    <span className="text-lg font-bold">{amount}</span>
                    <span className="text-sm text-gray-500 block">積分</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-500 mb-2">或輸入自訂金額</p>
              <div className="flex gap-3">
                <Input
                  type="number"
                  placeholder="輸入積分數量"
                  value={customAmount}
                  onChange={(e) => { setCustomAmount(e.target.value); setSelectedAmount(null); }}
                  min={1}
                  className="flex-1"
                />
                <Button
                  onClick={handleTopup}
                  disabled={isTopingUp || !finalAmount || finalAmount < 10}
                  className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 px-8"
                >
                  {isTopingUp ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i>跳轉付款中...</>
                  ) : (
                    <><i className="fas fa-credit-card mr-2"></i>前往付款 (Stripe)</>
                  )}
                </Button>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                <i className="fas fa-info-circle mr-1"></i>
                1 積分 = 1 元新台幣，最低充值 10 積分。透過 Stripe 安全支付，支援信用卡/金融卡
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <i className="fas fa-tag text-blue-600"></i>
              服務定價
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">服務項目</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">價格</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      <i className="fas fa-image text-purple-500 mr-2"></i>
                      圖片生成
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">3 積分/張</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      <i className="fas fa-video text-blue-500 mr-2"></i>
                      5秒影片
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">10 積分/個</td>
                  </tr>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      <i className="fas fa-film text-indigo-500 mr-2"></i>
                      10秒影片
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">18 積分/個</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

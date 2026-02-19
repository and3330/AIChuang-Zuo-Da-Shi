import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/App";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useSeo } from "@/hooks/use-seo";
import { Link } from "wouter";

interface AdminUser {
  id: string;
  username: string;
  email: string;
  credits: number;
  isAdmin: boolean;
  createdAt: string;
  totalGenerations: number;
  totalCreditsUsed: number;
}

interface AdminStats {
  totalUsers: number;
  totalCreditsInCirculation: number;
  totalGenerations: number;
  totalCost: number;
}

interface OrderRecord {
  id: string;
  userId: string;
  type: string;
  amount: number;
  balance: number;
  description: string | null;
  createdAt: string;
  username: string;
  email: string;
}

interface UserDetail {
  user: {
    id: string;
    username: string;
    email: string;
    credits: number;
    isAdmin: boolean;
    createdAt: string;
  };
  stats: {
    totalGenerations: number;
    totalCost: number;
    totalCreditsUsed: number;
  };
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    balance: number;
    description: string | null;
    createdAt: string;
  }>;
  imageGenerations: Array<{
    id: string;
    type: string;
    prompt: string;
    status: string;
    creditsUsed: number;
    createdAt: string;
  }>;
  videoGenerations: Array<{
    id: string;
    prompt: string;
    duration: number;
    status: string;
    creditsUsed: number;
    createdAt: string;
  }>;
}

export default function AdminPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditDescription, setCreditDescription] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"users" | "orders">("users");
  const [orderSearch, setOrderSearch] = useState("");

  useSeo({
    title: "管理後台 - 系統管理 | AI 創意工坊",
    description: "AI 創意工坊管理後台，管理用戶、調整積分、查看平台統計數據。",
  });

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: !!user?.isAdmin,
  });

  const { data: users, isLoading: usersLoading } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: !!user?.isAdmin,
  });

  const { data: userDetail, isLoading: detailLoading } = useQuery<UserDetail>({
    queryKey: ["/api/admin/users", selectedUserId],
    enabled: !!selectedUserId && !!user?.isAdmin,
  });

  const { data: orders, isLoading: ordersLoading } = useQuery<OrderRecord[]>({
    queryKey: ["/api/admin/orders"],
    enabled: !!user?.isAdmin && activeTab === "orders",
  });

  const handleAdjustCredits = async () => {
    if (!selectedUserId || !creditAmount) return;
    const amount = parseInt(creditAmount);
    if (isNaN(amount) || amount === 0) {
      toast({ title: "錯誤", description: "請輸入有效的積分數量", variant: "destructive" });
      return;
    }
    try {
      await apiRequest("POST", `/api/admin/users/${selectedUserId}/credits`, {
        amount,
        description: creditDescription || undefined,
      });
      toast({ title: "成功", description: `已${amount > 0 ? "加值" : "扣除"} ${Math.abs(amount)} 積分` });
      setCreditAmount("");
      setCreditDescription("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", selectedUserId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    } catch (err: any) {
      toast({ title: "錯誤", description: err?.message || "操作失敗", variant: "destructive" });
    }
  };

  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <i className="fas fa-lock text-4xl text-gray-300 mb-4"></i>
            <p className="text-gray-500">您沒有管理員權限</p>
            <Link href="/">
              <Button className="mt-4">返回首頁</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredUsers = users?.filter(
    (u) =>
      u.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "topup":
        return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">充值</span>;
      case "consume":
        return <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">消費</span>;
      case "refund":
        return <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">退款</span>;
      default:
        return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">{type}</span>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">完成</span>;
      case "pending":
      case "processing":
        return <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700">處理中</span>;
      case "failed":
        return <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">失敗</span>;
      default:
        return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">{status}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-2xl">✨</span>
                <span className="font-bold text-lg bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                  AI 創意工坊
                </span>
              </Link>
              <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">管理後台</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button variant="outline" size="sm">
                  <i className="fas fa-arrow-left mr-1"></i>返回前台
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("users")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === "users"
                ? "bg-purple-600 text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            <i className="fas fa-users mr-2"></i>用戶管理
          </button>
          <button
            onClick={() => setActiveTab("orders")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === "orders"
                ? "bg-purple-600 text-white shadow-sm"
                : "bg-white text-gray-600 border border-gray-200 hover:bg-gray-50"
            }`}
          >
            <i className="fas fa-shopping-cart mr-2"></i>訂單管理
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <i className="fas fa-users text-blue-600"></i>
                </div>
                <div>
                  <p className="text-sm text-gray-500">總用戶數</p>
                  <p className="text-2xl font-bold">{statsLoading ? "..." : stats?.totalUsers || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                  <i className="fas fa-coins text-yellow-600"></i>
                </div>
                <div>
                  <p className="text-sm text-gray-500">流通積分</p>
                  <p className="text-2xl font-bold">{statsLoading ? "..." : stats?.totalCreditsInCirculation || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                  <i className="fas fa-image text-purple-600"></i>
                </div>
                <div>
                  <p className="text-sm text-gray-500">總生成次數</p>
                  <p className="text-2xl font-bold">{statsLoading ? "..." : stats?.totalGenerations || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                  <i className="fas fa-dollar-sign text-green-600"></i>
                </div>
                <div>
                  <p className="text-sm text-gray-500">API 成本</p>
                  <p className="text-2xl font-bold">${statsLoading ? "..." : (stats?.totalCost || 0).toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {activeTab === "orders" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <i className="fas fa-shopping-cart text-green-500"></i>
                付費訂單記錄
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Input
                  placeholder="搜尋用戶名稱、電子郵件或說明..."
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  className="text-sm"
                />
              </div>
              {ordersLoading ? (
                <div className="text-center py-8 text-gray-400">
                  <i className="fas fa-spinner fa-spin text-2xl mb-2"></i>
                  <p>載入中...</p>
                </div>
              ) : !orders || orders.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <i className="fas fa-receipt text-4xl mb-3"></i>
                  <p>尚無付費訂單記錄</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="p-3 bg-green-50 rounded-lg text-center">
                      <p className="text-xs text-gray-500">總訂單數</p>
                      <p className="text-xl font-bold text-green-600">{orders.length}</p>
                    </div>
                    <div className="p-3 bg-yellow-50 rounded-lg text-center">
                      <p className="text-xs text-gray-500">總充值積分</p>
                      <p className="text-xl font-bold text-yellow-600">
                        {orders.reduce((sum, o) => sum + o.amount, 0)}
                      </p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-lg text-center">
                      <p className="text-xs text-gray-500">Stripe 付款</p>
                      <p className="text-xl font-bold text-blue-600">
                        {orders.filter(o => o.description?.includes("Stripe")).length}
                      </p>
                    </div>
                    <div className="p-3 bg-purple-50 rounded-lg text-center">
                      <p className="text-xs text-gray-500">總收入（TWD）</p>
                      <p className="text-xl font-bold text-purple-600">
                        ${orders.filter(o => o.description?.includes("Stripe")).reduce((sum, o) => sum + o.amount, 0)}
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="text-left px-3 py-2 font-medium text-gray-600">時間</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">用戶</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">電子郵件</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">來源</th>
                          <th className="text-right px-3 py-2 font-medium text-gray-600">金額（積分）</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-600">說明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders
                          .filter(o => {
                            if (!orderSearch) return true;
                            const s = orderSearch.toLowerCase();
                            return (
                              (o.username || "").toLowerCase().includes(s) ||
                              (o.email || "").toLowerCase().includes(s) ||
                              (o.description || "").toLowerCase().includes(s)
                            );
                          })
                          .map((order) => (
                          <tr key={order.id} className="border-b hover:bg-gray-50">
                            <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                              {new Date(order.createdAt).toLocaleString("zh-TW")}
                            </td>
                            <td className="px-3 py-2 font-medium text-sm">{order.username || "-"}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs">{order.email || "-"}</td>
                            <td className="px-3 py-2">
                              {order.description?.includes("Stripe") ? (
                                <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">Stripe 付款</span>
                              ) : order.description?.includes("管理員") ? (
                                <span className="px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700">管理員調整</span>
                              ) : order.description?.includes("歡迎") || order.description?.includes("注册") ? (
                                <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600">註冊贈送</span>
                              ) : (
                                <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">手動充值</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-green-600">+{order.amount}</td>
                            <td className="px-3 py-2 text-gray-500 text-xs max-w-[200px] truncate">
                              {order.description || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "users" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <i className="fas fa-users text-gray-500"></i>
                  用戶列表
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="mb-4">
                  <Input
                    placeholder="搜尋用戶名稱或電子郵件..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="text-sm"
                  />
                </div>
                {usersLoading ? (
                  <div className="text-center py-8 text-gray-400">
                    <i className="fas fa-spinner fa-spin text-2xl mb-2"></i>
                    <p>載入中...</p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[600px] overflow-y-auto">
                    {filteredUsers?.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => setSelectedUserId(u.id)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          selectedUserId === u.id
                            ? "border-purple-500 bg-purple-50"
                            : "border-gray-200 hover:border-purple-200 hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium text-sm flex items-center gap-2">
                              {u.username}
                              {u.isAdmin && (
                                <span className="px-1.5 py-0.5 text-[10px] bg-red-100 text-red-700 rounded">管理員</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5">{u.email}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-semibold text-yellow-600">
                              <i className="fas fa-coins mr-1"></i>{u.credits}
                            </div>
                            <div className="text-[10px] text-gray-400">{u.totalGenerations} 次生成</div>
                          </div>
                        </div>
                      </button>
                    ))}
                    {filteredUsers?.length === 0 && (
                      <p className="text-center text-gray-400 py-4 text-sm">沒有找到用戶</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
            {!selectedUserId ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-16 text-gray-400">
                    <i className="fas fa-user-circle text-5xl mb-4"></i>
                    <p>請從左側選擇一個用戶查看詳情</p>
                  </div>
                </CardContent>
              </Card>
            ) : detailLoading ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-16 text-gray-400">
                    <i className="fas fa-spinner fa-spin text-3xl mb-2"></i>
                    <p>載入用戶資料中...</p>
                  </div>
                </CardContent>
              </Card>
            ) : userDetail ? (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <i className="fas fa-user text-purple-500"></i>
                      {userDetail.user.username} 的資料
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-500">電子郵件</p>
                        <p className="text-sm font-medium truncate">{userDetail.user.email}</p>
                      </div>
                      <div className="p-3 bg-yellow-50 rounded-lg">
                        <p className="text-xs text-gray-500">目前積分</p>
                        <p className="text-sm font-bold text-yellow-600">{userDetail.user.credits}</p>
                      </div>
                      <div className="p-3 bg-purple-50 rounded-lg">
                        <p className="text-xs text-gray-500">總生成次數</p>
                        <p className="text-sm font-bold text-purple-600">{userDetail.stats.totalGenerations}</p>
                      </div>
                      <div className="p-3 bg-blue-50 rounded-lg">
                        <p className="text-xs text-gray-500">累計消耗積分</p>
                        <p className="text-sm font-bold text-blue-600">{userDetail.stats.totalCreditsUsed}</p>
                      </div>
                    </div>

                    <div className="border-t pt-4">
                      <h4 className="text-sm font-medium mb-3">
                        <i className="fas fa-coins mr-1 text-yellow-500"></i>調整積分
                      </h4>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="積分數量（正數加值、負數扣除）"
                          value={creditAmount}
                          onChange={(e) => setCreditAmount(e.target.value)}
                          className="text-sm"
                        />
                        <Input
                          placeholder="備註說明（選填）"
                          value={creditDescription}
                          onChange={(e) => setCreditDescription(e.target.value)}
                          className="text-sm"
                        />
                        <Button
                          onClick={handleAdjustCredits}
                          className="bg-purple-600 hover:bg-purple-700 text-white whitespace-nowrap"
                          disabled={!creditAmount}
                        >
                          確認調整
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <i className="fas fa-receipt text-blue-500"></i>
                      交易記錄
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {userDetail.transactions.length === 0 ? (
                      <p className="text-center text-gray-400 py-6 text-sm">尚無交易記錄</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              <th className="text-left px-3 py-2 font-medium text-gray-600">時間</th>
                              <th className="text-left px-3 py-2 font-medium text-gray-600">類型</th>
                              <th className="text-right px-3 py-2 font-medium text-gray-600">金額</th>
                              <th className="text-right px-3 py-2 font-medium text-gray-600">餘額</th>
                              <th className="text-left px-3 py-2 font-medium text-gray-600">說明</th>
                            </tr>
                          </thead>
                          <tbody>
                            {userDetail.transactions.slice(0, 20).map((t) => (
                              <tr key={t.id} className="border-b hover:bg-gray-50">
                                <td className="px-3 py-2 text-gray-500 text-xs">
                                  {new Date(t.createdAt).toLocaleString("zh-TW")}
                                </td>
                                <td className="px-3 py-2">{getTypeBadge(t.type)}</td>
                                <td className={`px-3 py-2 text-right font-medium ${t.amount > 0 ? "text-green-600" : "text-red-600"}`}>
                                  {t.amount > 0 ? "+" : ""}{t.amount}
                                </td>
                                <td className="px-3 py-2 text-right text-gray-600">{t.balance}</td>
                                <td className="px-3 py-2 text-gray-500 text-xs max-w-[200px] truncate">
                                  {t.description || "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <i className="fas fa-history text-green-500"></i>
                      生成記錄
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {(userDetail.imageGenerations.length + userDetail.videoGenerations.length) === 0 ? (
                      <p className="text-center text-gray-400 py-6 text-sm">尚無生成記錄</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-gray-50">
                              <th className="text-left px-3 py-2 font-medium text-gray-600">時間</th>
                              <th className="text-left px-3 py-2 font-medium text-gray-600">類型</th>
                              <th className="text-left px-3 py-2 font-medium text-gray-600">提示詞</th>
                              <th className="text-left px-3 py-2 font-medium text-gray-600">狀態</th>
                              <th className="text-right px-3 py-2 font-medium text-gray-600">積分</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[
                              ...userDetail.imageGenerations.map((g) => ({
                                id: g.id,
                                createdAt: g.createdAt,
                                typeLabel: g.type === "text-to-image" ? "文字生圖" : "圖片編輯",
                                prompt: g.prompt,
                                status: g.status,
                                credits: g.creditsUsed || 3,
                              })),
                              ...userDetail.videoGenerations.map((g) => ({
                                id: g.id,
                                createdAt: g.createdAt,
                                typeLabel: `影片 ${g.duration}秒`,
                                prompt: g.prompt,
                                status: g.status,
                                credits: g.creditsUsed || Math.round((g.duration || 5) * 6.8),
                              })),
                            ]
                              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                              .slice(0, 30)
                              .map((g) => (
                                <tr key={g.id} className="border-b hover:bg-gray-50">
                                  <td className="px-3 py-2 text-gray-500 text-xs">
                                    {new Date(g.createdAt).toLocaleString("zh-TW")}
                                  </td>
                                  <td className="px-3 py-2">
                                    <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700">
                                      {g.typeLabel}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-gray-600 text-xs max-w-[200px] truncate">{g.prompt}</td>
                                  <td className="px-3 py-2">{getStatusBadge(g.status)}</td>
                                  <td className="px-3 py-2 text-right font-medium">{g.credits}</td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link, useLocation } from "wouter";
import { useSeo } from "@/hooks/use-seo";
import type { CreditTransaction, User } from "@shared/schema";
import { NavigationHeader } from "./account";

const typeConfig: Record<string, { label: string; color: string; bgColor: string }> = {
  topup: { label: "充值", color: "text-green-700", bgColor: "bg-green-100" },
  consume: { label: "消費", color: "text-red-700", bgColor: "bg-red-100" },
  refund: { label: "退款", color: "text-blue-700", bgColor: "bg-blue-100" },
};

export default function TransactionsPage() {
  const { user } = useUser();

  useSeo({
    title: "交易記錄 - 積分使用明細 | AI 創意工坊",
    description: "查看您在 AI 創意工坊的所有交易記錄，包含充值、消費、退款等積分使用明細。",
    keywords: "交易記錄,積分明細,消費記錄,充值記錄",
  });

  const { data: transactions, isLoading } = useQuery<CreditTransaction[]>({
    queryKey: ["/api/credits/transactions"],
  });

  if (!user) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <NavigationHeader />

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Card className="shadow-lg">
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-yellow-100 to-orange-100 flex items-center justify-center">
                  <i className="fas fa-wallet text-xl text-yellow-600"></i>
                </div>
                <div>
                  <p className="text-sm text-gray-500">目前餘額</p>
                  <p className="text-2xl font-bold text-yellow-600">{user.credits ?? 0} <span className="text-sm font-normal text-gray-500">積分</span></p>
                </div>
              </div>
              <Link href="/account">
                <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700">
                  <i className="fas fa-plus mr-2"></i> 充值
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <i className="fas fa-history text-purple-600"></i>
              交易記錄
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex flex-col items-center py-12">
                <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-gray-500 text-sm">載入中...</p>
              </div>
            ) : !transactions || transactions.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-gray-400">
                <i className="fas fa-receipt text-4xl mb-3"></i>
                <p className="text-lg">暫無交易記錄</p>
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx) => {
                  const config = typeConfig[tx.type] ?? { label: tx.type, color: "text-gray-700", bgColor: "bg-gray-100" };
                  const isPositive = tx.amount > 0;
                  const dateStr = tx.createdAt
                    ? new Date(tx.createdAt).toLocaleString("zh-TW", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "";

                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}>
                          {config.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">
                            {tx.description || config.label}
                          </p>
                          <p className="text-xs text-gray-400">{dateStr}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <span className={`text-sm font-bold ${isPositive ? "text-green-600" : "text-red-500"}`}>
                          {isPositive ? "+" : ""}{tx.amount}
                        </span>
                        <span className="text-xs text-gray-400 w-20 text-right">
                          餘額 {tx.balance}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

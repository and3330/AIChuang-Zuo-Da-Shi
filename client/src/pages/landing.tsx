import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useSeo } from "@/hooks/use-seo";

export default function LandingPage() {
  useSeo({
    title: "AI 創意工坊 - AI 圖片與影片生成平台 | 文字生圖、圖片編輯、AI 影片製作",
    description: "AI 創意工坊是專業級 AI 圖片與影片生成平台，支援文字生圖、圖片編輯、AI 影片生成、多圖融合、序列生成。使用 SeedDance 4.5 與 Seedream 原生 API，註冊即送 10 積分。",
    keywords: "AI圖片生成,AI影片生成,文字生圖,圖片編輯,AI創作,SeedDance,Seedream,AI繪圖,人工智慧,AI創意工坊",
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-950/80 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <span className="text-2xl">✨</span>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                AI 創意工坊
              </span>
            </div>
            <Link href="/login">
              <Button className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white border-0">
                <i className="fas fa-sign-in-alt mr-2"></i>
                登入 / 註冊
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      <div className="fixed top-16 left-0 right-0 z-40 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 text-white py-2 overflow-hidden">
        <div className="animate-marquee whitespace-nowrap text-sm font-medium">
          <span className="mx-8">📢 圖片生影片、文字生影片功能正在更新中，預計 2/24 更新至 SeedDance 2.0，敬請期待！</span>
          <span className="mx-8">📢 圖片生影片、文字生影片功能正在更新中，預計 2/24 更新至 SeedDance 2.0，敬請期待！</span>
          <span className="mx-8">📢 圖片生影片、文字生影片功能正在更新中，預計 2/24 更新至 SeedDance 2.0，敬請期待！</span>
        </div>
      </div>

      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-24">
        <div className="absolute inset-0 bg-gradient-to-br from-gray-950 via-purple-950/50 to-blue-950/50" />
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "2s" }} />
        </div>

        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-2 mb-8">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-sm text-gray-300">完全原生 API 驅動</span>
          </div>

          <h1 className="text-5xl sm:text-7xl font-bold mb-6">
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              AI 創意工坊
            </span>
          </h1>

          <p className="text-xl sm:text-2xl text-gray-300 mb-4 font-medium">
            基於 SeedDance 4.5 與 Seedream 的專業級 AI 創作平台
          </p>
          <p className="text-gray-400 mb-10 max-w-2xl mx-auto">
            直接使用 BytePlus ARK 原生 API，無中間層，無延遲損耗。從圖片編輯、文字生圖到 AI 影片生成，一站式完成所有創意需求。
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/login">
              <Button size="lg" className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-8 py-6 text-lg rounded-xl shadow-lg shadow-purple-500/25 border-0">
                <i className="fas fa-rocket mr-2"></i>
                立即開始創作
              </Button>
            </Link>
            <a href="#models">
              <Button size="lg" variant="outline" className="border-white/20 text-gray-300 hover:bg-white/10 hover:text-white px-8 py-6 text-lg rounded-xl">
                <i className="fas fa-arrow-down mr-2"></i>
                了解更多
              </Button>
            </a>
          </div>

          <div className="mt-12 flex items-center justify-center gap-8 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <i className="fas fa-gift text-purple-400"></i>
              <span>註冊即送 10 積分</span>
            </div>
            <div className="flex items-center gap-2">
              <i className="fas fa-bolt text-yellow-400"></i>
              <span>即時生成</span>
            </div>
            <div className="flex items-center gap-2">
              <i className="fas fa-shield-alt text-green-400"></i>
              <span>安全支付</span>
            </div>
          </div>
        </div>
      </section>

      <section id="models" className="py-24 px-4 bg-gray-950">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                核心模型
              </span>
            </h2>
            <p className="text-gray-400 text-lg">兩大原生 AI 模型，覆蓋圖片與影片創作全場景</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <Card className="bg-gradient-to-br from-purple-950/50 to-gray-900 border border-purple-500/20 overflow-hidden group hover:border-purple-500/40 transition-all duration-300">
              <CardContent className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex items-center justify-center">
                      <i className="fas fa-image text-white text-xl"></i>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">SeedDance 4.5</h3>
                      <p className="text-sm text-gray-400">圖片編輯與生成模型</p>
                    </div>
                  </div>
                  <span className="bg-purple-600/20 text-purple-300 text-xs font-medium px-3 py-1 rounded-full border border-purple-500/30">
                    完全原生 API
                  </span>
                </div>

                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="fas fa-exchange-alt text-purple-400 w-5 text-center"></i>
                    <span>圖片編輯 (Image-to-Image)</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="fas fa-pencil-alt text-purple-400 w-5 text-center"></i>
                    <span>文字生圖 (Text-to-Image)</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="fas fa-layer-group text-purple-400 w-5 text-center"></i>
                    <span>批次生成 — 一次生成多張</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="fas fa-object-group text-purple-400 w-5 text-center"></i>
                    <span>多圖融合 — 多張圖片混合創作</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="fas fa-stream text-purple-400 w-5 text-center"></i>
                    <span>序列生成 — 連續變化探索</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <i className="fas fa-coins text-yellow-400"></i>
                    <span>3 積分/張 (約 NT$3)</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-blue-950/50 to-gray-900 border border-blue-500/20 overflow-hidden group hover:border-blue-500/40 transition-all duration-300">
              <CardContent className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-cyan-600 rounded-xl flex items-center justify-center">
                      <i className="fas fa-video text-white text-xl"></i>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Seedream</h3>
                      <p className="text-sm text-gray-400">AI 影片生成模型</p>
                    </div>
                  </div>
                  <span className="bg-blue-600/20 text-blue-300 text-xs font-medium px-3 py-1 rounded-full border border-blue-500/30">
                    完全原生 API
                  </span>
                </div>

                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="fas fa-film text-blue-400 w-5 text-center"></i>
                    <span>圖片生影片 — 靜態圖轉動態影片</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="fas fa-clock text-blue-400 w-5 text-center"></i>
                    <span>5 秒 / 10 秒影片長度可選</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="fas fa-video text-blue-400 w-5 text-center"></i>
                    <span>動態鏡頭 — 自動運鏡效果</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-300">
                    <i className="fas fa-crosshairs text-blue-400 w-5 text-center"></i>
                    <span>固定鏡頭 — 穩定畫面動畫</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <i className="fas fa-coins text-yellow-400"></i>
                    <span>3.4 積分/秒（2-12秒自由選擇）</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-white text-gray-900">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-gray-900">平台特色</h2>
            <p className="text-gray-500 text-lg">為創作者打造的專業級 AI 創作工具</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: "fas fa-plug",
                color: "text-purple-600",
                bg: "bg-purple-100",
                title: "完全原生 API",
                desc: "直接呼叫 BytePlus ARK API，無中間層封裝，確保最佳效能與最低延遲",
              },
              {
                icon: "fas fa-layer-group",
                color: "text-blue-600",
                bg: "bg-blue-100",
                title: "批次生成",
                desc: "一次提交多組描述，同時生成多張圖片，大幅提升創作效率",
              },
              {
                icon: "fas fa-stream",
                color: "text-indigo-600",
                bg: "bg-indigo-100",
                title: "序列生成",
                desc: "自動連續生成多張變化圖片，輕鬆探索不同風格與構圖可能性",
              },
              {
                icon: "fas fa-object-group",
                color: "text-pink-600",
                bg: "bg-pink-100",
                title: "多圖融合",
                desc: "上傳多張參考圖片，AI 將融合特徵創造全新作品",
              },
              {
                icon: "fas fa-video",
                color: "text-cyan-600",
                bg: "bg-cyan-100",
                title: "影片生成",
                desc: "將靜態圖片轉化為 5 秒或 10 秒的動態影片，支援動態與固定鏡頭",
              },
              {
                icon: "fas fa-lock",
                color: "text-green-600",
                bg: "bg-green-100",
                title: "安全支付",
                desc: "透過 Stripe 國際級支付平台處理交易，確保每筆付款安全可靠",
              },
            ].map((feature, i) => (
              <Card key={i} className="border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-300">
                <CardContent className="p-6">
                  <div className={`w-12 h-12 ${feature.bg} rounded-xl flex items-center justify-center mb-4`}>
                    <i className={`${feature.icon} ${feature.color} text-xl`}></i>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{feature.title}</h3>
                  <p className="text-gray-500 text-sm leading-relaxed">{feature.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 px-4 bg-gray-50 text-gray-900">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4 text-gray-900">透明定價</h2>
            <p className="text-gray-500 text-lg">用多少付多少，無月費，無隱藏費用</p>
          </div>

          <Card className="border border-gray-200 shadow-lg overflow-hidden">
            <CardContent className="p-0">
              <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-6 text-center text-white">
                <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-2 mb-3">
                  <i className="fas fa-gift"></i>
                  <span className="font-medium">註冊即送 10 積分</span>
                </div>
                <p className="text-purple-100 text-sm">1 積分 = 1 元新台幣 (TWD)</p>
              </div>

              <div className="divide-y divide-gray-200">
                <div className="flex items-center justify-between p-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <i className="fas fa-image text-purple-600"></i>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">圖片生成</p>
                      <p className="text-sm text-gray-500">Image-to-Image / Text-to-Image</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900 text-lg">3 積分<span className="text-sm font-normal text-gray-500">/張</span></p>
                    <p className="text-xs text-gray-400">≈ NT$3</p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-6 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <i className="fas fa-video text-blue-600"></i>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">影片生成（2-12秒）</p>
                      <p className="text-sm text-gray-500">秒數自由選擇，按秒計費</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900 text-lg">3.4 積分/秒</p>
                    <p className="text-xs text-gray-400">例：5秒 ≈ NT$17</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="text-center mt-10">
            <Link href="/login">
              <Button size="lg" className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-10 py-6 text-lg rounded-xl shadow-lg shadow-purple-500/25 border-0">
                <i className="fas fa-rocket mr-2"></i>
                免費開始 — 註冊送 10 積分
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-gray-950 border-t border-white/10 py-12 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-2xl">✨</span>
            <span className="text-xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              AI 創意工坊
            </span>
          </div>
          <p className="text-gray-500 text-sm mb-2">專業級 AI 圖片與影片生成平台</p>
          <p className="text-gray-600 text-xs">Powered by BytePlus ARK · SeedDance 4.5 · Seedream</p>
        </div>
      </footer>
    </div>
  );
}

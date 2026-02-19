import { useSeo } from "@/hooks/use-seo";
import { Link } from "wouter";

export default function PrivacyPage() {
  useSeo({
    title: "隱私政策",
    description: "AI 創意工坊隱私政策，說明我們如何收集、使用和保護您的個人資料。",
    keywords: "隱私政策,個資保護,AI創意工坊",
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-2xl">✨</span>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                AI 創意工坊
              </span>
            </Link>
            <Link href="/" className="text-sm text-gray-500 hover:text-purple-600">
              返回首頁
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sm:p-10">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">隱私政策</h1>
          <p className="text-sm text-gray-400 mb-8">最後更新日期：2026 年 2 月 13 日</p>

          <div className="prose prose-gray max-w-none space-y-6 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">一、總則</h2>
              <p>
                AI 創意工坊（以下簡稱「本平台」）重視您的隱私權益。本隱私政策說明我們在您使用本平台服務時，如何收集、使用、儲存及保護您的個人資料。使用本平台即表示您同意本隱私政策的內容。
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">二、我們收集的資料</h2>
              <p>本平台在您使用服務過程中，可能收集以下類型的資料：</p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li><strong>帳戶資訊：</strong>您註冊時提供的使用者名稱、電子郵件地址及加密後的密碼。</li>
                <li><strong>使用紀錄：</strong>您的圖片及影片生成紀錄、提示詞（prompt）內容、生成參數設定。</li>
                <li><strong>交易資訊：</strong>積分充值及消費紀錄、付款相關資訊（透過 Stripe 安全處理）。</li>
                <li><strong>上傳內容：</strong>您上傳用於圖片編輯或影片生成的原始圖片。</li>
                <li><strong>技術資訊：</strong>您的 IP 位址、瀏覽器類型、裝置資訊及存取時間。</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">三、資料使用目的</h2>
              <p>我們收集的資料將用於以下目的：</p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li>提供、維護及改善本平台的 AI 圖片與影片生成服務。</li>
                <li>處理您的帳戶註冊、登入驗證及積分交易。</li>
                <li>透過第三方 AI API（BytePlus ARK）處理您的生成請求。</li>
                <li>透過 Stripe 處理您的付款交易。</li>
                <li>偵測、防範並處理技術問題或安全事件。</li>
                <li>依法律要求或政府機關合法請求提供資料。</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">四、資料儲存與保護</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>您的密碼經過 bcrypt 加密演算法雜湊處理後儲存，本平台無法還原您的原始密碼。</li>
                <li>付款資訊由 Stripe 安全處理，本平台不直接儲存您的信用卡或金融卡資料。</li>
                <li>AI 生成的圖片及影片以暫存 URL 形式存在，由 BytePlus API 提供，本平台不永久保存生成結果。</li>
                <li>您上傳的原始圖片儲存於雲端物件儲存服務中，並採取適當的存取控制措施。</li>
                <li>我們採用業界標準的安全措施保護您的資料，包括 HTTPS 加密傳輸及安全的伺服器環境。</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">五、第三方服務</h2>
              <p>本平台使用以下第三方服務，這些服務可能會收集或處理您的部分資料：</p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li><strong>BytePlus ARK API：</strong>處理 AI 圖片及影片生成請求，包括您提供的提示詞及上傳的圖片。</li>
                <li><strong>Stripe：</strong>處理積分充值的付款交易。Stripe 的隱私政策請參閱其官方網站。</li>
                <li><strong>雲端儲存服務：</strong>用於儲存您上傳的圖片檔案。</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">六、您的權利</h2>
              <p>您對您的個人資料享有以下權利：</p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li>查詢及請求閱覽您的個人資料。</li>
                <li>請求更正或補充不正確的個人資料。</li>
                <li>請求刪除您的帳戶及相關個人資料。</li>
                <li>請求停止蒐集、處理或利用您的個人資料。</li>
              </ul>
              <p className="mt-2">如需行使上述權利，請透過本平台提供的聯絡方式與我們聯繫。</p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">七、Cookie 使用</h2>
              <p>
                本平台使用必要性的 Cookie 來維持您的登入狀態（session cookie）。我們不使用追蹤型或廣告型 Cookie。
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">八、兒童隱私</h2>
              <p>
                本平台不針對 13 歲以下的兒童提供服務。如果我們發現已收集了 13 歲以下兒童的個人資料，我們將立即採取措施刪除該資料。
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">九、隱私政策變更</h2>
              <p>
                本平台保留隨時修改本隱私政策的權利。政策變更後，我們將在本頁面上公布更新版本。繼續使用本平台即表示您同意修改後的隱私政策。
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">十、聯絡我們</h2>
              <p>
                如果您對本隱私政策有任何疑問或需要行使您的隱私權利，請透過本平台的技術支援功能與我們聯繫。
              </p>
            </section>
          </div>
        </div>
      </div>

      <footer className="border-t border-gray-200 bg-white mt-8">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center space-y-3">
          <p className="text-sm font-medium text-gray-600">極電行銷整合</p>
          <div className="flex justify-center items-center gap-4 text-sm text-gray-500">
            <span>客服信箱：<a href="mailto:Service@cms-edu.com" className="text-purple-600 hover:underline">Service@cms-edu.com</a></span>
            <span className="text-gray-300">|</span>
            <span>LINE：<a href="https://line.me/R/ti/p/@558icnoi" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">@558icnoi</a></span>
          </div>
          <div className="flex justify-center items-center gap-6 text-sm text-gray-400">
            <span className="text-gray-600 font-medium">隱私政策</span>
            <Link href="/terms" className="hover:text-blue-600 transition-colors">服務條款</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

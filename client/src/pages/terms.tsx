import { tr } from "@/lib/i18n";
import { useSeo } from "@/hooks/use-seo";
import { Link } from "wouter";

export default function TermsPage() {
  useSeo({
    title: tr("服務條款"),
    description: tr("AI 創意工坊服務條款，說明使用本平台服務的相關規範與條件。"),
    keywords: tr("服務條款,使用規範,AI創意工坊"),
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-2xl">✨</span>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
                {tr("AI 創意工坊")}
              </span>
            </Link>
            <Link href="/" className="text-sm text-gray-500 hover:text-purple-600">
              {tr("返回首頁")}
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sm:p-10">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{tr("服務條款")}</h1>
          <p className="text-sm text-gray-400 mb-8">{tr("最後更新日期：2026 年 2 月 13 日")}</p>

          <div className="prose prose-gray max-w-none space-y-6 text-gray-700 leading-relaxed">
            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("一、服務說明")}</h2>
              <p>
                {tr("AI 創意工坊（以下簡稱「本平台」）是一個基於人工智慧技術的圖片及影片生成平台，提供文字生圖、圖片編輯、圖片轉影片、文字轉影片、序列生成、多圖融合及批次生成等功能。本平台使用 AtlasCloud API 的 Seedream 5.5（圖片生成）及 WAN 3.0（影片生成）模型提供 AI 生成服務。")}
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("二、帳戶註冊與管理")}</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>{tr("使用本平台服務需註冊帳戶，您須提供有效的使用者名稱、電子郵件地址及密碼。")}</li>
                <li>{tr("您有責任維護帳戶資訊的安全性，不得將帳戶提供給第三方使用。")}</li>
                <li>{tr("新註冊用戶將獲得 10 積分的歡迎獎勵。")}</li>
                <li>{tr("如發現帳戶遭未經授權使用，請立即通知本平台。")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("三、積分制度與計費")}</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>{tr("本平台採用積分制度，1 積分等值於 1 元新台幣（TWD）。")}</li>
                <li><strong>{tr("圖片生成：")}</strong>{tr("每張消耗 5 積分。選擇去除浮水印時，每張額外加收 1 積分（共 6 積分/張）。")}</li>
                <li><strong>{tr("影片生成：")}</strong>{tr("按時長與解析度計費，720P 每秒 8 積分，1080P 每秒 15 積分（支援 4 至 12 秒）。")}</li>
                <li>{tr("積分充值最低金額為 50 積分，透過 Stripe 安全支付處理。")}</li>
                <li>{tr("積分在生成任務開始時扣除。若生成失敗，積分將自動退還至您的帳戶。")}</li>
                <li>{tr("已消耗的積分不予退還，除非因本平台技術問題導致生成失敗。")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("四、付款與退款")}</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>{tr("積分充值透過 Stripe 付款平台處理，支援信用卡及金融卡付款。")}</li>
                <li>{tr("付款成功後，積分將即時存入您的帳戶。")}</li>
                <li>{tr("因系統錯誤導致的重複扣款，本平台將主動退還多扣的積分。")}</li>
                <li>{tr("已充值的積分原則上不提供現金退款。如有特殊情況，請聯繫客服處理。")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("五、使用規範")}</h2>
              <p>{tr("使用本平台服務時，您同意遵守以下規範：")}</p>
              <ul className="list-disc pl-6 space-y-2 mt-2">
                <li>{tr("不得使用本平台生成違法、有害、威脅、騷擾、誹謗或侵犯他人權利的內容。")}</li>
                <li>{tr("不得生成涉及兒童不當內容、暴力、仇恨言論或歧視性內容。")}</li>
                <li>{tr("不得上傳侵犯他人智慧財產權或肖像權的圖片。")}</li>
                <li>{tr("不得嘗試破解、攻擊或干擾本平台的系統運作。")}</li>
                <li>{tr("不得利用自動化工具大量產生請求，影響本平台服務品質。")}</li>
                <li>{tr("不得將本平台生成的內容用於詐騙、假訊息傳播或其他非法用途。")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("六、智慧財產權")}</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>{tr("本平台的介面設計、程式碼及品牌標識之智慧財產權歸本平台所有。")}</li>
                <li>{tr("透過本平台 AI 生成的圖片及影片，您可在合法範圍內自由使用，但需遵守 AtlasCloud API 的使用條款。")}</li>
                <li>{tr("AI 生成內容可能包含浮水印（可透過設定關閉），浮水印之設計屬於本平台之智慧財產。")}</li>
                <li>{tr("您上傳的原始圖片之智慧財產權仍歸您所有。")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("七、生成內容與暫存")}</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>{tr("AI 生成的圖片及影片以暫存 URL 形式提供，由 AtlasCloud API 伺服器託管。")}</li>
                <li>{tr("暫存 URL 具有時效性，過期後將無法存取。建議您在生成後及時下載保存。")}</li>
                <li>{tr("本平台不保證生成內容的永久保存，亦不對因 URL 過期導致的內容遺失負責。")}</li>
                <li>{tr("AI 生成結果受到模型能力限制，本平台不保證生成結果完全符合您的預期。")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("八、服務中斷與免責")}</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>{tr("本平台將盡力維持服務的穩定運作，但不保證服務不會中斷。")}</li>
                <li>{tr("因第三方 API 服務（AtlasCloud、Stripe）異常導致的服務中斷，本平台不承擔責任。")}</li>
                <li>{tr("因不可抗力（如天災、網路故障、法規變更）導致的服務中斷，本平台不承擔責任。")}</li>
                <li>{tr("本平台保留因系統維護、升級等原因暫停服務的權利，並會儘量提前通知。")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("九、帳戶停用與終止")}</h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>{tr("如您違反本服務條款的任何規定，本平台有權暫停或終止您的帳戶。")}</li>
                <li>{tr("您可隨時要求刪除帳戶，帳戶刪除後，剩餘積分將不予退還。")}</li>
                <li>{tr("本平台保留因業務需要調整或終止服務的權利。")}</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("十、條款修改")}</h2>
              <p>
                {tr("本平台保留隨時修改本服務條款的權利。修改後的條款將在本頁面上公布，繼續使用本平台即表示您同意修改後的服務條款。重大條款變更時，我們會透過平台通知或電子郵件告知。")}
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("十一、適用法律")}</h2>
              <p>
                {tr("本服務條款之解釋及適用，以中華民國法律為準據法。因本服務條款所生之爭議，雙方同意以台灣台北地方法院為第一審管轄法院。")}
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{tr("十二、聯絡方式")}</h2>
              <p>
                {tr("如您對本服務條款有任何疑問，請透過本平台的技術支援功能與我們聯繫。")}
              </p>
            </section>
          </div>
        </div>
      </div>

      <footer className="border-t border-gray-200 bg-white mt-8">
        <div className="max-w-4xl mx-auto px-4 py-6 text-center space-y-3">
          <p className="text-sm font-medium text-gray-600">{tr("極電行銷整合")}</p>
          <div className="flex justify-center items-center gap-4 text-sm text-gray-500">
            <span>{tr("客服信箱：")}<a href="mailto:Service@cms-edu.com" className="text-purple-600 hover:underline">Service@cms-edu.com</a></span>
            <span className="text-gray-300">|</span>
            <span>LINE：<a href="https://line.me/R/ti/p/@558icnoi" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">@558icnoi</a></span>
          </div>
          <div className="flex justify-center items-center gap-6 text-sm text-gray-400">
            <Link href="/privacy" className="hover:text-blue-600 transition-colors">{tr("隱私政策")}</Link>
            <span className="text-gray-600 font-medium">{tr("服務條款")}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

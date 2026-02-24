import { useState, useRef, useEffect } from "react";

interface Message {
  id: number;
  text: string;
  isBot: boolean;
  timestamp: Date;
}

const FAQ_DATA: { keywords: string[]; answer: string }[] = [
  {
    keywords: ["積分", "credit", "點數", "餘額"],
    answer: "積分是平台的虛擬貨幣，1 積分 = 1 新台幣。新註冊用戶可獲得 10 積分。您可以在「帳戶管理」頁面進行儲值。",
  },
  {
    keywords: ["價格", "費用", "多少錢", "收費", "計費"],
    answer: "圖片生成：3 積分/張（去浮水印額外 +5 積分）。\n影片生成：依解析度計算，720P 約 3.4 積分/秒，1080P 約 6.8 積分/秒，時長 4-12 秒可選。",
  },
  {
    keywords: ["儲值", "充值", "加值", "購買", "付款", "支付"],
    answer: "請前往「帳戶管理」頁面，選擇儲值金額後使用信用卡付款即可。我們支援 Visa、Mastercard 等主流信用卡。",
  },
  {
    keywords: ["註冊", "開戶", "帳號"],
    answer: "您可以使用電子郵件註冊（需驗證碼），或直接使用 Google 帳號快速登入。新用戶註冊即送 10 積分！",
  },
  {
    keywords: ["圖片", "生圖", "文字生圖", "圖生圖", "圖片編輯"],
    answer: "我們支援：\n• 文字生圖：輸入描述即可生成圖片\n• 圖片編輯：上傳圖片 + 描述修改內容\n• 批次生成：一次生成多張圖片\n• 多圖融合：上傳多張參考圖片融合生成",
  },
  {
    keywords: ["影片", "生影片", "視頻", "video"],
    answer: "支援文字生影片和圖片生影片，可選擇：\n• 比例：16:9（橫向）、9:16（直向）、1:1（方形）\n• 解析度：720P 或 1080P\n• 時長：4-12 秒",
  },
  {
    keywords: ["浮水印", "水印", "去水印"],
    answer: "生成的圖片預設帶有浮水印。去除浮水印需額外支付 5 積分/張。在生成時可以勾選「去除浮水印」選項。",
  },
  {
    keywords: ["下載", "儲存", "保存"],
    answer: "生成完成後，點擊「下載」按鈕即可保存到您的裝置。所有生成內容都會永久儲存在您的帳戶中，隨時可以回來下載。",
  },
  {
    keywords: ["失敗", "錯誤", "不能用", "出問題", "bug"],
    answer: "生成失敗可能的原因：\n• 積分不足\n• 提示詞包含敏感內容被系統攔截\n• 網路連線問題\n如問題持續，請聯繫客服 Email：support@cmai-marker.com",
  },
  {
    keywords: ["退款", "退費", "退回"],
    answer: "如因系統問題導致生成失敗，積分會自動退回。如有其他退款需求，請聯繫客服 Email：support@cmai-marker.com",
  },
  {
    keywords: ["聯繫", "客服", "聯絡", "email", "信箱"],
    answer: "您可以透過以下方式聯繫我們：\n• Email：support@cmai-marker.com\n• 營運公司：極電行銷整合\n我們會在 1-2 個工作天內回覆。",
  },
  {
    keywords: ["安全", "隱私", "個資"],
    answer: "我們重視您的隱私安全。所有密碼均經過加密處理，個人資料僅用於服務提供。詳細資訊請參閱我們的隱私政策頁面。",
  },
];

const QUICK_QUESTIONS = [
  "積分怎麼用？",
  "圖片和影片怎麼收費？",
  "怎麼儲值？",
  "支援哪些生成功能？",
  "生成失敗怎麼辦？",
  "怎麼聯繫客服？",
];

function findAnswer(input: string): string {
  const lower = input.toLowerCase();
  for (const faq of FAQ_DATA) {
    if (faq.keywords.some((kw) => lower.includes(kw))) {
      return faq.answer;
    }
  }
  return "抱歉，我暫時無法回答這個問題。您可以嘗試問其他問題，或聯繫客服 Email：support@cmai-marker.com，我們會盡快為您處理。";
}

export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      text: "您好！我是 AI 創意工坊的客服小幫手 🤖\n有什麼問題可以問我，或點擊下方常見問題快速查詢！",
      isBot: true,
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const sendMessage = (text: string) => {
    const userMsg: Message = {
      id: Date.now(),
      text,
      isBot: false,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    setTimeout(() => {
      const answer = findAnswer(text);
      const botMsg: Message = {
        id: Date.now() + 1,
        text: answer,
        isBot: true,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMsg]);
      setIsTyping(false);
    }, 600 + Math.random() * 400);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input.trim());
  };

  return (
    <>
      {isOpen && (
        <div className="fixed bottom-20 max-sm:bottom-[140px] right-4 max-sm:right-2 max-sm:left-2 z-50 w-[360px] max-sm:w-auto max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300" style={{ height: "520px", maxHeight: "calc(100vh - 200px)" }}>
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-lg">
                🤖
              </div>
              <div>
                <div className="font-semibold text-sm">客服小幫手</div>
                <div className="text-xs text-white/80">AI 創意工坊</div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="w-8 h-8 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
            >
              <i className="fas fa-times text-sm"></i>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.isBot ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-line leading-relaxed ${
                    msg.isBot
                      ? "bg-white text-gray-800 rounded-tl-sm shadow-sm border border-gray-100"
                      : "bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-tr-sm"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-white text-gray-500 px-4 py-2 rounded-2xl rounded-tl-sm shadow-sm border border-gray-100 text-sm">
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
                  </span>
                </div>
              </div>
            )}

            {messages.length === 1 && !isTyping && (
              <div className="space-y-2 mt-2">
                <p className="text-xs text-gray-400 font-medium px-1">常見問題</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="text-xs bg-white border border-purple-200 text-purple-700 px-3 py-1.5 rounded-full hover:bg-purple-50 hover:border-purple-300 transition-colors shadow-sm"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={handleSubmit}
            className="px-3 py-2 bg-white border-t border-gray-200 flex gap-2 shrink-0"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="輸入您的問題..."
              className="flex-1 px-3 py-2 text-sm bg-gray-100 rounded-full border-0 outline-none focus:ring-2 focus:ring-purple-300 focus:bg-white transition-all"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="w-9 h-9 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-full flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
            >
              <i className="fas fa-paper-plane text-xs"></i>
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-4 sm:bottom-4 right-4 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110 max-sm:bottom-[76px] ${
          isOpen
            ? "bg-gray-600 hover:bg-gray-700"
            : "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
        }`}
      >
        {isOpen ? (
          <i className="fas fa-times text-white text-lg"></i>
        ) : (
          <i className="fas fa-comment-dots text-white text-xl"></i>
        )}
        {!isOpen && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold animate-pulse">
            1
          </span>
        )}
      </button>
    </>
  );
}

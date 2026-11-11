import { useState, useRef, useEffect, useCallback } from "react";
import { useUser } from "@/hooks/use-user";
import { apiRequest } from "@/lib/queryClient";

interface ChatMsg {
  id: string;
  userId: string;
  message: string;
  isAdmin: boolean;
  isRead: boolean;
  createdAt: string;
}

interface LocalMessage {
  id: string;
  text: string;
  isBot: boolean;
  timestamp: Date;
}

const FAQ_DATA: { keywords: string[]; answer: string }[] = [
  {
    keywords: ["積分", "credit", "點數", "餘額"],
    answer: "積分是平台的虛擬貨幣。完成信箱驗證的新用戶可獲得 10 積分。首次以 US$9.9 開通會員可得 200 積分（一次性，沒有月費），開通後可在「帳戶」頁加購積分（1 積分 = 1 新台幣）。",
  },
  {
    keywords: ["價格", "費用", "多少錢", "收費", "計費"],
    answer: "圖片生成：5 積分/張（去除浮水印 +1 積分）。\n影片生成：依解析度計算，720P 8 積分/秒，1080P 15 積分/秒，時長 4-12 秒可選。",
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
    answer: "生成失敗可能的原因：\n• 積分不足\n• 提示詞包含敏感內容被系統攔截\n• 網路連線問題\n如問題持續，請直接在這裡留言給客服，我們會盡快回覆！",
  },
  {
    keywords: ["退款", "退費", "退回"],
    answer: "如因系統問題導致生成失敗，積分會自動退回。如有其他退款需求，請直接在這裡留言給客服，我們會盡快回覆！",
  },
  {
    keywords: ["聯繫", "客服", "聯絡", "email", "信箱"],
    answer: "請直接在這裡留言給客服，我們會盡快回覆！",
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
  "怎麼聯繫客服？",
];

function findFaqAnswer(input: string): string | null {
  const lower = input.toLowerCase();
  for (const faq of FAQ_DATA) {
    if (faq.keywords.some((kw) => lower.includes(kw))) {
      return faq.answer;
    }
  }
  return null;
}

export default function ChatWidget() {
  const { user } = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showQuickQuestions, setShowQuickQuestions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const welcomeMsg: LocalMessage = {
    id: "welcome",
    text: "您好！我是 AI 創意工坊的客服小幫手 🤖\n有什麼問題可以問我，或直接留言給客服，我們會盡快回覆！",
    isBot: true,
    timestamp: new Date(),
  };

  const loadMessages = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/chat/messages", { credentials: "include" });
      if (!res.ok) return;
      const data: ChatMsg[] = await res.json();
      if (data.length > 0) {
        const loaded: LocalMessage[] = data.map((m) => ({
          id: m.id,
          text: m.message,
          isBot: m.isAdmin,
          timestamp: new Date(m.createdAt),
        }));
        setMessages([welcomeMsg, ...loaded]);
        setShowQuickQuestions(false);
      } else {
        setMessages([welcomeMsg]);
        setShowQuickQuestions(true);
      }
    } catch {}
  }, [user]);

  const checkUnread = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/chat/unread", { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setUnreadCount(data.count || 0);
    } catch {}
  }, [user]);

  useEffect(() => {
    if (user) {
      checkUnread();
      const interval = setInterval(checkUnread, 15000);
      return () => clearInterval(interval);
    }
  }, [user, checkUnread]);

  useEffect(() => {
    if (isOpen && user) {
      loadMessages();
      pollingRef.current = setInterval(loadMessages, 5000);
      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    } else {
      if (pollingRef.current) clearInterval(pollingRef.current);
    }
  }, [isOpen, user, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
      if (user) {
        fetch("/api/chat/mark-read", { method: "POST", credentials: "include" });
        setUnreadCount(0);
      }
    }
  }, [isOpen, user]);

  const sendMessage = async (text: string) => {
    const userMsg: LocalMessage = {
      id: `local-${Date.now()}`,
      text,
      isBot: false,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setShowQuickQuestions(false);

    const faqAnswer = findFaqAnswer(text);
    if (faqAnswer) {
      setIsTyping(true);
      setTimeout(() => {
        const botMsg: LocalMessage = {
          id: `faq-${Date.now()}`,
          text: faqAnswer,
          isBot: true,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, botMsg]);
        setIsTyping(false);
      }, 500);
    }

    if (user) {
      try {
        await apiRequest("POST", "/api/chat/send", { message: text });
      } catch {}
    }
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
                <div className="text-xs text-white/80">AI 創意工坊 · 線上客服</div>
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

            {showQuickQuestions && messages.length <= 1 && !isTyping && (
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

          {!user && (
            <div className="px-3 py-2 bg-yellow-50 border-t border-yellow-200 text-center">
              <p className="text-xs text-yellow-700">請先登入後即可留言給客服</p>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="px-3 py-2 bg-white border-t border-gray-200 flex gap-2 shrink-0"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={user ? "輸入您的問題或留言..." : "請先登入後留言"}
              className="flex-1 px-3 py-2 text-sm bg-gray-100 rounded-full border-0 outline-none focus:ring-2 focus:ring-purple-300 focus:bg-white transition-all"
              disabled={!user}
            />
            <button
              type="submit"
              disabled={!input.trim() || !user}
              className="w-9 h-9 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-full flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40 shrink-0"
            >
              <i className="fas fa-paper-plane text-xs"></i>
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-[calc(68px+env(safe-area-inset-bottom))] md:bottom-4 right-4 z-40 w-12 h-12 md:w-14 md:h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110 max-sm:bottom-[76px] ${
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
        {!isOpen && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>
    </>
  );
}

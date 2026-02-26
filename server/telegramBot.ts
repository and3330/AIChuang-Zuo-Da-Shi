import TelegramBot from "node-telegram-bot-api";

const WEBSITE_URL = "https://cmai-marker.com";

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("⚠️ TELEGRAM_BOT_TOKEN not set, Telegram bot disabled");
    return;
  }

  const bot = new TelegramBot(token, {
    polling: {
      autoStart: true,
      params: { timeout: 10 }
    }
  });

  let pollingErrorCount = 0;
  bot.on("polling_error", (err: any) => {
    const is409 = err?.message?.includes("409") || err?.response?.statusCode === 409;
    if (is409) {
      pollingErrorCount++;
      if (pollingErrorCount === 1) {
        console.log("⚠️ Telegram Bot: another instance is running (409), stopping local polling.");
        bot.stopPolling().catch(() => {});
      }
    } else {
      console.error("Telegram polling error:", err?.message || err);
    }
  });

  console.log("✅ Telegram Bot started");

  bot.setMyCommands([
    { command: "start", description: "開始使用" },
  ]);

  const welcomeKeyboard = {
    inline_keyboard: [[
      {
        text: "🚀 立即進入 AI 創意工坊",
        url: WEBSITE_URL
      }
    ]]
  };

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `👋 歡迎使用 AI 創意工坊！\n\n` +
      `🎨 專業 AI 圖片與影片生成平台\n` +
      `• 文字生圖 / 圖片編輯\n` +
      `• 文字生影片 / 圖片生影片\n` +
      `• 高品質 Seedream 5.0 模型\n\n` +
      `點擊下方按鈕立即開始創作 👇`,
      { reply_markup: welcomeKeyboard }
    );
  });

  bot.on("message", (msg) => {
    if (msg.text?.startsWith("/")) return;
    bot.sendMessage(
      msg.chat.id,
      `請點擊下方按鈕進入網站開始創作 👇`,
      { reply_markup: welcomeKeyboard }
    );
  });

  return bot;
}

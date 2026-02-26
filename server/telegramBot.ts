import TelegramBot from "node-telegram-bot-api";
import { storage } from "./storage";
import { BunnyStorageService } from "./bunnyStorage";

const bunnyStorage = new BunnyStorageService();

const IMAGE_API = "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";
const VIDEO_API = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";
const SEEDDANCE_MODEL = "seedream-5.0";
const VIDEO_ENDPOINT = "ep-20250813120833-g4mpb";

const pendingBindings = new Map<number, { email: string; code: string; expiresAt: number }>();

function generateBindCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("⚠️ TELEGRAM_BOT_TOKEN not set, Telegram bot disabled");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log("✅ Telegram Bot started");

  bot.setMyCommands([
    { command: "start", description: "開始使用 / 綁定帳號" },
    { command: "bind", description: "綁定帳號（輸入 email）" },
    { command: "verify", description: "輸入驗證碼完成綁定" },
    { command: "balance", description: "查詢積分餘額" },
    { command: "generate", description: "文字生圖（輸入描述）" },
    { command: "video", description: "文字生影片（輸入描述）" },
    { command: "history", description: "最近生成記錄" },
    { command: "help", description: "功能說明" },
  ]);

  async function getLinkedUser(chatId: number) {
    return storage.getUserByTelegramChatId(String(chatId));
  }

  async function sendVerificationEmail(email: string, code: string) {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"AI 創意工坊" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Telegram 綁定驗證碼 - AI 創意工坊",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f5f3ff; border-radius: 16px;">
          <h2 style="color: #7c3aed;">AI 創意工坊 - Telegram 帳號綁定</h2>
          <p>您的驗證碼是：</p>
          <div style="font-size: 32px; font-weight: bold; color: #7c3aed; letter-spacing: 8px; text-align: center; padding: 16px; background: white; border-radius: 8px;">
            ${code}
          </div>
          <p style="color: #666; margin-top: 16px;">驗證碼 10 分鐘內有效。請在 Telegram 中輸入 <b>/verify ${code}</b> 完成綁定。</p>
          <p style="color: #999; font-size: 12px;">如果您沒有發起此操作，請忽略此郵件。</p>
        </div>
      `,
    });
  }

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getLinkedUser(chatId);

    if (user) {
      bot.sendMessage(chatId,
        `👋 歡迎回來，${user.username}！\n\n` +
        `💰 目前積分：${user.credits || 0}\n\n` +
        `📋 可用指令：\n` +
        `/generate <描述> — 文字生圖\n` +
        `/video <描述> — 文字生影片\n` +
        `/balance — 查詢積分\n` +
        `/history — 最近生成記錄\n` +
        `/help — 更多說明`
      );
    } else {
      bot.sendMessage(chatId,
        `👋 歡迎使用 AI 創意工坊 Telegram Bot！\n\n` +
        `請先綁定您的帳號：\n` +
        `/bind <您的註冊Email>\n\n` +
        `例如：/bind user@example.com\n\n` +
        `綁定後需要輸入 Email 收到的驗證碼確認身份。\n\n` +
        `還沒有帳號？請先到網站註冊：\nhttps://cmai-marker.com`
      );
    }
  });

  bot.onText(/\/bind(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const email = match?.[1]?.trim();

    const existing = await getLinkedUser(chatId);
    if (existing) {
      bot.sendMessage(chatId, `✅ 您已綁定帳號：${existing.username} (${existing.email})\n如需更換請聯繫客服。`);
      return;
    }

    if (!email) {
      bot.sendMessage(chatId, `請輸入您的註冊 Email：\n/bind your@email.com`);
      return;
    }

    const user = await storage.getUserByEmail(email);
    if (!user) {
      bot.sendMessage(chatId, `❌ 找不到此 Email 的帳號，請確認是否已在網站註冊。\n\n網站：https://cmai-marker.com`);
      return;
    }

    if (user.telegramChatId && user.telegramChatId !== String(chatId)) {
      bot.sendMessage(chatId, `❌ 此帳號已綁定其他 Telegram，如需更換請聯繫客服。`);
      return;
    }

    const code = generateBindCode();
    pendingBindings.set(chatId, { email, code, expiresAt: Date.now() + 10 * 60 * 1000 });

    try {
      await sendVerificationEmail(email, code);
      bot.sendMessage(chatId,
        `📧 驗證碼已發送到 ${email}\n\n` +
        `請在 10 分鐘內輸入：\n/verify <驗證碼>\n\n` +
        `例如：/verify 123456`
      );
    } catch (error) {
      console.error("Telegram bind email error:", error);
      pendingBindings.delete(chatId);
      bot.sendMessage(chatId, `❌ 發送驗證碼失敗，請稍後再試。`);
    }
  });

  bot.onText(/\/verify(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const inputCode = match?.[1]?.trim();

    const pending = pendingBindings.get(chatId);
    if (!pending) {
      bot.sendMessage(chatId, `❌ 沒有待驗證的綁定請求。\n請先使用 /bind <Email> 開始綁定。`);
      return;
    }

    if (!inputCode) {
      bot.sendMessage(chatId, `請輸入驗證碼：/verify <驗證碼>`);
      return;
    }

    if (Date.now() > pending.expiresAt) {
      pendingBindings.delete(chatId);
      bot.sendMessage(chatId, `❌ 驗證碼已過期，請重新使用 /bind <Email> 綁定。`);
      return;
    }

    if (inputCode !== pending.code) {
      bot.sendMessage(chatId, `❌ 驗證碼錯誤，請重新輸入：/verify <驗證碼>`);
      return;
    }

    const user = await storage.getUserByEmail(pending.email);
    if (!user) {
      pendingBindings.delete(chatId);
      bot.sendMessage(chatId, `❌ 帳號不存在，請重新綁定。`);
      return;
    }

    await storage.bindTelegramChatId(user.id, String(chatId));
    pendingBindings.delete(chatId);

    bot.sendMessage(chatId,
      `✅ 帳號綁定成功！\n\n` +
      `👤 用戶名：${user.username}\n` +
      `💰 積分餘額：${user.credits || 0}\n\n` +
      `現在可以直接使用以下功能：\n` +
      `/generate <描述> — 文字生圖\n` +
      `/video <描述> — 文字生影片\n` +
      `/balance — 查詢積分`
    );
  });

  bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getLinkedUser(chatId);
    if (!user) {
      bot.sendMessage(chatId, `❌ 請先綁定帳號：/bind <Email>`);
      return;
    }
    const freshUser = await storage.getUser(user.id);
    bot.sendMessage(chatId,
      `💰 積分餘額：${freshUser?.credits || 0}\n\n` +
      `📊 計費標準：\n` +
      `• 圖片：3 積分/張\n` +
      `• 影片 720P：3.4 積分/秒\n` +
      `• 影片 1080P：6.8 積分/秒\n\n` +
      `需要儲值？請到網站：https://cmai-marker.com/account`
    );
  });

  bot.onText(/\/generate(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const prompt = match?.[1]?.trim();

    const user = await getLinkedUser(chatId);
    if (!user) {
      bot.sendMessage(chatId, `❌ 請先綁定帳號：/bind <Email>`);
      return;
    }

    if (!prompt) {
      bot.sendMessage(chatId, `請輸入圖片描述：\n/generate 一隻可愛的貓咪在草地上玩耍`);
      return;
    }

    const freshUser = await storage.getUser(user.id);
    const credits = freshUser?.credits || 0;
    const cost = 3;
    if (credits < cost) {
      bot.sendMessage(chatId, `❌ 積分不足！需要 ${cost} 積分，目前餘額 ${credits}\n\n請到網站儲值：https://cmai-marker.com/account`);
      return;
    }

    const statusMsg = await bot.sendMessage(chatId, `🎨 正在生成圖片...\n提示詞：${prompt}\n消耗：${cost} 積分`);

    try {
      const newBalance = credits - cost;
      await storage.updateUserCredits(user.id, newBalance);
      await storage.createCreditTransaction({
        userId: user.id,
        type: "consume",
        amount: -cost,
        balance: newBalance,
        description: `Telegram 圖片生成消耗 ${cost} 積分`,
      });

      const generation = await storage.createImageGeneration({
        type: "text-to-image",
        prompt,
        originalImageUrl: "",
        size: "1:1",
        watermark: true,
        userId: user.id,
      });

      const apiKey = process.env.ARK_API_KEY;
      const response = await fetch(IMAGE_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: SEEDDANCE_MODEL,
          prompt,
          response_format: "url",
          size: "1024x1024",
          watermark: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      const imageUrl = result.data?.[0]?.url;
      if (!imageUrl) throw new Error("No image URL returned");

      let finalUrl = imageUrl;
      const userFolder = freshUser?.username || user.id;
      if (bunnyStorage.isConfigured()) {
        try {
          const imgResp = await fetch(imageUrl);
          const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
          const remotePath = `users/${userFolder}/images/${generation.id}.jpg`;
          const bunnyUrl = await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
          if (bunnyUrl) finalUrl = bunnyUrl;
        } catch (e) {
          console.error("Telegram: Bunny upload failed:", e);
        }
      }

      await storage.updateImageGeneration(generation.id, {
        status: "completed",
        generatedImageUrl: imageUrl,
        bunnyImageUrl: finalUrl !== imageUrl ? finalUrl : undefined,
        cost: 0.05,
      });

      await bot.deleteMessage(chatId, statusMsg.message_id);
      await bot.sendPhoto(chatId, finalUrl, {
        caption: `✅ 圖片生成完成！\n\n🎨 提示詞：${prompt}\n💰 消耗：${cost} 積分\n💰 餘額：${newBalance} 積分`,
      });
    } catch (error: any) {
      console.error("Telegram image generation error:", error);
      try {
        await storage.atomicAddCredits(user.id, cost, `Telegram 圖片生成失敗退款 ${cost} 積分`);
      } catch (refundErr) {
        console.error("Telegram refund error:", refundErr);
      }
      await storage.updateImageGeneration(
        (await storage.getUserImageGenerations(user.id))[0]?.id || "",
        { status: "failed", errorMessage: error?.message || "Unknown error" }
      ).catch(() => {});
      bot.editMessageText(
        `❌ 圖片生成失敗：${error?.message || "未知錯誤"}\n積分已退回。`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
    }
  });

  bot.onText(/\/video(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const prompt = match?.[1]?.trim();

    const user = await getLinkedUser(chatId);
    if (!user) {
      bot.sendMessage(chatId, `❌ 請先綁定帳號：/bind <Email>`);
      return;
    }

    if (!prompt) {
      bot.sendMessage(chatId, `請輸入影片描述：\n/video 一隻貓咪跳躍的慢動作`);
      return;
    }

    const freshUser = await storage.getUser(user.id);
    const credits = freshUser?.credits || 0;
    const duration = 5;
    const creditsPerSecond = 3.4;
    const cost = Math.round(duration * creditsPerSecond);

    if (credits < cost) {
      bot.sendMessage(chatId, `❌ 積分不足！需要 ${cost} 積分（${duration}秒 720P），目前餘額 ${credits}\n\n請到網站儲值：https://cmai-marker.com/account`);
      return;
    }

    const statusMsg = await bot.sendMessage(chatId, `🎬 正在生成影片（${duration}秒 720P）...\n提示詞：${prompt}\n消耗：${cost} 積分\n\n⏳ 影片生成需要 2-5 分鐘，請耐心等候...`);

    try {
      const newBalance = credits - cost;
      await storage.updateUserCredits(user.id, newBalance);
      await storage.createCreditTransaction({
        userId: user.id,
        type: "consume",
        amount: -cost,
        balance: newBalance,
        description: `Telegram 影片生成消耗 ${cost} 積分`,
      });

      const generation = await storage.createVideoGeneration({
        type: "text-to-video",
        prompt,
        duration,
        aspectRatio: "16:9",
        resolution: "720p",
        cameraFixed: false,
        userId: user.id,
      });

      const apiKey = process.env.ARK_API_KEY;
      const taskResponse = await fetch(VIDEO_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: VIDEO_ENDPOINT,
          content: [{ type: "text", text: prompt + " --resolution 720p" }],
        }),
      });

      if (!taskResponse.ok) {
        throw new Error(`Video API error: ${taskResponse.status}`);
      }

      const taskResult = await taskResponse.json();
      const taskId = taskResult.id;
      if (!taskId) throw new Error("No task ID returned");

      let videoUrl: string | undefined;
      const maxAttempts = 60;

      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 5000));

        const pollResponse = await fetch(`${VIDEO_API}/${taskId}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const pollResult = await pollResponse.json();

        if (pollResult.status === "succeeded") {
          if (pollResult.content?.video_url && typeof pollResult.content.video_url === "string") {
            videoUrl = pollResult.content.video_url.replace(/&amp;/g, "&");
          } else if (pollResult.content && Array.isArray(pollResult.content)) {
            for (const item of pollResult.content) {
              if (item.type === "video_url" && item.video_url?.url) {
                videoUrl = item.video_url.url.replace(/&amp;/g, "&");
                break;
              }
            }
          }
          break;
        } else if (pollResult.status === "failed") {
          throw new Error(pollResult.error?.message || "Video generation failed");
        }

        if (i % 6 === 5) {
          try {
            await bot.editMessageText(
              `🎬 影片生成中... (約${Math.round((i + 1) * 5 / 60)}分鐘)\n提示詞：${prompt}\n\n⏳ 請繼續等候...`,
              { chat_id: chatId, message_id: statusMsg.message_id }
            );
          } catch {}
        }
      }

      if (!videoUrl) throw new Error("Video generation timed out");

      let finalVideoUrl = videoUrl;
      const userFolder = freshUser?.username || user.id;
      if (bunnyStorage.isConfigured()) {
        try {
          const bunnyUrl = await bunnyStorage.uploadVideoFromUrl(videoUrl, userFolder, generation.id);
          if (bunnyUrl) finalVideoUrl = bunnyUrl;
        } catch (e) {
          console.error("Telegram: Bunny video upload failed:", e);
        }
      }

      const tokenConsumption = (1280 * 720 * 24 * duration) / 1024;
      const videoCostUsd = (tokenConsumption / 1_000_000) * 2.4;
      await storage.updateVideoGeneration(generation.id, {
        status: "completed",
        generatedVideoUrl: videoUrl,
        bunnyVideoUrl: finalVideoUrl !== videoUrl ? finalVideoUrl : undefined,
        cost: parseFloat(videoCostUsd.toFixed(4)),
      });

      await bot.deleteMessage(chatId, statusMsg.message_id);
      await bot.sendVideo(chatId, finalVideoUrl, {
        caption: `✅ 影片生成完成！\n\n🎬 提示詞：${prompt}\n⏱ 長度：${duration}秒（720P）\n💰 消耗：${cost} 積分\n💰 餘額：${newBalance} 積分`,
      });
    } catch (error: any) {
      console.error("Telegram video generation error:", error);
      try {
        await storage.atomicAddCredits(user.id, cost, `Telegram 影片生成失敗退款 ${cost} 積分`);
      } catch (refundErr) {
        console.error("Telegram video refund error:", refundErr);
      }
      bot.editMessageText(
        `❌ 影片生成失敗：${error?.message || "未知錯誤"}\n積分已退回。`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
    }
  });

  bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getLinkedUser(chatId);
    if (!user) {
      bot.sendMessage(chatId, `❌ 請先綁定帳號：/bind <Email>`);
      return;
    }

    const images = await storage.getUserImageGenerations(user.id);
    const videos = await storage.getUserVideoGenerations(user.id);

    const recentImages = images.filter(g => g.status === "completed").slice(0, 5);
    const recentVideos = videos.filter(g => g.status === "completed").slice(0, 3);

    let text = `📋 最近生成記錄\n\n`;

    if (recentImages.length > 0) {
      text += `🖼 圖片（最近 ${recentImages.length} 張）：\n`;
      recentImages.forEach((img, i) => {
        const date = img.createdAt ? new Date(img.createdAt).toLocaleDateString("zh-TW") : "";
        text += `${i + 1}. ${img.prompt?.substring(0, 30)}... (${date})\n`;
      });
    } else {
      text += `🖼 尚無圖片生成記錄\n`;
    }

    text += `\n`;

    if (recentVideos.length > 0) {
      text += `🎬 影片（最近 ${recentVideos.length} 部）：\n`;
      recentVideos.forEach((vid, i) => {
        const date = vid.createdAt ? new Date(vid.createdAt).toLocaleDateString("zh-TW") : "";
        text += `${i + 1}. ${vid.prompt?.substring(0, 30)}... (${date})\n`;
      });
    } else {
      text += `🎬 尚無影片生成記錄\n`;
    }

    text += `\n📊 總計：${images.length} 張圖片、${videos.length} 部影片`;

    bot.sendMessage(chatId, text);
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId,
      `📖 AI 創意工坊 Bot 使用說明\n\n` +
      `🔗 帳號綁定：\n` +
      `/bind <Email> — 綁定網站帳號（需 Email 驗證碼）\n` +
      `/verify <驗證碼> — 輸入驗證碼完成綁定\n\n` +
      `🎨 圖片生成：\n` +
      `/generate <描述> — 文字生圖（3 積分/張）\n` +
      `直接傳送圖片 + 描述文字 — 圖片編輯\n\n` +
      `🎬 影片生成：\n` +
      `/video <描述> — 文字生影片\n` +
      `（預設 5 秒 720P，17 積分）\n\n` +
      `💰 帳號相關：\n` +
      `/balance — 查詢積分餘額\n` +
      `/history — 最近生成記錄\n\n` +
      `📌 提示：\n` +
      `• 描述越詳細，生成效果越好\n` +
      `• 圖片生成約 10-30 秒\n` +
      `• 影片生成約 2-5 分鐘\n` +
      `• 儲值請到網站：https://cmai-marker.com/account\n\n` +
      `💬 客服：@amyhong0401`
    );
  });

  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const user = await getLinkedUser(chatId);
    if (!user) {
      bot.sendMessage(chatId, `❌ 請先綁定帳號：/bind <Email>`);
      return;
    }

    const caption = msg.caption?.trim();
    if (!caption) {
      bot.sendMessage(chatId, `請在傳送圖片時附上描述文字，說明您想要的修改效果。\n\n例如：傳送一張圖片並在說明欄寫「把背景改成海灘」`);
      return;
    }

    const freshUser = await storage.getUser(user.id);
    const credits = freshUser?.credits || 0;
    const cost = 3;
    if (credits < cost) {
      bot.sendMessage(chatId, `❌ 積分不足！需要 ${cost} 積分，目前餘額 ${credits}`);
      return;
    }

    const statusMsg = await bot.sendMessage(chatId, `🎨 正在處理圖片編輯...\n描述：${caption}\n消耗：${cost} 積分`);

    try {
      const photos = msg.photo!;
      const fileId = photos[photos.length - 1].file_id;
      const file = await bot.getFile(fileId);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      const imgResp = await fetch(fileUrl);
      const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
      const base64Image = `data:image/jpeg;base64,${imgBuffer.toString("base64")}`;

      const newBalance = credits - cost;
      await storage.updateUserCredits(user.id, newBalance);
      await storage.createCreditTransaction({
        userId: user.id,
        type: "consume",
        amount: -cost,
        balance: newBalance,
        description: `Telegram 圖片編輯消耗 ${cost} 積分`,
      });

      const generation = await storage.createImageGeneration({
        type: "image-to-image",
        prompt: caption,
        originalImageUrl: "telegram-upload",
        size: "1:1",
        watermark: true,
        userId: user.id,
      });

      const apiKey = process.env.ARK_API_KEY;
      const response = await fetch(IMAGE_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: SEEDDANCE_MODEL,
          prompt: caption,
          image: [base64Image],
          response_format: "url",
          size: "1024x1024",
          watermark: true,
        }),
      });

      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const result = await response.json();
      const imageUrl = result.data?.[0]?.url;
      if (!imageUrl) throw new Error("No image URL returned");

      let finalUrl = imageUrl;
      const userFolder = freshUser?.username || user.id;
      if (bunnyStorage.isConfigured()) {
        try {
          const outResp = await fetch(imageUrl);
          const outBuffer = Buffer.from(await outResp.arrayBuffer());
          const remotePath = `users/${userFolder}/images/${generation.id}.jpg`;
          const bunnyUrl = await bunnyStorage.uploadBuffer(outBuffer, remotePath);
          if (bunnyUrl) finalUrl = bunnyUrl;
        } catch (e) {
          console.error("Telegram: Bunny upload failed:", e);
        }
      }

      await storage.updateImageGeneration(generation.id, {
        status: "completed",
        generatedImageUrl: imageUrl,
        bunnyImageUrl: finalUrl !== imageUrl ? finalUrl : undefined,
        cost: 0.05,
      });

      await bot.deleteMessage(chatId, statusMsg.message_id);
      await bot.sendPhoto(chatId, finalUrl, {
        caption: `✅ 圖片編輯完成！\n\n🎨 描述：${caption}\n💰 消耗：${cost} 積分\n💰 餘額：${newBalance} 積分`,
      });
    } catch (error: any) {
      console.error("Telegram image edit error:", error);
      try {
        await storage.atomicAddCredits(user.id, cost, `Telegram 圖片編輯失敗退款 ${cost} 積分`);
      } catch (refundErr) {
        console.error("Telegram refund error:", refundErr);
      }
      bot.editMessageText(
        `❌ 圖片編輯失敗：${error?.message || "未知錯誤"}\n積分已退回。`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
    }
  });

  bot.on("polling_error", (error) => {
    console.error("Telegram polling error:", error.message);
  });

  return bot;
}

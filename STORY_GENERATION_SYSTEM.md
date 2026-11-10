> **注意（2026-11）**：本文件描述的是舊版 BytePlus ARK（Seedream 5.0／SeedDance 2.0）實作，僅供歷史參考。現行生成全部走 AtlasCloud（Seedream 5.5／WAN 3.0），請以 `server/atlasProvider.ts` 與 `replit.md` 為準。

# AI 故事生成系統 — 完整開發架構

## 系統概述

這是一個以「起承轉合」敘事弧為核心的 AI 圖片故事批量生成系統，支援：
- 2~8 幕場景依序生成圖片（BytePlus ARK Seedream 5.0 API）
- 三類參考圖上傳（主角、場景、畫風）
- Claude AI 自動生成故事大綱、優化圖片提示詞
- 每幕獨立動畫生成（SeedDance 2.0 API，含起承轉合節奏）
- Claude AI 批量生成動畫提示詞
- 圖片上傳至 Bunny.net CDN 持久化儲存
- 積分扣費 + 失敗全額退款

---

## 一、資料庫 Schema（Drizzle ORM + PostgreSQL）

```typescript
// shared/schema.ts

import { pgTable, varchar, text, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── 故事生成主表 ───
export const storyGenerations = pgTable("story_generations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  style: text("style").notNull(),                            // watercolor / cinematic / anime / oil_painting / line_art / custom
  sceneCount: integer("scene_count").notNull().default(4),
  referenceImageUrls: text("reference_image_urls").array(),  // 舊版全域參考圖（已被三類圖取代）
  scenes: text("scenes").notNull().default("[]"),            // JSON 字串，格式見 StoryScene[]
  status: text("status").notNull().default("pending"),       // pending / generating / completed / failed
  creditsUsed: integer("credits_used").default(0),
  cost: real("cost").default(0),
  errorMessage: text("error_message"),
  sceneSize: text("scene_size").default("1:1"),              // "1:1" | "9:16" | "16:9"
  characterImageUrls: text("character_image_urls").array(),  // 主角外貌參考（保持角色一致性）
  sceneRefImageUrls: text("scene_ref_image_urls").array(),   // 場景構圖參考
  styleImageUrls: text("style_image_urls").array(),          // 畫風風格參考
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── TypeScript 型別 ───
export type StoryGeneration = typeof storyGenerations.$inferSelect;

export type StoryScene = {
  id: string;                                  // "scene_0", "scene_1" ...
  title: string;
  description: string;
  sceneReferenceImageUrl?: string;             // 該幕個別場景參考圖（Object Storage 路徑）
  imageUrl?: string;                           // ARK API 回傳的暫存 URL
  bunnyUrl?: string;                           // Bunny.net CDN 持久化 URL（優先使用）
  status: "pending" | "generating" | "completed" | "failed";
};

// ─── Zod 驗證 Schema ───
export const insertStoryGenerationSchema = z.object({
  title: z.string().min(1).max(100),
  style: z.string().min(1),
  scenes: z.array(z.object({
    title: z.string(),
    description: z.string().min(1),
    sceneReferenceImageUrl: z.string().optional(),
  })).min(2).max(8),
  referenceImageUrls: z.array(z.string()).max(4).optional(),
  storyContent: z.string().optional(),                       // 故事全文（給 Claude 參考）
  sceneSize: z.enum(["1:1", "9:16", "16:9"]).optional().default("1:1"),
  characterImageUrls: z.array(z.string()).max(3).optional(),
  sceneRefImageUrls: z.array(z.string()).max(3).optional(),
  styleImageUrls: z.array(z.string()).max(3).optional(),
});

export type InsertStoryGeneration = z.infer<typeof insertStoryGenerationSchema>;
```

---

## 二、Storage 介面（server/storage.ts）

```typescript
// IStorage 介面需包含以下方法
interface IStorage {
  createStoryGeneration(data: InsertStoryGeneration & { userId: string; creditsUsed: number }): Promise<StoryGeneration>;
  getStoryGeneration(id: string): Promise<StoryGeneration | undefined>;
  updateStoryGeneration(id: string, updates: Partial<StoryGeneration>): Promise<StoryGeneration | undefined>;
  getUserStoryGenerations(userId: string): Promise<StoryGeneration[]>;
  getAllStoryGenerations(): Promise<StoryGeneration[]>;
  failStoryGenerationAndRefund(id: string, errorMessage: string): Promise<boolean>;
}

// ─── DatabaseStorage 實作 ───
async createStoryGeneration(data) {
  const scenes: StoryScene[] = data.scenes.map((s, i) => ({
    id: `scene_${i}`,
    title: s.title || `第 ${i + 1} 幕`,
    description: s.description,
    sceneReferenceImageUrl: s.sceneReferenceImageUrl || undefined,
    status: "pending" as const,
  }));
  const [row] = await db.insert(storyGenerations).values({
    userId: data.userId,
    title: data.title,
    style: data.style,
    sceneCount: data.scenes.length,
    referenceImageUrls: data.referenceImageUrls ?? [],
    scenes: JSON.stringify(scenes),
    status: "pending",
    creditsUsed: data.creditsUsed,
    cost: 0,
    sceneSize: data.sceneSize ?? "1:1",
    characterImageUrls: data.characterImageUrls ?? [],
    sceneRefImageUrls: data.sceneRefImageUrls ?? [],
    styleImageUrls: data.styleImageUrls ?? [],
  }).returning();
  return row;
}

async getStoryGeneration(id) {
  const [row] = await db.select().from(storyGenerations).where(eq(storyGenerations.id, id));
  return row;
}

async updateStoryGeneration(id, updates) {
  const dbUpdates: any = { updatedAt: new Date() };
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.scenes !== undefined) dbUpdates.scenes = updates.scenes;
  if (updates.errorMessage !== undefined) dbUpdates.errorMessage = updates.errorMessage;
  if (updates.cost !== undefined) dbUpdates.cost = updates.cost;
  if (updates.creditsUsed !== undefined) dbUpdates.creditsUsed = updates.creditsUsed;
  const [row] = await db.update(storyGenerations).set(dbUpdates)
    .where(eq(storyGenerations.id, id)).returning();
  return row;
}

async getUserStoryGenerations(userId) {
  return db.select().from(storyGenerations)
    .where(eq(storyGenerations.userId, userId))
    .orderBy(desc(storyGenerations.createdAt));
}

async getAllStoryGenerations() {
  return db.select().from(storyGenerations).orderBy(desc(storyGenerations.createdAt));
}

async failStoryGenerationAndRefund(id, errorMessage) {
  const [updated] = await db.update(storyGenerations)
    .set({ status: "failed", errorMessage, updatedAt: new Date() })
    .where(sql`${storyGenerations.id} = ${id} AND ${storyGenerations.status} != 'failed'`)
    .returning();
  if (!updated) return false;
  // 退還積分（需配合 atomicAddCredits 方法）
  if (updated.userId && updated.creditsUsed && updated.creditsUsed > 0) {
    await this.atomicAddCredits(updated.userId, updated.creditsUsed, `故事生成失敗退還 ${updated.creditsUsed} 積分`);
  }
  return true;
}
```

---

## 三、API 路由（server/routes.ts）

### 3.1 圖片尺寸映射

```typescript
const sceneSizeMap: Record<string, string> = {
  "1:1": "2048x2048",
  "9:16": "1440x2560",
  "16:9": "2560x1440",
};
// 圖片生成 API 端點
const ARK_API_ENDPOINT = "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations";
// 圖片模型 ID
const ARK_IMAGE_MODEL = "ep-20251223142939-njrkd";  // Seedream 5.0
```

### 3.2 建立故事生成

```typescript
// POST /api/story-generations
app.post("/api/story-generations", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const validated = insertStoryGenerationSchema.safeParse(req.body);
  if (!validated.success) return res.status(400).json({ error: "參數錯誤" });

  const { title, style, scenes, referenceImageUrls, sceneSize, characterImageUrls, sceneRefImageUrls, styleImageUrls } = validated.data;
  const creditsNeeded = scenes.length * 3;  // 每幕 3 積分

  const user = await storage.getUser(userId);
  if (!user || (user.credits ?? 0) < creditsNeeded) {
    return res.status(400).json({ error: `積分不足，需要 ${creditsNeeded} 積分` });
  }

  await storage.atomicAddCredits(userId, -creditsNeeded, `故事生成「${title}」${scenes.length} 幕`);

  const storyGen = await storage.createStoryGeneration({
    userId, title, style, scenes,
    referenceImageUrls: referenceImageUrls ?? [],
    sceneSize: sceneSize ?? "1:1",
    characterImageUrls: characterImageUrls ?? [],
    sceneRefImageUrls: sceneRefImageUrls ?? [],
    styleImageUrls: styleImageUrls ?? [],
    creditsUsed: creditsNeeded,
  });

  // 非同步後台處理，不阻塞 HTTP 回應
  processStoryGeneration(storyGen.id, objectStorageService, bunnyStorage).catch(console.error);

  res.json(storyGen);
});
```

### 3.3 查詢單一故事

```typescript
// GET /api/story-generations/:id  （前端輪詢用）
app.get("/api/story-generations/:id", requireAuth, async (req, res) => {
  const story = await storage.getStoryGeneration(req.params.id);
  if (!story) return res.status(404).json({ error: "找不到故事生成記錄" });
  if (story.userId !== req.session.userId!) return res.status(403).json({ error: "無存取權限" });
  res.json(story);
});
```

### 3.4 列出使用者故事歷史

```typescript
// GET /api/story-generations
app.get("/api/story-generations", requireAuth, async (req, res) => {
  const stories = await storage.getUserStoryGenerations(req.session.userId!);
  res.json(stories);
});
```

### 3.5 更新故事標題

```typescript
// PATCH /api/story-generations/:storyId
app.patch("/api/story-generations/:storyId", requireAuth, async (req, res) => {
  const { storyId } = req.params;
  const story = await storage.getStoryGeneration(storyId);
  if (!story) return res.status(404).json({ error: "找不到故事" });
  if (story.userId !== req.session.userId!) return res.status(403).json({ error: "無存取權限" });
  const updates: Partial<typeof story> = {};
  if (typeof req.body.title === "string" && req.body.title.trim()) updates.title = req.body.title.trim();
  const updated = await storage.updateStoryGeneration(storyId, updates);
  res.json(updated);
});
```

---

## 四、後台處理函數：processStoryGeneration

```typescript
// 這是核心非同步處理函數，負責依序生成各幕圖片
async function processStoryGeneration(
  storyId: string,
  objectStorageService: ObjectStorageService,
  bunnyStorage: BunnyStorageService
) {
  try {
    await storage.updateStoryGeneration(storyId, { status: "generating" });
    const story = await storage.getStoryGeneration(storyId);
    if (!story) return;

    const storyUser = await storage.getUser(story.userId);
    const userFolder = storyUser?.username || story.userId;
    const apiKey = process.env.ARK_API_KEY;
    if (!apiKey) throw new Error("圖片生成 API Key 未設定");

    const scenes: StoryScene[] = JSON.parse(story.scenes);
    let totalCost = 0;

    const sceneSizeMap: Record<string, string> = {
      "1:1": "2048x2048", "9:16": "1440x2560", "16:9": "2560x1440",
    };
    const imageSize = sceneSizeMap[story.sceneSize ?? "1:1"] || "2048x2048";

    // ─── 從 Object Storage 載入參考圖為 Base64 ───
    const loadRefImageAsBase64 = async (imagePath: string): Promise<string> => {
      const objectFile = await objectStorageService.getObjectEntityFile(imagePath);
      const chunks: Buffer[] = [];
      const stream = objectFile.createReadStream();
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return `data:image/jpeg;base64,${Buffer.concat(chunks).toString("base64")}`;
    };

    const loadImageList = async (urls: string[]): Promise<string[]> => {
      if (!urls || urls.length === 0) return [];
      try {
        return await Promise.all(urls.map(loadRefImageAsBase64));
      } catch (e) {
        console.error("Failed to load reference images:", e);
        return [];
      }
    };

    // 預先載入三類全域參考圖
    const characterBase64s = await loadImageList(story.characterImageUrls ?? []);
    const sceneRefBase64s = await loadImageList(story.sceneRefImageUrls ?? []);
    const styleBase64s = await loadImageList(story.styleImageUrls ?? []);

    // ─── 依序處理每一幕 ───
    for (let i = 0; i < scenes.length; i++) {
      scenes[i].status = "generating";
      await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes) });

      try {
        const scenePrompt = `${story.style}, ${scenes[i].description}`;
        let requestBody: any;

        // 組合參考圖：主角 → 場景 → 畫風（全域）
        let globalBase64s = [...characterBase64s, ...sceneRefBase64s, ...styleBase64s];

        // 若該幕有個別場景參考圖，覆蓋場景欄位
        if (scenes[i].sceneReferenceImageUrl) {
          try {
            const perSceneBase64 = await loadRefImageAsBase64(scenes[i].sceneReferenceImageUrl!);
            globalBase64s = [...characterBase64s, perSceneBase64, ...styleBase64s];
          } catch (e) {
            console.error(`Failed to load scene ${i} reference image:`, e);
          }
        }

        if (globalBase64s.length > 0) {
          // 建立標籤說明各張參考圖的用途
          const labelParts: string[] = [];
          let imgIdx = 1;
          if (characterBase64s.length > 0) {
            labelParts.push(`第 ${imgIdx}${characterBase64s.length > 1 ? `-${imgIdx + characterBase64s.length - 1}` : ""} 張圖為主角外貌，保持角色一致`);
            imgIdx += characterBase64s.length;
          }
          const sceneCount = scenes[i].sceneReferenceImageUrl ? 1 : sceneRefBase64s.length;
          if (sceneCount > 0) {
            labelParts.push(`第 ${imgIdx}${sceneCount > 1 ? `-${imgIdx + sceneCount - 1}` : ""} 張圖為場景構圖參考`);
            imgIdx += sceneCount;
          }
          if (styleBase64s.length > 0) {
            labelParts.push(`第 ${imgIdx}${styleBase64s.length > 1 ? `-${imgIdx + styleBase64s.length - 1}` : ""} 張圖為畫風風格參考`);
          }
          const labelNote = labelParts.length > 0 ? `（${labelParts.join("；")}）` : "";
          const fullPrompt = `${scenePrompt}${labelNote}`;

          requestBody = {
            model: ARK_IMAGE_MODEL,
            prompt: fullPrompt,
            image: globalBase64s.length === 1 ? globalBase64s[0] : globalBase64s,
            response_format: "url",
            size: imageSize,
            watermark: true,
          };
        } else {
          // 無參考圖：純文字生圖
          requestBody = {
            model: ARK_IMAGE_MODEL,
            prompt: scenePrompt,
            response_format: "url",
            size: imageSize,
            watermark: true,
          };
        }

        const apiResp = await fetch(ARK_API_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!apiResp.ok) {
          const errText = await apiResp.text();
          throw new Error(`API error ${apiResp.status}: ${errText}`);
        }

        const apiResult = await apiResp.json();
        const imageUrl = apiResult.data?.[0]?.url;
        if (!imageUrl) throw new Error("API 未回傳圖片 URL");

        totalCost += 0.05;
        scenes[i].imageUrl = imageUrl;

        // ─── 上傳至 Bunny.net CDN（含 2 次重試）───
        if (bunnyStorage.isConfigured()) {
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const imgResp = await fetch(imageUrl);
              const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
              const remotePath = `users/${userFolder}/stories/${storyId}_${i}.jpg`;
              const cdnUrl = await bunnyStorage.uploadBuffer(imgBuffer, remotePath);
              scenes[i].bunnyUrl = cdnUrl;
              break;
            } catch (e) {
              console.error(`Bunny upload failed (scene ${i}, attempt ${attempt}):`, e);
              if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
            }
          }
        }

        scenes[i].status = "completed";
      } catch (sceneError: any) {
        console.error(`❌ Story scene ${i + 1} failed:`, sceneError.message);
        scenes[i].status = "failed";
        scenes[i].imageUrl = undefined;
      }

      await storage.updateStoryGeneration(storyId, { scenes: JSON.stringify(scenes), cost: totalCost });
    }

    // ─── 結果判斷 ───
    const allFailed = scenes.every(s => s.status === "failed");
    if (allFailed) {
      await storage.failStoryGenerationAndRefund(storyId, "所有場景生成失敗");
    } else {
      await storage.updateStoryGeneration(storyId, {
        status: "completed",
        scenes: JSON.stringify(scenes),
        cost: totalCost,
      });
    }
  } catch (error: any) {
    console.error("❌ Story generation failed:", error.message);
    await storage.failStoryGenerationAndRefund(storyId, error.message);
  }
}
```

---

## 五、Claude AI 端點

### 5.1 生成故事大綱

```typescript
// POST /api/claude/generate-story-outline
// 輸入：{ title, style, sceneCount, storyContent? }
// 輸出：{ scenes: [{ index, title, description }] }

app.post("/api/claude/generate-story-outline", requireAuth, async (req, res) => {
  const { title, style, sceneCount, storyContent } = req.body;

  const styleGuide: Record<string, string> = {
    watercolor: "水彩畫風格，柔和色調",
    cinematic: "電影感風格，戲劇性光影",
    anime: "日系動漫風格",
    oil_painting: "油畫風格",
    line_art: "線條藝術風格",
    custom: style,
  };
  const styleDesc = styleGuide[style] || style;

  // 起承轉合角色計算
  const getNarrativeRole = (i: number, total: number): string => {
    if (total === 2) return i === 0 ? "起（開場）" : "合（結局）";
    if (total === 3) return ["起（開場）", "轉（高潮）", "合（結局）"][i] ?? "承";
    const ratio = i / (total - 1);
    if (i === 0) return "起（開場）";
    if (i === total - 1) return "合（結局）";
    if (ratio < 0.35) return "承（發展）";
    if (ratio < 0.72) return "轉（高潮）";
    return "合前段（化解）";
  };

  const storyContentSection = storyContent?.trim()
    ? `\n故事全文：\n${storyContent.trim()}\n` : "";

  const prompt = `你是專業的故事編劇。請根據以下資訊，為圖片故事生成 ${sceneCount} 幕的場景大綱，確保有完整的「起承轉合」故事弧線，最後一幕有明確的結局。

故事標題：${title}
畫風：${styleDesc}
總幕數：${sceneCount} 幕${storyContentSection}

每幕的敘事角色：
${Array.from({ length: sceneCount }, (_, i) => `第 ${i + 1} 幕：${getNarrativeRole(i, sceneCount)}`).join("\n")}

請為每幕生成：
1. 簡短的幕名（3-8 字，中文）
2. 場景描述（20-60 字，描述畫面中的主要視覺元素、人物動作、環境氣氛）
3. 最後一幕必須有明確的故事結局感

請嚴格用以下 JSON 格式回應，不要有任何其他文字：
{ "scenes": [{ "index": 0, "title": "...", "description": "..." }] }`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return res.status(500).json({ error: "Claude 回應格式錯誤" });

  const parsed = JSON.parse(jsonMatch[0]);
  const scenes = (parsed.scenes || []).slice(0, sceneCount).map((s: any, i: number) => ({
    index: i,
    title: s.title || `第 ${i + 1} 幕`,
    description: s.description || "",
  }));
  res.json({ scenes });
});
```

### 5.2 優化圖片提示詞（Claude 英文版）

```typescript
// POST /api/claude/enhance-story-prompts
// 輸入：{ title, style, scenes: [{title, description}], storyContent? }
// 輸出：{ scenes: [{ index, enhanced_prompt }] }
// 作用：把中文場景描述轉換為英文圖片生成提示詞（含起承轉合情緒引導）

// 關鍵 prompt 要求：
// - 包含畫風關鍵詞
// - 視覺情緒符合該幕敘事角色（起：輕鬆建立、承：發展緊張、轉：戲劇衝突、合：平靜圓滿）
// - 最後一幕有「結束感」視覺元素（溫暖光芒、人物滿足表情、場景回歸平靜）
// - 50-100 個英文單字
// - 加入 masterpiece, high quality, detailed 等品質詞
```

### 5.3 生成動畫提示詞

```typescript
// POST /api/story-generations/:storyId/generate-animation-prompts
// 輸入：{ duration: number }（影片時長，預設 5 秒）
// 輸出：{ scenes: [{ actualSceneIndex, sceneTitle, animation_prompt }] }
// 注意：actualSceneIndex 是在完整 scenes 陣列中的真實索引

// 起承轉合動畫節奏：
// - 起：緩慢推進，建立氛圍 (slow push in)
// - 承：穩定推進，逐漸加快 (steady pan)
// - 轉：強烈動態，戲劇性鏡頭 (dramatic zoom)
// - 合：緩慢拉遠或淡出 (slow zoom out / gentle fade)
// 最後一幕必有明確結束感
```

---

## 六、動畫生成路由（SeedDance 2.0）

### 6.1 單幕動畫生成

```typescript
// POST /api/story-generations/:storyId/animate-scene/:sceneIdx
// 輸入：{ duration, resolution: "720p"|"1080p", aspectRatio, prompt? }
// 積分費用：duration × (720p: 3.4, 1080p: 6.8)，無條件進位
// 處理：建立 videoGeneration 記錄 → 扣積分 → 非同步呼叫 processSceneAnimation

// 比例自動偵測邏輯（根據圖片尺寸）：
const detectAspectRatio = (sceneSize: string): string => {
  if (sceneSize === "16:9") return "16:9";
  if (sceneSize === "9:16") return "9:16";
  return "1:1";
};
```

### 6.2 批量動畫生成

```typescript
// POST /api/story-generations/:storyId/animate
// 輸入：{
//   duration: number,
//   perScenePromptsByActual: Record<number, string>,  // 各幕提示詞（以實際 sceneIdx 為 key）
//   perSceneResolutions: Record<number, "720p"|"1080p">  // 各幕解析度
// }
// 作用：對所有已完成幕批量觸發動畫生成
```

---

## 七、前端狀態設計（React）

```typescript
// ─── 故事模式核心狀態 ───
const [storyTitle, setStoryTitle] = useState("");
const [storyStyle, setStoryStyle] = useState("watercolor");
const [storyCustomStyle, setStoryCustomStyle] = useState("");
const [storySceneCount, setStorySceneCount] = useState(4);
const [storyContent, setStoryContent] = useState("");
const [storyScenes, setStoryScenes] = useState<Array<{title:string;description:string;sceneReferenceImageUrl?:string}>>([
  {title:"",description:""},{title:"",description:""},{title:"",description:""},{title:"",description:""},
]);
// 三類參考圖上傳路徑
const [characterImages, setCharacterImages] = useState<string[]>([]);   // 主角
const [sceneRefImages, setSceneRefImages] = useState<string[]>([]);     // 場景
const [styleImages, setStyleImages] = useState<string[]>([]);           // 畫風
// 圖片尺寸
const [storySceneSize, setStorySceneSize] = useState<"1:1"|"9:16"|"16:9">("1:1");
// 生成後輪詢
const [currentStoryId, setCurrentStoryId] = useState<string | null>(null);

// ─── 動畫相關狀態 ───
const [animDuration, setAnimDuration] = useState(5);
const [perSceneAnimPrompts, setPerSceneAnimPrompts] = useState<Record<number, string>>({});
const [perSceneResolution, setPerSceneResolution] = useState<Record<number, "720p"|"1080p">>({});

// ─── 輪詢故事生成進度 ───
const { data: storyGeneration } = useQuery({
  queryKey: ["/api/story-generations", currentStoryId],
  queryFn: async () => {
    const res = await fetch(`/api/story-generations/${currentStoryId}`);
    return res.json();
  },
  enabled: !!currentStoryId,
  refetchInterval: (data: any) =>
    data && ["completed", "failed"].includes(data?.status) ? false : 2000,
});
```

### 7.1 起承轉合工具函數

```typescript
// 根據場景索引計算起承轉合角色，用於顯示彩色標籤
const getNarrativeInfo = (idx: number, total: number) => {
  const ratio = idx / Math.max(total - 1, 1);
  if (idx === 0)             return { label:"起開場", short:"起", color:"text-emerald-700", bg:"bg-emerald-50", border:"border-emerald-300", icon:"🌱" };
  if (idx === total - 1)     return { label:"合結局", short:"合", color:"text-purple-700",  bg:"bg-purple-50",  border:"border-purple-300",  icon:"✨" };
  if (ratio < 0.5)           return { label:"承發展", short:"承", color:"text-blue-700",    bg:"bg-blue-50",    border:"border-blue-300",    icon:"🔗" };
                             return { label:"轉高潮", short:"轉", color:"text-orange-700",  bg:"bg-orange-50",  border:"border-orange-300",  icon:"⚡" };
};
```

### 7.2 關鍵 Mutations

```typescript
// ─── 建立故事 ───
const createStoryMutation = useMutation({
  mutationFn: async () => {
    const res = await apiRequest("POST", "/api/story-generations", {
      title: storyTitle,
      style: storyStyle === "custom" ? storyCustomStyle : storyStyle,
      scenes: storyScenes.slice(0, storySceneCount),
      sceneSize: storySceneSize,
      characterImageUrls: characterImages,
      sceneRefImageUrls: sceneRefImages,
      styleImageUrls: styleImages,
      storyContent: storyContent.trim() || undefined,
    });
    return res.json();
  },
  onSuccess: (data) => setCurrentStoryId(data.id),
});

// ─── Claude 生成大綱 ───
const claudeOutlineMutation = useMutation({
  mutationFn: async () => {
    const res = await apiRequest("POST", "/api/claude/generate-story-outline", {
      title: storyTitle,
      style: storyStyle === "custom" ? storyCustomStyle : storyStyle,
      sceneCount: storySceneCount,
      storyContent: storyContent.trim() || undefined,
    });
    return res.json();
  },
  onSuccess: (data) => {
    const scenes = data.scenes || [];
    setStoryScenes(prev => {
      const updated = [...prev];
      scenes.forEach((s: any) => {
        if (s.index >= 0 && s.index < updated.length) {
          updated[s.index] = { ...updated[s.index], title: s.title, description: s.description };
        }
      });
      return updated;
    });
  },
});

// ─── Claude 優化圖片提示詞 ───
const claudeEnhanceMutation = useMutation({
  mutationFn: async () => {
    const res = await apiRequest("POST", "/api/claude/enhance-story-prompts", {
      title: storyTitle,
      style: storyStyle,
      scenes: storyScenes.slice(0, storySceneCount),
      storyContent: storyContent.trim() || undefined,
    });
    return res.json();
  },
  onSuccess: (data) => {
    const enhanced = data.scenes || [];
    setStoryScenes(prev => prev.map((scene, idx) => {
      const found = enhanced.find((e: any) => e.index === idx);
      return found ? { ...scene, description: found.enhanced_prompt } : scene;
    }));
  },
});

// ─── Claude 生成動畫提示詞 ───
const generateAnimPromptsMutation = useMutation({
  mutationFn: async () => {
    const res = await apiRequest("POST", `/api/story-generations/${currentStoryId}/generate-animation-prompts`, {
      duration: animDuration,
    });
    return res.json();
  },
  onSuccess: (data) => {
    const scenes = data.scenes || [];
    setPerSceneAnimPrompts(prev => {
      const updated = { ...prev };
      scenes.forEach((s: any) => {
        updated[s.actualSceneIndex] = s.animation_prompt;
      });
      return updated;
    });
  },
});

// ─── 單幕動畫生成 ───
const singleSceneAnimateMutation = useMutation({
  mutationFn: async ({ sceneIdx, resolution, prompt }: { sceneIdx: number; resolution?: "720p"|"1080p"; prompt?: string }) => {
    const res = await apiRequest("POST", `/api/story-generations/${currentStoryId}/animate-scene/${sceneIdx}`, {
      duration: animDuration,
      resolution: resolution ?? perSceneResolution[sceneIdx] ?? "720p",
      prompt: prompt ?? perSceneAnimPrompts[sceneIdx] ?? "",
    });
    return res.json();
  },
});

// ─── 批量動畫生成 ───
const batchAnimateMutation = useMutation({
  mutationFn: async () => {
    const res = await apiRequest("POST", `/api/story-generations/${currentStoryId}/animate`, {
      duration: animDuration,
      perScenePromptsByActual: perSceneAnimPrompts,
      perSceneResolutions: perSceneResolution,
    });
    return res.json();
  },
});
```

---

## 八、定價邏輯

| 功能 | 費用 |
|------|------|
| 圖片生成（每幕） | 3 積分 |
| 動畫 720P | 時長 × 3.4 積分/秒 |
| 動畫 1080P | 時長 × 6.8 積分/秒 |
| 失敗 | 全額退款 |

```typescript
// 圖片積分計算
const storyCredits = scenes.length * 3;

// 動畫積分計算
const calcAnimCredits = (duration: number, resolution: "720p"|"1080p") =>
  Math.round(duration * (resolution === "720p" ? 3.4 : 6.8));
```

---

## 九、必要依賴

```json
// 後端
"@anthropic-ai/sdk": "^0.39.0",    // Claude AI
"drizzle-orm": "^0.39.3",           // ORM
"drizzle-zod": "^0.7.0",            // Schema 驗證
"zod": "^3.24.2",                   // 型別驗證

// 前端
"@tanstack/react-query": "^5.x",    // 資料請求與輪詢
"wouter": "^3.x"                    // 路由
```

---

## 十、環境變數

```env
ARK_API_KEY=...               # BytePlus ARK 圖片生成 API Key
ANTHROPIC_API_KEY=...         # Claude AI API Key（通常由 Replit Integration 管理）
BUNNY_STORAGE_ZONE=...        # Bunny.net 儲存區名稱
BUNNY_ACCESS_KEY=...          # Bunny.net API 金鑰
BUNNY_CDN_HOST=...            # Bunny.net CDN 網域
DATABASE_URL=...              # PostgreSQL 連線字串
```

---

## 十一、Bunny CDN 路徑規則

```
images:  users/{userFolder}/stories/{storyId}_{sceneIdx}.jpg
videos:  users/{userFolder}/story-videos/{storyId}_{sceneIdx}.mp4
```

---

## 十二、完整 API 端點列表

| Method | Path | 說明 |
|--------|------|------|
| POST | `/api/story-generations` | 建立故事，扣積分，啟動後台生成 |
| GET | `/api/story-generations` | 取得使用者故事歷史列表 |
| GET | `/api/story-generations/:id` | 取得單一故事（前端輪詢用） |
| PATCH | `/api/story-generations/:storyId` | 更新故事標題 |
| POST | `/api/story-generations/:storyId/animate-scene/:sceneIdx` | 單幕動畫生成 |
| POST | `/api/story-generations/:storyId/animate` | 批量動畫生成 |
| POST | `/api/story-generations/:storyId/generate-animation-prompts` | Claude 生成動畫提示詞 |
| POST | `/api/story-generations/:storyId/regenerate-scene/:sceneIdx` | 重新生成單幕圖片 |
| POST | `/api/claude/generate-story-outline` | Claude 生成故事大綱 |
| POST | `/api/claude/enhance-story-prompts` | Claude 優化場景提示詞（轉英文） |

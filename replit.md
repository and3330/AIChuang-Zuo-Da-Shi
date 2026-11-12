# AI 創意工坊 - AI Image & Video Generation Platform

## Overview

A full-stack commercial AI image and video generation platform using the AtlasCloud API (Seedream 5.5 images, WAN 3.0 video), designed for the Taiwanese market. It enables users to generate and edit AI images and videos, including text-to-image, image-to-image, image-to-video, and advanced narrative video creation through the Drama Studio. The platform features a credit-based pricing model (1 credit = 1 TWD), a member registration/login system, and transaction history tracking. The entire platform is localized in Traditional Chinese.

## User Preferences

Preferred communication style: Simple, everyday language (Chinese preferred).

## System Architecture

### UI/UX
The platform features a React-based frontend with shadcn/ui and Tailwind CSS for a modern and responsive user experience. The Drama Studio specifically utilizes a ComicFlow-inspired visual node editor with a light theme, offering two view modes (node flow and grid) for intuitive scene arrangement. Navigation headers consistently display credit balances and cost indicators.

### Technical Implementation
- **Backend**: Node.js with Express.js handles API routes, authentication, and business logic.
- **Database**: PostgreSQL with Drizzle ORM manages user data, credit transactions, and generation records.
- **Authentication**: Express session-based authentication is used, secured with bcryptjs for password hashing. It supports email verification via Gmail SMTP and integrates Google OAuth 2.0 for seamless login/registration. Admin users are managed via an environment variable.
- **Credit System**: A credit-based system tracks user balances. Credits are deducted upon generation initiation, with frontend and backend validation.
- **File Storage**: User uploads are temporarily stored on Replit Object Storage. All generated content (images and videos) is persistently stored on Bunny.net CDN, organized into per-user folders.
- **Generation Logic**: Integrates with the AtlasCloud API for AI image and video generation (see the 2026-11 note below; older SeedDance / omni-mode details in this file are historical). Specific models used include Seedream 5.5 for images and SeedDance 2.0 for videos, including an Omni mode for multi-image video generation in the Drama Studio. The public 圖片生影片 page on `home.tsx` also exposes the omni endpoint: users can attach up to 3 reference images (角色 / 風格 / 構圖) and one optional reference audio (MP3 / WAV / M4A / OGG, ≤ 25 MB). When any extra reference is supplied, `processVideoGeneration` switches to `SEEDDANCE_OMNI_ENDPOINT` with `generate_audio=true`, role-tags every reference image (`role:"reference_image"`), and streams the audio through a SSRF-guarded fetch with a 25 MB byte cap before encoding it as a `role:"reference_audio"` data URI. Validation now runs before credit deduction so a malformed request (>3 refs, missing main image, etc.) cannot consume credits. NSFW prompt enhancement is applied automatically to outbound API calls.
- **Admin System**: A comprehensive admin dashboard allows for user management, credit adjustments, platform statistics viewing, and monitoring of generation records and customer chats.
- **Live Chat System**: Users can communicate with administrators via a floating chat widget. Messages are stored in the database, and administrators can view and reply from their dashboard.
- **Drama Studio (漫劇工作室)**: This module provides a visual node editor for creating episodic narrative videos. It includes project and episode management, batch generation, and AI-powered script assistance (AI 智慧腳本助手 via Claude Haiku), prompt snippet libraries, and script templates. End-to-end automation now covers: (a) one-click batch animation of every scene in an episode (5s 720P with AI sound effects on by default), (b) server-side ffmpeg compilation that stitches all scene videos into a single vertical 1080×1920 mp4 with dialogue burned in as subtitles using a downloaded Noto Sans CJK TC font, and (c) the final compiled mp4 is uploaded to Bunny CDN and exposed via an in-page player with a download link.
  - **Global Asset Libraries (全域素材庫)**: Dedicated `/character-library` and `/scene-library` pages let users build cross-project, cross-episode reusable characters and scene locations. Characters get one-click 4-view generation (front / 3-quarter / side / back, 12 credits) via Seedream 5.5 — uploaded to Bunny CDN. Each scene's `characterIds` and `sceneLocationId` are wired into the per-scene image generation pipeline so the chosen library characters' front-view images and the location's primary reference image are passed as additional conditioning to Seedream, keeping looks consistent across episodes. Library scope is per user with ownership checks.
  - **First/Last Keyframe Mode (首尾關鍵幀)**: Each scene can pre-generate a first frame and a last frame (6 credits total) which SeedDance 2.0 then uses as `role:"first_frame"` / `role:"last_frame"` content parts to interpolate a smoother animation. Toggleable per scene in the inspector and per generation in the animate dialog (auto-disabled if frames are missing).
  - **AI Video Prompt Rewriter**: A per-scene endpoint asks Claude Haiku to rewrite the description + dialogue + cameraMovement into a professional cinematography prompt (景別/運鏡/光線/氛圍) stored in `scene.videoPrompt`. When present, it is preferred over `description` for SeedDance video generation.
  - **Script Import (劇本上傳)**: Project view exposes a "📄 上傳劇本" modal that accepts TXT or DOCX (parsed with `mammoth`). Claude Haiku then splits the story into N episodes × M scenes, extracts main characters (auto-saved to the global character library), and creates the episodes in one shot.
  - **ZIP Bundle Download**: A streaming endpoint (`/api/drama/episodes/:id/download-zip`) packages every scene image, first/last frame, scene video, the compiled mp4, and a `manifest.json` of script metadata using `archiver`, exposed via a "📦 下載素材 ZIP" button in the episode editor.
  - **連續模式 (Chain Mode)**: Episode-level toggle (`dramaEpisodes.chainMode`) plus a per-scene `chainModeOverride` (`"on" | "off" | "inherit"`) makes scene N+1 visually pick up where scene N ended: when generating or regenerating the main image, the previous scene's `lastFrameBunnyUrl > lastFrameUrl > bunnyUrl > imageUrl` is loaded (via SSRF-guarded fetch for remote URLs or object storage for `/objects/` paths) and prepended as the first Seedream reference, with a Chinese label note added to the prompt. The same chain logic applies to the first/last frame regeneration endpoint. The AI Video Prompt Rewriter (Claude Haiku) additionally receives the previous and next scene's title + description as context and is asked to write a clip that naturally bridges adjacent scenes. The Drama editor exposes a green "🔗 連續模式" pill in the top bar, a per-scene 3-way override panel in the inspector with a thumbnail preview of the chosen continuity reference, and a green "🔗 銜接 #N-1" badge on each chained scene card in both the flow canvas and grid views. Two extra per-scene fields let the user override which image is fed in: `chainRefSource` (`"auto" | "prevLast" | "prevFirst" | "prevMain" | "custom"`) selects a specific frame of the previous scene from a dropdown, and `chainRefCustomUrl` (object-storage path or CDN URL, uploaded via the inspector "＋ 上傳自訂銜接圖" button) is a user-supplied image; the backend resolves the continuity ref with priority `chainRefCustomUrl > chainRefSource > default fallback chain` consistently across `processDramaEpisode`, `regenerateDramaScene`, and `generate-frames`.
  - **每日生成限制 (Daily Quotas)**: `/api/image-generations` 與 `/api/video-generations` 在扣積分前先呼叫 `storage.getUserDailyImageCount` / `getUserDailyVideoCount`（以 UTC 當日 00:00 為起點 `count(*) where userId AND createdAt > startOfDay`），預設上限為 50 張圖／日、10 支影片／日；超過回 HTTP 429 與中文錯誤，admin（`user.isAdmin`）整段 bypass。圖片端點額外把同一請求要的 `prompts.length` 或 `maxImages` 算進預估量避免大批次撞線後才被擋。
  - **PDF 劇本上傳**: 劇本匯入端點除 TXT/DOCX 外另接受 `.pdf`，以動態 `import("pdf-parse-fork")` 解析整份文字，遇空字串（掃描檔／加密檔）回 400 並提示改用 TXT/DOCX；匯入彈窗 input `accept` 已改為 `.txt,.docx,.pdf`。
  - **行動版底部 Tab Bar**: `MobileTabBar` 包含 首頁 / 漫劇 / 角色庫 / 帳戶（admin 多顯示 管理）共 4–5 個分頁，sm 以下顯示，安全區內距已套 `pb-[env(safe-area-inset-bottom)]`。
  - **資產庫快速搜尋**: 角色庫與場景庫頁面新增頁內搜尋框，輸入後即時過濾 name / description（角色再加 styleHint），不需 schema 變更。
  - **場景縮圖延遲載入**: drama 編輯器的流程圖與 grid 視圖場景卡片 `<img>` 都加 `loading="lazy" decoding="async"`，超過 12 幕的長集數能避免一次載入大量 CDN 圖片。
  - **整集套用銜接設定**: 場景檢查器的「銜接來源」下拉旁新增「⤵ 套用至全部幕」按鈕，會把當前的 `chainRefSource` + `chainModeOverride` 複製到第 2 幕之後的所有幕（custom 來源不允許批次因每幕來源圖不同），需手動按💾 儲存提交。
  - **轉場淡入淡出 (Compile Crossfade)**: The episode compile endpoint accepts an optional `crossfadeMs` body field (default 400ms, clamped to 0–2000 and additionally to half the shortest clip). When > 0 and there are 2+ scenes, `server/dramaCompiler.ts` builds a pairwise `xfade=transition=fade` + `acrossfade` chain instead of a hard `concat`, producing a smooth video + audio transition between adjacent scenes. The subtitle ASS timeline is rebuilt against cumulative-with-overlap timestamps and the per-scene dialogue window is tightened by half the crossfade so subtitles never bleed into the fade. Scene durations are probed with `ffprobe` instead of trusting the requested duration. The episode editor's compile button is wrapped in a green pill containing a shadcn `Slider` that snaps to 0 (硬切) / 200 / 400 / 800 ms with a live ms readout, and the chosen value is sent on both first compile and retry.
- **Telegram Bot**: Full integration with a Telegram bot allows users to bind their accounts, check balances, and perform image/video generation directly through Telegram commands.
- **NSFW 創作頁 (`/nsfw`)**: 獨立成人向頁面，沿用既有 `/api/image-generations` 文字生圖 / 圖片編輯流程（同 Seedream 5.5 model、同 object storage upload、同積分扣費），右側面板為提示詞輸入 + 尺寸 / 引導強度 / seed / 浮水印 控制 + 結果預覽，左側為兩段式範本區：(1) 最上方「🚀 一鍵範本」grid，10 組常用情境（校園制服／浴室／OL／海邊／KTV／車內／婚紗／和服／溫泉／卧室晨光）每組是完整可直接出圖的英文 prompt，點任一卡片用 `applyQuickTemplate()` 直接覆蓋或追加到 textarea（已有內容會 `window.confirm` 詢問覆蓋或接續，含 toast + scrollIntoView 提示），定義於 `client/src/pages/nsfw.tsx` 的 `QUICK_TEMPLATES` 常數；(2) 預設折疊的「🧰 進階詞庫」收納 15 個亞洲日系 NSFW 提示詞模板庫（`client/public/nsfw-templates/00-范例.md` ~ `14-人格卡片.md`，來源 `github.com/ShuaiHui/nsfw-prompt-templates-asian`），按類別下拉切換 + 延遲 `fetch()` 載入並以輕量 markdown parser 解析，markdown 表格用兩階段渲染：解析後處理把「在 `---` 分隔線之前的最後一個 tableRow」標記為 `tableHeader`（純顯示、灰底小字、不可點），其餘 `tableRow` 整列當一張卡片（左側 ID monofont 徽章、主格當標題、其餘格做灰底小 chip 顯示、右側 ＋ icon），點整張卡片用 `tableRowToPrompt()` 把所有非 ID 格依 `/、，,` 二次切碎後 `, ` 串接一次塞入提示詞，避免舊版把每格當獨立 chip 造成「ID / 場景名稱 / 暴露部位 / 風格 / 關鍵字」散落滿屏的難用感；bullet / heading / quote 也都解析為對應視覺。含關鍵字搜尋（過濾 chip / table cell / heading）、18+ age gate（`localStorage` 記憶同意）與 NavigationHeader / 路由註冊。
- **NSFW 圖生影片**: `/nsfw` 頁面新增第三個模式 tab「🎬 圖生影片」（紫色，與粉色圖片模式區分），復用既有 `/api/video-generations` 端點（type=`image-to-video`、SeedDance 2.0），不新增任何後端 surface — 同一張 `UnifiedUploader` 元件接收靜態圖、提示詞框描述動態、視訊面板顯示時長（3/5/8/10s）+ 比例（9:16 預設 / 16:9 / 1:1）+ 畫質（720P 8 積分/秒 / 1080P 15 積分/秒），即時顯示預估扣費。切到此模式時自動隱藏 AI 模型下拉與圖片尺寸/seed/guidance/watermark 控制，避開誤觸 GMI（GMI 不支援影片）。送出時清空 `currentGenerationId`（圖片結果）、設定 `currentVideoGenerationId` 並輪詢 `/api/video-generations/:id`（3 s 一次）；獨立的紫色「🎬 影片生成結果」卡顯示渲染進度條／成片 `<video controls>`／下載與「再生一支」按鈕／失敗訊息，與圖片結果卡並存不互相覆蓋。每日上限 10 支由後端強制（429 訊息已中文化）。
- **2026-11 全面脫離 BytePlus／GMI，生成全部走 AtlasCloud**（唯一金鑰 `ATLASCLOUD_API_KEY`，程式在 `server/atlasProvider.ts`）: 圖片 = Seedream 5.5（`atlasGenerateImage()`）；圖生影片 = `alibaba/wan-3.0/image-to-video`（`atlasGenerateVideo()`，首幀須為公開網址，上傳圖先經 `toPublicImageUrl()` 轉存 Bunny，支援 `last_image`）；文字生影片 = `alibaba/wan-3.0/text-to-video`（`atlasGenerateTextVideo()`，含 Telegram bot）。WAN 沒有多參考圖／參考音訊輸入，「全能模式」相關 UI 仍在但不生效。漫劇的 Claude 呼叫改用 Replit Anthropic 整合（`AI_INTEGRATIONS_ANTHROPIC_*`）。`server/gmiProvider.ts`、`server/seedDanceV2.ts`、`scripts/verify-seeddance-omni.ts` 已刪除。`ARK_API_KEY`、`ARK_VIDEO_MODEL`、`ARK_VIDEO_OMNI_MODEL`、`GMI_API_KEY` 已不再使用。計價不變（圖 3／8 積分，影片 720P 8、1080P 15 積分/秒）。下方凡提到 BytePlus ARK／SeedDance 的段落皆為歷史描述。
- **創作者工作流補齊（2026-11）**: (1) 拍攝控制：`/photoset` 多了鏡頭風格、表情、道具（角色模式另有場景）四個用選的維度，選項在 `shared/photosetOptions.ts`（`SHOT_STYLES`、`EXPRESSIONS`、`SETTINGS`、`PROP_PRESETS`、`shootControlText()`），規劃時併入風格方向。(2) 場景庫可直接當情境圖（情境寫真的下拉選單）。(3) 作品庫 `/vault`（`server/vault.ts`、`GET /api/vault`）：彙整使用者所有完成的圖片與影片，不需新資料表；另有只允許自家 CDN 的 `GET /api/vault/proxy` 供編輯器在 canvas 讀圖。(4) 編輯器 `/edit?image=…`（`client/src/pages/edit.tsx`）：局部修改（在圖上框選，前端把紅框畫在副本上連同原圖一起送給 Seedream edit）、換表情、加物件、換顏色、質感、高清重製（最高 2K）；全部走既有的 `POST /api/image-generations`，可一版接一版修改。(5) `client/src/components/CharacterWizard.tsx`：三張照片（臉＋兩張全身）建立角色，必須勾選本人或已獲同意。色票：indigo 品牌、slate 中性、amber 積分與警示、emerald 成功、red 錯誤、rose 成人專區；`tailwind.config.ts` 把 `purple`／`violet`／`blue` 都對應到 indigo。手機版注意：單欄 grid 一定要寫 `grid-cols-1`，否則內容最小寬度會把頁面撐得比螢幕寬。
- **統一導覽與視覺（2026-11，改版第一階段）**: 登入後所有頁面共用 `client/src/components/AppNav.tsx`：桌面是頂部導覽列（主要功能＋「更多」＋使用者選單），手機是原生 App 風格的標題列（子頁面有返回鍵）加五格底部分頁列（創作／寫真／漫劇／圖庫／我的，「我的」開啟底部選單）。新增頁面只要在 `DESTINATIONS` 加一筆。不要再在個別頁面自己寫頁首。全站配色統一為 indigo＋slate：`tailwind.config.ts` 把 `purple`／`violet` 對應到 indigo、`gray` 對應到 slate，所以舊頁面的 `purple-*`、`gray-*` class 會自動呈現同一套顏色。`index.css` 加了手機行為（輸入框 16px 防 iOS 縮放、去除點擊延遲與高亮、安全區留白）。第二階段：`/` 改為創作中心（`client/src/pages/create-hub.tsx`，帳戶摘要＋功能入口卡片）；原首頁 `pages/home.tsx` 變成工作頁，依 `section` 屬性分成 `/create/image` 與 `/create/video`，公告跑馬燈、統計列、模型分頁列與已失效的「全能模式」參考素材／參考音訊控制項已移除。`useUser` 移到 `client/src/hooks/use-user.ts`（`@/App` 仍有 re-export），解開各頁面與 App 的循環引用。注意：`home.tsx` 裡的故事分鏡模式（`mode === "story"`，約 1,700 行）目前沒有任何入口可以進入，屬於無法到達的程式碼，待決定恢復或刪除。後續待辦：各頁內容區塊統一、以對話框取代 `window.confirm`、`home.tsx` 實體拆檔。知識圖譜在 `graphify-out/`（未進版控）。
- **素材圖庫（`shared/libraryCatalog.ts`、`server/assetLibrary.ts`、`/library`、後台「素材圖庫」分頁）**: 姿勢／服裝／人像三個圖庫。清單是程式裡用屬性組合產生的原創文字，共 6,757 筆（姿勢 2,034 = 288 組組合姿勢 × 5 視角（1,439）＋ 119 組手寫姿勢 × 5 視角（595，含新分類「伸展」「雙人」，`EXTRA_POSES`）；服裝 3,224 = 52 套 × 8 配色 × 8 布料細節；人像 1,499 = 25 髮型 × 5 髮色 × 4 表情 × 3 臉型），不含任何外部圖片；全部生成約 18.5 美元。後台先按「同步清單」寫入新表 `library_assets`（需 `npm run db:push`），再按「開始生成」並填張數上限；預覽圖用便宜的 `openai/gpt-image-2.5-flare/text-to-image`（`atlasGenerateLibraryImage()`，約 0.003 美元／張，可用 `LIBRARY_IMAGE_MODEL`、`LIBRARY_IMAGE_QUALITY` 覆寫），轉成 WebP 與縮圖存到 Bunny 的 `library/`。可停止、續跑、重試失敗、單張重生；整批都失敗會自動停。成人向分類（居家睡衣、泳裝）只有管理員看得到。要擴充就往清單加項目再同步。瀏覽頁有「分組／單張」兩種檢視（`GET /api/library/groups`：一個姿勢／一套穿搭／一種髮型一張卡，卡內切換視角、布料細節或表情臉型；姿勢可依視角篩選）。底部「配方槽」可各選一張人像、服裝、姿勢（存在瀏覽器 localStorage，`client/src/lib/recipe.ts`），按「帶到寫真套圖」會開啟 `/photoset?recipe=1`：人像成為參考圖、服裝與姿勢寫進風格方向、規劃後每個鏡頭自動附上姿勢參考圖，規劃改用 `characterGoal: "shoot"`（由 AI 選一個統一地點拍寫真，而非棚拍定裝圖）。
- **對外服務 API `/api/v1/partner/*`（`server/partnerApi.ts`、`server/partnerStore.ts`，文件 `docs/partner-api.md`）**: 給其他系統後端用服務權杖（Bearer，資料庫只存 SHA-256）呼叫的圖片／影片／寫真套圖 API，重用本站的生成 worker。新增 `partner_tokens`、`partner_jobs` 兩張表（需 `npm run db:push`，不更動既有表）。預設不套用提示詞強化（worker 的 `rawPrompt` 選項），只有權杖開放且請求帶 `nsfw:true` 才套用；預設無浮水印。支援 Idempotency-Key、每權杖頻率與每日上限、拒絕帶 Origin 的請求。後台「對外 API」分頁管理權杖。測試：`npx tsx scripts/test-partner-api.ts`（記憶體假資料，81 項）。
- **寫真套圖 `/photoset`（`server/photoset.ts`、`client/src/pages/photoset.tsx`）**: 兩種模式。「情境寫真」= 情境圖決定場景氛圍＋角色參考圖（角色庫角色與臨時上傳，最多 9 張）決定人物，可選服裝來源；沒有參考圖時沿用情境圖的人物。「角色九宮格」= 不用情境圖，以角色參考圖生成定裝圖（視角／表情／姿勢），可用固定九宮格（不呼叫 Claude）或 AI 規劃。`POST /api/photosets/plan` 只負責規劃（免費），生成走既有批次端點（`prompts` + 新增的 `additionalImageUrls`），送給模型的圖片順序固定為 [情境圖, ...參考圖]，前端會在每條提示詞後附上圖片用途說明。成果可一鍵存回角色圖庫（只存已轉存 Bunny 的網址）。角色圖庫上限由 6 張提高到 30 張（`CHARACTER_PACK_MAX_IMAGES`），生成時取前 9–10 張。尺寸表在 `shared/imageSizes.ts`（8 比例 × 3 畫質）。`shared/photosetOptions.ts` 放「畫面質感」（自然寫實／手機隨拍／底片感／棚拍精修，文字會附加在每條提示詞後，用來降低 AI 感）與自製的文字姿勢庫（50 個姿勢、8 類）；選了姿勢時規劃 API 會依序一個姿勢出一個鏡頭，也可在鏡頭清單直接從姿勢庫新增。每個鏡頭另可上傳一張「姿勢參考圖」（批次端點的 `promptImageUrls`，與 `prompts` 同索引，附在共用參考圖之後；有姿勢參考圖時共用參考圖取前 8 張）。外部姿勢圖庫（ギア，https://ai-pose-gallery.pages.dev/）的條款：可免費用於創作含商用、可一次一張當生成參考；禁止批次／自動下載、禁止再散布或轉載圖片本身。因此本站不鏡像、不盜連該圖庫，只提供連結讓使用者自行挑一張下載後上傳。
- **圖片生成統一走 AtlasCloud Seedream 5.5**: 全站所有圖片生成（`/home`、`/nsfw`、故事、漫劇、角色四視圖、首尾幀、Telegram bot）都經由 `server/atlasProvider.ts` 的 `atlasGenerateImage()`。有參考圖用 `bytedance/seedream-v5.5/edit`（1–10 張），沒有參考圖用 `bytedance/seedream-v5.5/text-to-image`。BytePlus ARK 圖片端點、GMI 圖片模型、Atlas FLUX LoRA 已全部移除（GMI 只剩影片）。`/nsfw` 的圖片模型下拉已移除。

## External Dependencies

- **AtlasCloud API** (`ATLASCLOUD_API_KEY`): 圖片生成 Seedream 5.5。非同步：POST `https://api.atlascloud.ai/api/v1/model/generateImage` 取得 prediction id，再輪詢 GET `/api/v1/model/prediction/{id}`。`size` 為 `寬*高` 且必須是官方預設值（`toAtlasSize()` 會自動對應）；不支援 `seed` 與 `watermark` 參數（品牌浮水印仍由本地 `addWatermark()` 加上）。
- **BytePlus ARK API**: 已於 2026-11 完全移除，不再呼叫。
- **PostgreSQL**: Primary database for all application data.
- **Bunny.net CDN**: For persistent storage and delivery of all generated images and videos.
- **Google OAuth 2.0**: For user authentication and registration.
- **Gmail SMTP**: For sending email verification codes.
- **Telegram Bot API**: For integrating bot functionalities.
- **Claude Haiku (via specific API)**: Used for AI-powered script generation, script import (story → episodes/characters), and per-scene professional video prompt rewriting in the Drama Studio.
- **sharp**: Image processing library for aspect ratio correction before video API calls.
- **mammoth**: DOCX parser used by the Drama Studio script import flow.
- **archiver**: Streaming ZIP packer used by the Drama Studio episode bundle download endpoint.

## 模組分層與介面（2026-11 重整）

- 主要模組：創作（`/`、`/create/image`、`/create/video`）、寫真工作室（`/photoset`）、漫劇工作室（`/drama`）、素材圖庫（`/library`）。桌面導覽列與手機底部分頁只放這四個。
- 個人專區：作品庫、編輯器、帳戶與儲值、交易記錄（桌面「我的」選單、手機「我的」底部選單）。次要素材：角色庫、場景庫。導覽全部定義在 `client/src/components/AppNav.tsx`。
- 寫真工作室有兩區：情境寫真（`?mode=scene`）與寫真套圖（`?mode=kit`，不需情境圖）。人像／服裝／姿勢都用 `client/src/components/LibraryPicker.tsx` 從素材圖庫挑；舊的內建姿勢清單只剩對外 API 使用。
- 角色九宮格搬到角色庫：`/character-library/sheet?character=<id>`（同一個頁面元件，`variant="sheet"`，固定規格，沒有比例與質感設定）。
- 參考圖配額（Seedream 一次最多 10 張）：`REF_BUDGET` in `shared/photosetOptions.ts` —— 情境 1、人物最多 6、服裝 1、每個鏡頭的姿勢 1。送圖順序與提示詞說明由 `studioReferenceNote()` 決定，兩者必須一致。
- 規劃端點 `/api/photosets/plan` 多了 `customPoses`（素材圖庫的姿勢，自由文字）。
- 配色：紫→靛→藍的品牌漸層（`bg-brand`、`text-brand`、`shadow-glow`），淺藍 sky 為輔，fuchsia／amber 為跳色。`client/src/index.css` 末段把所有實心品牌色與頁面底色一次換掉，新頁面直接用 `bg-indigo-600` 即可得到漸層。

## 收費、會員與安全隱私（2026-11）

- 計價集中在 `shared/pricing.ts`：圖片 `IMAGE_COST`（5）、去浮水印 `WATERMARK_REMOVAL_COST`（+1）、註冊送 `SIGNUP_CREDITS`（10，信箱驗證碼通過或 Google 註冊時發一次）、`MEMBERSHIP`（US$9.9 一次性開通，送 200 積分）。對外 API 的計價另在 `server/partnerApi.ts`，沒有跟著改。
- 付款：`POST /api/stripe/create-checkout` 收 `{ kind: "membership" }`（美金）或 `{ amount }`（台幣加購，必須已是會員）。`users.is_member` 在付款確認後設定。
- `POST /api/credits/topup` 只限管理員（以前任何登入者都能呼叫）。
- 安全隱私在 `shared/safety.ts` 與 `PATCH /api/account/safety`：生日只能設定一次；成人內容要年滿 18、同意條款才能啟用。提示詞被 `containsNsfw()` 判定為成人內容時，未啟用的帳號回 403 `nsfw_not_enabled`（不扣積分）；啟用的帳號可生成，`image_generations.sensitive` 設為 true，前端用 `SensitiveGate` 先模糊顯示。提示詞強化（`server/promptEnhancer.ts`）現在只作用在成人內容的提示詞上。
- 新增欄位（需要 `npm run db:push`）：`users.is_member / member_since / birth_date / nsfw_enabled / nsfw_consent_at / onboarded_at`、`image_generations.sensitive`。
- 測試：`npx tsx scripts/test-safety.ts`。

## 寫真工作室步驟式流程（2026-11）

- 一步一步展開（`Step` in `client/src/pages/photoset.tsx`）。情境寫真：情境（文字或要模仿的照片，下方放人物參考圖）→ 角色 → 姿勢與服裝 → 張數與輸出。寫真套圖：人物 → 服裝 → 姿勢 → 張數與輸出。
- 姿勢與服裝各只選一個。姿勢用在第一張，其餘由 AI 安排，規劃後每個鏡頭可再換；服裝在生成時才加進提示詞，所以隨時可換、不用重新規劃。
- 選角色會帶入四視圖（最多 4 張）。張數可自訂 2–10。
- 共用元件：`VaultPicker`（從作品選圖）、`ReferenceCollage`（參考圖拼合卡片，可下載）、`LibraryPicker`、`Onboarding`（首次登入引導，掛在創作中心）。
- 漫劇專案設定改成從角色庫選角色（`CharacterRolePicker`），專案頁上方有四步流程。

## 對外 API：AI 角色（2026-11）

- 端點都在 `server/partnerApi.ts`：`POST /uploads`、`/characters` 的建立／列表／查詢／修改／刪除、`POST /characters/:id/four-views`；`/images`、`/videos`、`/photosets` 多接受 `owner_ref` 與 `character_ids`。文件與範例在 `docs/partner-api.md`。
- 隔離：角色存在新表 `partner_characters`，一律以（服務帳號 userId, owner_ref）過濾。所有讀取都經過 `loadCharacter()`，不符回 404，內容與不存在相同。`partner_jobs` 多了 `owner_ref`、`character_ids`；有 owner_ref 的任務查詢時必須帶同一個。
- 上傳：手寫的 multipart 解析（沒有新增套件），10 MB，依檔頭判斷 JPG／PNG／WEBP，`createPartnerUploadStore()` 用 sharp 重新編碼以去除全部 EXIF。檔案放在 `partner/u/{userId}/o/{owner_ref 雜湊}/`。
- 四視圖：建立 4 筆 image_generations 交給既有 worker（`rawPrompt: true`、無浮水印、每張 5 積分），角色的 `four_view_urls` 在下次讀取時由 `syncFourViews()` 從任務結果回填。提示詞搬到 `shared/fourViews.ts`，網站角色庫共用。
- 帶角色的生成一律不套用 NSFW 強化；`consent` 必須為 true 並記錄時間；後台可依 owner_ref 或代號停用（`PartnerCharactersPanel.tsx`）。
- 對外 API 計價改為與網站一致：有浮水印 5、無浮水印 6 積分。
- 需要 `npm run db:push`。測試：`npx tsx scripts/test-partner-api.ts`（141 項）。


## 漫劇集數編輯、動畫提示詞、圖庫批次（2026-11）

- 集數編輯畫面（`drama.tsx` 的 EpisodeView）：上方改成工具列＋四步流程列（劇本 → 分鏡圖 → 動畫 → 合成，`FlowStep`），每一步的批次按鈕放在那一步；手機版多了四步指示，並修正主要按鈕被底部分頁列與客服泡泡蓋住的問題。替換分鏡圖與風格參考圖可「從作品選」（後端只接受自己 CDN 的網址）。
- 動畫提示詞改用 `shared/dramaMotion.ts`：首幀錨點＋主體動態＋背景動態＋運鏡＋氛圍變化，不再重述靜態畫面；沒有寫過提示詞的幕在批次動畫時用 `fallbackMotionPrompt()`，不再直接拿畫面描述當動態提示詞。漫劇動畫與網站四視圖只有在提示詞含成人詞時才套用強化前綴。
- 素材圖庫批次（`server/assetLibrary.ts`）改成滾動式佇列，同時張數上限 32（預設 8）；遇到供應商限流會暫停 20 秒並把同時張數減半，連續失敗會自動停止。

- 成本紀錄（`server/costs.ts`、後台「成本」分頁 `CostPanel.tsx`）：每次 AtlasCloud 生成成功記一筆到 `provider_costs`（估算，單價可用 `COST_*` 環境變數修正，另有 `USD_TWD_RATE`、`PAYMENT_FEE_RATE`，預設 32 與 0.08）；同頁直接呼叫 AtlasCloud 帳務 API（`/public/v1/balance`、`/public/v1/model-costs`）顯示真實餘額與花費。需要 `npm run db:push`。
- Bunny 上傳遇到網路錯誤、429、5xx 會重試最多 3 次，避免已付費生成的圖因為存不進去而重畫。
- 素材圖庫預覽圖預設改用 Seedream 5.5 文字生圖（`bytedance/seedream-v5.5/text-to-image`，不帶參考圖；去背素材送 `background: transparent` + PNG）。要換回 GPT Image 2.5 Flare：設定 `LIBRARY_IMAGE_MODEL=openai/gpt-image-2.5-flare/text-to-image`。
- 服裝圖庫新增成人向 21 套 × 8 色 = 168 筆（`ADULT_COSTUME_GROUPS`：內衣、性感睡衣、性感泳裝、派對扮裝），`adult: true`、只有管理員看得到；圖庫總數 6,925（姿勢 2,034／服裝 3,392／人像 1,499）。
- 素材圖庫的成人向素材（`adult: true`）：管理員，以及已在帳號頁啟用「成人內容」的會員（需填生日、成年並同意條款，`canUseNsfw()`）都看得到；其他人查不到這些列。
- **會員兩階與黃金專區（2026-11-11）**：正式會員 US$9.9（`MEMBERSHIP`）、黃金會員再付 US$22 升級（`GOLD_MEMBERSHIP`，不含積分；`users.is_gold`／`gold_since`）。一般頁面一律拒絕 `containsNsfw()` 命中的提示詞（403 `content_not_allowed`），管理員也一樣；漫劇與角色四視圖改用 `plainImagePrompt()`，不再加成人前綴。成人內容只在黃金專區（`/gold`、`/gold/image`、`/gold/video`、`/gold/photoset`、`/gold/library`）開放：和一般區是同一套頁面與同一個模型，前端 `client/src/lib/zone.ts` 讓這些頁面送出的請求帶 `X-Zone: gold`，伺服器 `inGoldZone()` 另外檢查帳號是黃金會員、年滿 18、已同意條款（`canUseNsfw()`）。黃金專區的成品一律 `sensitive = true`；提示詞含未成年人或學生相關字詞（`containsMinorTerms()`）回 400 `minor_content`。成人向圖庫素材只回給黃金專區的請求。帳戶頁的黃金會員卡片在生日顯示年滿 18 之後才出現；非黃金會員開 `/gold` 看到的是一般的 404。後台「用戶」可手動設定階級（`PATCH /api/admin/users/:id/membership`）。舊的 `/nsfw` 頁面與 `client/public/nsfw-templates` 已刪除。上線要 Publish 才會套用新欄位。
- 黃金會員：必須先是正式會員才能付 US$22 升級，含 600 積分（`GOLD_MEMBERSHIP.credits`）。成人前綴（`enhanceImagePrompt`）現在套用在黃金專區送出的每一張圖（`image_generations.sensitive`），其他地方都不加；影片沒有這個欄位，仍然只在提示詞命中 `containsNsfw()` 時加前綴，而這種提示詞只有黃金專區收。
- **會員商城 `/store`（2026-11-11）**：所有付費集中在這頁（帳戶頁只剩摘要、生日、計價）。三階段：非會員看到小試身手 US$2／40 積分（`TRIAL`，每帳號一次，`users.trial_used_at`，不算會員）與正式會員 US$9.9；正式會員可買儲值包（`TOPUP_PACKS`：NT$100→100、300→320、500→550、1,000→1,150、3,000→3,600，自訂金額用 `topupCredits()` 套同級距比例）；黃金會員卡片只在「正式會員＋已填生日且滿 18」才出現。計價：一般區有浮水印 5、去浮水印 6（`WATERMARK_REMOVAL_COST` = 1）；黃金專區有浮水印 5、去浮水印 8（`GOLD_WATERMARK_REMOVAL_COST` = 3）。影片價格兩區相同。對外 API 價格固定為 5／6，不跟著變。Stripe 付款完成回到 `/store`。
- 管理員不受一般區限制：成人提示詞在任何頁面都收（成品標記 `sensitive`、加成人前綴），成人向圖庫素材在任何頁面都看得到。其他帳號（含正式會員、黃金會員）在一般區一律被擋，要到黃金專區才能用。
- 嵌入模式（客戶小鎮工作區）：對方用 `adult_birth_date` 為工作區開啟成人內容時，該子帳號會設為黃金會員，一樣要到黃金專區 `/gold` 才能用；關閉時取消。嵌入模式看不到會員商城。
- **作品牆（2026-11-11）**：`server/showcase.ts`＋`/wall`（熱門／最新／追蹤中）、`/wall/:id`（作品頁：讚、留言、檢舉、做同款）、`/u/:username`（創作者主頁：自我介紹、作品／獲讚／粉絲／追蹤中、追蹤）。未登入也能看，寫入都要登入。作品從作品庫按「公開到作品牆」投稿，狀態 pending → 後台「作品牆」分頁通過才上牆；被檢舉 3 次自動回到 pending。黃金專區的作品（`sensitive`）、提示詞命中 `containsNsfw()`／`containsMinorTerms()` 的作品不能公開；只收已轉存 CDN 的永久 https 網址。提示詞由作者決定是否公開，公開才有「做同款」（提示詞經 sessionStorage `remixPrompt` 帶進 `/create/image`）。嵌入模式（客戶小鎮工作區）不能使用作品牆。新表：`showcase_posts`、`showcase_likes`、`showcase_comments`、`showcase_reports`、`user_follows`，`users.bio`；上線要 Publish。
- **首頁改版（2026-11-11）**：`client/src/pages/landing.tsx` 重寫（設計系統由 ui-ux-pro-max skill 產出）：深色電影感、極光漸層、超大標題；主視覺 → 數字 → 功能方格 → 三步驟 → 作品牆熱門作品（有 6 張以上才顯示，主視覺拼貼也會改用真實作品）→ 定價（小試身手／正式會員／儲值包，數字讀 `shared/pricing.ts`，不出現黃金會員）→ 行動呼籲；手機底部固定開始按鈕。樣式在 `index.css` 的 `.lp-*`，減少動態效果時全部關閉。
- 首頁改為主打「社群寫真」：主標「一鍵生成，人人都是網美」，順序是主視覺 → 三步驟（人物／服裝／姿勢）→ 為什麼（經營社群、不用出門）→ 數字 → 成果 → 其他功能 → 作品牆 → 定價。主視覺與成果區用站內實際生成的 5 張寫真（`client/public/landing/*.webp`）。三步驟卡片會顯示圖庫的真實素材縮圖，來源是新的公開端點 `GET /api/library/samples`（每庫隨機 8 張、非成人、已完成，快取 10 分鐘）。
- 角色九宮格已停用：三張照片建立角色後直接留在角色庫（`CharacterWizard` 不再導到九宮格），角色卡片的九宮格按鈕、導覽項目都拿掉，`/character-library/sheet` 轉回角色庫。`photoset.tsx` 的 `variant="sheet"` 程式碼還在但沒有入口。
- 四視圖首次免費：每個帳號第一次生成角色四視圖不扣積分（`users.free_four_view_used_at`，以 compare-and-set 佔用；四張全失敗會把免費資格還回去）。嵌入模式的工作區沒有這個優惠。之後每次仍是 4 × `IMAGE_COST`。
- 三張照片建立角色：按「下一步」建立角色後回到角色庫；免費資格還在時會自動開始生成四視圖，用過之後只建立角色、不自動扣積分。
- 角色卡片的四視圖可以點圖放大（左右切換、Esc 關閉、下載）。
- 寫真工作室改為逐步顯示：一開始只有第一步，按「下一步」才出現下一步，全部走完才出現「規劃鏡頭」（`reached` 狀態；從素材圖庫帶配方進來時全部顯示）。人物參考圖上方新增提示「再上傳幾張你的照片，會更像你自己」。角色卡片的「拍寫真」會帶 `?mode=kit&character=<id>` 自動選好角色。
- 建立角色改為最多 10 張照片（`CharacterWizard`，`WIZARD_MAX_PHOTOS`；第一張是臉部正面，可調整順序）。寫真帶入角色時改為「本人照片優先，四視圖補滿」，最多 6 張（`characterImages()`，`REF_BUDGET.character`），不再只用四視圖。
- 角色外貌描述由 AI 自動寫：建立角色時若沒填描述，背景用 Claude 看前 4 張照片寫 80–150 字外貌特徵存進 `description`（`describeCharacterFromPhotos`，不覆蓋使用者自己寫的），寫真規劃與四視圖會帶入。
- 寫真工作室：預設分頁改為「寫真套圖」；沒有角色的人進來會自動跳出建立角色視窗（建好自動選上），角色選單旁多一顆「新角色」。原「情境寫真」改名「照片同款」：第一步是放一張要模仿的照片（沒有照片才用文字描述），人物照片改到第二步「角色」上傳。
- 後台「訂單」分頁新增訂單統計（`OrderStatsPanel`）：日／週／月／季，付款筆數、售出積分、實收 NT$／US$、手動加值積分。實收金額記在 `credit_transactions.paid_amount`／`paid_currency`（Stripe 的 `amount_total`，未扣手續費），這次改版後的訂單才有。
- 角色四視圖改成串接：先出正面，其餘三張把正面圖放在參考圖第 1 張（再接本人照片），四張服裝才會一致。模型維持 Seedream 5.5（2026-11-11 實測：Nano Banana 2.1 服裝一致性較好，但使用者認為 Seedream 臉比較像；FLUX 3 會擋清涼的參考照）。
- 新手導覽改成單一主線（`Onboarding.tsx`）：一頁說明四步（建立角色 → 選服裝 → 選姿勢 → 生成），按開始就進寫真工作室寫真套圖；想先做別的可切換選單。寫真工作室預設張數會依餘額調整（新帳號 10 積分＝2 張）。一組寫真完成後跳出會員商城邀請（非會員一定跳；會員在餘額不夠再做同樣一組時才跳；黃金專區不跳）。
- 黃金會員入口改到帳戶設定：存了滿 18 歲的生日後，生日上方出現「內容審查限制」，點開是「是否開啟 NSFW 模式」開關，打開跳出申請視窗（`GoldApplyDialog`）：認證 Email（`/api/account/email-code`、`/api/account/verify-email`）→ 真實姓名（`users.real_name`）→ 同意 AI 生成內容使用條款（`GOLD_TERMS_OF_USE`）→ 問是否加入 US$22。申請完成（`goldApplicationDone`）後會員商城才出現黃金會員；付款成功跳出導覽（從「我的」選單進入黃金專區）。除了那個開關，前台不出現 NSFW／成人字眼。
- 帳號的第一個角色至少要 6 張照片（`FIRST_CHARACTER_MIN_PHOTOS`，只在 `CharacterWizard` 前端檢查；之後的角色 1 張即可）。精靈會提醒成品取決於照片品質，短邊小於 640 像素的照片標「解析度低」。
- 四視圖改為 30 積分（`FOUR_VIEW_COST`，夥伴 API 價格不變）。第二個角色開始，精靈建立角色時一律生成四視圖並收 30 積分，積分不夠不能建立；第一個角色仍免費。帳戶 Email 驗證信改用 `sendVerificationEmail`（Resend）。
- 影片頁可選模型（`VIDEO_MODELS`，`shared/pricing.ts`）：WAN 3.0（8／15 積分每秒）與 Kling 4.0（12／20）。請求帶 `videoModel`，伺服器依模型計價並驗證文字生影片的畫面比例（WAN 多 4:3、3:4；Kling 多 21:9）。Kling 走 `kwaivgi/kling-v4.0/*`，參數是 `aspect_ratio`、沒有 `audio`。夥伴 API 與故事動畫仍只用 WAN。
- 商品帶貨圖（`/product`，`client/src/pages/product.tsx`）：上傳商品照（最多 3 張）＋選角色＋選範本（UGC 實拍、生活情境、服飾商拍、Listing 套圖、圖片廣告、美食飲品）→ `POST /api/photosets/plan`（mode `product`）回傳鏡頭與貼文文案、標籤 → 走寫真同一個批次生成端點。圖片順序 `[...角色圖, ...商品圖]`。
- 創作中心（`create-hub.tsx`）改成「熱門範本」牆＋「自由創作」（圖片生成、影片生成）。範本卡的 `href` 帶著流程參數（例如 `/product?template=ugc`、`/photoset?mode=scene`）；沒有示意圖的範本先用漸層加圖示。
- UGC 實拍短片（`/ugc`，`client/src/pages/ugc.tsx`）：商品＋角色 → `POST /api/photosets/plan`（mode `ugc`）寫腳本（每個鏡頭有首幀描述 `prompt`、英文動態 `motion`、字幕 `subtitle`、秒數）→ 批次生成首幀（9:16、不含浮水印）→ 每個鏡頭各自 `POST /api/video-generations` 圖生影片。不開口說話、不自動合成；字幕稿與貼文文案可複製。腳本規則取自擁有者的提示詞 Skill（短影音、影片連續性、圖生影片、鉤子公式）。

- 首頁（`landing.tsx`、`.lp-*`）改成粉紫色亮色版：底色 `#fff7fb`、白色卡片、紫到粉的漸層字與按鈕；漸層底上的文字一律 `text-white`。

- 創作中心範本卡加上小動畫：`client/public/landing/*.mp4`（用封面圖以 WAN 生成一次的 4 秒無聲片段，壓成寬 360 的靜態檔，多數做成正放加倒放的無縫循環）。`TEMPLATES` 的 `video` 欄位指向它，疊在封面圖上自動播放；減少動態效果時只顯示封面。

- 多語系（2026-11-12，先做英文）：`client/src/lib/i18n.ts` 的 `tr("中文")`，中文原句就是鍵，英文字典在 `client/src/locales/en.ts`；語言在載入時決定（localStorage `lang` → `?lang=` → 瀏覽器語言），`LangSwitch` 切換後重新載入。共用選項清單由 `lib/i18n-shared.ts` 在啟動時就地換成目前語言。`npx tsx scripts/check-i18n.ts` 檢查有沒有漏翻。伺服器訊息仍以中文回傳，前端用 `trServer()` 對照 `locales/en-server.ts`（固定句與帶 {0} 的句型）換成英文，接在 `lib/queryClient.ts` 的錯誤處理與交易記錄說明。素材圖庫的名稱、分類、說明由 `trAsset()` 用 `locales/en-library.ts` 的詞彙表（對應 `shared/libraryCatalog.ts`）組成英文，在讀取 `/api/library/*` 時套用；分類與視角的篩選值維持中文送回伺服器。規劃端點多收 `lang`，英文介面下 AI 的鏡頭、文案、字幕用英文寫。`npx tsx scripts/test-i18n.ts` 會跑過整份素材清單與幾句伺服器訊息。管理後台也已翻譯。前端每個請求帶 `X-Lang`，伺服器用 `server/lang.ts`（`requestLang`、`byLang`、`outputLanguageNote`）決定驗證信、Stripe 付款頁品名，以及漫劇 AI 劇本、劇本匯入、故事大綱、提示詞優化的輸出語言。圖庫英文搜尋由 `assetQuery()` 把英文關鍵字換成中文詞再送出。尚未翻：`client/index.html` 的靜態標題與 SEO 中繼資料、已存在資料庫裡的使用者內容與舊紀錄、Telegram 機器人、對外夥伴 API 的訊息。新增語言：加一個字典並在 `DICTS`、`LANGS` 登記。

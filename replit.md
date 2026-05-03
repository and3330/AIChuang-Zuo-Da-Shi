# AI 創意工坊 - AI Image & Video Generation Platform

## Overview

A full-stack commercial AI image and video generation platform using BytePlus ARK API, designed for the Taiwanese market. It enables users to generate and edit AI images and videos, including text-to-image, image-to-image, image-to-video, and advanced narrative video creation through the Drama Studio. The platform features a credit-based pricing model (1 credit = 1 TWD), a member registration/login system, and transaction history tracking. The entire platform is localized in Traditional Chinese.

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
- **Generation Logic**: Integrates with BytePlus ARK API for AI image and video generation. Specific models used include Seedream 5.0 for images and SeedDance 2.0 for videos, including an Omni mode for multi-image video generation in the Drama Studio. The public 圖片生影片 page on `home.tsx` also exposes the omni endpoint: users can attach up to 3 reference images (角色 / 風格 / 構圖) and one optional reference audio (MP3 / WAV / M4A / OGG, ≤ 25 MB). When any extra reference is supplied, `processVideoGeneration` switches to `SEEDDANCE_OMNI_ENDPOINT` with `generate_audio=true`, role-tags every reference image (`role:"reference_image"`), and streams the audio through a SSRF-guarded fetch with a 25 MB byte cap before encoding it as a `role:"reference_audio"` data URI. Validation now runs before credit deduction so a malformed request (>3 refs, missing main image, etc.) cannot consume credits. NSFW prompt enhancement is applied automatically to outbound API calls.
- **Admin System**: A comprehensive admin dashboard allows for user management, credit adjustments, platform statistics viewing, and monitoring of generation records and customer chats.
- **Live Chat System**: Users can communicate with administrators via a floating chat widget. Messages are stored in the database, and administrators can view and reply from their dashboard.
- **Drama Studio (漫劇工作室)**: This module provides a visual node editor for creating episodic narrative videos. It includes project and episode management, batch generation, and AI-powered script assistance (AI 智慧腳本助手 via Claude Haiku), prompt snippet libraries, and script templates. End-to-end automation now covers: (a) one-click batch animation of every scene in an episode (5s 720P with AI sound effects on by default), (b) server-side ffmpeg compilation that stitches all scene videos into a single vertical 1080×1920 mp4 with dialogue burned in as subtitles using a downloaded Noto Sans CJK TC font, and (c) the final compiled mp4 is uploaded to Bunny CDN and exposed via an in-page player with a download link.
  - **Global Asset Libraries (全域素材庫)**: Dedicated `/character-library` and `/scene-library` pages let users build cross-project, cross-episode reusable characters and scene locations. Characters get one-click 4-view generation (front / 3-quarter / side / back, 12 credits) via Seedream 5.0 — uploaded to Bunny CDN. Each scene's `characterIds` and `sceneLocationId` are wired into the per-scene image generation pipeline so the chosen library characters' front-view images and the location's primary reference image are passed as additional conditioning to Seedream, keeping looks consistent across episodes. Library scope is per user with ownership checks.
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

## External Dependencies

- **BytePlus ARK API**:
    - Image Generation: Seedream 5.0 (endpoint: `ep-20251223142939-njrkd`)
    - Video Generation: SeedDance 2.0 (endpoint: `ep-20260428161232-4znch`), including Omni mode.
- **PostgreSQL**: Primary database for all application data.
- **Bunny.net CDN**: For persistent storage and delivery of all generated images and videos.
- **Google OAuth 2.0**: For user authentication and registration.
- **Gmail SMTP**: For sending email verification codes.
- **Telegram Bot API**: For integrating bot functionalities.
- **Claude Haiku (via specific API)**: Used for AI-powered script generation, script import (story → episodes/characters), and per-scene professional video prompt rewriting in the Drama Studio.
- **sharp**: Image processing library for aspect ratio correction before video API calls.
- **mammoth**: DOCX parser used by the Drama Studio script import flow.
- **archiver**: Streaming ZIP packer used by the Drama Studio episode bundle download endpoint.
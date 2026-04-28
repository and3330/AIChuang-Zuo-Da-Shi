# AI 創意工坊 - AI Image & Video Generation Platform

## Overview

A full-stack commercial AI image and video generation platform using BytePlus ARK API. Supports image editing (image-to-image), text-to-image, image-to-video, sequential generation, multi-image input, batch generation, and narrative story storyboard generation. Features a member registration/login system, credit-based pricing (1 credit = 1 TWD), and transaction history tracking. Entirely in Chinese (Traditional).

## User Preferences

Preferred communication style: Simple, everyday language (Chinese preferred).

## Pricing Model
- Image generation: 3 credits per image
- Video generation (SeedDance 2.0, applies to all video features incl. Drama Studio): Resolution-based pricing (4-12 seconds)
  - 720P: 8 credits/second (charge); cost basis 5.5 TWD/second
  - 1080P: 15 credits/second (charge); cost basis 11 TWD/second
  - Example: 5 sec 720P = 40 credits (cost 27.5 TWD); 5 sec 1080P = 75 credits (cost 55 TWD)
- New user registration bonus: 10 credits
- 1 credit = 1 TWD (New Taiwan Dollar)
- `videoGenerations.cost` is now stored in TWD (was previously USD via token-based formula)

## API Configuration
- Image generation: Seedream 5.0 model (endpoint: ep-20251223142939-njrkd)
- Video generation: SeedDance 2.0 — ALL modes use ep-20260428161232-4znch (ARK_VIDEO_MODEL env var)
  - API format: top-level `duration`, `ratio`, `watermark: false` (no text flags)
  - Standard mode (文字/圖片生影片, 故事動畫): single image + text prompt
  - Omni mode (漫劇工作室): multi-image reference (charA + charB + scene ref)
  - `generate_audio: true` only in omni mode
- Environment secrets: ARK_API_KEY, ARK_TEXT_TO_IMAGE_API_KEY

## System Architecture

### Database (PostgreSQL + Drizzle ORM)
- **users**: id, username, email, password (bcrypt hashed), credits, createdAt
- **creditTransactions**: id, userId, type (topup/consume/refund), amount, balance, description, createdAt
- **imageGenerations**: id, userId, type, prompt, status, resultUrl, cost, etc.
- **videoGenerations**: id, userId, prompt, duration, status, resultUrl, cost, etc.
- **verificationCodes**: id, email, code, expiresAt, used, createdAt
- **chatMessages**: id, userId, message, isAdmin, isRead, createdAt

### Authentication
- Express session-based auth (express-session + connect-pg-simple)
- Password hashing with bcryptjs
- Email verification via Gmail SMTP (6-digit code, 10min expiry, 60s cooldown)
- Google OAuth 2.0 login/registration (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
  - GET /api/auth/google - redirect to Google OAuth
  - GET /api/auth/google/callback - handle OAuth callback, auto-create user if needed
  - CSRF protection via state parameter
  - Auto-links Google account if email already exists
  - New Google users get 10 welcome credits
- POST /api/auth/send-verification - send verification code to email
- GET /api/auth/me - check login state
- POST /api/auth/register - register with verification code (sends 10 welcome credits)
- POST /api/auth/login - login
- POST /api/auth/logout - logout
- requireAuth middleware protects all API routes
- Admin users auto-promoted via ADMIN_EMAILS env var (comma-separated emails)

### Credit System
- Credits checked before generation (frontend + backend validation)
- Credits deducted on generation start
- POST /api/credits/topup - manual top-up
- GET /api/credits/transactions - transaction history
- GET /api/credits/balance - balance query

### Frontend (React + TypeScript + Vite)
- **App.tsx**: Auth flow with useUser() hook, AuthPage (login/register), Router
- **home.tsx**: Main generation page with credit display, cost indicators on buttons
- **account.tsx**: User profile, credit top-up, pricing info (exports NavigationHeader)
- **transactions.tsx**: Transaction history with type badges
- **admin.tsx**: Admin dashboard - user management, credit adjustment, stats overview, generation logs, customer chat
- **drama.tsx**: Drama Studio page (漫劇工作室)
- **Routing**: wouter (/, /account, /transactions, /admin, /drama)
- **State**: TanStack Query v5 for server state
- **UI**: shadcn/ui + Tailwind CSS

### File Storage
- User uploads: Replit Object Storage (temporary)
- Generated content: Bunny.net CDN (persistent, per-user folders)
  - Images: `users/{userId}/images/{generationId}.jpg`
  - Videos: `users/{userId}/videos/{generationId}.mp4`
  - Environment secrets: BUNNY_STORAGE_ZONE, BUNNY_ACCESS_KEY, BUNNY_CDN_HOST
  - API endpoints auto-prefer Bunny CDN URLs over temporary API URLs
- server/bunnyStorage.ts - BunnyStorageService for upload/CDN URL management

## Key Files
- shared/schema.ts - Database schema, Zod validation schemas, types
- server/storage.ts - IStorage interface and DatabaseStorage implementation
- server/routes.ts - All API routes
- server/index.ts - Express server setup with session config
- server/seedDanceV2.ts - SeedDance 2.0 multi-image video client
- client/src/App.tsx - Auth flow, useUser hook, routing
- client/src/pages/home.tsx - Main generation interface
- client/src/pages/drama.tsx - Drama Studio (漫劇工作室)
- client/src/pages/account.tsx - Account management, NavigationHeader component
- client/src/pages/transactions.tsx - Transaction history
- client/src/pages/admin.tsx - Admin dashboard

### Admin System
- isAdmin field on users table, auto-set via ADMIN_EMAILS env var on registration
- requireAdmin middleware guards all /api/admin/* routes
- GET /api/admin/users - list all users with stats
- GET /api/admin/users/:userId - user detail with transactions & generation history
- POST /api/admin/users/:userId/credits - adjust user credits (add/deduct)
- GET /api/admin/stats - platform-wide statistics
- GET /api/admin/generations - all generation records across all users
- GET /api/admin/chats - chat conversations overview
- GET /api/admin/chats/:userId - chat messages for specific user
- POST /api/admin/chats/:userId/reply - admin reply to user chat
- Admin link visible only to admin users in NavigationHeader

### Live Chat System
- Users can send messages via ChatWidget (floating chat bubble)
- FAQ auto-reply still works for common questions
- Messages stored in DB, admin can view/reply in admin dashboard "客服對話" tab
- Polling-based real-time updates (5s for chat list, 3s for active conversation)
- Unread badge on both user side and admin side
- Contact: Telegram @amyhong0401
- API: POST /api/chat/send, GET /api/chat/messages, GET /api/chat/unread, POST /api/chat/mark-read

### Telegram Bot
- server/telegramBot.ts - Full Telegram Bot integration using long-polling
- Commands: /start, /bind, /verify, /balance, /generate, /video, /history, /help
- Account binding via email verification (6-digit code, 10min expiry)
- Text-to-image generation with Bunny CDN upload, sends image back in chat
- Text-to-video generation (5sec 720P default), sends video back in chat
- Image editing: send photo + caption to edit
- Credit deduction with auto-refund on failure
- Users table has telegramChatId field for account linking
- Environment secret: TELEGRAM_BOT_TOKEN

### Drama Studio 漫劇工作室
- **Route**: /drama (separate page from home.tsx)
- **UI**: ComicFlow-inspired dark theme visual node editor
  - Scene nodes displayed as connected cards with SVG bezier arrows (visual flow)
  - Right inspector panel for scene editing (title, description, dialogue, camera, character toggles)
  - Two view modes: ⬡ 節點流 (node flow) and ⊞ 格網 (grid)
  - Status bar: node count, credits remaining, generation status
  - Fixed bugs: removed invalid `border-3` Tailwind class, fixed SelectItem empty value
- **DB Tables**:
  - `dramaProjects`: id, userId, title, genre, characterAName, characterAUrls (text[]), characterBName, characterBUrls (text[]), styleImageUrls (text[]), sceneSize, episodeCount, status, createdAt, updatedAt
  - `dramaEpisodes`: id, projectId, userId, episodeNumber, title, scenes (JSON string), globalSeed, status, creditsUsed, errorMessage, createdAt, updatedAt
- **DramaScene type**: { id, sceneNumber, title, description, dialogue, cameraMovement, useCharA, useCharB, sceneRefImageUrl, imageUrl, bunnyUrl, imageStatus, videoUrl, videoBunnyUrl, videoStatus, videoDuration, videoResolution }
- **API Routes**: Full CRUD for projects + episodes, batch generate images, regenerate single scene, replace scene image, animate scene
- **Backend files**: server/seedDanceV2.ts (SeedDance 2.0 client), processDramaEpisode() + regenerateDramaScene() + animateDramaScene() in routes.ts
- **SeedDance 2.0 全能模式**: endpoint ep-20260428161232-4znch (ARK_VIDEO_OMNI_MODEL)
  - API format: top-level `ratio`, `duration`, `watermark: false`, `generate_audio` fields
  - Supports reference_image, reference_video, reference_audio content types
  - Omni mode auto-loads characterAUrls[0] + characterBUrls[0] + scene.sceneRefImageUrl as reference images
- **Pricing**: 3 credits/scene image; video same as standard (720P 8/sec, 1080P 15/sec)
- **Frontend**: Visual node editor — project list, episode list, episode editor with ComicFlow dark theme
  - Episode editor: SVG node flow canvas + right inspector panel + dual view (node flow / grid)
- **Navigation**: "🎬 漫劇工作室" link in home.tsx 3rd tab + NavigationHeader

### Story Mode (故事模式) — Legacy
- Still accessible via existing storyGenerations API (/api/story-generations)
- UI removed from home.tsx tabs (replaced by drama studio link)

## Recent Changes
- Configured SeedDance 2.0 全能模式: endpoint ep-20260428161232-4znch set as ARK_VIDEO_OMNI_MODEL; updated seedDanceV2.ts to use new API format (top-level ratio/duration/watermark); added character reference image support in animateDramaScene
- Added Drama Studio 漫劇工作室: new /drama page replacing故事模式 tab; dramaProjects + dramaEpisodes DB tables; SeedDance 2.0 multi-image client (seedDanceV2.ts); full CRUD API; 3-step episode editor workflow
- Fixed session store: switched from MemoryStore to PostgreSQL-backed sessions (connect-pg-simple, createTableIfMissing: true), preventing session loss on restart
- Fixed session cookie: added httpOnly, sameSite: "lax", secure: production-only settings
- Fixed security: added requireAuth middleware to GET /api/image-generations/:id, /api/batch-generations/:batchId, /api/video-generations/:id
- Fixed Bunny CDN upload reliability: added 2-attempt retry with 3s delay for both single and sequential image uploads
- Fixed video input image aspect ratio: auto-crop images outside 0.40-2.50 range using sharp before sending to API
- Added Telegram Bot integration: text-to-image, text-to-video, image editing, account binding with email verification
- Fixed admin dashboard cost calculation: dynamic recalculation using correct API pricing formulas
- Fixed chat system: changed req.user!.id to req.session.userId! for all chat endpoints
- Integrated Bunny.net CDN storage: all generated images/videos auto-uploaded to per-user folders, API returns CDN URLs
- Added email verification for registration using Resend (6-digit code, 10min expiry, prevents duplicate email registration)
- Updated SeedDance 2.0 pricing: 720P 8 積分/秒 (cost 5.5 TWD/sec), 1080P 15 積分/秒 (cost 11 TWD/sec); applies to all video features including Drama Studio; cost field switched from token-based USD to per-second TWD
- Changed video pricing to proportional per-second model: 6.8 credits/sec (API cost × 5), duration slider 2-12 seconds
- Added text-to-video generation (no image required)
- Added admin dashboard with user management, credit adjustment, transaction/generation history
- Added member registration/login system with bcrypt password hashing
- Implemented credit system with pricing: 3/image, 8~15/sec video
- Added credit top-up functionality with preset amounts
- Created transaction history page
- Updated home page with NavigationHeader, credit balance display, cost indicators
- Added insufficient credits blocking with warning messages
- Migrated Drama Studio to light theme: replaced all dark backgrounds (#0a0a14/#0d0d1a/#111122) with white/slate-50 panels, dark slate text on light bg, lighter borders/grids, lighter modal overlay; SVG scene cards now white with soft slate shadow
- Redesigned Drama Studio to ComicFlow visual node editor: SVG scene node flow, right inspector panel, dual view modes (node flow / grid), status bar; fixed border-3 and SelectItem empty value bugs
- Added 3 script-authoring helpers to Drama Studio (informed by SeedDance 2.0 + 短劇 + 提示詞 reference docs):
  1. **AI 智慧腳本助手** (POST /api/drama/ai-generate-script via Claude haiku-4-5): one-line pitch → full episode script with title/description/dialogue/camera/character toggles. Robust JSON parsing (multi-strategy + whitelist validation). Smart merge preserves existing scene IDs and generated images/videos; warns user before discarding trailing scenes with media.
  2. **提示詞素材庫** (PromptSnippetsPanel): 5 collapsible categories (光線/鏡頭/情緒/場景/風格) with 40 click-to-insert snippets, embedded inside scene inspector below description textarea.
  3. **腳本範本庫** (DRAMA_TEMPLATES): 5 preset short-drama templates (霸總愛情/校園青春/復仇懸疑/穿越奇幻/職場逆襲) selectable in 新增集數 modal, instantly creates 6-scene episode with full descriptions ready to generate.

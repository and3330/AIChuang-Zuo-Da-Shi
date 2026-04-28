# AI 創意工坊 - AI Image & Video Generation Platform

## Overview

A full-stack commercial AI image and video generation platform using BytePlus ARK API. Supports image editing (image-to-image), text-to-image, image-to-video, sequential generation, multi-image input, batch generation, and narrative story storyboard generation. Features a member registration/login system, credit-based pricing (1 credit = 1 TWD), and transaction history tracking. Entirely in Chinese (Traditional).

## User Preferences

Preferred communication style: Simple, everyday language (Chinese preferred).

## Pricing Model
- Image generation: 3 credits per image
- Video generation: Resolution-based pricing (4-12 seconds)
  - 720P: 3.4 credits/second (standard quality)
  - 1080P: 6.8 credits/second (high quality)
  - Example: 5 sec 720P = 17 credits, 5 sec 1080P = 34 credits
- New user registration bonus: 10 credits
- 1 credit = 1 TWD (New Taiwan Dollar)

## API Configuration
- Image generation: Seedream 5.0 model (endpoint: ep-20251223142939-njrkd)
- Video generation: SeedDance 2.0 model (endpoint: ep-20250813120833-g4mpb)
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
- **Routing**: wouter (/, /account, /transactions, /admin)
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
- client/src/App.tsx - Auth flow, useUser hook, routing
- client/src/pages/home.tsx - Main generation interface
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

### Drama Studio 漫劇工作室 (NEW - replaces Story Mode)
- **Route**: /drama (separate page from home.tsx)
- **DB Tables**:
  - `dramaProjects`: id, userId, title, genre, characterAName/Url, characterBName/Url, styleImageUrls (text[]), sceneSize, episodeCount, status, createdAt, updatedAt
  - `dramaEpisodes`: id, projectId, userId, episodeNumber, title, scenes (JSON string), globalSeed, status, creditsUsed, errorMessage, createdAt, updatedAt
- **DramaScene type**: { id, sceneNumber, title, description, dialogue, cameraMovement, useCharA, useCharB, sceneRefImageUrl, imageUrl, bunnyUrl, imageStatus, videoUrl, videoBunnyUrl, videoStatus, videoDuration, videoResolution }
- **API Routes**: Full CRUD for projects + episodes, batch generate images, regenerate single scene, replace scene image, animate scene
- **Backend files**: server/seedDanceV2.ts (SeedDance 2.0 multi-image client), processDramaEpisode() + regenerateDramaScene() + animateDramaScene() in routes.ts
- **Pricing**: 3 credits/scene image; video same as standard (720P 3.4/sec, 1080P 6.8/sec)
- **Frontend**: client/src/pages/drama.tsx — 3-panel: project list sidebar, episode list, episode editor (3-step: ①設定 ②分鏡 ③生成)
- **Navigation**: "🎬 漫劇工作室" link in home.tsx 3rd tab + NavigationHeader

### Story Mode (故事模式) — Legacy
- Still accessible via existing storyGenerations API (/api/story-generations)
- UI removed from home.tsx tabs (replaced by drama studio link)

## Recent Changes
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
- Removed video multi-image reference (API doesn't support yet, will re-add when SeedDance 2.0 API fully launches)
- Fixed image-to-image sequential generation display bug: now shows all generated images in grid (was only showing 1)
- Added email verification for registration using Resend (6-digit code, 10min expiry, prevents duplicate email registration)
- Changed video pricing to proportional per-second model: 6.8 credits/sec (API cost × 5), duration slider 2-12 seconds
- Added text-to-video generation (no image required)
- Added admin dashboard with user management, credit adjustment, transaction/generation history
- Added member registration/login system with bcrypt password hashing
- Implemented credit system with pricing: 3/image, 6.8/sec video
- Added credit top-up functionality with preset amounts
- Created transaction history page
- Updated home page with NavigationHeader, credit balance display, cost indicators
- Added insufficient credits blocking with warning messages

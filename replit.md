# AI 創意工坊 - AI Image & Video Generation Platform

## Overview

A full-stack commercial AI image and video generation platform using BytePlus ARK API. Supports image editing (image-to-image), text-to-image, image-to-video, sequential generation, multi-image input, and batch generation. Features a member registration/login system, credit-based pricing (1 credit = 1 TWD), and transaction history tracking. Entirely in Chinese (Traditional).

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

### Authentication
- Express session-based auth (express-session + connect-pg-simple)
- Password hashing with bcryptjs
- Email verification via Resend (6-digit code, 10min expiry, 60s cooldown)
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
- **admin.tsx**: Admin dashboard - user management, credit adjustment, stats overview
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
- Admin link visible only to admin users in NavigationHeader

## Recent Changes
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

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
- **Generation Logic**: Integrates with BytePlus ARK API for AI image and video generation. Specific models used include Seedream 5.0 for images and SeedDance 2.0 for videos, including an Omni mode for multi-image video generation in the Drama Studio. NSFW prompt enhancement is applied automatically to outbound API calls.
- **Admin System**: A comprehensive admin dashboard allows for user management, credit adjustments, platform statistics viewing, and monitoring of generation records and customer chats.
- **Live Chat System**: Users can communicate with administrators via a floating chat widget. Messages are stored in the database, and administrators can view and reply from their dashboard.
- **Drama Studio (漫劇工作室)**: This module provides a visual node editor for creating episodic narrative videos. It includes project and episode management, batch generation, and AI-powered script assistance (AI 智慧腳本助手 via Claude Haiku), prompt snippet libraries, and script templates. End-to-end automation now covers: (a) one-click batch animation of every scene in an episode (5s 720P with AI sound effects on by default), (b) server-side ffmpeg compilation that stitches all scene videos into a single vertical 1080×1920 mp4 with dialogue burned in as subtitles using a downloaded Noto Sans CJK TC font, and (c) the final compiled mp4 is uploaded to Bunny CDN and exposed via an in-page player with a download link.
  - **Global Asset Libraries (全域素材庫)**: A dedicated `/character-library` page lets users build cross-project, cross-episode reusable characters with reference photos and one-click 4-view generation (front / 3-quarter / side / back, 12 credits) via Seedream 5.0 — uploaded to Bunny CDN. A parallel scene library shares the same CRUD pattern. Both are scoped per user.
  - **First/Last Keyframe Mode (首尾關鍵幀)**: Each scene can pre-generate a first frame and a last frame (6 credits total) which SeedDance 2.0 then uses as `role:"first_frame"` / `role:"last_frame"` content parts to interpolate a smoother animation. Toggleable per scene in the inspector and per generation in the animate dialog (auto-disabled if frames are missing).
  - **AI Video Prompt Rewriter**: A per-scene endpoint asks Claude Haiku to rewrite the description + dialogue + cameraMovement into a professional cinematography prompt (景別/運鏡/光線/氛圍) stored in `scene.videoPrompt`. When present, it is preferred over `description` for SeedDance video generation.
  - **Script Import (劇本上傳)**: Project view exposes a "📄 上傳劇本" modal that accepts TXT or DOCX (parsed with `mammoth`). Claude Haiku then splits the story into N episodes × M scenes, extracts main characters (auto-saved to the global character library), and creates the episodes in one shot.
  - **ZIP Bundle Download**: A streaming endpoint (`/api/drama/episodes/:id/download-zip`) packages every scene image, first/last frame, scene video, the compiled mp4, and a `manifest.json` of script metadata using `archiver`, exposed via a "📦 下載素材 ZIP" button in the episode editor.
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
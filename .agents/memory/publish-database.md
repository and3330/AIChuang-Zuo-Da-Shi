---
name: Publish database ownership
description: Why production schema changes must be left to Replit Publish.
---

Run `npm run db:push` only in development, never against production or in the publishing build or application startup. Let Replit Publish apply production changes.

**Why:** A failed publish compiled successfully but then failed in managed migrations after a build-time forced schema push. The tables the migration intended to create already existed in production and the subsequent schema diff was empty. This strongly indicated competing schema-update mechanisms; no underlying PostgreSQL error was exposed.

The user explicitly reiterated this separation: 正式站的資料表不要用 npm run db:push；db:push 只在開發環境跑。

**How to apply:** Preserve this separation when editing publishing settings or addressing missing production tables. Inspect the publish-time diff rather than adding custom production DDL.

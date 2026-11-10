---
name: Publish database ownership
description: Why production schema changes must be left to Replit Publish.
---

Do not run database schema pushes in the publishing build or application startup. Keep development schema updates separate; let Replit Publish apply production changes.

**Why:** A failed publish compiled successfully but then failed in managed migrations after a build-time forced schema push. The tables the migration intended to create already existed in production and the subsequent schema diff was empty. This strongly indicated competing schema-update mechanisms; no underlying PostgreSQL error was exposed.

**How to apply:** Preserve this separation when editing publishing settings or addressing missing production tables. Inspect the publish-time diff rather than adding custom production DDL.

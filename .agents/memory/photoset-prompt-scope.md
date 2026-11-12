---
name: Photo-set prompt scope
description: Approved scope for combining library assets with user-authored photo directions.
---

Photo-set planning should combine the selected portrait, outfit and pose with scene, shooting controls and an additional user-written Prompt.

**Why:** The user wants a coherent photo shoot rather than independent asset selection and disconnected detail settings.

**How to apply:** Preserve an accessible supplemental input across the photo-set flows, and do not silently discard its text when composing other settings.

The approved scope is non-explicit prompt integration and planning-format fixes, not removal of safety protections in the gold zone.

**Why:** After clarification, the user explicitly chose “修正 Prompt 整合與格式錯誤” under this limited scope.

**How to apply:** Keep provider refusals distinct from malformed or truncated output. Never fabricate a replacement plan or retry with weaker safeguards to overcome a refusal.

Classify content refusal from the provider's explicit refusal signal, not isolated apology or inability words in prose.

**Why:** The user reported a rejection after adding the ordinary direction “更多的背景是海灘，然後陽光灑下來” and approved fixing possible text-classification false positives. The original response was unavailable, so its exact cause remains unconfirmed.

**How to apply:** Unstructured replies still fail closed without a generated plan; preserve explicit refusals and record only diagnostic metadata, not reference images or prompt text.

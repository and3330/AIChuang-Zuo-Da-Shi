---
name: Atlas Seed compatibility
description: Provider migration intent and non-obvious model/protocol limitations.
---

Do not infer vision support from the Seed model name or general marketing. Atlas's live model catalog listed Seed 2.0/2.1 Pro as text-only, while Seed Character advertised image input. A synthetic-image recognition and structured two-shot planning test succeeded for Seed Character on Chat Completions.

**Why:** The same Seed Character image/tool request returned HTTP 400 on the advertised Anthropic Messages compatibility endpoint. Generic protocol support does not guarantee per-model support.

**How to apply:** Check live modalities and test the exact protocol with a non-private image before changing models. Preserve base64 images, tool schemas, refusal signals and output truncation when translating message formats.

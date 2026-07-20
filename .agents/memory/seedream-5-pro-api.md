---
name: Seedream 5.0 Pro API quirks
description: BytePlus Seedream 5.0 Pro image endpoint differences vs older Seedream models
---

- Rejects `sequential_image_generation` with 400 InvalidParameter — even the value `"disabled"`. Do not send the param at all; multi-image is done by fanning out N parallel single-image calls.
- **Why:** the Pro model dropped the sequential/streaming API entirely; after the endpoint swap the platform's 組圖 mode broke with this exact 400.
- **How to apply:** any new BytePlus image call site must omit sequential/stream params; if pre-charging credits for N images, refund per-image cost for failed attempts on partial success (`storage.atomicAddCredits`).
- Generation is slow: ~135 s per 2K image (synchronous). Node fetch default header timeout (300 s) is fine, but never add a short AbortController timeout to these calls.
- Accepts `size: "2K"` (uppercase); older endpoint accepted lowercase `'2k'/'3k'/'4k'` and rejected `"1K"`.

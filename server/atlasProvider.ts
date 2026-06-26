/**
 * AtlasCloud image provider.
 *
 * Wraps the async image API documented at
 *   https://console.atlascloud.ai  (black-forest-labs/flux-dev-lora)
 *
 * Auth header:   Authorization: Bearer ATLASCLOUD_API_KEY
 * Submit job:    POST  {BASE}/api/v1/model/generateImage
 *                body { model, prompt, size, guidance_scale, seed, num_images,
 *                       image?, strength?, mask_image?, loras[] }
 *                returns { data: { id } }
 * Observe job:   GET   {BASE}/api/v1/model/prediction/{id}
 *                returns { data: { status, outputs?[], output?[], error } }
 *                status reaches "completed" / "succeeded" on done,
 *                "failed" on failure, otherwise "queued" / "processing".
 *
 * The model is FLUX.1 [dev] with LoRA support. It is NSFW-friendly: the
 * response carries a `has_nsfw_contents` flag for detection but does NOT
 * block generation. It supports text-to-image and image-to-image (via the
 * `image` + `strength` params) plus inpainting (`mask_image`).
 */

const ATLAS_BASE = "https://api.atlascloud.ai";

function authHeader(): Record<string, string> {
  const key = process.env.ATLASCLOUD_API_KEY;
  if (!key) throw new Error("ATLASCLOUD_API_KEY 未設定，無法呼叫 AtlasCloud。");
  return { Authorization: `Bearer ${key}` };
}

/* ---------- size helpers ---------- */

function sizeToWH(size: string | undefined): { width: number; height: number } {
  if (!size) return { width: 1024, height: 1024 };
  if (size === "2K") return { width: 2048, height: 2048 };
  if (size === "4K") return { width: 4096, height: 4096 };
  const m = size.match(/^(\d+)x(\d+)$/);
  if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  return { width: 1024, height: 1024 };
}

function sizeToAspect(size: string | undefined): "1:1" | "16:9" | "9:16" | "4:3" | "3:4" {
  const { width, height } = sizeToWH(size);
  const r = width / height;
  if (Math.abs(r - 16 / 9) < 0.15) return "16:9";
  if (Math.abs(r - 9 / 16) < 0.15) return "9:16";
  if (Math.abs(r - 4 / 3) < 0.1) return "4:3";
  if (Math.abs(r - 3 / 4) < 0.1) return "3:4";
  return "1:1";
}

/** Map an app-level size to a FLUX-friendly "W*H" (asterisk) string. FLUX.1
 *  [dev] is trained around ~1MP, so we keep each dimension near that budget
 *  instead of honouring 2K/4K literally (which slows generation and can OOM). */
function sizeToAtlasWH(size: string | undefined): string {
  const aspect = sizeToAspect(size);
  switch (aspect) {
    case "16:9": return "1344*768";
    case "9:16": return "768*1344";
    case "4:3":  return "1152*896";
    case "3:4":  return "896*1152";
    default:     return "1024*1024";
  }
}

/* ---------- model registry (NSFW-friendly) ---------- */

export type AtlasImageBuildArgs = {
  prompt: string;
  size?: string;            // app-level size like "2K", "1920x1920"
  seed?: number;
  guidanceScale?: number;
  /** Public HTTPS URL or base64 data URI of the reference image (i2i). */
  image?: string;
  /** i2i transform strength (0 keeps original .. 1 fully reimagines). */
  strength?: number;
};

export type AtlasImageModelConfig = {
  /** AtlasCloud model id, e.g. "black-forest-labs/flux-dev-lora" */
  id: string;
  /** Friendly Chinese label shown in the UI */
  label: string;
  /** Short description, used as the dropdown subtitle */
  description: string;
  /** Whole-number credits charged per generated image */
  creditsPerImage: number;
  /** Whether this model accepts a reference image (image-to-image). */
  supportsI2I: boolean;
  buildPayload: (args: AtlasImageBuildArgs) => Record<string, any>;
};

export const ATLAS_IMAGE_MODELS: Record<string, AtlasImageModelConfig> = {
  "black-forest-labs/flux-dev-lora": {
    id: "black-forest-labs/flux-dev-lora",
    label: "FLUX.1 dev + LoRA (Black Forest · 寫實 LoRA)",
    description: "FLUX.1 [dev] 開源高畫質，內建超寫實 LoRA，支援文字生圖與圖片編輯，NSFW 友善",
    creditsPerImage: 5,
    supportsI2I: true,
    buildPayload: ({ prompt, size, seed, guidanceScale, image, strength }) => {
      const payload: Record<string, any> = {
        model: "black-forest-labs/flux-dev-lora",
        prompt,
        size: sizeToAtlasWH(size),
        num_images: 1,
        // Bake in the Super-Realism LoRA the model ships with — it is what
        // gives flux-dev-lora its photoreal look.
        loras: [{ path: "strangerzonehf/Flux-Super-Realism-LoRA", scale: 1 }],
      };
      payload.guidance_scale = typeof guidanceScale === "number" ? guidanceScale : 3.5;
      payload.seed = typeof seed === "number" ? seed : -1;
      // Image-to-image: only send `image`/`strength` when a reference was
      // supplied, otherwise the API treats it as text-to-image.
      if (image) {
        payload.image = image;
        payload.strength = typeof strength === "number" ? strength : 0.8;
      }
      return payload;
    },
  },
};

/** Lightweight list for the frontend dropdown. */
export const ATLAS_IMAGE_MODEL_LIST = Object.values(ATLAS_IMAGE_MODELS).map((c) => ({
  id: c.id,
  label: c.label,
  description: c.description,
  creditsPerImage: c.creditsPerImage,
  supportsI2I: c.supportsI2I,
}));

/* ---------- HTTP helpers ---------- */

export async function atlasSubmitJob(payload: Record<string, any>): Promise<string> {
  const resp = await fetch(`${ATLAS_BASE}/api/v1/model/generateImage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`AtlasCloud 任務建立失敗 (${resp.status}): ${text.slice(0, 400)}`);
  }
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error(`AtlasCloud 任務回傳不是合法 JSON: ${text.slice(0, 200)}`);
  }
  const id = j?.data?.id || j?.id;
  if (!id) {
    throw new Error(`AtlasCloud 任務回傳缺少 prediction id: ${text.slice(0, 200)}`);
  }
  return id;
}

const TERMINAL_OK = new Set(["completed", "succeeded", "success", "finished"]);
const TERMINAL_FAIL = new Set(["failed", "error", "cancelled", "canceled"]);

export async function atlasPollUntilDone(
  predictionId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<any> {
  const timeoutMs = opts.timeoutMs ?? 6 * 60 * 1000; // 6min default for images
  const intervalMs = opts.intervalMs ?? 2000;
  const started = Date.now();
  let lastStatus = "(no response yet)";
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let resp: Response;
    try {
      resp = await fetch(`${ATLAS_BASE}/api/v1/model/prediction/${predictionId}`, {
        headers: authHeader(),
      });
    } catch (e: any) {
      console.warn(`AtlasCloud poll network error: ${e?.message}`);
      continue;
    }
    if (!resp.ok) {
      console.warn(`AtlasCloud poll HTTP ${resp.status} for ${predictionId}`);
      continue;
    }
    let j: any;
    try {
      j = await resp.json();
    } catch {
      continue;
    }
    const data = j?.data ?? j;
    const status = data?.status;
    lastStatus = status || lastStatus;
    if (status && TERMINAL_OK.has(status)) return data;
    if (status && TERMINAL_FAIL.has(status)) {
      const detail = data?.error || data?.message || "(no detail)";
      throw new Error(`AtlasCloud 任務失敗：${detail}`);
    }
  }
  throw new Error(`AtlasCloud 任務輪詢逾時 (last status: ${lastStatus})`);
}

/* ---------- image URL extraction ---------- */

/**
 * Pull a single image URL out of an AtlasCloud prediction `data` dict. The
 * docs are inconsistent — the code example reads `outputs[0]` while the output
 * schema lists `output[]`. We try both, plus a few generic shapes.
 */
function extractFirstImageUrl(data: any): string | undefined {
  if (!data) return undefined;
  if (typeof data === "string" && /^https?:\/\//.test(data)) return data;
  if (typeof data !== "object") return undefined;

  for (const key of ["outputs", "output", "images", "result", "results"]) {
    const arr = data[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      if (typeof first === "string" && /^https?:\/\//.test(first)) return first;
      if (first && typeof first === "object") {
        const nested = first.url || first.image_url || first.image;
        if (typeof nested === "string" && /^https?:\/\//.test(nested)) return nested;
      }
    }
    if (typeof arr === "string" && /^https?:\/\//.test(arr)) return arr;
  }

  if (typeof data.url === "string" && /^https?:\/\//.test(data.url)) return data.url;
  if (typeof data.image_url === "string") return data.image_url;
  return undefined;
}

/* ---------- end-to-end helper ---------- */

/** Submit, poll, return final image URL. Caller downloads + re-hosts on Bunny. */
export async function atlasGenerateImage(args: {
  modelId: string;
  prompt: string;
  size?: string;
  seed?: number;
  guidanceScale?: number;
  image?: string;
  strength?: number;
}): Promise<{ imageUrl: string; creditsPerImage: number; modelId: string }> {
  const cfg = ATLAS_IMAGE_MODELS[args.modelId];
  if (!cfg) throw new Error(`未支援的 AtlasCloud 模型：${args.modelId}`);
  const payload = cfg.buildPayload(args);
  const predictionId = await atlasSubmitJob(payload);
  console.log(`[Atlas] submitted ${cfg.id} prediction ${predictionId}, payload keys:`, Object.keys(payload));
  const done = await atlasPollUntilDone(predictionId);
  const url = extractFirstImageUrl(done);
  if (!url) {
    throw new Error(`AtlasCloud 完成但無法擷取圖片 URL：${JSON.stringify(done).slice(0, 400)}`);
  }
  return { imageUrl: url, creditsPerImage: cfg.creditsPerImage, modelId: cfg.id };
}

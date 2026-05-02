/**
 * Verifies the SeedDance 2.0 全能模式 (omni) wiring without spending API credits.
 *
 * Two layers of verification:
 *
 * 1. Route-level helper test — exercises buildDramaOmniReferenceImages() with
 *    a fake DramaProject + DramaScene and a stub loader, asserting that the
 *    character A / character B / scene-ref URLs are routed in the correct
 *    order. This is the "animateDramaScene 路由正確帶入角色 A/B 圖片" check.
 *
 * 2. Client-level fetch test — mocks global fetch, calls generateSeedDanceVideo()
 *    for three scenarios (omni, standard, first/last-frame) and asserts the
 *    outbound HTTP request hits the omni endpoint with correctly-rolled
 *    reference_image / first_frame / last_frame items.
 *
 * Run with:  tsx scripts/verify-seeddance-omni.ts
 */

import {
  generateSeedDanceVideo,
  buildDramaOmniReferenceImages,
  SEEDDANCE_OMNI_ENDPOINT,
  SEEDDANCE_STANDARD_ENDPOINT,
  VIDEO_API_BASE,
  OMNI_ENDPOINT_FROM_ENV,
  requireOmniEndpoint,
} from "../server/seedDanceV2";

// ─── Test infrastructure ─────────────────────────────────────────────────────

interface CapturedRequest {
  url: string;
  method: string;
  body: SeedDanceRequestBody | null;
}

interface SeedDanceContentItem {
  type: "text" | "image_url" | "video_url" | "audio_url";
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
  role?: string;
}

interface SeedDanceRequestBody {
  model: string;
  content: SeedDanceContentItem[];
  ratio?: string;
  duration?: number;
  generate_audio?: boolean;
  watermark?: boolean;
}

type FetchFn = typeof globalThis.fetch;

function installFetchMock(captured: CapturedRequest[]): () => void {
  const original: FetchFn = globalThis.fetch;
  globalThis.fetch = (async (
    input: Parameters<FetchFn>[0],
    init?: Parameters<FetchFn>[1]
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    const method = init?.method ?? "GET";
    if (method === "POST") {
      const rawBody = init?.body;
      const body: SeedDanceRequestBody | null =
        typeof rawBody === "string"
          ? (JSON.parse(rawBody) as SeedDanceRequestBody)
          : null;
      captured.push({ url, method, body });
      return new Response(JSON.stringify({ id: "fake-task-id-123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        status: "succeeded",
        content: { video_url: "https://example.test/fake-video.mp4" },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as FetchFn;
  return () => {
    globalThis.fetch = original;
  };
}

let failures = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`❌ FAIL: ${msg}`);
    failures++;
    return;
  }
  console.log(`✅ ${msg}`);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function testEnvConfig(): Promise<void> {
  console.log("\n─── env config ───");
  console.log(`[verify] standard endpoint = ${SEEDDANCE_STANDARD_ENDPOINT}`);
  console.log(`[verify] omni endpoint     = ${SEEDDANCE_OMNI_ENDPOINT ?? "(unset)"}`);
  console.log(`[verify] OMNI_ENDPOINT_FROM_ENV = ${OMNI_ENDPOINT_FROM_ENV}`);

  assert(
    OMNI_ENDPOINT_FROM_ENV,
    "ARK_VIDEO_OMNI_MODEL env var is set (omni endpoint configured from env)"
  );
  assert(
    SEEDDANCE_OMNI_ENDPOINT !== undefined &&
      SEEDDANCE_OMNI_ENDPOINT === process.env.ARK_VIDEO_OMNI_MODEL,
    "SEEDDANCE_OMNI_ENDPOINT === process.env.ARK_VIDEO_OMNI_MODEL"
  );

  // requireOmniEndpoint() should resolve when env is set
  let resolved: string | null = null;
  try {
    resolved = requireOmniEndpoint();
  } catch (e) {
    /* ignore */
  }
  assert(
    resolved === process.env.ARK_VIDEO_OMNI_MODEL,
    "requireOmniEndpoint() returns the configured endpoint"
  );

  // Fail-fast guard: simulate missing env var by temporarily unsetting it and
  // re-importing the module fresh, then asserting requireOmniEndpoint throws.
  const saved = process.env.ARK_VIDEO_OMNI_MODEL;
  delete process.env.ARK_VIDEO_OMNI_MODEL;
  try {
    const fresh = await import(
      "../server/seedDanceV2.ts?fail-fast-test=" + Date.now()
    );
    let threw = false;
    try {
      fresh.requireOmniEndpoint();
    } catch (e) {
      threw =
        e instanceof Error && /ARK_VIDEO_OMNI_MODEL/.test(e.message);
    }
    assert(
      threw,
      "requireOmniEndpoint() throws clear error when ARK_VIDEO_OMNI_MODEL is unset (fail-fast)"
    );
  } finally {
    if (saved !== undefined) process.env.ARK_VIDEO_OMNI_MODEL = saved;
  }
}

async function testDramaReferenceBuilder(): Promise<void> {
  console.log("\n─── route-level: buildDramaOmniReferenceImages ───");

  // Stub loader records the order it was called in.
  const loadOrder: string[] = [];
  const stubLoader = async (url: string): Promise<string> => {
    loadOrder.push(url);
    return `data:image/jpeg;base64,${url}`;
  };

  // Case A: full project (charA + charB + scene ref)
  const refsFull = await buildDramaOmniReferenceImages({
    project: {
      characterAUrls: ["https://cdn.test/charA.jpg", "https://cdn.test/charA-alt.jpg"],
      characterBUrls: ["https://cdn.test/charB.jpg"],
    },
    scene: { sceneRefImageUrl: "https://cdn.test/scene.jpg" },
    loadImage: stubLoader,
  });
  assert(refsFull.length === 3, `[helper] full project produces 3 refs, got ${refsFull.length}`);
  assert(
    loadOrder[0] === "https://cdn.test/charA.jpg",
    "[helper] character A loaded first (only first url is used, alt is ignored)"
  );
  assert(
    loadOrder[1] === "https://cdn.test/charB.jpg",
    "[helper] character B loaded second"
  );
  assert(
    loadOrder[2] === "https://cdn.test/scene.jpg",
    "[helper] scene ref loaded third"
  );
  assert(
    refsFull.every((r) => r.url.startsWith("data:image/jpeg;base64,")),
    "[helper] every ref is a base64 data URL produced by the loader"
  );

  // Case B: missing characters → only scene ref returned
  loadOrder.length = 0;
  const refsSceneOnly = await buildDramaOmniReferenceImages({
    project: { characterAUrls: [], characterBUrls: null },
    scene: { sceneRefImageUrl: "https://cdn.test/lonely-scene.jpg" },
    loadImage: stubLoader,
  });
  assert(refsSceneOnly.length === 1, "[helper] empty/null character lists are skipped");
  assert(
    loadOrder[0] === "https://cdn.test/lonely-scene.jpg",
    "[helper] only scene ref is loaded when characters absent"
  );

  // Case C: loader failure for charA does NOT abort other refs
  loadOrder.length = 0;
  const flakyLoader = async (url: string): Promise<string> => {
    loadOrder.push(url);
    if (url.includes("charA")) throw new Error("simulated network failure");
    return `data:image/jpeg;base64,${url}`;
  };
  const refsFlaky = await buildDramaOmniReferenceImages({
    project: {
      characterAUrls: ["https://cdn.test/charA.jpg"],
      characterBUrls: ["https://cdn.test/charB.jpg"],
    },
    scene: { sceneRefImageUrl: "https://cdn.test/scene.jpg" },
    loadImage: flakyLoader,
  });
  assert(
    refsFlaky.length === 2,
    `[helper] failed charA load is skipped, charB + scene survive (got ${refsFlaky.length})`
  );
  assert(loadOrder.length === 3, "[helper] all 3 loads were attempted despite failure");
}

async function testClientWiring(): Promise<void> {
  console.log("\n─── client-level: generateSeedDanceVideo ───");
  process.env.ARK_API_KEY = process.env.ARK_API_KEY ?? "test-key";

  // Speed up poll loop
  const realSetTimeout = globalThis.setTimeout;
  const fastSetTimeout = ((fn: () => void): ReturnType<typeof setTimeout> =>
    realSetTimeout(fn, 0)) as unknown as typeof globalThis.setTimeout;
  globalThis.setTimeout = fastSetTimeout;

  try {
    // ─── Case 1: omni mode with character A + B + scene ref ─────────────────
    {
      const captured: CapturedRequest[] = [];
      const restore = installFetchMock(captured);
      try {
        await generateSeedDanceVideo({
          prompt: "Two characters meet on a rainy street",
          mainImage: { url: "data:image/jpeg;base64,MAIN" },
          referenceImages: [
            { url: "data:image/jpeg;base64,CHARA" },
            { url: "data:image/jpeg;base64,CHARB" },
            { url: "data:image/jpeg;base64,SCENE" },
          ],
          useOmniMode: true,
          duration: 5,
          aspectRatio: "9:16",
          generateAudio: true,
        });
      } finally {
        restore();
      }

      const create = captured.find((c) => c.url === VIDEO_API_BASE);
      assert(!!create && !!create.body, "[omni] POST sent to VIDEO_API_BASE");
      if (!create || !create.body) return;

      assert(
        create.body.model === SEEDDANCE_OMNI_ENDPOINT,
        `[omni] request.model === SEEDDANCE_OMNI_ENDPOINT (${SEEDDANCE_OMNI_ENDPOINT})`
      );

      const items = create.body.content;
      const text = items.find((i) => i.type === "text");
      assert(
        !!text && /Two characters/.test(text.text ?? ""),
        "[omni] text item present and contains prompt"
      );

      const refs = items.filter(
        (i) => i.type === "image_url" && i.role === "reference_image"
      );
      assert(refs.length === 4, `[omni] 4 reference_image items (main + A + B + scene), got ${refs.length}`);
      const refUrls = refs.map((r) => r.image_url?.url ?? "");
      assert(refUrls.includes("data:image/jpeg;base64,MAIN"), "[omni] main image included");
      assert(refUrls.includes("data:image/jpeg;base64,CHARA"), "[omni] character A image included");
      assert(refUrls.includes("data:image/jpeg;base64,CHARB"), "[omni] character B image included");
      assert(refUrls.includes("data:image/jpeg;base64,SCENE"), "[omni] scene ref image included");

      assert(create.body.ratio === "9:16", "[omni] ratio top-level field set");
      assert(create.body.duration === 5, "[omni] duration top-level field set");
      assert(create.body.generate_audio === true, "[omni] generate_audio top-level field set");
      assert(create.body.watermark === false, "[omni] watermark disabled");
    }

    // ─── Case 2: standard mode (no omni, no first/last frame) ────────────────
    {
      const captured: CapturedRequest[] = [];
      const restore = installFetchMock(captured);
      try {
        await generateSeedDanceVideo({
          prompt: "A simple cinematic push-in",
          mainImage: { url: "data:image/jpeg;base64,SOLO" },
          useOmniMode: false,
          duration: 4,
          aspectRatio: "16:9",
        });
      } finally {
        restore();
      }
      const create = captured.find((c) => c.url === VIDEO_API_BASE);
      assert(!!create && !!create.body, "[std] POST sent to VIDEO_API_BASE");
      if (!create || !create.body) return;

      assert(
        create.body.model === SEEDDANCE_STANDARD_ENDPOINT,
        `[std] request.model === SEEDDANCE_STANDARD_ENDPOINT (${SEEDDANCE_STANDARD_ENDPOINT})`
      );
      const imgItems = create.body.content.filter((i) => i.type === "image_url");
      assert(imgItems.length === 1, `[std] exactly 1 image item, got ${imgItems.length}`);
      assert(
        imgItems[0].role === undefined,
        "[std] no role label on standard image (single-image mode)"
      );
    }

    // ─── Case 3: first/last-frame mode forces omni endpoint ──────────────────
    {
      const captured: CapturedRequest[] = [];
      const restore = installFetchMock(captured);
      try {
        await generateSeedDanceVideo({
          prompt: "Interpolated motion between two keyframes",
          firstFrame: { url: "data:image/jpeg;base64,FIRST" },
          lastFrame: { url: "data:image/jpeg;base64,LAST" },
          referenceImages: [{ url: "data:image/jpeg;base64,CHARA" }],
          duration: 6,
          aspectRatio: "9:16",
        });
      } finally {
        restore();
      }
      const create = captured.find((c) => c.url === VIDEO_API_BASE);
      assert(!!create && !!create.body, "[firstlast] POST sent to VIDEO_API_BASE");
      if (!create || !create.body) return;

      assert(
        create.body.model === SEEDDANCE_OMNI_ENDPOINT,
        "[firstlast] uses omni endpoint when first+last frames provided"
      );
      const items = create.body.content;
      assert(
        items.some((i) => i.role === "first_frame"),
        "[firstlast] first_frame role present"
      );
      assert(
        items.some((i) => i.role === "last_frame"),
        "[firstlast] last_frame role present"
      );
      assert(
        items.some((i) => i.role === "reference_image"),
        "[firstlast] reference_image role still passed for character continuity"
      );
    }
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
}

async function run(): Promise<void> {
  await testEnvConfig();
  await testDramaReferenceBuilder();
  await testClientWiring();

  if (failures > 0) {
    console.error(`\n❌ ${failures} assertion(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log("\n🎉 All SeedDance omni-mode wiring assertions passed.\n");
  }
}

run().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import sharp from "sharp";
import { ATLAS_SEED_BASE_URL, ATLAS_SEED_MODEL, createAtlasSeedClient } from "../server/atlasSeed";
import { readPlannerMessage } from "../server/photoset";
import Anthropic from "@anthropic-ai/sdk";

const plan = {
  analysis: "海灘與陽光",
  shots: [
    { title: "海灘遠景", prompt: "成年人物穿襯衫長褲站在海灘，陽光灑落。" },
    { title: "海灘半身", prompt: "同一位成年人物，半身構圖與自然陽光。" },
  ],
};
const tools: Anthropic.Tool[] = [{
  name: "submit_photoset_plan",
  description: "Return a photo shoot plan. Do not use this tool if you cannot assist with the content.",
  input_schema: {
    type: "object",
    properties: {
      analysis: { type: "string" },
      shots: { type: "array", minItems: 2, maxItems: 2, items: {
        type: "object", properties: { title: { type: "string" }, prompt: { type: "string" } },
        required: ["title", "prompt"],
      } },
    },
    required: ["analysis", "shots"],
  },
}];

function fixture(content: unknown[], stop_reason = "end_turn") {
  const blocks = content as any[];
  return { id: "test-seed", model: ATLAS_SEED_MODEL, choices: [{
    finish_reason: stop_reason === "refusal" ? "content_filter" : stop_reason === "tool_use" ? "tool_calls" : "stop",
    message: {
      content: blocks.filter(b => b.type === "text").map(b => b.text).join("\n") || null,
      tool_calls: blocks.filter(b => b.type === "tool_use").map(b => ({
        type: "function", id: b.id, function: { name: b.name, arguments: JSON.stringify(b.input) },
      })),
    },
  }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
}

async function main() {
  let calls = 0;
  const mockFetch: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), `${ATLAS_SEED_BASE_URL}/v1/chat/completions`);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, ATLAS_SEED_MODEL);
    assert.match(body.messages[0].content[0].image_url.url, /^data:image\/png;base64,/);
    assert.equal(body.tools[0].function.name, "submit_photoset_plan");
    assert.equal(body.tool_choice, "auto");
    return Response.json(fixture([{ type: "tool_use", id: "tool-test", name: "submit_photoset_plan", input: plan }], "tool_use"));
  };
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: ATLAS_SEED_MODEL, max_tokens: 2000, tools, tool_choice: { type: "auto" },
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "test-only" } },
      { type: "text", text: "更多的背景是海灘，然後陽光灑下來" },
    ] }],
  };
  const result = await createAtlasSeedClient({ fetch: mockFetch }).messages.create(params);
  assert.equal(calls, 1);
  assert.equal(readPlannerMessage(result, 2).shots.length, 2);

  const refused = await createAtlasSeedClient({ fetch: async () =>
    Response.json(fixture([{ type: "text", text: "Unable to assist." }], "refusal"))
  }).messages.create(params);
  assert.throws(() => readPlannerMessage(refused, 2), (e: any) => e.status === 422);

  const text = await createAtlasSeedClient({ fetch: async () =>
    Response.json(fixture([{ type: "text", text: "A beach portrait in sunlight." }]))
  }).messages.create({ model: ATLAS_SEED_MODEL, max_tokens: 100, messages: [{ role: "user", content: "Suggest a portrait." }] });
  assert.equal(text.content[0].type, "text");

  let failures = 0;
  await assert.rejects(createAtlasSeedClient({ fetch: async () => {
    failures++;
    return Response.json({ type: "error", error: { type: "rate_limit_error", message: "Rate limited" } }, { status: 429 });
  } }).messages.create(params), (e: any) => e.status === 429);
  assert.equal(failures, 1, "Do not retry or silently switch providers");
  const truncated = await createAtlasSeedClient({ fetch: async () => Response.json({
    choices: [{ finish_reason: "length", message: { tool_calls: [{
      type: "function", id: "cut-off", function: { name: "submit_photoset_plan", arguments: "{\"shots\":[" },
    }] } }],
  }) }).messages.create(params);
  assert.throws(() => readPlannerMessage(truncated, 2), /截斷/);
  const refusalField = await createAtlasSeedClient({ fetch: async () => Response.json({
    choices: [{ finish_reason: "stop", message: { content: null, refusal: "Cannot assist." } }],
  }) }).messages.create(params);
  assert.throws(() => readPlannerMessage(refusalField, 2), (e: any) => e.status === 422);
  console.log("Atlas Seed routing, text, vision, tools, refusal and no-retry checks passed");

  if (process.argv.includes("--live")) {
    // A local geometric test image, never a user's photograph.
    const png = await sharp(Buffer.from('<svg width="128" height="128"><rect width="128" height="128" fill="blue"/><circle cx="64" cy="64" r="28" fill="yellow"/></svg>')).png().toBuffer();
    const response = await createAtlasSeedClient().messages.create({
      ...params,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
        { type: "text", text: "先在 analysis 描述圖中的背景顏色、形狀與形狀顏色（用繁體中文）。再規劃2個一般海灘旅遊人像鏡頭：30歲成年女性，白色長袖襯衫與長褲，自然站姿，更多的背景是海灘，然後陽光灑下來。使用 submit_photoset_plan 回傳；若無法協助，直接說明，不要產生替代內容。" },
      ] }],
    });
    const parsed = readPlannerMessage(response, 2);
    console.log(JSON.stringify({
      model: response.model, stopReason: response.stop_reason,
      types: response.content.map(b => b.type), shots: parsed.shots.length,
      syntheticImageAnalysis: parsed.analysis, usage: response.usage,
    }, null, 2));
    assert.match(parsed.analysis, /藍|blue/i);
    assert.match(parsed.analysis, /黃|yellow/i);
    assert.match(parsed.analysis, /圓|circle/i);
    console.log("Live Atlas Seed image recognition and two-shot planning passed");
  }
}
main().catch(error => {
  // Avoid dumping an SDK request with credentials, images or prompt content.
  console.error(error instanceof Error ? error.message : "Atlas Seed test failed");
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { parsePlan, planRequestSchema, readPlannerMessage, userExtras, PhotosetPlanError } from "../server/photoset";

const shots = [
  { title: "窗邊半身", prompt: '白色襯衫、柔和窗光，背景有標記「{studio}」與 "portrait"。' },
  { title: "自然特寫", prompt: "同一位成年角色，自然微笑，柔和側光。" },
];
const plan = { analysis: "同一場景、同一造型的寫真。", shots };
const json = JSON.stringify(plan);
const message = (text: string, stop_reason: Anthropic.Message["stop_reason"] = "end_turn") => ({
  content: [{ type: "text" as const, text, citations: null }], stop_reason,
});
for (const text of [json, `\`\`\`json\n${json}\n\`\`\``, `規劃如下：\n{"note":"先看說明"}\n${json}\n{"debug":false}`]) {
  assert.deepEqual(parsePlan(text, 2).shots, shots);
}
assert.deepEqual(parsePlan(plan, 2).shots, shots);
assert.throws(() => parsePlan(json.slice(0, -5), 2), /格式/);
assert.throws(() => parsePlan({ shots: [shots[0]] }, 2), /不完整/);
assert.throws(() => parsePlan({ shots: [shots[0], { prompt: " " }] }, 2), /不完整/);
assert.throws(() => parsePlan(null, 2), /不完整/);

const toolMessage: Pick<Anthropic.Message, "content" | "stop_reason"> = {
  stop_reason: "tool_use",
  content: [{ type: "tool_use", id: "test-tool", name: "submit_photoset_plan", input: plan }],
};
assert.deepEqual(readPlannerMessage(toolMessage, 2).shots, shots);
assert.deepEqual(readPlannerMessage(message(json), 2).shots, shots);
for (const m of [message("I cannot assist with that request."), message("抱歉，無法協助這次內容。"), message(json, "refusal")]) {
  assert.throws(() => readPlannerMessage(m, 2), e => e instanceof PhotosetPlanError && e.status === 422);
}
assert.throws(() => readPlannerMessage(message(json, "max_tokens"), 2), /截斷/);
assert.throws(() => readPlannerMessage(message("Not a JSON plan."), 2), e => e instanceof PhotosetPlanError && e.status === 502);

const input = {
  mode: "character", characterGoal: "shoot", count: 2,
  referenceImageUrls: ["/objects/portrait-reference"],
  characterDescription: "黑色短髮的成年人物",
  direction: "服裝：白色襯衫。姿勢：自然站姿。場景：咖啡店。鏡頭：生活抓拍。",
  customPrompt: "午後暖光、自然微笑，增加臉部特寫",
};
const parsed = planRequestSchema.parse(input);
const extras = userExtras(parsed);
for (const text of [input.characterDescription, input.direction, input.customPrompt]) assert.ok(extras.includes(text));
// Long shooting controls cannot silently consume the user's prompt allowance.
assert.equal(planRequestSchema.parse({ ...input, direction: "設".repeat(4000), customPrompt: "補".repeat(1000) }).customPrompt?.length, 1000);
assert.equal(planRequestSchema.safeParse({ ...input, customPrompt: "補".repeat(1001) }).success, false);
assert.equal(planRequestSchema.safeParse({ ...input, direction: "設".repeat(4001) }).success, false);
assert.equal(planRequestSchema.parse({ ...input, customPrompt: "  柔和側光  " }).customPrompt, "柔和側光");
console.log("Photo-set prompt integration and response-format checks passed (no AI or image-generation requests sent)");

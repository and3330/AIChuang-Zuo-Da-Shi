import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { parsePlan, planRequestSchema, readPlannerMessage, userExtras, PhotosetPlanError } from "../server/photoset";
import { mergePhotosetSupplement, composePhotosetImagePrompt } from "../shared/photosetPrompt";

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
for (const m of [message(json, "refusal"), message("I cannot assist with that request.", "refusal"), message("抱歉，無法協助這次內容。", "refusal"), { ...toolMessage, stop_reason: "refusal" as const }]) {
  assert.throws(() => readPlannerMessage(m, 2), e => e instanceof PhotosetPlanError && e.status === 422);
}
// Apologies and limitations alone must not be labelled as a safety refusal.
// Even an actual prose refusal without a provider flag cannot become a plan.
for (const text of [
  "抱歉，無法提供目前海灘的天氣資料。",
  "I cannot determine the exact beach location from this image.",
  "Sorry, the response is incomplete.",
  "I cannot assist with that request.",
  "抱歉，無法協助這次內容。",
]) {
  assert.throws(() => readPlannerMessage(message(text), 2), e => e instanceof PhotosetPlanError && e.status === 502);
}
assert.deepEqual(readPlannerMessage(message(`抱歉，無法提供即時天氣，以下為海灘陽光規劃：${json}`), 2).shots, shots);
assert.deepEqual(readPlannerMessage({
  ...toolMessage,
  content: [...message("Sorry, I cannot identify the exact beach.").content, ...toolMessage.content],
}, 2).shots, shots);
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
const beachPrompt = "更多的背景是海灘，然後陽光灑下來";
assert.ok(userExtras(planRequestSchema.parse({ ...input, customPrompt: beachPrompt })).includes(beachPrompt));
// The exact supplement must reach every image prompt, even when the AI omits it.
const plannedShots = shots.map(shot => ({ ...shot, prompt: mergePhotosetSupplement(shot.prompt, beachPrompt) }));
for (const shot of plannedShots) assert.ok(shot.prompt.includes(beachPrompt));
const extrasForGeneration = {
  customPrompt: beachPrompt, outfitText: "（服裝：白色襯衫）",
  referenceNote: "（沿用人物參考）", poseNote: "（姿勢參考圖3）", lookSuffix: "（自然寫實）",
};
for (const shot of [...shots, ...plannedShots]) {
  const sentPrompt = composePhotosetImagePrompt({ prompt: shot.prompt, ...extrasForGeneration });
  assert.equal(sentPrompt.split(beachPrompt).length - 1, 1);
  for (const extra of [extrasForGeneration.outfitText, extrasForGeneration.referenceNote, extrasForGeneration.poseNote, extrasForGeneration.lookSuffix]) {
    assert.ok(sentPrompt.includes(extra));
  }
}
// Edits and newly added shots still receive the saved planning supplement.
assert.ok(composePhotosetImagePrompt({ prompt: "新加的側面鏡頭", ...extrasForGeneration }).includes(beachPrompt));
assert.equal(mergePhotosetSupplement("  原鏡頭  ", "  "), "原鏡頭");
assert.equal(mergePhotosetSupplement(`海灘，${beachPrompt}`, beachPrompt), `海灘，${beachPrompt}`);
assert.equal(mergePhotosetSupplement(mergePhotosetSupplement("原鏡頭", beachPrompt), beachPrompt),
  mergePhotosetSupplement("原鏡頭", beachPrompt));
// Long shooting controls cannot silently consume the user's prompt allowance.
assert.equal(planRequestSchema.parse({ ...input, direction: "設".repeat(4000), customPrompt: "補".repeat(1000) }).customPrompt?.length, 1000);
assert.equal(planRequestSchema.safeParse({ ...input, customPrompt: "補".repeat(1001) }).success, false);
assert.equal(planRequestSchema.safeParse({ ...input, direction: "設".repeat(4001) }).success, false);
assert.equal(planRequestSchema.parse({ ...input, customPrompt: "  柔和側光  " }).customPrompt, "柔和側光");
console.log("Photo-set prompt integration and response-format checks passed (no AI or image-generation requests sent)");

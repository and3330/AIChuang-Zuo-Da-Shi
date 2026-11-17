// npx tsx --tsconfig tsconfig.json scripts/test-ugc-plan.ts
import assert from "node:assert/strict";
import { finishUgcPlan, parsePlan, PhotosetPlanError } from "../server/photoset";
import { cleanEnhanced } from "../server/enhancePrompt";
import { clampVideoSeconds } from "../shared/pricing";
import { dramaSceneSeconds, dramaResolution, dramaVideoCost, sceneShotNote, dialogueChars, dialogueSeconds } from "../shared/dramaMotion";
import { parseDramaScript } from "../server/dramaScript";

const shot = (seconds: number, i: number) => ({ title: `鏡 ${i}`, prompt: `畫面 ${i}`, seconds, framing: "近景", subtitle: `字幕 ${i}` });
const raw = { analysis: "a", intent: "鉤子", shots: [3, 4, 5, 3].map(shot), clips: [{ shots: [1, 2, 3, 4], motion: "Style lock: x. Shot 1 (0-3s)…" }] };

// parsePlan keeps the storyboard columns and the raw clips
const parsed = parsePlan(raw, 4);
assert.equal(parsed.shots[0].framing, "近景");
assert.equal(parsed.intent, "鉤子");
assert.ok(Array.isArray(parsed.rawClips));

// 15 s on Kling: lengths add up, every shot is a keyframe, one clip
const { rawClips, ...rest } = parsed;
const kling = finishUgcPlan(rest, rawClips, { totalSeconds: 15, videoModel: "kling" });
assert.equal(kling.shots.reduce((t, s) => t + (s.seconds ?? 0), 0), 15);
assert.deepEqual(kling.shots.map(s => s.start), [0, 3, 7, 12]);
assert.ok(kling.shots.every(s => s.keyframe));
assert.equal(kling.clips?.length, 1);
assert.equal(kling.clips?.[0].seconds, 15);

// 30 s on WAN: lengths scaled up, only the first shot gets a picture
const wan = finishUgcPlan(rest, rawClips, { totalSeconds: 30, videoModel: "wan" });
assert.equal(wan.shots.reduce((t, s) => t + (s.seconds ?? 0), 0), 30);
assert.deepEqual(wan.shots.map(s => s.keyframe), [true, false, false, false]);
assert.ok(wan.shots.every(s => (s.seconds ?? 0) >= 1.5 && ((s.seconds ?? 0) * 2) % 1 === 0));

// odd lengths still add up exactly in 0.5 s steps
const odd = finishUgcPlan({ analysis: "", shots: [1, 1, 1].map(shot) }, [{ shots: [1, 2, 3], motion: "m" }], { totalSeconds: 10, videoModel: "seedance" });
assert.equal(odd.shots.reduce((t, s) => t + (s.seconds ?? 0), 0), 10);

// a bad grouping falls back to one clip when the film fits in one generation
const regroup = finishUgcPlan(rest, [{ shots: [1, 3], motion: "a" }, { shots: [2], motion: "b" }], { totalSeconds: 20, videoModel: "kling" });
assert.deepEqual(regroup.clips?.[0].shots, [0, 1, 2, 3]);
assert.equal(regroup.clips?.[0].motion, "a b");

// no video prompt at all is an error, never an invented one
assert.throws(() => finishUgcPlan(rest, [], { totalSeconds: 15, videoModel: "kling" }), (e: any) => e instanceof PhotosetPlanError && e.status === 502);

// model ranges
assert.equal(clampVideoSeconds("kling", 30), 30);
assert.equal(clampVideoSeconds("kling", 45), 30);
assert.equal(clampVideoSeconds("seedance", 2), 4);
assert.equal(clampVideoSeconds("wan", 2), 2);

// enhancer output cleanup
assert.equal(cleanEnhanced("「這瓶精華我用了三週」"), "這瓶精華我用了三週");
assert.equal(cleanEnhanced("```\nShot 1 …\n```"), "Shot 1 …");

// drama: each scene runs its own planned length, clamped to what WAN accepts; price follows it
assert.equal(dramaSceneSeconds({ plannedSeconds: 7 }), 7);
assert.equal(dramaSceneSeconds({ plannedSeconds: 7 }, 12), 12);
assert.equal(dramaSceneSeconds({}), 5);
assert.equal(dramaSceneSeconds({ plannedSeconds: 7 }, "abc"), 7);
assert.equal(dramaSceneSeconds(null, 100), 30);
assert.equal(dramaSceneSeconds(null, 1), 2);
assert.equal(dramaResolution("4k"), "720p");
assert.equal(dramaVideoCost(7, "720p"), 56);
assert.equal(dramaVideoCost(7, "1080p"), 105);

// drama director mode: locks are copied word for word from the asset list, unknown ids dropped
const script = parseDramaScript({
  intent: "鉤子｜她為什麼不接電話",
  assets: [
    { id: "s1", name: "小雨", lock: "黑長直髮, 圓框眼鏡, 米色風衣" },
    { id: "L1", name: "雨夜巷口", lock: "窄巷, 霓虹招牌, 濕地反光, 冷藍色調" },
    { id: "X9", name: "壞的", lock: "不該出現" },
    { id: "P1", name: "", lock: "" },
  ],
  scenes: [
    { title: "雨夜", description: "她站在巷口", assetIds: ["L1", "S1", "Q2"], framing: "中景", angle: "平視", purpose: "建立｜交代地點", seconds: 40, cameraMovement: "push_in", videoPrompt: "黑長直髮的她抬頭" },
    { title: "空", description: "" },
    { title: "電話", description: "手機在桌上亮起", assetIds: [], cameraMovement: "spin", seconds: "x" },
  ],
}, 6);
assert.deepEqual(script.assets.map(a => a.id), ["S1", "L1"]);
assert.equal(script.scenes.length, 2);
assert.deepEqual(script.scenes[0].locks?.map(l => l.id), ["S1", "L1"]);
assert.equal(script.scenes[0].locks?.[0].lock, "黑長直髮, 圓框眼鏡, 米色風衣");
assert.equal(script.scenes[0].plannedSeconds, 10);
assert.ok(script.scenes[0].videoPrompt?.startsWith("黑長直髮的她抬頭"));
assert.equal(script.scenes[1].cameraMovement, "");
assert.equal(script.scenes[1].plannedSeconds, undefined);
assert.equal(script.scenes[1].locks, undefined);
assert.ok(sceneShotNote(script.scenes[0]).includes("S1 小雨：黑長直髮, 圓框眼鏡, 米色風衣"));
assert.ok(sceneShotNote(script.scenes[0]).includes("景別：中景"));
assert.equal(sceneShotNote({ description: "舊的幕" }), "");

// Dreamfab lessons: dialogue sets the length (about 4 characters a second, plus 1 s)
assert.equal(dialogueChars("你為什麼，不接電話？"), 8);
assert.equal(dialogueSeconds("你為什麼，不接電話？"), 3);
assert.equal(dialogueSeconds(""), 0);
assert.equal(dramaSceneSeconds({ dialogue: "一二三四五六七八九十一二三四五六七八九十一二三四五六七八" }), 8);
assert.equal(dramaSceneSeconds({ dialogue: "短句" }), 5);
const talky = parseDramaScript({ assets: [{ id: "S1", name: "甲", lock: "a" }, { id: "S2", name: "乙", lock: "b" }], scenes: [
  { description: "她開口", dialogue: "一二三四五六七八九十一二三四五六七八九十一二三四", seconds: 3, assetIds: ["S2", "S1"], transition: true },
  { description: "他回頭", seconds: 4, transition: true },
  { description: "收尾", seconds: 4, transition: true },
] }, 6);
assert.equal(talky.scenes[0].plannedSeconds, 7);
assert.deepEqual(talky.scenes[0].locks?.map(l => l.id), ["S2", "S1"]); // speaker stays first
assert.equal(talky.scenes[0].endOnNext, true);
assert.equal(talky.scenes[1].endOnNext, true);
assert.equal(talky.scenes[2].endOnNext, undefined); // last scene has nothing to land on
// series: an asset from an earlier episode is reused word for word even if the model only names its id
const series = parseDramaScript({ assets: [], scenes: [{ description: "她回到巷口", assetIds: ["S1"] }] }, 6, [{ id: "S1", name: "小雨", lock: "黑長直髮, 圓框眼鏡" }]);
assert.equal(series.scenes[0].locks?.[0].lock, "黑長直髮, 圓框眼鏡");

console.log("ugc plan: all good");

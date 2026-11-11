import { ageFromBirthDate, canUseNsfw, containsMinorTerms, containsNsfw, hasAdultConsent, isAdult } from "@shared/safety";
import { imageCost, IMAGE_COST, topupCredits } from "@shared/pricing";
const now = new Date(Date.UTC(2026, 10, 11));
const t: Array<[string, boolean]> = [
  ["age exact birthday", ageFromBirthDate("2008-11-11", now) === 18],
  ["age day before birthday", ageFromBirthDate("2008-11-12", now) === 17],
  ["invalid date rejected", ageFromBirthDate("2000-02-30", now) === null && ageFromBirthDate("abc", now) === null],
  ["future date rejected", ageFromBirthDate("2030-01-01", now) === null],
  ["adult needs birthday", !isAdult(null) && isAdult("1990-01-01")],
  ["consent needs both", !hasAdultConsent({ birthDate: "1990-01-01", nsfwEnabled: false }) && !hasAdultConsent({ birthDate: "2015-01-01", nsfwEnabled: true }) && hasAdultConsent({ birthDate: "1990-01-01", nsfwEnabled: true })],
  ["gold zone needs gold tier", !canUseNsfw({ birthDate: "1990-01-01", nsfwEnabled: true }) && !canUseNsfw({ birthDate: "1990-01-01", nsfwEnabled: true, isGold: false }) && canUseNsfw({ birthDate: "1990-01-01", nsfwEnabled: true, isGold: true })],
  ["gold tier alone is not enough", !canUseNsfw({ isGold: true }) && !canUseNsfw({ birthDate: "2015-01-01", nsfwEnabled: true, isGold: true })],
  ["minor terms zh", containsMinorTerms("穿著校服的高中生") && containsMinorTerms("16歲的女生") && !containsMinorTerms("28歲的上班族女性，穿著蕾絲內衣")],
  ["minor terms en", containsMinorTerms("a schoolgirl in a classroom") && containsMinorTerms("17 years old") && !containsMinorTerms("a 30 year old woman, kidney-shaped pool, studio light")],
  ["zh term", containsNsfw("一位全裸的女性")],
  ["en term word boundary", containsNsfw("a nude portrait") && !containsNsfw("Essex street, sextet, unisex")],
  ["studio notes are clean", !containsNsfw("第 2 張圖是服裝參考圖，只參考其服裝的款式、顏色與材質，不要沿用其中人物的長相、姿勢與背景；人物請穿上服裝參考圖中的這套服裝。半身照，坐在靠窗的位置")],
  ["price", IMAGE_COST === 5 && imageCost(true) === 5 && imageCost(false) === 6],
  ["gold zone price", imageCost(true, true) === 5 && imageCost(false, true) === 8],
  ["topup packs", topupCredits(50) === 50 && topupCredits(100) === 100 && topupCredits(300) === 320 && topupCredits(400) === 426 && topupCredits(500) === 550 && topupCredits(1000) === 1150 && topupCredits(3000) === 3600 && topupCredits(6000) === 7200],
];
let bad = 0; for (const [n, ok] of t) { console.log(ok ? "ok  " : "FAIL", n); if (!ok) bad++; }
console.log(`${t.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);

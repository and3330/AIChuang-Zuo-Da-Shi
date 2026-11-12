/** Keep the user's exact supplemental directions in every image prompt.
 * The planner may paraphrase or omit them; the UI echo alone is not delivery.
 * Idempotent because a returned plan may already contain the full directions.
 */
export function mergePhotosetSupplement(prompt: string, customPrompt?: string): string {
  const shot = prompt.trim();
  const supplement = customPrompt?.trim();
  if (!supplement || shot.includes(supplement)) return shot;
  return `${shot}\n\n補充要求：${supplement}`;
}

export function composePhotosetImagePrompt(input: {
  prompt: string;
  customPrompt?: string;
  outfitText: string;
  referenceNote: string;
  poseNote: string;
  lookSuffix: string;
}): string {
  return `${mergePhotosetSupplement(input.prompt, input.customPrompt)}${input.outfitText}${input.referenceNote}${input.poseNote}${input.lookSuffix}`;
}

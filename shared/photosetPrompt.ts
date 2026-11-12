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

/**
 * The character's saved appearance description (written from the uploaded photos, see
 * describeCharacterFromPhotos) as a note for an image prompt. Every generation that uses a
 * library character sends it along with the character's reference images, so hair, skin tone
 * and face shape stay the same from one image to the next. Empty when there is no description.
 */
export function appearanceNote(description?: string | null): string {
  const text = (description ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  return text ? `（人物外貌：${text}。臉部五官與身形以人物參考圖為準；髮型或服裝若另有指定，以指定為準）` : "";
}

export function composePhotosetImagePrompt(input: {
  prompt: string;
  customPrompt?: string;
  /** appearanceNote() of the chosen character; omit when no library character is used. */
  appearance?: string;
  outfitText: string;
  referenceNote: string;
  poseNote: string;
  lookSuffix: string;
}): string {
  return `${mergePhotosetSupplement(input.prompt, input.customPrompt)}${input.appearance ?? ""}${input.outfitText}${input.referenceNote}${input.poseNote}${input.lookSuffix}`;
}

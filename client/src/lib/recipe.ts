// 配方：從素材圖庫挑的一張人像、一套服裝、一個姿勢。
// 存在這台瀏覽器的 localStorage，讓圖庫頁和寫真套圖頁可以互相傳遞。

export type RecipeSlot = "portrait" | "costume" | "pose";

export type RecipeItem = {
  id: string;
  name: string;
  /** Text description to use in prompts. */
  usage: string;
  imageUrl: string | null;
  thumbUrl: string | null;
};

export type Recipe = Partial<Record<RecipeSlot, RecipeItem>>;

export const RECIPE_SLOTS: Array<{ id: RecipeSlot; label: string; emptyHint: string }> = [
  { id: "portrait", label: "人像", emptyHint: "決定臉與髮型" },
  { id: "costume", label: "服裝", emptyHint: "決定穿搭" },
  { id: "pose", label: "姿勢", emptyHint: "決定身體姿態" },
];

const KEY = "photosetRecipe.v1";

export function loadRecipe(): Recipe {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Recipe : {};
  } catch {
    return {}; // private mode, blocked storage or corrupt data: start empty
  }
}

export function saveRecipe(recipe: Recipe): void {
  try {
    if (Object.keys(recipe).length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(recipe));
  } catch { /* storage unavailable: the recipe just won't persist */ }
}

export function recipeCount(recipe: Recipe): number {
  return RECIPE_SLOTS.filter(s => !!recipe[s.id]).length;
}

/** One-paragraph description of the recipe, for copying into any prompt box. */
export function recipeText(recipe: Recipe): string {
  const parts: string[] = [];
  if (recipe.portrait) parts.push(`人物：${recipe.portrait.usage}`);
  if (recipe.costume) parts.push(`服裝：${recipe.costume.usage}`);
  if (recipe.pose) parts.push(`姿勢：${recipe.pose.usage}`);
  return parts.join("。") + (parts.length ? "。" : "");
}

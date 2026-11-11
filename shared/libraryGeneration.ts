import { z } from "zod";

export const libraryConcurrencyError = "同時生成張數請填 2–128 的偶數（2 的倍數）";
export const libraryConcurrencySchema = z.number().int().min(2).max(128).multipleOf(2);

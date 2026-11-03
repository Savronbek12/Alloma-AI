import { z } from "zod";
import {
  ERA_IDS,
  FIELD_IDS,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  SORT_OPTIONS,
} from "../../shared/constants.js";

/** Bo'sh satrni (?era=) "berilmagan" deb hisoblaydi. */
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);

export const listQuerySchema = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  era: z.preprocess(emptyToUndefined, z.enum(ERA_IDS).optional()),
  field: z.preprocess(emptyToUndefined, z.enum(FIELD_IDS).optional()),
  sort: z.preprocess(emptyToUndefined, z.enum(SORT_OPTIONS).default("birthYear")),
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).default(1)),
  limit: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
  ),
});

export const slugParamSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, "Slug faqat kichik lotin harflari, raqamlar va '-' dan iborat bo'lishi kerak"),
});

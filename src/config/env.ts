import path from "node:path";
import { z } from "zod";

// .env fayli bo'lsa yuklanadi (Node.js >= 20.12), bo'lmasa standart qiymatlar ishlatiladi.
try {
  process.loadEnvFile();
} catch {
  /* .env yo'q — muammo emas */
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().min(1).default("*"),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Noto'g'ri muhit o'zgaruvchilari:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProduction: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
  publicDir: path.resolve(process.cwd(), "public"),
} as const;

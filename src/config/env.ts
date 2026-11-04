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
  /** Render buni avtomatik beradi (masalan https://alloma-ai.onrender.com). */
  RENDER_EXTERNAL_URL: z.string().url().optional(),
  /** Keep-alive uchun qo'lda manzil (Render'dan tashqarida yoki boshqa domen uchun). */
  KEEP_ALIVE_URL: z.string().url().optional(),
  KEEP_ALIVE: z.enum(["true", "false"]).default("true"),
  KEEP_ALIVE_INTERVAL_MINUTES: z.coerce.number().min(1).max(14).default(10),

  /** Sayt manzili (bot rasmlari va havolalari uchun). Render'da RENDER_EXTERNAL_URL ishlatiladi. */
  PUBLIC_URL: z.string().url().optional(),

  // --- Telegram bot ---
  TELEGRAM_BOT_TOKEN: z.string().min(20).optional(),
  /** Webhook so'rovlarini tekshirish uchun maxfiy kalit (berilmasa tokendan hosil qilinadi). */
  TELEGRAM_WEBHOOK_SECRET: z
    .string()
    .regex(/^[A-Za-z0-9_-]{16,256}$/)
    .optional(),
  /**
   * auto — production'da webhook, aks holda o'chiq;
   * polling — lokal sinov uchun (DIQQAT: production webhook'ini o'chirib qo'yadi).
   */
  TELEGRAM_MODE: z.enum(["auto", "webhook", "polling", "off"]).default("auto"),

  // --- Groq AI (bepul tarif) ---
  GROQ_API_KEY: z.string().min(10).optional(),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GROQ_FALLBACK_MODEL: z.string().default("llama-3.1-8b-instant"),
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
  publicUrl: (parsed.data.PUBLIC_URL ?? parsed.data.RENDER_EXTERNAL_URL)?.replace(/\/+$/, ""),
  /** Keep-alive faqat production'da va ommaviy manzil ma'lum bo'lganda ishlaydi. */
  keepAliveUrl:
    parsed.data.NODE_ENV === "production" && parsed.data.KEEP_ALIVE === "true"
      ? (parsed.data.KEEP_ALIVE_URL ?? parsed.data.RENDER_EXTERNAL_URL)
      : undefined,
} as const;

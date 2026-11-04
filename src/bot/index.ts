import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import type { AllomaService } from "../services/alloma.service.js";
import { AllomaBot, BOT_COMMANDS } from "./alloma-bot.js";
import { GroqClient } from "./groq.js";
import { TelegramApi, type TgUpdate } from "./telegram-api.js";

export const TELEGRAM_WEBHOOK_PATH = "/telegram/webhook";

export interface TelegramRuntime {
  mode: "webhook" | "polling";
  bot: AllomaBot;
  webhookHandler: RequestHandler;
  start(): Promise<void>;
  stop(): void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Telegram webhook: maxfiy sarlavhani tekshiradi, darhol 200 qaytarib, xabarni fonda qayta ishlaydi. */
export function createWebhookHandler(
  bot: Pick<AllomaBot, "handleUpdate">,
  secret: string,
  onError: (err: Error) => void = (err) => console.error("[bot] xato:", err.message),
): RequestHandler {
  const expected = Buffer.from(secret);
  return (req, res) => {
    const given = Buffer.from(req.get("X-Telegram-Bot-Api-Secret-Token") ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.sendStatus(401);
      return;
    }
    res.sendStatus(200);
    void bot.handleUpdate(req.body as TgUpdate).catch(onError);
  };
}

/**
 * Bot sozlamalari to'liq bo'lsa runtime yaratadi, aks holda undefined (sayt botsiz ishlayveradi).
 */
export function createTelegramRuntime(service: AllomaService): TelegramRuntime | undefined {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token || env.TELEGRAM_MODE === "off") return undefined;

  const mode =
    env.TELEGRAM_MODE === "auto"
      ? env.isProduction && env.publicUrl
        ? "webhook"
        : undefined
      : env.TELEGRAM_MODE;
  if (!mode) {
    console.log("[bot] lokal rejimda o'chiq (sinash uchun TELEGRAM_MODE=polling qo'ying)");
    return undefined;
  }
  if (mode === "webhook" && !env.publicUrl) {
    console.error("[bot] webhook uchun PUBLIC_URL yoki RENDER_EXTERNAL_URL kerak — bot o'chirildi");
    return undefined;
  }

  const api = new TelegramApi(token);
  const ai = env.GROQ_API_KEY
    ? new GroqClient({
        apiKey: env.GROQ_API_KEY,
        model: env.GROQ_MODEL,
        fallbackModel: env.GROQ_FALLBACK_MODEL,
      })
    : undefined;
  if (!ai) console.warn("[bot] GROQ_API_KEY yo'q — AI javoblari o'chiq, buyruqlar ishlaydi");

  const bot = new AllomaBot({
    api,
    service,
    ai,
    siteUrl: env.publicUrl,
    identity: { name: env.BOT_NAME, creator: env.BOT_CREATOR },
  });
  const secret =
    env.TELEGRAM_WEBHOOK_SECRET ?? createHash("sha256").update(`alloma-ai:${token}`).digest("hex").slice(0, 48);

  const webhookHandler = createWebhookHandler(bot, secret);

  let polling = false;

  return {
    mode,
    bot,
    webhookHandler,

    async start() {
      await api.call("setMyCommands", { commands: BOT_COMMANDS }).catch((err: Error) =>
        console.warn("[bot] setMyCommands:", err.message),
      );
      // Telegram'da ko'rinadigan nom BOT_NAME bilan bir xil bo'lsin.
      await api.call("setMyName", { name: env.BOT_NAME }).catch((err: Error) =>
        console.warn("[bot] setMyName:", err.message),
      );

      if (mode === "webhook") {
        const url = `${env.publicUrl}${TELEGRAM_WEBHOOK_PATH}`;
        await api.call("setWebhook", {
          url,
          secret_token: secret,
          allowed_updates: ["message", "callback_query"],
        });
        console.log(`[bot] webhook o'rnatildi: ${url}`);
        return;
      }

      // Polling — faqat lokal sinov uchun.
      await api.call("deleteWebhook", { drop_pending_updates: false });
      polling = true;
      console.log("[bot] polling rejimida ishga tushdi");
      void (async () => {
        let offset = 0;
        while (polling) {
          try {
            const updates = await api.call<TgUpdate[]>(
              "getUpdates",
              { offset, timeout: 25, allowed_updates: ["message", "callback_query"] },
              35_000,
            );
            for (const update of updates) {
              offset = update.update_id + 1;
              await bot.handleUpdate(update).catch((err: Error) => console.error("[bot] xato:", err.message));
            }
          } catch (err) {
            if (polling) {
              console.error("[bot] getUpdates:", (err as Error).message);
              await sleep(3000);
            }
          }
        }
      })();
    },

    stop() {
      polling = false;
    },
  };
}

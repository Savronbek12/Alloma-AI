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

/** /api/health da ko'rsatiladigan bot holati (maxfiy qiymatlarsiz) — muammolarni tashqaridan aniqlash uchun. */
export interface BotStatus {
  enabled: boolean;
  mode?: "webhook" | "polling";
  ai: boolean;
  /** Bot o'chiq yoki xato bo'lsa — sababi. */
  reason?: string;
  webhook?: "o'rnatildi" | "xato";
}

let botStatus: BotStatus = { enabled: false, ai: false, reason: "ishga tushirilmagan" };

export function getBotStatus(): BotStatus {
  return botStatus;
}

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
  const ai = Boolean(env.GROQ_API_KEY);
  if (!token) {
    botStatus = { enabled: false, ai, reason: "TELEGRAM_BOT_TOKEN muhit o'zgaruvchisi topilmadi" };
    console.log("[bot] o'chiq: TELEGRAM_BOT_TOKEN yo'q");
    return undefined;
  }
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    botStatus = {
      enabled: false,
      ai,
      reason: "TELEGRAM_BOT_TOKEN formati noto'g'ri (to'liq nusxalanganini tekshiring: 123456789:AA…)",
    };
    console.error(`[bot] o'chiq: ${botStatus.reason}`);
    return undefined;
  }
  if (env.TELEGRAM_MODE === "off") {
    botStatus = { enabled: false, ai, reason: "TELEGRAM_MODE=off" };
    return undefined;
  }

  const mode =
    env.TELEGRAM_MODE === "auto"
      ? env.isProduction && env.publicUrl
        ? "webhook"
        : undefined
      : env.TELEGRAM_MODE;
  if (!mode) {
    botStatus = {
      enabled: false,
      ai,
      reason: env.isProduction
        ? "sayt manzili noma'lum (PUBLIC_URL yoki RENDER_EXTERNAL_URL yo'q)"
        : "lokal rejim (sinash uchun TELEGRAM_MODE=polling)",
    };
    console.log(`[bot] o'chiq: ${botStatus.reason}`);
    return undefined;
  }
  if (mode === "webhook" && !env.publicUrl) {
    botStatus = { enabled: false, ai, reason: "webhook uchun PUBLIC_URL yoki RENDER_EXTERNAL_URL kerak" };
    console.error(`[bot] o'chiq: ${botStatus.reason}`);
    return undefined;
  }
  botStatus = { enabled: true, mode, ai };

  const api = new TelegramApi(token);
  const aiClient = env.GROQ_API_KEY
    ? new GroqClient({
        apiKey: env.GROQ_API_KEY,
        model: env.GROQ_MODEL,
        fallbackModel: env.GROQ_FALLBACK_MODEL,
      })
    : undefined;
  if (!aiClient) console.warn("[bot] GROQ_API_KEY yo'q — AI javoblari o'chiq, buyruqlar ishlaydi");

  const bot = new AllomaBot({
    api,
    service,
    ai: aiClient,
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
        const info = await api
          .call<{ url: string; pending_update_count: number }>("getWebhookInfo")
          .catch(() => undefined);
        // Webhook birinchi marta (yoki boshqa manzildan) o'rnatilayotgan bo'lsa — bot o'chiq turgan
        // paytda to'plangan eski xabarlarni tashlab yuboramiz: aks holda bot ularning hammasiga
        // birdaniga javob berib, bepul AI limitini bir zumda tugatadi.
        const firstSetup = info?.url !== url;
        try {
          await api.call("setWebhook", {
            url,
            secret_token: secret,
            allowed_updates: ["message", "callback_query"],
            drop_pending_updates: firstSetup,
          });
          botStatus = { ...botStatus, webhook: "o'rnatildi" };
        } catch (err) {
          // Masalan: token noto'g'ri nusxalangan (bo'shliq, qo'shtirnoq) yoki /revoke qilingan.
          botStatus = { ...botStatus, webhook: "xato", reason: (err as Error).message };
          throw err;
        }
        console.log(
          `[bot] webhook o'rnatildi: ${url}` +
            (firstSetup && info?.pending_update_count
              ? ` (eski ${info.pending_update_count} ta xabar tashlab yuborildi)`
              : ""),
        );
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

import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { z } from "zod";
import type { AllomaService } from "../services/alloma.service.js";
import { buildAiMessages, DEFAULT_IDENTITY, identityAnswer, isIdentityQuestion, stripMarkdown, type BotIdentity } from "./format.js";
import type { AiClient, ChatMessage } from "./groq.js";
import { addMoodEmoji, extractStickerTag } from "./stickers.js";
import { findSubject } from "./subjects.js";

/**
 * Telegram Mini App: fanlar bo'yicha suhbat Telegram ichidagi oynada.
 * Suhbat tarixi mijozda (Mini App'da) saqlanadi va har so'rovda yuboriladi — server holatsiz.
 */

export const MINIAPP_PATH = "/app/";
export const MINIAPP_CHAT_PATH = "/api/miniapp/chat";

/** Mini App'dan bir kunlik initData qabul qilinadi (oyna uzoq ochiq turishi mumkin). */
const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;
/** Bitta foydalanuvchidan AI so'rovlari orasidagi minimal vaqt. */
export const MINIAPP_COOLDOWN_MS = 3_000;
const MAX_QUESTION_LENGTH = 500;
const MAX_HISTORY = 16;

export interface MiniAppUser {
  id: number;
  first_name?: string;
  username?: string;
}

/**
 * Telegram initData imzosini tekshiradi:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(
  initData: string,
  botToken: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  maxAgeSec: number = INIT_DATA_MAX_AGE_SEC,
): MiniAppUser | undefined {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return undefined;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, "hex"))) return undefined;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec) return undefined;

  try {
    const user = JSON.parse(params.get("user") ?? "") as MiniAppUser;
    return typeof user?.id === "number" ? user : undefined;
  } catch {
    return undefined;
  }
}

const chatBodySchema = z.object({
  initData: z.string().min(1).max(4096),
  subject: z.string().min(1).max(16),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(40),
});

export interface MiniAppDeps {
  botToken: string;
  service: AllomaService;
  ai?: AiClient | undefined;
  identity?: BotIdentity;
  now?: () => number;
  log?: (message: string) => void;
}

const fail = (res: Parameters<RequestHandler>[1], status: number, message: string) => {
  res.status(status).json({ error: { message } });
};

/** POST /api/miniapp/chat — { initData, subject, messages } → { answer }. */
export function createMiniAppChatHandler(deps: MiniAppDeps): RequestHandler {
  const identity = deps.identity ?? DEFAULT_IDENTITY;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((m: string) => console.error(m));
  const lastRequest = new Map<number, number>();

  return async (req, res) => {
    const parsed = chatBodySchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "So'rov noto'g'ri.");
    const { initData, subject: subjectId, messages } = parsed.data;

    const user = verifyInitData(initData, deps.botToken, Math.floor(now() / 1000));
    if (!user) return fail(res, 401, "Mini App'ni bot ichidan qayta oching.");

    const subject = findSubject(subjectId);
    if (!subject) return fail(res, 400, "Bunday fan yo'q.");

    const question = messages.at(-1);
    if (question?.role !== "user") return fail(res, 400, "Oxirgi xabar savol bo'lishi kerak.");
    if (question.content.length > MAX_QUESTION_LENGTH) {
      return fail(res, 400, `Savol juda uzun — ${MAX_QUESTION_LENGTH} belgidan qisqaroq yozing.`);
    }

    if (isIdentityQuestion(question.content)) {
      res.json({ answer: identityAnswer(identity) });
      return;
    }
    if (!deps.ai) return fail(res, 503, "AI hozircha ulanmagan.");

    const t = now();
    const last = lastRequest.get(user.id);
    if (last !== undefined && t - last < MINIAPP_COOLDOWN_MS) {
      return fail(res, 429, "⏳ Biroz kuting — juda tez yozyapsiz.");
    }
    lastRequest.set(user.id, t);
    if (lastRequest.size > 5000) lastRequest.delete(lastRequest.keys().next().value as number);

    const history: ChatMessage[] = messages.slice(0, -1).slice(-MAX_HISTORY);
    const relevant = deps.service.findRelevant(question.content, 5);
    const aiMessages = buildAiMessages(question.content, deps.service.all(), relevant, identity, history);
    const system = aiMessages[0];
    if (system?.role === "system") {
      system.content += [
        "",
        "",
        `MINI APP REJIMI: foydalanuvchi Telegram Mini App'da «${subject.name}» fanini tanlagan. Savollarni shu fan nuqtai nazaridan tushun va javob ber (o'quvchiga ustozdek, bosqichma-bosqich). Boshqa mavzuda so'rasa ham yordam ber.`,
        "Javobni oddiy matnda yoz; kod bo'lsa ```til ... ``` bloklarida ber. /buyruqlarni tavsiya qilma.",
      ].join("\n");
    }

    try {
      const raw = stripMarkdown(await deps.ai.complete(aiMessages));
      const tagged = extractStickerTag(raw);
      const answer = tagged.text.replace(new RegExp(`^\\s*${identity.name}\\s*:\\s*`, "i"), "").trim();
      if (!answer) throw new Error("bo'sh javob");
      res.json({ answer: tagged.mood ? addMoodEmoji(answer, tagged.mood) : answer });
    } catch (err) {
      log(`[miniapp] AI xato: ${(err as Error).message}`);
      fail(res, 502, "AI xizmati hozir band yoki kunlik bepul limitga yetdi. Birozdan keyin qayta urinib ko'ring.");
    }
  };
}

import { ERA_IDS, ERA_LABELS, ERA_PERIODS, type EraId } from "../../shared/constants.js";
import type { Alloma } from "../../shared/types.js";
import type { AllomaService } from "../services/alloma.service.js";
import { normalizeForSearch } from "../utils/text.js";
import {
  allomaButtonLabel,
  allomaCaption,
  buildAiMessages,
  DEFAULT_IDENTITY,
  escapeHtml,
  identityAnswer,
  isIdentityQuestion,
  stripMarkdown,
  truncate,
  type BotIdentity,
} from "./format.js";
import type { AiClient } from "./groq.js";
import type { BotApi, InlineButton, TgCallbackQuery, TgMessage, TgUpdate } from "./telegram-api.js";

/** Bepul AI kvotasini himoya qilish: bitta chatdan AI so'rovlari orasidagi minimal vaqt. */
export const AI_COOLDOWN_MS = 5_000;
const MAX_QUESTION_LENGTH = 500;

export interface AllomaBotDeps {
  api: BotApi;
  service: AllomaService;
  ai?: AiClient | undefined;
  /** Ommaviy sayt manzili (rasmlar va "Saytda ochish" tugmasi uchun). */
  siteUrl?: string | undefined;
  /** Bot o'zini qanday tanishtiradi (standart: Alloma AI / vzvz). */
  identity?: BotIdentity;
  log?: (message: string) => void;
  now?: () => number;
}

export const BOT_COMMANDS = [
  { command: "tasodifiy", description: "Tasodifiy alloma" },
  { command: "qidir", description: "Ism, shahar yoki asar bo'yicha qidirish" },
  { command: "davrlar", description: "Davrlar bo'yicha ko'rish" },
  { command: "yordam", description: "Bot imkoniyatlari" },
];

const helpText = (identity: BotIdentity) => [
  `Salom! Men — <b>${escapeHtml(identity.name)}</b>, o'zbek allomalari haqida bot.`,
  "",
  "Savolingizni oddiy yozing, masalan:",
  "• <i>Algebrani kim asoslagan?</i>",
  "• <i>Navoiyning asarlari qaysilar?</i>",
  "• <i>Temuriylar davri olimlari</i>",
  "",
  "Yoki allomaning ismini yozing — <i>Beruniy</i>.",
  "",
  "/tasodifiy — tasodifiy alloma",
  "/qidir <i>so'z</i> — qidirish",
  "/davrlar — davrlar bo'yicha ko'rish",
].join("\n");

export class AllomaBot {
  private readonly lastAiRequest = new Map<number, number>();
  private readonly log: (message: string) => void;
  private readonly identity: BotIdentity;

  constructor(private readonly deps: AllomaBotDeps) {
    this.log = deps.log ?? ((m) => console.log(m));
    this.identity = deps.identity ?? DEFAULT_IDENTITY;
  }

  async handleUpdate(update: TgUpdate): Promise<void> {
    if (update.callback_query) return this.onCallback(update.callback_query);
    if (update.message?.text) return this.onText(update.message);
  }

  // ---------- Kiruvchi xabarlar ----------

  private async onText(msg: TgMessage): Promise<void> {
    const chatId = msg.chat.id;
    const text = (msg.text ?? "").trim();

    if (text.startsWith("/")) {
      const [head = "", ...rest] = text.split(/\s+/);
      const command = (head.split("@")[0] ?? "").toLowerCase();
      const arg = rest.join(" ").trim();
      switch (command) {
        case "/tasodifiy":
          return this.sendCard(chatId, this.deps.service.random());
        case "/davrlar":
          return this.sendEras(chatId);
        case "/qidir":
          return arg
            ? this.sendSearch(chatId, arg)
            : this.send(chatId, "Qidiruv so'zini yozing, masalan: <code>/qidir Beruniy</code>");
        default:
          return this.send(chatId, helpText(this.identity));
      }
    }

    if (isIdentityQuestion(text)) return this.send(chatId, escapeHtml(identityAnswer(this.identity)));

    const exact = this.deps.service.findByName(text);
    if (exact) return this.sendCard(chatId, exact);
    return this.answerWithAi(chatId, text);
  }

  private async onCallback(query: TgCallbackQuery): Promise<void> {
    await this.deps.api.call("answerCallbackQuery", { callback_query_id: query.id }).catch(() => {});
    const chatId = query.message?.chat.id;
    if (!chatId) return;
    const data = query.data ?? "";

    if (data === "rnd") return this.sendCard(chatId, this.deps.service.random());
    if (data.startsWith("e:")) return this.sendEra(chatId, data.slice(2));
    if (data.startsWith("a:")) {
      try {
        return await this.sendCard(chatId, this.deps.service.getBySlug(data.slice(2)));
      } catch {
        return this.send(chatId, "Bu alloma topilmadi.");
      }
    }
  }

  // ---------- Javoblar ----------

  private async send(chatId: number, text: string, buttons?: InlineButton[][]): Promise<void> {
    await this.deps.api.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  }

  private async sendCard(chatId: number, a: Alloma): Promise<void> {
    const { siteUrl } = this.deps;
    const buttons: InlineButton[][] = [];
    if (siteUrl) buttons.push([{ text: "🌐 Saytda ochish", url: `${siteUrl}/#/alloma/${a.slug}` }]);
    buttons.push([{ text: "🎲 Yana tasodifiy", callback_data: "rnd" }]);
    const caption = allomaCaption(a);

    if (a.image && siteUrl) {
      try {
        await this.deps.api.call("sendPhoto", {
          chat_id: chatId,
          photo: `${siteUrl}${a.image.src}`,
          caption: truncate(caption, 1024),
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: buttons },
        });
        return;
      } catch (err) {
        this.log(`[bot] sendPhoto xato (${a.slug}): ${(err as Error).message}`);
      }
    }
    await this.send(chatId, caption, buttons);
  }

  private async sendSearch(chatId: number, query: string): Promise<void> {
    const { service } = this.deps;
    let items = service.list({ q: query, sort: "birthYear", page: 1, limit: 10 }).items;
    if (items.length === 0) items = service.findRelevant(query, 8);
    if (items.length === 0) {
      await this.send(chatId, `«${escapeHtml(query)}» bo'yicha hech kim topilmadi. /davrlar orqali ko'rib chiqing.`);
      return;
    }
    await this.send(
      chatId,
      `🔎 «${escapeHtml(query)}» bo'yicha ${items.length} ta natija:`,
      items.map((a) => [{ text: allomaButtonLabel(a), callback_data: `a:${a.slug}` }]),
    );
  }

  private async sendEras(chatId: number): Promise<void> {
    const meta = this.deps.service.meta();
    await this.send(
      chatId,
      "Davrni tanlang:",
      meta.eras.map((e) => [{ text: `${e.label} · ${e.period} (${e.count})`, callback_data: `e:${e.id}` }]),
    );
  }

  private async sendEra(chatId: number, eraId: string): Promise<void> {
    if (!(ERA_IDS as readonly string[]).includes(eraId)) return;
    const era = eraId as EraId;
    const items = this.deps.service.list({ era, sort: "birthYear", page: 1, limit: 200 }).items;
    const rows: InlineButton[][] = [];
    for (let i = 0; i < items.length; i += 2) {
      rows.push(
        items.slice(i, i + 2).map((a) => ({ text: truncate(a.name, 32), callback_data: `a:${a.slug}` })),
      );
    }
    await this.send(
      chatId,
      `<b>${escapeHtml(ERA_LABELS[era])}</b> — ${escapeHtml(ERA_PERIODS[era])}\n${items.length} ta alloma:`,
      rows,
    );
  }

  private async answerWithAi(chatId: number, question: string): Promise<void> {
    const { ai, service, api } = this.deps;
    if (!ai) {
      await this.send(chatId, "AI hozircha ulanmagan. /qidir yoki /davrlar buyruqlaridan foydalaning.");
      return;
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      await this.send(chatId, `Savol juda uzun — ${MAX_QUESTION_LENGTH} belgidan qisqaroq yozing.`);
      return;
    }

    const now = this.deps.now?.() ?? Date.now();
    const last = this.lastAiRequest.get(chatId);
    if (last !== undefined && now - last < AI_COOLDOWN_MS) {
      await this.send(chatId, "⏳ Biroz kuting — keyingi savolni bir necha soniyadan so'ng yuboring.");
      return;
    }
    this.lastAiRequest.set(chatId, now);

    await api.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    const relevant = service.findRelevant(question, 5);

    let answer: string;
    try {
      answer = stripMarkdown(
        await ai.complete(buildAiMessages(question, service.all(), relevant, this.identity)),
      );
    } catch (err) {
      this.log(`[bot] AI xato: ${(err as Error).message}`);
      await this.send(
        chatId,
        "AI xizmati hozir band yoki kunlik bepul limitga yetdi. Birozdan keyin qayta urinib ko'ring yoki /qidir dan foydalaning.",
      );
      return;
    }

    // Javobda tilga olingan allomalar uchun tugmalar.
    const normalizedAnswer = normalizeForSearch(answer);
    const mentioned = relevant
      .filter((a) => {
        const lastWord = normalizeForSearch(a.name).split(" ").at(-1) ?? "";
        return lastWord.length >= 4 && normalizedAnswer.includes(lastWord);
      })
      .slice(0, 3);

    // AI matni HTML sifatida emas, oddiy matn sifatida yuboriladi (formatlash xatolari bo'lmasligi uchun).
    await api.call("sendMessage", {
      chat_id: chatId,
      text: truncate(answer, 4000),
      link_preview_options: { is_disabled: true },
      ...(mentioned.length
        ? {
            reply_markup: {
              inline_keyboard: mentioned.map((a) => [{ text: `📖 ${a.name}`, callback_data: `a:${a.slug}` }]),
            },
          }
        : {}),
    });
  }
}

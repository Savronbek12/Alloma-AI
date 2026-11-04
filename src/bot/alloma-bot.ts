import { ERA_IDS, ERA_LABELS, ERA_PERIODS, type EraId } from "../../shared/constants.js";
import type { Alloma } from "../../shared/types.js";
import type { AllomaService } from "../services/alloma.service.js";
import { normalizeForSearch } from "../utils/text.js";
import { BotGuard } from "./bot-guard.js";
import { ConversationStore } from "./conversation.js";
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

/** Bepul AI kvotasini himoya qilish: bitta chatdan (odamdan) AI so'rovlari orasidagi minimal vaqt. */
export const AI_COOLDOWN_MS = 5_000;
const MAX_QUESTION_LENGTH = 500;
/** Boshqa botlarning uzun xabarlari rad etilmaydi, balki shu uzunlikkacha qisqartiriladi. */
const MAX_BOT_INPUT_LENGTH = 1200;

export interface BotSelf {
  id: number;
  username: string;
}

export interface AllomaBotDeps {
  api: BotApi;
  service: AllomaService;
  ai?: AiClient | undefined;
  /** Ommaviy sayt manzili (rasmlar va "Saytda ochish" tugmasi uchun). */
  siteUrl?: string | undefined;
  /** Bot o'zini qanday tanishtiradi (standart: Alloma AI / Savronbek). */
  identity?: BotIdentity;
  /** Botning Telegram'dagi id va username'i (getMe). Guruhda murojaatni aniqlash uchun kerak. */
  self?: BotSelf | undefined;
  /** Suhbat qilinadigan sherik bot username'i (masalan "sardorbai202bot"). */
  partnerBot?: string | undefined;
  /** Suhbat xotirasi (berilmasa — standart sozlamalar bilan yaratiladi). */
  conversations?: ConversationStore;
  /** Bot-bot sikliga qarshi himoya va yuborish limitlari. */
  guard?: BotGuard;
  log?: (message: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Bitta javob konteksti: qaysi chatga, qaysi xabarga reply, kimga. */
interface ReplyContext {
  chatId: number;
  isGroup: boolean;
  /** Reply qilinadigan xabar (guruhda va botlarga doim reply qilinadi). */
  replyTo?: number | undefined;
  /** Xabar boshqa botdan kelgan bo'lsa — uning id'si. Xato/limit xabarlari unga yuborilmaydi. */
  fromBotId?: number | undefined;
}

export const BOT_COMMANDS = [
  { command: "tasodifiy", description: "Tasodifiy alloma" },
  { command: "qidir", description: "Ism, shahar yoki asar bo'yicha qidirish" },
  { command: "davrlar", description: "Davrlar bo'yicha ko'rish" },
  { command: "yangi", description: "Suhbatni yangidan boshlash" },
  { command: "yordam", description: "Bot imkoniyatlari" },
];

const helpText = (identity: BotIdentity, partnerBot?: string) =>
  [
    `Salom! Men — <b>${escapeHtml(identity.name)}</b>, o'zbek allomalari haqida bot.`,
    "",
    "Men bilan bemalol suhbatlashing — oldingi gaplarimizni eslab qolaman. Masalan:",
    "• <i>Algebrani kim asoslagan?</i>",
    "• <i>Navoiy qayerda tug'ilgan?</i> → <i>Uning asarlari-chi?</i>",
    "• <i>Temuriylar davri olimlari kimlar?</i>",
    "",
    "Yoki allomaning ismini yozing — <i>Beruniy</i>.",
    "",
    "/tasodifiy — tasodifiy alloma",
    "/qidir <i>so'z</i> — qidirish",
    "/davrlar — davrlar bo'yicha ko'rish",
    "/yangi — suhbatni yangidan boshlash",
    ...(partnerBot
      ? ["", `Guruhda: <i>Sardor AI'dan Beruniy haqida so'ra</i> — men @${escapeHtml(partnerBot)} bilan suhbat boshlayman.`]
      : []),
  ].join("\n");

const APOSTROPHES = /[ʻʼ‘’`']/g;

/** "Sardor AI'dan Beruniy haqida so'ra" -> "Beruniy". */
export function parseAskPartner(text: string): string | undefined {
  const t = text.replace(APOSTROPHES, "'");
  const m = t.match(/sardor\s*ai\s*'?\s*dan\s+(.+?)\s+(?:haqida\s+)?so'ra(?:b\s+ber|ng|chi)?\b/i);
  const topic = m?.[1]?.trim();
  return topic && topic.length >= 2 ? topic : undefined;
}

export class AllomaBot {
  private readonly lastAiRequest = new Map<number, number>();
  private readonly log: (message: string) => void;
  private readonly identity: BotIdentity;
  private readonly conversations: ConversationStore;
  private readonly guard: BotGuard;
  private readonly sleep: (ms: number) => Promise<void>;
  private self: BotSelf | undefined;

  constructor(private readonly deps: AllomaBotDeps) {
    this.log = deps.log ?? ((m) => console.log(m));
    this.identity = deps.identity ?? DEFAULT_IDENTITY;
    this.conversations = deps.conversations ?? new ConversationStore();
    this.guard = deps.guard ?? new BotGuard();
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.self = deps.self;
  }

  /** Ishga tushganda getMe natijasi beriladi. */
  setSelf(self: BotSelf): void {
    this.self = self;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  async handleUpdate(update: TgUpdate): Promise<void> {
    if (update.callback_query) return this.onCallback(update.callback_query);
    if (update.message?.text) return this.onText(update.message);
  }

  // ---------- Kim kimga murojaat qilyapti ----------

  private mentionsUs(text: string): boolean {
    return Boolean(this.self && text.toLowerCase().includes(`@${this.self.username.toLowerCase()}`));
  }

  private isReplyToUs(msg: TgMessage): boolean {
    return Boolean(this.self && msg.reply_to_message?.from?.id === this.self.id);
  }

  private stripOwnMention(text: string): string {
    if (!this.self) return text;
    const re = new RegExp(`@${this.self.username}\\b`, "gi");
    return text.replace(re, "").replace(/\s+/g, " ").trim();
  }

  private speakerLabel(msg: TgMessage): string {
    const name = msg.from?.first_name || msg.from?.username || "Foydalanuvchi";
    return msg.from?.is_bot ? `${name} (bot)` : name;
  }

  // ---------- Kiruvchi xabarlar ----------

  private async onText(msg: TgMessage): Promise<void> {
    const chatId = msg.chat.id;
    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    const raw = (msg.text ?? "").trim();
    const from = msg.from;

    // O'z xabarlarimizga hech qachon javob bermaymiz.
    if (from && this.self && from.id === this.self.id) return;

    const isBot = from?.is_bot === true;
    if (!isBot) this.guard.onHumanMessage(chatId);

    const addressed = this.mentionsUs(raw) || this.isReplyToUs(msg);

    // Buyruq boshqa botga atalgan bo'lsa (/start@boshqa_bot) — bizga emas.
    const commandTarget = raw.startsWith("/") ? raw.split(/\s+/)[0]?.split("@")[1] : undefined;
    if (commandTarget && (!this.self || commandTarget.toLowerCase() !== this.self.username.toLowerCase())) return;
    const commandForUs = raw.startsWith("/") && (!isGroup || Boolean(commandTarget) || !isBot);

    if (isBot) {
      // Boshqa botga faqat u bizga reply qilsa yoki @username'imizni yozsa (yoki /buyruq@biz) javob beramiz.
      if (!addressed && !commandTarget) return;
      return this.onBotMessage(msg, raw);
    }

    // Guruhda odamlarga: buyruq, @mention, "Alloma AI" deb murojaat yoki reply bo'lsa.
    if (isGroup) {
      const byName = normalizeForSearch(raw).includes(normalizeForSearch(this.identity.name));
      if (!commandForUs && !addressed && !byName) return;
    }

    const ctx: ReplyContext = { chatId, isGroup, replyTo: isGroup ? msg.message_id : undefined };
    const text = this.stripOwnMention(raw);

    if (text.startsWith("/")) return this.onCommand(ctx, text);

    const partnerTopic = this.deps.partnerBot && isGroup ? parseAskPartner(text) : undefined;
    if (partnerTopic) return this.askPartner(ctx, partnerTopic);

    if (isIdentityQuestion(text)) {
      await this.send(ctx, escapeHtml(identityAnswer(this.identity)));
      return;
    }

    const exact = this.deps.service.findByName(text);
    if (exact) return this.sendCard(ctx, exact);
    await this.answerWithAi(ctx, text, this.speakerLabel(msg));
  }

  /** Boshqa botdan kelgan, bizga atalgan xabar — sikldan himoya bilan. */
  private async onBotMessage(msg: TgMessage, raw: string): Promise<void> {
    const botId = msg.from?.id ?? 0;
    const chatId = msg.chat.id;
    const decision = this.guard.checkBotMessage(chatId, botId, raw, this.now());
    if (!decision.allow) {
      this.log(`[bot] bot xabari o'tkazildi (${decision.reason}) chat=${chatId}`);
      return;
    }
    if (decision.waitMs > 0) await this.sleep(decision.waitMs);

    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    const ctx: ReplyContext = { chatId, isGroup, replyTo: msg.message_id, fromBotId: botId };
    const text = truncate(this.stripOwnMention(raw), MAX_BOT_INPUT_LENGTH);

    let sent = false;
    if (text.startsWith("/")) {
      sent = await this.onCommand(ctx, text).then(() => true);
    } else if (isIdentityQuestion(text)) {
      sent = await this.send(ctx, escapeHtml(identityAnswer(this.identity)));
    } else {
      sent = await this.answerWithAi(ctx, text, this.speakerLabel(msg));
    }
    if (sent) this.guard.recordBotReply(chatId, botId, this.now());
  }

  private async onCommand(ctx: ReplyContext, text: string): Promise<void> {
    const [head = "", ...rest] = text.split(/\s+/);
    const command = (head.split("@")[0] ?? "").toLowerCase();
    const arg = rest.join(" ").trim();
    switch (command) {
      case "/tasodifiy":
        return this.sendCard(ctx, this.deps.service.random());
      case "/davrlar":
        return this.sendEras(ctx);
      case "/yangi":
        this.conversations.reset(ctx.chatId);
        await this.send(ctx, "🧹 Suhbat yangidan boshlandi. Nima haqida gaplashamiz?");
        return;
      case "/qidir":
        if (arg) return this.sendSearch(ctx, arg);
        await this.send(ctx, "Qidiruv so'zini yozing, masalan: <code>/qidir Beruniy</code>");
        return;
      default:
        await this.send(ctx, helpText(this.identity, this.deps.partnerBot));
    }
  }

  private async onCallback(query: TgCallbackQuery): Promise<void> {
    await this.deps.api.call("answerCallbackQuery", { callback_query_id: query.id }).catch(() => {});
    const chat = query.message?.chat;
    if (!chat) return;
    const ctx: ReplyContext = {
      chatId: chat.id,
      isGroup: chat.type === "group" || chat.type === "supergroup",
    };
    const data = query.data ?? "";

    if (data === "rnd") return this.sendCard(ctx, this.deps.service.random());
    if (data.startsWith("e:")) return this.sendEra(ctx, data.slice(2));
    if (data.startsWith("a:")) {
      try {
        return await this.sendCard(ctx, this.deps.service.getBySlug(data.slice(2)));
      } catch {
        await this.send(ctx, "Bu alloma topilmadi.");
      }
    }
  }

  // ---------- Yuborish (reply + limitlar) ----------

  /** Telegram limitlari: guruhga daqiqasiga 20 ta, sekundiga 1 ta. false — yuborilmadi. */
  private async deliver(ctx: ReplyContext, method: string, params: Record<string, unknown>): Promise<boolean> {
    if (ctx.isGroup) {
      const wait = this.guard.reserveGroupSend(ctx.chatId, this.now());
      if (wait < 0) {
        this.log(`[bot] guruh limiti (20/daqiqa) — xabar yuborilmadi chat=${ctx.chatId}`);
        return false;
      }
      if (wait > 0) await this.sleep(wait);
    }
    await this.deps.api.call(method, {
      chat_id: ctx.chatId,
      ...params,
      // Guruhda va botlarga doim reply: sherik bot javobni o'ziga yozilgan deb biladi.
      ...(ctx.replyTo !== undefined
        ? { reply_parameters: { message_id: ctx.replyTo, allow_sending_without_reply: true } }
        : {}),
    });
    return true;
  }

  private async send(ctx: ReplyContext, text: string, buttons?: InlineButton[][]): Promise<boolean> {
    return this.deliver(ctx, "sendMessage", {
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    });
  }

  /** Xato yoki limit haqidagi xabar: odamlarga yuboriladi, botlarga — hech qachon (sikl boshlaydi). */
  private async sendNotice(ctx: ReplyContext, text: string): Promise<boolean> {
    if (ctx.fromBotId !== undefined) return false;
    return this.send(ctx, text);
  }

  private async sendCard(ctx: ReplyContext, a: Alloma): Promise<void> {
    const { siteUrl } = this.deps;
    const buttons: InlineButton[][] = [];
    if (siteUrl) buttons.push([{ text: "🌐 Saytda ochish", url: `${siteUrl}/#/alloma/${a.slug}` }]);
    buttons.push([{ text: "🎲 Yana tasodifiy", callback_data: "rnd" }]);
    const caption = allomaCaption(a);

    if (a.image && siteUrl) {
      try {
        await this.deliver(ctx, "sendPhoto", {
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
    await this.send(ctx, caption, buttons);
  }

  private async sendSearch(ctx: ReplyContext, query: string): Promise<void> {
    const { service } = this.deps;
    let items = service.list({ q: query, sort: "birthYear", page: 1, limit: 10 }).items;
    if (items.length === 0) items = service.findRelevant(query, 8);
    if (items.length === 0) {
      await this.send(ctx, `«${escapeHtml(query)}» bo'yicha hech kim topilmadi. /davrlar orqali ko'rib chiqing.`);
      return;
    }
    await this.send(
      ctx,
      `🔎 «${escapeHtml(query)}» bo'yicha ${items.length} ta natija:`,
      items.map((a) => [{ text: allomaButtonLabel(a), callback_data: `a:${a.slug}` }]),
    );
  }

  private async sendEras(ctx: ReplyContext): Promise<void> {
    const meta = this.deps.service.meta();
    await this.send(
      ctx,
      "Davrni tanlang:",
      meta.eras.map((e) => [{ text: `${e.label} · ${e.period} (${e.count})`, callback_data: `e:${e.id}` }]),
    );
  }

  private async sendEra(ctx: ReplyContext, eraId: string): Promise<void> {
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
      ctx,
      `<b>${escapeHtml(ERA_LABELS[era])}</b> — ${escapeHtml(ERA_PERIODS[era])}\n${items.length} ta alloma:`,
      rows,
    );
  }

  /** Odam so'radi: "Sardor AI'dan X haqida so'ra" — sherik botga @mention bilan savol yuboramiz. */
  private async askPartner(ctx: ReplyContext, topic: string): Promise<void> {
    const partner = this.deps.partnerBot;
    if (!partner) return;
    const question = `@${partner} Salom! ${truncate(topic, 200)} haqida qisqacha aytib bera olasizmi?`;
    // Oddiy matn (HTML emas) — mavzudagi belgilar buzilmasligi uchun.
    const sent = await this.deliver(ctx, "sendMessage", {
      text: question,
      link_preview_options: { is_disabled: true },
    });
    if (sent) this.conversations.append(ctx.chatId, `(so'rov: ${topic})`, question, [], this.now());
  }

  /** AI javobi. true — javob yuborildi. */
  private async answerWithAi(ctx: ReplyContext, question: string, speaker: string): Promise<boolean> {
    const { ai, service, api } = this.deps;
    const fromBot = ctx.fromBotId !== undefined;
    if (!ai) {
      return this.sendNotice(ctx, "AI hozircha ulanmagan. /qidir yoki /davrlar buyruqlaridan foydalaning.");
    }
    if (!fromBot && question.length > MAX_QUESTION_LENGTH) {
      return this.sendNotice(ctx, `Savol juda uzun — ${MAX_QUESTION_LENGTH} belgidan qisqaroq yozing.`);
    }

    const now = this.now();
    if (!fromBot) {
      // Odamlar uchun AI kvotasi cheklovi (botlar uchun — BotGuard'dagi 3 soniyalik qoida).
      const last = this.lastAiRequest.get(ctx.chatId);
      if (last !== undefined && now - last < AI_COOLDOWN_MS) {
        return this.sendNotice(ctx, "⏳ Biroz kuting — keyingi savolni bir necha soniyadan so'ng yuboring.");
      }
      this.lastAiRequest.set(ctx.chatId, now);
    }

    await api.call("sendChatAction", { chat_id: ctx.chatId, action: "typing" }).catch(() => {});

    // Joriy xabarga mos allomalar + suhbatda oldin muhokama qilinganlar ("uning asarlari?" uchun).
    const conversation = this.conversations.get(ctx.chatId, now);
    const relevant = [...service.findRelevant(question, 5)];
    for (const slug of conversation.recentSlugs) {
      if (relevant.length >= 7) break;
      if (relevant.some((a) => a.slug === slug)) continue;
      try {
        relevant.push(service.getBySlug(slug));
      } catch {
        /* alloma o'chirilgan bo'lsa — o'tkazib yuboramiz */
      }
    }

    // Guruhda kim yozganini bildiramiz: "Ism: matn", botlar — "Ism (bot): matn".
    const labeled = ctx.isGroup ? `${speaker}: ${question}` : question;

    let answer: string;
    try {
      answer = stripMarkdown(
        await ai.complete(buildAiMessages(labeled, service.all(), relevant, this.identity, conversation.messages)),
      );
      // Model ba'zan javobni o'z ismi bilan boshlaydi ("Alloma AI: ...") — olib tashlaymiz.
      answer = answer.replace(new RegExp(`^\\s*${this.identity.name}\\s*:\\s*`, "i"), "").trim();
      if (!answer) throw new Error("bo'sh javob");
    } catch (err) {
      this.log(`[bot] AI xato: ${(err as Error).message}`);
      return this.sendNotice(
        ctx,
        "AI xizmati hozir band yoki kunlik bepul limitga yetdi. Birozdan keyin qayta urinib ko'ring yoki /qidir dan foydalaning.",
      );
    }

    // Javobda tilga olingan allomalar uchun tugmalar (botlarga tugma kerak emas).
    const normalizedAnswer = normalizeForSearch(answer);
    const mentioned = relevant
      .filter((a) => {
        const lastWord = normalizeForSearch(a.name).split(" ").at(-1) ?? "";
        return lastWord.length >= 4 && normalizedAnswer.includes(lastWord);
      })
      .slice(0, 3);

    this.conversations.append(
      ctx.chatId,
      labeled,
      answer,
      mentioned.map((a) => a.slug),
      now,
    );

    // AI matni HTML sifatida emas, oddiy matn sifatida yuboriladi (formatlash xatolari bo'lmasligi uchun).
    return this.deliver(ctx, "sendMessage", {
      text: truncate(answer, 4000),
      link_preview_options: { is_disabled: true },
      ...(mentioned.length && !fromBot
        ? {
            reply_markup: {
              inline_keyboard: mentioned.map((a) => [{ text: `📖 ${a.name}`, callback_data: `a:${a.slug}` }]),
            },
          }
        : {}),
    });
  }
}

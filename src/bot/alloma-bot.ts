import { ERA_IDS, ERA_LABELS, ERA_PERIODS, type EraId } from "../../shared/constants.js";
import { formatYears } from "../../shared/format.js";
import type { Alloma } from "../../shared/types.js";
import type { AllomaService } from "../services/alloma.service.js";
import { normalizeForSearch } from "../utils/text.js";
import { BotGuard } from "./bot-guard.js";
import { ConversationStore } from "./conversation.js";
import {
  DISCUSSION_MAX_MS,
  DiscussionManager,
  parseDiscussionRequest,
  typingDelayMs,
} from "./discussion.js";
import {
  allomaButtonLabel,
  allomaCaption,
  buildAiMessages,
  DEFAULT_IDENTITY,
  escapeHtml,
  identityAnswer,
  isIdentityQuestion,
  stripMarkdown,
  codeAnswerToHtml,
  hasCodeBlock,
  truncate,
  type BotIdentity,
  type DiscussionContext,
} from "./format.js";
import type { AiClient } from "./groq.js";
import { addMoodEmoji, extractStickerTag, type StickerMood } from "./stickers.js";
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
  /** Guruhdagi 1 soatlik munozara sessiyalari. */
  discussions?: DiscussionManager;
  /** Odamdek "yozish" kechikishi (testlarda o'chiriladi). */
  humanLikeDelay?: boolean;
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
  { command: "muhokama", description: "Guruhda Sardor AI bilan mavzu muhokamasi (1 soatgacha)" },
  { command: "toxtat", description: "Muhokamani to'xtatish" },
  { command: "yordam", description: "Bot imkoniyatlari" },
];

const helpText = (identity: BotIdentity, partnerBot?: string) =>
  [
    `Salom! Men — <b>${escapeHtml(identity.name)}</b>: barcha fanlar bo'yicha yordamchi va o'zbek allomalari bilimdoni.`,
    "",
    "Istalgan fandan savol bering — matematika, fizika, kimyo, biologiya, tarix, adabiyot, dasturlash, tillar va boshqalar. Oldingi gaplarimizni eslab qolaman. Masalan:",
    "• <i>x² − 5x + 6 = 0 tenglamani yech</i>",
    "• <i>Fotosintez qanday jarayon?</i>",
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
      ? [
          "",
          "<b>Guruhda:</b>",
          `• <i>Sardor AI'dan Beruniy haqida so'ra</i> — @${escapeHtml(partnerBot)} ga savol beraman.`,
          `• <code>/muhokama Ibn Sino tibbiyoti</code> — @${escapeHtml(partnerBot)} bilan shu mavzuda 1 soatgacha munozara.`,
          "• /toxtat — munozarani to'xtatish.",
        ]
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
  private readonly discussions: DiscussionManager;
  private self: BotSelf | undefined;

  constructor(private readonly deps: AllomaBotDeps) {
    this.log = deps.log ?? ((m) => console.log(m));
    this.identity = deps.identity ?? DEFAULT_IDENTITY;
    this.conversations = deps.conversations ?? new ConversationStore();
    this.guard = deps.guard ?? new BotGuard();
    this.discussions = deps.discussions ?? new DiscussionManager();
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

    if (text.startsWith("/")) return this.onCommand(ctx, text, this.speakerLabel(msg));

    const discussionTopic = this.deps.partnerBot && isGroup ? parseDiscussionRequest(text) : undefined;
    if (discussionTopic) return this.startDiscussion(ctx, discussionTopic, this.speakerLabel(msg));

    const partnerTopic = this.deps.partnerBot && isGroup ? parseAskPartner(text) : undefined;
    if (partnerTopic) return this.askPartner(ctx, partnerTopic);

    if (isIdentityQuestion(text)) {
      const answer = identityAnswer(this.identity);
      await this.send(ctx, escapeHtml(answer));
      this.conversations.append(chatId, text, answer, [], this.now());
      return;
    }

    // Reply qilingan xabar matni (bizniki yoki boshqaniki) — savol nima haqidaligini tushunish uchun.
    const replied = msg.reply_to_message;
    const quoted = replied ? (replied.text ?? replied.caption) : undefined;

    // Faqat ism yozilsa — kartochka. Lekin bot oldin savol bergan bo'lsa yoki foydalanuvchi
    // xabarga reply qilgan bo'lsa, bu — suhbatdagi javob: AI kontekst bilan davom ettiradi.
    const exact = this.deps.service.findByName(text);
    if (exact && !quoted && !this.awaitingAnswer(chatId)) return this.sendCard(ctx, exact);
    await this.answerWithAi(ctx, text, this.speakerLabel(msg), { quoted });
  }

  /** Botning oxirgi javobi savol bilan tugaganmi (foydalanuvchi endi unga javob beryapti). */
  private awaitingAnswer(chatId: number): boolean {
    const last = this.conversations.get(chatId, this.now()).messages.at(-1);
    return last?.role === "assistant" && /\?\s*\S{0,3}\s*$/.test(last.content);
  }

  /** Boshqa botdan kelgan, bizga atalgan xabar — sikldan himoya bilan. */
  private async onBotMessage(msg: TgMessage, raw: string): Promise<void> {
    const botId = msg.from?.id ?? 0;
    const chatId = msg.chat.id;

    // Faol munozara sessiyasida sherik botning xabari — alohida (1 soatlik) qoidalar bilan.
    const isPartner =
      Boolean(this.deps.partnerBot) &&
      msg.from?.username?.toLowerCase() === this.deps.partnerBot?.toLowerCase();
    if (isPartner && this.discussions.peek(chatId)) return this.onDiscussionTurn(msg, raw);

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

  private async onCommand(ctx: ReplyContext, text: string, speaker = "Foydalanuvchi"): Promise<void> {
    const [head = "", ...rest] = text.split(/\s+/);
    const command = (head.split("@")[0] ?? "").toLowerCase();
    const arg = rest.join(" ").trim();
    switch (command) {
      case "/muhokama":
        if (ctx.fromBotId !== undefined) return; // munozarani faqat odam boshlaydi
        if (!ctx.isGroup || !this.deps.partnerBot) {
          await this.send(ctx, "Munozara faqat guruhda, sherik bot bilan ishlaydi.");
          return;
        }
        if (!arg) {
          await this.send(ctx, "Mavzuni yozing, masalan: <code>/muhokama Ibn Sino tibbiyoti</code>");
          return;
        }
        return this.startDiscussion(ctx, arg, speaker);
      case "/toxtat":
        if (ctx.fromBotId !== undefined) return;
        return this.stopDiscussion(ctx);
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
    // Kartochka ham suhbat tarixiga yoziladi: keyin "uning asarlari?" deb so'rash mumkin.
    this.conversations.append(
      ctx.chatId,
      `(${a.name} kartochkasi so'raldi)`,
      `${a.name} (${formatYears(a)}) haqida kartochka ko'rsatdim: ${truncate(a.bio, 300)}`,
      [a.slug],
      this.now(),
    );

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

  // ---------- 1 soatlik munozara ----------

  private partnerName(): string {
    return this.deps.partnerBot?.toLowerCase().startsWith("sardor") ? "Sardor AI" : `@${this.deps.partnerBot}`;
  }

  private discussionContext(chatId: number, now: number): DiscussionContext | undefined {
    const s = this.discussions.peek(chatId);
    if (!s) return undefined;
    return {
      topic: s.topic,
      partnerName: this.partnerName(),
      minutesLeft: Math.max(0, Math.round((s.endsAt - now) / 60_000)),
    };
  }

  private async startDiscussion(ctx: ReplyContext, topic: string, speaker: string): Promise<void> {
    const partner = this.deps.partnerBot;
    if (!partner) return;
    const now = this.now();
    const active = this.discussions.get(ctx.chatId, now);
    if (active) {
      await this.send(
        ctx,
        `Hozir «${escapeHtml(active.topic)}» mavzusida munozara ketyapti. Avval /toxtat bilan to'xtating.`,
      );
      return;
    }

    const cleanTopic = truncate(topic.replace(/\s+/g, " ").trim(), 150);
    const session = this.discussions.start(ctx.chatId, cleanTopic, speaker, now);
    this.conversations.reset(ctx.chatId);
    await this.send(
      ctx,
      `🗣 Munozara boshlandi: <b>«${escapeHtml(cleanTopic)}»</b>\n` +
        `Sherik: @${escapeHtml(partner)} · ko'pi bilan ${Math.round(DISCUSSION_MAX_MS / 60_000)} daqiqa. To'xtatish: /toxtat`,
    );

    // Ochilish fikri — AI'dan (bo'lmasa, tayyor matn).
    let opener = `Salom! Keling, «${cleanTopic}» mavzusini muhokama qilaylik. Sizningcha, bu mavzuning eng muhim jihati nimada?`;
    if (this.deps.ai) {
      try {
        const prompt = `(Munozarani sen boshlaysan: ${this.partnerName()}ga salom ber, «${cleanTopic}» haqida o'z fikringni qisqa ayt va uning fikrini so'ra.)`;
        const reply = extractStickerTag(stripMarkdown(
          await this.deps.ai.complete(
            buildAiMessages(
              prompt,
              this.deps.service.all(),
              this.deps.service.findRelevant(cleanTopic, 5),
              this.identity,
              [],
              this.discussionContext(ctx.chatId, now),
            ),
          ),
        )).text.trim();
        if (reply) opener = reply;
      } catch (err) {
        this.log(`[bot] munozara ochilishi AI xato: ${(err as Error).message}`);
      }
    }

    const text = `@${partner} ${truncate(opener, 3500)}`;
    const sent = await this.deliver({ chatId: ctx.chatId, isGroup: ctx.isGroup }, "sendMessage", {
      text,
      link_preview_options: { is_disabled: true },
    });
    if (sent) {
      this.conversations.append(ctx.chatId, `${speaker}: (munozara mavzusi: ${cleanTopic})`, text, [], this.now());
      this.discussions.recordReply(ctx.chatId, this.now());
      this.log(`[bot] munozara boshlandi chat=${ctx.chatId} mavzu=«${session.topic}»`);
    }
  }

  private async stopDiscussion(ctx: ReplyContext): Promise<void> {
    const s = this.discussions.end(ctx.chatId);
    if (!s) {
      await this.send(ctx, "Hozir faol munozara yo'q.");
      return;
    }
    const minutes = Math.max(1, Math.round((this.now() - s.startedAt) / 60_000));
    await this.send(
      ctx,
      `⏹ Munozara to'xtatildi: «${escapeHtml(s.topic)}» — ${minutes} daqiqa, ${s.turns} ta javob.`,
    );
  }

  /** Sherik botning munozaradagi navbatdagi xabari. */
  private async onDiscussionTurn(msg: TgMessage, raw: string): Promise<void> {
    const chatId = msg.chat.id;
    const botId = msg.from?.id ?? 0;
    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
    const ctx: ReplyContext = { chatId, isGroup, replyTo: msg.message_id, fromBotId: botId };

    const turn = this.discussions.nextTurn(chatId, this.now());
    if (!turn) return;
    if (turn.status === "finished") {
      // Vaqt yoki javoblar soni tugadi — bir marta xayrlashib, sessiyani yopamiz.
      this.discussions.end(chatId);
      await this.deliver(ctx, "sendMessage", {
        text: `Vaqtimiz tugadi — «${turn.session.topic}» bo'yicha ajoyib suhbat bo'ldi, rahmat! 🙏`,
      });
      this.log(`[bot] munozara tugadi (${turn.reason}) chat=${chatId}, ${turn.session.turns} ta javob`);
      return;
    }

    // Takroriy matnlar sessiyada ham bloklanadi (sikl belgisi).
    const decision = this.guard.checkBotMessage(chatId, botId, raw, this.now(), { ignoreTurnLimit: true });
    if (!decision.allow) {
      this.log(`[bot] munozarada bot xabari o'tkazildi (${decision.reason}) chat=${chatId}`);
      return;
    }

    const wait = Math.max(turn.waitMs, decision.waitMs);
    const text = truncate(this.stripOwnMention(raw), MAX_BOT_INPUT_LENGTH);
    const sent = await this.answerWithAi(ctx, text, this.speakerLabel(msg), {
      discussion: this.discussionContext(chatId, this.now()),
      minWaitMs: wait,
    });
    if (sent) {
      this.discussions.recordReply(chatId, this.now());
      this.guard.recordBotReply(chatId, botId, this.now());
    }
  }

  /** Odamdek kutish: "yozmoqda…" holatini har 4.5 soniyada yangilab turadi. */
  private async typeFor(chatId: number, ms: number): Promise<void> {
    let left = ms;
    while (left > 0) {
      await this.deps.api.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
      const step = Math.min(4_500, left);
      await this.sleep(step);
      left -= step;
    }
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
  private async answerWithAi(
    ctx: ReplyContext,
    question: string,
    speaker: string,
    options: { discussion?: DiscussionContext | undefined; minWaitMs?: number; quoted?: string | undefined } = {},
  ): Promise<boolean> {
    const startedAt = this.now();
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
      // Tez yozilgan javob yo'qolmasin: navbatga qo'yib, oz kutib javob beramiz.
      // Faqat ketma-ket juda ko'p xabar (3+ navbatda) bo'lsa — rad etamiz.
      const last = this.lastAiRequest.get(ctx.chatId);
      const slot = last === undefined ? now : Math.max(now, last + AI_COOLDOWN_MS);
      if (slot - now > AI_COOLDOWN_MS) {
        return this.sendNotice(ctx, "⏳ Biroz kuting — oldingi savollaringizga javob tayyorlanmoqda.");
      }
      this.lastAiRequest.set(ctx.chatId, slot);
      if (slot > now) await this.sleep(slot - now);
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
    // Foydalanuvchi aniq bir xabarga reply qilgan bo'lsa (va u tarixda bo'lmasa — masalan, server
    // qayta ishga tushgandan keyin), o'sha xabarni ham AI'ga ko'rsatamiz.
    const quoted = options.quoted?.trim();
    const quotedInHistory =
      quoted !== undefined &&
      conversation.messages.some((m) => m.content.includes(quoted.slice(0, 120)));
    const aiQuestion =
      quoted && !quotedInHistory
        ? `(Bu xabar quyidagi xabarga javob: «${truncate(quoted, 1200)}»)\n${labeled}`
        : labeled;

    let answer: string;
    let mood: StickerMood | undefined;
    try {
      answer = stripMarkdown(
        await ai.complete(
          buildAiMessages(aiQuestion, service.all(), relevant, this.identity, conversation.messages, options.discussion),
        ),
      );
      const tagged = extractStickerTag(answer);
      answer = tagged.text;
      mood = tagged.mood;
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
      aiQuestion,
      answer,
      mentioned.map((a) => a.slug),
      now,
    );

    // Munozarada odamdek sur'at: javob uzunligiga qarab "yozish" va kamida minWaitMs oraliq.
    if (options.discussion) {
      const elapsed = this.now() - startedAt;
      const typing = this.deps.humanLikeDelay === false ? 0 : typingDelayMs(answer);
      const delay = Math.max(typing, options.minWaitMs ?? 0) - elapsed;
      if (delay > 0) await this.typeFor(ctx.chatId, delay);
    } else if (options.minWaitMs && options.minWaitMs > 0) {
      await this.sleep(options.minWaitMs);
    }

    // AI matni oddiy matn sifatida yuboriladi (formatlash xatolari bo'lmasligi uchun);
    // kod bo'lsa — HTML <pre> bloklari bilan (hammasi escape qilingan).
    // Hissiyot/imo-ishora bo'lsa — oxiriga bitta kichik emoji (botlarga va munozarada — yo'q).
    const decorated = mood && !fromBot && !options.discussion ? addMoodEmoji(answer, mood) : answer;
    const body = truncate(decorated, 4000);
    const sent = await this.deliver(ctx, "sendMessage", {
      ...(hasCodeBlock(body) ? { text: codeAnswerToHtml(body), parse_mode: "HTML" } : { text: body }),
      link_preview_options: { is_disabled: true },
      ...(mentioned.length && !fromBot
        ? {
            reply_markup: {
              inline_keyboard: mentioned.map((a) => [{ text: `📖 ${a.name}`, callback_data: `a:${a.slug}` }]),
            },
          }
        : {}),
    });
    return sent;
  }
}

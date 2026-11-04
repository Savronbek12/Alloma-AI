import { describe, expect, it } from "vitest";
import { AllomaBot, parseAskPartner } from "../src/bot/alloma-bot.js";
import { BotGuard, GROUP_MESSAGES_PER_MINUTE, MAX_BOT_TURNS } from "../src/bot/bot-guard.js";
import { AiError, type AiClient, type ChatMessage } from "../src/bot/groq.js";
import type { BotApi, TgMessage, TgUpdate } from "../src/bot/telegram-api.js";
import { createContainer } from "../src/container.js";

const service = createContainer().allomaService;
const SELF = { id: 1000, username: "AllomaAI_bot" };
const SARDOR = { id: 2000, first_name: "Sardor AI", username: "sardorbai202bot", is_bot: true };
const HUMAN = { id: 3000, first_name: "Savronbek", is_bot: false };
const GROUP = { id: -500, type: "supergroup" };

class FakeApi implements BotApi {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    return true as T;
  }
  messages() {
    return this.calls.filter((c) => c.method === "sendMessage" || c.method === "sendPhoto");
  }
}

class FakeAi implements AiClient {
  calls: ChatMessage[][] = [];
  constructor(private readonly reply: string | Error = "Beruniy Xorazmda tug'ilgan. Sizningcha, uning eng muhim asari qaysi?") {}
  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    if (this.reply instanceof Error) throw this.reply;
    return `${this.reply} #${this.calls.length}`;
  }
}

let nextId = 1;
const message = (from: TgMessage["from"], text: string, replyTo?: TgMessage): TgUpdate => ({
  update_id: nextId,
  message: { message_id: nextId++, chat: GROUP, from, text, ...(replyTo ? { reply_to_message: replyTo } : {}) },
});
/** Bizning bot yuborgan xabar (Sardor AI shunga reply qiladi). */
const ourMessage = (): TgMessage => ({ message_id: nextId++, chat: GROUP, from: { id: SELF.id, first_name: "Alloma AI", is_bot: true }, text: "..." });

function setup(ai: AiClient = new FakeAi()) {
  let t = 1_000_000;
  const api = new FakeApi();
  const sleeps: number[] = [];
  const guard = new BotGuard();
  const bot = new AllomaBot({
    api,
    service,
    ai,
    self: SELF,
    partnerBot: "sardorbai202bot",
    guard,
    log: () => {},
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  });
  return { api, bot, guard, sleeps, tick: (ms: number) => (t += ms) };
}

describe("Guruh: kimga javob beriladi", () => {
  it("o'z xabarlarimizga hech qachon javob bermaydi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(message({ id: SELF.id, first_name: "Alloma AI", is_bot: true }, "@AllomaAI_bot salom"));
    expect(api.messages()).toHaveLength(0);
  });

  it("bizga atalmagan bot xabarini e'tiborsiz qoldiradi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(message(SARDOR, "Beruniy haqida gapiraylik"));
    expect(api.messages()).toHaveLength(0);
  });

  it("bot bizning xabarimizga reply qilsa — javobni reply qilib yuboradi (tugmasiz)", async () => {
    const { api, bot } = setup();
    const upd = message(SARDOR, "Beruniy qayerda tug'ilgan?", ourMessage());
    await bot.handleUpdate(upd);
    const sent = api.messages()[0];
    expect(sent?.params.reply_parameters).toEqual({ message_id: upd.message?.message_id, allow_sending_without_reply: true });
    expect(sent?.params.reply_markup).toBeUndefined();
  });

  it("bot @username'imizni yozsa — javob beradi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(message(SARDOR, "@AllomaAI_bot Navoiy haqida nima bilasiz?"));
    expect(api.messages()).toHaveLength(1);
  });

  it("guruhda odam botga murojaat qilmasa — jim turadi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(message(HUMAN, "Bugun havo yaxshi"));
    expect(api.messages()).toHaveLength(0);
  });

  it("guruhda odam @mention, ism yoki reply bilan murojaat qilsa — reply bilan javob beradi", async () => {
    const { api, bot, tick } = setup();
    await bot.handleUpdate(message(HUMAN, "@AllomaAI_bot isming nima?"));
    expect(api.messages()[0]?.params.text).toBe("Mening ismim Alloma AI, meni Savronbek yaratgan.");
    expect(api.messages()[0]?.params.reply_parameters).toBeDefined();
    tick(10_000);
    await bot.handleUpdate(message(HUMAN, "Alloma AI, Navoiy qayerda tug'ilgan?"));
    tick(10_000);
    await bot.handleUpdate(message(HUMAN, "Uning asarlari-chi?", ourMessage()));
    expect(api.messages()).toHaveLength(3);
  });

  it("boshqa botga atalgan buyruqni (/start@sardorbai202bot) e'tiborsiz qoldiradi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(message(HUMAN, "/start@sardorbai202bot"));
    expect(api.messages()).toHaveLength(0);
    await bot.handleUpdate(message(HUMAN, "/start@AllomaAI_bot"));
    expect(api.messages()).toHaveLength(1);
  });
});

describe("Bot-bot sikliga qarshi himoya", () => {
  it(`odam yozmaguncha botga ketma-ket ko'pi bilan ${MAX_BOT_TURNS} ta javob; odam yozsa hisob nolga tushadi`, async () => {
    const { api, bot, tick } = setup();
    for (let i = 0; i < MAX_BOT_TURNS + 2; i++) {
      await bot.handleUpdate(message(SARDOR, `Savol raqami ${i}`, ourMessage()));
      tick(5_000);
    }
    expect(api.messages()).toHaveLength(MAX_BOT_TURNS);

    await bot.handleUpdate(message(HUMAN, "Davom etinglar"));
    await bot.handleUpdate(message(SARDOR, "Yana bir savol", ourMessage()));
    expect(api.messages()).toHaveLength(MAX_BOT_TURNS + 1);
  });

  it("bitta botga 3 soniyada ko'pi bilan 1 ta javob (tez kelsa — kutib javob beradi)", async () => {
    const { bot, sleeps, tick } = setup();
    await bot.handleUpdate(message(SARDOR, "Birinchi savol", ourMessage()));
    tick(1_000);
    await bot.handleUpdate(message(SARDOR, "Ikkinchi savol", ourMessage()));
    expect(sleeps.some((ms) => ms >= 1_900 && ms <= 3_000)).toBe(true);
  });

  it("bot 10 daqiqa ichida bir xil matnni takrorlasa — javob bermaydi", async () => {
    const { api, bot, tick } = setup();
    await bot.handleUpdate(message(SARDOR, "Beruniy haqida gapiring", ourMessage()));
    tick(60_000);
    await bot.handleUpdate(message(SARDOR, "  beruniy HAQIDA gapiring ", ourMessage()));
    expect(api.messages()).toHaveLength(1);
    tick(11 * 60_000);
    await bot.handleUpdate(message(HUMAN, "Yana"));
    await bot.handleUpdate(message(SARDOR, "Beruniy haqida gapiring", ourMessage()));
    expect(api.messages()).toHaveLength(2);
  });

  it("botga xato yoki limit xabarlari yuborilmaydi — jim turadi", async () => {
    const { api, bot } = setup(new FakeAi(new AiError(429, "rate limit")));
    await bot.handleUpdate(message(SARDOR, "Beruniy kim?", ourMessage()));
    expect(api.messages()).toHaveLength(0);
  });

  it("odamga esa xato haqida xabar beriladi", async () => {
    const { api, bot } = setup(new FakeAi(new AiError(429, "rate limit")));
    await bot.handleUpdate(message(HUMAN, "@AllomaAI_bot Beruniy kim?"));
    expect(String(api.messages()[0]?.params.text)).toContain("limit");
  });
});

describe("Sardor AI bilan suhbatni boshlash", () => {
  it("«Sardor AI'dan X haqida so'ra» — @sardorbai202bot bilan boshlanadigan savol yuboradi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(message(HUMAN, "@AllomaAI_bot Sardor AI'dan Ibn Sino haqida so'ra"));
    const text = String(api.messages()[0]?.params.text);
    expect(text.startsWith("@sardorbai202bot")).toBe(true);
    expect(text).toContain("Ibn Sino");
  });

  it("Sardor AI javobi AI'ga «Ism (bot): matn» ko'rinishida, tarix bilan uzatiladi", async () => {
    const ai = new FakeAi();
    const { bot, tick } = setup(ai);
    await bot.handleUpdate(message(HUMAN, "@AllomaAI_bot Sardor AI'dan Ibn Sino haqida so'ra"));
    tick(5_000);
    await bot.handleUpdate(message(SARDOR, "Ibn Sino buyuk tabib edi. Siz u haqda nima bilasiz?", ourMessage()));
    const msgs = ai.calls[0] ?? [];
    expect(msgs.at(-1)?.content).toBe("Sardor AI (bot): Ibn Sino buyuk tabib edi. Siz u haqda nima bilasiz?");
    expect(msgs.some((m) => m.role === "assistant" && m.content.startsWith("@sardorbai202bot"))).toBe(true);
  });

  it("parseAskPartner turli yozuvlarni taniydi", () => {
    expect(parseAskPartner("Sardor AI'dan Beruniy haqida so'ra")).toBe("Beruniy");
    expect(parseAskPartner("sardor aidan algebra tarixi haqida soʻrab ber")).toBe("algebra tarixi");
    expect(parseAskPartner("Sardor AI’dan Navoiy so'ra")).toBe("Navoiy");
    expect(parseAskPartner("Navoiy haqida so'ra")).toBeUndefined();
  });
});

describe("BotGuard limitlari", () => {
  it(`guruhga daqiqasiga ko'pi bilan ${GROUP_MESSAGES_PER_MINUTE} ta xabar, sekundiga 1 ta`, () => {
    const guard = new BotGuard();
    let now = 0;
    const waits: number[] = [];
    for (let i = 0; i < GROUP_MESSAGES_PER_MINUTE; i++) waits.push(guard.reserveGroupSend(-1, now));
    expect(waits[0]).toBe(0);
    expect(waits[1]).toBe(1000);
    expect(guard.reserveGroupSend(-1, now)).toBe(-1);
    now += 61_000 + GROUP_MESSAGES_PER_MINUTE * 1000;
    expect(guard.reserveGroupSend(-1, now)).toBe(0);
  });

  it("xotira cheksiz o'smaydi (eng ko'pi N ta chat)", () => {
    const guard = new BotGuard(3);
    for (let chat = 1; chat <= 10; chat++) guard.checkBotMessage(chat, 1, "x", 0);
    expect(guard.size).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import { AllomaBot } from "../src/bot/alloma-bot.js";
import { BotGuard, MAX_BOT_TURNS } from "../src/bot/bot-guard.js";
import {
  DISCUSSION_MAX_MS,
  DISCUSSION_MAX_TURNS,
  DISCUSSION_MIN_GAP_MS,
  parseDiscussionRequest,
  typingDelayMs,
} from "../src/bot/discussion.js";
import type { AiClient, ChatMessage } from "../src/bot/groq.js";
import type { BotApi, TgMessage, TgUpdate } from "../src/bot/telegram-api.js";
import { createContainer } from "../src/container.js";

const service = createContainer().allomaService;
const SELF = { id: 1000, username: "AllomaAI_bot" };
const SARDOR = { id: 2000, first_name: "Sardor AI", username: "sardorbai202bot", is_bot: true };
const OTHER_BOT = { id: 2500, first_name: "Boshqa", username: "boshqa_bot", is_bot: true };
const HUMAN = { id: 3000, first_name: "Savronbek", is_bot: false };
const GROUP = { id: -700, type: "supergroup" };

class FakeApi implements BotApi {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    return true as T;
  }
  texts(): string[] {
    return this.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.params.text));
  }
}

class CountingAi implements AiClient {
  calls: ChatMessage[][] = [];
  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    return `Fikrim: bu mavzuda ${this.calls.length}-jihat muhim. Siz nima deysiz?`;
  }
}

let nextId = 1;
const msg = (from: TgMessage["from"], text: string, replyTo?: TgMessage): TgUpdate => ({
  update_id: nextId,
  message: { message_id: nextId++, chat: GROUP, from, text, ...(replyTo ? { reply_to_message: replyTo } : {}) },
});
const ours = (): TgMessage => ({
  message_id: nextId++,
  chat: GROUP,
  from: { id: SELF.id, first_name: "Alloma AI", is_bot: true },
  text: "…",
});

function setup() {
  let t = 5_000_000;
  const api = new FakeApi();
  const ai = new CountingAi();
  const sleeps: number[] = [];
  const bot = new AllomaBot({
    api,
    service,
    ai,
    self: SELF,
    partnerBot: "sardorbai202bot",
    guard: new BotGuard(),
    humanLikeDelay: false,
    log: () => {},
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
  });
  return { api, ai, bot, sleeps, tick: (ms: number) => (t += ms) };
}

describe("1 soatlik munozara", () => {
  it("/muhokama sessiya ochadi va Sardor AI'ga @mention bilan birinchi fikrni yuboradi", async () => {
    const { api, ai, bot } = setup();
    await bot.handleUpdate(msg(HUMAN, "/muhokama Ibn Sino tibbiyoti"));
    const texts = api.texts();
    expect(texts[0]).toContain("Munozara boshlandi");
    expect(texts[0]).toContain("Ibn Sino tibbiyoti");
    expect(texts[1]?.startsWith("@sardorbai202bot ")).toBe(true);
    // Ochilish fikri munozara rejimida so'raladi.
    expect(ai.calls[0]?.[0]?.content).toContain("MUNOZARA REJIMI");
    expect(ai.calls[0]?.[0]?.content).toContain("«Ibn Sino tibbiyoti»");
  });

  it("matnli so'rov ham ishlaydi: «Sardor AI bilan X haqida muhokama qil»", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(msg(HUMAN, "@AllomaAI_bot Sardor AI bilan Navoiy ijodi haqida muhokama qil"));
    expect(api.texts()[0]).toContain("Navoiy ijodi");
  });

  it(`sessiyada odam yozmasa ham ${MAX_BOT_TURNS} tadan ko'p javob beradi, har biri ≥ 20 s oraliq bilan`, async () => {
    const { api, bot, sleeps, tick } = setup();
    await bot.handleUpdate(msg(HUMAN, "/muhokama Beruniy geodeziyasi"));
    const before = api.texts().length;
    for (let i = 0; i < 10; i++) {
      tick(2_000); // Sardor AI tez javob beradi — bizniki odamdek kutadi
      await bot.handleUpdate(msg(SARDOR, `Mening fikrim raqam ${i}: bu juda qiziq.`, ours()));
    }
    expect(api.texts().length - before).toBe(10);
    expect(sleeps.filter((ms) => ms > 0).length).toBeGreaterThanOrEqual(10);
    // Barcha kutishlar yig'indisi: har bir javob oldingisidan kamida 20 s keyin.
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10 * (DISCUSSION_MIN_GAP_MS - 2_000));
  });

  it("munozara javoblari mavzu va qolgan vaqt bilan AI'ga beriladi", async () => {
    const { ai, bot, tick } = setup();
    await bot.handleUpdate(msg(HUMAN, "/muhokama Ulug'bek rasadxonasi"));
    tick(30_000);
    await bot.handleUpdate(msg(SARDOR, "Rasadxona o'z davrining eng yirigi edi.", ours()));
    const system = ai.calls.at(-1)?.[0]?.content ?? "";
    expect(system).toContain("«Ulug'bek rasadxonasi»");
    expect(system).toMatch(/qolgan vaqt: ~\d+ daqiqa/);
    expect(system).toContain("GURUHDAGI ILMIY SUHBAT");
    expect(system).toContain("Hozirgi suhbat vaqti: 1-daqiqa");
    expect(system).toContain("0–5 daqiqa");
    expect(ai.calls.at(-1)?.at(-1)?.content).toBe("Sardor AI (bot): Rasadxona o'z davrining eng yirigi edi.");
  });

  it("1 soat tugagach bir marta xayrlashadi va keyin jim turadi", async () => {
    const { api, bot, tick } = setup();
    await bot.handleUpdate(msg(HUMAN, "/muhokama Bobur"));
    tick(DISCUSSION_MAX_MS + 1_000);
    await bot.handleUpdate(msg(SARDOR, "Yana bir fikr...", ours()));
    expect(api.texts().at(-1)).toContain("Vaqtimiz tugadi");
    const count = api.texts().length;
    tick(30_000);
    await bot.handleUpdate(msg(SARDOR, "Hali ham shu yerdamisiz?", ours()));
    // Sessiya yopildi: endi oddiy rejim (odam yozmaguncha 4 ta javob chegarasi) ishlaydi —
    // xayrlashuv takrorlanmaydi, bitta oddiy javob beriladi.
    expect(api.texts().length).toBe(count + 1);
    expect(api.texts().filter((t) => t.includes("Vaqtimiz tugadi"))).toHaveLength(1);
  });

  it("/toxtat sessiyani darhol to'xtatadi", async () => {
    const { api, bot, tick } = setup();
    await bot.handleUpdate(msg(HUMAN, "/muhokama Fitrat"));
    tick(30_000);
    await bot.handleUpdate(msg(HUMAN, "/toxtat"));
    expect(api.texts().at(-1)).toContain("Munozara to'xtatildi");
  });

  it("munozara faqat sherik bot bilan: boshqa botlar uchun 4 ta cheklov qoladi", async () => {
    const { api, bot, tick } = setup();
    await bot.handleUpdate(msg(HUMAN, "/muhokama Muqimiy"));
    const before = api.texts().length;
    for (let i = 0; i < MAX_BOT_TURNS + 3; i++) {
      tick(10_000);
      await bot.handleUpdate(msg(OTHER_BOT, `@AllomaAI_bot savol ${i}`));
    }
    expect(api.texts().length - before).toBe(MAX_BOT_TURNS);
  });

  it("sessiyada ham takroriy matnga javob berilmaydi", async () => {
    const { api, bot, tick } = setup();
    await bot.handleUpdate(msg(HUMAN, "/muhokama Avloniy"));
    const before = api.texts().length;
    tick(30_000);
    await bot.handleUpdate(msg(SARDOR, "Bir xil gap", ours()));
    tick(30_000);
    await bot.handleUpdate(msg(SARDOR, "Bir xil gap", ours()));
    expect(api.texts().length - before).toBe(1);
  });

  it("munozarani bot boshlay olmaydi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(msg(SARDOR, "/muhokama@AllomaAI_bot cheksiz mavzu"));
    expect(api.texts()).toHaveLength(0);
  });

  it(`javoblar soni ${DISCUSSION_MAX_TURNS} ta bilan cheklangan`, () => {
    expect(DISCUSSION_MAX_TURNS).toBeLessThanOrEqual(80);
    expect(DISCUSSION_MAX_MS).toBe(60 * 60_000);
  });
});

describe("Yordamchi funksiyalar", () => {
  it("parseDiscussionRequest", () => {
    expect(parseDiscussionRequest("Sardor AI bilan Beruniy haqida muhokama qil")).toBe("Beruniy");
    expect(parseDiscussionRequest("sardor ai bilan sun'iy intellekt mavzusida bahslashing")).toBe("sun'iy intellekt");
    expect(parseDiscussionRequest("Beruniy haqida gapir")).toBeUndefined();
  });

  it("typingDelayMs uzunlikka qarab 6–27 s", () => {
    expect(typingDelayMs("Ha.", 0)).toBe(6_000);
    expect(typingDelayMs("x".repeat(2000), 0)).toBe(25_000);
    expect(typingDelayMs("x".repeat(200), 1)).toBe(5_000 + 200 * 45 + 2_000);
  });
});

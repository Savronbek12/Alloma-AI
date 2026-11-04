import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AllomaBot } from "../src/bot/alloma-bot.js";
import type { AiClient, ChatMessage } from "../src/bot/groq.js";
import { createMiniAppChatHandler, MINIAPP_COOLDOWN_MS, verifyInitData } from "../src/bot/miniapp.js";
import { SUBJECTS_BUTTON } from "../src/bot/subjects.js";
import type { BotApi, TgUpdate } from "../src/bot/telegram-api.js";
import { createContainer } from "../src/container.js";

const TOKEN = "123456:TEST-token-for-miniapp-signature-xx";
const service = createContainer().allomaService;
const NOW = 1_800_000_000;

/** Telegram qanday imzolasa, shunday imzolangan initData. */
function signInitData(fields: Record<string, string>, token = TOKEN): string {
  const check = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const validInit = (authDate = NOW) =>
  signInitData({ auth_date: String(authDate), query_id: "AAE", user: JSON.stringify({ id: 42, first_name: "Ali" }) });

describe("verifyInitData", () => {
  it("to'g'ri imzoni qabul qiladi", () => {
    expect(verifyInitData(validInit(), TOKEN, NOW)?.id).toBe(42);
  });

  it("boshqa token, o'zgartirilgan maydon va eski sanani rad etadi", () => {
    expect(verifyInitData(validInit(), "999:other-token-aaaaaaaaaaaaaaaaaaaaaaaa", NOW)).toBeUndefined();
    const tampered = validInit().replace("Ali", "Vali");
    expect(verifyInitData(tampered, TOKEN, NOW)).toBeUndefined();
    expect(verifyInitData(validInit(NOW - 2 * 86400), TOKEN, NOW)).toBeUndefined();
    expect(verifyInitData("user=1", TOKEN, NOW)).toBeUndefined();
  });
});

class EchoAi implements AiClient {
  calls: ChatMessage[][] = [];
  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    return "Javob tayyor. [stiker:xursand]";
  }
}

function setup(ai: AiClient | null = new EchoAi()) {
  let now = NOW * 1000;
  const app = express();
  app.use(express.json());
  app.post(
    "/chat",
    createMiniAppChatHandler({ botToken: TOKEN, service, ai: ai ?? undefined, now: () => now, log: () => {} }),
  );
  return { app, advance: (ms: number) => (now += ms) };
}

const ask = (messages: ChatMessage[], subject = "fiz", initData = validInit()) => ({ initData, subject, messages });

describe("POST /api/miniapp/chat", () => {
  it("fan kontekstida javob beradi va tarixni AI'ga uzatadi", async () => {
    const ai = new EchoAi();
    const { app } = setup(ai);
    const res = await request(app)
      .post("/chat")
      .send(
        ask([
          { role: "user", content: "Nyuton qonunlari" },
          { role: "assistant", content: "Uchta qonun bor." },
          { role: "user", content: "Ikkinchisini tushuntir" },
        ]),
      )
      .expect(200);
    expect(res.body.answer).toContain("Javob tayyor.");
    expect(res.body.answer).not.toContain("[stiker");
    const sent = ai.calls[0] ?? [];
    expect(sent[0]?.content).toContain("«Fizika» fanini tanlagan");
    expect(sent.map((m) => m.content)).toContain("Uchta qonun bor.");
    expect(sent.at(-1)).toEqual({ role: "user", content: "Ikkinchisini tushuntir" });
  });

  it("imzosiz yoki noto'g'ri so'rovlarni rad etadi", async () => {
    const { app } = setup();
    await request(app).post("/chat").send(ask([{ role: "user", content: "salom" }], "fiz", "hash=00")).expect(401);
    await request(app).post("/chat").send(ask([{ role: "user", content: "salom" }], "yoq")).expect(400);
    await request(app).post("/chat").send(ask([{ role: "assistant", content: "salom" }])).expect(400);
    await request(app).post("/chat").send({}).expect(400);
  });

  it("bitta foydalanuvchi juda tez yozsa — 429", async () => {
    const { app, advance } = setup();
    const body = ask([{ role: "user", content: "Tok nima?" }]);
    await request(app).post("/chat").send(body).expect(200);
    await request(app).post("/chat").send(body).expect(429);
    advance(MINIAPP_COOLDOWN_MS);
    await request(app).post("/chat").send(body).expect(200);
  });

  it("AI ulanmagan bo'lsa — 503", async () => {
    const { app } = setup(null);
    await request(app).post("/chat").send(ask([{ role: "user", content: "Tok nima?" }])).expect(503);
  });
});

describe("Mini App sahifasi", () => {
  it("/app/ ochiladi va Telegram ichida (SDK + iframe) ishlashga ruxsat bor", async () => {
    const res = await request(createApp(createContainer())).get("/app/").expect(200);
    expect(res.text).toContain("telegram-web-app.js");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("https://telegram.org");
    expect(csp).toContain("frame-ancestors 'self' https://web.telegram.org");
    expect(res.headers["x-frame-options"]).toBeUndefined();
  });
});

class FakeApi implements BotApi {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    return true as T;
  }
  last() {
    return this.calls.filter((c) => c.method === "sendMessage").at(-1)?.params;
  }
}

const URL = "https://alloma.example/app/";
const msg = (text: string, type = "private"): TgUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: 5, type }, from: { id: 1, first_name: "Ali" }, text },
});

describe("Bot: Mini App tugmalari", () => {
  const bot = (api: FakeApi) => new AllomaBot({ api, service, miniAppUrl: URL, log: () => {}, sleep: async () => {} });

  it("/start — «📚 Fanlar» pastki tugmasi Mini App'ni ochadi", async () => {
    const api = new FakeApi();
    await bot(api).handleUpdate(msg("/start"));
    const keyboard = (api.last()?.reply_markup as { keyboard: { text: string; web_app?: { url: string } }[][] }).keyboard;
    expect(keyboard[0]?.[0]).toEqual({ text: SUBJECTS_BUTTON, web_app: { url: URL } });
  });

  it("shaxsiy chatda /fanlar — Mini App tugmasi", async () => {
    const api = new FakeApi();
    await bot(api).handleUpdate(msg("/fanlar"));
    const buttons = (api.last()?.reply_markup as { inline_keyboard: { web_app?: { url: string } }[][] }).inline_keyboard;
    expect(buttons.flat()).toHaveLength(1);
    expect(buttons[0]?.[0]?.web_app).toEqual({ url: URL });
  });

  it("guruhda /fanlar — oddiy 15 ta tugma (web_app guruhda ishlamaydi)", async () => {
    const api = new FakeApi();
    await bot(api).handleUpdate(msg("/fanlar", "group"));
    const buttons = (api.last()?.reply_markup as { inline_keyboard: { callback_data?: string }[][] }).inline_keyboard;
    expect(buttons.flat()).toHaveLength(15);
  });
});

import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AI_COOLDOWN_MS, AllomaBot } from "../src/bot/alloma-bot.js";
import { allomaCaption, stripMarkdown } from "../src/bot/format.js";
import { AiError, GroqClient, type AiClient, type ChatMessage } from "../src/bot/groq.js";
import { createTelegramRuntime, createWebhookHandler } from "../src/bot/index.js";
import type { BotApi, TgUpdate } from "../src/bot/telegram-api.js";
import { createContainer } from "../src/container.js";

const service = createContainer().allomaService;
const SITE = "https://alloma-ai.onrender.com";

class FakeApi implements BotApi {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  failMethods = new Set<string>();
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    if (this.failMethods.has(method)) throw new Error(`${method} failed`);
    return true as T;
  }
  sent(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
  lastText(): string {
    const msg = this.sent("sendMessage").at(-1);
    return String(msg?.params.text ?? "");
  }
}

class FakeAi implements AiClient {
  messages: ChatMessage[][] = [];
  constructor(private readonly reply: string | Error = "Algebrani Muhammad ibn Muso al-Xorazmiy asoslagan.") {}
  async complete(messages: ChatMessage[]): Promise<string> {
    this.messages.push(messages);
    if (this.reply instanceof Error) throw this.reply;
    return this.reply;
  }
}

const text = (t: string, chatId = 1): TgUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type: "private" }, text: t },
});

function setup(opts: { ai?: AiClient; now?: () => number } = {}) {
  const api = new FakeApi();
  const bot = new AllomaBot({ api, service, ai: opts.ai, siteUrl: SITE, log: () => {}, now: opts.now });
  return { api, bot };
}

describe("AllomaBot buyruqlari", () => {
  it("/start yordam matnini yuboradi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(text("/start"));
    expect(api.lastText()).toContain("/tasodifiy");
    expect(api.sent("sendMessage")[0]?.params.parse_mode).toBe("HTML");
  });

  it("ism yozilsa — rasmli kartochka (sendPhoto) yuboradi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(text("Beruniy"));
    const photo = api.sent("sendPhoto")[0];
    expect(photo?.params.photo).toBe(`${SITE}/images/allomalar/abu-rayhon-beruniy.jpg`);
    expect(String(photo?.params.caption)).toContain("<b>Abu Rayhon Beruniy</b>");
    expect(String(photo?.params.caption).length).toBeLessThanOrEqual(1024);
  });

  it("sendPhoto xato bersa — matnli kartochkaga qaytadi", async () => {
    const { api, bot } = setup();
    api.failMethods.add("sendPhoto");
    await bot.handleUpdate(text("Beruniy"));
    expect(api.lastText()).toContain("Abu Rayhon Beruniy");
  });

  it("/qidir natijalarni tugmalar bilan qaytaradi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(text("/qidir Boburnoma"));
    const msg = api.sent("sendMessage")[0];
    const keyboard = (msg?.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard;
    expect(keyboard.flat().map((b) => b.callback_data)).toContain("a:zahiriddin-muhammad-bobur");
  });

  it("/davrlar va davr tugmasi allomalar ro'yxatini beradi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(text("/davrlar"));
    expect(api.lastText()).toContain("Davrni tanlang");
    await bot.handleUpdate({
      update_id: 2,
      callback_query: { id: "q1", from: { id: 1, first_name: "A" }, message: { message_id: 2, chat: { id: 1, type: "private" } }, data: "e:jadidlar" },
    });
    expect(api.sent("answerCallbackQuery")).toHaveLength(1);
    expect(api.lastText()).toContain("Jadidlar davri");
  });

  it("noto'g'ri slug'li tugma — tushunarli xabar", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate({
      update_id: 3,
      callback_query: { id: "q2", from: { id: 1, first_name: "A" }, message: { message_id: 3, chat: { id: 1, type: "private" } }, data: "a:mavjud-emas" },
    });
    expect(api.lastText()).toContain("topilmadi");
  });
});

describe("AllomaBot o'zini tanishtirishi", () => {
  const questions = [
    "Isming nima?",
    "ismingiz nima",
    "Sen kimsan?",
    "Seni kim yaratgan?",
    "Kim seni yaratgan?",
    "Как тебя зовут?",
    "Кто тебя создал?",
    "What is your name?",
    "Who made you?",
  ];

  it.each(questions)("«%s» — AI'siz: 'Mening ismim Alloma AI, meni Savronbek yaratgan.'", async (q) => {
    const ai = new FakeAi();
    const { api, bot } = setup({ ai });
    await bot.handleUpdate(text(q));
    expect(api.lastText()).toBe("Mening ismim Alloma AI, meni Savronbek yaratgan.");
    expect(ai.messages).toHaveLength(0);
  });

  it("oddiy savollar ism savoli deb hisoblanmaydi", async () => {
    const ai = new FakeAi();
    const { bot } = setup({ ai });
    await bot.handleUpdate(text("Navoiyning asarlari qaysilar?"));
    expect(ai.messages).toHaveLength(1);
  });

  it("AI ko'rsatmasida ism va yaratuvchi bor", async () => {
    const ai = new FakeAi();
    const { bot } = setup({ ai });
    await bot.handleUpdate(text("Algebrani kim asoslagan?"));
    const system = ai.messages[0]?.[0]?.content ?? "";
    expect(system).toContain("Sening isming — Alloma AI");
    expect(system).toContain("Mening ismim Alloma AI, meni Savronbek yaratgan.");
  });

  it("/start o'zini Alloma AI deb tanishtiradi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(text("/start"));
    expect(api.lastText()).toContain("Men — <b>Alloma AI</b>");
  });
});

describe("AllomaBot AI javoblari", () => {
  it("savolga mos allomani kontekstga qo'shib AI'dan so'raydi va tugma qo'shadi", async () => {
    const ai = new FakeAi();
    const { api, bot } = setup({ ai });
    await bot.handleUpdate(text("Algebrani kim asoslagan?"));

    const system = ai.messages[0]?.[0]?.content ?? "";
    expect(system).toContain("### Muhammad ibn Muso al-Xorazmiy");
    expect(ai.messages[0]?.[1]).toEqual({ role: "user", content: "Algebrani kim asoslagan?" });

    const reply = api.sent("sendMessage").at(-1);
    expect(reply?.params.text).toContain("al-Xorazmiy");
    expect(reply?.params.parse_mode).toBeUndefined();
    const buttons = (reply?.params.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard;
    expect(buttons.flat()[0]?.callback_data).toBe("a:muhammad-ibn-muso-al-xorazmiy");
  });

  it("bir chatdan juda tez savollarni cheklaydi", async () => {
    const ai = new FakeAi();
    let t = 1_000_000;
    const { api, bot } = setup({ ai, now: () => t });
    await bot.handleUpdate(text("Algebrani kim asoslagan?"));
    t += 1000;
    await bot.handleUpdate(text("Tib qonunlari muallifi kim?"));
    expect(ai.messages).toHaveLength(1);
    expect(api.lastText()).toContain("Biroz kuting");
    t += AI_COOLDOWN_MS;
    await bot.handleUpdate(text("Tib qonunlari muallifi kim?"));
    expect(ai.messages).toHaveLength(2);
  });

  it("AI xato bersa — foydalanuvchiga tushunarli xabar", async () => {
    const { api, bot } = setup({ ai: new FakeAi(new AiError(429, "rate limit")) });
    await bot.handleUpdate(text("Algebrani kim asoslagan?"));
    expect(api.lastText()).toContain("limit");
  });

  it("AI ulanmagan bo'lsa — buyruqlarni tavsiya qiladi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(text("Algebrani kim asoslagan?"));
    expect(api.lastText()).toContain("AI hozircha ulanmagan");
  });
});

describe("format", () => {
  it("AI javobidagi Markdown belgilari tozalanadi", () => {
    expect(stripMarkdown("Asoschisi – **Muhammad al-Xorazmiy**.\n## Asarlar\n`Zij`")).toBe(
      "Asoschisi – Muhammad al-Xorazmiy.\nAsarlar\nZij",
    );
  });

  it("kartochka matni HTML belgilaridan himoyalangan", () => {
    const a = { ...service.getBySlug("alisher-navoiy"), bio: "<script>x</script> & y" };
    const caption = allomaCaption(a);
    expect(caption).toContain("&lt;script&gt;");
    expect(caption).toContain("&amp; y");
  });
});

describe("GroqClient", () => {
  it("429 bo'lsa zaxira modelga o'tadi", async () => {
    const models: string[] = [];
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      models.push(body.model);
      if (body.model === "big") {
        return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: " salom " } }] }), { status: 200 });
    });
    const client = new GroqClient({ apiKey: "k", model: "big", fallbackModel: "small", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.complete([{ role: "user", content: "x" }])).resolves.toBe("salom");
    expect(models).toEqual(["big", "small"]);
  });

  it("ikkala model ham o'chirilgan bo'lsa — mavjud chat modelini o'zi topadi", async () => {
    const used: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "whisper-large-v3", active: true },
              { id: "meta-llama/llama-prompt-guard-2-22m", active: true },
              { id: "openai/gpt-oss-20b", active: true },
              { id: "qwen/qwen-next", active: true },
            ],
          }),
          { status: 200 },
        );
      }
      const body = JSON.parse(String(init?.body)) as { model: string };
      used.push(body.model);
      if (body.model !== "qwen/qwen-next") {
        return new Response(JSON.stringify({ error: { message: `The model \`${body.model}\` does not exist` } }), { status: 404 });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "javob" } }] }), { status: 200 });
    });
    const client = new GroqClient({ apiKey: "k", model: "old-a", fallbackModel: "old-b", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.complete([{ role: "user", content: "x" }])).resolves.toBe("javob");
    expect(used).toEqual(["old-a", "old-b", "qwen/qwen-next"]);
    // Keyingi so'rov to'g'ridan-to'g'ri topilgan modelga boradi.
    await client.complete([{ role: "user", content: "y" }]);
    expect(used.at(-1)).toBe("qwen/qwen-next");
    expect(used).toHaveLength(4);
  });

  it("401 bo'lsa zaxiraga o'tmay xato beradi", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 }));
    const client = new GroqClient({ apiKey: "bad", model: "big", fallbackModel: "small", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.complete([{ role: "user", content: "x" }])).rejects.toThrow("Invalid API Key");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("Webhook", () => {
  const SECRET = "test-secret-1234567890";
  const makeApp = () => {
    const handled: TgUpdate[] = [];
    const app = express();
    app.use(express.json());
    app.post(
      "/telegram/webhook",
      createWebhookHandler({ handleUpdate: async (u) => void handled.push(u) }, SECRET, () => {}),
    );
    return { app, handled };
  };

  it("maxfiy kalitsiz yoki noto'g'ri kalitli so'rovni rad etadi", async () => {
    const { app, handled } = makeApp();
    await request(app).post("/telegram/webhook").send(text("/start")).expect(401);
    await request(app)
      .post("/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", "notogri-kalit-0000000")
      .send(text("/start"))
      .expect(401);
    expect(handled).toHaveLength(0);
  });

  it("to'g'ri kalit bilan xabarni qabul qiladi", async () => {
    const { app, handled } = makeApp();
    await request(app)
      .post("/telegram/webhook")
      .set("X-Telegram-Bot-Api-Secret-Token", SECRET)
      .send(text("/start"))
      .expect(200);
    expect(handled[0]?.message?.text).toBe("/start");
  });

  it("token berilmagan muhitda bot yaratilmaydi (sayt botsiz ishlaydi)", () => {
    expect(createTelegramRuntime(service)).toBeUndefined();
  });
});

describe("AllomaService bot qidiruvi", () => {
  it("findByName ismning bir qismi bo'yicha yagona allomani topadi", () => {
    expect(service.findByName("navoiy")?.slug).toBe("alisher-navoiy");
    expect(service.findByName("G'afur G'ulom")?.slug).toBe("gafur-gulom");
    expect(service.findByName("abu")).toBeUndefined();
  });

  it("findRelevant o'zbekcha qo'shimchalarni tushunadi", () => {
    expect(service.findRelevant("Navoiyning asarlari qaysilar?")[0]?.slug).toBe("alisher-navoiy");
    expect(service.findRelevant("Tib qonunlari muallifi kim?")[0]?.slug).toBe("abu-ali-ibn-sino");
  });
});

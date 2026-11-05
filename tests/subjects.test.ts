import { describe, expect, it } from "vitest";
import { AllomaBot, BOT_COMMANDS } from "../src/bot/alloma-bot.js";
import type { AiClient, ChatMessage } from "../src/bot/groq.js";
import { RANDOM_BUTTON, SUBJECTS, SUBJECTS_BUTTON } from "../src/bot/subjects.js";
import type { BotApi, TgUpdate } from "../src/bot/telegram-api.js";
import { createContainer } from "../src/container.js";

const service = createContainer().allomaService;

type Button = { text: string; callback_data?: string };

class FakeApi implements BotApi {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    return true as T;
  }
  last(method = "sendMessage") {
    return this.calls.filter((c) => c.method === method).at(-1)?.params;
  }
  inline(): Button[][] {
    return ((this.last()?.reply_markup as { inline_keyboard?: Button[][] })?.inline_keyboard ?? []) as Button[][];
  }
}

class EchoAi implements AiClient {
  calls: ChatMessage[][] = [];
  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    return "Javob tayyor.";
  }
}

const text = (t: string): TgUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: 5, type: "private" }, from: { id: 1, first_name: "Ali", is_bot: false }, text: t },
});
const press = (data: string): TgUpdate => ({
  update_id: 2,
  callback_query: {
    id: "q",
    from: { id: 1, first_name: "Ali", is_bot: false },
    message: { message_id: 9, chat: { id: 5, type: "private" } },
    data,
  },
});

function setup() {
  const api = new FakeApi();
  const ai = new EchoAi();
  const bot = new AllomaBot({ api, service, ai, log: () => {}, sleep: async () => {} });
  return { api, ai, bot };
}

describe("Fanlar menyusi", () => {
  it("15 ta fan, takrorlanmas id'lar, har birida 3 ta namunaviy savol", () => {
    expect(SUBJECTS).toHaveLength(15);
    expect(new Set(SUBJECTS.map((s) => s.id)).size).toBe(15);
    for (const s of SUBJECTS) {
      expect(s.examples).toHaveLength(3);
      // Telegram callback_data ≤ 64 bayt.
      expect(Buffer.byteLength(`fq:${s.id}:2`)).toBeLessThanOrEqual(64);
    }
  });

  it("/fanlar menyuda birinchi buyruq", () => {
    expect(BOT_COMMANDS[0]?.command).toBe("fanlar");
  });

  it("/start — pastki menyuda «📚 Fanlar» tugmasi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(text("/start"));
    const keyboard = (api.last()?.reply_markup as { keyboard: { text: string }[][] }).keyboard;
    expect(keyboard.flat().map((b) => b.text)).toEqual([SUBJECTS_BUTTON, RANDOM_BUTTON, "🕒 Vaqt", "🌤 Ob-havo"]);
  });

  for (const input of ["/fanlar", SUBJECTS_BUTTON, "Fanlar"]) {
    it(`«${input}» — 15 ta fan tugmasi chiqadi`, async () => {
      const { api, ai, bot } = setup();
      await bot.handleUpdate(text(input));
      const buttons = api.inline().flat();
      expect(buttons).toHaveLength(15);
      expect(buttons[0]).toEqual({ text: "📐 Matematika", callback_data: "f:mat" });
      expect(ai.calls).toHaveLength(0);
    });
  }

  it("fan bosilsa — namunaviy savollar va orqaga tugmasi", async () => {
    const { api, bot } = setup();
    await bot.handleUpdate(press("f:fiz"));
    expect(String(api.last()?.text)).toContain("Fizika");
    const buttons = api.inline().flat();
    expect(buttons.map((b) => b.callback_data)).toEqual(["fq:fiz:0", "fq:fiz:1", "fq:fiz:2", "fanlar"]);
  });

  it("fan tanlangach, keyingi savol shu fan kontekstida beriladi", async () => {
    const { ai, bot } = setup();
    await bot.handleUpdate(press("f:kim"));
    await bot.handleUpdate(text("Eng yengil element qaysi?"));
    const contents = ai.calls[0]?.map((m) => m.content) ?? [];
    expect(contents.some((c) => c.includes("Kimyo fanini tanladim"))).toBe(true);
  });

  it("namunaviy savol bosilsa — savol ko'rsatiladi va AI javob beradi", async () => {
    const { api, ai, bot } = setup();
    await bot.handleUpdate(press("fq:bio:0"));
    expect(ai.calls[0]?.at(-1)?.content).toBe("Fotosintez qanday jarayon?");
    const texts = api.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.params.text));
    expect(texts).toEqual(["❓ <i>Fotosintez qanday jarayon?</i>", "Javob tayyor."]);
  });

  it("noto'g'ri callback e'tiborsiz qoldiriladi", async () => {
    const { api, ai, bot } = setup();
    await bot.handleUpdate(press("fq:yoq:7"));
    await bot.handleUpdate(press("f:yoq"));
    expect(api.calls.filter((c) => c.method === "sendMessage")).toHaveLength(0);
    expect(ai.calls).toHaveLength(0);
  });
});

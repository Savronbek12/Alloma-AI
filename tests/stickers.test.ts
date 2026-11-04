import { describe, expect, it } from "vitest";
import { AllomaBot } from "../src/bot/alloma-bot.js";
import { buildAiMessages } from "../src/bot/format.js";
import type { AiClient, ChatMessage } from "../src/bot/groq.js";
import { addMoodEmoji, extractStickerTag, STICKER_MOODS } from "../src/bot/stickers.js";
import type { BotApi, TgUpdate } from "../src/bot/telegram-api.js";
import { createContainer } from "../src/container.js";

const service = createContainer().allomaService;

class FakeApi implements BotApi {
  calls: { method: string; params: Record<string, unknown> }[] = [];
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params });
    return true as T;
  }
  methods = () => this.calls.map((c) => c.method).filter((m) => m !== "sendChatAction");
  texts = () => this.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.params.text));
}

class ScriptedAi implements AiClient {
  calls: ChatMessage[][] = [];
  constructor(private readonly replies: string[]) {}
  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    return this.replies[this.calls.length - 1] ?? "Albatta!";
  }
}

const msg = (text: string): TgUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: 9, type: "private" }, text },
});

function setup(replies: string[]) {
  const api = new FakeApi();
  const bot = new AllomaBot({ api, service, ai: new ScriptedAi(replies), log: () => {} });
  return { api, bot };
}

describe("extractStickerTag", () => {
  it("tegni olib tashlaydi va kayfiyatni qaytaradi", () => {
    expect(extractStickerTag("Va alaykum assalom! Xush kelibsiz. [stiker:salom]")).toEqual({
      text: "Va alaykum assalom! Xush kelibsiz.",
      mood: "salom",
    });
    expect(extractStickerTag("Rahmat! [Stiker: Rahmat]\nYana savol bo'lsa yozing.")).toEqual({
      text: "Rahmat!\nYana savol bo'lsa yozing.",
      mood: "rahmat",
    });
  });

  it("noma'lum teg ham olib tashlanadi, lekin emoji berilmaydi", () => {
    expect(extractStickerTag("Yaxshi [stiker:raqs]")).toEqual({ text: "Yaxshi" });
  });
});

describe("addMoodEmoji", () => {
  it("oxiriga bitta mos kichik emoji qo'shadi", () => {
    expect(addMoodEmoji("Salom!", "salom", () => 0)).toBe(`Salom! ${STICKER_MOODS.salom[0]}`);
  });

  it("matn allaqachon emoji bilan tugasa — qo'shmaydi", () => {
    expect(addMoodEmoji("Rahmat! 😊", "rahmat")).toBe("Rahmat! 😊");
    expect(addMoodEmoji("Zo'r ❤️", "xursand")).toBe("Zo'r ❤️");
  });
});

describe("Kichik stikerli javoblar", () => {
  it("hissiyotli javob: matn oxirida kichik emoji, katta stiker (sendSticker) yo'q", async () => {
    const { api, bot } = setup(["Va alaykum assalom! Qalaysiz? [stiker:salom]"]);
    await bot.handleUpdate(msg("Assalomu alaykum!"));
    expect(api.methods()).toEqual(["sendMessage"]);
    const text = api.texts()[0] ?? "";
    expect(text.startsWith("Va alaykum assalom! Qalaysiz? ")).toBe(true);
    expect(STICKER_MOODS.salom.some((e) => text.endsWith(e))).toBe(true);
    expect(text).not.toContain("[stiker");
  });

  it("tegsiz (ilmiy) javobda emoji qo'shilmaydi", async () => {
    const answer = "Fotosintez — yorug'lik energiyasini kimyoviy energiyaga aylantirish.";
    const { api, bot } = setup([answer]);
    await bot.handleUpdate(msg("Fotosintez nima?"));
    expect(api.texts()).toEqual([answer]);
  });

  it("tizim ko'rsatmasida qisqa yozish va kam emoji qoidasi bor", () => {
    const [system] = buildAiMessages("Salom", service.all(), []);
    expect(system?.content).toContain("Qisqa yoz");
    expect(system?.content).toContain("Emoji kam ishlat");
  });
});

import { describe, expect, it } from "vitest";
import { AllomaBot, AI_COOLDOWN_MS } from "../src/bot/alloma-bot.js";
import { buildAiMessages } from "../src/bot/format.js";
import type { AiClient, ChatMessage } from "../src/bot/groq.js";
import {
  baseEmoji,
  extractStickerTag,
  STICKER_COOLDOWN_MS,
  StickerLibrary,
  type StickerMood,
  type StickerSource,
} from "../src/bot/stickers.js";
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

class FakeStickers implements StickerSource {
  asked: StickerMood[] = [];
  async pick(mood: StickerMood) {
    this.asked.push(mood);
    return `sticker-${mood}`;
  }
}

const msg = (text: string, from?: { id: number; first_name: string; is_bot: boolean }): TgUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: 9, type: "private" }, text, ...(from ? { from } : {}) },
});

function setup(replies: string[]) {
  let t = 1_000_000;
  const api = new FakeApi();
  const stickers = new FakeStickers();
  const bot = new AllomaBot({
    api,
    service,
    ai: new ScriptedAi(replies),
    stickers,
    log: () => {},
    now: () => t,
  });
  return { api, stickers, bot, tick: (ms: number) => (t += ms) };
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

  it("noma'lum teg ham olib tashlanadi, lekin stiker berilmaydi", () => {
    expect(extractStickerTag("Yaxshi [stiker:raqs]")).toEqual({ text: "Yaxshi" });
  });

  it("baseEmoji variant belgilarini olib tashlaydi", () => {
    expect(baseEmoji("🤷‍♂️")).toBe("🤷");
    expect(baseEmoji("❤️")).toBe("❤");
  });
});

describe("Stikerli javoblar", () => {
  it("hissiyotli javobdan keyin bitta stiker yuboriladi, matnda teg qolmaydi", async () => {
    const { api, bot } = setup(["Va alaykum assalom! Qalaysiz? [stiker:salom]"]);
    await bot.handleUpdate(msg("Assalomu alaykum!"));
    expect(api.methods()).toEqual(["sendMessage", "sendSticker"]);
    expect(api.texts()[0]).toBe("Va alaykum assalom! Qalaysiz?");
    expect(api.calls.at(-1)?.params.sticker).toBe("sticker-salom");
  });

  it("tegsiz (ilmiy) javobda stiker yo'q", async () => {
    const { api, bot } = setup(["Fotosintez — yorug'lik energiyasini kimyoviy energiyaga aylantirish."]);
    await bot.handleUpdate(msg("Fotosintez nima?"));
    expect(api.methods()).toEqual(["sendMessage"]);
  });

  it("me'yorida: bitta chatga 3 daqiqada ko'pi bilan 1 ta stiker", async () => {
    const { api, bot, tick } = setup(["Rahmat! [stiker:rahmat]", "Ha-ha! [stiker:kulgi]", "Qoyil! [stiker:qoyil]"]);
    await bot.handleUpdate(msg("Rahmat"));
    tick(AI_COOLDOWN_MS);
    await bot.handleUpdate(msg("Hazil"));
    expect(api.methods().filter((m) => m === "sendSticker")).toHaveLength(1);
    tick(STICKER_COOLDOWN_MS);
    await bot.handleUpdate(msg("Zo'r"));
    expect(api.methods().filter((m) => m === "sendSticker")).toHaveLength(2);
  });

  it("tizim ko'rsatmasida stiker qoidasi va o'rtacha uzunlik bor", () => {
    const [system] = buildAiMessages("Salom", service.all(), []);
    expect(system?.content).toContain("[stiker:salom]");
    expect(system?.content).toContain("O'RTACHA");
  });
});

describe("StickerLibrary", () => {
  it("to'plamni bir marta yuklaydi va kayfiyat bo'yicha tanlaydi", async () => {
    let loads = 0;
    const api: BotApi = {
      async call<T>(method: string): Promise<T> {
        if (method !== "getStickerSet") throw new Error(method);
        loads++;
        return {
          stickers: [
            { file_id: "wave", emoji: "👋" },
            { file_id: "laugh", emoji: "😂" },
            { file_id: "shrug", emoji: "🤷‍♂️" },
            { file_id: "other", emoji: "🍑" },
          ],
        } as T;
      },
    };
    const lib = new StickerLibrary(api, ["Set"], () => {}, () => 0);
    expect(await lib.pick("kulgi")).toBe("laugh");
    expect(await lib.pick("oylash")).toBe("shrug");
    expect(await lib.pick("salom")).toBe("wave");
    expect(await lib.pick("xafa")).toBeUndefined();
    expect(loads).toBe(1);
  });

  it("yuklash xato bo'lsa — stikersiz ishlaydi", async () => {
    const api: BotApi = {
      async call<T>(): Promise<T> {
        throw new Error("network");
      },
    };
    const lib = new StickerLibrary(api, ["Set"], () => {});
    await expect(lib.pick("salom")).resolves.toBeUndefined();
  });
});

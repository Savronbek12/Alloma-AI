import { describe, expect, it } from "vitest";
import { AI_COOLDOWN_MS, AllomaBot } from "../src/bot/alloma-bot.js";
import { ConversationStore } from "../src/bot/conversation.js";
import {
  botDescription,
  botShortDescription,
  buildAiMessages,
  codeAnswerToHtml,
  detectEra,
  stripMarkdown,
} from "../src/bot/format.js";
import { GroqClient, type AiClient, type ChatMessage } from "../src/bot/groq.js";
import type { BotApi, TgUpdate } from "../src/bot/telegram-api.js";
import { createContainer } from "../src/container.js";

const service = createContainer().allomaService;

class FakeApi implements BotApi {
  texts: string[] = [];
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (method === "sendMessage") this.texts.push(String(params.text));
    return true as T;
  }
}

/** Har bir so'rovni yozib boradi va oldindan berilgan javoblarni navbat bilan qaytaradi. */
class ScriptedAi implements AiClient {
  calls: ChatMessage[][] = [];
  constructor(private readonly replies: string[]) {}
  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    return this.replies[this.calls.length - 1] ?? "Albatta!";
  }
}

const msg = (text: string, chatId = 7): TgUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chatId, type: "private" }, text },
});

function setup(replies: string[]) {
  let t = 1_000_000;
  const api = new FakeApi();
  const ai = new ScriptedAi(replies);
  const bot = new AllomaBot({ api, service, ai, log: () => {}, now: () => t });
  const tick = (ms = AI_COOLDOWN_MS) => {
    t += ms;
  };
  return { api, ai, bot, tick };
}

describe("Suhbat xotirasi", () => {
  it("oldingi savol-javobni keyingi so'rovga qo'shadi", async () => {
    const { ai, bot, tick } = setup(["Alisher Navoiy Hirotda tug'ilgan.", "Uning asosiy asari — Xamsa."]);
    await bot.handleUpdate(msg("Navoiy qayerda tug'ilgan?"));
    tick();
    await bot.handleUpdate(msg("Uning asarlari-chi?"));

    const second = ai.calls[1] ?? [];
    expect(second.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(second[1]?.content).toBe("Navoiy qayerda tug'ilgan?");
    expect(second[2]?.content).toBe("Alisher Navoiy Hirotda tug'ilgan.");
    expect(second[3]?.content).toBe("Uning asarlari-chi?");
  });

  it("«uning» kabi savolda oldin muhokama qilingan alloma ma'lumoti kontekstda qoladi", async () => {
    const { ai, bot, tick } = setup(["Alisher Navoiy Hirotda tug'ilgan.", "Xamsa va boshqalar."]);
    await bot.handleUpdate(msg("Navoiy qayerda tug'ilgan?"));
    tick();
    await bot.handleUpdate(msg("Uning asarlari-chi?"));
    expect(ai.calls[1]?.[0]?.content).toContain("### Alisher Navoiy");
  });

  it("oddiy suhbat (salomlashish) ham AI orqali javob oladi", async () => {
    const { api, ai, bot } = setup(["Va alaykum assalom! Yaxshi, rahmat."]);
    await bot.handleUpdate(msg("Assalomu alaykum, qalaysan?"));
    expect(ai.calls).toHaveLength(1);
    expect(api.texts.at(-1)).toBe("Va alaykum assalom! Yaxshi, rahmat.");
  });

  it("chatlar bir-biridan ajratilgan", async () => {
    const { ai, bot, tick } = setup(["Javob A", "Javob B"]);
    await bot.handleUpdate(msg("Navoiy haqida", 1));
    tick();
    await bot.handleUpdate(msg("Salom", 2));
    expect(ai.calls[1]?.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("bot savol bergan bo'lsa, ism bilan javob — kartochka emas, kontekstli AI javobi", async () => {
    const { api, ai, bot, tick } = setup(["Qaysi allomani eng yaxshi ko'rasiz?", "Beruniy — ajoyib tanlov!"]);
    await bot.handleUpdate(msg("Menga allomalar haqida gapir"));
    tick();
    await bot.handleUpdate(msg("Beruniy"));
    expect(ai.calls).toHaveLength(2);
    expect(ai.calls[1]?.map((m) => m.content)).toContain("Qaysi allomani eng yaxshi ko'rasiz?");
    expect(api.texts.at(-1)).toBe("Beruniy — ajoyib tanlov!");
  });

  it("reply qilingan xabar (tarixda bo'lmasa) AI'ga ko'rsatiladi", async () => {
    const { ai, bot } = setup(["Ha, to'g'ri."]);
    await bot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 5,
        chat: { id: 7, type: "private" },
        text: "ha",
        reply_to_message: {
          message_id: 4,
          chat: { id: 7, type: "private" },
          text: "Sizga kvadrat tenglamalarni tushuntirib beraymi?",
        },
      },
    });
    expect(ai.calls[0]?.at(-1)?.content).toBe(
      "(Bu xabar quyidagi xabarga javob: «Sizga kvadrat tenglamalarni tushuntirib beraymi?»)\nha",
    );
  });

  it("kartochkadan keyin «uning asarlari?» — o'sha alloma kontekstda", async () => {
    const { ai, bot, tick } = setup(["Xamsa va boshqalar."]);
    await bot.handleUpdate(msg("Alisher Navoiy"));
    tick();
    await bot.handleUpdate(msg("Uning asarlari-chi?"));
    expect(ai.calls[0]?.[0]?.content).toContain("### Alisher Navoiy");
    expect(ai.calls[0]?.some((m) => m.role === "assistant" && m.content.includes("Alisher Navoiy"))).toBe(true);
  });

  it("tizim ko'rsatmasi har javobdan oldin tarixni qayta o'qishni talab qiladi", () => {
    const [system] = buildAiMessages("ha", service.all(), []);
    expect(system?.content).toContain("yuqoridagi suhbat tarixini");
  });

  it("/yangi suhbatni tozalaydi", async () => {
    const { api, ai, bot, tick } = setup(["Birinchi", "Ikkinchi"]);
    await bot.handleUpdate(msg("Navoiy qayerda tug'ilgan?"));
    await bot.handleUpdate(msg("/yangi"));
    expect(api.texts.at(-1)).toContain("yangidan boshlandi");
    tick();
    await bot.handleUpdate(msg("Salom"));
    expect(ai.calls[1]?.map((m) => m.role)).toEqual(["system", "user"]);
  });
});

describe("AI so'rovi hajmi (bepul tarif limiti)", () => {
  it("oddiy savolda barcha 103 alloma ro'yxati yuborilmaydi va so'rov ixcham", () => {
    const relevant = service.findRelevant("Navoiy qayerda tug'ilgan?", 5);
    const [system] = buildAiMessages("Navoiy qayerda tug'ilgan?", service.all(), relevant);
    expect(system?.content).toContain("### Alisher Navoiy");
    expect(system?.content).not.toContain("O'rol Tansiqboyev");
    // «Jonli suhbatdosh» personaji bilan ~2500 tokendan oshmasin (Groq bepul tarif TPM limiti).
    expect(system?.content.length ?? 0).toBeLessThan(8500);
  });

  it("savolda davr tilga olinsa — o'sha davr ro'yxati qo'shiladi", () => {
    const [system] = buildAiMessages("Temuriylar davri olimlari kimlar?", service.all(), []);
    expect(system?.content).toContain("Temuriylar davri (XIV–XVI asrlar) allomalari:");
    expect(system?.content).toContain("- Mirzo Ulug'bek");
    expect(system?.content).not.toContain("- Abdulla Qodiriy");
  });

  it("AI ro'yxatidagi * va - belgilari • ga aylanadi", () => {
    expect(stripMarkdown("Jadidlar:\n*   Behbudiy\n- Fitrat")).toBe("Jadidlar:\n• Behbudiy\n• Fitrat");
  });

  it("kod bloklari stripMarkdown'da buzilmaydi (# izoh, * operator saqlanadi)", () => {
    const text = "**Usul:**\n```python\n# izoh\nx = a * b\n```\n- tayyor";
    expect(stripMarkdown(text)).toBe("Usul:\n```python\n# izoh\nx = a * b\n```\n• tayyor");
  });

  it("kodli javob Telegram HTML <pre> ga aylanadi, qolgani escape qilinadi", () => {
    const html = codeAnswerToHtml("a < b:\n```python\nif a < b:\n    print('x')\n```\ntamom");
    expect(html).toBe(
      "a &lt; b:\n<pre><code class=\"language-python\">if a &lt; b:\n    print('x')</code></pre>\ntamom",
    );
    // Qisqartirilib yopilmay qolgan blok ham to'g'ri yopiladi.
    expect(codeAnswerToHtml("```js\nlet x = 1;")).toBe('<pre><code class="language-js">let x = 1;</code></pre>');
  });

  it("«Jonli suhbatdosh» personaji: qisqa, jonli, hazil, halollik", () => {
    const system = buildAiMessages("salom", service.all(), [])[0]?.content ?? "";
    expect(system).toContain("TELEGRAMDA YOZADIGAN ODAMDEK YOZ");
    expect(system).toContain("HAZIL QILISH (KAM-KAM)");
    expect(system).toContain("har 5–6 xabarda bir marta");
    expect(system).toContain("ko'cha tilidagi ohang esa doim saqlansin");
    expect(system).toContain("hazilni to'xtat");
    expect(system).toContain("aslida men AI'man");
    expect(system).toContain("«Albatta!»");
    expect(system).not.toContain("[...]");
  });

  it("tizim ko'rsatmasi botni barcha fanlar bo'yicha mutaxassis qiladi", () => {
    const [system] = buildAiMessages("Fotosintez nima?", service.all(), []);
    expect(system?.content).toContain("BARCHA fanlar bo'yicha mutaxassis");
    expect(system?.content).toMatch(/matematika, fizika, kimyo/);
  });

  it("botga kodli javob HTML parse_mode bilan yuboriladi", async () => {
    const { api, bot } = setup(["Mana:\n```python\nprint(1 < 2)\n```"]);
    await bot.handleUpdate(msg("Pythonda solishtirish"));
    expect(api.texts.at(-1)).toBe("Mana:\n<pre><code class=\"language-python\">print(1 &lt; 2)</code></pre>");
  });

  it("bot tavsiflari Telegram limitlariga sig'adi", () => {
    const id = { name: "Alloma AI", creator: "Savronbek" };
    const long = botDescription(id, "https://alloma-ai.onrender.com");
    expect(long.length).toBeLessThanOrEqual(512);
    expect(long).toContain("barcha fanlar");
    expect(long).toContain("https://alloma-ai.onrender.com");
    expect(long).toContain("Savronbek");
    expect(long.endsWith("…")).toBe(false);
    expect(botShortDescription(id).length).toBeLessThanOrEqual(120);
    expect(botShortDescription(id).endsWith("…")).toBe(false);
  });

  it("detectEra turli yozuvlarni taniydi", () => {
    expect(detectEra("Jadidlar kimlar edi?")).toBe("jadidlar");
    expect(detectEra("Temuriylar davrida kimlar yashagan")).toBe("temuriylar");
    expect(detectEra("Salom")).toBeUndefined();
  });
});

describe("GroqClient limit", () => {
  it("429 da kutish qisqa bo'lsa — kutib, o'sha modelga qayta urinadi", async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      if (calls === 1) {
        return new Response(
          JSON.stringify({ error: { message: "Rate limit reached ... Please try again in 5ms." } }),
          { status: 429 },
        );
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    };
    const client = new GroqClient({ apiKey: "k", model: "m", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.complete([{ role: "user", content: "x" }])).resolves.toBe("ok");
    expect(calls).toBe(2);
  });
});

describe("ConversationStore", () => {
  it("muddati o'tgan suhbatni unutadi", () => {
    const store = new ConversationStore({ ttlMs: 1000 });
    store.append(1, "savol", "javob", ["alisher-navoiy"], 0);
    expect(store.get(1, 500).messages).toHaveLength(2);
    expect(store.get(1, 2000).messages).toHaveLength(0);
    expect(store.get(1, 2000).recentSlugs).toHaveLength(0);
  });

  it("standart holatda oxirgi 16 ta xabar va 1 soatdan ortiq saqlanadi", () => {
    const store = new ConversationStore();
    for (let i = 1; i <= 10; i++) store.append(1, `s${i}`, `j${i}`, [], i);
    expect(store.get(1, 11).messages).toHaveLength(16);
    expect(store.get(1, 65 * 60_000).messages).toHaveLength(16);
  });

  it("faqat oxirgi N ta xabarni saqlaydi", () => {
    const store = new ConversationStore({ maxMessages: 4 });
    for (let i = 1; i <= 5; i++) store.append(1, `s${i}`, `j${i}`, [], i);
    expect(store.get(1, 6).messages.map((m) => m.content)).toEqual(["s4", "j4", "s5", "j5"]);
  });

  it("chatlar soni chegaradan oshsa, eng eskisini o'chiradi", () => {
    const store = new ConversationStore({ maxChats: 2 });
    store.append(1, "a", "b", [], 1);
    store.append(2, "a", "b", [], 2);
    store.append(3, "a", "b", [], 3);
    expect(store.size).toBe(2);
    expect(store.get(1, 4).messages).toHaveLength(0);
    expect(store.get(3, 4).messages).toHaveLength(2);
  });
});

import type { BotApi } from "./telegram-api.js";

/**
 * Hissiyot va imo-ishoralar uchun stikerlar.
 * AI javob oxiriga yashirin teg qo'shadi: [stiker:salom]. Bot tegni olib tashlaydi va
 * mos stikerni Telegram'ning rasmiy to'plamlaridan tanlab yuboradi.
 */
export const STICKER_MOODS = {
  salom: ["👋"],
  xursand: ["😊", "😁", "😄", "🥳", "😍", "😎", "🤩"],
  kulgi: ["😂", "🤣", "😆"],
  rahmat: ["🤗", "😘", "❤", "🥰"],
  qoyil: ["👍", "👌", "👏", "🔥", "💪"],
  hayron: ["😮", "😳", "😱", "😯", "🤯"],
  xafa: ["😢", "😭", "😞", "😔", "🥺"],
  oylash: ["🤔", "🧐", "🤷"],
  xayr: ["👋", "😘"],
} as const satisfies Record<string, readonly string[]>;

export type StickerMood = keyof typeof STICKER_MOODS;
export const STICKER_MOOD_IDS = Object.keys(STICKER_MOODS) as StickerMood[];

/** Bitta chatga stikerlar orasidagi minimal vaqt (stiker ko'p bo'lib ketmasligi uchun). */
export const STICKER_COOLDOWN_MS = 3 * 60_000;
/** Rasmiy Telegram to'plamlari (Utya o'rdakchasi va Hot Cherry). */
export const DEFAULT_STICKER_SETS = ["UtyaDuck", "HotCherry"];

const TAG = /[ \t]*\[\s*(?:stiker|sticker)\s*:\s*([a-z'ʻ‘’]+)\s*\][ \t]*/gi;

/** Javobdan barcha [stiker:...] teglarini olib tashlaydi; birinchi to'g'ri kayfiyatni qaytaradi. */
export function extractStickerTag(text: string): { text: string; mood?: StickerMood } {
  let mood: StickerMood | undefined;
  const cleaned = text.replace(TAG, (_m, raw: string) => {
    const id = raw.toLowerCase().replace(/[ʻ‘’']/g, "");
    if (!mood && (STICKER_MOOD_IDS as string[]).includes(id)) mood = id as StickerMood;
    return " ";
  });
  // Teg olib tashlangandan keyingi ortiqcha bo'shliqlar (qator tuzilishi saqlanadi).
  const text2 = cleaned.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();
  return mood ? { text: text2, mood } : { text: text2 };
}

/** "🤷‍♂️" → "🤷", "❤️" → "❤": to'plamdagi va ro'yxatdagi emojilarni bir xil ko'rinishga keltiradi. */
export const baseEmoji = (emoji: string) => emoji.replace(/️/g, "").split("‍")[0] ?? emoji;

export interface StickerSource {
  /** Kayfiyatga mos tasodifiy stiker file_id (yo'q bo'lsa — undefined). */
  pick(mood: StickerMood): Promise<string | undefined>;
}

interface TgSticker {
  file_id: string;
  emoji?: string;
}

/** Stiker to'plamlarini bir marta yuklab, kayfiyat bo'yicha guruhlaydi. */
export class StickerLibrary implements StickerSource {
  private byMood: Map<StickerMood, string[]> | undefined;
  private loading: Promise<void> | undefined;
  private failedAt = -Infinity;

  constructor(
    private readonly api: BotApi,
    private readonly sets: readonly string[] = DEFAULT_STICKER_SETS,
    private readonly log: (m: string) => void = (m) => console.warn(m),
    private readonly random: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  async pick(mood: StickerMood): Promise<string | undefined> {
    if (!this.byMood) {
      // Yuklash muvaffaqiyatsiz bo'lsa — 10 daqiqadan keyin qayta urinamiz.
      if (this.now() - this.failedAt < 10 * 60_000) return undefined;
      this.loading ??= this.load().finally(() => {
        this.loading = undefined;
      });
      await this.loading;
    }
    const ids = this.byMood?.get(mood) ?? [];
    return ids.length ? ids[Math.floor(this.random() * ids.length)] : undefined;
  }

  private async load(): Promise<void> {
    const wanted = new Map<string, StickerMood[]>();
    for (const mood of STICKER_MOOD_IDS) {
      for (const e of STICKER_MOODS[mood]) {
        const key = baseEmoji(e);
        wanted.set(key, [...(wanted.get(key) ?? []), mood]);
      }
    }
    const byMood = new Map<StickerMood, string[]>();
    for (const name of this.sets) {
      try {
        const set = await this.api.call<{ stickers: TgSticker[] }>("getStickerSet", { name });
        for (const s of set.stickers) {
          for (const mood of wanted.get(baseEmoji(s.emoji ?? "")) ?? []) {
            byMood.set(mood, [...(byMood.get(mood) ?? []), s.file_id]);
          }
        }
      } catch (err) {
        this.log(`[bot] stiker to'plami "${name}" yuklanmadi: ${(err as Error).message}`);
      }
    }
    if (byMood.size === 0) {
      this.failedAt = this.now();
      return;
    }
    this.byMood = byMood;
  }
}

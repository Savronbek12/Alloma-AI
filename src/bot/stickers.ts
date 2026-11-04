/**
 * Hissiyot va imo-ishoralar uchun kichik stikerlar (emoji).
 * AI javob oxiriga yashirin teg qo'shadi: [stiker:salom]. Bot tegni olib tashlaydi va
 * javob matni oxiriga mos BITTA kichik emoji qo'yadi. Katta (sendSticker) stikerlar ishlatilmaydi.
 */
export const STICKER_MOODS = {
  salom: ["👋", "🙂"],
  xursand: ["😊", "😄", "🥳", "✨"],
  kulgi: ["😂", "😄", "😅"],
  rahmat: ["🤗", "😊", "🙏"],
  qoyil: ["👍", "👏", "🔥", "💪"],
  hayron: ["😮", "🤯", "😲"],
  xafa: ["😔", "🫂", "🙁"],
  oylash: ["🤔", "🧐"],
  xayr: ["👋", "🤝"],
} as const satisfies Record<string, readonly string[]>;

export type StickerMood = keyof typeof STICKER_MOODS;
export const STICKER_MOOD_IDS = Object.keys(STICKER_MOODS) as StickerMood[];

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

const ENDS_WITH_EMOJI = /\p{Extended_Pictographic}️?\s*$/u;

/**
 * Javob oxiriga kayfiyatga mos bitta kichik emoji qo'shadi.
 * Matn allaqachon emoji bilan tugasa — qo'shmaydi (me'yorida bo'lishi uchun).
 */
export function addMoodEmoji(text: string, mood: StickerMood, random: () => number = Math.random): string {
  if (ENDS_WITH_EMOJI.test(text)) return text;
  const options = STICKER_MOODS[mood];
  const emoji = options[Math.floor(random() * options.length)] ?? options[0];
  return `${text} ${emoji}`;
}

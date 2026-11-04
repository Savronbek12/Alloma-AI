import { ERA_LABELS, ERA_PERIODS } from "../../shared/constants.js";
import { formatYears } from "../../shared/format.js";
import type { Alloma } from "../../shared/types.js";
import type { ChatMessage } from "./groq.js";

/** Telegram HTML parse_mode uchun xavfsiz matn. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** AI javobidagi Markdown belgilarini olib tashlaydi (javob oddiy matn sifatida yuboriladi). */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Alloma kartochkasi (sendPhoto caption ≤ 1024 belgi bo'lishi uchun qismlar cheklangan). */
export function allomaCaption(a: Alloma): string {
  const lines = [
    `<b>${escapeHtml(a.name)}</b>`,
    `<i>${escapeHtml(formatYears(a))}</i> · ${escapeHtml(a.birthPlace)}`,
    `${escapeHtml(ERA_LABELS[a.era])} (${escapeHtml(ERA_PERIODS[a.era])})`,
    "",
    escapeHtml(truncate(a.bio, 420)),
  ];
  if (a.works.length > 0) {
    lines.push("", "<b>Asosiy asarlari:</b>");
    for (const w of a.works.slice(0, 4)) lines.push(`• ${escapeHtml(truncate(w, 70))}`);
  }
  if (a.image) {
    // CC BY / CC BY-SA litsenziyalari muallifni ko'rsatishni talab qiladi.
    lines.push("", `📷 ${escapeHtml(truncate(a.image.author, 60))} · ${escapeHtml(a.image.license)}`);
  }
  return lines.join("\n");
}

export function allomaButtonLabel(a: Alloma): string {
  return truncate(`${a.name} · ${formatYears(a)}`, 60);
}

/**
 * AI uchun so'rov: qisqa ro'yxat (barcha allomalar) + savolga mos allomalarning to'liq ma'lumoti.
 * Model faqat shu ma'lumotlarga tayanishi kerak — o'ylab topmasligi uchun.
 */
export function buildAiMessages(question: string, all: readonly Alloma[], relevant: readonly Alloma[]): ChatMessage[] {
  const index = all.map((a) => `- ${a.name} (${formatYears(a)})`).join("\n");
  const details = relevant
    .map((a) =>
      [
        `### ${a.name}`,
        `Yillari: ${formatYears(a)}; tug'ilgan joyi: ${a.birthPlace}; davr: ${ERA_LABELS[a.era]} (${ERA_PERIODS[a.era]})`,
        `Yo'nalishlari: ${a.fields.join(", ")}`,
        `Biografiya: ${a.bio}`,
        a.works.length ? `Asarlari: ${a.works.join("; ")}` : "Asarlari: ma'lumot yo'q",
      ].join("\n"),
    )
    .join("\n\n");

  const system = [
    "Sen «Alloma-AI» Telegram botisan. O'zbek allomalari haqidagi savollarga o'zbek tilida (lotin yozuvida) javob berasan.",
    "Qoidalar:",
    "1. Faqat pastdagi MA'LUMOTLARga tayan. Ma'lumotlarda bo'lmagan fakt, sana yoki asarni o'ylab topma.",
    "2. Javob ma'lumotlarda bo'lmasa, buni ochiq ayt va /qidir yoki /davrlar buyruqlarini tavsiya qil.",
    "3. Allomalar nomini aynan ro'yxatdagidek yoz.",
    "4. Javob qisqa bo'lsin: 1–3 ta qisqa paragraf. Markdown belgilari (*, #, _) ishlatma.",
    "5. Allomalar mavzusidan tashqari savollarga muloyimlik bilan bot faqat allomalar haqida gaplashishini ayt.",
    "",
    "MA'LUMOTLAR",
    "Barcha allomalar ro'yxati:",
    index,
    "",
    relevant.length ? "Savolga eng mos allomalar haqida batafsil:" : "Savolga mos alloma topilmadi.",
    details,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: question },
  ];
}

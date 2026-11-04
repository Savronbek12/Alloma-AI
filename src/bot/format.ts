import { ERA_IDS, ERA_LABELS, ERA_PERIODS, type EraId } from "../../shared/constants.js";
import { formatYears } from "../../shared/format.js";
import type { Alloma } from "../../shared/types.js";
import type { ChatMessage } from "./groq.js";

export interface BotIdentity {
  name: string;
  creator: string;
}

export const DEFAULT_IDENTITY: BotIdentity = { name: "Alloma AI", creator: "Savronbek" };

export function identityAnswer(identity: BotIdentity): string {
  return `Mening ismim ${identity.name}, meni ${identity.creator} yaratgan.`;
}

/**
 * "Isming nima?", "Seni kim yaratgan?" va shu kabi savollar (o'zbek/rus/ingliz).
 * Bunday savollarga AI'siz, har doim bir xil javob beriladi.
 */
const IDENTITY_PATTERNS = [
  /\bism(ing|ingiz|i)\b.*\b(nima|kim)\b/,
  /\b(nima|kim)\b.*\bism(ing|ingiz)\b/,
  /\b(sen|siz)\s+(kimsan|kimsiz)\b/,
  /\b(kimsan|kimsiz)\b/,
  /\b(seni|sizni)\b.*\b(kim)\b.*\b(yaratgan|yasagan|qilgan|tuzgan|yozgan)\b/,
  /\bkim\b.*\b(seni|sizni)\b.*\b(yaratgan|yasagan|tuzgan|yozgan)\b/,
  /\b(yaratuvching|yaratuvchingiz|muallifing|egang)\b/,
  /как\s+(тебя|вас)\s+зовут/,
  /кто\s+(ты|вы)\b/,
  /кто\s+(тебя|вас)\s+(создал|сделал|написал)/,
  /\bwhat('s| is)\s+your\s+name\b/,
  /\bwho\s+(are\s+you|(made|created|built)\s+you)\b/,
];

export function isIdentityQuestion(text: string): boolean {
  const t = text
    .toLowerCase()
    .replace(/[ʻʼ‘’`']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return IDENTITY_PATTERNS.some((p) => p.test(t));
}

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
    .replace(/^\s*[*-]\s+/gm, "• ")
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

/** Savolda tilga olingan davr ("Temuriylar davri olimlari", "jadidlar kimlar?"). */
const ERA_KEYWORDS: Record<EraId, RegExp> = {
  "ilk-orta-asr": /ilk orta asr|orta asr|somoniy|qoraxoniy|xorazmshoh|birinchi uygonish/,
  temuriylar: /temuriy|temur davri|ikkinchi uygonish/,
  xonliklar: /xonlik|xonligi|mangit|shayboniy|ashtarxoniy/,
  jadidlar: /jadid/,
  zamonaviy: /zamonaviy|sovet|xx asr|xxi asr|hozirgi/,
};

export function detectEra(text: string): EraId | undefined {
  const t = text.toLowerCase().replace(/[ʻʼ‘’`']/g, "");
  return ERA_IDS.find((id) => ERA_KEYWORDS[id].test(t));
}

/**
 * AI uchun so'rov: savolga mos allomalarning to'liq ma'lumoti (+ savolda davr bo'lsa — o'sha davr ro'yxati).
 * Bepul tarifning daqiqalik token limitiga sig'ishi uchun barcha 103 alloma ro'yxati yuborilmaydi.
 * Model faqat shu ma'lumotlarga tayanishi kerak — o'ylab topmasligi uchun.
 */
export function buildAiMessages(
  question: string,
  all: readonly Alloma[],
  relevant: readonly Alloma[],
  identity: BotIdentity = DEFAULT_IDENTITY,
  history: readonly ChatMessage[] = [],
): ChatMessage[] {
  const era = detectEra(question);
  const eraList = era
    ? [
        `${ERA_LABELS[era]} (${ERA_PERIODS[era]}) allomalari:`,
        ...all.filter((a) => a.era === era).map((a) => `- ${a.name} (${formatYears(a)})`),
      ].join("\n")
    : "";
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
    `Sening isming — ${identity.name}. Seni ${identity.creator} yaratgan. Sen «Alloma-AI» loyihasining Telegram botisan: samimiy, bilimdon suhbatdosh, ayniqsa o'zbek allomalari bo'yicha mutaxassis.`,
    `Isming yoki seni kim yaratgani so'ralsa, aynan shunday javob ber: "${identityAnswer(identity)}" O'zingni boshqa model, kompaniya yoki dastur nomi bilan atama.`,
    "",
    "Suhbat qoidalari:",
    "1. Foydalanuvchi bilan tabiiy suhbatlash: salomlashish, hol-ahvol, minnatdorchilik, hazilga iliq va qisqa javob ber.",
    "2. Oldingi xabarlarni hisobga ol: «u», «uning», «o'sha» kabi so'zlar suhbatda oldin tilga olingan allomaga ishora qilishi mumkin.",
    "3. Foydalanuvchi qaysi tilda yozsa, o'sha tilda javob ber (standart — o'zbek tili, lotin yozuvi).",
    "4. Allomalar haqidagi fakt, sana va asarlarni FAQAT pastdagi MA'LUMOTLARdan ol. Ma'lumotlarda yo'q tafsilot qo'shma: asar qachon, necha qismda, qaysi asrda yozilgani kabi narsalarni o'zingdan to'qima. Agar so'ralgan tafsilot ma'lumotlarda bo'lmasa, «bu haqda ma'lumotim yo'q» deb ayt.",
    "5. Boshqa mavzularda umumiy bilimingdan qisqa javob berishing mumkin; ishonching komil bo'lmasa, shuni ayt. Mos kelsa, suhbatni allomalarga bog'la, lekin majburlama.",
    "6. Zararli, xavfli yoki haqoratli so'rovlarni muloyimlik bilan rad et.",
    "7. Javob qisqa bo'lsin (odatda 1–3 qisqa paragraf). Markdown belgilari (*, #, _) ishlatma.",
    "8. Allomalar nomini aynan ro'yxatdagidek yoz.",
    "9. Guruhda xabarlar «Ism: matn» ko'rinishida keladi, botlarniki — «Ism (bot): matn». Javobingni ism yoki prefiks bilan boshlama, faqat javob matnini yoz.",
    "10. Boshqa bot (masalan, Sardor AI) bilan suhbatda qisqa (1–3 jumla), aniq va muloyim gapir; uning savoliga javob ber, kerak bo'lsa bitta qarshi savol ber. Savollarni takrorlama; suhbat mavzusi tugasa, minnatdorchilik bildirib xayrlash.",
    "",
    `MA'LUMOTLAR (bazada jami ${all.length} ta alloma; quyida faqat shu suhbatga mos qismi berilgan. To'liq ro'yxat uchun /davrlar buyrug'ini tavsiya qil.)`,
    eraList,
    "",
    relevant.length
      ? "Suhbatga eng mos allomalar haqida batafsil:"
      : "Bu xabarga mos alloma topilmadi (oddiy suhbat bo'lishi mumkin).",
    details,
  ].join("\n");

  return [{ role: "system", content: system }, ...history, { role: "user", content: question }];
}

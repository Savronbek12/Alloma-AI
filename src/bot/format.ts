import { ERA_IDS, ERA_LABELS, ERA_PERIODS, type EraId } from "../../shared/constants.js";
import { formatYears } from "../../shared/format.js";
import type { Alloma } from "../../shared/types.js";
import type { ChatMessage } from "./groq.js";
import { discussionPrompt, personaPrompt } from "./persona.js";

export interface BotIdentity {
  name: string;
  creator: string;
}

export const DEFAULT_IDENTITY: BotIdentity = { name: "Alloma AI", creator: "Savronbek" };

export function identityAnswer(identity: BotIdentity): string {
  return `Mening ismim ${identity.name}, meni ${identity.creator} yaratgan.`;
}

/** Telegram profilidagi qisqa tavsif (≤ 120 belgi). */
export function botShortDescription(identity: BotIdentity): string {
  return truncate(
    `${identity.name} — barcha fanlar bo'yicha AI yordamchi va 100+ o'zbek allomasi haqida bilimdon. Muallif: ${identity.creator}.`,
    120,
  );
}

/** /start bosishdan oldin bo'sh chatda ko'rinadigan tavsif (≤ 512 belgi). */
export function botDescription(identity: BotIdentity, siteUrl?: string): string {
  return truncate(
    [
      `Salom! Men — ${identity.name}, barcha fanlar bo'yicha AI yordamchiman.`,
      "",
      "📚 Matematika, fizika, kimyo, biologiya, tarix, adabiyot, dasturlash, tillar — istalgan savolingizga tushuntirib javob beraman, masalalarni bosqichma-bosqich yechaman.",
      "🏛 Al-Xorazmiydan Abdulla Qodiriygacha — 100 dan ortiq o'zbek allomasi haqida ma'lumot va rasmlar.",
      "💬 Oddiy suhbatdek yozing — gaplarimizni eslab qolaman.",
      "",
      siteUrl ? `🌐 ${siteUrl}` : "",
      `Muallif: ${identity.creator}`,
    ]
      .filter((line, i, all) => line !== "" || all[i - 1] !== "")
      .join("\n"),
    512,
  );
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

/** ```kod``` bloklari (yopilmagan oxirgi blok ham — javob qisqartirilgan bo'lishi mumkin). */
const CODE_FENCE = /```[^\n`]*\n?[\s\S]*?(?:```|$)/g;

function stripMarkdownProse(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[*-][ \t]+/gm, "• ")
    .replace(/`([^`\n]+)`/g, "$1");
}

/**
 * AI javobidagi Markdown belgilarini olib tashlaydi. Kod bloklari (```) o'zgarishsiz qoladi —
 * ulardagi `#` izohlar yoki `*` operatorlar buzilmasligi uchun.
 */
export function stripMarkdown(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(CODE_FENCE)) {
    out += stripMarkdownProse(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + stripMarkdownProse(text.slice(last));
}

export function hasCodeBlock(text: string): boolean {
  return text.includes("```");
}

/** Kod bloklari bor javob: Telegram HTML — kod <pre><code> ichida, qolgani escape qilingan. */
export function codeAnswerToHtml(text: string): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(CODE_FENCE)) {
    out += escapeHtml(text.slice(last, m.index));
    const fence = /^```([^\n`]*)\n?([\s\S]*?)(?:```)?$/.exec(m[0]);
    const lang = (fence?.[1] ?? "").trim().replace(/[^\w+#-]/g, "");
    const code = (fence?.[2] ?? "").replace(/\n$/, "");
    out += lang
      ? `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`
      : `<pre>${escapeHtml(code)}</pre>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
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
export interface DiscussionContext {
  topic: string;
  partnerName: string;
  /** Sessiya oxiriga qolgan daqiqalar. */
  minutesLeft: number;
  /** Munozara boshlanganidan beri o'tgan daqiqalar. */
  minutesElapsed: number;
}

export function buildAiMessages(
  question: string,
  all: readonly Alloma[],
  relevant: readonly Alloma[],
  identity: BotIdentity = DEFAULT_IDENTITY,
  history: readonly ChatMessage[] = [],
  discussion?: DiscussionContext,
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
    ...personaPrompt(identity, identityAnswer(identity)),
    ...(discussion ? ["", ...discussionPrompt(discussion)] : []),
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

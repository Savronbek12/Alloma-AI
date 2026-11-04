/**
 * Guruhdagi bot-bot munozara sessiyasi: odam /muhokama bilan boshlaydi, bitta mavzu,
 * ko'pi bilan 1 soat. Sessiya davomida "4 ta ketma-ket javob" chegarasi o'rniga
 * quyidagi qat'iy cheklovlar ishlaydi (cheksiz sikl bo'lmasligi uchun):
 *   - vaqt: 60 daqiqa;  - javoblar: 80 ta;  - javoblar orasida: ≥ 20 soniya;
 *   - takroriy matnlar (BotGuard) va odamning /toxtat buyrug'i.
 */

export const DISCUSSION_MAX_MS = 60 * 60_000;
export const DISCUSSION_MAX_TURNS = 80;
/** Javoblar orasidagi minimal vaqt (odamdek sur'at + bepul AI limiti). */
export const DISCUSSION_MIN_GAP_MS = 20_000;

export interface DiscussionSession {
  chatId: number;
  topic: string;
  startedBy: string;
  startedAt: number;
  endsAt: number;
  turns: number;
  lastReplyAt: number;
}

export type DiscussionTurn =
  | { status: "active"; session: DiscussionSession; waitMs: number }
  | { status: "finished"; session: DiscussionSession; reason: "time" | "turns" };

export class DiscussionManager {
  private readonly sessions = new Map<number, DiscussionSession>();

  constructor(private readonly maxChats = 500) {}

  start(chatId: number, topic: string, startedBy: string, now: number): DiscussionSession {
    const session: DiscussionSession = {
      chatId,
      topic,
      startedBy,
      startedAt: now,
      endsAt: now + DISCUSSION_MAX_MS,
      turns: 0,
      lastReplyAt: now,
    };
    this.sessions.delete(chatId);
    this.sessions.set(chatId, session);
    while (this.sessions.size > this.maxChats) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    return session;
  }

  /** Faol sessiya (muddati o'tganini qaytarmaydi). */
  get(chatId: number, now: number): DiscussionSession | undefined {
    const s = this.sessions.get(chatId);
    return s && now < s.endsAt && s.turns < DISCUSSION_MAX_TURNS ? s : undefined;
  }

  /** Sessiya mavjud (tugagan bo'lsa ham, yopilmagan) — xayrlashuv xabarini bir marta yuborish uchun. */
  peek(chatId: number): DiscussionSession | undefined {
    return this.sessions.get(chatId);
  }

  /** Sherik botning navbatdagi xabari: davom etamizmi va qancha kutish kerak. */
  nextTurn(chatId: number, now: number): DiscussionTurn | undefined {
    const s = this.sessions.get(chatId);
    if (!s) return undefined;
    if (now >= s.endsAt) return { status: "finished", session: s, reason: "time" };
    if (s.turns >= DISCUSSION_MAX_TURNS) return { status: "finished", session: s, reason: "turns" };
    return { status: "active", session: s, waitMs: Math.max(0, s.lastReplyAt + DISCUSSION_MIN_GAP_MS - now) };
  }

  recordReply(chatId: number, now: number): void {
    const s = this.sessions.get(chatId);
    if (!s) return;
    s.turns += 1;
    s.lastReplyAt = now;
  }

  end(chatId: number): DiscussionSession | undefined {
    const s = this.sessions.get(chatId);
    this.sessions.delete(chatId);
    return s;
  }
}

/** Odamdek "yozish" vaqti: javob uzunligiga qarab 6–25 soniya. */
export function typingDelayMs(text: string, jitter = Math.random()): number {
  const base = 5_000 + text.length * 45;
  return Math.round(Math.min(25_000, Math.max(6_000, base)) + jitter * 2_000);
}

const APOSTROPHES = /[ʻʼ‘’`']/g;

/**
 * "Sardor AI bilan Beruniy haqida muhokama qil" / "... mavzusida gaplashing" -> "Beruniy".
 */
export function parseDiscussionRequest(text: string): string | undefined {
  const t = text.replace(APOSTROPHES, "'");
  const m = t.match(
    /sardor\s*ai\s*(?:'?\s*bilan)\s+(.+?)\s+(?:haqida|mavzusida|to'g'risida)\s+(?:muhokama\s+qil|bahslash|gaplash|suhbatlash)/i,
  );
  const topic = m?.[1]?.trim();
  return topic && topic.length >= 2 ? topic : undefined;
}

import { createHash } from "node:crypto";

/**
 * Bot-bot suhbatida cheksiz sikldan himoya va Telegram yuborish limitlari (Telegram talabi).
 * Holat har bir chat uchun alohida, server xotirasida saqlanadi.
 */

/** Odam yozmaguncha bitta chatda botlarga ketma-ket beriladigan javoblar soni. */
export const MAX_BOT_TURNS = 4;
/** Bitta botga javoblar orasidagi minimal vaqt. */
export const BOT_REPLY_INTERVAL_MS = 3_000;
/** Bot shu vaqt ichida bir xil matnni takrorlasa — javob berilmaydi. */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;
/** Telegram: guruhga daqiqasiga ko'pi bilan 20 ta xabar, bitta chatga sekundiga 1 ta. */
export const GROUP_MESSAGES_PER_MINUTE = 20;
export const CHAT_SEND_INTERVAL_MS = 1_000;
/** Xotirada saqlanadigan chatlar soni (eng eskilari o'chiriladi). */
export const MAX_TRACKED_CHATS = 2000;

interface PeerBotState {
  lastReplyAt: number;
  /** matn hash'i -> oxirgi ko'rilgan vaqt */
  recentTexts: Map<string, number>;
}

interface ChatState {
  botTurns: number;
  peers: Map<number, PeerBotState>;
  /** Shu chatga yuborilgan xabarlar vaqtlari (oxirgi 60 s). */
  sends: number[];
}

export type BotMessageDecision =
  | { allow: true; waitMs: number }
  | { allow: false; reason: "turn-limit" | "duplicate" };

const hashText = (text: string) =>
  createHash("sha256").update(text.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex").slice(0, 32);

export class BotGuard {
  private readonly chats = new Map<number, ChatState>();

  constructor(private readonly maxChats = MAX_TRACKED_CHATS) {}

  private state(chatId: number): ChatState {
    let s = this.chats.get(chatId);
    if (s) {
      // LRU: oxirgi ishlatilganini oxiriga o'tkazamiz.
      this.chats.delete(chatId);
    } else {
      s = { botTurns: 0, peers: new Map(), sends: [] };
    }
    this.chats.set(chatId, s);
    while (this.chats.size > this.maxChats) {
      const oldest = this.chats.keys().next().value;
      if (oldest === undefined) break;
      this.chats.delete(oldest);
    }
    return s;
  }

  /** Chatda odam yozdi — botlar bilan ketma-ket javoblar hisobi nolga tushadi. */
  onHumanMessage(chatId: number): void {
    const s = this.chats.get(chatId);
    if (s) s.botTurns = 0;
  }

  /** Boshqa botning xabariga javob berish mumkinmi va qancha kutish kerak. */
  checkBotMessage(chatId: number, botId: number, text: string, now: number): BotMessageDecision {
    const s = this.state(chatId);
    let peer = s.peers.get(botId);
    if (!peer) {
      peer = { lastReplyAt: -Infinity, recentTexts: new Map() };
      s.peers.set(botId, peer);
    }

    for (const [hash, seenAt] of peer.recentTexts) {
      if (now - seenAt > DUPLICATE_WINDOW_MS) peer.recentTexts.delete(hash);
    }
    const hash = hashText(text);
    const duplicate = peer.recentTexts.has(hash);
    peer.recentTexts.set(hash, now);

    if (s.botTurns >= MAX_BOT_TURNS) return { allow: false, reason: "turn-limit" };
    if (duplicate) return { allow: false, reason: "duplicate" };
    return { allow: true, waitMs: Math.max(0, peer.lastReplyAt + BOT_REPLY_INTERVAL_MS - now) };
  }

  /** Botga javob yuborildi. */
  recordBotReply(chatId: number, botId: number, now: number): void {
    const s = this.state(chatId);
    s.botTurns += 1;
    const peer = s.peers.get(botId);
    if (peer) peer.lastReplyAt = now;
  }

  botTurns(chatId: number): number {
    return this.chats.get(chatId)?.botTurns ?? 0;
  }

  /**
   * Guruhga xabar yuborishdan oldin: -1 — daqiqalik limit tugagan (yubormaslik kerak),
   * aks holda — necha ms kutib yuborish kerak (sekundiga 1 ta). Joy band qilinadi.
   */
  reserveGroupSend(chatId: number, now: number): number {
    const s = this.state(chatId);
    s.sends = s.sends.filter((t) => now - t < 60_000);
    if (s.sends.length >= GROUP_MESSAGES_PER_MINUTE) return -1;
    const last = s.sends.at(-1);
    const wait = last === undefined ? 0 : Math.max(0, last + CHAT_SEND_INTERVAL_MS - now);
    s.sends.push(now + wait);
    return wait;
  }

  get size(): number {
    return this.chats.size;
  }
}

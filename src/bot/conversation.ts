import type { ChatMessage } from "./groq.js";

/**
 * Har bir chat uchun qisqa suhbat xotirasi (server xotirasida).
 * Server qayta ishga tushsa (deploy) — xotira tozalanadi; bu bot uchun yetarli.
 */
export interface ConversationOptions {
  /** Saqlanadigan xabarlar soni (foydalanuvchi + bot). */
  maxMessages?: number;
  /** Shuncha vaqt jimlikdan keyin suhbat yangidan boshlanadi. */
  ttlMs?: number;
  /** Xotirada saqlanadigan chatlar soni (eng eskilari o'chiriladi). */
  maxChats?: number;
}

interface Conversation {
  messages: ChatMessage[];
  /** Oxirgi javoblarda muhokama qilingan allomalar ("uning asarlari?" kabi savollar uchun). */
  recentSlugs: string[];
  updatedAt: number;
}

export class ConversationStore {
  private readonly chats = new Map<number, Conversation>();
  private readonly maxMessages: number;
  private readonly ttlMs: number;
  private readonly maxChats: number;

  constructor(options: ConversationOptions = {}) {
    // 8 ta xabar (4 savol-javob) — bepul tarifning daqiqalik token limitini tejash uchun.
    this.maxMessages = options.maxMessages ?? 8;
    this.ttlMs = options.ttlMs ?? 30 * 60_000;
    this.maxChats = options.maxChats ?? 1000;
  }

  /** Amaldagi suhbat (muddati o'tgan bo'lsa — bo'sh). */
  get(chatId: number, now: number): { messages: readonly ChatMessage[]; recentSlugs: readonly string[] } {
    const c = this.chats.get(chatId);
    if (!c || now - c.updatedAt > this.ttlMs) {
      this.chats.delete(chatId);
      return { messages: [], recentSlugs: [] };
    }
    return { messages: c.messages, recentSlugs: c.recentSlugs };
  }

  append(chatId: number, question: string, answer: string, slugs: readonly string[], now: number): void {
    const current = this.get(chatId, now);
    const turn: ChatMessage[] = [
      { role: "user", content: question },
      { role: "assistant", content: answer },
    ];
    const messages = [...current.messages, ...turn].slice(-this.maxMessages);
    const recentSlugs = [...new Set([...slugs, ...current.recentSlugs])].slice(0, 5);

    // Map tartibi = qo'shilish tartibi: yangilanganini oxiriga o'tkazamiz.
    this.chats.delete(chatId);
    this.chats.set(chatId, { messages, recentSlugs, updatedAt: now });

    while (this.chats.size > this.maxChats) {
      const oldest = this.chats.keys().next().value;
      if (oldest === undefined) break;
      this.chats.delete(oldest);
    }
  }

  reset(chatId: number): void {
    this.chats.delete(chatId);
  }

  get size(): number {
    return this.chats.size;
  }
}

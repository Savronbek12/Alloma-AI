/** Telegram Bot API uchun minimal, tiplangan klient (qo'shimcha kutubxonasiz). */

export interface TgUser {
  id: number;
  first_name: string;
  username?: string;
  is_bot?: boolean;
}

export interface TgChat {
  id: number;
  /** "private" | "group" | "supergroup" | "channel" */
  type: string;
  title?: string;
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  /** Rasm/kartochka xabarining matni. */
  caption?: string;
  /** Bu xabar qaysi xabarga reply qilingan (bot-bot suhbati shu orqali davom etadi). */
  reply_to_message?: TgMessage;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  /** Telegram Mini App (faqat shaxsiy chatda ishlaydi). */
  web_app?: { url: string };
}

/** Bot faqat shu interfeysga bog'liq — testlarda soxta (fake) amalga oshirish beriladi. */
export interface BotApi {
  call<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

export class TelegramError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

export class TelegramApi implements BotApi {
  private readonly baseUrl: string;

  constructor(
    token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok: true; result: T }
      | { ok: false; description?: string; error_code?: number }
      | null;
    if (!data) throw new TelegramError(`${method}: javob o'qilmadi (HTTP ${res.status})`, res.status);
    if (!data.ok) throw new TelegramError(`${method}: ${data.description ?? "noma'lum xato"}`, data.error_code);
    return data.result;
  }
}

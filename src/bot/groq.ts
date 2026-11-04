/**
 * Groq Cloud (bepul tarif) — OpenAI bilan mos chat API.
 * https://console.groq.com/docs/api-reference
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Bot faqat shu interfeysga bog'liq — boshqa provayderga o'tish oson. */
export interface AiClient {
  complete(messages: ChatMessage[]): Promise<string>;
}

export class AiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** 429 bo'lsa: necha millisekunddan keyin qayta urinish mumkin. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** Limitga yetganda shu vaqtgacha kutib, qayta urinib ko'ramiz (foydalanuvchi "yozmoqda…" ni ko'radi). */
const MAX_RETRY_WAIT_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "Please try again in 6.8775s" / "in 832.5ms" yoki Retry-After sarlavhasidan kutish vaqti. */
function parseRetryAfter(res: Response, message: string): number | undefined {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const m = message.match(/try again in ([\d.]+)\s*(ms|s)\b/i);
  if (!m?.[1]) return undefined;
  const value = Number(m[1]);
  return m[2]?.toLowerCase() === "ms" ? value : value * 1000;
}

export interface GroqOptions {
  apiKey: string;
  model: string;
  /** Asosiy model limitga yetsa (429) yoki mavjud bo'lmasa — shu model sinaladi. */
  fallbackModel?: string | undefined;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

/** Chat uchun yaramaydigan modellar (nutq, xavfsizlik filtrlari va h.k.). */
const NON_CHAT_MODEL = /whisper|guard|orpheus|tts|safeguard|allam/i;
/** Mavjud modellar ichidan tanlash tartibi. */
const MODEL_PREFERENCE = [/qwen/i, /gpt-oss-20b/i, /gpt-oss/i, /llama/i];

const isModelGone = (err: unknown) =>
  err instanceof AiError && (err.status === 404 || /does not exist|decommissioned|not found/i.test(err.message));

export class GroqClient implements AiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  /** Asosiy va zaxira modellar o'chirilgan bo'lsa, avtomatik topilgan model. */
  private discoveredModel: string | undefined;

  constructor(private readonly options: GroqOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.groq.com/openai/v1";
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    if (this.discoveredModel) return this.request(this.discoveredModel, messages);

    let lastError: unknown;
    const candidates = [this.options.model, this.options.fallbackModel].filter(
      (m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i,
    );
    for (const model of candidates) {
      try {
        return await this.requestWithShortWait(model, messages);
      } catch (err) {
        lastError = err;
        const retryable =
          err instanceof AiError && (err.status === 429 || err.status === 503 || isModelGone(err));
        if (!retryable) throw err;
      }
    }

    // Ikkala model ham o'chirilgan — Groq'dan mavjud modellar ro'yxatini so'raymiz.
    if (isModelGone(lastError)) {
      const model = await this.discoverModel();
      if (model) {
        this.discoveredModel = model;
        return this.request(model, messages);
      }
    }
    throw lastError;
  }

  /** 429 bo'lsa va kutish qisqa bo'lsa — kutib, o'sha modelga bir marta qayta urinadi. */
  private async requestWithShortWait(model: string, messages: ChatMessage[]): Promise<string> {
    try {
      return await this.request(model, messages);
    } catch (err) {
      if (
        err instanceof AiError &&
        err.status === 429 &&
        err.retryAfterMs !== undefined &&
        err.retryAfterMs <= MAX_RETRY_WAIT_MS
      ) {
        await sleep(err.retryAfterMs + 250);
        return this.request(model, messages);
      }
      throw err;
    }
  }

  private async discoverModel(): Promise<string | undefined> {
    const res = await this.fetchFn(`${this.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json().catch(() => null)) as { data?: { id: string; active?: boolean }[] } | null;
    const ids = (body?.data ?? [])
      .filter((m) => m.active !== false && !NON_CHAT_MODEL.test(m.id))
      .map((m) => m.id);
    for (const pattern of MODEL_PREFERENCE) {
      const match = ids.find((id) => pattern.test(id));
      if (match) return match;
    }
    return ids[0];
  }

  private async request(model: string, messages: ChatMessage[]): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 500 }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    } | null;

    if (!res.ok) {
      const message = body?.error?.message ?? `HTTP ${res.status}`;
      throw new AiError(res.status, message, res.status === 429 ? parseRetryAfter(res, message) : undefined);
    }
    const text = body?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AiError(502, "AI bo'sh javob qaytardi");
    return text;
  }
}

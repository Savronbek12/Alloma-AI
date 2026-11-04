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
  ) {
    super(message);
    this.name = "AiError";
  }
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
        return await this.request(model, messages);
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
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 700 }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    } | null;

    if (!res.ok) throw new AiError(res.status, body?.error?.message ?? `HTTP ${res.status}`);
    const text = body?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new AiError(502, "AI bo'sh javob qaytardi");
    return text;
  }
}

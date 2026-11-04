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

export class GroqClient implements AiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: GroqOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.groq.com/openai/v1";
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    try {
      return await this.request(this.options.model, messages);
    } catch (err) {
      const fallback = this.options.fallbackModel;
      const retryable =
        err instanceof AiError && (err.status === 429 || err.status === 404 || err.status === 503);
      if (fallback && fallback !== this.options.model && retryable) {
        return this.request(fallback, messages);
      }
      throw err;
    }
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

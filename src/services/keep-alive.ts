/**
 * Render bepul tarifi 15 daqiqa tashqi so'rov bo'lmasa servisni "uxlatadi".
 * Server o'zining ommaviy manziliga (Render tarmog'i orqali) muntazam so'rov yuborib,
 * faolligini saqlaydi. So'rov tashqi manzilga ketgani uchun Render uni kiruvchi trafik deb hisoblaydi.
 */
export interface KeepAliveOptions {
  /** Ommaviy manzil, masalan https://alloma-ai.onrender.com */
  url: string;
  /** So'rovlar orasidagi vaqt (ms). Render chegarasi 15 daqiqa — undan qisqa bo'lishi shart. */
  intervalMs: number;
  fetchFn?: typeof fetch;
  log?: (message: string) => void;
}

export function startKeepAlive({
  url,
  intervalMs,
  fetchFn = fetch,
  log = console.log,
}: KeepAliveOptions): () => void {
  const target = new URL("/api/health", url).toString();

  const ping = async (): Promise<void> => {
    try {
      const res = await fetchFn(target, {
        headers: { "User-Agent": "alloma-ai-keep-alive" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) log(`[keep-alive] ${target} → ${res.status}`);
    } catch (err) {
      log(`[keep-alive] ${target} → xato: ${(err as Error).message}`);
    }
  };

  const timer = setInterval(() => void ping(), intervalMs);
  // Taymer jarayonni majburan tirik ushlab turmasin (graceful shutdown uchun).
  timer.unref();
  log(`[keep-alive] yoqildi: har ${Math.round(intervalMs / 60_000)} daqiqada ${target}`);

  return () => clearInterval(timer);
}

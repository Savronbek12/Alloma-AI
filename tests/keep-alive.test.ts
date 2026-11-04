import { afterEach, describe, expect, it, vi } from "vitest";
import { startKeepAlive } from "../src/services/keep-alive.js";

describe("startKeepAlive", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("har intervalda /api/health ga so'rov yuboradi va to'xtatiladi", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async (_input: string | URL | Request) => new Response("ok", { status: 200 }));
    const log = vi.fn();

    const stop = startKeepAlive({
      url: "https://alloma-ai.onrender.com",
      intervalMs: 10 * 60_000,
      fetchFn: fetchFn as unknown as typeof fetch,
      log,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://alloma-ai.onrender.com/api/health");

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("tarmoq xatosida jarayonni yiqitmaydi, faqat log yozadi", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    const log = vi.fn();

    const stop = startKeepAlive({
      url: "https://example.onrender.com",
      intervalMs: 60_000,
      fetchFn: fetchFn as unknown as typeof fetch,
      log,
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("fetch failed"));
    stop();
  });
});

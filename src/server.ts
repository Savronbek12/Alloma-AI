import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { createContainer } from "./container.js";
import { startKeepAlive } from "./services/keep-alive.js";

const container = createContainer({ withBot: true });
const app = createApp(container);

let stopKeepAlive: (() => void) | undefined;

const server = app.listen(env.PORT, () => {
  const total = container.allomaRepository.findAll().length;
  console.log(`✔ Alloma-AI ishga tushdi: http://localhost:${env.PORT}  (${total} ta alloma)`);

  container.telegram
    ?.start()
    .catch((err: Error) => console.error("[bot] ishga tushmadi:", err.message));

  if (env.keepAliveUrl) {
    stopKeepAlive = startKeepAlive({
      url: env.keepAliveUrl,
      intervalMs: env.KEEP_ALIVE_INTERVAL_MINUTES * 60_000,
    });
  }
});

function shutdown(signal: string): void {
  console.log(`\n${signal} qabul qilindi, server to'xtatilmoqda...`);
  stopKeepAlive?.();
  container.telegram?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

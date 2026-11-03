import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { createContainer } from "./container.js";

const container = createContainer();
const app = createApp(container);

const server = app.listen(env.PORT, () => {
  const total = container.allomaRepository.findAll().length;
  console.log(`✔ Alloma-AI ishga tushdi: http://localhost:${env.PORT}  (${total} ta alloma)`);
});

function shutdown(signal: string): void {
  console.log(`\n${signal} qabul qilindi, server to'xtatilmoqda...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

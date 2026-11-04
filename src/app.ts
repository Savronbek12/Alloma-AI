import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { TELEGRAM_WEBHOOK_PATH } from "./bot/index.js";
import { MINIAPP_CHAT_PATH } from "./bot/miniapp.js";
import { env } from "./config/env.js";
import type { Container } from "./container.js";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler.js";
import { requestLogger } from "./middlewares/request-logger.js";
import { createApiRouter } from "./routes/index.js";

export function createApp(container: Container): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Lokal http:// ishlab chiqishda resurslarni https ga majburlamaslik uchun.
          upgradeInsecureRequests: env.isProduction ? [] : null,
          // Mini App: Telegram WebApp SDK skripti va Telegram Web ichida (iframe) ochilishi.
          scriptSrc: ["'self'", "https://telegram.org"],
          frameAncestors: ["'self'", "https://web.telegram.org", "https://*.telegram.org"],
        },
      },
      // X-Frame-Options ruxsat ro'yxatini qo'llamaydi — o'rniga CSP frame-ancestors ishlaydi.
      xFrameOptions: false,
    }),
  );
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: "100kb" }));
  if (!env.isTest) app.use(requestLogger);

  if (container.telegram) {
    app.post(TELEGRAM_WEBHOOK_PATH, container.telegram.webhookHandler);
    app.post(MINIAPP_CHAT_PATH, container.telegram.miniAppHandler);
  }

  app.use("/api", createApiRouter(container.allomaService));
  app.use("/api", notFoundHandler);

  app.use(
    express.static(env.publicDir, {
      setHeaders(res, filePath) {
        // HTML/CSS/JS har deploy'da o'zgaradi: brauzer har safar ETag bilan tekshirsin
        // (o'zgarmagan bo'lsa 304), aks holda eski CSS yangi HTML bilan aralashib qoladi.
        if (/\.(html|css|js)$/.test(filePath)) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (env.isProduction) {
          // Rasmlar va boshqa statik fayllar kam o'zgaradi.
          res.setHeader("Cache-Control", "public, max-age=604800");
        }
      },
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

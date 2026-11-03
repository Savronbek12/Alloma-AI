import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
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
        },
      },
    }),
  );
  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json({ limit: "100kb" }));
  if (!env.isTest) app.use(requestLogger);

  app.use("/api", createApiRouter(container.allomaService));
  app.use("/api", notFoundHandler);

  app.use(express.static(env.publicDir, { maxAge: env.isProduction ? "1h" : 0 }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

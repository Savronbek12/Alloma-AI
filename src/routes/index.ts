import { Router } from "express";
import { createAllomaController } from "../controllers/alloma.controller.js";
import type { AllomaService } from "../services/alloma.service.js";

export function createApiRouter(service: AllomaService): Router {
  const router = Router();
  const alloma = createAllomaController(service);

  router.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });

  router.get("/meta", alloma.meta);
  router.get("/allomalar", alloma.list);
  // "/random" ":slug" dan oldin turishi shart.
  router.get("/allomalar/random", alloma.random);
  router.get("/allomalar/:slug", alloma.getBySlug);

  return router;
}

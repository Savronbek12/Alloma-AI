import type { Request, Response } from "express";
import type { AllomaService } from "../services/alloma.service.js";
import { listQuerySchema, slugParamSchema } from "../validators/alloma.validator.js";

/** HTTP qatlami: so'rovni validatsiya qiladi, service'ni chaqiradi, javob qaytaradi. */
export function createAllomaController(service: AllomaService) {
  return {
    list(req: Request, res: Response): void {
      const query = listQuerySchema.parse(req.query);
      res.json(service.list(query));
    },

    getBySlug(req: Request, res: Response): void {
      const { slug } = slugParamSchema.parse(req.params);
      res.json(service.getBySlug(slug));
    },

    random(_req: Request, res: Response): void {
      res.set("Cache-Control", "no-store").json(service.random());
    },

    meta(_req: Request, res: Response): void {
      res.json(service.meta());
    },
  };
}

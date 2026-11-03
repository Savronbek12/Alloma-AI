import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import type { ApiErrorBody } from "../../shared/types.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(HttpError.notFound(`Yo'l topilmadi: ${req.method} ${req.originalUrl}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  let status = 500;
  let body: ApiErrorBody = { error: { message: "Serverda ichki xatolik yuz berdi" } };

  if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        message: "So'rov parametrlari noto'g'ri",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    };
  } else if (err instanceof HttpError) {
    status = err.status;
    body = { error: { message: err.message, details: err.details } };
  } else {
    console.error(err);
    if (!env.isProduction && err instanceof Error) body.error.details = err.message;
  }

  res.status(status).json(body);
};

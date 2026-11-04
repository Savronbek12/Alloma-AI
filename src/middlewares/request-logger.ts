import type { RequestHandler } from "express";

export const requestLogger: RequestHandler = (req, res, next) => {
  // Render health-check va keep-alive so'rovlari loglarni to'ldirib yubormasin.
  if (req.path === "/api/health") return next();
  const start = performance.now();
  res.on("finish", () => {
    const ms = (performance.now() - start).toFixed(1);
    console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${ms} ms)`);
  });
  next();
};

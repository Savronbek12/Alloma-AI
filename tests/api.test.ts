import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createContainer } from "../src/container.js";

const app = createApp(createContainer());

describe("REST API", () => {
  it("GET /api/health", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /api/allomalar — standart sahifa", async () => {
    const res = await request(app).get("/api/allomalar").expect(200);
    expect(res.body.items).toHaveLength(12);
    expect(res.body.total).toBeGreaterThanOrEqual(100);
  });

  it("GET /api/allomalar — filtr va qidiruv", async () => {
    const res = await request(app).get("/api/allomalar?q=beruniy&era=ilk-orta-asr").expect(200);
    const slugs = res.body.items.map((a: { slug: string }) => a.slug);
    expect(slugs).toContain("abu-rayhon-beruniy");
    // Ibn Iroq biografiyasida "Beruniyning ustozi" deyilgan — matn bo'yicha qidiruv ishlayapti.
    expect(slugs).toContain("abu-nasr-ibn-iroq");
  });

  it("GET /api/allomalar — noto'g'ri parametr 400 qaytaradi", async () => {
    const res = await request(app).get("/api/allomalar?era=nomalum&limit=1000").expect(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(["era", "limit"]),
    );
  });

  it("GET /api/allomalar/:slug", async () => {
    const res = await request(app).get("/api/allomalar/alisher-navoiy").expect(200);
    expect(res.body.works).toContain("Xamsa");
  });

  it("GET /api/allomalar/:slug — topilmasa 404", async () => {
    await request(app).get("/api/allomalar/mavjud-emas").expect(404);
  });

  it("GET /api/allomalar/random", async () => {
    const res = await request(app).get("/api/allomalar/random").expect(200);
    expect(res.body.slug).toBeTypeOf("string");
  });

  it("GET /api/meta", async () => {
    const res = await request(app).get("/api/meta").expect(200);
    expect(res.body.eras).toHaveLength(5);
  });

  it("noma'lum API yo'li JSON 404 qaytaradi", async () => {
    const res = await request(app).get("/api/yoq").expect(404);
    expect(res.body.error.message).toMatch(/topilmadi/);
  });

  it("bosh sahifani beradi", async () => {
    const res = await request(app).get("/").expect(200);
    expect(res.text).toContain("O'zbek allomalari");
  });

  it("HTML va CSS keshlanmaydi (deploy'dan keyin eski uslub qolmasligi uchun)", async () => {
    const html = await request(app).get("/").expect(200);
    expect(html.headers["cache-control"]).toBe("no-cache");
    const css = await request(app).get("/css/styles.css").expect(200);
    expect(css.headers["cache-control"]).toBe("no-cache");
  });
});

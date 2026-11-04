import path from "node:path";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createContainer } from "../src/container.js";
import { createSeoRouter } from "../src/seo.js";

const SITE = "https://alloma-ai.onrender.com";

function app(googleVerification?: string) {
  const a = express();
  a.use(
    createSeoRouter({
      publicDir: path.resolve("public"),
      siteUrl: SITE,
      googleVerification,
      botUsername: () => "alloma_ai_bot",
    }),
  );
  return a;
}

describe("SEO", () => {
  it("bosh sahifada «Alloma AI» nomi, canonical va JSON-LD bor", async () => {
    const res = await request(app("abc123")).get("/").expect(200);
    expect(res.text).toContain("<title>Alloma AI");
    expect(res.text).toContain(`<link rel="canonical" href="${SITE}/" />`);
    expect(res.text).toContain('<meta name="google-site-verification" content="abc123" />');
    expect(res.text).not.toContain("<!--seo-->");
    const ld = res.text.match(/<script type="application\/ld\+json">(.+?)<\/script>/)?.[1] ?? "[]";
    const [site, org] = JSON.parse(ld) as { name: string; url: string; sameAs?: string[] }[];
    expect(site?.name).toBe("Alloma AI");
    expect(site?.url).toBe(`${SITE}/`);
    expect(org?.sameAs).toEqual(["https://t.me/alloma_ai_bot"]);
  });

  it("robots.txt va sitemap.xml", async () => {
    const robots = await request(app()).get("/robots.txt").expect(200);
    expect(robots.text).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots.text).toContain("Disallow: /api/");
    const sitemap = await request(app()).get("/sitemap.xml").expect(200);
    expect(sitemap.text).toContain(`<loc>${SITE}/</loc>`);
  });

  it("Search Console HTML fayl usuli", async () => {
    const res = await request(app("google1a2b3c.html")).get("/google1a2b3c.html").expect(200);
    expect(res.text).toBe("google-site-verification: google1a2b3c.html");
  });

  it("ilovada bosh sahifa SEO teglari bilan beriladi", async () => {
    const res = await request(createApp(createContainer())).get("/").expect(200);
    expect(res.text).toContain("application/ld+json");
    expect(res.text).toContain('id="hero-title"');
  });
});

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERA_IDS, FIELD_IDS } from "../shared/constants.js";
import { allomaSeeds } from "../src/data/allomalar/index.js";
import { allomaImages } from "../src/data/images.generated.js";
import { InMemoryAllomaRepository } from "../src/repositories/alloma.repository.js";

describe("rasmlar manifesti", () => {
  const slugs = new Set(new InMemoryAllomaRepository(allomaSeeds).findAll().map((a) => a.slug));

  it.each(Object.entries(allomaImages))("%s — mavjud alloma va fayl", (slug, image) => {
    expect(slugs.has(slug)).toBe(true);
    expect(image.src).toMatch(new RegExp(`^/images/allomalar/${slug}\\.(jpe?g|png|gif|webp)$`, "i"));
    expect(existsSync(path.join(process.cwd(), "public", image.src))).toBe(true);
    expect(image.license).not.toBe("");
    expect(image.sourceUrl).toMatch(/^https:\/\//);
  });
});

describe("allomalar ma'lumotlari", () => {
  const all = new InMemoryAllomaRepository(allomaSeeds).findAll();

  it("kamida 100 ta alloma mavjud", () => {
    expect(all.length).toBeGreaterThanOrEqual(100);
  });

  it("slug'lar takrorlanmaydi va URL uchun yaroqli", () => {
    const slugs = all.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it.each(all.map((a) => [a.name, a] as const))("%s — yozuv to'g'ri", (_name, a) => {
    expect(a.name.trim()).not.toBe("");
    expect(a.bio.length).toBeGreaterThan(20);
    expect(a.birthPlace.trim()).not.toBe("");
    expect(ERA_IDS).toContain(a.era);
    expect(a.fields.length).toBeGreaterThan(0);
    for (const f of a.fields) expect(FIELD_IDS).toContain(f);
    expect(new Set(a.fields).size).toBe(a.fields.length);
    if (a.birthYear !== null && a.deathYear !== null) {
      expect(a.deathYear).toBeGreaterThan(a.birthYear);
      expect(a.deathYear - a.birthYear).toBeLessThan(110);
    }
  });
});

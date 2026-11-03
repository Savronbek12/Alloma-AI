import { describe, expect, it } from "vitest";
import type { ListQuery } from "../shared/types.js";
import { InMemoryAllomaRepository } from "../src/repositories/alloma.repository.js";
import { AllomaService } from "../src/services/alloma.service.js";
import type { AllomaInput } from "../src/types/alloma.js";
import { HttpError } from "../src/utils/http-error.js";
import { normalizeForSearch, slugify } from "../src/utils/text.js";

const fixtures: AllomaInput[] = [
  {
    name: "G'afur G'ulom",
    birthYear: 1903,
    deathYear: 1966,
    birthPlace: "Toshkent",
    era: "zamonaviy",
    fields: ["adabiyot"],
    bio: "Shoir va yozuvchi, Shum bola muallifi.",
    works: ["Shum bola"],
  },
  {
    name: "Abu Ali ibn Sino",
    birthYear: 980,
    deathYear: 1037,
    birthPlace: "Afshona",
    era: "ilk-orta-asr",
    fields: ["tibbiyot", "falsafa"],
    bio: "Tabib va faylasuf.",
    works: ["Tib qonunlari"],
  },
  {
    name: "Ahmad Yugnakiy",
    birthYear: null,
    deathYear: null,
    birthPlace: "Yugnak",
    era: "ilk-orta-asr",
    fields: ["adabiyot"],
    bio: "Shoir.",
    works: [],
  },
];

const service = new AllomaService(new InMemoryAllomaRepository(fixtures));
const q = (over: Partial<ListQuery> = {}): ListQuery => ({ sort: "birthYear", page: 1, limit: 10, ...over });

describe("text utils", () => {
  it("slugify apostroflarni olib tashlaydi", () => {
    expect(slugify("G'afur G'ulom")).toBe("gafur-gulom");
    expect(slugify("Gʻafur Gʻulom")).toBe("gafur-gulom");
    expect(slugify("Feruz (Muhammad Rahimxon II)")).toBe("feruz-muhammad-rahimxon-ii");
  });

  it("normalizeForSearch turli apostroflarni tenglashtiradi", () => {
    expect(normalizeForSearch("Gʻafur")).toBe(normalizeForSearch("g'afur"));
  });
});

describe("AllomaService.list", () => {
  it("yil bo'yicha saralaydi, noma'lum yillar oxirida", () => {
    expect(service.list(q()).items.map((a) => a.slug)).toEqual([
      "abu-ali-ibn-sino",
      "gafur-gulom",
      "ahmad-yugnakiy",
    ]);
  });

  it("apostrofsiz qidiruv ham ishlaydi", () => {
    const res = service.list(q({ q: "gafur" }));
    expect(res.total).toBe(1);
    expect(res.items[0]?.name).toBe("G'afur G'ulom");
  });

  it("asar nomi bo'yicha qidiradi", () => {
    expect(service.list(q({ q: "tib qonunlari" })).items[0]?.slug).toBe("abu-ali-ibn-sino");
  });

  it("davr va yo'nalish bo'yicha filtrlaydi", () => {
    expect(service.list(q({ era: "ilk-orta-asr", field: "adabiyot" })).items.map((a) => a.slug)).toEqual([
      "ahmad-yugnakiy",
    ]);
  });

  it("sahifalaydi", () => {
    const res = service.list(q({ limit: 2, page: 2 }));
    expect(res).toMatchObject({ total: 3, totalPages: 2, page: 2 });
    expect(res.items).toHaveLength(1);
  });
});

describe("AllomaService boshqa metodlar", () => {
  it("getBySlug topilmasa 404 beradi", () => {
    expect(() => service.getBySlug("yoq")).toThrow(HttpError);
  });

  it("meta statistikani hisoblaydi", () => {
    const meta = service.meta();
    expect(meta.total).toBe(3);
    expect(meta.eras.find((e) => e.id === "ilk-orta-asr")?.count).toBe(2);
    expect(meta.fields.find((f) => f.id === "adabiyot")?.count).toBe(2);
  });

  it("repository takroriy slug'ni rad etadi", () => {
    expect(() => new InMemoryAllomaRepository([fixtures[0]!, fixtures[0]!])).toThrow(/Takroriy/);
  });
});

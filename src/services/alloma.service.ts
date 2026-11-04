import {
  ERA_IDS,
  ERA_LABELS,
  ERA_PERIODS,
  FIELD_IDS,
  FIELD_LABELS,
  type SortOption,
} from "../../shared/constants.js";
import type { Alloma, ListQuery, Meta, Paginated } from "../../shared/types.js";
import type { AllomaRepository } from "../repositories/alloma.repository.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeForSearch } from "../utils/text.js";

type Comparator = (a: Alloma, b: Alloma) => number;

const byName: Comparator = (a, b) => a.name.localeCompare(b.name, "uz");

/** Savollarda ko'p uchraydigan, lekin qidiruvga foyda bermaydigan so'zlar. */
const STOP_WORDS = new Set([
  "haqida", "qanday", "qachon", "kimning", "nima", "nimani", "qaysi", "qayerda", "qayerlik",
  "yashagan", "tugilgan", "bilan", "uchun", "ekan", "menga", "aytib", "bering", "aytchi",
  "haqda", "malumot", "kim", "edi", "bor", "yoq", "ham", "va", "the",
]);

/** O'zbekcha qo'shimchalarni sodda tarzda olib tashlaydi: "Navoiyning" -> "navoiy". */
const SUFFIXES = ["larning", "larni", "larga", "lardan", "ning", "dagi", "dan", "lar", "ni", "ga", "da"];
function stem(term: string): string {
  for (const suffix of SUFFIXES) {
    if (term.endsWith(suffix) && term.length - suffix.length >= 4) return term.slice(0, -suffix.length);
  }
  return term;
}

/** Noma'lum yil bo'lsa, vafot yili (yoki oxirgi o'rin) bo'yicha joylashtiriladi. */
const sortYear = (a: Alloma): number => a.birthYear ?? a.deathYear ?? Number.MAX_SAFE_INTEGER;

const COMPARATORS: Record<SortOption, Comparator> = {
  birthYear: (a, b) => sortYear(a) - sortYear(b) || byName(a, b),
  "-birthYear": (a, b) => sortYear(b) - sortYear(a) || byName(a, b),
  name: byName,
};

export class AllomaService {
  /** Har bir alloma uchun oldindan tayyorlangan qidiruv matni. */
  private readonly searchIndex: ReadonlyMap<number, string>;

  constructor(private readonly repository: AllomaRepository) {
    this.searchIndex = new Map(
      repository
        .findAll()
        .map((a) => [
          a.id,
          normalizeForSearch([a.name, a.birthPlace, a.bio, ...a.works].join(" ")),
        ]),
    );
  }

  list(query: ListQuery): Paginated<Alloma> {
    const terms = query.q ? normalizeForSearch(query.q).split(" ").filter(Boolean) : [];

    const filtered = this.repository.findAll().filter((a) => {
      if (query.era && a.era !== query.era) return false;
      if (query.field && !a.fields.includes(query.field)) return false;
      if (terms.length > 0) {
        const haystack = this.searchIndex.get(a.id) ?? "";
        return terms.every((term) => haystack.includes(term));
      }
      return true;
    });

    const sorted = [...filtered].sort(COMPARATORS[query.sort]);
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / query.limit));
    const start = (query.page - 1) * query.limit;

    return {
      items: sorted.slice(start, start + query.limit),
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
    };
  }

  /**
   * Erkin matndan allomani aniq topadi: to'liq ism/slug yoki ismda bitta-yagona moslik
   * ("Beruniy", "navoiy"). Bir nechta mos kelsa — undefined.
   */
  findByName(text: string): Alloma | undefined {
    const q = normalizeForSearch(text);
    if (q.length < 4) return undefined;
    const all = this.repository.findAll();
    const exact = all.find((a) => normalizeForSearch(a.name) === q || a.slug === q);
    if (exact) return exact;
    const partial = all.filter((a) => normalizeForSearch(a.name).includes(q));
    return partial.length === 1 ? partial[0] : undefined;
  }

  /**
   * Savolga eng mos allomalar (AI kontekst uchun). Har bir so'z ismda topilsa 3 ball,
   * biografiya/asarlar/joyda topilsa 1 ball.
   */
  findRelevant(question: string, limit = 5): Alloma[] {
    const terms = normalizeForSearch(question)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
      .map(stem);
    if (terms.length === 0) return [];

    return this.repository
      .findAll()
      .map((a) => {
        const name = normalizeForSearch(a.name);
        const haystack = this.searchIndex.get(a.id) ?? "";
        const score = terms.reduce(
          (sum, t) => sum + (name.includes(t) ? 3 : haystack.includes(t) ? 1 : 0),
          0,
        );
        return { a, score };
      })
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, limit)
      .map((x) => x.a);
  }

  all(): readonly Alloma[] {
    return this.repository.findAll();
  }

  getBySlug(slug: string): Alloma {
    const alloma = this.repository.findBySlug(slug);
    if (!alloma) throw HttpError.notFound(`"${slug}" nomli alloma topilmadi`);
    return alloma;
  }

  random(): Alloma {
    const all = this.repository.findAll();
    const alloma = all[Math.floor(Math.random() * all.length)];
    if (!alloma) throw HttpError.notFound("Ma'lumotlar bazasi bo'sh");
    return alloma;
  }

  meta(): Meta {
    const all = this.repository.findAll();
    return {
      total: all.length,
      eras: ERA_IDS.map((id) => ({
        id,
        label: ERA_LABELS[id],
        period: ERA_PERIODS[id],
        count: all.filter((a) => a.era === id).length,
      })),
      fields: FIELD_IDS.map((id) => ({
        id,
        label: FIELD_LABELS[id],
        count: all.filter((a) => a.fields.includes(id)).length,
      })).filter((f) => f.count > 0),
    };
  }
}

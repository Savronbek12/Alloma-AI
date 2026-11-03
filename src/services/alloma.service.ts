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

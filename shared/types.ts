import type { EraId, FieldId, SortOption } from "./constants.js";

export interface AllomaImage {
  /** Sayt ichidagi yo'l, masalan "/images/allomalar/alisher-navoiy.jpg". */
  src: string;
  alt: string;
  author: string;
  license: string;
  /** Rasmning asl manbasi (Wikimedia Commons sahifasi). */
  sourceUrl: string;
  wikiPage?: string;
}

export interface Alloma {
  id: number;
  slug: string;
  name: string;
  /** Tug'ilgan yil (noma'lum bo'lsa null). */
  birthYear: number | null;
  /** Vafot etgan yil (noma'lum bo'lsa null). */
  deathYear: number | null;
  /** Yillar taxminiy ekanligi. */
  yearsApproximate: boolean;
  birthPlace: string;
  era: EraId;
  fields: FieldId[];
  bio: string;
  works: string[];
  /** Portret yoki tasvir (topilmagan bo'lsa null — client avatar ko'rsatadi). */
  image: AllomaImage | null;
}

export interface ListQuery {
  q?: string | undefined;
  era?: EraId | undefined;
  field?: FieldId | undefined;
  sort: SortOption;
  page: number;
  limit: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface FacetCount<Id extends string> {
  id: Id;
  label: string;
  count: number;
}

export interface Meta {
  total: number;
  eras: (FacetCount<EraId> & { period: string })[];
  fields: FacetCount<FieldId>[];
}

export interface ApiErrorBody {
  error: {
    message: string;
    details?: unknown;
  };
}

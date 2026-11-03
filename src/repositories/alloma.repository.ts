import type { Alloma, AllomaImage } from "../../shared/types.js";
import type { AllomaInput } from "../types/alloma.js";
import { slugify } from "../utils/text.js";

/**
 * Ma'lumotlarga kirish shartnomasi. Keyinchalik PostgreSQL/MongoDB repository'si
 * shu interfeysni amalga oshirsa, service va controller'lar o'zgarmaydi.
 */
export interface AllomaRepository {
  findAll(): readonly Alloma[];
  findBySlug(slug: string): Alloma | undefined;
}

export class InMemoryAllomaRepository implements AllomaRepository {
  private readonly items: readonly Alloma[];
  private readonly bySlug: ReadonlyMap<string, Alloma>;

  constructor(
    inputs: readonly AllomaInput[],
    images: Readonly<Record<string, AllomaImage>> = {},
  ) {
    const bySlug = new Map<string, Alloma>();

    this.items = inputs.map((input, index) => {
      const slug = slugify(input.name);
      const alloma: Alloma = Object.freeze({
        ...input,
        id: index + 1,
        slug,
        yearsApproximate: input.yearsApproximate ?? false,
        image: images[slug] ?? null,
      });
      if (bySlug.has(alloma.slug)) {
        throw new Error(`Takroriy slug: "${alloma.slug}" (${alloma.name})`);
      }
      bySlug.set(alloma.slug, alloma);
      return alloma;
    });

    this.bySlug = bySlug;
  }

  findAll(): readonly Alloma[] {
    return this.items;
  }

  findBySlug(slug: string): Alloma | undefined {
    return this.bySlug.get(slug);
  }
}

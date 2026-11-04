import type { Alloma } from "./types.js";

/** 973–1048 · taxm. 820–905 · t. 1549 · v. 997 · yillari noma'lum */
export function formatYears(a: Pick<Alloma, "birthYear" | "deathYear" | "yearsApproximate">): string {
  const prefix = a.yearsApproximate ? "taxm. " : "";
  if (a.birthYear && a.deathYear) return `${prefix}${a.birthYear}–${a.deathYear}`;
  if (a.birthYear) return `${prefix}t. ${a.birthYear}`;
  if (a.deathYear) return `${prefix}v. ${a.deathYear}`;
  return "yillari noma'lum";
}

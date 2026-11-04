export { formatYears } from "../../shared/format";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Portret yo'q bo'lganda ko'rsatiladigan bitta harf: tanilgan ismning bosh harfi
 * ("Abu Rayhon Beruniy" -> "B", "Alisher Navoiy" -> "N", "Oybek" -> "O").
 */
export function monogram(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter((w) => /^\p{Lu}/u.test(w));
  return (words.at(-1) ?? name).charAt(0).toUpperCase();
}

export function $<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Element topilmadi: ${selector}`);
  return el;
}

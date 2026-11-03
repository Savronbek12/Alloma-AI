/** O'zbek lotin yozuvidagi turli apostrof belgilarini (ʻ ʼ ’ ‘ ` ') qamrab oladi. */
const APOSTROPHES = /[ʻʼ‘’`']/g;

/**
 * Qidiruv uchun matnni normallashtiradi: kichik harf, apostroflarsiz, ortiqcha bo'shliqlarsiz.
 * Natijada "G'afur", "Gʻafur" va "gafur" bir xil ko'rinishga keladi.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Abu Rayhon Beruniy" -> "abu-rayhon-beruniy", "G'afur G'ulom" -> "gafur-gulom". */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Tarixiy davrlar (server va client uchun yagona manba). */
export const ERA_IDS = [
  "ilk-orta-asr",
  "temuriylar",
  "xonliklar",
  "jadidlar",
  "zamonaviy",
] as const;

export type EraId = (typeof ERA_IDS)[number];

export const ERA_LABELS: Readonly<Record<EraId, string>> = {
  "ilk-orta-asr": "Ilk o'rta asrlar",
  temuriylar: "Temuriylar davri",
  xonliklar: "Xonliklar davri",
  jadidlar: "Jadidlar davri",
  zamonaviy: "Zamonaviy davr",
};

export const ERA_PERIODS: Readonly<Record<EraId, string>> = {
  "ilk-orta-asr": "IX–XIV asrlar",
  temuriylar: "XIV–XVI asrlar",
  xonliklar: "XVI–XIX asrlar",
  jadidlar: "XIX oxiri – XX boshi",
  zamonaviy: "XX–XXI asrlar",
};

/** Ilmiy-ijodiy yo'nalishlar. */
export const FIELD_IDS = [
  "matematika",
  "astronomiya",
  "tibbiyot",
  "falsafa",
  "hadis",
  "fiqh",
  "kalom",
  "tafsir",
  "tasavvuf",
  "tarix",
  "adabiyot",
  "tilshunoslik",
  "geografiya",
  "tabiiy-fanlar",
  "musiqa",
  "sanat",
  "pedagogika",
  "davlatchilik",
] as const;

export type FieldId = (typeof FIELD_IDS)[number];

export const FIELD_LABELS: Readonly<Record<FieldId, string>> = {
  matematika: "Matematika",
  astronomiya: "Astronomiya",
  tibbiyot: "Tibbiyot",
  falsafa: "Falsafa",
  hadis: "Hadisshunoslik",
  fiqh: "Fiqh (huquq)",
  kalom: "Kalom (aqida)",
  tafsir: "Tafsir",
  tasavvuf: "Tasavvuf",
  tarix: "Tarix",
  adabiyot: "Adabiyot",
  tilshunoslik: "Tilshunoslik",
  geografiya: "Geografiya",
  "tabiiy-fanlar": "Tabiiy fanlar",
  musiqa: "Musiqa",
  sanat: "San'at",
  pedagogika: "Ma'rifat va pedagogika",
  davlatchilik: "Davlatchilik",
};

export const SORT_OPTIONS = ["birthYear", "-birthYear", "name"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const PAGE_LIMIT_DEFAULT = 12;
/** Client butun katalogni bitta so'rovda oladi (davrlar bo'yicha guruhlash uchun). */
export const PAGE_LIMIT_MAX = 200;

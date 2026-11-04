import type { SortOption } from "../../shared/constants";
import type { Alloma, Meta } from "../../shared/types";
import { escapeHtml as e, formatYears, monogram } from "./utils";

export interface Labels {
  eraOrder: string[];
  eras: Map<string, { label: string; period: string; count: number }>;
  fields: Map<string, string>;
}

export function buildLabels(meta: Meta): Labels {
  return {
    eraOrder: meta.eras.map((x) => x.id),
    eras: new Map(meta.eras.map((x) => [x.id, { label: x.label, period: x.period, count: x.count }])),
    fields: new Map(meta.fields.map((x) => [x.id, x.label])),
  };
}

export function renderFieldOptions(meta: Meta): string {
  return (
    `<option value="">Barcha yo'nalishlar</option>` +
    meta.fields.map((f) => `<option value="${e(f.id)}">${e(f.label)} (${f.count})</option>`).join("")
  );
}

/** Imzo element: davrlar vaqt chizig'i. Har bir bo'lak eni davr davomiyligiga mutanosib (CSS'da). */
export function renderTimeline(meta: Meta, active: string | undefined): string {
  return meta.eras
    .map(
      (era) => `
      <button type="button" class="timeline__seg" data-era="${e(era.id)}"
        aria-pressed="${era.id === active}">
        <span class="timeline__period num">${e(era.period)}</span>
        <span class="timeline__name">${e(era.label)}</span>
        <span class="timeline__count num">${era.count} alloma</span>
      </button>`,
    )
    .join("");
}

function portrait(a: Alloma): string {
  const mark = monogram(a.name);
  if (!a.image) return `<span class="portrait portrait--mono" aria-hidden="true">${e(mark)}</span>`;
  const fit = a.image.fit === "contain" ? " portrait--contain" : "";
  return `<span class="portrait${fit}">
      <img src="${e(a.image.src)}" alt="" loading="lazy" decoding="async" data-fallback="${e(mark)}" />
    </span>`;
}

function fieldList(a: Alloma, labels: Labels): string {
  return a.fields.map((f) => e(labels.fields.get(f) ?? f)).join(" · ");
}

function entry(a: Alloma, labels: Labels): string {
  return `
    <article class="entry" data-era="${e(a.era)}">
      <a class="entry__link" href="#/alloma/${e(a.slug)}">
        ${portrait(a)}
        <div class="entry__body">
          <p class="entry__years num">${e(formatYears(a))}</p>
          <h3 class="entry__name">${e(a.name)}</h3>
          <p class="entry__place">${e(a.birthPlace)}</p>
        </div>
        <p class="entry__bio">${e(a.bio)}</p>
        <p class="entry__fields">${fieldList(a, labels)}</p>
      </a>
    </article>`;
}

export function renderCatalog(items: Alloma[], sort: SortOption, labels: Labels): string {
  if (items.length === 0) {
    return `<div class="state">
        <p class="state__title">Hech kim topilmadi</p>
        <p>Boshqa so'z bilan qidirib ko'ring yoki filtrlarni tozalang.</p>
      </div>`;
  }

  if (sort === "name") {
    return `<section class="era era--flat"><div class="era__grid">${items
      .map((a) => entry(a, labels))
      .join("")}</div></section>`;
  }

  const order = sort === "-birthYear" ? [...labels.eraOrder].reverse() : labels.eraOrder;
  return order
    .map((eraId) => {
      const group = items.filter((a) => a.era === eraId);
      if (group.length === 0) return "";
      const era = labels.eras.get(eraId);
      return `
        <section class="era" data-era="${e(eraId)}" aria-labelledby="era-${e(eraId)}">
          <header class="era__head">
            <p class="era__period num">${e(era?.period ?? "")}</p>
            <h2 class="era__title" id="era-${e(eraId)}">${e(era?.label ?? eraId)}</h2>
            <p class="era__count num">${group.length} alloma</p>
          </header>
          <div class="era__grid">${group.map((a) => entry(a, labels)).join("")}</div>
        </section>`;
    })
    .join("");
}

const CLOSE_ICON = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export function renderDetail(a: Alloma, labels: Labels): string {
  const photo = a.image
    ? `<figure class="detail__photo">
        <img src="${e(a.image.src)}" alt="${e(a.image.alt)}" data-fallback="${e(monogram(a.name))}" />
        <figcaption>
          ${e(a.image.author)} · ${e(a.image.license)} ·
          <a href="${e(a.image.sourceUrl)}" target="_blank" rel="noopener noreferrer">manba</a>
        </figcaption>
      </figure>`
    : "";
  const works = a.works.length
    ? `<section class="detail__works">
        <h3 class="label">Asosiy asarlari</h3>
        <ul>${a.works.map((w) => `<li>${e(w)}</li>`).join("")}</ul>
      </section>`
    : "";
  const era = labels.eras.get(a.era);

  return `
    <article class="detail" data-era="${e(a.era)}">
      <button type="button" class="detail__close" data-close aria-label="Yopish">${CLOSE_ICON}</button>
      ${photo}
      <div class="detail__content">
        <header class="detail__head">
          <p class="detail__years num">${e(formatYears(a))}</p>
          <h2 class="detail__name" id="detail-title">${e(a.name)}</h2>
          <p class="detail__meta">
            ${e(a.birthPlace)}
            <span class="era-tag">${e(era?.label ?? a.era)} · ${e(era?.period ?? "")}</span>
          </p>
        </header>
        <p class="detail__bio">${e(a.bio)}</p>
        <p class="detail__fields"><span class="label">Yo'nalishlar</span> ${fieldList(a, labels)}</p>
        ${works}
      </div>
    </article>`;
}

export function renderDetailError(message: string): string {
  return `
    <article class="detail">
      <button type="button" class="detail__close" data-close aria-label="Yopish">${CLOSE_ICON}</button>
      <div class="detail__content state">
        <p class="state__title" id="detail-title">Sahifa ochilmadi</p>
        <p>${e(message)}</p>
      </div>
    </article>`;
}

import { PAGE_LIMIT_MAX } from "../../shared/constants";
import type { ListQuery, Meta } from "../../shared/types";
import { api } from "./api";
import {
  buildLabels,
  renderCatalog,
  renderDetail,
  renderDetailError,
  renderFieldOptions,
  renderTimeline,
  type Labels,
} from "./render";
import { $, debounce, escapeHtml } from "./utils";

type State = Pick<ListQuery, "q" | "era" | "field" | "sort">;

const DEFAULT_TITLE = "Alloma-AI — O'zbek allomalari";
const state: State = { q: "", sort: "birthYear" };

const els = {
  search: $<HTMLInputElement>("#search"),
  field: $<HTMLSelectElement>("#field"),
  sort: $<HTMLSelectElement>("#sort"),
  timeline: $<HTMLElement>("#timeline"),
  catalog: $<HTMLElement>("#catalog"),
  summary: $<HTMLElement>("#summary"),
  total: $<HTMLElement>("#total"),
  random: $<HTMLButtonElement>("#random"),
  reset: $<HTMLButtonElement>("#reset"),
  dialog: $<HTMLDialogElement>("#detail"),
};

let meta: Meta;
let labels: Labels;
let controller: AbortController | undefined;

const isFiltered = () => Boolean(state.q || state.era || state.field);

async function loadCatalog(): Promise<void> {
  controller?.abort();
  controller = new AbortController();
  els.catalog.setAttribute("aria-busy", "true");
  try {
    // Katalog kichik (≈100 yozuv): hammasini bitta so'rovda olib, davrlar bo'yicha guruhlaymiz.
    const page = await api.list({ ...state, page: 1, limit: PAGE_LIMIT_MAX }, controller.signal);
    els.catalog.innerHTML = renderCatalog(page.items, state.sort, labels);
    els.summary.textContent = isFiltered()
      ? `${page.total} / ${meta.total} alloma`
      : `${meta.total} alloma`;
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    els.catalog.innerHTML = `<div class="state"><p class="state__title">Katalog yuklanmadi</p>
      <p>${escapeHtml((err as Error).message)}</p></div>`;
  } finally {
    els.catalog.removeAttribute("aria-busy");
  }
}

function update(patch: Partial<State>): void {
  Object.assign(state, patch);
  els.timeline.innerHTML = renderTimeline(meta, state.era);
  els.reset.hidden = !isFiltered();
  void loadCatalog();
}

async function openDetail(slug: string): Promise<void> {
  try {
    const alloma = await api.get(slug);
    els.dialog.innerHTML = renderDetail(alloma, labels);
    document.title = `${alloma.name} — Alloma-AI`;
  } catch (err) {
    els.dialog.innerHTML = renderDetailError((err as Error).message);
  }
  if (!els.dialog.open) els.dialog.showModal();
  els.dialog.scrollTop = 0;
}

function handleRoute(): void {
  const match = location.hash.match(/^#\/alloma\/([a-z0-9-]+)$/);
  if (match?.[1]) void openDetail(match[1]);
  else if (els.dialog.open) els.dialog.close();
}

function bindEvents(): void {
  els.search.addEventListener("input", debounce(() => update({ q: els.search.value.trim() }), 250));
  els.field.addEventListener("change", () =>
    update({ field: (els.field.value || undefined) as State["field"] }),
  );
  els.sort.addEventListener("change", () => update({ sort: els.sort.value as State["sort"] }));

  els.timeline.addEventListener("click", (ev) => {
    const seg = (ev.target as HTMLElement).closest<HTMLButtonElement>(".timeline__seg");
    if (!seg?.dataset.era) return;
    const era = seg.dataset.era as State["era"];
    update({ era: state.era === era ? undefined : era });
  });

  els.reset.addEventListener("click", () => {
    els.search.value = "";
    els.field.value = "";
    update({ q: "", era: undefined, field: undefined });
  });

  els.random.addEventListener("click", async () => {
    const a = await api.random();
    location.hash = `#/alloma/${a.slug}`;
  });

  // Dialog yopilganda (Esc, × yoki fonga bosish) URL'ni tozalaymiz.
  els.dialog.addEventListener("close", () => {
    if (location.hash) history.pushState(null, "", location.pathname + location.search);
    document.title = DEFAULT_TITLE;
  });
  els.dialog.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    if (target === els.dialog || target.closest("[data-close]")) els.dialog.close();
  });

  window.addEventListener("hashchange", handleRoute);

  // Rasm yuklanmasa — monogrammaga qaytamiz. "error" ko'tarilmaydi, shuning uchun capture.
  document.addEventListener(
    "error",
    (ev) => {
      const img = ev.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
      const figure = img.closest(".detail__photo");
      if (figure) return figure.remove();
      const holder = img.closest(".portrait");
      if (holder) {
        holder.classList.add("portrait--mono");
        holder.textContent = img.dataset.fallback;
      }
    },
    true,
  );
}

async function init(): Promise<void> {
  meta = await api.meta();
  labels = buildLabels(meta);
  els.total.textContent = String(meta.total);
  els.field.innerHTML = renderFieldOptions(meta);
  els.timeline.innerHTML = renderTimeline(meta, state.era);
  bindEvents();
  await loadCatalog();
  handleRoute();
}

init().catch((err: Error) => {
  els.catalog.innerHTML = `<div class="state"><p class="state__title">Serverga ulanib bo'lmadi</p>
    <p>${escapeHtml(err.message)}</p></div>`;
});

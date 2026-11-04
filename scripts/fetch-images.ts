/**
 * Allomalar rasmlarini Wikipedia / Wikidata / Wikimedia Commons'dan yuklab oladi.
 *
 *   npm run images:fetch            # faqat yetishmayotganlarini yuklaydi
 *   npm run images:fetch -- --force # hammasini qaytadan yuklaydi
 *
 * Qidiruv tartibi (har bir alloma uchun):
 *   1. Wikipedia maqolalari (en → qo'shimcha uz/ru → o'zbekcha nom) — maqoladagi asosiy rasm
 *   2. Topilgan maqolaning Wikidata yozuvi: P18 (tasvir), bo'lmasa P1442 (qabr/maqbara surati)
 *
 * Natija:
 *   public/images/allomalar/<slug>.<ext>  — rasm fayllari
 *   src/data/images.generated.ts          — manba, muallif va litsenziya ma'lumotlari
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AllomaImage } from "../shared/types.js";
import { allomaSeeds } from "../src/data/allomalar/index.js";
import { InMemoryAllomaRepository } from "../src/repositories/alloma.repository.js";
import { BLOCKED_IMAGES, EXTRA_TITLES, WIKI_TITLES } from "./wiki-titles.js";

const ROOT = process.cwd();
const IMAGE_DIR = path.join(ROOT, "public", "images", "allomalar");
const MANIFEST = path.join(ROOT, "src", "data", "images.generated.ts");
const THUMB_WIDTH = 480;
const USER_AGENT = "Alloma-AI-image-fetcher/1.1 (local development script)";
const FORCE = process.argv.includes("--force");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 429 / 5xx yoki tarmoq uzilishida Retry-After (yoki o'sib boruvchi kutish) bilan qayta urinadi. */
async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt >= 6) throw err;
      console.warn(`  … tarmoq xatosi (${(err as Error).message}), ${5 * attempt} s kutilmoqda`);
      await sleep(5000 * attempt);
      continue;
    }
    if (res.ok) return res;
    if (attempt >= 6 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`${res.status} ${url}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 4000 * attempt;
    console.warn(`  … ${res.status}, ${Math.round(wait / 1000)} s kutilmoqda`);
    await sleep(wait);
  }
}

async function getJson<T>(url: string): Promise<T> {
  return (await (await fetchWithRetry(url)).json()) as T;
}

const stripHtml = (html = "") => {
  const text = html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  // Commons ba'zan "Unknown authorUnknown author" kabi takror qaytaradi.
  const half = text.length / 2;
  return Number.isInteger(half) && text.slice(0, half) === text.slice(half) ? text.slice(0, half) : text;
};

// ---------- Wikipedia ----------

interface WikiPage {
  title: string;
  missing?: boolean;
  pageimage?: string;
  thumbnail?: { source: string };
  pageprops?: { wikibase_item?: string; disambiguation?: string };
}

async function lookupPage(lang: string, title: string) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&prop=pageimages|pageprops&ppprop=wikibase_item|disambiguation` +
    `&piprop=thumbnail|name&pilicense=free&pithumbsize=${THUMB_WIDTH}` +
    `&titles=${encodeURIComponent(title)}`;
  const data = await getJson<{ query?: { pages?: WikiPage[] } }>(url);
  const page = data.query?.pages?.[0];
  if (!page || page.missing || page.pageprops?.disambiguation !== undefined) return null;
  return {
    lang,
    pageTitle: page.title,
    qid: page.pageprops?.wikibase_item,
    file: page.pageimage,
    thumb: page.thumbnail?.source,
  };
}

// ---------- Wikidata + Commons ----------

type ImageKind = "portrait" | "grave";

async function wikidataImage(qid: string): Promise<{ file: string; kind: ImageKind } | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity=${qid}`;
  const data = await getJson<{
    claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>;
  }>(url);
  const first = (prop: string) => {
    const v = data.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
    return typeof v === "string" ? v : undefined;
  };
  const portrait = first("P18");
  if (portrait) return { file: portrait, kind: "portrait" };
  const grave = first("P1442");
  if (grave) return { file: grave, kind: "grave" };
  return null;
}

interface CommonsInfo {
  thumb: string;
  sourceUrl: string;
  license: string;
  author: string;
}

async function commonsInfo(file: string, host = "commons.wikimedia.org"): Promise<CommonsInfo | null> {
  const url =
    `https://${host}/w/api.php?action=query&format=json&formatversion=2` +
    `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${THUMB_WIDTH}` +
    `&titles=${encodeURIComponent("File:" + file)}`;
  const data = await getJson<{
    query?: {
      pages?: {
        imageinfo?: {
          url: string;
          thumburl?: string;
          descriptionurl: string;
          extmetadata?: Record<string, { value: string } | undefined>;
        }[];
      }[];
    };
  }>(url);
  const info = data.query?.pages?.[0]?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  return {
    thumb: info.thumburl ?? info.url,
    sourceUrl: info.descriptionurl,
    license: stripHtml(meta.LicenseShortName?.value) || "Noma'lum litsenziya",
    author: stripHtml(meta.Artist?.value) || "Noma'lum muallif",
  };
}

// ---------- Nomzodlar ----------

/** uz.wikipedia "oʻ"/"gʻ" (U+02BB) va boshqa joylarda "ʼ" (U+02BC) ishlatadi. */
function toUzWikiSpelling(name: string): string {
  return name.replace(/([OoGg])'/g, "$1ʻ").replace(/'/g, "ʼ");
}

function candidates(slug: string, name: string): { lang: string; title: string }[] {
  const raw = [
    ...(WIKI_TITLES[slug] ?? []),
    ...(EXTRA_TITLES[slug] ?? []),
    `uz:${toUzWikiSpelling(name)}`,
    `uz:${name}`,
  ];
  const seen = new Set<string>();
  return raw
    .map((t) => {
      const m = t.match(/^(en|uz|ru):(.+)$/);
      return m ? { lang: m[1]!, title: m[2]! } : { lang: "en", title: t };
    })
    .filter((c) => {
      const key = `${c.lang}:${c.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

interface Found {
  via: string;
  file: string;
  kind: ImageKind;
  info: CommonsInfo;
  wikiPage?: string;
}

async function findImage(slug: string, name: string): Promise<Found | null> {
  let qid: string | undefined;
  let qidPage: string | undefined;

  for (const c of candidates(slug, name)) {
    let page = null;
    try {
      page = await lookupPage(c.lang, c.title);
    } catch (err) {
      // Qayta urinishlardan keyin ham tarmoq ishlamasa — "topilmadi" deb yolg'on xulosa qilmaymiz.
      if ((err as Error).message === "fetch failed" || (err as Error).name === "TimeoutError") throw err;
      console.warn(`  ! ${c.lang}:${c.title} — ${(err as Error).message}`);
    }
    await sleep(500);
    if (!page) continue;

    const wikiPage = `https://${page.lang}.wikipedia.org/wiki/${encodeURIComponent(page.pageTitle.replace(/ /g, "_"))}`;
    if (!qid && page.qid) {
      qid = page.qid;
      qidPage = wikiPage;
    }
    if (page.file && page.thumb) {
      // Maqoladagi rasm: metama'lumot avval Commons'dan, bo'lmasa shu wikidan.
      const info =
        (await commonsInfo(page.file)) ?? (await commonsInfo(page.file, `${page.lang}.wikipedia.org`));
      if (info) {
        return { via: `${page.lang}:${page.pageTitle}`, file: page.file, kind: "portrait", info: { ...info, thumb: page.thumb }, wikiPage };
      }
    }
  }

  if (qid) {
    const wd = await wikidataImage(qid);
    if (wd) {
      const info = await commonsInfo(wd.file);
      if (info) return { via: `wikidata:${qid}`, file: wd.file, kind: wd.kind, info, wikiPage: qidPage };
    }
  }
  return null;
}

// ---------- Asosiy jarayon ----------

async function loadExisting(): Promise<Record<string, AllomaImage>> {
  if (FORCE || !existsSync(MANIFEST)) return {};
  const text = await readFile(MANIFEST, "utf8");
  const json = text.slice(text.indexOf("{", text.indexOf("=")), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(json) as Record<string, AllomaImage>;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  await mkdir(IMAGE_DIR, { recursive: true });
  const allomalar = new InMemoryAllomaRepository(allomaSeeds).findAll();
  const manifest = await loadExisting();
  const missing: string[] = [];

  for (const [i, a] of allomalar.entries()) {
    const tag = `[${String(i + 1).padStart(3)}/${allomalar.length}] ${a.name}`;
    if (BLOCKED_IMAGES.has(a.slug)) {
      delete manifest[a.slug];
      continue;
    }
    const existing = manifest[a.slug];
    if (existing && existsSync(path.join(ROOT, "public", existing.src))) continue;

    try {
      const found = await findImage(a.slug, a.name);
      if (!found) {
        console.log(`${tag} — rasm topilmadi`);
        missing.push(a.name);
        continue;
      }
      const ext = (path.extname(new URL(found.info.thumb).pathname) || ".jpg").toLowerCase();
      const fileName = `${a.slug}${ext}`;
      const res = await fetchWithRetry(found.info.thumb);
      await writeFile(path.join(IMAGE_DIR, fileName), Buffer.from(await res.arrayBuffer()));

      manifest[a.slug] = {
        src: `/images/allomalar/${fileName}`,
        alt: found.kind === "grave" ? `${a.name} maqbarasi` : `${a.name} tasviri`,
        author: found.info.author,
        license: found.info.license,
        sourceUrl: found.info.sourceUrl,
        ...(found.wikiPage ? { wikiPage: found.wikiPage } : {}),
      };
      console.log(`${tag} — ✔ [${found.kind}] ${found.via} → ${found.file} (${found.info.license})`);
    } catch (err) {
      console.log(`${tag} — xato: ${(err as Error).message}`);
      missing.push(a.name);
    }
    await sleep(800);
  }

  const sorted = Object.fromEntries(Object.entries(manifest).sort(([x], [y]) => x.localeCompare(y)));
  await writeFile(
    MANIFEST,
    `// Avtomatik yaratilgan: npm run images:fetch. Qo'lda tahrirlash mumkin.\n` +
      `import type { AllomaImage } from "../../shared/types.js";\n\n` +
      `export const allomaImages: Readonly<Record<string, AllomaImage>> = ${JSON.stringify(sorted, null, 2)};\n`,
  );

  console.log(`\nRasmlar: ${Object.keys(sorted).length}/${allomalar.length}`);
  if (missing.length) console.log(`Topilmadi (${missing.length}): ${missing.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

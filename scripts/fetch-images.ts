/**
 * Allomalar rasmlarini Wikipedia / Wikimedia Commons'dan yuklab oladi.
 *
 *   npm run images:fetch            # faqat yetishmayotganlarini yuklaydi
 *   npm run images:fetch -- --force # hammasini qaytadan yuklaydi
 *
 * Natija:
 *   public/images/allomalar/<slug>.<ext>  — rasm fayllari
 *   src/data/images.generated.ts          — manba, muallif va litsenziya ma'lumotlari
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { allomaSeeds } from "../src/data/allomalar/index.js";
import { InMemoryAllomaRepository } from "../src/repositories/alloma.repository.js";
import type { AllomaImage } from "../shared/types.js";
import { BLOCKED_IMAGES, WIKI_TITLES } from "./wiki-titles.js";

const ROOT = process.cwd();
const IMAGE_DIR = path.join(ROOT, "public", "images", "allomalar");
const MANIFEST = path.join(ROOT, "src", "data", "images.generated.ts");
const THUMB_WIDTH = 480;
const USER_AGENT = "Alloma-AI-image-fetcher/1.0 (local development script)";
const FORCE = process.argv.includes("--force");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 429 / 5xx bo'lsa Retry-After (yoki o'sib boruvchi kutish) bilan qayta urinadi. */
async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
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

interface PageImageResponse {
  query?: {
    pages?: { title: string; missing?: boolean; pageimage?: string; thumbnail?: { source: string } }[];
  };
}

interface ImageInfoResponse {
  query?: {
    pages?: {
      imageinfo?: {
        descriptionurl: string;
        extmetadata?: Record<string, { value: string } | undefined>;
      }[];
    }[];
  };
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

async function findPageImage(lang: string, title: string) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1` +
    `&prop=pageimages&piprop=thumbnail|name&pilicense=free&pithumbsize=${THUMB_WIDTH}` +
    `&titles=${encodeURIComponent(title)}`;
  const data = await getJson<PageImageResponse>(url);
  const page = data.query?.pages?.[0];
  if (!page || page.missing || !page.thumbnail || !page.pageimage) return null;
  return { lang, pageTitle: page.title, file: page.pageimage, thumb: page.thumbnail.source };
}

async function fileMetadata(lang: string, file: string) {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2` +
    `&prop=imageinfo&iiprop=url|extmetadata&titles=${encodeURIComponent("File:" + file)}`;
  const data = await getJson<ImageInfoResponse>(url);
  const info = data.query?.pages?.[0]?.imageinfo?.[0];
  const meta = info?.extmetadata ?? {};
  return {
    sourceUrl: info?.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
    license: stripHtml(meta.LicenseShortName?.value) || "Noma'lum litsenziya",
    author: stripHtml(meta.Artist?.value) || "Noma'lum muallif",
  };
}

function candidates(slug: string, name: string): { lang: string; title: string }[] {
  const list = (WIKI_TITLES[slug] ?? []).map((t) => {
    const m = t.match(/^(en|uz|ru):(.+)$/);
    return m ? { lang: m[1]!, title: m[2]! } : { lang: "en", title: t };
  });
  list.push({ lang: "uz", title: name });
  return list;
}

async function loadExisting(): Promise<Record<string, AllomaImage>> {
  if (FORCE || !existsSync(MANIFEST)) return {};
  const text = await readFile(MANIFEST, "utf8");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
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
      console.log(`${tag} — bloklangan, o'tkazildi`);
      delete manifest[a.slug];
      continue;
    }
    const existing = manifest[a.slug];
    if (existing && existsSync(path.join(ROOT, "public", existing.src))) {
      console.log(`${tag} — bor, o'tkazildi`);
      continue;
    }

    let found = null;
    for (const c of candidates(a.slug, a.name)) {
      try {
        found = await findPageImage(c.lang, c.title);
      } catch (err) {
        console.warn(`  ! ${c.lang}:${c.title} — ${(err as Error).message}`);
      }
      if (found) break;
      await sleep(600);
    }

    if (!found) {
      console.log(`${tag} — rasm topilmadi`);
      missing.push(a.name);
      continue;
    }

    try {
      const ext = (path.extname(new URL(found.thumb).pathname) || ".jpg").toLowerCase();
      const fileName = `${a.slug}${ext}`;
      const res = await fetchWithRetry(found.thumb);
      await writeFile(path.join(IMAGE_DIR, fileName), Buffer.from(await res.arrayBuffer()));

      const meta = await fileMetadata(found.lang, found.file);
      manifest[a.slug] = {
        src: `/images/allomalar/${fileName}`,
        alt: `${a.name} tasviri`,
        author: meta.author,
        license: meta.license,
        sourceUrl: meta.sourceUrl,
        wikiPage: `https://${found.lang}.wikipedia.org/wiki/${encodeURIComponent(found.pageTitle.replace(/ /g, "_"))}`,
      };
      console.log(`${tag} — ✔ ${found.lang}:${found.pageTitle} → ${found.file} (${meta.license})`);
    } catch (err) {
      console.log(`${tag} — xato: ${(err as Error).message}`);
      missing.push(a.name);
    }
    await sleep(1000);
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

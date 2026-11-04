import { readFileSync } from "node:fs";
import path from "node:path";
import { Router } from "express";

/**
 * Qidiruv tizimlari (Google) uchun: bosh sahifaga canonical/OG/JSON-LD teglari,
 * robots.txt, sitemap.xml va Search Console tasdiqlash kodi.
 */

export const SITE_NAME = "Alloma AI";

export interface SeoOptions {
  publicDir: string;
  /** Ommaviy manzil (https://...). Berilmasa — absolyut havolalarsiz ishlaydi. */
  siteUrl?: string | undefined;
  /** Google Search Console «HTML teg» usulidagi content qiymati yoki google….html fayl nomi. */
  googleVerification?: string | undefined;
  /** Telegram bot havolasi (sameAs) — bot username ma'lum bo'lsa. */
  botUsername?: () => string | undefined;
}

const escapeAttr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function seoHeadTags(options: Omit<SeoOptions, "publicDir">): string {
  const { siteUrl } = options;
  const description =
    "Alloma AI — o'zbek allomalari: hayoti, ilmiy merosi va asarlari. Barcha fanlar bo'yicha AI yordamchi.";
  const tags: string[] = [];
  const verification = options.googleVerification;
  if (verification && !verification.endsWith(".html")) {
    tags.push(`<meta name="google-site-verification" content="${escapeAttr(verification)}" />`);
  }
  tags.push(
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="Alloma AI — O'zbek allomalari va AI yordamchi" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:locale" content="uz_UZ" />`,
    `<meta name="twitter:card" content="summary" />`,
  );
  if (siteUrl) {
    tags.push(
      `<link rel="canonical" href="${siteUrl}/" />`,
      `<meta property="og:url" content="${siteUrl}/" />`,
      `<meta property="og:image" content="${siteUrl}/logo.jpg" />`,
    );
  }

  const bot = options.botUsername?.();
  // Google sayt nomini shu ma'lumotdan oladi (https://developers.google.com/search/docs/appearance/site-names).
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: SITE_NAME,
      alternateName: ["Alloma-AI", "AllomaAI", "Alloma"],
      ...(siteUrl ? { url: `${siteUrl}/` } : {}),
      inLanguage: "uz",
      description,
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: SITE_NAME,
      ...(siteUrl ? { url: `${siteUrl}/`, logo: `${siteUrl}/logo.jpg` } : {}),
      ...(bot ? { sameAs: [`https://t.me/${bot}`] } : {}),
    },
  ];
  // "<" ni escape qilamiz — JSON ichidagi matn </script> bilan sahifani buzmasin.
  tags.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>`);
  return tags.join("\n    ");
}

export function createSeoRouter(options: SeoOptions): Router {
  const router = Router();
  const template = readFileSync(path.join(options.publicDir, "index.html"), "utf8");
  let cached: string | undefined;
  let cachedFor: string | undefined;

  const renderIndex = () => {
    // Bot username start()'da (getMe) aniqlanadi — o'zgarsa qayta yig'amiz.
    const key = options.botUsername?.() ?? "";
    if (cached === undefined || cachedFor !== key) {
      cached = template.replace("<!--seo-->", seoHeadTags(options));
      cachedFor = key;
    }
    return cached;
  };

  router.get(["/", "/index.html"], (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(renderIndex());
  });

  router.get("/robots.txt", (_req, res) => {
    const lines = ["User-agent: *", "Allow: /", "Disallow: /api/", "Disallow: /app/", "Disallow: /telegram/"];
    if (options.siteUrl) lines.push("", `Sitemap: ${options.siteUrl}/sitemap.xml`);
    res.type("text/plain").send(`${lines.join("\n")}\n`);
  });

  router.get("/sitemap.xml", (_req, res) => {
    if (!options.siteUrl) {
      res.sendStatus(404);
      return;
    }
    res
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${options.siteUrl}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n</urlset>\n`,
      );
  });

  // Search Console «HTML fayl» usuli: GOOGLE_SITE_VERIFICATION=google1234abcd.html
  const file = options.googleVerification;
  if (file && /^google[0-9a-z]+\.html$/i.test(file)) {
    router.get(`/${file}`, (_req, res) => {
      res.type("html").send(`google-site-verification: ${file}`);
    });
  }

  return router;
}

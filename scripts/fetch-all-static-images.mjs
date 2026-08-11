// Fetch all static images to public/static/{category}/ and write url-map.json for replacements.
//
//   node scripts/fetch-all-static-images.mjs

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import {
  HERO_SOURCES,
  MISC_SOURCES,
  SEAL_SOURCES,
  staticCdnUrl,
} from "./static-image-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticRoot = path.join(root, "public", "static");
const urlMap = {};
const FETCH_DELAY_MS = 1200;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchBuffer(url, attempt = 1) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "A-House-Divided-static-asset-uploader/1.0",
      Accept: "image/*,*/*",
    },
    redirect: "follow",
  });
  if (res.status === 429 && attempt <= 5) {
    const wait = FETCH_DELAY_MS * attempt * 2;
    console.warn(`  rate limited, waiting ${wait}ms…`);
    await sleep(wait);
    return fetchBuffer(url, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function unsplashSlug(url) {
  const m = url.match(/photo-([a-z0-9-]+)/i);
  if (!m) throw new Error(`Cannot derive slug from Unsplash URL: ${url}`);
  return `photo-${m[1]}`;
}

async function saveRaster(category, slug, sourceUrl, { width = 1280, quality = 80 } = {}) {
  const isSvg = sourceUrl.toLowerCase().includes(".svg");
  const extGuess = isSvg ? "png" : "webp";
  const dir = path.join(staticRoot, category);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug}.${extGuess}`);
  if (existsSync(file)) {
    const cdn = staticCdnUrl(category, slug, extGuess);
    urlMap[sourceUrl] = cdn;
    return cdn;
  }

  await sleep(FETCH_DELAY_MS);
  const raw = await fetchBuffer(sourceUrl);
  let out;
  let ext;
  const rawIsSvg = isSvg || raw.slice(0, 100).toString().includes("<svg");
  if (rawIsSvg) {
    out = await sharp(raw)
      .resize({ width: Math.min(width, 512) })
      .png()
      .toBuffer();
    ext = "png";
  } else {
    out = await sharp(raw).resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
    ext = "webp";
  }
  const outFile = path.join(dir, `${slug}.${ext}`);
  writeFileSync(outFile, out);
  const cdn = staticCdnUrl(category, slug, ext);
  urlMap[sourceUrl] = cdn;
  console.log(`  ✓ ${category}/${slug}.${ext} (${(out.length / 1024).toFixed(1)} KB)`);
  return cdn;
}

function collectUrlsFromFile(filePath, pattern) {
  const text = readFileSync(path.join(root, filePath), "utf8");
  return [...text.matchAll(pattern)].map((m) => m[1] ?? m[0]);
}

async function main() {
  const mapFile = path.join(staticRoot, "url-map.json");
  if (existsSync(mapFile)) {
    Object.assign(urlMap, JSON.parse(readFileSync(mapFile, "utf8")));
  }

  const failures = [];

  console.log("Fetching hero banners…");
  for (const [slug, url] of Object.entries(HERO_SOURCES)) {
    try {
      const w = slug === "imf-logo" ? 512 : 1280;
      await saveRaster("heroes", slug, url, { width: w });
    } catch (e) {
      console.error(`  ✗ heroes/${slug}: ${e.message}`);
      failures.push({ category: "heroes", slug, url, error: e.message });
    }
  }

  console.log("Fetching misc page heroes…");
  for (const [slug, url] of Object.entries(MISC_SOURCES)) {
    try {
      await saveRaster("misc", slug, url);
    } catch (e) {
      console.error(`  ✗ misc/${slug}: ${e.message}`);
      failures.push({ category: "misc", slug, url, error: e.message });
    }
  }

  console.log("Fetching executive seals…");
  for (const [slug, url] of Object.entries(SEAL_SOURCES)) {
    try {
      await saveRaster("seals", slug.toLowerCase(), url, { width: 330, quality: 90 });
    } catch (e) {
      console.error(`  ✗ seals/${slug}: ${e.message}`);
      failures.push({ category: "seals", slug, url, error: e.message });
    }
  }

  console.log("Fetching crisis template heroes…");
  const crisisText = readFileSync(path.join(root, "src/lib/crises/templates.ts"), "utf8");
  const crisisUrls = [
    ...crisisText.matchAll(/heroImage:\s*"(https:\/\/images\.unsplash\.com\/[^"]+)"/g),
    ...crisisText.matchAll(/heroImage:\s*\n\s*"(https:\/\/images\.unsplash\.com\/[^"]+)"/g),
  ].map((m) => m[1]);
  for (const url of [...new Set(crisisUrls)]) {
    try {
      await saveRaster("crises", unsplashSlug(url), url);
    } catch (e) {
      console.error(`  ✗ crises ${url}: ${e.message}`);
      failures.push({ category: "crises", slug: unsplashSlug(url), url, error: e.message });
    }
  }

  console.log("Fetching PREE event images…");
  const preeUrls = [
    ...collectUrlsFromFile(
      "src/lib/events/pree/seedDefinitions.ts",
      /image:\s*\n\s*"(https:\/\/images\.unsplash\.com\/[^"]+)"/g
    ),
    ...collectUrlsFromFile(
      "src/lib/events/pree/countryDefinitions.ts",
      /image:\s*\n\s*"(https:\/\/images\.unsplash\.com\/[^"]+)"/g
    ),
  ];
  for (const url of [...new Set(preeUrls)]) {
    try {
      await saveRaster("pree", unsplashSlug(url), url, { width: 1200 });
    } catch (e) {
      console.error(`  ✗ pree ${url}: ${e.message}`);
      failures.push({ category: "pree", slug: unsplashSlug(url), url, error: e.message });
    }
  }

  console.log("Fetching NPP politician portraits…");
  const politicians = JSON.parse(
    readFileSync(path.join(root, "src/data/npp-politician-images.json"), "utf8")
  );
  for (const entry of politicians) {
    if (!entry.url) continue;
    try {
      await saveRaster("npp-politicians", entry.id, entry.url, { width: 500, quality: 82 });
      urlMap[`/api/images/npp-politicians/${entry.id}`] = staticCdnUrl(
        "npp-politicians",
        entry.id,
        "webp"
      );
    } catch (e) {
      console.error(`  ✗ npp-politicians/${entry.id}: ${e.message}`);
      failures.push({
        category: "npp-politicians",
        slug: entry.id,
        url: entry.url,
        error: e.message,
      });
    }
  }

  console.log("Fetching NPP avatar pool…");
  const nppPool = JSON.parse(readFileSync(path.join(root, "src/data/npp-images.json"), "utf8"));
  for (const entry of nppPool.images ?? []) {
    const src = entry.thumbUrl || entry.originalUrl;
    if (!src) continue;
    try {
      await saveRaster("npp-avatars", entry.id, src, { width: 500, quality: 82 });
    } catch (e) {
      console.error(`  ✗ npp-avatars/${entry.id}: ${e.message}`);
      failures.push({ category: "npp-avatars", slug: entry.id, url: src, error: e.message });
    }
  }

  // Hero API paths → CDN (backwards compat redirects)
  for (const slug of Object.keys(HERO_SOURCES)) {
    const ext = slug === "imf-logo" ? "png" : "webp";
    urlMap[`/api/images/hero/${slug}`] = staticCdnUrl("heroes", slug, ext);
  }

  writeFileSync(path.join(staticRoot, "url-map.json"), JSON.stringify(urlMap, null, 2));
  if (failures.length) {
    writeFileSync(path.join(staticRoot, "fetch-failures.json"), JSON.stringify(failures, null, 2));
    console.warn(`\n${failures.length} fetch failure(s) — see public/static/fetch-failures.json`);
  }
  console.log(`\nWrote ${Object.keys(urlMap).length} URL mappings to public/static/url-map.json`);
  console.log("Done. Run: node scripts/upload-all-static-images-via-railway.mjs");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

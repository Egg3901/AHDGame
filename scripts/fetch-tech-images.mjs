// Fetch REAL tech-tier images and write optimized WebP to public/static/tech/
// for upload via scripts/upload-tech-images-to-r2.mjs. No AI generation.
//
// Tiers are shared per (lane, sector, decade): 6 corporate + 17×6 sector = 108.
// Sources live in scripts/tech-image-sources.json (key -> image URL). On first
// run the template is generated with every key empty — populate it with
// license-safe URLs (Wikimedia Commons PD/CC; Unsplash/Pexels free) and re-run.
// Empty entries fall back to a neutral placeholder so the UI always has art.
//
//   node scripts/fetch-tech-images.mjs
//   railway run --service "Main Site" node scripts/upload-tech-images-to-r2.mjs

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "static", "tech");
const sourcesPath = path.join(root, "scripts", "tech-image-sources.json");

const DECADES = ["1979", "1989", "1999", "2009", "2019", "2029"];
const SECTORS = [
  "financial",
  "media",
  "manufacturing",
  "chemical_industries",
  "healthcare",
  "retail",
  "automobiles",
  "technology",
  "energy",
  "agriculture",
  "real_estate",
  "construction",
  "defense",
  "telecommunications",
  "entertainment",
  "logistics",
  "extraction",
];

/** Every tier key, matching tierImageUrl() in src/lib/constants/techTree/images.ts. */
function allKeys() {
  const keys = [];
  for (const d of DECADES) keys.push(`corp/${d}`);
  for (const s of SECTORS) for (const d of DECADES) keys.push(`sector/${s}/${d}`);
  return keys;
}

function loadOrInitSources() {
  if (!existsSync(sourcesPath)) {
    const template = {
      _README: "Map each tier key to a license-safe real image URL. Empty = placeholder.",
    };
    for (const k of allKeys()) template[k] = "";
    writeFileSync(sourcesPath, JSON.stringify(template, null, 2));
    console.log(`Wrote source template with ${allKeys().length} keys to ${sourcesPath}.`);
    console.log("Populate it with real image URLs, then re-run this script.");
    return null;
  }
  return JSON.parse(readFileSync(sourcesPath, "utf8"));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wikimedia requires a descriptive User-Agent with contact info for automated
// downloads, and throttles bursts — fetch slowly with backoff on 429.
const UA =
  "A-House-Divided/1.0 (https://ahousedividedgame.com; admin@ahousedividedgame.com) tech-asset-fetcher";

async function fetchBuffer(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429 || res.status === 503) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error("429 after retries");
}

async function writeWebp(buf, key) {
  const dest = path.join(outDir, `${key}.webp`);
  mkdirSync(path.dirname(dest), { recursive: true });
  const out = await sharp(buf)
    .resize(640, 200, { fit: "cover", position: "attention" })
    .webp({ quality: 82 })
    .toBuffer();
  writeFileSync(dest, out);
  return dest;
}

async function writePlaceholder() {
  const dest = path.join(outDir, "placeholder.webp");
  mkdirSync(outDir, { recursive: true });
  const buf = await sharp({
    create: { width: 640, height: 200, channels: 3, background: { r: 30, g: 41, b: 59 } },
  })
    .webp({ quality: 70 })
    .toBuffer();
  writeFileSync(dest, buf);
  console.log(`  ✓ placeholder.webp`);
}

async function main() {
  const sources = loadOrInitSources();
  if (!sources) return;
  mkdirSync(outDir, { recursive: true });

  const credits = {};
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const key of allKeys()) {
    const url = (sources[key] || "").trim();
    if (!url) {
      skipped++;
      continue;
    }
    // Resume: skip tiers already converted so re-runs only fill the gaps.
    if (existsSync(path.join(outDir, `${key}.webp`))) {
      credits[key] = url;
      ok++;
      continue;
    }
    try {
      const raw = await fetchBuffer(url);
      await writeWebp(raw, key);
      credits[key] = url;
      console.log(`  ✓ ${key}.webp`);
      ok++;
      await sleep(900);
    } catch (e) {
      console.warn(`  ! ${key}: ${e.message} — will use placeholder`);
      failed++;
    }
  }

  await writePlaceholder();
  writeFileSync(path.join(outDir, "CREDITS.json"), JSON.stringify(credits, null, 2));
  console.log(
    `Done. fetched=${ok} skipped(empty)=${skipped} failed=${failed}. Credits → public/static/tech/CREDITS.json`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

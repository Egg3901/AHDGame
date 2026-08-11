// Fetch the era/country action-card art listed in scripts/action-image-sources.json
// and write optimised WebP under public/static/actions/<era>[/<country>]/<slug>.webp,
// ready for scripts/upload-action-images-to-r2.mjs.
//
//   node scripts/fetch-action-images.mjs           # all entries
//   node scripts/fetch-action-images.mjs 1953/DD   # only keys with this prefix
//
// The legacy flat set (public/static/actions/<slug>.webp) is the pre-era
// fallback for worlds on an era with no uploaded set; it is intentionally NOT
// regenerated here. Its sources are recorded in git history.
//
// Every image is converted to greyscale. The sources span colour, sepia and
// deteriorated colour negatives (the 1952 South Bend rally has a heavy magenta
// cast), and a single tonal treatment is what makes a mixed-archive set read as
// one deliberate period collection rather than a grab-bag.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, "public", "static", "actions");
const sourcesFile = path.join(root, "scripts", "action-image-sources.json");

/** Hero art is a full-bleed banner; cards render at most ~430px wide. */
const widthForSlug = (slug) => (slug === "hero" ? 1600 : 900);

/**
 * Card art is pre-cropped to 2:1 so framing is decided here, once, instead of
 * being left to a centred `object-cover` in a 2.4:1 box — which decapitated the
 * white-tie group shot on `1953/US/buildDonorBase`. Entries can set `"gravity"`
 * (a sharp position: "top", "north", "bottom", …) when the subject is not
 * centred. Heroes are left uncropped; `ActionsHero` positions them in CSS.
 */
const CARD_CROP = { width: 900, height: 450 };

const filter = process.argv[2] ?? "";
const UA = "A-House-Divided-static-asset-uploader/1.0 (ops@lakesidegames.net)";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Commons rate-limits (429s) bulk fetches of full-resolution originals and asks
 * callers to take thumbnails instead. Ask the API for a rendered thumbnail at
 * the width we actually need — kinder to the servers, and it saves pulling a
 * 12000px TIFF to make a 900px card image.
 */
async function commonsThumbUrl(sourceUrl, width) {
  const file = sourceUrl.split("/").pop();
  if (!file) return sourceUrl;
  const title = "File:" + decodeURIComponent(file).replace(/_/g, " ");
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    titles: title,
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: String(width),
  });
  const res = await fetch(`${COMMONS_API}?${params}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`imageinfo ${res.status} ${res.statusText}`);
  const json = await res.json();
  const page = Object.values(json.query?.pages ?? {})[0];
  if (page?.missing !== undefined) throw new Error(`no such Commons file: ${title}`);
  // Falls back to the original when the file is already narrower than `width`.
  return page?.imageinfo?.[0]?.thumburl ?? page?.imageinfo?.[0]?.url ?? sourceUrl;
}

async function fetchBuffer(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429 || attempt === 3) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    await sleep(2000 * (attempt + 1));
  }
  throw new Error("unreachable");
}

async function main() {
  const sources = JSON.parse(readFileSync(sourcesFile, "utf8"));
  const entries = Object.entries(sources).filter(
    ([key]) => !key.startsWith("_") && key.startsWith(filter)
  );

  if (!entries.length) {
    console.error(`No source entries match "${filter}".`);
    process.exit(1);
  }

  console.log(`Writing ${entries.length} optimised WebP to ${outRoot}…`);
  let failed = 0;

  for (const [key, entry] of entries) {
    const slug = key.split("/").pop();
    const width = widthForSlug(slug);
    const isHero = slug === "hero";
    try {
      const raw = await fetchBuffer(await commonsThumbUrl(entry.url, width));
      const pipeline = sharp(raw);
      if (isHero) {
        pipeline.resize({ width, withoutEnlargement: true });
      } else {
        pipeline.resize({
          ...CARD_CROP,
          fit: "cover",
          position: entry.gravity ?? "centre",
          withoutEnlargement: true,
        });
      }
      const optimized = await pipeline
        .greyscale()
        // Gentle contrast lift: archive scans are flat, and the card scrim eats
        // another stop of separation on top of that.
        .linear(1.08, -8)
        .webp({ quality: 82 })
        .toBuffer();
      mkdirSync(path.join(outRoot, path.dirname(key)), { recursive: true });
      writeFileSync(path.join(outRoot, `${key}.webp`), optimized);
      const meta = await sharp(optimized).metadata();
      console.log(
        `  ✓ ${key}.webp  ${meta.width}x${meta.height}  ${(optimized.length / 1024).toFixed(1)} KB  [${entry.license}]`
      );
    } catch (e) {
      failed++;
      console.error(`  ✗ ${key}: ${e.message}`);
    }
    await sleep(400); // stay well inside Commons' rate limit
  }

  if (failed) {
    console.error(`\n${failed} image(s) failed.`);
    process.exit(1);
  }
  console.log("\nDone. Run: node scripts/upload-action-images-to-r2.mjs");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

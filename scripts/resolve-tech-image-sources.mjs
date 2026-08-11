// Resolve REAL image URLs for every tech tier from Wikimedia Commons (freely
// licensed PD/CC). Queries the Commons API with a curated search term per tier,
// picks a suitable landscape photo, and writes:
//   - scripts/tech-image-sources.json        (key -> canonical thumb URL)
//   - scripts/tech-image-credits.json         (key -> { title, license page })
// Then run: node scripts/fetch-tech-images.mjs && railway run … upload
//
//   node scripts/resolve-tech-image-sources.mjs
//
// Keys match tierImageUrl() in src/lib/constants/techTree/images.ts:
//   corp/<decade>  and  sector/<sectorType>/<decade>

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DECADES = ["1979", "1989", "1999", "2009", "2019", "2029"];

// One topical, image-rich search term per (sector, decade). Corporate is keyed by decade.
const CORPORATE_TERMS = {
  1979: "mainframe computer",
  1989: "vintage personal computer",
  1999: "server room 1990s",
  2009: "data center servers",
  2019: "open plan office technology",
  2029: "artificial intelligence data center",
};

const SECTOR_TERMS = {
  energy: [
    "oil refinery",
    "power plant",
    "offshore oil platform",
    "wind farm",
    "solar power plant",
    "nuclear fusion reactor",
  ],
  technology: [
    "microprocessor",
    "personal computer 1980s",
    "server room",
    "smartphone",
    "data center servers",
    "supercomputer",
  ],
  manufacturing: [
    "assembly line",
    "industrial robot",
    "factory automation",
    "3d printing",
    "smart factory",
    "robotic factory",
  ],
  financial: [
    "stock exchange floor",
    "trading floor",
    "wall street",
    "stock market screen",
    "mobile banking",
    "cryptocurrency",
  ],
  media: [
    "television studio",
    "cable television",
    "newsroom",
    "smartphone video streaming",
    "social media",
    "virtual reality headset",
  ],
  chemical_industries: [
    "chemical plant",
    "oil refinery",
    "pharmaceutical laboratory",
    "chemical factory",
    "biotechnology laboratory",
    "laboratory automation",
  ],
  healthcare: [
    "hospital laboratory",
    "mri scanner",
    "hospital computer",
    "telemedicine",
    "surgical robot",
    "medical artificial intelligence",
  ],
  retail: [
    "supermarket checkout",
    "shopping mall",
    "distribution warehouse",
    "ecommerce warehouse",
    "self checkout",
    "warehouse robot",
  ],
  automobiles: [
    "car assembly line",
    "automobile factory robot",
    "car manufacturing",
    "hybrid car",
    "electric vehicle factory",
    "autonomous car",
  ],
  agriculture: [
    "combine harvester",
    "tractor field",
    "irrigation field",
    "precision agriculture",
    "agricultural drone",
    "autonomous tractor",
  ],
  real_estate: [
    "office building construction",
    "skyscraper",
    "shopping mall building",
    "modern office building",
    "modern glass office building",
    "green building architecture",
  ],
  construction: [
    "construction crane",
    "building construction site",
    "construction project",
    "construction equipment",
    "modular construction",
    "3d printed building",
  ],
  defense: [
    "fighter jet",
    "stealth aircraft",
    "military radar",
    "military drone",
    "cyber warfare",
    "military robot",
  ],
  telecommunications: [
    "telephone exchange",
    "fiber optic cable",
    "mobile phone tower",
    "broadband network",
    "5g antenna",
    "satellite communications",
  ],
  entertainment: [
    "movie theater",
    "video game arcade",
    "film production",
    "video streaming",
    "esports tournament",
    "virtual reality gaming",
  ],
  logistics: [
    "shipping containers",
    "freight train",
    "cargo warehouse",
    "delivery truck",
    "automated warehouse",
    "delivery drone",
  ],
  extraction: [
    "oil drilling rig",
    "mining excavator",
    "offshore drilling",
    "mining truck",
    "open pit mine",
    "mining haul truck",
  ],
};

const UA = "A-House-Divided-tech-asset-resolver/1.0 (game asset curation)";

function buildTiers() {
  const tiers = [];
  for (const d of DECADES) tiers.push({ key: `corp/${d}`, term: CORPORATE_TERMS[d] });
  for (const [sector, terms] of Object.entries(SECTOR_TERMS)) {
    DECADES.forEach((d, i) => tiers.push({ key: `sector/${sector}/${d}`, term: terms[i] }));
  }
  return tiers;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function resolveTerm(term) {
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search" +
    `&gsrsearch=${encodeURIComponent(term)}&gsrnamespace=6&gsrlimit=12` +
    "&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=640";
  let res;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch(api, { headers: { "User-Agent": UA } });
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    break;
  }
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  const pages = Object.values(data?.query?.pages ?? {});
  // Prefer relevance order (search index), photographic raster, landscape-ish.
  const candidates = pages
    .map((p) => ({ index: p.index ?? 999, info: p.imageinfo?.[0], title: p.title }))
    .filter((c) => c.info && /image\/(jpeg|png)/.test(c.info.mime || ""))
    .sort((a, b) => a.index - b.index);
  const pick = candidates.find((c) => (c.info.width ?? 0) >= (c.info.height ?? 1)) ?? candidates[0];
  if (!pick) return null;
  return {
    url: pick.info.thumburl || pick.info.url,
    title: pick.title,
    descriptionurl: pick.info.descriptionurl,
  };
}

async function main() {
  const tiers = buildTiers();
  const srcPath = path.join(root, "scripts", "tech-image-sources.json");
  const credPath = path.join(root, "scripts", "tech-image-credits.json");

  // Resume: keep already-resolved URLs so re-runs only fill the gaps.
  const sources = existsSync(srcPath) ? JSON.parse(readFileSync(srcPath, "utf8")) : {};
  const credits = existsSync(credPath) ? JSON.parse(readFileSync(credPath, "utf8")) : {};
  sources._README =
    "Real Commons image URLs resolved by scripts/resolve-tech-image-sources.mjs. Empty = placeholder.";

  let ok = 0;
  let miss = 0;
  let skip = 0;
  for (const { key, term } of tiers) {
    if (sources[key]) {
      skip++;
      continue;
    }
    try {
      const r = await resolveTerm(term);
      if (r) {
        sources[key] = r.url;
        credits[key] = { term, title: r.title, page: r.descriptionurl };
        console.log(`  ✓ ${key}  ←  ${r.title}`);
        ok++;
      } else {
        console.warn(`  ! ${key}: no result for "${term}"`);
        miss++;
      }
    } catch (e) {
      console.warn(`  ! ${key}: ${e.message}`);
      miss++;
    }
    // Persist incrementally so a mid-run failure never loses progress.
    writeFileSync(srcPath, JSON.stringify(sources, null, 2));
    writeFileSync(credPath, JSON.stringify(credits, null, 2));
    await sleep(500);
  }

  console.log(`Done. resolved=${ok} skipped=${skip} missing=${miss}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

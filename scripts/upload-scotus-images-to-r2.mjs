// One-off (re-runnable): mirror the public-domain SCOTUS art set (Supreme Court
// building hero + historical justice portraits) from Wikimedia Commons to
// Cloudflare R2 under `static/scotus/`, so the SCOTUS page serves them from our
// own CDN (cdn.ahousedividedgame.com, free egress) instead of hotlinking
// commons.wikimedia.org. Sources are public-domain (U.S. government / U.S.
// Courts / Library of Congress works).
//
//   node scripts/upload-scotus-images-to-r2.mjs
//
// Fetches R2 credentials from Railway (needs RAILWAY_PROJECT_TOKEN in
// .env.local), matching scripts/upload-all-static-images-via-railway.mjs — the
// direct-from-.env.local R2 endpoint is not reachable from every dev box.

import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { readEnvLocal, fetchRailwayR2Env, createR2Client, putObject } from "./lib/r2-railway.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// slug -> Wikimedia Commons filename. slug becomes static/scotus/<slug>.webp
// and is referenced from src/lib/scotus/justiceImages.ts. Keep the two in sync.
const ASSETS = [
  { slug: "building", file: "US_Supreme_Court_Building.jpg", hero: true },
  { slug: "earl-warren", file: "Earl_Warren.jpg" },
  { slug: "hugo-black", file: "Hugo_Black.jpg" },
  { slug: "william-o-douglas", file: "William_O._Douglas.jpg" },
  { slug: "william-rehnquist", file: "William_Rehnquist.jpg" },
  { slug: "ruth-bader-ginsburg", file: "Ruth_Bader_Ginsburg_2016_portrait.jpg" },
  { slug: "stanley-reed", file: "Stanley_Forman_Reed.jpg" },
  { slug: "tom-clark", file: "Tom_C._Clark.jpg" },
];

async function fetchImg(file) {
  // Wikimedia rate-limits bursts (429); back off and retry.
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${COMMONS}/${encodeURIComponent(file)}?width=1200`, {
      redirect: "follow",
      headers: {
        "User-Agent": "AHouseDividedGame/1.0 (asset mirror; contact admin@ahousedividedgame.com)",
      },
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    throw new Error(`fetch ${file} -> HTTP ${res.status}`);
  }
  throw new Error(`fetch ${file} -> repeated 429`);
}

async function main() {
  const fileEnv = readEnvLocal(root);
  const projectToken = fileEnv.RAILWAY_PROJECT_TOKEN;
  if (!projectToken) {
    console.error("RAILWAY_PROJECT_TOKEN missing in .env.local");
    process.exit(1);
  }

  console.log("Fetching R2 credentials from Railway...");
  const r2Env = await fetchRailwayR2Env(projectToken);
  const s3 = createR2Client(r2Env);
  const bucket = r2Env.CLOUDFLARE_R2_BUCKET_NAME;
  const publicBase = r2Env.CLOUDFLARE_R2_PUBLIC_URL.replace(/\/$/, "");

  console.log("Mirroring SCOTUS public-domain images to R2...");
  for (const item of ASSETS) {
    const raw = await fetchImg(item.file);
    const buf = item.hero
      ? await sharp(raw)
          .resize({ width: 1600, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer()
      : await sharp(raw)
          .resize({ width: 480, height: 480, fit: "cover", position: "top" })
          .webp({ quality: 82 })
          .toBuffer();
    await putObject(s3, bucket, publicBase, `static/scotus/${item.slug}.webp`, buf, "image/webp");
    await sleep(3000); // stay under Wikimedia's rate limit
  }

  console.log(`Done. CDN base: ${publicBase}/static/scotus/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Upload regional GeoJSON files from public/ to R2 at static/maps/.
// Run once after adding new map files, or when public/*.json files change.
//
//   node scripts/upload-geo-maps-to-r2.mjs
//
// CDN paths after upload:
//   cdn.ahousedividedgame.com/static/maps/us-states-10m.json
//   cdn.ahousedividedgame.com/static/maps/br-regions.json
//   ... (one per GEO file)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readEnvLocal, fetchRailwayR2Env, createR2Client, putObject } from "./lib/r2-railway.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const GEO_FILES = [
  "us-states-10m.json",
  "br-regions.json",
  "cn-regions.json",
  "cn-regions-1991.json",
  "de-laender.json",
  "japan-prefectures.json",
  "british-isles-regions.json",
  "uk-nuts1.json",
  "ie-regions.json",
  "sco-regions.json",
  "wal-regions.json",
  "ng-regions.json",
];

async function main() {
  const fileEnv = readEnvLocal(root);
  const projectToken = fileEnv.RAILWAY_PROJECT_TOKEN;
  if (!projectToken) {
    console.error("RAILWAY_PROJECT_TOKEN missing in .env.local");
    process.exit(1);
  }

  console.log("Fetching R2 credentials from Railway…");
  const r2Env = await fetchRailwayR2Env(projectToken);
  const s3 = createR2Client(r2Env);
  const bucket = r2Env.CLOUDFLARE_R2_BUCKET_NAME;
  const publicBase = r2Env.CLOUDFLARE_R2_PUBLIC_URL.replace(/\/$/, "");

  console.log(`Uploading ${GEO_FILES.length} GeoJSON files to R2…`);

  for (const filename of GEO_FILES) {
    const fullPath = path.join(root, "public", filename);
    const r2Key = `static/maps/${filename}`;
    const body = readFileSync(fullPath);
    await putObject(s3, bucket, publicBase, r2Key, body, "application/json");
    console.log(`  ✓ ${filename} → ${publicBase}/${r2Key}`);
  }

  console.log(`\nDone. CDN base: ${publicBase}/static/maps/`);
  console.log("Files are now served from cdn.ahousedividedgame.com/static/maps/<filename>");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

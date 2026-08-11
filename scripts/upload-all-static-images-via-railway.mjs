// Upload everything under public/static/ to R2 (except url-map.json).
//
//   node scripts/upload-all-static-images-via-railway.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readEnvLocal, fetchRailwayR2Env, createR2Client, putObject } from "./lib/r2-railway.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticRoot = path.join(root, "public", "static");

const CONTENT_TYPES = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  json: "application/json",
};

function walkFiles(dir, base = staticRoot) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "url-map.json") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full, base));
    else out.push({ full, key: path.relative(base, full).replace(/\\/g, "/") });
  }
  return out;
}

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

  const files = walkFiles(staticRoot);
  console.log(`Uploading ${files.length} files to R2…`);

  for (const { full, key } of files) {
    const ext = path.extname(key).slice(1).toLowerCase();
    const body = readFileSync(full);
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    await putObject(s3, bucket, publicBase, `static/${key}`, body, contentType);
  }

  console.log(`Done. CDN base: ${publicBase}/static/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

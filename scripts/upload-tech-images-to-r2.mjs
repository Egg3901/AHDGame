// Publish tech-tier images from public/static/tech/ to R2 (static/tech/...).
// Generate sources first: node scripts/fetch-tech-images.mjs
//
//   railway run --service "Main Site" node scripts/upload-tech-images-to-r2.mjs

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localDir = path.join(root, "public", "static", "tech");

function readEnvLocal() {
  const envFile = path.join(root, ".env.local");
  const out = {};
  if (!existsSync(envFile)) return out;
  for (let line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    line = line.trim().replace(/^#\s*/, "");
    const m = line.match(/^(CLOUDFLARE_R2_[A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const fileEnv = readEnvLocal();
const get = (k) => process.env[k] || fileEnv[k];
const accountId = get("CLOUDFLARE_R2_ACCOUNT_ID");
const accessKeyId = get("CLOUDFLARE_R2_ACCESS_KEY_ID");
const secretAccessKey = get("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
const bucket = get("CLOUDFLARE_R2_BUCKET_NAME");
const publicBase = (get("CLOUDFLARE_R2_PUBLIC_URL") || "").replace(/\/$/, "");

if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
  console.error("Missing CLOUDFLARE_R2_* values (env or .env.local).");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

/** Recursively collect .webp files under dir, returning paths relative to dir. */
function walkWebp(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkWebp(full, base));
    else if (entry.endsWith(".webp")) out.push(path.relative(base, full));
  }
  return out;
}

async function put(key, body) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  console.log(`  ✓ ${key} (${(body.length / 1024).toFixed(1)} KB) -> ${publicBase}/${key}`);
}

async function main() {
  const files = walkWebp(localDir);
  if (files.length === 0) {
    console.error(`No .webp under ${localDir} — run: node scripts/fetch-tech-images.mjs`);
    process.exit(1);
  }
  console.log(`Uploading ${files.length} tech images to R2…`);
  for (const rel of files) {
    const body = readFileSync(path.join(localDir, rel));
    await put(`static/tech/${rel.split(path.sep).join("/")}`, body);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

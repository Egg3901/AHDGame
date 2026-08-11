// Upload era-specific character-creation hero images to R2.
//   railway run --service "Main Site" node scripts/upload-create-character-images-to-r2.mjs
// (or uncomment CLOUDFLARE_R2_* in .env.local and run locally)
//
// Reads .webp files from scripts/create-character-images/ and uploads each to
// static/create-character/{slug}.webp. Place source images there first; see
// scripts/create-character-images/README.md for specs and sourcing guidance.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvLocal() {
  const raw = readFileSync(path.join(root, ".env.local"), "utf8");
  const out = {};
  for (let line of raw.split(/\r?\n/)) {
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
  console.error("Missing CLOUDFLARE_R2_* values");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const dir = path.join(root, "scripts", "create-character-images");
const files = readdirSync(dir).filter((f) => f.endsWith(".webp"));
if (files.length === 0) {
  console.error(`No .webp files found in ${dir}. Add source images first per README.md.`);
  process.exit(1);
}

for (const file of files) {
  const slug = path.basename(file, ".webp");
  const key = `static/create-character/${slug}.webp`;
  const Body = readFileSync(path.join(dir, file));
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  console.log(`  uploaded ${publicBase}/${key}`);
}
console.log("done");

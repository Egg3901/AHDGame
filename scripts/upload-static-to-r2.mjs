// One-off: optimize the heavy public/ assets and upload them to Cloudflare R2
// under the `static/` prefix so they are served from the CDN (free egress)
// instead of being re-encoded and served by the Railway container via
// /_next/image. Re-runnable (overwrites the same keys).
//
//   node scripts/upload-static-to-r2.mjs
//
// Reads CLOUDFLARE_R2_* from .env.local. Those lines may be commented out in
// the file (local dev falls back to disk uploads); we still parse them here so
// the upload can run without un-commenting and changing dev upload behaviour.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvLocal() {
  const raw = readFileSync(path.join(root, ".env.local"), "utf8");
  const out = {};
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim().replace(/^#\s*/, ""); // tolerate commented R2 lines
    const m = line.match(/^(CLOUDFLARE_R2_[A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// Prefer real values injected by the environment (e.g. `railway run …`);
// fall back to .env.local for anyone with creds set there.
const fileEnv = readEnvLocal();
const get = (k) => process.env[k] || fileEnv[k];
const accountId = get("CLOUDFLARE_R2_ACCOUNT_ID");
const accessKeyId = get("CLOUDFLARE_R2_ACCESS_KEY_ID");
const secretAccessKey = get("CLOUDFLARE_R2_SECRET_ACCESS_KEY");
const bucket = get("CLOUDFLARE_R2_BUCKET_NAME");
const publicBase = (get("CLOUDFLARE_R2_PUBLIC_URL") || "").replace(/\/$/, "");

if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBase) {
  console.error("Missing CLOUDFLARE_R2_* values in .env.local");
  process.exit(1);
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

async function put(key, body, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  console.log(`  ✓ ${key} (${(body.length / 1024).toFixed(1)} KB) -> ${publicBase}/${key}`);
}

const p = (f) => path.join(root, "public", f);

async function main() {
  console.log("Optimizing + uploading static assets to R2…");

  // Hero: 610 KB JPEG -> ~150 KB WebP at 1600px (covers 100vw on large displays).
  const hero = await sharp(p("lincoln-memorial.jpg"))
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  await put("static/lincoln-memorial.webp", hero, "image/webp");

  // Logo: 177 KB PNG (rendered at 36–44px in nav, 512px for OG/Twitter cards).
  // One 256×256 palette PNG keeps transparency, is crisp for the nav at 2×,
  // and is well above the 200×200 floor social scrapers require.
  const logo = await sharp(p("ahd-logo.png"))
    .resize({ width: 256, height: 256, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, quality: 90, compressionLevel: 9 })
    .toBuffer();
  await put("static/ahd-logo.png", logo, "image/png");

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

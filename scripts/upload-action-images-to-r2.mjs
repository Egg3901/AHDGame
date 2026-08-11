// Publish action card + actions-page hero images from public/static/actions/ to R2.
// Generate sources first if missing: node scripts/fetch-action-images.mjs
//
//   node scripts/upload-action-images-to-r2.mjs
//   railway run --service "Main Site" node scripts/upload-action-images-to-r2.mjs

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localDir = path.join(root, "public", "static", "actions");

/**
 * Every .webp under public/static/actions/, at any depth. The tree is
 * `<slug>.webp` (legacy flat fallback) plus `<era>/[<country>/]<slug>.webp`,
 * and the R2 key mirrors the relative path exactly — so adding an era or a
 * country needs no change here.
 */
function webpFilesUnder(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...webpFilesUnder(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".webp")) out.push(rel);
  }
  return out;
}

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
  console.error("Missing CLOUDFLARE_R2_* values in .env.local");
  process.exit(1);
}

const PLACEHOLDER_MARKERS = ["your-account-id", "your-access-key-id", "your-secret-access-key"];
if (
  PLACEHOLDER_MARKERS.some((p) => accountId === p || accessKeyId === p || secretAccessKey === p)
) {
  console.error(
    "CLOUDFLARE_R2_* in .env.local are still placeholder values (your-account-id, etc.).\n" +
      "Replace them with your real Cloudflare R2 API token credentials, then re-run."
  );
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

async function main() {
  // Optional path prefix, e.g. `node scripts/upload-action-images-to-r2.mjs 1953`
  // to publish one era without re-putting the whole tree.
  const prefix = process.argv[2] ?? "";
  const files = webpFilesUnder(localDir).filter((f) => f.startsWith(prefix));
  if (!files.length) {
    console.error(
      `No .webp matching "${prefix}" under ${localDir} — run: node scripts/fetch-action-images.mjs`
    );
    process.exit(1);
  }

  console.log(`Uploading ${files.length} action images from public/static/actions/ to R2…`);
  for (const rel of files) {
    const body = readFileSync(path.join(localDir, rel));
    await put(`static/actions/${rel}`, body, "image/webp");
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

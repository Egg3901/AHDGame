// One-off: publish the large country-map geometry JSON from public/ to R2 so
// the map pages fetch them from the CDN (free egress) instead of the Railway
// container. Unlike images these are loaded via `fetch()` cross-origin, so we
// also set a bucket CORS policy allowing browser GETs. Re-runnable.
//
//   railway run --service "Main Site" node scripts/upload-maps-to-r2.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from "@aws-sdk/client-s3";

// Browser origins allowed to fetch() map JSON from the CDN.
const ALLOWED_ORIGINS = [
  "https://ahousedividedgame.com",
  "https://www.ahousedividedgame.com",
  "https://sandbox.ahousedividedgame.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

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

// publicPath in public/ -> R2 key under static/maps/
const MAPS = [
  ["geo/countries-110m.json", "static/maps/countries-110m.json"],
  ["ie-regions.json", "static/maps/ie-regions.json"],
  ["cn-regions.json", "static/maps/cn-regions.json"],
  ["cn-regions-1991.json", "static/maps/cn-regions-1991.json"],
  ["br-regions.json", "static/maps/br-regions.json"],
  ["us-states-10m.json", "static/maps/us-states-10m.json"],
  ["uk-nuts1.json", "static/maps/uk-nuts1.json"],
  ["japan-prefectures.json", "static/maps/japan-prefectures.json"],
  ["de-laender.json", "static/maps/de-laender.json"],
];

async function ensureCors() {
  // Needs a bucket-admin–scoped token. Object Read/Write tokens get 403 here;
  // in that case set the policy once in the Cloudflare R2 dashboard.
  try {
    try {
      const existing = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
      console.log("  existing CORS (will be replaced):", JSON.stringify(existing.CORSRules));
    } catch (e) {
      if (e?.name !== "NoSuchCORSConfiguration") throw e;
      console.log("  no existing CORS config");
    }
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedMethods: ["GET", "HEAD"],
              AllowedOrigins: ALLOWED_ORIGINS,
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag", "Content-Length"],
              MaxAgeSeconds: 86400,
            },
          ],
        },
      })
    );
    console.log("  ✓ CORS applied for:", ALLOWED_ORIGINS.join(", "));
    return true;
  } catch (e) {
    if (e?.$metadata?.httpStatusCode === 403 || e?.name === "AccessDenied") {
      console.log("  ⚠ token lacks bucket-admin scope — set CORS in the Cloudflare dashboard:");
      console.log("    Bucket > Settings > CORS Policy, AllowedMethods GET/HEAD, AllowedOrigins:");
      console.log("    " + JSON.stringify(ALLOWED_ORIGINS));
      return false;
    }
    throw e;
  }
}

async function main() {
  console.log("Uploading map geometry JSON…");
  for (const [src, key] of MAPS) {
    const body = readFileSync(path.join(root, "public", src));
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    console.log(`  ✓ ${key} (${(body.length / 1024).toFixed(0)} KB)`);
  }

  console.log("Configuring CORS…");
  const corsOk = await ensureCors();
  console.log(corsOk ? "Done." : "Objects uploaded; CORS still needs setting (see above).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

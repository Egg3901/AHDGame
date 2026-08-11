// Fetch CLOUDFLARE_R2_* from Railway (project token in .env.local) and upload
// action images from public/static/actions/ to R2.
//
//   node scripts/upload-action-images-via-railway.mjs

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localDir = path.join(root, "public", "static", "actions");

/**
 * Every .webp under public/static/actions/, at any depth: `<slug>.webp` (the
 * legacy flat fallback) plus `<era>/[<country>/]<slug>.webp`. The R2 key
 * mirrors the relative path, so new eras and countries need no change here.
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
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function railwayGraphql(projectToken, query, variables = {}) {
  const res = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      "Project-Access-Token": projectToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Railway API ${res.status}: ${JSON.stringify(body)}`);
  }
  if (body.errors?.length) {
    throw new Error(`Railway GraphQL: ${body.errors.map((e) => e.message).join(", ")}`);
  }
  return body.data;
}

async function fetchRailwayR2Env(projectToken) {
  const tokenInfo = await railwayGraphql(
    projectToken,
    `query { projectToken { projectId environmentId } }`
  );
  const { projectId, environmentId } = tokenInfo.projectToken ?? {};
  if (!projectId || !environmentId) {
    throw new Error("Could not resolve projectId/environmentId from project token");
  }

  const project = await railwayGraphql(
    projectToken,
    `query($id: String!) {
      project(id: $id) {
        services { edges { node { id name } } }
      }
    }`,
    { id: projectId }
  );

  const services = project.project?.services?.edges?.map((e) => e.node) ?? [];
  const mainSite =
    services.find((s) => s.name === "Main Site") ??
    services.find((s) => s.name.toLowerCase().includes("main"));

  const varsData = await railwayGraphql(
    projectToken,
    `query($projectId: String!, $environmentId: String!, $serviceId: String) {
      variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
    }`,
    {
      projectId,
      environmentId,
      serviceId: mainSite?.id,
    }
  );

  const all = varsData.variables ?? {};
  const keys = [
    "CLOUDFLARE_R2_ACCOUNT_ID",
    "CLOUDFLARE_R2_ACCESS_KEY_ID",
    "CLOUDFLARE_R2_SECRET_ACCESS_KEY",
    "CLOUDFLARE_R2_BUCKET_NAME",
    "CLOUDFLARE_R2_PUBLIC_URL",
  ];
  const env = {};
  for (const key of keys) {
    if (all[key]) env[key] = all[key];
  }

  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing on Railway (${mainSite?.name ?? "shared"}): ${missing.join(", ")}`);
  }

  console.log(
    `  Railway project ${projectId}, env ${environmentId}, service ${mainSite?.name ?? "(shared)"}`
  );
  return env;
}

async function put(s3, bucket, publicBase, key, body, contentType) {
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
  const fileEnv = readEnvLocal();
  const projectToken = fileEnv.RAILWAY_PROJECT_TOKEN;
  if (!projectToken) {
    console.error("RAILWAY_PROJECT_TOKEN missing in .env.local");
    process.exit(1);
  }

  console.log("Fetching R2 credentials from Railway…");
  const r2Env = await fetchRailwayR2Env(projectToken);

  const { CLOUDFLARE_R2_ACCOUNT_ID: accountId } = r2Env;
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2Env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: r2Env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  });

  const bucket = r2Env.CLOUDFLARE_R2_BUCKET_NAME;
  const publicBase = r2Env.CLOUDFLARE_R2_PUBLIC_URL.replace(/\/$/, "");

  // Optional path prefix, e.g. `… upload-action-images-via-railway.mjs 1953`
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
    await put(s3, bucket, publicBase, `static/actions/${rel}`, body, "image/webp");
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

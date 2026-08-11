// Shared Railway → R2 credentials + upload helpers for static asset scripts.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export function readEnvLocal(root) {
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

export async function railwayGraphql(projectToken, query, variables = {}) {
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

export async function fetchRailwayR2Env(projectToken) {
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

export function createR2Client(r2Env) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${r2Env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2Env.CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: r2Env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  });
}

export async function putObject(s3, bucket, publicBase, key, body, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  console.log(`  ✓ ${key} (${(body.length / 1024).toFixed(1)} KB)`);
}

/** Recursively upload every file under localDir to R2 at static/{r2Prefix}/… */
export async function uploadDirectory(s3, bucket, localDir, r2Prefix, contentTypeForExt) {
  const files = [];
  function walk(dir, rel = "") {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, relPath);
      else files.push({ full, relPath });
    }
  }
  walk(localDir);
  for (const { full, relPath } of files) {
    const ext = path.extname(relPath).slice(1).toLowerCase();
    const body = readFileSync(full);
    const contentType = contentTypeForExt(ext);
    await putObject(s3, bucket, null, `${r2Prefix}/${relPath}`, body, contentType);
  }
  return files.length;
}

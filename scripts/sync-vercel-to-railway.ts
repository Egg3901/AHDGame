#!/usr/bin/env npx tsx
/**
 * Syncs environment variables from a Vercel project to a Railway project.
 *
 * Usage:
 *   VERCEL_TOKEN=... RAILWAY_TOKEN=... npx tsx scripts/sync-vercel-to-railway.ts
 *
 * Required env vars:
 *   VERCEL_TOKEN        - Vercel API token (vcp_...)
 *   RAILWAY_TOKEN       - Railway token — either a personal token OR a project token
 *
 * Optional env vars:
 *   VERCEL_TEAM_ID         - defaults to team_kLXWTD5L562IizX9XOqSQR22
 *   VERCEL_PROJECT_ID      - defaults to prj_YLS7RE61F7FoA2LXRE4hCWQHqOvm
 *   VERCEL_TARGET          - comma-separated targets to sync (default: production)
 *   DRY_RUN                - set to "true" to print changes without applying
 *
 * With a personal Railway token (auto-discovers project/environment):
 *   RAILWAY_PROJECT_NAME   - filter by project name (default: first project found)
 *   RAILWAY_ENV_NAME       - environment name to sync into (default: production)
 *   RAILWAY_SERVICE_NAME   - service name to target (omit for shared/project-level vars)
 *
 * With a project-scoped Railway token (bypass discovery — required for project tokens):
 *   RAILWAY_PROJECT_ID     - Railway project ID (from dashboard URL or project settings)
 *   RAILWAY_ENVIRONMENT_ID - Railway environment ID
 *   RAILWAY_SERVICE_ID     - Railway service ID (optional)
 *
 * To find Railway IDs: open the Railway dashboard, navigate to your project/environment/service,
 * and copy the ID from the URL (e.g. railway.app/project/<projectId>/...).
 */

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const RAILWAY_TOKEN = process.env.RAILWAY_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID ?? "team_kLXWTD5L562IizX9XOqSQR22";
const VERCEL_PROJECT_ID_ENV = process.env.VERCEL_PROJECT_ID ?? "prj_YLS7RE61F7FoA2LXRE4hCWQHqOvm";
const VERCEL_TARGETS = (process.env.VERCEL_TARGET ?? "production").split(",").map((t) => t.trim());
const DRY_RUN = process.env.DRY_RUN === "true";

// Project-token mode: explicit IDs bypass GraphQL discovery
const RAILWAY_PROJECT_ID_EXPLICIT = process.env.RAILWAY_PROJECT_ID;
const RAILWAY_ENVIRONMENT_ID_EXPLICIT = process.env.RAILWAY_ENVIRONMENT_ID;
const RAILWAY_SERVICE_ID_EXPLICIT = process.env.RAILWAY_SERVICE_ID;

// Personal-token mode: discover by name
const RAILWAY_PROJECT_NAME = process.env.RAILWAY_PROJECT_NAME;
const RAILWAY_ENV_NAME = process.env.RAILWAY_ENV_NAME ?? "production";
const RAILWAY_SERVICE_NAME = process.env.RAILWAY_SERVICE_NAME;

if (!VERCEL_TOKEN) throw new Error("VERCEL_TOKEN is required");
if (!RAILWAY_TOKEN) throw new Error("RAILWAY_TOKEN is required");

// ─── Vercel helpers ──────────────────────────────────────────────────────────

interface VercelEnvVar {
  id: string;
  key: string;
  value: string;
  type: "plain" | "secret" | "sensitive" | "encrypted";
  target: string[];
}

async function vercelGet<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vercel API ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function fetchVercelEnvVars(): Promise<Record<string, string>> {
  const { envs } = await vercelGet<{ envs: VercelEnvVar[] }>(
    `/v9/projects/${VERCEL_PROJECT_ID_ENV}/env?teamId=${VERCEL_TEAM_ID}&decrypt=true`
  );

  const filtered = envs.filter((e) => e.target.some((t) => VERCEL_TARGETS.includes(t)));

  // For encrypted/sensitive vars the bulk endpoint returns a redacted value;
  // fetch each one individually to get the real value.
  const decrypted = await Promise.all(
    filtered.map(async (e) => {
      if (e.value && !e.value.startsWith("@") && e.type === "plain") return e;
      try {
        const single = await vercelGet<VercelEnvVar>(
          `/v1/projects/${VERCEL_PROJECT_ID_ENV}/env/${e.id}?teamId=${VERCEL_TEAM_ID}&decrypt=true`
        );
        return { ...e, value: single.value };
      } catch {
        console.warn(`  ⚠ Could not decrypt ${e.key} — skipping`);
        return null;
      }
    })
  );

  return Object.fromEntries(
    (decrypted.filter(Boolean) as VercelEnvVar[]).map((e) => [e.key, e.value])
  );
}

// ─── Railway helpers ─────────────────────────────────────────────────────────

async function railwayQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("https://backboard.railway.app/graphql/v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RAILWAY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Railway API → ${res.status}: ${body}`);
  }
  const { data, errors } = (await res.json()) as { data: T; errors?: { message: string }[] };
  if (errors?.length)
    throw new Error(`Railway GraphQL errors: ${errors.map((e) => e.message).join(", ")}`);
  return data;
}

interface RailwayProject {
  id: string;
  name: string;
  environments: { edges: { node: { id: string; name: string } }[] };
  services: { edges: { node: { id: string; name: string } }[] };
}

async function discoverRailwayTarget(): Promise<{
  projectId: string;
  environmentId: string;
  serviceId: string | undefined;
}> {
  // If explicit IDs are provided (project-scoped token), use them directly.
  if (RAILWAY_PROJECT_ID_EXPLICIT && RAILWAY_ENVIRONMENT_ID_EXPLICIT) {
    return {
      projectId: RAILWAY_PROJECT_ID_EXPLICIT,
      environmentId: RAILWAY_ENVIRONMENT_ID_EXPLICIT,
      serviceId: RAILWAY_SERVICE_ID_EXPLICIT,
    };
  }

  // Personal token: discover via GraphQL.
  const data = await railwayQuery<{ projects: { edges: { node: RailwayProject }[] } }>(`
    query {
      projects {
        edges {
          node {
            id
            name
            environments { edges { node { id name } } }
            services { edges { node { id name } } }
          }
        }
      }
    }
  `);

  const projects = data.projects.edges.map((e) => e.node);
  if (!projects.length) throw new Error("No Railway projects found for this token");

  const project = RAILWAY_PROJECT_NAME
    ? projects.find((p) => p.name.toLowerCase() === RAILWAY_PROJECT_NAME.toLowerCase())
    : projects[0];

  if (!project) {
    throw new Error(
      `Railway project "${RAILWAY_PROJECT_NAME}" not found. Available: ${projects.map((p) => p.name).join(", ")}`
    );
  }
  console.log(`  Project: ${project.name} (${project.id})`);

  const environment = project.environments.edges
    .map((e) => e.node)
    .find((e) => e.name.toLowerCase() === RAILWAY_ENV_NAME.toLowerCase());
  if (!environment) {
    const names = project.environments.edges.map((e) => e.node.name).join(", ");
    throw new Error(`Railway environment "${RAILWAY_ENV_NAME}" not found. Available: ${names}`);
  }
  console.log(`  Environment: ${environment.name} (${environment.id})`);

  let serviceId: string | undefined;
  if (RAILWAY_SERVICE_NAME) {
    const service = project.services.edges
      .map((e) => e.node)
      .find((s) => s.name.toLowerCase() === RAILWAY_SERVICE_NAME.toLowerCase());
    if (!service) {
      const names = project.services.edges.map((e) => e.node.name).join(", ");
      throw new Error(`Railway service "${RAILWAY_SERVICE_NAME}" not found. Available: ${names}`);
    }
    serviceId = service.id;
    console.log(`  Service: ${service.name} (${serviceId})`);
  } else {
    console.log("  Service: (shared / no service filter)");
  }

  return { projectId: project.id, environmentId: environment.id, serviceId };
}

async function upsertRailwayVariables(
  projectId: string,
  environmentId: string,
  serviceId: string | undefined,
  variables: Record<string, string>
): Promise<void> {
  await railwayQuery(
    `
    mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
      variableCollectionUpsert(input: $input)
    }
  `,
    {
      input: {
        projectId,
        environmentId,
        ...(serviceId ? { serviceId } : {}),
        variables,
      },
    }
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching Vercel env vars…");
  const vercelVars = await fetchVercelEnvVars();
  console.log(
    `  Found ${Object.keys(vercelVars).length} variable(s) for target(s): ${VERCEL_TARGETS.join(", ")}`
  );

  const usingExplicitIds = !!(RAILWAY_PROJECT_ID_EXPLICIT && RAILWAY_ENVIRONMENT_ID_EXPLICIT);
  console.log(
    usingExplicitIds
      ? "\nUsing explicit Railway IDs (project-token mode)…"
      : "\nDiscovering Railway project (personal-token mode)…"
  );

  const { projectId, environmentId, serviceId } = await discoverRailwayTarget();

  if (usingExplicitIds) {
    console.log(`  Project ID:     ${projectId}`);
    console.log(`  Environment ID: ${environmentId}`);
    console.log(`  Service ID:     ${serviceId ?? "(shared)"}`);
  }

  console.log("\nVariables to sync:");
  for (const key of Object.keys(vercelVars).sort()) {
    const val = vercelVars[key];
    const display = val.length > 60 ? val.slice(0, 57) + "…" : val;
    console.log(`  ${key}=${display}`);
  }

  if (DRY_RUN) {
    console.log("\nDry run — no changes applied.");
    return;
  }

  console.log("\nUpserting variables in Railway…");
  await upsertRailwayVariables(projectId, environmentId, serviceId, vercelVars);
  console.log(`  ✓ ${Object.keys(vercelVars).length} variable(s) synced successfully.`);
}

main().catch((err) => {
  console.error("Error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

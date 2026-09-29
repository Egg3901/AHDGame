import { readFile } from "node:fs/promises";

const { POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID, DEPLOYED_AT, DEPLOY_SHA } = process.env;
if (!POSTHOG_PERSONAL_API_KEY || !POSTHOG_PROJECT_ID) {
  console.log("PostHog annotation credentials are not configured; skipping.");
  process.exit(0);
}

const packageJson = JSON.parse(
  await readFile(new URL("../../package.json", import.meta.url), "utf8")
);
const releaseTag = `v${packageJson.version}`;
const response = await fetch(
  `https://us.posthog.com/api/projects/${encodeURIComponent(POSTHOG_PROJECT_ID)}/annotations/`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${POSTHOG_PERSONAL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: `Production deploy ${releaseTag} (${DEPLOY_SHA?.slice(0, 12) ?? "unknown"})`,
      date_marker: DEPLOYED_AT ?? new Date().toISOString(),
    }),
  }
);
if (!response.ok) throw new Error(`PostHog annotation failed: HTTP ${response.status}`);

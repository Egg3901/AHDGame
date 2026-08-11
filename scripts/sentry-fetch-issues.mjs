import dotenv from "dotenv";
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
for (const name of [".env.local", ".envlocal", ".env"]) {
  const p = path.join(root, name);
  if (fs.existsSync(p)) dotenv.config({ path: p });
}

const token = process.env.SENTRY_AUTH_TOKEN || process.env.SENTRY_TOKEN;
/** Organization *slug* from sentry.io/org-slug/… (not the human-readable project title). */
const CANON_ORG = "ahousedivided";
const CANON_PROJECT = "a-house-divided";

let org = process.env.SENTRY_ORG_SLUG || process.env.SENTRY_ORG || CANON_ORG;
let proj = process.env.SENTRY_PROJECT || CANON_PROJECT;

// Common misconfiguration: .env sets SENTRY_ORG to the same value as the project name.
if (org === proj && org !== CANON_ORG) {
  org = CANON_ORG;
}

if (!token) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "Missing token: set SENTRY_AUTH_TOKEN or SENTRY_TOKEN (see .env.example / .env.local)",
    })
  );
  process.exit(2);
}

const params = new URLSearchParams({
  statsPeriod: "14d",
  limit: "100",
});

const unresolvedUrl = `https://sentry.io/api/0/projects/${org}/${proj}/issues/?${params}&query=${encodeURIComponent("is:unresolved")}`;
const allRecentUrl = `https://sentry.io/api/0/projects/${org}/${proj}/issues/?${params}&query=`;

async function fetchIssues(url) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`HTTP ${r.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

function summarize(issues) {
  return issues.map((i) => ({
    id: i.id,
    shortId: i.shortId,
    title: i.title,
    culprit: i.culprit,
    level: i.level,
    status: i.status,
    count: i.count,
    userCount: i.userCount,
    firstSeen: i.firstSeen,
    lastSeen: i.lastSeen,
    permalink: i.permalink,
    isUnhandled: i.isUnhandled,
    project: i.project?.slug,
  }));
}

function aggregateReport(summarizedUnresolved) {
  const issues = summarizedUnresolved.map((u) => ({
    ...u,
    countNum: Number(u.count),
  }));
  issues.sort((a, b) => b.countNum - a.countNum);

  const byLevel = {};
  for (const u of issues) {
    byLevel[u.level] = (byLevel[u.level] || 0) + 1;
  }

  const themes = {};
  for (const u of issues) {
    let k = u.title.split(":")[0];
    if (k.length > 45) k = `${u.title.slice(0, 40)}…`;
    themes[k] = (themes[k] || 0) + 1;
  }
  const topThemes = Object.entries(themes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  return {
    unresolvedDistinctIssues: issues.length,
    byLevel,
    topThemes,
    topByEventCount: issues.slice(0, 22).map((u) => ({
      events14d: u.countNum,
      level: u.level,
      title: u.title.slice(0, 110),
      culprit: u.culprit,
      shortId: u.shortId,
      permalink: u.permalink,
      unhandled: u.isUnhandled,
      users: u.userCount,
    })),
  };
}

try {
  const [unresolved, recent] = await Promise.all([
    fetchIssues(unresolvedUrl),
    fetchIssues(allRecentUrl),
  ]);

  const summarizedUnresolved = summarize(unresolved);

  /** @type {Record<string, unknown>} */
  const payload = {
    ok: true,
    org,
    project: proj,
    statsPeriod: "14d",
    unresolvedCount: unresolved.length,
    recentIssuesCount: recent.length,
    unresolved: summarizedUnresolved,
    recentSample: summarize(recent).slice(0, 25),
  };

  if (process.argv.includes("--aggregate")) {
    payload.aggregate = aggregateReport(summarizedUnresolved);
  }

  console.log(JSON.stringify(payload, null, 2));
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
}

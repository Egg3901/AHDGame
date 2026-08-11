#!/usr/bin/env node
// GlitchTip error reader for Claude Code / local use.
//
// Reads errors from the project's GlitchTip instance via the Sentry-compatible
// REST API. Credentials come from .env.local (GLITCHTIP_URL is a Sentry DSN,
// GLITCHTIP_API_KEY is a personal auth token).
//
// Usage:
//   node scripts/glitchtip/gt.mjs list            list unresolved issues (most recent first)
//   node scripts/glitchtip/gt.mjs list --all      include resolved/ignored too
//   node scripts/glitchtip/gt.mjs list --limit 50 cap the number of rows (default 20)
//   node scripts/glitchtip/gt.mjs show AHD-4      issue summary (counts, first/last seen, release)
//   node scripts/glitchtip/gt.mjs show 4          same, by numeric id
//   node scripts/glitchtip/gt.mjs trace AHD-4     latest event's exception + stack trace
//   node scripts/glitchtip/gt.mjs --help

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ---------- pure helpers (kept side-effect-free for easy testing) ----------

/** Parse a `KEY=value` .env file into a plain object (ignores comments/blanks). */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Turn a GlitchTip/Sentry DSN into the REST API base + project id.
 *   https://KEY@host/path/prefix/<projectId>  ->  { apiBase: https://host/path/prefix/api/0, projectId }
 */
export function parseDsn(dsn) {
  const u = new URL(dsn);
  const segments = u.pathname.split("/").filter(Boolean);
  const projectId = segments.pop() ?? "";
  const prefix = segments.length ? `/${segments.join("/")}` : "";
  return { apiBase: `${u.origin}${prefix}/api/0`, projectId };
}

/** Human-friendly "2h ago" / "3d ago" from an ISO timestamp. */
export function formatRelative(iso, nowMs) {
  if (!iso) return "—";
  const diff = nowMs - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "—";
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function pad(str, width) {
  str = String(str);
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

// ---------- config / http ----------

function loadConfig() {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "../../.env.local");
  let env;
  try {
    env = parseEnv(readFileSync(envPath, "utf8"));
  } catch {
    die(`Could not read ${envPath}`);
  }
  const dsn = env.GLITCHTIP_URL;
  const token = env.GLITCHTIP_API_KEY;
  if (!dsn) die("GLITCHTIP_URL is not set in .env.local");
  if (!token) die("GLITCHTIP_API_KEY is not set in .env.local");
  const { apiBase } = parseDsn(dsn);
  return { apiBase, token };
}

async function api(cfg, path, params) {
  const url = new URL(cfg.apiBase + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    die(`GlitchTip API ${res.status} for ${url.pathname}\n${body.slice(0, 300)}`);
  }
  return res.json();
}

/** The single org slug on this instance (cached per process). */
let _orgSlug;
async function orgSlug(cfg) {
  if (_orgSlug) return _orgSlug;
  const orgs = await api(cfg, "/organizations/");
  if (!Array.isArray(orgs) || orgs.length === 0) die("No organizations visible to this token");
  _orgSlug = orgs[0].slug;
  return _orgSlug;
}

/** Accept either a numeric id ("4") or a shortId ("AHD-4") and return the numeric id. */
async function resolveIssueId(cfg, ref) {
  if (/^\d+$/.test(ref)) return ref;
  // This GlitchTip has no shortId search endpoint, so scan recent issues and match locally.
  const org = await orgSlug(cfg);
  const want = ref.toUpperCase();
  const issues = await api(cfg, `/organizations/${org}/issues/`, { limit: 100 });
  const hit = (Array.isArray(issues) ? issues : []).find(
    (i) => String(i.shortId ?? "").toUpperCase() === want
  );
  if (!hit) die(`No issue with shortId "${ref}" in the latest 100; pass the numeric id instead.`);
  return hit.id;
}

// ---------- commands ----------

async function cmdList(cfg, args) {
  const all = args.includes("--all");
  const limIdx = args.indexOf("--limit");
  const limit = limIdx !== -1 ? args[limIdx + 1] : "20";
  const org = await orgSlug(cfg);
  const params = { limit, sort: "-last_seen" };
  if (!all) params.query = "is:unresolved";
  const issues = await api(cfg, `/organizations/${org}/issues/`, params);
  if (!Array.isArray(issues) || issues.length === 0) {
    console.log(all ? "No issues." : "No unresolved issues. 🎉");
    return;
  }
  const now = Date.now();
  console.log(
    `${pad("ID", 8)} ${pad("LEVEL", 7)} ${pad("COUNT", 7)} ${pad("LAST", 9)} ${pad("STATUS", 11)} TITLE`
  );
  for (const i of issues) {
    console.log(
      `${pad(i.shortId ?? i.id, 8)} ${pad(i.level ?? "", 7)} ${pad(i.count ?? "", 7)} ` +
        `${pad(formatRelative(i.lastSeen, now), 9)} ${pad(i.status ?? "", 11)} ${i.title ?? ""}`
    );
  }
}

async function cmdShow(cfg, args) {
  const ref = args[0];
  if (!ref) die("Usage: gt.mjs show <AHD-N|id>");
  const id = await resolveIssueId(cfg, ref);
  const i = await api(cfg, `/issues/${id}/`);
  const now = Date.now();
  const lines = [
    `${i.shortId ?? i.id}  —  ${i.title ?? ""}`,
    `  status   : ${i.status}   level: ${i.level}   type: ${i.type}`,
    `  events   : ${i.count}    users: ${i.userCount ?? 0}`,
    `  first    : ${i.firstSeen ?? "—"} (${formatRelative(i.firstSeen, now)})`,
    `  last     : ${i.lastSeen ?? "—"} (${formatRelative(i.lastSeen, now)})`,
  ];
  if (i.firstRelease)
    lines.push(`  first rel: ${i.firstRelease.shortVersion ?? i.firstRelease.version}`);
  if (i.lastRelease)
    lines.push(`  last rel : ${i.lastRelease.shortVersion ?? i.lastRelease.version}`);
  if (i.metadata?.value) lines.push(`  message  : ${i.metadata.value}`);
  if (i.culprit) lines.push(`  culprit  : ${i.culprit}`);
  if (i.permalink) lines.push(`  url      : ${i.permalink}`);
  console.log(lines.join("\n"));
}

async function cmdTrace(cfg, args) {
  const ref = args[0];
  if (!ref) die("Usage: gt.mjs trace <AHD-N|id>");
  const id = await resolveIssueId(cfg, ref);
  const ev = await api(cfg, `/issues/${id}/events/latest/`);
  console.log(`Event ${ev.eventID ?? ""}  @ ${ev.dateCreated ?? ev.dateReceived ?? ""}`);
  const entries = ev.entries ?? [];
  const exc = entries.find((e) => e.type === "exception");
  if (!exc) {
    // Fall back to a bare message if there's no exception entry.
    const msg = entries.find((e) => e.type === "message");
    console.log(msg?.data?.formatted ?? "(no exception or message entry on latest event)");
    return;
  }
  for (const val of exc.data.values ?? []) {
    console.log(`\n${val.type}: ${val.value}`);
    const frames = val.stacktrace?.frames ?? [];
    // Sentry orders frames oldest-first; show most-recent call last (caret on the throwing frame).
    for (const f of frames) {
      const loc = [f.filename || f.module || "?", f.lineNo].filter(Boolean).join(":");
      const fn = f.function ? ` in ${f.function}` : "";
      const mark = f.inApp ? "> " : "  ";
      console.log(`  ${mark}${loc}${fn}`);
    }
  }
}

function cmdHelp() {
  console.log(
    [
      "GlitchTip error reader",
      "",
      "Commands:",
      "  list [--all] [--limit N]   list issues (default: unresolved, 20, newest first)",
      "  show  <AHD-N|id>           issue summary: counts, first/last seen, release, url",
      "  trace <AHD-N|id>           latest event exception + stack trace (> = in-app frame)",
      "  help                       this message",
      "",
      "Credentials: GLITCHTIP_URL + GLITCHTIP_API_KEY in .env.local",
    ].join("\n")
  );
}

// ---------- entry ----------

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return cmdHelp();
  const cfg = loadConfig();
  switch (cmd) {
    case "list":
      return cmdList(cfg, args);
    case "show":
      return cmdShow(cfg, args);
    case "trace":
      return cmdTrace(cfg, args);
    default:
      die(`Unknown command "${cmd}" (try: list, show, trace, help)`);
  }
}

// Only run when invoked directly, so the helpers can be imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => die(e?.stack || String(e)));
}

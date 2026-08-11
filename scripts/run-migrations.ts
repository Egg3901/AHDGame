#!/usr/bin/env tsx
// scripts/run-migrations.ts
//
// Run pending migrations against MONGODB_URI.
//
// Usage:
//   npm run migrate                    # apply all pending
//   npm run migrate:dry-run            # show what would run, no writes
//   npx tsx scripts/run-migrations.ts --only=add-perf-indexes
//   npx tsx scripts/run-migrations.ts --from=2026-05-05-cleanup-duplicate-tariff-pulses
//   npx tsx scripts/run-migrations.ts --only=add-perf-indexes --force
//
// Flags:
//   --dry-run     don't write the marker; pass dryRun=true into each migration
//   --only=a,b,c  only run the named migrations (comma-separated; preserves registry order).
//                 --only can ALSO name a ROLLBACK_MIGRATIONS entry, which the
//                 automatic (no-flag) run never touches.
//   --from=id     run from this id onward
//   --force       with --only, re-run even if marker exists (idempotent migrations only)

import { connectDb, closeDb } from "./utils/db";
import { runMigrations } from "../src/lib/migrations/runner";
import { MIGRATIONS, ROLLBACK_MIGRATIONS } from "../src/lib/migrations/registry";

interface ParsedArgs {
  dryRun: boolean;
  only?: string[];
  from?: string;
  force: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { dryRun: false, force: false };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--force") args.force = true;
    else if (arg.startsWith("--only=")) {
      args.only = arg
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--from=")) {
      args.from = arg.slice("--from=".length).trim();
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }
  if (args.only && args.from) {
    throw new Error("--only and --from are mutually exclusive");
  }
  if (args.force && !args.only) {
    throw new Error("--force only makes sense with --only");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selection = args.only
    ? `only:${args.only.join(",")}`
    : args.from
      ? `from:${args.from}`
      : "all";
  console.log(
    `[migrate] mode=${args.dryRun ? "dry-run" : "apply"} selected=${selection} ` +
      `registry=${MIGRATIONS.length}`
  );

  // Rollback entries are OUT of the automatic deploy chain by construction: a
  // plants→capital rollback is an explicit human act, never something a deploy
  // performs. They are only reachable when named explicitly with `--only`, so
  // the candidate list is widened for that case and that case alone. Without
  // this the registered entry was unreachable through the runner entirely,
  // which is worse than having no rollback at all — the escape hatch existed
  // but could not be opened.
  const candidates = args.only ? [...MIGRATIONS, ...ROLLBACK_MIGRATIONS] : MIGRATIONS;

  const db = await connectDb();
  try {
    const summary = await runMigrations(db, {
      migrations: candidates,
      dryRun: args.dryRun,
      only: args.only,
      from: args.from,
      force: args.force,
    });

    console.log("\n=== summary ===");
    console.log(`mode: ${summary.dryRun ? "dry-run" : "apply"}`);
    console.log(`ran: ${summary.ranIds.length} (${summary.ranIds.join(", ") || "none"})`);
    console.log(
      `skipped (marker present): ${summary.skippedIds.length} (${summary.skippedIds.join(", ") || "none"})`
    );
    for (const id of summary.ranIds) {
      const r = summary.results[id];
      const parts: string[] = [];
      if (r.documentsScanned != null) parts.push(`scanned=${r.documentsScanned}`);
      if (r.documentsUpdated != null) parts.push(`updated=${r.documentsUpdated}`);
      if (r.documentsInserted != null) parts.push(`inserted=${r.documentsInserted}`);
      if (r.documentsDeleted != null) parts.push(`deleted=${r.documentsDeleted}`);
      console.log(`  ${id}${parts.length ? ` — ${parts.join(", ")}` : ""}`);
      for (const note of r.notes ?? []) console.log(`    · ${note}`);
    }
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exitCode = 1;
});

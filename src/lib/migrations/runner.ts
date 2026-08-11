// Migration runner.
//
// Walks the registry in order, skips migrations whose marker exists in the
// `migrationsRun` collection, runs the rest, and writes a marker on success.
// `--only` and `--from` narrow the run set; `--force` (with `--only`) re-runs
// an idempotent migration even if its marker exists.

import type { Db } from "mongodb";
import type { Migration, MigrationMarker, MigrationResult } from "./types";

export interface RunOpts {
  migrations: Migration[];
  dryRun: boolean;
  /** Only run migrations whose id appears in this list. Preserves registry order. */
  only?: string[];
  /** Run from this id onward (inclusive). Mutually exclusive with `only`. */
  from?: string;
  /**
   * Re-run even if a marker exists. Only takes effect with `only` — never
   * forces a re-run during a normal full pass (too easy to footgun).
   */
  force?: boolean;
}

export interface RunSummary {
  ranIds: string[];
  skippedIds: string[];
  results: Record<string, MigrationResult>;
  dryRun: boolean;
}

const COLLECTION = "migrationsRun";

export async function runMigrations(db: Db, opts: RunOpts): Promise<RunSummary> {
  const summary: RunSummary = { ranIds: [], skippedIds: [], results: {}, dryRun: opts.dryRun };

  const ordered = selectMigrations(opts);
  for (const migration of ordered) {
    const existing = await db
      .collection<MigrationMarker>(COLLECTION)
      .findOne({ _id: migration.id });

    const forcedRerun = opts.force === true && opts.only?.includes(migration.id) === true;
    const shouldSkip = existing != null && !forcedRerun;
    if (shouldSkip) {
      summary.skippedIds.push(migration.id);
      continue;
    }

    const result = await migration.execute(db, { dryRun: opts.dryRun });
    summary.results[migration.id] = result;
    summary.ranIds.push(migration.id);

    if (!opts.dryRun) {
      // Upsert, not insert: a --force rerun executes over an existing marker,
      // and an insertOne here threw E11000 AFTER the migration had already
      // applied, which reads as a failed run when the data change succeeded.
      await db.collection<MigrationMarker>(COLLECTION).replaceOne(
        { _id: migration.id },
        {
          _id: migration.id,
          completedAt: new Date(),
          result,
          markerVersion: 1,
        },
        { upsert: true }
      );
    }
  }

  return summary;
}

function selectMigrations(opts: RunOpts): Migration[] {
  if (opts.only && opts.only.length > 0) {
    const order = new Map(opts.migrations.map((m, i) => [m.id, i]));
    return opts.only
      .map((id) => opts.migrations.find((m) => m.id === id))
      .filter((m): m is Migration => m != null)
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  if (opts.from) {
    const idx = opts.migrations.findIndex((m) => m.id === opts.from);
    if (idx < 0) {
      throw new Error(`--from id "${opts.from}" not found in registry`);
    }
    return opts.migrations.slice(idx);
  }
  return opts.migrations;
}

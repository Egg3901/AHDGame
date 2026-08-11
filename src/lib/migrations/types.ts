// Migration framework types.
//
// A `Migration` is one deployable database change with a stable id. The
// framework's runner consults the `migrationsRun` collection to determine
// which migrations have already executed, runs the rest in registry order,
// and writes a marker document on success.
//
// Idempotency is required information (not optional) so the runner can refuse
// to re-run an unsafe migration. Existing scripts that already manage their
// own marker (bondCurrencyStamp, corpEconomyToLocalCurrency, the v0.2.6
// scripts) are wrapped via entries in src/lib/migrations/entries/ so the
// framework picks up where they left off without changing the marker id.

import type { Db } from "mongodb";

/**
 * Result of running a single migration. All fields optional; populate what's
 * meaningful for the migration. Reported by the runner on stdout and stored on
 * the migrationsRun marker for forensic inspection.
 */
export interface MigrationResult {
  documentsScanned?: number;
  documentsUpdated?: number;
  documentsInserted?: number;
  documentsDeleted?: number;
  /** Free-form lines for runner output and the marker doc. */
  notes?: string[];
}

/**
 * Per-run options passed by the runner into each migration's execute().
 * Migrations MUST honor `dryRun` — when true, perform reads only.
 */
export interface MigrationContext {
  dryRun: boolean;
}

/**
 * One deployable migration. Lives in src/lib/migrations/registry.ts; the
 * actual implementation may live in scripts/migrations/<name>.ts and be
 * wrapped via src/lib/migrations/entries/<id>.ts.
 */
export interface Migration {
  /**
   * Stable string ID. Used as the _id of the migrationsRun marker.
   * Must never change once a migration ships.
   */
  id: string;

  /** Human-readable one-line description. */
  description: string;

  /**
   * True when re-running the migration after a successful run is a safe
   * no-op (or close to it). The framework refuses to re-run idempotent: false
   * migrations once a marker exists.
   */
  idempotent: boolean;

  /**
   * Run the migration. Throw on failure; return a MigrationResult on success.
   * The runner writes the marker AFTER execute() returns successfully.
   */
  execute: (db: Db, ctx: MigrationContext) => Promise<MigrationResult>;
}

/**
 * Schema of documents in the migrationsRun collection. Already in use by
 * three production scripts (bondCurrencyStamp, corpEconomyToLocalCurrency,
 * 2026-05-05-phase-11-live-bootstrap) — this interface formalizes the schema
 * so the runner can write markers in the same shape.
 */
export interface MigrationMarker {
  _id: string;
  completedAt: Date;
  result?: MigrationResult;
  /** Schema version of the marker doc. Bump if the shape changes. */
  markerVersion?: 1;
  /** Free-form metadata existing scripts wrote (e.g. documentsUpdated). */
  [key: string]: unknown;
}

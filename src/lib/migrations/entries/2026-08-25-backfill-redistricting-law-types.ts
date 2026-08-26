import type { Migration } from "../types";
import { runBackfillRedistrictingLawTypes } from "../../../../scripts/migrations/2026-08-25-backfill-redistricting-law-types";

export const migration: Migration = {
  id: "2026-08-25-backfill-redistricting-law-types",
  description:
    "Ticket #1189: insert the mechanical US state redistricting laws (authority, compactness, fairness) that the political-legislation exclusion sweep never seeded on live worlds, so State Redistricting Authority is proposable again.",
  // Inserts missing _ids only via $setOnInsert; a second pass finds nothing.
  idempotent: true,
  execute: (db, ctx) => runBackfillRedistrictingLawTypes(db, { dryRun: ctx.dryRun }),
};

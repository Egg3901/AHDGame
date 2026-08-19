import type { Migration } from "../types";
import { runBackfillPoliticalLegislationTypes } from "../../../../scripts/migrations/2026-08-19-backfill-political-legislation-types";

export const migration: Migration = {
  id: "2026-08-19-backfill-political-legislation-types",
  description:
    "Ticket #1106: insert new-generation legislation types the world seeder never wrote to live worlds (US state tax sliders), so the Tax category has selectable state-scope types for governors and state legislatures.",
  // Inserts missing _ids only via $setOnInsert; a second pass finds nothing.
  idempotent: true,
  execute: (db, ctx) => runBackfillPoliticalLegislationTypes(db, { dryRun: ctx.dryRun }),
};

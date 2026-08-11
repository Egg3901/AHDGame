import type { Migration } from "../types";
import { runReconcileCommandEconomyUnowned } from "../../../../scripts/migrations/reconcileCommandEconomyUnowned";

export const migration: Migration = {
  id: "2026-08-09-reconcile-command-economy-unowned",
  description:
    "Ticket #1014: Eastern-bloc/USSR command countries get one SOE with plants capacity per sector type; phantom unowned headroom pools are deleted.",
  // Upserts by assignedSectorTypes + deletes unowned; second pass is a no-op.
  idempotent: true,
  execute: (db, ctx) => runReconcileCommandEconomyUnowned(db, { dryRun: ctx.dryRun }),
};

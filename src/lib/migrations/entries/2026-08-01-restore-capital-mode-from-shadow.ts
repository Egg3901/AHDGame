import type { Migration } from "../types";
import { runRestoreCapitalModeFromShadow } from "../../../../scripts/migrations/restoreCapitalModeFromShadow";

/**
 * D13 rollback drill — NOT a forward migration.
 *
 * Registered so the framework knows it exists, can dry-run it, and writes a
 * marker if it is ever used in anger. It is a NO-OP on any world that is not
 * being rolled back: the script refuses to run while `marketSystemMode` is
 * still "plants", and on a world that never entered plants there are no
 * `legacyRevenueShadow` fields to consume.
 *
 * Deliberately NOT appended to the MIGRATIONS array — the runner walks that
 * array on deploy, and a rollback must be an explicit human act. Run it with
 * `--from` / by hand. See the script header for the full ordering.
 */
export const migration: Migration = {
  id: "2026-08-01-restore-capital-mode-from-shadow",
  description:
    "D13 ROLLBACK ONLY: restore corporateSectors.revenue from legacyRevenueShadow after flipping marketSystemMode back to capital. Not part of the forward deploy chain.",
  idempotent: true,
  execute: (db, ctx) => runRestoreCapitalModeFromShadow(db, { dryRun: ctx.dryRun }),
};

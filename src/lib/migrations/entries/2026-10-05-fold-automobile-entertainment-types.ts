import type { Migration } from "../types";
import { runFoldAutomobileEntertainmentTypes } from "../../../../scripts/migrations/2026-10-05-fold-automobile-entertainment-types";

/**
 * Re-key stored rows of the two retired corporation types to their canonical
 * identities (manufacturing vehicles, media entertainment). Identity-only and
 * idempotent; it runs at startup so no turn reads a retired type.
 */
export const migration: Migration = {
  id: "2026-10-05-fold-automobile-entertainment-types",
  description:
    "Fold retired automobile and entertainment corporation types into manufacturing vehicles and media entertainment.",
  idempotent: true,
  execute: (db, ctx) => runFoldAutomobileEntertainmentTypes(db, { dryRun: ctx.dryRun }),
};

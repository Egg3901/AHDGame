import type { Migration } from "../types";
import { runRepointRuSoes } from "../../../../scripts/migrations/2026-08-13-repoint-ru-soes";

export const migration: Migration = {
  id: "2026-08-13-repoint-ru-soes",
  description:
    "Give the USSR its 17 state enterprises and re-point its existing producing sectors onto them, so the command-economy dashboard has claimable seats. Preserves revenue (updateMany, no delete/re-seed) and is RU-scoped, unlike reconcileCommandEconomyUnowned.",
  // Reuses any SOE already present and only re-points sectors still sitting on
  // the primary corp; a second pass finds nothing to do.
  idempotent: true,
  execute: (db, ctx) => runRepointRuSoes(db, { dryRun: ctx.dryRun }),
};

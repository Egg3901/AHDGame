import type { Migration } from "../types";
import { runFixSeedSectorCurrencyDenomination } from "../../../../scripts/migrations/fixSeedSectorCurrencyDenomination";

export const migration: Migration = {
  id: "2026-08-01-fix-seed-sector-currency-denomination",
  description:
    "Re-denominate seed-spawned NPP founding sectors whose corporateSectors.revenue was written in ₳ instead of the host-state currency (spawnNppCorporation skipped writeCorpEconomicLocal).",
  // Idempotent only via the runner's marker — the arithmetic itself is NOT
  // (a second pass would multiply by fx again). The marker is the guard; see
  // the crash-recovery note in the script header.
  idempotent: false,
  execute: (db, ctx) => runFixSeedSectorCurrencyDenomination(db, { dryRun: ctx.dryRun }),
};

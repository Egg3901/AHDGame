import { runBankTreasuryTradeIndexes } from "../../../../scripts/migrations/2026-10-04-bank-treasury-trade-indexes";
import type { Migration } from "../types";

export const migration: Migration = {
  id: "2026-10-04-bank-treasury-trade-indexes",
  description: "Status and creation-order index for funded bank treasury trade recovery.",
  idempotent: true,
  execute: (db, ctx) => runBankTreasuryTradeIndexes(db, { dryRun: ctx.dryRun }),
};

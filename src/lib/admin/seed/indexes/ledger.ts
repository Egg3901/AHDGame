import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for the shadow double-entry ledger collections (plan §4).
 *
 * `ledgerEntries` keeps raw entries ~90 days then rolls up (rollup is Phase 3+);
 * `balanceSnapshots` / `ledgerReconciliations` are one doc per turn. All are
 * SHADOW-ONLY — game code never reads them; the reconciler and ops-dash do.
 */
export async function seedLedgerIndexes(db: Db, log: (msg: string) => void) {
  log("Shadow ledger indexes:");

  await ensureIndex(
    db,
    "ledgerEntries",
    { turn: 1 },
    { name: "ledgerEntries_turn", background: true },
    log
  );
  await ensureIndex(
    db,
    "ledgerEntries",
    { "legs.account": 1, turn: 1 },
    { name: "ledgerEntries_account_turn", background: true },
    log
  );
  await ensureIndex(
    db,
    "ledgerEntries",
    { balanced: 1 },
    { name: "ledgerEntries_balanced", background: true },
    log
  );

  await ensureIndex(
    db,
    "balanceSnapshots",
    { turn: 1 },
    { name: "balanceSnapshots_turn", unique: true, background: true },
    log
  );

  await ensureIndex(
    db,
    "ledgerReconciliations",
    { turn: -1 },
    { name: "ledgerReconciliations_turn_desc", background: true },
    log
  );

  await ensureIndex(
    db,
    "economicVitalSigns",
    { turn: -1 },
    { name: "economicVitalSigns_turn_desc", unique: true, background: true },
    log
  );

  await ensureIndex(
    db,
    "nppMarketEntryFunnels",
    { turn: -1 },
    { name: "nppMarketEntryFunnels_turn_desc", background: true },
    log
  );

  log("Shadow ledger indexes ensured");
}

import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes required by the sovereign-default state machine (Phase 1+).
 *
 * Absorbs `scripts/migrations/deprecated/sovereignDefaultPhase1Indexes.ts`. The
 * companion data migration that backfills the new federalBudget fields on
 * legacy documents stays a one-shot — Phase 3 of the seed cleanup folded the
 * same defaults into `buildNationalBudgetSeed`, so a fresh world doesn't need
 * either script run.
 */
export async function seedSovereignDefaultIndexes(db: Db, log: (msg: string) => void) {
  log("Sovereign default indexes:");

  // State-machine sweep — find every country in any non-normal state.
  await ensureIndex(
    db,
    "federalBudget",
    { sovereignCrisisState: 1 },
    { name: "sovereignCrisisState_1" },
    log
  );

  // 12-hour executive-decision deadline sweep. Sparse — most rows have no
  // pending crisis, so the index only stores documents with the field set.
  await ensureIndex(
    db,
    "federalBudget",
    { "crisisAutoActionAt.realtimeMs": 1 },
    { name: "crisisAutoActionAt_realtimeMs_1", sparse: true },
    log
  );

  // Legislative-deadline sweep. Same sparse rationale.
  await ensureIndex(
    db,
    "federalBudget",
    { "crisisLegislativeDeadlineAt.realtimeMs": 1 },
    { name: "crisisLegislativeDeadlineAt_realtimeMs_1", sparse: true },
    log
  );

  // IMF Board override window sweep. Same sparse rationale.
  await ensureIndex(
    db,
    "federalBudget",
    { "imfBoardOverrideWindowEndAt.realtimeMs": 1 },
    { name: "imfBoardOverrideWindowEndAt_realtimeMs_1", sparse: true },
    log
  );

  // sovereignCrisisDecisions — query open decisions per country.
  await ensureIndex(
    db,
    "sovereignCrisisDecisions",
    { countryCode: 1, state: 1 },
    { name: "countryCode_state_1" },
    log
  );

  // sovereignCrisisDecisions — chronological scans / deadline reconstruction.
  await ensureIndex(
    db,
    "sovereignCrisisDecisions",
    { firedAtRealtimeMs: 1 },
    { name: "firedAtRealtimeMs_1" },
    log
  );

  log("Sovereign default indexes ensured");
}

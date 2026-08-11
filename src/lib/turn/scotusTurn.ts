/**
 * SCOTUS Turn (#3598) — single turn-phase entry point, mirroring the shape of
 * `processCentralBankChairSelection` / `processCabinetNominationLifecycle`
 * (one exported function per turn-phase registration).
 *
 * Runs, in order:
 *  1. Tenure turn — Original Roster auto-succession + divergent hazard clock.
 *     Must run before the docket turn so a case fired this same turn sees
 *     this turn's seat vacancies/successions, not last turn's.
 *  2. Docket turn — fires due cases, evaluates divergence, wires diverged
 *     rulings into the enacted-laws pipeline.
 *  3. Surprise case turn (#3607) — small constant-probability check for a
 *     procedurally-spawned, non-historical Docket case. Runs after the
 *     curated docket turn so both draw from the exact same seated-justice
 *     snapshot for this turn; independent of it otherwise (a historical
 *     case's diverged ruling doesn't reseat justices, so ordering between
 *     these two doesn't change either one's outcome — kept after docket
 *     simply to read top-to-bottom as "curated content first, flavor
 *     content second").
 *  4. Nomination lifecycle — NPP Senate votes + resolves expired nominations.
 *     Runs last since a newly-seated justice only matters starting next turn.
 */
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { processScotusTenureTurn, type ScotusTenureTurnResult } from "./scotusTenureTurn";
import { processScotusDocketTurn, type ScotusDocketTurnResult } from "./scotusDocketTurn";
import {
  processScotusSurpriseCaseTurn,
  type ScotusSurpriseCaseTurnResult,
} from "./scotusSurpriseCaseTurn";
import {
  processScotusNominationLifecycle,
  type ScotusNominationLifecycleResult,
} from "./scotusNominationLifecycle";

export interface ScotusTurnResult {
  tenure: ScotusTenureTurnResult;
  docket: ScotusDocketTurnResult;
  surpriseCase: ScotusSurpriseCaseTurnResult;
  nominations: ScotusNominationLifecycleResult;
}

export async function processScotusTurn(
  currentTurn: number,
  now: Date,
  db?: Db
): Promise<ScotusTurnResult> {
  const database = db ?? (await getDb());
  const tenure = await processScotusTenureTurn(currentTurn, database);
  const docket = await processScotusDocketTurn(currentTurn, database);
  const surpriseCase = await processScotusSurpriseCaseTurn(currentTurn, database);
  const nominations = await processScotusNominationLifecycle(now, database);
  return { tenure, docket, surpriseCase, nominations };
}

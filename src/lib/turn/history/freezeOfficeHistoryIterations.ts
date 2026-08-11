import type { Db } from "mongodb";
import type { GameIteration } from "@/lib/db/types/gameState";
import { realDateToTurn, type GameDateAnchor } from "@/lib/utils/gameDate";

export interface FreezeResult {
  countryHistory: number;
  cabinetMembers: number;
  cabinetNominations: number;
  congressLeaders: number;
  leadershipNominations: number;
}

const LEADERSHIP_NOMINATION_COLLECTIONS = [
  "speakerNominations",
  "houseLeadershipNominations",
  "senateLeadershipNominations",
];

interface TimestampedRow {
  confirmedAt?: Date | string;
  updatedAt?: Date | string;
  createdAt?: Date | string;
  turn?: number;
}

function turnFor(row: TimestampedRow, anchor: GameDateAnchor): number {
  if (typeof row.turn === "number") return row.turn;
  const ts = row.confirmedAt ?? row.updatedAt ?? row.createdAt;
  if (!ts) return anchor.currentTurn;
  return realDateToTurn(ts, anchor);
}

/**
 * Stamp every still-unstamped office-history record — country-history events,
 * cabinet holders + confirmations, congressional leaders + confirmed
 * nominations — with `iteration` + `iterationStartingYear` + a derived
 * `confirmedTurn`. Idempotent: rows that already carry `iteration` are skipped.
 *
 * Invoked at the start of `resetGameWorld` (freezing the outgoing run with its
 * still-valid anchor before the clock resets) and by the backfill migration.
 */
export async function freezeOfficeHistoryIterations(
  db: Db,
  iteration: GameIteration,
  anchor: GameDateAnchor,
  opts: { dryRun?: boolean } = {}
): Promise<FreezeResult> {
  const result: FreezeResult = {
    countryHistory: 0,
    cabinetMembers: 0,
    cabinetNominations: 0,
    congressLeaders: 0,
    leadershipNominations: 0,
  };
  const startingYear = anchor.startingYear;

  async function stamp(name: string, withTurn: boolean): Promise<number> {
    const rows = (await db
      .collection(name)
      .find({ iteration: { $exists: false } })
      .toArray()) as Array<TimestampedRow & { _id: unknown }>;
    let count = 0;
    for (const row of rows) {
      count += 1;
      if (opts.dryRun) continue;
      const set: Record<string, unknown> = {
        iteration,
        iterationStartingYear: startingYear,
      };
      if (withTurn) set.confirmedTurn = turnFor(row, anchor);
      await db.collection(name).updateOne({ _id: row._id as never }, { $set: set });
    }
    return count;
  }

  result.countryHistory = await stamp("countryHistory", false);
  result.cabinetMembers = await stamp("cabinetMembers", true);
  result.cabinetNominations = await stamp("cabinetNominations", true);
  result.congressLeaders = await stamp("congressLeaders", true);
  let leadershipTotal = 0;
  for (const name of LEADERSHIP_NOMINATION_COLLECTIONS) {
    leadershipTotal += await stamp(name, true);
  }
  result.leadershipNominations = leadershipTotal;

  return result;
}

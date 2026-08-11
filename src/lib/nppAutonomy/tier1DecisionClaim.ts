/**
 * Persistence adapter for Tier-1 NPP strategic decision slots (#3724).
 *
 * Claims are stored on `countryGameStates.lastNppStrategicDecisionCycle` with a
 * compare-and-set filter so a restarted worker cannot double-fire the same
 * cycle. Watermark-only upserts are safe for access resolution: missing
 * enablement fields still fall back to CountryConfig (including US, which is
 * not normally seeded into this collection).
 *
 * `playerControlled` is caller-supplied: country-level strategy (diplomacy /
 * sphere / NPP governing brain) passes true when humans own that surface.
 * Scheduling alone never infers it from enablement flags.
 */

import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CountryGameState } from "@/lib/db/types/gameState";
import {
  evaluateTier1NppDecisionSchedule,
  type Tier1DecisionScheduleVerdict,
} from "./tier1DecisionSchedule";

export interface ClaimTier1NppDecisionSlotOptions {
  /** When true, refuse the slot — humans own this decision surface. */
  playerControlled?: boolean;
}

/**
 * Read the persisted watermark, evaluate the pure schedule, and — when due —
 * atomically claim the cycle before the caller acts.
 */
export async function claimTier1NppDecisionSlot(
  db: Db,
  countryId: CountryId,
  turn: number,
  now: Date,
  options?: ClaimTier1NppDecisionSlotOptions
): Promise<Tier1DecisionScheduleVerdict> {
  const playerControlled = options?.playerControlled === true;

  const col = db.collection<CountryGameState>("countryGameStates");
  const existing = await col.findOne(
    { _id: countryId },
    { projection: { lastNppStrategicDecisionCycle: 1 } }
  );
  const lastCompletedCycle = existing?.lastNppStrategicDecisionCycle;

  const verdict = evaluateTier1NppDecisionSchedule({
    countryId,
    turn,
    lastCompletedCycle,
    playerControlled,
  });

  if (!verdict.run || verdict.completedCycle == null) {
    return verdict;
  }

  const cycle = verdict.completedCycle;
  // Claim-before-act: only one worker may advance the watermark for this cycle.
  const claim = await col.updateOne(
    {
      _id: countryId,
      $or: [
        { lastNppStrategicDecisionCycle: { $exists: false } },
        { lastNppStrategicDecisionCycle: { $lt: cycle } },
      ],
    },
    {
      $set: { lastNppStrategicDecisionCycle: cycle, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  if (claim.matchedCount === 0 && claim.upsertedCount === 0) {
    return {
      run: false,
      bucket: verdict.bucket,
      cycle: verdict.cycle,
      reason: "already-completed",
    };
  }

  return verdict;
}

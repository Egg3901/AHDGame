// src/lib/turn/partyInfluenceTurn.ts
import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { Character, GameConfig } from "@/lib/db/types";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { StatePartyOrg } from "@/lib/db/types/statePartyOrg";
import type { Caucus } from "@/lib/db/types/caucus";
import { energyActionLimits } from "@/lib/stats/statDrift";
import { STAT_MIN } from "@/lib/stats/statsConstants";

/*
 * Reference infamy level at which the infamy penalty reaches its configured
 * maximum (maxPenalty, default 4). The logarithmic formula means the penalty
 * grows quickly at low infamy and flattens as infamy climbs — a character at
 * 300 infamy loses 4 party influence per turn, the same as the base rate gain
 * for a perfectly aligned member, effectively zeroing out their net gain.
 * This value is high (300) because infamy is hard to accumulate quickly —
 * setting it lower would penalise even mild scandal too harshly.
 */
const INFAMY_REFERENCE = 300;
export const DEFAULT_PARTY_INFLUENCE_POOL_MULTIPLIER = 3;
export const DEFAULT_PARTY_INFLUENCE_MAX_BONUS = 6;

/**
 * Closeness scalar (0–1) between a character's policies and their party's positions.
 * Uses Euclidean distance on the economic + social axes (scale −5 to 5, maxDist ≈ 14.14).
 */
export function computeClosenessScalar(
  myEcon: number,
  mySocial: number,
  partyEcon: number,
  partySocial: number
): number {
  const MAX_DISTANCE = Math.sqrt(200); // sqrt(10² + 10²)
  const dist = Math.sqrt((myEcon - partyEcon) ** 2 + (mySocial - partySocial) ** 2);
  return Math.max(0, 1 - dist / MAX_DISTANCE);
}

/**
 * Logarithmic infamy penalty on party influence gain.
 * Grows quickly at moderate infamy, flattens near maxPenalty.
 */
export function computeInfamyPenalty(infamy: number, maxPenalty: number): number {
  if (infamy <= 0) return 0;
  const raw = maxPenalty * (Math.log(1 + infamy) / Math.log(1 + INFAMY_REFERENCE));
  return Math.min(maxPenalty, raw);
}

/**
 * Flat per-turn bonus from leadership roles (stackable).
 * National Chair +5, Vice Chair +2, Treasurer +2, National Committee +1.
 * State Chair +2, State Vice Chair +1 (passed via options — state roles live
 * on `statePartyOrg`, not the national party doc).
 * Caucus Chair +2, Caucus Vice Chair +1 (passed via options — caucus roles
 * live on the `caucuses` collection, mirroring the state-org shape/magnitude).
 *
 * Chair bonuses are sized so party leadership accumulates partyInfluence
 * faster, which now feeds both the presidential-primary snapshot score and
 * the state-by-state vote weight.
 */
export function computeLeadershipBonus(
  characterId: ObjectId,
  party: {
    chairId: ObjectId | null | undefined;
    viceChairId: ObjectId | null | undefined;
    treasurerId: ObjectId | null | undefined;
    committeeIds: ObjectId[] | null | undefined;
  },
  options?: {
    isStateChair?: boolean;
    isStateViceChair?: boolean;
    isCaucusChair?: boolean;
    isCaucusViceChair?: boolean;
  }
): number {
  let bonus = 0;
  if (party.chairId?.equals(characterId)) bonus += 5;
  if (party.viceChairId?.equals(characterId)) bonus += 2;
  if (party.treasurerId?.equals(characterId)) bonus += 2;
  if (party.committeeIds?.some((id) => id.equals(characterId))) bonus += 1;
  if (options?.isStateChair) bonus += 2;
  if (options?.isStateViceChair) bonus += 1;
  if (options?.isCaucusChair) bonus += 2;
  if (options?.isCaucusViceChair) bonus += 1;
  return bonus;
}

/**
 * Per-turn change to partyInfluence (can be negative when infamy is high).
 */
export function computeTurnGain(
  closenessScalar: number,
  leadershipBonus: number,
  infamyPenalty: number,
  baseRate: number
): number {
  return baseRate * closenessScalar + leadershipBonus - infamyPenalty;
}

/**
 * Apply decay then add turnGain. Floors at 0.
 */
export function computeNewInfluence(current: number, turnGain: number, decayRate: number): number {
  return Math.max(0, current * (1 - decayRate) + turnGain);
}

/**
 * Bonus actions for this character this turn, based on their share of party influence.
 * rawShare = (myInfluence / totalInfluence) × totalPool, then scaled by closeness and capped.
 */
export function computeBonusActions(
  myInfluence: number,
  totalInfluence: number,
  totalPool: number,
  closenessScalar: number,
  maxBonus: number
): number {
  if (totalInfluence === 0) return 0;
  const rawShare = (myInfluence / totalInfluence) * totalPool;
  return Math.min(maxBonus, Math.floor(rawShare * closenessScalar));
}

/**
 * Process party influence accumulation and bonus action distribution for all player characters.
 * Runs after processActionRefresh; bonus actions are applied with the same
 * Energy-scaled cap as refresh so party grants cannot push a character above
 * their per-character action cap (see {@link energyActionLimits}).
 */
export async function processPartyInfluenceTurn(
  characters: Character[],
  config: GameConfig | null,
  now: Date
): Promise<void> {
  const db = await getDb();

  /*
   * Defaults model a "use it or lose it" mechanic:
   *   decayRate 4%/turn → ~85 turns (~21 game months) half-life without activity
   *   baseRate 3/turn → a perfectly-aligned character gains 3 per turn before decay
   *   maxPenalty 4/turn → infamy can cancel the entire base gain (see INFAMY_REFERENCE)
   *   poolMultiplier 3 → action bonus pool = 3 × party member count per turn
   *   maxBonus 6/turn → highest-influence member caps at 6 bonus actions
   * All values are configurable via GameConfig and can be tuned live without a deploy.
   */
  const decayRate = config?.partyInfluenceDecayRate ?? 0.04;
  const baseRate = config?.partyInfluenceBaseRate ?? 3;
  const maxPenalty = config?.partyInfluenceMaxPenalty ?? 4;
  const poolMultiplier = Math.max(
    config?.partyInfluencePoolMultiplier ?? 0,
    DEFAULT_PARTY_INFLUENCE_POOL_MULTIPLIER
  );
  const maxBonus = Math.max(config?.partyInfluenceMaxBonus ?? 0, DEFAULT_PARTY_INFLUENCE_MAX_BONUS);

  // Load all parties; key by countryId:sequentialId per project convention
  const parties = await db.collection<PoliticalParty>("politicalParties").find({}).toArray();
  const partyMap = new Map(parties.map((p) => [`${p.countryId}:${p.sequentialId}`, p]));

  // State-party leadership — chairs / vice chairs accumulate partyInfluence
  // (which feeds presidential primary standing). Build sets keyed by character id.
  const statePartyOrgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find(
      {
        $or: [{ chairId: { $ne: null } }, { viceChairId: { $ne: null } }],
      },
      { projection: { chairId: 1, viceChairId: 1 } }
    )
    .toArray();
  const stateChairIds = new Set<string>();
  const stateViceChairIds = new Set<string>();
  for (const spo of statePartyOrgs) {
    if (spo.chairId) stateChairIds.add(spo.chairId.toString());
    if (spo.viceChairId) stateViceChairIds.add(spo.viceChairId.toString());
  }

  // Caucus leadership — chairs / vice chairs of ACTIVE caucuses (disbandedAt: null)
  // accumulate partyInfluence the same way state-org leaders do. Same magnitude as
  // the state-org roles (chair +2, vice +1). Build sets keyed by character id.
  const caucuses = await db
    .collection<Caucus>("caucuses")
    .find(
      {
        disbandedAt: null,
        $or: [{ chairId: { $ne: null } }, { viceChairId: { $ne: null } }],
      },
      { projection: { chairId: 1, viceChairId: 1 } }
    )
    .toArray();
  const caucusChairIds = new Set<string>();
  const caucusViceChairIds = new Set<string>();
  for (const caucus of caucuses) {
    if (caucus.chairId) caucusChairIds.add(caucus.chairId.toString());
    if (caucus.viceChairId) caucusViceChairIds.add(caucus.viceChairId.toString());
  }

  // Group characters by their party key
  const byParty = new Map<string, Character[]>();
  for (const char of characters) {
    const key = `${char.countryId}:${char.party}`;
    const group = byParty.get(key);
    if (group) {
      group.push(char);
    } else {
      byParty.set(key, [char]);
    }
  }

  const ops: Array<{
    updateOne: {
      filter: { _id: ObjectId };
      update:
        | { $set: Record<string, unknown>; $inc?: Record<string, number> }
        | Record<string, unknown>[];
    };
  }> = [];

  for (const [partyKey, members] of byParty) {
    const party = partyMap.get(partyKey);
    if (!party) continue; // independent/unknown party — skip

    // Compute closeness for each member (reused for both accumulation and bonus scaling)
    const memberData = members.map((char) => ({
      char,
      closeness: computeClosenessScalar(
        char.policies.economic,
        char.policies.social,
        party.economicPosition,
        party.socialPosition
      ),
    }));

    const totalInfluence = members.reduce((sum, c) => sum + (c.partyInfluence ?? 0), 0);
    const totalPool = poolMultiplier * members.length;

    for (const { char, closeness } of memberData) {
      const charIdStr = char._id.toString();
      const leadershipBonus = computeLeadershipBonus(char._id, party, {
        isStateChair: stateChairIds.has(charIdStr),
        isStateViceChair: stateViceChairIds.has(charIdStr),
        isCaucusChair: caucusChairIds.has(charIdStr),
        isCaucusViceChair: caucusViceChairIds.has(charIdStr),
      });
      const infamyPenalty = computeInfamyPenalty(char.infamy ?? 0, maxPenalty);
      const turnGain = computeTurnGain(closeness, leadershipBonus, infamyPenalty, baseRate);
      const newInfluence = computeNewInfluence(char.partyInfluence ?? 0, turnGain, decayRate);
      const bonusActions = computeBonusActions(
        char.partyInfluence ?? 0,
        totalInfluence,
        totalPool,
        closeness,
        maxBonus
      );

      if (bonusActions > 0) {
        // Cap at this character's Energy-scaled action cap (matches actionRefresh).
        const energyCap = energyActionLimits(char.stats?.energy ?? STAT_MIN).cap;
        ops.push({
          updateOne: {
            filter: { _id: char._id },
            update: [
              {
                $set: {
                  partyInfluence: newInfluence,
                  updatedAt: now,
                  actions: {
                    $min: [energyCap, { $add: [{ $ifNull: ["$actions", 0] }, bonusActions] }],
                  },
                },
              },
            ],
          },
        });
      } else {
        ops.push({
          updateOne: {
            filter: { _id: char._id },
            update: { $set: { partyInfluence: newInfluence, updatedAt: now } },
          },
        });
      }
    }
  }

  if (ops.length > 0) {
    await db.collection("characters").bulkWrite(ops as never);
  }
}

/**
 * NPP union agency.
 *
 * The union system was built entirely around player characters: `Union.ownerId`
 * is a character id and every command in `src/lib/unions/commands/**` checks
 * `character._id`. In an NPP-only world that leaves every union leaderless
 * forever, which silently switches off the whole labour-bargaining layer —
 * `buildOwnedUnionMembershipPressureByKey` only counts unions with an owner, so
 * unionization drift, strike pressure and wage bargaining all sit at zero.
 *
 * This phase gives NPPs the same agency a player has:
 *   1. vacant unions elect an NPP leader (autonomy ≥ v3),
 *   2. leaders recruit — spending union treasury to raise membershipPressure,
 *   3. leaders post a demanded wage level for their (country, sector) scope,
 *   4. leaders call a strike when a demand has been ignored and the shop floor
 *      is organised enough to back it,
 *   5. NPP-run corporations answer the demand, conceding partially rather than
 *      all at once so bargaining takes several turns.
 *
 * Step 5 is what closes the loop: without a corporate response a wage demand is
 * just a number on a document. Player-run corporations are deliberately left
 * alone — a human CEO answers their own unions.
 */
import type { Db, ObjectId } from "mongodb";
import type { Union } from "@/lib/db/types/union";
import type { NPP } from "@/lib/db/types/npp";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  applyRecruit,
  RECRUIT_COST,
  STRIKE_CALL_MIN_UNIONIZATION,
  strikeCallCost,
  UNION_STRIKE_CALL_COOLDOWN_TURNS,
} from "@/lib/unions/unionEconomy";
import { getNppAutonomyLevel, nppAutonomyLevelAtLeast } from "@/lib/nppAutonomy/featureFlag";
import { getLabourSystemMode, labourAtLeast } from "@/lib/labour/featureFlag";
import { realWageIndex } from "@/lib/labour/unionization";
import { STRIKE_EXPECTATION_GAP_THRESHOLD } from "@/lib/labour/strikes";

/** Minimum membershipPressure before a leader will post a wage demand. */
export const NPP_DEMAND_MIN_PRESSURE = 15;
/** How far above the current average wage level a union asks for. */
export const NPP_DEMAND_PREMIUM = 0.12;
/** Ceiling on a demanded wage level.
 *  Must not exceed WAGE_LEVEL_MAX (src/lib/labour/laborCost.ts), which every
 *  player-facing path already clamps to. At 1.8 the stored wageLevel drifted 20%
 *  past the model's maximum: sectorTurn clamps on READ so labour cost saturated
 *  rather than exploding, but raw readers (realWageIndex, brandQualityTurn) saw
 *  out-of-range values, and the demand became permanently unsatisfiable — every
 *  sector parked at the ceiling with margins pinned. */
export const NPP_DEMAND_CEILING = 1.5;
/** Share of the gap to the demand that an NPP-run corp concedes per turn. */
export const NPP_CONCESSION_RATE = 0.25;
/** A corp only concedes while its sector margin is at least this (percent). */
export const NPP_CONCESSION_MIN_MARGIN = 8;
/** Turns a demand must stand unmet before a strike becomes an option. */
export const NPP_STRIKE_PATIENCE_TURNS = 6;
export interface NppUnionBehaviorResult {
  leadersElected: number;
  recruited: number;
  demandsPosted: number;
  strikesCalled: number;
  concessions: number;
}

const EMPTY: NppUnionBehaviorResult = {
  leadersElected: 0,
  recruited: 0,
  demandsPosted: 0,
  strikesCalled: 0,
  concessions: 0,
};

/**
 * Deterministic per-union pick from a candidate list. The turn path forbids
 * Math.random (see src/lib/events/substrate/rng.ts), and a seeded stream is not
 * threaded into this phase, so selection is derived from the union id instead —
 * stable across replays of the same world.
 */
function pickDeterministic<T>(candidates: T[], seed: ObjectId): T {
  const hex = seed.toHexString();
  let acc = 0;
  for (let i = hex.length - 8; i < hex.length; i++) acc = (acc * 31 + hex.charCodeAt(i)) >>> 0;
  return candidates[acc % candidates.length];
}

/**
 * Ambition drives who puts themselves forward for a union post, and how hard
 * they push once they hold it. Normalised to 0-1.
 */
function militancy(npp: Pick<NPP, "personality">): number {
  const ambition = npp.personality?.ambition ?? 50;
  const stubbornness = npp.personality?.stubbornness ?? 50;
  return Math.max(0, Math.min(1, (ambition * 0.6 + stubbornness * 0.4) / 100));
}

export async function processNppUnionBehavior(
  db: Db,
  currentTurn: number
): Promise<NppUnionBehaviorResult> {
  // Union agency is player-parity behaviour, so it arrives with the tier that
  // grants NPPs parity — v3 and above. Below that unions stay as they were.
  const level = await getNppAutonomyLevel(db);
  if (!nppAutonomyLevelAtLeast(level, "v3")) return EMPTY;

  // The labour ladder decides whether membershipPressure reaches unionization
  // and labor cost at all (`ownedUnionMembershipPressureByKey` is fetched only
  // at "full"). Acting below that tier would write demands nothing can read.
  if (!labourAtLeast(await getLabourSystemMode(), "unions")) return EMPTY;

  const unions = await db
    .collection<Union>("unions")
    .find({ suspended: { $ne: true } })
    .toArray();
  if (unions.length === 0) return EMPTY;

  const result: NppUnionBehaviorResult = { ...EMPTY };
  const now = new Date();

  // ── 1. Elect NPP leaders into vacant unions ───────────────────────────────
  // One NPP may lead at most one union, so already-committed NPPs are excluded
  // before picking. Without this a single high-ambition NPP would be elected to
  // every vacant union in the country on the same turn.
  const vacant = unions.filter((u) => u.ownerId == null);
  if (vacant.length > 0) {
    const countries = Array.from(new Set(vacant.map((u) => u.countryId)));
    const npps = await db
      .collection<NPP>("npps")
      .find(
        { countryId: { $in: countries }, retiredAt: null },
        { projection: { _id: 1, countryId: 1, personality: 1 } }
      )
      .toArray();

    const taken = new Set(
      unions
        .filter((u) => u.ownerType === "npp" && u.ownerId)
        .map((u) => (u.ownerId as ObjectId).toHexString())
    );
    const byCountry = new Map<string, NPP[]>();
    for (const n of npps) {
      if (!n.countryId) continue;
      if (taken.has(n._id.toHexString())) continue;
      (byCountry.get(n.countryId) ?? byCountry.set(n.countryId, []).get(n.countryId)!).push(n);
    }
    // The most militant NPPs stand for union office first.
    for (const list of byCountry.values()) list.sort((a, b) => militancy(b) - militancy(a));

    const ops: Array<{
      updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
    }> = [];
    for (const union of vacant) {
      const pool = byCountry.get(union.countryId);
      if (!pool || pool.length === 0) continue;
      // Draw from the top of the militancy ordering, but spread across it so a
      // country's unions do not all fall to adjacent personalities.
      const slice = pool.slice(0, Math.max(1, Math.ceil(pool.length / 2)));
      const chosen = pickDeterministic(slice, union._id);
      const idx = pool.findIndex((n) => n._id.equals(chosen._id));
      if (idx >= 0) pool.splice(idx, 1);
      ops.push({
        updateOne: {
          filter: { _id: union._id, ownerId: null },
          update: {
            $set: {
              ownerId: chosen._id,
              ownerType: "npp",
              updatedAt: now,
            },
            $unset: { pendingLeaderCharacterId: "" },
          },
        },
      });
      union.ownerId = chosen._id;
      union.ownerType = "npp";
    }
    if (ops.length > 0) {
      await db.collection<Union>("unions").bulkWrite(ops as never);
      result.leadersElected = ops.length;
    }
  }

  // ── 2-4. Led unions act ───────────────────────────────────────────────────
  const led = unions.filter((u) => u.ownerType === "npp" && u.ownerId != null);
  if (led.length === 0) return result;

  const leaderIds = led.map((u) => u.ownerId as ObjectId);
  const leaders = await db
    .collection<NPP>("npps")
    .find({ _id: { $in: leaderIds }, retiredAt: null }, { projection: { _id: 1, personality: 1 } })
    .toArray();
  const leaderById = new Map(leaders.map((n) => [n._id.toHexString(), n]));

  // Current average wage level per (country, sector), so a demand is anchored to
  // what employers actually pay rather than an absolute constant.
  const wageAgg = await db
    .collection<CorporateSector>("corporateSectors")
    .aggregate<{ _id: { c: string; s: string }; avgWage: number; avgMargin: number; n: number }>([
      {
        $group: {
          _id: { c: "$countryId", s: "$sectorType" },
          avgWage: { $avg: { $ifNull: ["$wageLevel", 1] } },
          avgMargin: { $avg: { $ifNull: ["$profitMargin", 0] } },
          n: { $sum: 1 },
        },
      },
    ])
    .toArray();
  const wageByKey = new Map(
    wageAgg.map((w) => [`${w._id.c}::${w._id.s}`, { wage: w.avgWage, margin: w.avgMargin, n: w.n }])
  );

  const unionOps: Array<{
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }> = [];
  // Typed to the domain unions, not to `string`: the widened form does not
  // satisfy `Filter<CorporateSector>` when these are spread into the `$or`
  // below, and `union.countryId` / `union.sectorType` already carry these types.
  const strikeScopes: Array<{ countryId: CountryId; sectorType: CorporationType }> = [];
  // Demands keyed as they are decided, so the corporate-response pass below can
  // look them up directly instead of re-scanning unionOps per sector (that scan
  // was O(unions x ops) every turn — ~166k ObjectId comparisons per turn at 408
  // unions, for data already in hand).
  const demandByKey = new Map<string, number>();

  // A union whose leader has retired or been removed is re-vacated so the next
  // turn's election can seat someone. Without this it would keep its stale
  // ownerId forever — never matched by the `ownerId == null` vacancy filter and
  // never acted on here — going permanently inert with no recovery path.
  const orphaned: ObjectId[] = [];
  for (const union of led) {
    const leader = leaderById.get((union.ownerId as ObjectId).toHexString());
    if (!leader) {
      orphaned.push(union._id);
      continue;
    }
    const m = militancy(leader);
    const scope = wageByKey.get(`${union.countryId}::${union.sectorType}`);
    const set: Record<string, unknown> = { updatedAt: now };
    const inc: Record<string, number> = {};

    // Recruit — spend dues to grow the shop floor. Militant leaders push
    // harder, and recruiting stops once the union is already saturated.
    if (union.treasury >= RECRUIT_COST && union.membershipPressure < 85 && m > 0.35) {
      set.membershipPressure = applyRecruit(union.membershipPressure);
      inc.treasury = -RECRUIT_COST;
      result.recruited++;
    }

    // Post a wage demand once there is enough membership behind it.
    const pressure = (set.membershipPressure as number) ?? union.membershipPressure;
    if (scope && pressure >= NPP_DEMAND_MIN_PRESSURE) {
      const ask = Math.min(NPP_DEMAND_CEILING, scope.wage * (1 + NPP_DEMAND_PREMIUM * (0.5 + m)));
      // Only ever ratchet the ask upward — a union does not bargain against
      // itself by lowering a standing demand.
      if (union.demandedWageLevel == null || ask > union.demandedWageLevel + 0.005) {
        set.demandedWageLevel = Math.round(ask * 1000) / 1000;
        result.demandsPosted++;
      }
      const decided = (set.demandedWageLevel as number) ?? union.demandedWageLevel;
      if (decided != null) demandByKey.set(`${union.countryId}::${union.sectorType}`, decided);
    }

    // Strike — only when a demand has stood unmet, the shop floor is organised
    // enough to back it, the cooldown has elapsed and the treasury can fund it.
    const demand = (set.demandedWageLevel as number) ?? union.demandedWageLevel;
    const unmet = demand != null && scope != null && scope.wage < demand - 0.02;
    const cooledDown =
      union.lastCalledStrikeTurn == null ||
      currentTurn - union.lastCalledStrikeTurn >= UNION_STRIKE_CALL_COOLDOWN_TURNS;
    const organised = pressure >= STRIKE_CALL_MIN_UNIONIZATION;
    const patient =
      union.lastCalledStrikeTurn == null ||
      currentTurn - union.lastCalledStrikeTurn >= NPP_STRIKE_PATIENCE_TURNS;
    if (unmet && cooledDown && organised && patient && m > 0.55 && scope) {
      const cost = strikeCallCost(scope.n);
      const treasuryAfter = union.treasury + (inc.treasury ?? 0);
      if (treasuryAfter >= cost) {
        inc.treasury = (inc.treasury ?? 0) - cost;
        set.lastCalledStrikeTurn = currentTurn;
        // Stamping lastCalledStrikeTurn alone is NOT a strike — it only burns
        // treasury and inflates the counter. The engine reads
        // strikeStartedAtTurn plus a real wage-expectation gap off the SECTOR
        // (see callUnionStrike): without the gap, stepStrike sees it already
        // closed and auto-resolves next turn as a false concession.
        strikeScopes.push({ countryId: union.countryId, sectorType: union.sectorType });
        result.strikesCalled++;
      }
    }

    if (Object.keys(set).length > 1 || Object.keys(inc).length > 0) {
      unionOps.push({
        updateOne: {
          filter: { _id: union._id },
          update: Object.keys(inc).length > 0 ? { $set: set, $inc: inc } : { $set: set },
        },
      });
    }
  }
  if (orphaned.length > 0) {
    await db
      .collection<Union>("unions")
      .updateMany(
        { _id: { $in: orphaned } },
        { $set: { ownerId: null, updatedAt: now }, $unset: { ownerType: "" } }
      );
  }
  if (unionOps.length > 0) await db.collection<Union>("unions").bulkWrite(unionOps as never);

  // Plant the real strike, mirroring callUnionStrike EXACTLY (the player path).
  // The prior version was `updateMany({countryId, sectorType})` with a fixed
  // expectation index of 2.0, which had two defects against player-run corps:
  //   1. No eligibility filter. callUnionStrike only strikes sectors that are
  //      organised (`unionization >= STRIKE_CALL_MIN_UNIONIZATION`), not already
  //      striking (`strikeStartedAtTurn: null`) and past their per-sector
  //      cooldown. The blanket updateMany struck 0%-unionized sectors, reset a
  //      sector's own active strike (extending it), and ignored cooldowns.
  //   2. A fixed index of 2.0 with wages capped at 1.5 makes the gap
  //      unclosable: concession needs the gap within STRIKE_EXPECTATION_GAP_
  //      THRESHOLD, unreachable at 2.0, so a CEO who maxes wages still eats the
  //      full throttle and the sector auto-re-strikes forever. The player path
  //      plants realWageIndex + threshold + 0.05 — a real but closable gap.
  if (strikeScopes.length > 0) {
    const eligibleSectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find(
        {
          $or: strikeScopes.map((sc) => ({
            countryId: sc.countryId,
            sectorType: sc.sectorType,
          })),
          unionization: { $gte: STRIKE_CALL_MIN_UNIONIZATION },
          strikeStartedAtTurn: null,
          $and: [
            {
              $or: [
                { strikeCooldownUntilTurn: null },
                { strikeCooldownUntilTurn: { $exists: false } },
                { strikeCooldownUntilTurn: { $lte: currentTurn } },
              ],
            },
          ],
        },
        { projection: { _id: 1, wageLevel: 1 } }
      )
      .toArray();
    if (eligibleSectors.length > 0) {
      const strikeOps = eligibleSectors.map((s) => {
        const realWage = realWageIndex(s.wageLevel ?? 1, undefined);
        return {
          updateOne: {
            // Re-assert not-already-striking at write time so a strike that
            // started between the read above and here is never clobbered.
            filter: { _id: s._id, strikeStartedAtTurn: null },
            update: {
              $set: {
                strikeStartedAtTurn: currentTurn,
                workerExpectationIndex: realWage + STRIKE_EXPECTATION_GAP_THRESHOLD + 0.05,
                updatedAt: now,
              },
            },
          },
        };
      });
      await db.collection<CorporateSector>("corporateSectors").bulkWrite(strikeOps as never);
    }
  }

  // ── 5. NPP-run corporations answer standing demands ───────────────────────
  // Player-run corps are skipped: a human CEO answers their own unions.
  const demands = demandByKey;
  // Unions that already carried a standing demand but did not revise it this
  // turn still need answering.
  for (const union of led) {
    const key = `${union.countryId}::${union.sectorType}`;
    if (!demands.has(key) && union.demandedWageLevel != null) {
      demands.set(key, union.demandedWageLevel);
    }
  }
  if (demands.size === 0 && strikeScopes.length === 0) return result;

  const nppCorpIds = await db
    .collection<Corporation>("corporations")
    .find({ ceoType: "npp", isDefunct: { $ne: true } }, { projection: { _id: 1 } })
    .toArray();
  if (nppCorpIds.length === 0) return result;

  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { corporationId: { $in: nppCorpIds.map((c) => c._id) } },
      { projection: { _id: 1, countryId: 1, sectorType: 1, wageLevel: 1, profitMargin: 1 } }
    )
    .toArray();

  const sectorOps: Array<{
    updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> };
  }> = [];
  for (const s of sectors) {
    const demand = demands.get(`${s.countryId}::${s.sectorType}`);
    if (demand == null) continue;
    const current = s.wageLevel ?? 1;
    if (current >= demand - 0.005) continue;
    // A loss-making sector cannot fund a rise; holding out is the whole point
    // of having two sides to the bargain.
    if ((s.profitMargin ?? 0) < NPP_CONCESSION_MIN_MARGIN) continue;
    const next = Math.min(demand, current + (demand - current) * NPP_CONCESSION_RATE);
    if (next <= current + 0.0005) continue;
    sectorOps.push({
      updateOne: {
        filter: { _id: s._id },
        update: { $set: { wageLevel: Math.round(next * 1000) / 1000, updatedAt: now } },
      },
    });
  }
  if (sectorOps.length > 0) {
    await db.collection<CorporateSector>("corporateSectors").bulkWrite(sectorOps as never);
    result.concessions = sectorOps.length;
  }

  return result;
}

/**
 * Era Checkpoint Turn — applies each active `EraCheckpoint`'s pull to the
 * targeted states' Layer-1 census buckets (see
 * `src/lib/demographics/eraCheckpoints.ts` for the full design writeup).
 *
 * Every checkpoint target is a (`dim`, `bucket`) pair, so one substrate moves
 * per lean target: `demographicDefaults.layer1PositionOverrides[dim][bucket]
 * .<axis>`, a durable per-census-bucket position delta. This is the ONLY
 * channel the granular vote path reads a checkpoint's pull through. See the
 * module doc on `src/lib/demographics/granularElectorate.ts` for why an
 * archetype-level `groups[id].<axis>` write is invisible to it.
 *
 * `axis: "turnout"` targets (the Voting Rights Act checkpoint's channel:
 * enfranchisement, not lean) move a parallel substrate:
 * `demographicDefaults.layer1TurnoutOverrides[dim][bucket]`, a durable
 * turnout-rate delta consumed by `granularElectorate.ts`'s
 * `buildUsTurnoutRates`/`applyTurnoutRateOverlay` BEFORE cell derivation —
 * routed through `applyDurableBucketTurnoutShift` rather than the lean
 * function, since turnout is a bounded 0-100 percentage, not a signed lean
 * axis (see those functions' doc comments in `durableRealignment.ts`).
 *
 * Counter-pressure still reads legislation authored against ARCHETYPES: an
 * active bill's per-archetype shift is projected onto buckets through
 * `archetypeValuesToBuckets` before netting, so a player's legislation
 * contests a checkpoint with no new authoring convention needed.
 *
 * Ordering requirement: this MUST run strictly after `processAllStateDemographics`
 * (`src/lib/demographicEffects.ts`) within the same turn, never concurrently with
 * it: both write `demographicDefaults` for the same state, and running them in
 * the same `Promise.all` would race a lost update (the same class of bug
 * documented in `stateEffectsPhase.ts`'s S4 comment for
 * crisisTurn/ministerialOrders/policyEffects). `processEraCheckpointsTurn` reads
 * `demographicDefaults` fresh, so as long as it is awaited AFTER the
 * legislation/decay writer commits, there is no race.
 */
import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { StateDemographics } from "@/lib/db/types/demographics";
import type { DocketCase } from "@/lib/db/types/scotus";
import type { LegislationType } from "@/lib/db/types/legislation";
import { getActivePoliciesForState, type LegislationTypeMap } from "@/lib/policyEffects";
import { calculateDemographicShiftsByTarget } from "@/lib/demographicEffects";
import { archetypeValuesToBuckets } from "@/lib/demographics/archetypeBucketMap";
import {
  applyDurableBucketShift,
  applyDurableBucketTurnoutShift,
  readLayer1Overlay,
  readLayer1TurnoutOverlay,
  type DurableShiftAccumulators,
} from "@/lib/demographics/durableRealignment";
import {
  ERA_CHECKPOINTS,
  resolveCheckpointStartTurn,
  isCheckpointActive,
  computeCheckpointRawDelta,
  applyCounterPressure,
  type EraCheckpoint,
  type DocketCaseLookupEntry,
} from "@/lib/demographics/eraCheckpoints";

export interface EraCheckpointTurnResult {
  checkpointsActive: number;
  statesUpdated: number;
}

const NO_RESULT: EraCheckpointTurnResult = { checkpointsActive: 0, statesUpdated: 0 };

/** Resolve which registered checkpoints for `countryId` are active this turn, and at what start turn. */
async function resolveActiveCheckpoints(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<Array<{ checkpoint: EraCheckpoint; startTurn: number }>> {
  const checkpoints = ERA_CHECKPOINTS.filter((c) => c.countryId === countryId);
  if (checkpoints.length === 0) return [];

  const caseKeys = [
    ...new Set(checkpoints.map((c) => c.triggerCaseKey).filter(Boolean)),
  ] as string[];
  const docketByKey = new Map<string, DocketCaseLookupEntry>();
  if (caseKeys.length > 0) {
    const cases = await db
      .collection<DocketCase>("docketCases")
      .find({ countryId, caseKey: { $in: caseKeys } })
      .toArray();
    for (const c of cases) {
      docketByKey.set(c.caseKey, {
        status: c.status,
        outcome: c.outcome,
        decidedAtTurn: c.decidedAtTurn,
      });
    }
  }

  return checkpoints
    .map((checkpoint) => ({
      checkpoint,
      startTurn: resolveCheckpointStartTurn(
        checkpoint,
        checkpoint.triggerCaseKey ? docketByKey.get(checkpoint.triggerCaseKey) : undefined
      ),
    }))
    .filter(({ checkpoint, startTurn }) => isCheckpointActive(checkpoint, startTurn, currentTurn));
}

/**
 * Apply one turn of every active era-checkpoint's pull, per targeted state,
 * netted against any opposing legislative demographic-effect shift currently
 * active in that state for the same bucket+axis. Moves the durable overlays on
 * the seeded `demographicDefaults` snapshot (see the module doc comment on
 * `eraCheckpoints.ts` for why that is the substrate a checkpoint owns).
 */
export async function processEraCheckpointsTurn(
  db: Db,
  currentTurn: number,
  countryId: CountryId = "US"
): Promise<EraCheckpointTurnResult> {
  // Every checkpoint's start/fallback turn is an absolute turn computed
  // against a 1953 starting year, and the checkpoints model 1950s-60s history
  // (Civil Rights, Southern Realignment). In a 2019/1979 world the trigger
  // dockets don't exist, so the fallback turns would fire the 1953 timeline
  // against a modern electorate and permanently mutate demographicDefaults —
  // gate on the world's starting year instead.
  const gameStateDoc = await db
    .collection<{ _id: string; startingYear?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { startingYear: 1 } });
  if ((gameStateDoc?.startingYear ?? 2019) !== 1953) return NO_RESULT;

  const active = await resolveActiveCheckpoints(db, countryId, currentTurn);
  if (active.length === 0) return NO_RESULT;

  const stateIds = new Set<string>();
  for (const { checkpoint } of active) {
    for (const target of checkpoint.targets) {
      for (const stateId of target.stateIds) stateIds.add(stateId);
    }
  }
  if (stateIds.size === 0) return NO_RESULT;

  const [legTypes, demographicsDocs, defaultsDocs] = await Promise.all([
    db.collection<LegislationType>("legislationTypes").find({}).toArray(),
    db
      .collection<StateDemographics>("stateDemographics")
      .find({ _id: { $in: [...stateIds] } })
      .toArray(),
    db
      .collection<StateDemographics>("demographicDefaults")
      .find({ _id: { $in: [...stateIds] } })
      .toArray(),
  ]);
  const legTypeMap: LegislationTypeMap = new Map(legTypes.map((lt) => [lt._id, lt]));
  const demographicsByState = new Map(demographicsDocs.map((d) => [String(d._id), d]));
  const defaultsByState = new Map(defaultsDocs.map((d) => [String(d._id), d]));

  const now = new Date();
  const liveOps: AnyBulkWriteOperation<StateDemographics>[] = [];
  const defaultOps: AnyBulkWriteOperation<StateDemographics>[] = [];
  let statesUpdated = 0;

  for (const stateId of stateIds) {
    const demographics = demographicsByState.get(stateId);
    if (!demographics) continue;

    const policies = await getActivePoliciesForState(db, stateId, countryId);
    const counterShifts = calculateDemographicShiftsByTarget(policies, legTypeMap);

    const acc: DurableShiftAccumulators = { liveUpdates: {}, defaultUpdates: {} };
    const defaults = defaultsByState.get(stateId);

    for (const { checkpoint, startTurn: _startTurn } of active) {
      for (const target of checkpoint.targets) {
        if (!target.stateIds.includes(stateId)) continue;
        const rawDelta = computeCheckpointRawDelta(target, checkpoint);

        if (target.dim && target.bucket) {
          // BUCKET target — direct Layer-1 targeting, no archetype proxy.
          // Granular-path only (there is no archetype to carry it on the
          // legacy live doc). Counter-pressure projects EVERY active
          // legislative archetype shift for this axis onto the SAME bucket
          // via the shared map, so a player's legislation still nets against
          // it even though it's authored against archetypes, not buckets.
          const projectedCounterShifts = archetypeValuesToBuckets(
            counterShifts[target.axis],
            countryId
          );
          const counterShiftPerTurn = projectedCounterShifts[`${target.dim}:${target.bucket}`] ?? 0;
          const netDelta = applyCounterPressure(rawDelta, counterShiftPerTurn);

          const axis = target.axis;
          const dim = target.dim;
          const bucket = target.bucket;
          if (axis === "turnout") {
            applyDurableBucketTurnoutShift(
              dim,
              bucket,
              netDelta,
              (d, b) => readLayer1TurnoutOverlay(defaults, d, b),
              acc
            );
          } else {
            applyDurableBucketShift(
              dim,
              bucket,
              axis,
              netDelta,
              (d, b) => readLayer1Overlay(defaults, d, b, axis),
              acc
            );
          }
        }
      }
    }
    const { liveUpdates, defaultUpdates } = acc;
    const hasLiveUpdates = Object.keys(liveUpdates).length > 0;
    const hasDefaultUpdates = Object.keys(defaultUpdates).length > 0;

    // BUCKET-kind targets (see eraCheckpoints.ts) never populate `liveUpdates`
    // — there is no archetype to carry them on the legacy live doc, only the
    // granular overlay. A state with ONLY bucket targets active this turn
    // (e.g. a national bucket checkpoint with no archetype targets at all —
    // NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT, VOTING_RIGHTS_ACT_ENFRANCHISEMENT_CHECKPOINT,
    // REYNOLDS_REAPPORTIONMENT_CHECKPOINT, GRISWOLD_PRIVACY_CHECKPOINT,
    // MIRANDA_LAW_AND_ORDER_CHECKPOINT) would
    // therefore have `liveUpdates` empty while `defaultUpdates` is populated —
    // gating on `liveUpdates` alone would silently drop that overlay write
    // every single turn. Check both independently.
    if (!hasLiveUpdates && !hasDefaultUpdates) continue;
    statesUpdated++;
    if (hasLiveUpdates) {
      liveOps.push({
        updateOne: {
          filter: { _id: stateId },
          update: { $set: { ...liveUpdates, lastUpdated: now } },
        },
      });
    }
    if (hasDefaultUpdates) {
      defaultOps.push({
        updateOne: {
          filter: { _id: stateId },
          update: { $set: { ...defaultUpdates, lastUpdated: now } },
        },
      });
    }
  }

  if (liveOps.length > 0) {
    await db.collection<StateDemographics>("stateDemographics").bulkWrite(liveOps);
  }
  if (defaultOps.length > 0) {
    await db.collection<StateDemographics>("demographicDefaults").bulkWrite(defaultOps);
  }

  return { checkpointsActive: active.length, statesUpdated };
}

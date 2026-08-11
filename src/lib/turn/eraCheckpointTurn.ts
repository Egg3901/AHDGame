/**
 * Era Checkpoint Turn — applies each active `EraCheckpoint`'s pull to the
 * targeted states' voter-archetype leans (see `src/lib/demographics/eraCheckpoints.ts`
 * for the full design writeup).
 *
 * TWO substrates are moved, every active turn, from the SAME netted per-turn
 * delta:
 *  1. `stateDemographics`/`demographicDefaults` `.groups[groupId].<axis>` —
 *     the archetype-level lean, read directly by the legacy (non-granular)
 *     vote-distribution path, `calculateStateLean`, the position editor, and
 *     national-axes/wiki reads. This is the ORIGINAL mechanism.
 *  2. `demographicDefaults.layer1PositionOverrides[dim][bucket].<axis>` — a
 *     durable per-census-bucket position delta, projected from the same
 *     archetype delta via `archetypeValuesToBuckets` (the exact map already
 *     used to diffuse archetype-keyed turnout/approval effects onto cells).
 *     This is the ONLY channel the granular vote path
 *     reads a checkpoint's pull through — see the module doc on
 *     `src/lib/demographics/granularElectorate.ts` for why (1) alone is
 *     invisible to it. Archetypes with no bucket mapping (non-US voter
 *     groups) contribute nothing here — same documented degrade as every
 *     other archetype→bucket channel.
 *
 * A THIRD substrate moves for `axis: "turnout"` targets specifically (the
 * Voting Rights Act checkpoint's channel — enfranchisement, not lean):
 * `demographicDefaults.layer1TurnoutOverrides[dim][bucket]`, a durable
 * turnout-rate delta consumed by `granularElectorate.ts`'s
 * `buildUsTurnoutRates`/`applyTurnoutRateOverlay` BEFORE cell derivation —
 * routed through `applyDurableGroupTurnoutShift`/`applyDurableBucketTurnoutShift`
 * rather than the lean functions, since turnout is a bounded 0-100
 * percentage, not a signed lean axis (see those functions' doc comments in
 * `durableRealignment.ts`). The archetype-level `groups[groupId].turnout`
 * write still happens too (mirroring substrate 1 above), but on its own it is
 * invisible to both vote engines for a Layer-1 US state — see
 * `Layer1TurnoutOverlay`'s doc comment in `src/lib/db/types/demographics.ts`.
 *
 * Ordering requirement: this MUST run strictly after `processAllStateDemographics`
 * (`src/lib/demographicEffects.ts`) within the same turn, never concurrently with
 * it — both can `$set` the exact same `stateDemographics.groups.<id>.<axis>` field,
 * and running them in the same `Promise.all` would race a lost update (the same
 * class of bug documented in `stateEffectsPhase.ts`'s S4 comment for
 * crisisTurn/ministerialOrders/policyEffects). `processEraCheckpointsTurn` reads
 * `stateDemographics` fresh, so as long as it is awaited AFTER the legislation/decay
 * writer commits, there is no race.
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
  applyDurableGroupShift,
  applyDurableBucketShift,
  applyDurableGroupTurnoutShift,
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
 * active in that state for the same group+axis. Moves BOTH the live
 * `stateDemographics` doc and the seeded `demographicDefaults` snapshot (see
 * the module doc comment on `eraCheckpoints.ts` for why both move together).
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

        if (target.groupId) {
          // ARCHETYPE target — the original mechanism (see EraCheckpointTarget's
          // doc comment on eraCheckpoints.ts). Moves the archetype live/default
          // group AND (via applyDurableGroupShift's bucket projection) the
          // granular overlay.
          const group = demographics.groups[target.groupId];
          if (!group) continue;
          const current = group[target.axis];
          if (typeof current !== "number") continue;

          const counterShiftPerTurn = counterShifts[target.axis]?.[target.groupId] ?? 0;
          const netDelta = applyCounterPressure(rawDelta, counterShiftPerTurn);

          // Narrowed to a local `const` (not `target.axis` itself) so it
          // narrows correctly INSIDE the `readOverlay` closures below too —
          // TS does not narrow a captured property access the same way it
          // narrows a plain `const` binding.
          const axis = target.axis;
          const groupId = target.groupId;
          if (axis === "turnout") {
            // TURNOUT — the Voting Rights Act checkpoint's channel. Routes
            // through its own clamp/overlay (`layer1TurnoutOverrides`), not
            // the lean functions' (`layer1PositionOverrides`) — see
            // `applyDurableGroupTurnoutShift`'s doc comment.
            applyDurableGroupTurnoutShift(
              groupId,
              netDelta,
              {
                live: current,
                default: defaults?.groups[groupId]?.turnout,
                readOverlay: (dim, bucket) => readLayer1TurnoutOverlay(defaults, dim, bucket),
              },
              acc,
              countryId
            );
          } else {
            // Shared durable-relocation primitive (see `durableRealignment.ts`) —
            // the SAME mechanism designated legislation and the SCOTUS
            // demographic-signal consumer use, so all three channels are visible
            // to both vote paths identically.
            applyDurableGroupShift(
              groupId,
              axis,
              netDelta,
              {
                live: current,
                default: defaults?.groups[groupId]?.[axis],
                readOverlay: (dim, bucket) => readLayer1Overlay(defaults, dim, bucket, axis),
              },
              acc,
              countryId
            );
          }
        } else if (target.dim && target.bucket) {
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

/**
 * P3b — deposits deplete (plants tier only).
 *
 * `stateResourceCapacity.resources[r]` is a per-turn FLOW ceiling: the most of
 * resource `r` a state can yield in one turn. Nothing ever consumed it, so a
 * deposit was an infinite fountain running at a fixed rate — extraction had a
 * speed limit but no end, and prospecting was a pure, permanent upgrade with no
 * pressure ever pushing the other way.
 *
 * Depletion is tracked with a MONOTONIC COUNTER rather than a stored "remaining"
 * balance:
 *
 *     reserves(r)  = resources[r] × DEPOSIT_RESERVE_TURNS      (derived)
 *     remaining(r) = max(0, reserves(r) − extractedUnits[r])
 *     ceiling(r)   = min(resources[r], remaining(r))
 *
 * Two properties fall out of deriving reserves from the flow ceiling instead of
 * storing them:
 *
 *  - NO MIGRATION. Every existing capacity doc already has full reserves; a doc
 *    with no `extractedUnits` reads as untouched, which is exactly the pre-P3b
 *    world.
 *  - PROSPECTING STILL RAISES IT, for free. A survey that lifts `resources[r]`
 *    lifts derived reserves by the same multiple, so a discovery extends the
 *    life of the field as well as its rate — and no second write is needed in
 *    the prospecting path.
 *
 * The flow ceiling only starts to bind at the very end of a field's life
 * (`remaining < resources[r]`), so a depleting deposit tapers off over its last
 * turns rather than switching off.
 */

import type { ExtractableResource } from "@/lib/constants/commodities";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * Turns of extraction AT THE FULL PER-TURN CEILING a deposit holds before it is
 * exhausted — i.e. reserves are `resources[r] × DEPOSIT_RESERVE_TURNS`.
 *
 * 40 game years. Long enough that depletion is a strategic horizon a player
 * plans around rather than a hazard that ambushes them mid-game, short enough
 * that a long-lived world genuinely has to move on or prospect. A deposit run
 * below its ceiling lasts proportionally longer, since only what is actually
 * extracted counts against it. Tunable calibration knob.
 */
export const DEPOSIT_RESERVE_TURNS = 40 * TURNS_PER_YEAR;

/** The capacity-doc fields depletion reads. Structural so callers can project. */
export interface DepletableCapacityDoc {
  resources: Partial<Record<ExtractableResource, number>>;
  /** Cumulative units extracted since the world began. Absent ⇒ untouched. */
  extractedUnits?: Partial<Record<ExtractableResource, number>> | null;
}

/** Derived total recoverable reserves for one resource, in units. */
export function depositReservesUnits(doc: DepletableCapacityDoc, r: ExtractableResource): number {
  const perTurn = doc.resources?.[r] ?? 0;
  return perTurn > 0 ? perTurn * DEPOSIT_RESERVE_TURNS : 0;
}

/** Units of `r` left in the ground in this state. */
export function depositRemainingUnits(doc: DepletableCapacityDoc, r: ExtractableResource): number {
  const extracted = doc.extractedUnits?.[r] ?? 0;
  return Math.max(0, depositReservesUnits(doc, r) - Math.max(0, extracted));
}

/**
 * The per-turn ceiling to ration against, after depletion:
 * `min(flow ceiling, units left in the ground)`.
 */
export function depletedCapacityPerTurn(
  doc: DepletableCapacityDoc,
  r: ExtractableResource
): number {
  const perTurn = doc.resources?.[r] ?? 0;
  if (!(perTurn > 0)) return 0;
  return Math.min(perTurn, depositRemainingUnits(doc, r));
}

/**
 * A depletion-adjusted VIEW of a capacity doc, safe to hand to
 * `computeExtractionCapacityMultipliers` (which reads `resources` only). Never
 * mutates the input. Plants-gated at the call sites — below plants the raw docs
 * are used, so rationing is byte-identical.
 */
export function depletedCapacityDoc<T extends StateResourceCapacity>(doc: T): T {
  const resources: Partial<Record<ExtractableResource, number>> = {};
  for (const key of Object.keys(doc.resources ?? {}) as ExtractableResource[]) {
    resources[key] = depletedCapacityPerTurn(doc, key);
  }
  return { ...doc, resources };
}

/**
 * Build the `$inc` payload that books this turn's extraction against a state's
 * deposits. Keyed `extractedUnits.<resource>`; entries with no production are
 * omitted so an idle state writes nothing.
 */
export function buildDepletionInc(
  producedByResource: Partial<Record<ExtractableResource, number>>
): Record<string, number> {
  const inc: Record<string, number> = {};
  for (const key of Object.keys(producedByResource) as ExtractableResource[]) {
    const units = producedByResource[key] ?? 0;
    if (Number.isFinite(units) && units > 0) inc[`extractedUnits.${key}`] = units;
  }
  return inc;
}

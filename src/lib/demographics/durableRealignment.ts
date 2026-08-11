/**
 * Durable base-value relocation — the SHARED mechanism behind every "this
 * permanently changes who the electorate is" channel: era checkpoints
 * (`eraCheckpoints.ts` / `src/lib/turn/eraCheckpointTurn.ts`) and designated
 * ("permanent") legislation (`src/lib/demographicEffects.ts`).
 *
 * SCOTUS rulings that durably move the electorate (Brown v. Board / the
 * Southern realignment, the national Civil Rights Act/Voting Rights Act
 * consolidation, Engel v. Vitale, Reynolds v. Sims, Griswold v. Connecticut,
 * Miranda v. Arizona — see the checkpoint registry at the bottom of
 * `eraCheckpoints.ts`) are wired through this SAME era-checkpoint mechanism,
 * gated by `EraCheckpoint.triggerCaseKey`, rather than through a separate
 * SCOTUS-specific turn processor: `triggerCaseKey` already generically reads
 * any docket case's decided outcome to pace a checkpoint's start, so no new
 * "demographic-signal consumer" processor was needed once the registry
 * gained bucket-kind targets. `docketCase.demographicSignal` itself remains a
 * read-only `countryHistoryEvents` recording for cases with NO authored
 * checkpoint (Baker v. Carr, Wesberry v. Sanders) — see the file header of
 * `src/lib/scotus/presetData/1953.ts` for which cases got a checkpoint and
 * why Reynolds v. Sims alone stood in for the reapportionment trio.
 *

 * Every one of them ultimately needs to answer the same question — "durably
 * move this (state, archetype, axis) base value by N, so BOTH vote paths see
 * it" — and every one of them must do it the SAME way, or the granular path
 * silently misses it again (this is exactly how the mechanism failed the
 * first time it was built: see the module doc on `eraCheckpoints.ts`).
 *
 * A durable relocation moves TWO substrates from the same net per-turn delta:
 *
 *  1. `stateDemographics` / `demographicDefaults` `.groups[groupId].<axis>` —
 *     the archetype-level lean, read by the legacy (non-granular) vote path,
 *     `calculateStateLean`, the position editor, national-axes/wiki reads.
 *     BOTH docs move together (not just the live one) so the existing
 *     legislation decay-to-baseline channel (`demographicEffects.ts`'s
 *     `applyBaselineDecay`) has nothing to pull back toward — this is what
 *     makes the shift durable rather than a capped, decaying overlay.
 *  2. `demographicDefaults.layer1PositionOverrides[dim][bucket].<axis>` — a
 *     durable per-census-bucket delta, projected via the shared
 *     `archetypeValuesToBuckets` map (the SAME map that diffuses
 *     archetype-keyed turnout/approval effects onto cells elsewhere), applied
 *     by `granularElectorate.ts`'s `applyPositionOverlay` directly to the
 *     Layer-1 position table BEFORE cell derivation — the ONLY channel the
 *     the granular vote path reads a durable shift through
 *     (see the `Layer1PositionOverlay` type doc in
 *     `src/lib/db/types/demographics.ts`).
 *
 * TURNOUT is a separate, parallel channel (the `applyDurableGroupTurnoutShift`
 * / `applyDurableBucketTurnoutShift` functions below), not a widened axis on
 * the above: `groups[groupId].turnout` is a single bounded 0-100 percentage,
 * and its granular counterpart is `demographicDefaults.layer1TurnoutOverrides`
 * (a bucket-rate delta consumed by `granularElectorate.ts`'s
 * `buildUsTurnoutRates`/`applyTurnoutRateOverlay`, BEFORE cell derivation,
 * exactly like the position overlay above) — see `Layer1TurnoutOverlay`'s
 * type doc in `src/lib/db/types/demographics.ts` for why turnout could not
 * reach the granular path through the lean channel's shape, or through the
 * archetype-level `groups[id].turnout` write alone (the legacy engine's
 * `resolveTurnout` ignores that field for any state with a Layer-1 census).
 * This is the mechanism the Voting Rights Act of 1965 needs: its real effect
 * was enfranchisement (Black registration in Mississippi ~6.7% -> 59.8%,
 * 1965-1967 — U.S. Commission on Civil Rights, 1968), not a lean shift among
 * voters who could already cast a ballot.
 *
 * Callers own reading the current doc values and persisting the returned
 * dotted-path `$set` updates (typically two bulkWrite calls: one against
 * `stateDemographics`, one against `demographicDefaults`) — this module is
 * pure and does no I/O, so it is trivially shared across three different
 * turn-processing entry points without any of them depending on the others.
 */
import { archetypeValuesToBuckets } from "./archetypeBucketMap";
import type { StateDemographics } from "@/lib/db/types/demographics";

/** Absolute bounds of the shared lean axis. */
const LEAN_ABS_MIN = -5;
const LEAN_ABS_MAX = 5;

/** Apply one turn's net delta to a lean value, clamped to the shared axis. */
export function applyDurableStep(current: number, delta: number): number {
  if (delta === 0) return current;
  return Math.max(LEAN_ABS_MIN, Math.min(LEAN_ABS_MAX, current + delta));
}

export type LeanAxis = "economicLean" | "socialLean";

/**
 * Absolute bounds of the ARCHETYPE-level turnout field
 * (`StateDemographicGroup.turnout` / `groups.<id>.turnout`) — a real
 * percentage reading, 0-100. Deliberately NOT reused for the bucket-overlay
 * accumulator below: that field is an additive DELTA layered on top of an
 * existing baseline rate, not an absolute reading, and clamping a delta to
 * [0, 100] would silently floor every negative (suppression) accumulation at
 * exactly 0 — see `TURNOUT_OVERLAY_DELTA_MIN/MAX`.
 */
const TURNOUT_ABS_MIN = 0;
const TURNOUT_ABS_MAX = 100;

/**
 * Absolute bounds of the durable turnout-rate OVERLAY delta accumulator
 * (`layer1TurnoutOverrides[dim][bucket]`, see `Layer1TurnoutOverlay`'s doc
 * comment). This is a SIGNED percentage-point delta added on top of an
 * existing `DEMOGRAPHIC_TURNOUT_RATES` bucket baseline
 * (`buildUsTurnoutRates`/`applyTurnoutRateOverlay` in
 * `granularElectorate.ts`), not an absolute turnout reading, so the bound
 * must stay symmetric: a sustained suppression campaign has to be able to
 * pull it negative just as far as an enfranchisement act can push it
 * positive — "gravity, not rails" cuts both ways. ±80 comfortably covers the
 * largest real-world swing this project models (Mississippi Black voter
 * registration ~6.7% (1965) -> 59.8% (1967), a ~53pp move per the U.S.
 * Commission on Civil Rights' 1968 report) while still bounding runaway
 * accumulation.
 */
const TURNOUT_OVERLAY_DELTA_MIN = -80;
const TURNOUT_OVERLAY_DELTA_MAX = 80;

/**
 * Apply one turn's net delta to an ABSOLUTE archetype turnout value
 * (`groups.<id>.turnout`), clamped to the real 0-100 percentage scale. This
 * is a genuinely different clamp from `applyDurableStep`'s ±5 lean axis, not
 * a widened copy of it — see the module doc and `TURNOUT_ABS_MIN/MAX`.
 */
export function applyDurableTurnoutStep(current: number, delta: number): number {
  if (delta === 0) return current;
  return Math.max(TURNOUT_ABS_MIN, Math.min(TURNOUT_ABS_MAX, current + delta));
}

/**
 * Apply one turn's net delta to the turnout-rate OVERLAY accumulator — a
 * signed bucket-rate delta, NOT an absolute turnout reading (see
 * `TURNOUT_OVERLAY_DELTA_MIN/MAX`'s doc comment for why this needs its own,
 * symmetric bound rather than [0, 100]).
 */
function applyDurableTurnoutOverlayStep(current: number, delta: number): number {
  if (delta === 0) return current;
  return Math.max(TURNOUT_OVERLAY_DELTA_MIN, Math.min(TURNOUT_OVERLAY_DELTA_MAX, current + delta));
}

export interface DurableShiftAccumulators {
  /** dotted-path `$set` updates for the LIVE `stateDemographics` doc. */
  liveUpdates: Record<string, number>;
  /**
   * dotted-path `$set` updates for the `demographicDefaults` doc — both the
   * archetype baseline field (`groups.<id>.<axis>`) and the
   * `layer1PositionOverrides.<dim>.<bucket>.<axis>` bucket overlay.
   */
  defaultUpdates: Record<string, number>;
}

/** Current cumulative `layer1PositionOverrides[dim][bucket][axis]` value, or 0 if unset. */
export function readLayer1Overlay(
  defaults: StateDemographics | null | undefined,
  dim: string,
  bucket: string,
  axis: LeanAxis
): number {
  return defaults?.layer1PositionOverrides?.[dim]?.[bucket]?.[axis] ?? 0;
}

/**
 * Durably relocate one (groupId, axis) base value by `netDelta`, layering the
 * write on top of whatever this same turn's OTHER targets already staged in
 * `acc` (multiple targets can land on the same bucket within one turn — e.g.
 * two archetypes both partially mapping onto "education:no_college" — and
 * their contributions must sum, not clobber each other).
 *
 * No-op when `netDelta` is 0 (nothing to relocate this turn — e.g. a
 * checkpoint fully counter-pressured to a standstill, or a durable law with
 * no currently-active policy).
 */
export function applyDurableGroupShift(
  groupId: string,
  axis: LeanAxis,
  netDelta: number,
  current: {
    live: number;
    /** Current `demographicDefaults.groups[groupId][axis]`, when present. */
    default: number | undefined;
    /** Current cumulative overlay value reader for this axis. */
    readOverlay: (dim: string, bucket: string) => number;
  },
  acc: DurableShiftAccumulators,
  /** Selects the bucket vocabulary — see `archetypeValuesToBuckets`. */
  countryId?: string
): void {
  if (netDelta === 0) return;

  const liveKey = `groups.${groupId}.${axis}`;
  const liveBase = acc.liveUpdates[liveKey] ?? current.live;
  acc.liveUpdates[liveKey] = applyDurableStep(liveBase, netDelta);

  if (typeof current.default === "number") {
    const defaultBase = acc.defaultUpdates[liveKey] ?? current.default;
    acc.defaultUpdates[liveKey] = applyDurableStep(defaultBase, netDelta);
  }

  // Durable Layer-1 bucket-position overlay — the ONLY channel that reaches
  // the granular vote path (see module doc above). `countryId` selects the
  // bucket vocabulary, so a non-US group projects onto its own country's
  // buckets rather than onto nothing.
  const bucketDeltas = archetypeValuesToBuckets({ [groupId]: netDelta }, countryId);
  for (const [bucketKey, bucketDelta] of Object.entries(bucketDeltas)) {
    if (bucketDelta === 0) continue;
    const sep = bucketKey.indexOf(":");
    if (sep <= 0) continue;
    const dim = bucketKey.slice(0, sep);
    const bucket = bucketKey.slice(sep + 1);
    applyDurableBucketShift(dim, bucket, axis, bucketDelta, current.readOverlay, acc);
  }
}

/**
 * Durably relocate ONE Layer-1 census bucket's position directly — for a
 * checkpoint/SCOTUS-signal target expressed as `{ dim, bucket }` rather than
 * an archetype `groupId` (see `EraCheckpointTarget`'s doc comment in
 * `eraCheckpoints.ts` for when to use which). There is no archetype to carry
 * this on the legacy live doc, so ONLY the granular-path overlay moves — a
 * bucket target is invisible to the legacy (non-granular) vote path and every
 * other direct `stateDemographics.groups` reader by construction. Exact (no
 * archetype-proxy approximation), unlike `applyDurableGroupShift`.
 */
export function applyDurableBucketShift(
  dim: string,
  bucket: string,
  axis: LeanAxis,
  netDelta: number,
  readOverlay: (dim: string, bucket: string) => number,
  acc: DurableShiftAccumulators
): void {
  if (netDelta === 0) return;
  const overlayKey = `layer1PositionOverrides.${dim}.${bucket}.${axis}`;
  const overlayBase = acc.defaultUpdates[overlayKey] ?? readOverlay(dim, bucket);
  acc.defaultUpdates[overlayKey] = applyDurableStep(overlayBase, netDelta);
}

// ─── Turnout channel ────────────────────────────────────────────────────────
//
// A durable TURNOUT relocation is the enfranchisement-shaped counterpart of
// the lean relocation above (the Voting Rights Act's worked example: it did
// not make already-enfranchised Southern Black voters more Democratic, it let
// voters who previously could not vote at all cast a ballot — see
// `src/lib/db/types/legislation.ts`'s `DemographicEffect.permanent` doc
// comment). It intentionally does NOT reuse `LeanAxis`/`applyDurableStep`:
// turnout is a single bounded 0-100 percentage, not a signed two-axis value
// on the -5..+5 ruler, so it needs its own clamp semantics (see
// `TURNOUT_ABS_MIN/MAX` and `TURNOUT_OVERLAY_DELTA_MIN/MAX` above) — widening
// `LeanAxis` to include `"turnout"` would have silently reused the wrong
// bounds for both the archetype field and the bucket-overlay delta.

/** Current cumulative `layer1TurnoutOverrides[dim][bucket]` value, or 0 if unset. */
export function readLayer1TurnoutOverlay(
  defaults: StateDemographics | null | undefined,
  dim: string,
  bucket: string
): number {
  return defaults?.layer1TurnoutOverrides?.[dim]?.[bucket] ?? 0;
}

/**
 * Durably relocate one archetype group's TURNOUT by `netDelta` percentage
 * points — the turnout counterpart of `applyDurableGroupShift`. Same
 * layering/stacking contract (multiple targets landing on the same group or
 * bucket within one turn sum rather than clobber), same no-op-on-zero
 * short-circuit, same archetype→bucket projection for the granular path via
 * `archetypeValuesToBuckets` — the ONLY difference is which clamp each
 * substrate uses (see the module-level bounds above).
 */
export function applyDurableGroupTurnoutShift(
  groupId: string,
  netDelta: number,
  current: {
    live: number;
    /** Current `demographicDefaults.groups[groupId].turnout`, when present. */
    default: number | undefined;
    /** Current cumulative turnout-overlay value reader. */
    readOverlay: (dim: string, bucket: string) => number;
  },
  acc: DurableShiftAccumulators,
  /** Selects the bucket vocabulary — see `archetypeValuesToBuckets`. */
  countryId?: string
): void {
  if (netDelta === 0) return;

  const liveKey = `groups.${groupId}.turnout`;
  const liveBase = acc.liveUpdates[liveKey] ?? current.live;
  acc.liveUpdates[liveKey] = applyDurableTurnoutStep(liveBase, netDelta);

  if (typeof current.default === "number") {
    const defaultBase = acc.defaultUpdates[liveKey] ?? current.default;
    acc.defaultUpdates[liveKey] = applyDurableTurnoutStep(defaultBase, netDelta);
  }

  // Durable Layer-1 bucket-turnout overlay — the ONLY channel that reaches
  // the granular vote path for turnout (see `Layer1TurnoutOverlay`'s doc
  // comment). `countryId` selects the bucket vocabulary, so a non-US group
  // projects onto its own country's buckets rather than onto nothing.
  const bucketDeltas = archetypeValuesToBuckets({ [groupId]: netDelta }, countryId);
  for (const [bucketKey, bucketDelta] of Object.entries(bucketDeltas)) {
    if (bucketDelta === 0) continue;
    const sep = bucketKey.indexOf(":");
    if (sep <= 0) continue;
    const dim = bucketKey.slice(0, sep);
    const bucket = bucketKey.slice(sep + 1);
    applyDurableBucketTurnoutShift(dim, bucket, bucketDelta, current.readOverlay, acc);
  }
}

/**
 * Durably relocate ONE Layer-1 census bucket's TURNOUT rate directly — the
 * turnout counterpart of `applyDurableBucketShift`, for a checkpoint target
 * expressed as `{ dim, bucket }` (e.g. the Voting Rights Act checkpoint's
 * exact `race:black` × Southern-states target — no archetype-proxy
 * approximation). There is no archetype to carry this on the legacy live
 * doc, so ONLY the granular-path overlay moves.
 */
export function applyDurableBucketTurnoutShift(
  dim: string,
  bucket: string,
  netDelta: number,
  readOverlay: (dim: string, bucket: string) => number,
  acc: DurableShiftAccumulators
): void {
  if (netDelta === 0) return;
  const overlayKey = `layer1TurnoutOverrides.${dim}.${bucket}`;
  const overlayBase = acc.defaultUpdates[overlayKey] ?? readOverlay(dim, bucket);
  acc.defaultUpdates[overlayKey] = applyDurableTurnoutOverlayStep(overlayBase, netDelta);
}

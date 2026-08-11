/**
 * Phase-6 system-conversion driver.
 *
 * `triggerSystemConversion` flips a one-party state into another
 * government type (parliamentary or presidential) and runs the
 * post-conversion bootstrap. Two callers:
 *   - `tickConventionPhase` (voluntary path) — invoked at ratification
 *     when the election turn arrives.
 *   - `checkForcedConversion` (forced path) — invoked from the per-turn
 *     escalation driver when either `conversionPendingAtTurn` was set
 *     by Stage-4 "acceptPeacefully" OR the regime has been in collapse
 *     long enough without convening.
 *
 * The conversion is one-way: hasLeaderConfidenceModel flips to false,
 * which is what gates the per-turn intra-party / popular drivers — so
 * scalar drift naturally stops the moment we land here. History is
 * preserved (no row deletes); the country-history feed gets a
 * regime_escalation entry tagged with subtype "conversion".
 */
import type { Db } from "mongodb";
import { COUNTRY_CONFIGS, type CountryId, type GovernmentType } from "@/lib/constants/countries";
import { updateCountryState } from "@/lib/countryState";
import { getRegimeEscalationCollection } from "@/lib/db/collections/regimeEscalation";
import { recordCountryEvent } from "@/lib/turn/history/recordCountryEvent";
import { clearAllRegimeStatusForCountry } from "./regimeStatusReset";
import { bootstrapNewSystem } from "./conversionBootstrap";

/** Forced-path defaults — design § Stage 4 forced conversion. */
const FORCED_LEGACY_RESERVATION = 5;
const FORCED_LEGACY_RESERVATION_HALVED = 3; // 5 / 2 rounded
const FORCED_VOTE_SHARE_PENALTY = -0.2;
/** Snap-election delay (turns) after a forced conversion. */
const FORCED_ELECTION_DELAY_TURNS = 12;

export interface ConversionInputs {
  targetSystem: GovernmentType;
  legacyReservation: number;
  /** "voluntary" via convention, "forced" via Stage 4. */
  path: "voluntary" | "forced";
  /** Forced-path penalty: -20% effective vote share modifier on first post-conversion election. */
  forcedVoteSharePenalty?: number;
  /** Turn the snap election should kick off (defaults to currentTurn). */
  electionAtTurn?: number;
}

/**
 * Run the full conversion: flip governmentType + clear OPS fields,
 * wipe regimeStatus across all country parties, record the history
 * event, and write the post-conversion election marker.
 *
 * Idempotent against double-fire on the same turn — repeating the
 * call sets the same fields with the same values.
 */
export async function triggerSystemConversion(
  db: Db,
  countryId: CountryId,
  currentTurn: number,
  inputs: ConversionInputs
): Promise<void> {
  // 1. Flip governmentType and clear the OPS-only knobs.
  await updateCountryState(db, countryId, {
    governmentType: inputs.targetSystem,
    opsVoteMultipliers: null,
    hasLeaderConfidenceModel: false,
  });

  // 2. Clear regimeStatus on every party in the country.
  await clearAllRegimeStatusForCountry(db, countryId);

  // 3. Append the conversion to the country history feed.
  await recordCountryEvent(db, {
    countryId,
    turn: currentTurn,
    eventType: "regime_escalation",
    title:
      inputs.path === "voluntary"
        ? `${countryId} adopts ${inputs.targetSystem} via constitutional convention`
        : `${countryId} regime collapses into ${inputs.targetSystem}`,
    details: {
      subtype: "conversion",
      path: inputs.path,
      targetSystem: inputs.targetSystem,
      legacyReservation: inputs.legacyReservation,
      forcedVoteSharePenalty: inputs.forcedVoteSharePenalty ?? null,
    },
  }).catch((err) => console.error(`${countryId} conversion history write failed:`, err));

  // 4. Bootstrap the new system — snap-election marker for the engine to consume.
  await bootstrapNewSystem(db, countryId, {
    targetSystem: inputs.targetSystem,
    legacyReservation: inputs.legacyReservation,
    path: inputs.path,
    forcedVoteSharePenalty: inputs.forcedVoteSharePenalty,
    electionAtTurn: inputs.electionAtTurn ?? currentTurn,
  });
}

/**
 * Per-turn check for forced conversion. Fires when either:
 *   - Stage-4 `acceptPeacefully` decision set `conversionPendingAtTurn`
 *     and the turn has arrived; OR
 *   - The country has been in `collapse` stage with no convention in
 *     progress and the `stage4Delay` window (if any) has elapsed.
 *
 * Honours `stage4Delay.halveLegacyBonusIfStillBelow15` by halving the
 * legacy reservation (5 → 3) on the forced path.
 *
 * Idempotent: clears `conversionPendingAtTurn` after firing so a
 * repeat tick doesn't double-convert.
 */
export async function checkForcedConversion(
  db: Db,
  countryId: CountryId,
  currentTurn: number
): Promise<void> {
  const cfg = COUNTRY_CONFIGS[countryId];
  const targetSystem = cfg?.collapseTargetSystem;
  if (!targetSystem) return;

  const coll = getRegimeEscalationCollection(db);
  const state = await coll.findOne({ _id: countryId });
  if (!state) return;

  // A) Voluntary "acceptPeacefully" path.
  if (state.conversionPendingAtTurn !== undefined && state.conversionPendingAtTurn <= currentTurn) {
    await triggerSystemConversion(db, countryId, currentTurn, {
      targetSystem,
      legacyReservation: FORCED_LEGACY_RESERVATION,
      path: "forced",
      forcedVoteSharePenalty: FORCED_VOTE_SHARE_PENALTY,
      electionAtTurn: currentTurn + FORCED_ELECTION_DELAY_TURNS,
    });
    await coll.findOneAndUpdate(
      { _id: countryId },
      { $unset: { conversionPendingAtTurn: "" }, $set: { updatedAt: new Date() } }
    );
    return;
  }

  // B) Stage-4 dwell expiry with no convention in progress.
  if (state.currentStage === "collapse" && !state.convention) {
    if (state.stage4Delay && currentTurn < state.stage4Delay.untilTurn) return;

    const legacyReservation = state.stage4Delay?.halveLegacyBonusIfStillBelow15
      ? FORCED_LEGACY_RESERVATION_HALVED
      : FORCED_LEGACY_RESERVATION;

    await triggerSystemConversion(db, countryId, currentTurn, {
      targetSystem,
      legacyReservation,
      path: "forced",
      forcedVoteSharePenalty: FORCED_VOTE_SHARE_PENALTY,
      electionAtTurn: currentTurn + FORCED_ELECTION_DELAY_TURNS,
    });
    // Clear stage4Delay so re-entry doesn't re-fire.
    if (state.stage4Delay) {
      await coll.findOneAndUpdate(
        { _id: countryId },
        { $unset: { stage4Delay: "" }, $set: { updatedAt: new Date() } }
      );
    }
  }
}

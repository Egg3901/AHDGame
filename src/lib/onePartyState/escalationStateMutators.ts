/**
 * Targeted mutators for the per-country `regimeEscalation` document.
 *
 * Decision-event handlers (Phase 4) use these to write the transient
 * flags that the per-turn driver + Phase 5 reform path read. Keeping
 * the mutators in one place means the field-name strings live next to
 * each other — easier to keep in sync with the EscalationState type.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getRegimeEscalationCollection } from "@/lib/db/collections/regimeEscalation";

/**
 * Set the popular-legitimacy decay-rate modifier. Multiplier > 1
 * accelerates decay (stage1 ignore, stage2 ignore); multiplier < 1
 * dampens it (stage1 crackdown); multiplier = 0 freezes decay
 * (stage2 martial law).
 */
export async function setPopularDecayModifier(
  db: Db,
  countryId: CountryId,
  modifier: { multiplier: number; untilTurn: number }
): Promise<void> {
  await getRegimeEscalationCollection(db).findOneAndUpdate(
    { _id: countryId },
    { $set: { popularDecayModifier: modifier, updatedAt: new Date() } }
  );
}

/**
 * Boost the rate at which the Stage 2 dwell counter decays during
 * recovery. Set by Stage 2's "open dialogue" decision — gives the
 * regime a real shot at climbing back out of crisis.
 */
export async function setStage2DwellDecayBoost(
  db: Db,
  countryId: CountryId,
  boost: { multiplier: number; untilTurn: number }
): Promise<void> {
  await getRegimeEscalationCollection(db).findOneAndUpdate(
    { _id: countryId },
    { $set: { stage2DwellDecayBoost: boost, updatedAt: new Date() } }
  );
}

/**
 * Block Stage 3 escalation until the supplied turn. Set by Stage 2's
 * martial-law decision — the regime buys time at popular-legitimacy
 * cost.
 */
export async function setStage3Block(
  db: Db,
  countryId: CountryId,
  block: { untilTurn: number }
): Promise<void> {
  await getRegimeEscalationCollection(db).findOneAndUpdate(
    { _id: countryId },
    { $set: { stage3Block: block, updatedAt: new Date() } }
  );
}

/**
 * Bump the Stage 1 dwell counter by a fixed amount. Set by Stage 1's
 * "ignore" decision — accumulating dwell debt accelerates the path to
 * Stage 2.
 */
export async function bumpStage1Dwell(db: Db, countryId: CountryId, delta: number): Promise<void> {
  await getRegimeEscalationCollection(db).findOneAndUpdate(
    { _id: countryId },
    { $inc: { "dwellCounters.stage1": delta }, $set: { updatedAt: new Date() } }
  );
}

/**
 * Reset the Stage 3 dwell counter to zero. Set by Stage 3's
 * "negotiate" decision when the defected faction is brought back into
 * the ruling party.
 */
export async function resetStage3Dwell(db: Db, countryId: CountryId): Promise<void> {
  await getRegimeEscalationCollection(db).findOneAndUpdate(
    { _id: countryId },
    { $set: { "dwellCounters.stage3": 0, updatedAt: new Date() } }
  );
}

/**
 * Schedule a Stage 4 forced-conversion to fire on the supplied turn.
 * Set by Stage 4's "accept conversion peacefully" decision; consumed
 * by Phase 6's `systemConversion.ts` per-turn driver.
 */
export async function setConversionPendingAtTurn(
  db: Db,
  countryId: CountryId,
  turn: number
): Promise<void> {
  await getRegimeEscalationCollection(db).findOneAndUpdate(
    { _id: countryId },
    { $set: { conversionPendingAtTurn: turn, updatedAt: new Date() } }
  );
}

/**
 * Mark a Stage 4 "resist" delay. Phase 6 consumes this to delay
 * forced conversion + (optionally) halve the legacy seat reservation
 * if the regime is still collapsing at the end of the delay window.
 */
export async function setStage4Delay(
  db: Db,
  countryId: CountryId,
  delay: { untilTurn: number; halveLegacyBonusIfStillBelow15: boolean }
): Promise<void> {
  await getRegimeEscalationCollection(db).findOneAndUpdate(
    { _id: countryId },
    { $set: { stage4Delay: delay, updatedAt: new Date() } }
  );
}

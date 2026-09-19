/**
 * Bretton Woods exit — gold-convertibility suspension and the float that follows.
 *
 * A 1953 world runs ~48 turns per in-game year, so a 1000-turn run reaches ~1973 —
 * past the August 1971 Nixon Shock. Without this the dollar stays convertible and
 * every currency sits inside a Bretton-Woods band forever, which makes the back
 * half of a long run monetarily ahistorical.
 *
 * Design notes that matter:
 *
 * - `baseRate` is NEVER mutated, and neither is the era rate table. Re-anchoring
 *   is what caused the NG 100x incident: the guardrail band is defined relative
 *   to `baseRate`, so moving it revalues every FX-denominated asset in a single
 *   turn. The float is expressed by WIDENING the band and speeding drift instead.
 * - Three stages driven by persisted state rather than by more flags:
 *   `pegged → suspended → floating`, mirroring Aug 1971 → Smithsonian → Mar 1973.
 * - Command economies are non-convertible by design and must never be dragged
 *   into the float; `participatesInFloat` is the single gate for that.
 *
 * Everything here is pure so it can be unit-tested without a database. The
 * turn-path wiring reads these and persists the results.
 */
import type { CountryId } from "@/lib/constants/countries";

/** Regime a currency operates under. Absent ⇒ `"pegged"` (legacy worlds). */
export type MonetaryRegime = "pegged" | "suspended" | "floating";

/**
 * Earliest in-game year the peg may be suspended. Guards against a 1955 exit if
 * the pressure model spikes early — the decision should become available around
 * its historical window, not whenever the arithmetic first permits it.
 */
export const BW_EARLIEST_EXIT_YEAR = 1968;

/**
 * Gold cover below which convertibility becomes untenable and the decision arms.
 * Historically ~$10B of US gold against ~$50B of foreign dollar claims by 1971.
 */
export const BW_COVER_SUSPENSION_THRESHOLD = 0.25;

/** Turns in `suspended` before the band opens fully and the regime floats. */
export const BW_SUSPENSION_TURNS = 90;

/** Band multipliers at each end of the transition (cf. RATE_*_MULTIPLIER). */
export const BW_PEGGED_BAND = 0.5;
export const BW_FLOATING_BAND = 0.8;

/** Drift-speed multiplier once the peg is gone — fundamentals bite faster. */
export const BW_FLOATING_DRIFT_MULTIPLIER = 1.5;

/**
 * Money-growth → CPI coefficient after the exit. The pegged-era value (0.08)
 * reflects a world where money growth was disciplined by convertibility; the
 * post-1971 decade is exactly when it stopped being. Note the clamp on that term
 * is not the binding constraint — the coefficient is.
 */
export const BW_POST_EXIT_MONEY_COEFF = 0.15;

/**
 * One turn of drain on US gold cover, given foreign dollar claims relative to
 * cover and the US inflation gap. Both are real 1960s mechanics: claims piling up
 * abroad, and domestic inflation making the $35/oz parity progressively less
 * credible.
 *
 * Returns the new cover clamped to [0, 1]. Non-finite input resets to full cover
 * rather than propagating NaN into a persisted field.
 */
export function stepGoldCover(args: {
  cover: number;
  foreignClaims: number;
  goldValue: number;
  inflationGap: number;
}): number {
  const cover = Number.isFinite(args.cover) ? args.cover : 1;
  const goldValue = Number.isFinite(args.goldValue) && args.goldValue > 0 ? args.goldValue : 1;
  const claims = Number.isFinite(args.foreignClaims) ? Math.max(0, args.foreignClaims) : 0;
  const gap = Number.isFinite(args.inflationGap) ? args.inflationGap : 0;
  // Only claims IN EXCESS of cover drain it — a gold surplus is stable.
  const claimPressure = Math.max(0, claims / goldValue - 1) * 0.004;
  const inflationPressure = Math.max(0, gap) * 0.002;
  return Math.max(0, Math.min(1, cover - claimPressure - inflationPressure));
}

/** True when the peg may be suspended: era-eligible AND cover exhausted. */
export function shouldSuspendConvertibility(args: {
  currentYear: number | null | undefined;
  goldCover: number;
  regime: MonetaryRegime;
}): boolean {
  if (args.regime !== "pegged") return false;
  if (args.currentYear == null || args.currentYear < BW_EARLIEST_EXIT_YEAR) return false;
  return args.goldCover < BW_COVER_SUSPENSION_THRESHOLD;
}

/**
 * Band multiplier for a currency, widening linearly across the suspension so the
 * float arrives gradually instead of as a one-turn revaluation.
 */
export function bandMultiplierFor(args: {
  regime: MonetaryRegime;
  turnsSinceRegimeChange: number;
}): number {
  if (args.regime === "pegged") return BW_PEGGED_BAND;
  if (args.regime === "floating") return BW_FLOATING_BAND;
  const elapsed = Math.max(0, args.turnsSinceRegimeChange);
  const t = Math.min(1, elapsed / BW_SUSPENSION_TURNS);
  return BW_PEGGED_BAND + (BW_FLOATING_BAND - BW_PEGGED_BAND) * t;
}

/** Whether a suspended currency has served its transition and should now float. */
export function shouldFloat(args: {
  regime: MonetaryRegime;
  turnsSinceRegimeChange: number;
}): boolean {
  return args.regime === "suspended" && args.turnsSinceRegimeChange >= BW_SUSPENSION_TURNS;
}

/**
 * Command economies never participate. Their currencies are administered and
 * non-convertible by design, so unpegging them would break a design invariant
 * (and make the rouble tradeable). This is the single gate — callers must not
 * re-derive the condition.
 */
export function participatesInFloat(_countryId: CountryId, commandActive: boolean): boolean {
  return !commandActive;
}

/** Money-growth → CPI coefficient for the regime in force. */
export function moneyGrowthCoefficient(regime: MonetaryRegime, peggedDefault: number): number {
  return regime === "pegged" ? peggedDefault : BW_POST_EXIT_MONEY_COEFF;
}

/**
 * Euro adoption conversion rules (portable rules core).
 *
 * Pure data in, plain data out: no database, wall clock, randomness,
 * environment, network, or app-layer imports. The shells (seeders, turn
 * phases) load documents, call these helpers, and write results back.
 *
 * RATE BASIS. Conversions never use official ECB irrevocable parities. They
 * use the game's own authored rate tables: a legacy amount converts to euros
 * at the cross rate implied by the same table the seeder seeds from, so the
 * anchor (internal-unit) value is conserved exactly:
 *
 *   EUR = legacy x R_EUR(anchor) / R_legacy
 *
 * where both rates are local-currency-per-anchor from one table. Official
 * parities would shrink France ~30% in anchor terms: a smuggled balance
 * change. Ireland's factor is exactly 1.0 (amounts unchanged, code flips).
 *
 * PRESET GATING. Only the 2027-default preset starts with the euro adopted.
 * Every helper takes the preset id explicitly and passes non-euro presets
 * through untouched, so 1991 (and every other pre-euro world) behaves
 * byte-identically to before.
 */

export type EuroMemberCountryId = "DE" | "FR" | "IT" | "ES" | "GR" | "AT" | "FI" | "IE";

/** The eight countries euroized immediately after a fresh 2027 bootstrap. */
export const EUROZONE_2027_MEMBERS: readonly EuroMemberCountryId[] = [
  "DE",
  "FR",
  "IT",
  "ES",
  "GR",
  "AT",
  "FI",
  "IE",
];

/**
 * Historical euro adoption year per member. GR joined in 2001; the rest in
 * 1999. Used by era-aware readers to decide whether a world of a given
 * starting year starts adopted. Unknown ids return null (never adopted).
 */
/** Members whose adoption year is 1999 (GR joined in 2001). */
const EURO_1999_ADOPTERS: ReadonlySet<string> = new Set(
  EUROZONE_2027_MEMBERS.filter((member) => member !== "GR")
);

export function euroAdoptionYear(countryId: string): number | null {
  if (countryId === "GR") return 2001;
  if (EURO_1999_ADOPTERS.has(countryId)) return 1999;
  return null;
}

/** Presets whose fresh bootstrap starts with the euro adopted. */
const EURO_PRESETS: ReadonlySet<string> = new Set(["2027-default"]);

/** True when a fresh world of `preset` starts with `countryId` on the euro. */
export function isEuroAdopted(countryId: string, preset: string): boolean {
  if (!EURO_PRESETS.has(preset)) return false;
  return (EUROZONE_2027_MEMBERS as readonly string[]).includes(countryId);
}

/**
 * Multiplicative legacy-to-euro factor from one authored rate table:
 * `R_EUR(anchor) / R_legacy`, both local-currency-per-anchor. Multiplying a
 * legacy amount by it conserves anchor value exactly (up to float rounding).
 * Returns 1 when either rate is missing or non-positive, so unknown inputs
 * pass through instead of zeroing balances.
 */
export function euroConversionFactor(legacyRate: number, eurAnchorRate: number): number {
  if (
    !Number.isFinite(legacyRate) ||
    !Number.isFinite(eurAnchorRate) ||
    legacyRate <= 0 ||
    eurAnchorRate <= 0
  ) {
    return 1;
  }
  return eurAnchorRate / legacyRate;
}

/**
 * Convert a legacy-currency amount to euros at the authored cross rate.
 * Non-finite amounts pass through; the factor guard above handles bad rates.
 */
export function convertLegacyToEuro(
  legacyAmount: number,
  legacyRate: number,
  eurAnchorRate: number
): number {
  if (!Number.isFinite(legacyAmount)) return legacyAmount;
  return legacyAmount * euroConversionFactor(legacyRate, eurAnchorRate);
}

/**
 * Anchor value of a legacy amount: what the shared internal unit sees.
 * Converting legacy -> euro at the cross rate preserves this exactly, which
 * is the property the conformance tests assert (budget/FX agreement).
 */
export function legacyAnchorValue(legacyAmount: number, legacyRate: number): number {
  if (!Number.isFinite(legacyAmount) || !Number.isFinite(legacyRate) || legacyRate <= 0) {
    return NaN;
  }
  return legacyAmount / legacyRate;
}

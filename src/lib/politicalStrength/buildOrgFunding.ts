import type { CountryId } from "@/lib/constants/countries";
import {
  ORG_BUILD_MIN_FUNDED_FRACTION,
  ORG_BUILD_SIZE_MULTIPLIER_MAX,
  ORG_BUILD_SIZE_MULTIPLIER_MIN,
  ORG_BUILD_TREASURY_FRACTION,
  TREASURY_PS_RATE_BY_COUNTRY,
} from "./strengthConstants";

/**
 * Treasury cost of the Build Org action — pure helpers.
 *
 * Build Org has always cost Political Strength; from 2026-09-02 it also costs
 * money. PS remains the action's gate; cash is charged alongside it from the
 * SAME tier that pays the PS (a `state` click debits `statePartyOrg.treasury`,
 * a national-scope click debits `politicalParties.treasury`).
 *
 * Money already bought Org indirectly before this — `psInvestmentRate` converts
 * treasury into PS, and in the 168 turns before the change 37% of all US PS
 * credited was treasury-bought. This makes that price explicit and legible at
 * the point of spend instead of laundering it through the PS pool.
 *
 * Two properties are load-bearing:
 *
 *  1. **Country normalization.** The price derives from
 *     `TREASURY_PS_RATE_BY_COUNTRY`, the same table the PS streams use, so it
 *     scales with each country's currency. A flat number would be crushing in
 *     sterling and free in yen.
 *  2. **Soft failure.** Short funds shrink the click rather than refusing it,
 *     down to `ORG_BUILD_MIN_FUNDED_FRACTION`; below that the click is refused
 *     BEFORE any PS is spent. See that constant for why.
 *
 * Pure (no DB / server imports) so the preview route, the spend route, the NPP
 * sweep, and the UI estimate all price a click identically.
 */

/** PS-spend scopes Build Org can charge against, mirroring `SpendScope`. */
export type OrgBuildFundingScope = "state" | "national-targeted" | "national";

export type OrgBuildFunding =
  | {
      ok: true;
      /** Full price of the click before any shortfall is applied. */
      price: number;
      /** Cash actually charged — `min(price, treasury)`. */
      paid: number;
      /** `paid / price`, in `[ORG_BUILD_MIN_FUNDED_FRACTION, 1]`. Scales Org gain. */
      fundedFraction: number;
    }
  | {
      ok: false;
      reason: "insufficient-funds";
      price: number;
      /** Treasury on hand, for the error message. */
      treasury: number;
    };

/**
 * Cash price of one Build Org click, in the holder's native local currency
 * (both treasury fields and `TREASURY_PS_RATE_BY_COUNTRY` are local, so no
 * conversion happens anywhere on this path).
 *
 * @param countryId - Country whose rate table entry applies
 * @param scope - Which PS pool pays, which also selects the rate tier
 * @param effectivePsCost - PS cost AFTER pressure escalation, so a ladder-capped
 *   click costs 8× the cash of a fresh one
 */
/**
 * Per-state price multiplier from population, on a square-root curve normalized
 * so a country's average state sits at `1`.
 *
 * `normalizer` is the country's mean of `sqrt(population)` across its regions.
 * Dividing by that (rather than by `sqrt(mean population)`) is what makes the
 * average multiplier exactly 1 — the concave curve would otherwise pull the
 * country's average below 1 and quietly cut the overall cost level that
 * `ORG_BUILD_TREASURY_FRACTION` was calibrated against.
 *
 * Returns a neutral `1` whenever the inputs cannot support a ratio (no
 * demographics seeded, a single-region country mid-migration, bad data), so a
 * world without population data prices exactly as it did before this existed.
 *
 * @param population - The state's population
 * @param normalizer - Country mean of `sqrt(population)` over its regions
 */
export function orgBuildSizeMultiplier(
  population: number | null | undefined,
  normalizer: number
): number {
  if (!Number.isFinite(population ?? NaN) || !((population ?? 0) > 0)) return 1;
  if (!Number.isFinite(normalizer) || !(normalizer > 0)) return 1;
  const raw = Math.sqrt(population as number) / normalizer;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(ORG_BUILD_SIZE_MULTIPLIER_MAX, Math.max(ORG_BUILD_SIZE_MULTIPLIER_MIN, raw));
}

export function orgBuildCashPrice(
  countryId: CountryId,
  scope: OrgBuildFundingScope,
  effectivePsCost: number,
  sizeMultiplier: number = 1
): number {
  if (!(effectivePsCost > 0)) return 0;
  const rates = TREASURY_PS_RATE_BY_COUNTRY[countryId] ?? TREASURY_PS_RATE_BY_COUNTRY.US;
  const rate = scope === "state" ? rates.state : rates.national;
  const size = Number.isFinite(sizeMultiplier) && sizeMultiplier > 0 ? sizeMultiplier : 1;
  // Whole currency units. The raw product is fractional for most countries (US
  // state at 1 PS is 2,812.5), and a half-unit debit per click would accumulate
  // floating-point tails across every treasury it touches — and make the price
  // the preview quoted compare inexactly against the amount actually charged.
  // Rounding HERE keeps the preview, the spend route, the NPP sweep and the
  // balance sim on one number. The smallest rate in the table still yields
  // 1,875 at one PS, so rounding never collapses a price to zero.
  return Math.round(rate * ORG_BUILD_TREASURY_FRACTION * effectivePsCost * size);
}

/**
 * Decide what a click can afford. Called BEFORE `spendPoliticalStrength` so a
 * refusal costs the player nothing — no PS debit and no pressure escalation.
 */
export function resolveOrgBuildFunding({
  price,
  treasury,
}: {
  price: number;
  treasury: number;
}): OrgBuildFunding {
  // A zero price (non-positive PS cost, or a rate configured to 0) is a free
  // click, not an unaffordable one.
  if (!(price > 0)) return { ok: true, price: 0, paid: 0, fundedFraction: 1 };

  const available = Number.isFinite(treasury) ? treasury : 0;
  const rawFraction = available / price;
  if (rawFraction < ORG_BUILD_MIN_FUNDED_FRACTION) {
    return { ok: false, reason: "insufficient-funds", price, treasury: available };
  }

  const paid = Math.min(price, available);
  return { ok: true, price, paid, fundedFraction: Math.min(1, paid / price) };
}

/**
 * Clamp a funded fraction into `[ORG_BUILD_MIN_FUNDED_FRACTION, 1]`.
 *
 * Applied AFTER the PS debit commits. `resolveOrgBuildFunding` already refused
 * anything below the floor, but the treasury read and the debit are separate
 * operations: a concurrent GOTV or transfer can drain the row in between. Without
 * this floor that race would scale the click's Org gain to ~0 while the PS and
 * the pressure increment stayed spent, which is strictly worse for the player
 * than the refusal they would have got a moment earlier.
 */
export function clampFundedFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return ORG_BUILD_MIN_FUNDED_FRACTION;
  return Math.min(1, Math.max(ORG_BUILD_MIN_FUNDED_FRACTION, fraction));
}

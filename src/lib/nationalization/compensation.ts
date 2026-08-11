import {
  TIER_MULTIPLIER,
  NATIONALIZATION_BOOK_PREMIUM,
  NATIONALIZATION_COMPENSATION_PREMIUM,
  type CompensationTier,
} from "./constants";
import {
  sectorBookValueAnchor,
  type SectorBookValueInput,
} from "@/lib/corporations/sectorProfitBasis";

export interface WholeCorpValuationInput {
  /** Share price in ₳. */
  sharePrice: number;
  totalShares: number;
  /** Balance-sheet equity in ₳ (liquid capital + sector NPV + held bonds + cross-corp stakes). */
  balanceSheetEquity: number;
  /** Outstanding debt in ₳ that the state will assume. */
  debt: number;
}

/**
 * Whole-corp valuation in ₳: the greater of market cap and balance-sheet equity
 * (the floor blocks a manipulated-low share price from cheapening a seizure),
 * net of the debt the state is assuming so leveraged corps aren't double-counted.
 * Floored at zero.
 */
export function computeWholeCorpValuation(input: WholeCorpValuationInput): number {
  const marketCap = input.sharePrice * input.totalShares;
  const gross = Math.max(marketCap, input.balanceSheetEquity);
  return Math.max(0, gross - input.debt);
}

/**
 * Single-sector valuation reuses the canonical `computeSectorNpvSum` from the
 * corporate-bond-default module (the same going-concern NPV used by dissolution
 * and bond issuance), so there is no separate valuation helper here — see
 * `ownershipTransition.nationalizeSector`.
 */

/**
 * Apply the compensation tier multiplier + the buyout premium to a valuation.
 *
 * Fair value pays {@link NATIONALIZATION_COMPENSATION_PREMIUM}× the going-concern
 * NPV; discounted pays half of that; seizure pays nothing.
 *
 * D11 — when `plantsEnabled` the premium switches to
 * {@link NATIONALIZATION_BOOK_PREMIUM}, because the `valuation` the caller
 * passes has switched from a capitalized earnings stream to replacement-cost
 * BOOK (see {@link sectorCompensationValuationAnchor}). The premium and the
 * base MUST move together — a book base at the 5× earnings premium would be a
 * silent 5× overpay on every taking.
 */
export function applyTier(
  valuation: number,
  tier: CompensationTier,
  options?: { plantsEnabled?: boolean }
): number {
  const premium = options?.plantsEnabled
    ? NATIONALIZATION_BOOK_PREMIUM
    : NATIONALIZATION_COMPENSATION_PREMIUM;
  return valuation * TIER_MULTIPLIER[tier] * premium;
}

/**
 * The valuation base a taking compensates on, in ₳ (D11).
 *
 * Below "plants": the caller's steady-state NPV (`npvAnchor`), unchanged.
 * At/above "plants": the sector's replacement-cost book — what the built
 * capacity plus any construction in flight cost to put in the ground.
 *
 * `fraction` carves a partial taking (sector-wide sweeps take a slice); pass 1
 * for a whole sector.
 *
 * Pairs with {@link applyTier}: whichever base this returns, `applyTier` must be
 * called with the SAME `plantsEnabled` so the matching premium applies.
 */
export interface WholeCorpCompensationInput {
  /** Σ replacement-cost book across the corp's sectors, in ₳ (plants only). */
  sectorBookAnchor: number;
  /**
   * Non-sector assets the taking also absorbs, in ₳, AT THEIR EXISTING BASIS —
   * today that is the corp's liquid capital, which is cash and is already worth
   * exactly its face. Held bonds / cross-corp stakes join this leg when the
   * portfolio pass lands (P5+).
   */
  nonSectorAssetsAnchor: number;
  /** Outstanding debt the state assumes, in ₳. */
  debtAnchor: number;
  tier: CompensationTier;
}

export interface WholeCorpCompensationResult {
  /** Net asset value of the taking, in ₳, before tier/premium. For the ledger. */
  valuationAnchor: number;
  /** What the treasury pays shareholders, in ₳. */
  payoutAnchor: number;
}

/**
 * Whole-corp compensation under plants (D11) — the base and the premium made
 * consistent.
 *
 * THE BUG THIS REPLACES: `nationalizeWholeCorp` computed its base with
 * {@link computeWholeCorpValuation}, which takes `max(marketCap,
 * balanceSheetEquity)`, and then handed the winner to {@link applyTier} with
 * `plantsEnabled: true` — i.e. the {@link NATIONALIZATION_BOOK_PREMIUM}. When
 * marketCap won (a listed corp trading above its plant value, which is the
 * normal case for a profitable one) the state paid a BOOK premium on a MARKET
 * base. The premium and the base are calibrated together, so mixing them is a
 * silent, unbounded over- or under-pay on every whole-corp taking.
 *
 * THE RULE HERE: each asset class is compensated on its own basis, then summed.
 * Sector plants are taken at book and carry the book premium (the state pays
 * above replacement cost — that is what makes a taking compensated rather than
 * confiscatory). Cash is taken at 1.0: paying 1.5× for a dollar would be a
 * money printer, and there is no "premium over replacement cost" for cash.
 *
 * DEBT is netted off the non-sector leg FIRST and only then off the book leg.
 * Debt is a claim on the corp's cash before it is a claim on its plants, and
 * netting it against the premium-bearing leg first would let a leveraged corp's
 * shareholders extract 1.5× the debt they are being relieved of.
 *
 * The market-cap floor is deliberately DROPPED under plants. Its job below
 * plants was to stop a manipulated-low share price from cheapening a seizure;
 * under plants the book leg is that floor, and it cannot be manipulated at all
 * — it is priced off capacity actually in the ground.
 *
 * Below plants nothing calls this: keep using
 * {@link computeWholeCorpValuation} + {@link applyTier}.
 */
export function wholeCorpCompensationAnchor(
  input: WholeCorpCompensationInput
): WholeCorpCompensationResult {
  const book = Math.max(0, input.sectorBookAnchor);
  const nonSector = Math.max(0, input.nonSectorAssetsAnchor);
  const debt = Math.max(0, input.debtAnchor);

  const nonSectorNet = Math.max(0, nonSector - debt);
  const bookNet = Math.max(0, book - Math.max(0, debt - nonSector));

  const valuationAnchor = bookNet + nonSectorNet;
  const payoutAnchor =
    TIER_MULTIPLIER[input.tier] * (bookNet * NATIONALIZATION_BOOK_PREMIUM + nonSectorNet);

  return { valuationAnchor, payoutAnchor };
}

export function sectorCompensationValuationAnchor(
  sector: SectorBookValueInput,
  npvAnchor: number,
  options: {
    plantsEnabled: boolean;
    currentYear?: number | null;
    fraction?: number;
    /** The world's era unit-basis scale (`getEraUnitScale(preset)`). */
    eraUnitScale: number;
  }
): number {
  const fraction = options.fraction ?? 1;
  const base = options.plantsEnabled
    ? sectorBookValueAnchor(sector, options.currentYear, options.eraUnitScale)
    : npvAnchor;
  return base * fraction;
}

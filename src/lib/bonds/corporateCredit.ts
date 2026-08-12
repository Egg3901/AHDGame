import type { ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types/bond";
import type { CorporateSector } from "@/lib/db/types/corporation";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { NPV_ANNUAL_DISCOUNT_RATE, TURNS_PER_DAY } from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getCountryConfig } from "@/lib/constants/countries";
import { calculateCreditScore } from "@/lib/constants/bonds";
import type { CorpCapitalCurrencyInfo } from "@/lib/currency/corporationCapital";
import {
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { sectorEconomicRevenue } from "@/lib/corporations/sectorRevenueBasis";
import {
  sectorDailyProfitAnchor,
  sumConstructionInProgressAnchor,
  type SectorCapexFields,
} from "@/lib/corporations/sectorProfitBasis";
import { sumBondPrincipalAnchor, sumBondAnnualInterestAnchor } from "@/lib/bonds/bondPrincipalSum";
import { qualifiesForIndexInclusionBenefit } from "@/lib/corporations/indexOwnership";
import { INSIDER_CONCENTRATION_THRESHOLD } from "@/lib/corporations/ceoOwnership";

/** Active corporate bond issuances (excludes sovereign / treasury bonds). */
export function isCorporateIssuerBond(bond: Bond): boolean {
  return bond.issuerType !== "sovereign";
}

/**
 * Sum sector NPVs using the same methodology as the bonds API and bond pricing path.
 *
 * Returns NPV in ₳. Sector revenue is stored in the owning corp's home currency
 * post-v0.2.6; pass `corp` + `fxByCurrency` so the helper can normalize each
 * sector's revenue to ₳ before the NPV math. Callers with pre-forex corps (no
 * liquidCurrencyCode) or callers that pass neither can leave both params
 * undefined — readCorpEconomicAnchor passes through at rate=1.0, matching the
 * historical ₳-on-disk behavior.
 */
export function sumCorporateSectorNpv(
  sectors: CorporateSector[],
  corporationId: ObjectId,
  primeRateByCountry: Map<CountryId, number>,
  corp?: CorpCapitalCurrencyInfo | null,
  fxByCurrency?: ReadonlyMap<CurrencyCode, number>,
  /** True when marketSystemMode >= "plants" — drops the phantom growth-cost deduction. */
  plantsEnabled = false
): number {
  const id = corporationId.toString();
  const code = corp ? resolveCorpLiquidCurrencyCode(corp) : undefined;
  const rate = corp && fxByCurrency ? fxRateForCorpFromMap(corp, fxByCurrency) : 1;
  let sectorNPV = 0;
  for (const s of sectors) {
    if (s.corporationId.toString() !== id) continue;
    const sectorCountryId = s.countryId;
    // Skip sectors missing countryId — legacy documents created before this field was required.
    // Omitting them underestimates NPV slightly but avoids a TypeError on getCountryConfig(undefined).
    if (!sectorCountryId) continue;
    const primeRate =
      primeRateByCountry.get(sectorCountryId) ??
      getCountryConfig(sectorCountryId).centralBank.defaultPrimeRate;
    const { dailyProfitAnchor } = sectorDailyProfitAnchor(s, {
      plantsEnabled,
      growthCost: { kind: "recomputed", primeRate },
      currencyCode: code,
      fxRate: rate,
    });
    const profit = dailyProfitAnchor / TURNS_PER_DAY;
    const yearly = profit * TURNS_PER_YEAR;
    if (yearly > 0) sectorNPV += yearly / NPV_ANNUAL_DISCOUNT_RATE;
  }
  return sectorNPV;
}

/**
 * Sum per-turn operating income across all sectors for a corporation, in ₳.
 *
 * Unlike {@link sumCorporateSectorNpv}, this accumulates profit from ALL
 * sectors (positive and negative) so loss-making sectors correctly reduce
 * the income estimate. Does not include corp-level overhead (marketing,
 * logistics, CEO salary), taxes, or bond cash flows — callers subtract
 * those separately if needed.
 *
 * Uses current sector settings (currentGrowthRate, profitMargin) without
 * state-metric modifiers, matching the same approximation used by
 * sumCorporateSectorNpv for the equity side of the credit calculation.
 */
export function sumCorporateSectorPerTurnIncome(
  sectors: CorporateSector[],
  corporationId: ObjectId,
  primeRateByCountry: Map<CountryId, number>,
  corp?: CorpCapitalCurrencyInfo | null,
  fxByCurrency?: ReadonlyMap<CurrencyCode, number>,
  /** True when marketSystemMode >= "plants" — drops the phantom growth-cost deduction. */
  plantsEnabled = false
): number {
  const id = corporationId.toString();
  const code = corp ? resolveCorpLiquidCurrencyCode(corp) : undefined;
  const rate = corp && fxByCurrency ? fxRateForCorpFromMap(corp, fxByCurrency) : 1;
  let perTurnIncome = 0;
  for (const s of sectors) {
    if (s.corporationId.toString() !== id) continue;
    const sectorCountryId = s.countryId;
    // Skip sectors missing countryId — same guard as sumCorporateSectorNpv.
    if (!sectorCountryId) continue;
    const primeRate =
      primeRateByCountry.get(sectorCountryId) ??
      getCountryConfig(sectorCountryId).centralBank.defaultPrimeRate;
    const { dailyProfitAnchor } = sectorDailyProfitAnchor(s, {
      plantsEnabled,
      growthCost: { kind: "recomputed", primeRate },
      currencyCode: code,
      fxRate: rate,
    });
    perTurnIncome += dailyProfitAnchor / TURNS_PER_DAY;
  }
  return perTurnIncome;
}

/**
 * Sum annual gross revenue across all sectors for a corporation, in ₳.
 * Revenue only — does not subtract maintenance, growth costs, or taxes.
 */
export function sumCorporateSectorAnnualRevenue(
  sectors: CorporateSector[],
  corporationId: ObjectId,
  corp?: CorpCapitalCurrencyInfo | null,
  fxByCurrency?: ReadonlyMap<CurrencyCode, number>
): number {
  const id = corporationId.toString();
  const code = corp ? resolveCorpLiquidCurrencyCode(corp) : undefined;
  const rate = corp && fxByCurrency ? fxRateForCorpFromMap(corp, fxByCurrency) : 1;
  let annual = 0;
  for (const s of sectors) {
    if (s.corporationId.toString() !== id) continue;
    if (!s.countryId) continue;
    const revenueAnchor = readCorpEconomicAnchor(sectorEconomicRevenue(s), code, rate);
    annual += (revenueAnchor / TURNS_PER_DAY) * TURNS_PER_YEAR;
  }
  return annual;
}

/**
 * Σ outstanding construction-in-progress (₳) across one corp's sectors.
 *
 * Already ₳ on disk (see the P3a capex contract in `sectorProfitBasis.ts`), so
 * unlike revenue there is no FX normalization step here.
 */
export function sumCorporateSectorConstructionInProgress(
  sectors: readonly (CorporateSector & SectorCapexFields)[],
  corporationId: ObjectId
): number {
  const id = corporationId.toString();
  return sumConstructionInProgressAnchor(sectors.filter((s) => s.corporationId.toString() === id));
}

export interface CorporateCreditComputationInput {
  /** Corp's liquidCapital converted to ₳ by the caller. */
  liquidCapitalAnchor: number;
  /** Per-turn income in ₳. */
  incomePerTurn: number;
  /** Sector NPV in ₳ (use {@link sumCorporateSectorNpv}). */
  sectorNpv: number;
  /**
   * Σ outstanding construction-in-progress across the corp's sectors, in ₳
   * (use {@link sumCorporateSectorConstructionInProgress}).
   *
   * Capitalized build spend is an ASSET, not a hole. Without this leg a corp
   * that just paid ₳50m into a plant reads as having destroyed ₳50m of equity
   * for the whole construction window and gets downgraded for investing.
   * Absent/0 for every pre-P3a corp.
   */
  constructionInProgressAnchor?: number;
  /** Full bond list — filtered internally to non-matured corporate bonds owned by `corporationId`. */
  bonds: Bond[] | undefined;
  corporationId: ObjectId;
  currentTurn: number;
  bondDefaultCreditPenaltyUntilTurn: number | null | undefined;
  previousCompositeScore?: number;
  /**
   * CEO's share ownership as a fraction of totalShares (0–1).
   * Triggers a one-notch credit rating downgrade on public corps when > 0.65.
   * Pass 0 or omit for private/NPC/natcorps.
   */
  ceoOwnershipFraction?: number;
  /** True when the corp is private — concentration penalty does not apply. */
  isPrivate?: boolean;
  /**
   * Fraction of shares held by index funds (0–1), from
   * `indexFundOwnershipFraction`. At or above INDEX_INCLUSION_THRESHOLD this
   * earns a one-notch upgrade (suggestion #62). Private corps are exempt for
   * the same reason they are exempt from the concentration penalty: they have
   * no float for a fund to hold.
   */
  indexFundOwnershipFraction?: number;
  /**
   * Live FX rates for anchor-normalizing bond amounts (post-v0.2.6 bonds
   * denominate in `bond.currencyCode`). Required so `totalDebt` and
   * `annualCouponObligations` match the ₳ units of `liquidCapitalAnchor` /
   * `totalEquity` that the credit scorer expects. Pre-forex bonds (no
   * `currencyCode`) and any unknown-rate edge cases pass through unchanged.
   */
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
}

export function computeCorporateCreditAtTurn(input: CorporateCreditComputationInput) {
  // Filter to this corp's non-matured corporate bonds (sovereign bonds live on
  // gov budgets, not corp balance sheets).
  const id = input.corporationId.toString();
  const corpBonds = (input.bonds ?? []).filter(
    (b) => isCorporateIssuerBond(b) && b.corporationId.toString() === id && !b.matured
  );
  // Anchor-normalized sums so debt/equity and interest-coverage ratios inside
  // `calculateCreditScore` compare coherent units. Pre-fix this was a LOCAL sum
  // compared to ₳ equity — scored healthy non-USD corps as CCC.
  const totalDebt = sumBondPrincipalAnchor(corpBonds, input.fxByCurrency);
  const annualCouponObligations = sumBondAnnualInterestAnchor(corpBonds, input.fxByCurrency);
  const totalEquity =
    input.liquidCapitalAnchor +
    input.sectorNpv +
    Math.max(0, input.constructionInProgressAnchor ?? 0);
  const annualIncome = input.incomePerTurn * TURNS_PER_YEAR;
  const penaltyActive =
    input.bondDefaultCreditPenaltyUntilTurn != null &&
    input.currentTurn < input.bondDefaultCreditPenaltyUntilTurn;

  const concentrationPenalty =
    !input.isPrivate && (input.ceoOwnershipFraction ?? 0) > INSIDER_CONCENTRATION_THRESHOLD;
  const indexInclusionUpgrade =
    !input.isPrivate && qualifiesForIndexInclusionBenefit(input.indexFundOwnershipFraction ?? 0);

  const creditRating = calculateCreditScore(
    input.liquidCapitalAnchor,
    totalDebt,
    annualIncome,
    annualCouponObligations,
    totalEquity,
    {
      bondDefaultCreditPenaltyActive: !!penaltyActive,
      previousCompositeScore: input.previousCompositeScore,
      insiderConcentrationPenalty: concentrationPenalty,
      indexInclusionUpgrade,
    }
  );

  return {
    creditRating,
    indexInclusionUpgrade,
    totalDebt,
    annualCouponObligations,
    totalEquity,
    annualIncome,
    debtToEquityRatio: totalEquity > 0 ? totalDebt / totalEquity : null,
    interestCoverageRatio:
      annualCouponObligations > 0 ? annualIncome / annualCouponObligations : null,
  };
}

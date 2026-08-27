/**
 * Corporate bond default: asset / equity helpers, settlement previews, and issuance checks.
 */

import type { ObjectId } from "mongodb";
import type { Bond, CentralBank, Corporation, CorporateSector } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE, type BondMaturityTurns } from "@/lib/db/types/bond";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorpCapitalCurrencyInfo } from "@/lib/currency/corporationCapital";
import {
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { sectorDailyProfitAnchor } from "@/lib/corporations/sectorProfitBasis";
import { sumBondPrincipalAnchor, sumBondAnnualInterestAnchor } from "@/lib/bonds/bondPrincipalSum";
import {
  DISSOLUTION_SECTOR_SALVAGE_FRACTION,
  NPV_ANNUAL_DISCOUNT_RATE,
  TURNS_PER_DAY,
} from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getCountryConfig } from "@/lib/constants/countries";
import { buildPrimeRateByCountry } from "@/lib/centralBank/helpers";
import {
  calculateCreditScore,
  getBondCouponRate,
  MAX_BOND_ISSUANCE_FRACTION,
  MIN_BOND_ISSUANCE,
} from "@/lib/constants/bonds";

/**
 * NPV sum for a single corp's sectors, in ₳. Post-v0.2.6, sector revenue stores
 * in the owning corp's home currency; pass `corp` + `fxByCurrency` to normalize.
 * Pre-forex corps (no liquidCurrencyCode) and callers that omit the FX params
 * get passthrough at rate=1.0, matching the historical behavior.
 */
export function computeSectorNpvSum(
  sectors: CorporateSector[],
  primeRateByCountry: Map<string, number>,
  corp?: CorpCapitalCurrencyInfo | null,
  fxByCurrency?: ReadonlyMap<CurrencyCode, number>,
  /**
   * `excludeGrowthCost` values the sector on its STEADY-STATE earning power
   * (revenue − maintenance), ignoring the discretionary, temporary growth cost.
   * Used only for the nationalization payout: growth spending is the owner's
   * reversible choice, not a permanent loss of the asset's worth, so a sector
   * running high growth (whose going-concern profit is consumed by growth cost)
   * must not value to €0 when the state seizes a fully productive asset. The
   * going-concern path (bond default / dissolution) keeps the growth cost.
   */
  options?: {
    excludeGrowthCost?: boolean;
    /**
     * True when marketSystemMode >= "plants" — the growth-cost deduction is a
     * phantom charge there (growth spend no longer buys capacity). Defaults to
     * false = legacy behaviour for callers that cannot read game config.
     */
    plantsEnabled?: boolean;
  }
): number {
  const code = corp ? resolveCorpLiquidCurrencyCode(corp) : undefined;
  const rate = corp && fxByCurrency ? fxRateForCorpFromMap(corp, fxByCurrency) : 1;
  let sectorNPV = 0;
  for (const s of sectors) {
    const sectorCountryId = s.countryId;
    // Skip sectors missing countryId — legacy documents created before this field was required.
    if (!sectorCountryId) continue;
    const primeRate =
      primeRateByCountry.get(sectorCountryId) ??
      getCountryConfig(sectorCountryId).centralBank.defaultPrimeRate;
    // Realized-preferring basis (#3001/#3002), shared with sumCorporateSectorNpv
    // in corporateCredit.ts via sectorProfitBasis — a corp must be rated and
    // settled on one revenue, not nameplate here and realized there.
    const { dailyProfitAnchor } = sectorDailyProfitAnchor(s, {
      plantsEnabled: options?.plantsEnabled ?? false,
      excludeGrowthCost: options?.excludeGrowthCost,
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

export function buildPrimeRateMap(centralBanks: CentralBank[]): Map<string, number> {
  // Member-aware: keying by bank.countryId would drop shared-bank members
  // (the ECB doc carries countryId "DE", so IE sectors would silently fall
  // back to the configured default prime rate).
  return buildPrimeRateByCountry(centralBanks);
}

/**
 * @param liquidCapitalAnchor Corp liquidCapital already converted to ₳ by the caller.
 * @param sectorNpv NPV of all active sectors, in ₳.
 * @param constructionInProgressAnchor Σ outstanding capitalized build spend, in ₳
 *   (P3a). Capitalized capex is an asset — omitting it made a mid-build corp
 *   read as having destroyed its own equity. Absent/0 for pre-P3a corps.
 */
export function totalEquityForBonds(
  liquidCapitalAnchor: number,
  sectorNpv: number,
  constructionInProgressAnchor = 0
): number {
  return liquidCapitalAnchor + sectorNpv + Math.max(0, constructionInProgressAnchor);
}

/**
 * These three sums are thin filters over {@link sumBondPrincipalAnchor} — every
 * returned value is in ₳, safe to compare against `liquidCapitalAnchor` /
 * `totalEquity` / any other ₳-denominated corp metric. Keeps the FX-normalization
 * logic in exactly one place.
 */
export const sumNonMaturedBondPrincipal = (
  bonds: Bond[],
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number =>
  sumBondPrincipalAnchor(
    bonds.filter((b) => !b.matured),
    fxByCurrency
  );

export const sumDefaultedBondPrincipal = (
  bonds: Bond[],
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number =>
  sumBondPrincipalAnchor(
    bonds.filter((b) => !b.matured && b.defaulted),
    fxByCurrency
  );

export const sumNonDefaultedNonMaturedPrincipal = (
  bonds: Bond[],
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number =>
  sumBondPrincipalAnchor(
    bonds.filter((b) => !b.matured && !b.defaulted),
    fxByCurrency
  );

/** Face value rounded down to whole bond units ($1k each). */
export function roundFaceToBondUnits(faceValue: number): number {
  const units = Math.floor(faceValue / BOND_UNIT_FACE_VALUE);
  return units * BOND_UNIT_FACE_VALUE;
}

/**
 * Max new face value the corporation can issue under the 2× equity rule (all non-matured bonds count).
 */
export function maxNewIssuanceFaceValue(equity: number, existingDebt: number): number {
  const cap = Math.max(0, equity * MAX_BOND_ISSUANCE_FRACTION - existingDebt);
  return roundFaceToBondUnits(cap);
}

/**
 * Pro-forma credit rating and coupon for replacing defaulted principal with a new bond
 * (matches POST bond-default/refinance). Applies default penalty when active.
 *
 * All money inputs + `actualFaceAnchor` are in ₳. `fxByCurrency` is used
 * internally to anchor-normalize the existing bond pool's principal and
 * coupon obligations so debt/equity + interest-coverage ratios compare
 * coherent units. Returns rating + coupon rate, both unit-agnostic.
 */
export function previewRefinanceIssuance(params: {
  corporation: Corporation;
  /** Corp's liquidCapital converted to ₳ by the caller. */
  liquidCapitalAnchor: number;
  allNonMaturedBonds: Bond[];
  /** New-bond face value in ₳. Caller converts ₳→LOCAL for the actual stored bond doc. */
  actualFaceAnchor: number;
  sectorNpv: number;
  annualIncome: number;
  primeRate: number;
  currentTurn: number;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  maturityTurns?: BondMaturityTurns;
}): {
  creditRating: ReturnType<typeof calculateCreditScore>;
  couponRate: number;
} {
  const {
    corporation,
    liquidCapitalAnchor,
    allNonMaturedBonds,
    actualFaceAnchor,
    sectorNpv,
    annualIncome,
    primeRate,
    currentTurn,
    fxByCurrency,
    maturityTurns,
  } = params;

  const nonDefaultedPool = allNonMaturedBonds.filter((b) => !b.defaulted);
  const nonDefaultedDebt = sumBondPrincipalAnchor(nonDefaultedPool, fxByCurrency);
  // Interest must cover the SAME pool the debt figure does. Summing only the
  // non-defaulted pool while adding `actualFaceAnchor` to debt below meant a
  // corp whose only bond was the defaulted one being rolled reported zero
  // interest, which trips calculateCreditScore's "no debt = good coverage"
  // fallback and scores interest coverage a perfect 100. That corp then prices
  // as investment grade on a roll it can service none of. The post-default CCC
  // floor used to hide this by flooring the result anyway.
  //
  // The rolled principal survives the roll, so its obligation belongs in the
  // ratio. Its existing coupon is the non-circular proxy for the replacement's.
  const annualInterest = sumBondAnnualInterestAnchor(allNonMaturedBonds, fxByCurrency);
  const totalEquity = totalEquityForBonds(liquidCapitalAnchor, sectorNpv);

  // The post-default CCC floor is deliberately NOT applied here. This preview
  // prices a like-for-like roll of debt that has already defaulted, and the
  // default that set the floor is the very event this roll exists to cure —
  // pricing off it is circular, and the result is a cure that is worse than the
  // disease. Ticket #1130: a roll repriced 6.34% → 17.42%, tripling per-turn
  // debt service on a corp that had defaulted for want of cash, while adding no
  // cash at all (executeCorporationBondRefinance deliberately credits nothing,
  // since no new investor is buying). A corp four turns from covering its coupon
  // was pushed roughly twenty-one turns away, guaranteeing the next default.
  //
  // The penalty exists to make NEW borrowing expensive after a default, and it
  // still does: every other issuance path passes the flag from
  // isBondDefaultCreditPenaltyActive. Only the forced roll of existing principal
  // is priced on the corp's actual fundamentals.
  // Cash is NOT credited with the new face. A refinance rolls existing holders
  // into a replacement bond at par and hands the corp nothing — see
  // executeCorporationBondRefinance, which explicitly declines to credit it.
  // Adding the face here (correct for a new issuance, where proceeds do arrive)
  // scored the liquidity component as though a broke corp had just been handed
  // its own principal in cash.
  const creditRating = calculateCreditScore(
    liquidCapitalAnchor,
    nonDefaultedDebt + actualFaceAnchor,
    annualIncome,
    annualInterest,
    totalEquity,
    { bondDefaultCreditPenaltyActive: false }
  );
  const couponRate = getBondCouponRate(primeRate, creditRating.rating, maturityTurns);

  return { creditRating, couponRate };
}

/**
 * Ticket #1198 deliberately does NOT apply its exit-equity ceiling here. That
 * cap governs NEW borrowing; a refinance is a like-for-like roll of principal
 * that already exists, adds no debt, and hands the corp no cash (see
 * `executeCorporationBondRefinance`). Capping the roll by realizable assets
 * would lock a defaulted corp out of the only cure available to it, which is
 * the #1130 failure mode in a new costume: the cure becoming worse than the
 * disease. New issuance answers to the exit cap; rolling existing paper does
 * not.
 */
export function canRefinanceDefaultedDebt(params: {
  equity: number;
  existingDebtAllNonMatured: number;
  defaultedPrincipal: number;
}): { ok: boolean; requiredFace: number; maxAllowedFace: number } {
  const requiredFace = roundFaceToBondUnits(params.defaultedPrincipal);
  const maxAllowed = maxNewIssuanceFaceValue(params.equity, params.existingDebtAllNonMatured);
  if (requiredFace < MIN_BOND_ISSUANCE) {
    return { ok: false, requiredFace, maxAllowedFace: maxAllowed };
  }
  return {
    ok: requiredFace <= maxAllowed,
    requiredFace,
    maxAllowedFace: maxAllowed,
  };
}

export interface DissolveSettlementPreview {
  liquidCapital: number;
  sectorNpv: number;
  totalAssets: number;
  totalBondClaims: number;
  bondRecoveryPool: number;
  shareholderPool: number;
  bondRecoveryPct: number;
}

/**
 * All returned fields are in ₳. `liquidCapitalAnchor` and `sectorNpv` come from
 * the caller already normalized; `totalBondClaims` is anchor-normalized here
 * via {@link sumNonMaturedBondPrincipal}. Downstream dissolution payouts must
 * scale each bond's `face` via its own `currencyCode` to stay ₳-coherent — see
 * {@link executeCorporationBondDefaultDissolution}.
 */
export function previewDissolveSettlement(
  corp: Corporation,
  sectorNpv: number,
  bonds: Bond[],
  /** Corp's liquidCapital converted to ₳ by the caller. */
  liquidCapitalAnchor: number,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>,
  /**
   * D11 — under plants, exits settle at BOOK, not at a fraction of NPV. Pass
   * `sectorBookAnchor` = Σ {@link sectorBookValueAnchor} over the corp's
   * sectors together with `plantsEnabled: true`; the same salvage fraction then
   * applies to the book figure. Omit entirely for the legacy NPV path.
   */
  options?: { plantsEnabled?: boolean; sectorBookAnchor?: number }
): DissolveSettlementPreview {
  const lc = Math.max(0, liquidCapitalAnchor);
  // Sectors are abandoned to the unowned market on dissolution (no buyer), so
  // only a salvage fraction of their value is recoverable as cash. Paying the
  // full value minted the corp's enterprise value (the exploit).
  //
  // Below plants that value is the going-concern NPV. Under plants it is the
  // sector's replacement-cost BOOK (D11): capacity is a real, priced, built
  // thing, so what a liquidator recovers is a haircut on the plant — which also
  // guarantees salvage < build cost and closes the build-then-dissolve mint.
  const salvageBasis =
    options?.plantsEnabled === true ? (options.sectorBookAnchor ?? 0) : sectorNpv;
  const salvagedSectorNpv = DISSOLUTION_SECTOR_SALVAGE_FRACTION * Math.max(0, salvageBasis);
  const totalAssets = lc + salvagedSectorNpv;
  const totalBondClaims = sumNonMaturedBondPrincipal(bonds, fxByCurrency);
  const bondRecoveryPool = Math.min(totalAssets, totalBondClaims);
  const shareholderPool = Math.max(0, totalAssets - bondRecoveryPool);
  const bondRecoveryPct =
    totalBondClaims > 0 ? Math.round((bondRecoveryPool / totalBondClaims) * 10_000) / 100 : 100;
  return {
    liquidCapital: liquidCapitalAnchor,
    sectorNpv,
    totalAssets,
    totalBondClaims,
    bondRecoveryPool,
    shareholderPool,
    bondRecoveryPct,
  };
}

export interface ShareholderPayoutRow {
  characterId: string;
  /** True when this payout targets an imperial character (imperialCharacters collection). */
  isImperial?: boolean;
  name: string;
  shares: number;
  payout: number;
}

export interface CorporateShareholderPayoutRow {
  corporationId: string;
  name: string;
  shares: number;
  /** Anchor-denominated; caller converts to the receiving corp's home currency. */
  payout: number;
}

export interface PublicFloatPayoutRow {
  shares: number;
  /** Anchor-denominated; caller converts to the country's home currency for CB reserveBalance. */
  payout: number;
}

export interface FundShareholderPayoutRow {
  fundId: string;
  name: string;
  shares: number;
  /** Anchor-denominated; index funds hold cash in ₳ (cashAnchor), so paid as-is. */
  payout: number;
}

export interface ShareholderAllocation {
  /** Character + imperial-character shareholder rows. Paid to personal cash balances. */
  characterRows: ShareholderPayoutRow[];
  /** Corporate equity shareholders. Paid into their liquidCapital. */
  corporationRows: CorporateShareholderPayoutRow[];
  /** Index-fund shareholders. Paid into the fund's cashAnchor (₳). */
  fundRows: FundShareholderPayoutRow[];
  /** Allocation for shares sitting in publicFloat. Paid to the country's central bank reserve. */
  publicFloatRow: PublicFloatPayoutRow | null;
}

/**
 * Allocate the shareholder pool pro-rata across every share bucket: character,
 * imperial-character, corporate equity holder, and the publicFloat.
 *
 * Pre-fix, this function emitted only character/imperial rows and divided by
 * `totalShares`, silently dropping the corporate + publicFloat allocation
 * (bug #0540). Now every bucket gets its proportional cut; callers route
 * each to the appropriate destination.
 *
 * @param nameById - Map of characterId/imperialCharacterId/corporationId string → display name
 */
export function allocateShareholderPool(
  corp: Corporation,
  shareholderPool: number,
  nameById: Map<string, string>
): ShareholderAllocation {
  const totalShares = corp.totalShares ?? 0;
  if (totalShares <= 0 || shareholderPool <= 0) {
    return { characterRows: [], corporationRows: [], fundRows: [], publicFloatRow: null };
  }

  const characterRows: ShareholderPayoutRow[] = [];
  const corporationRows: CorporateShareholderPayoutRow[] = [];
  const fundRows: FundShareholderPayoutRow[] = [];

  for (const sh of corp.shareholders ?? []) {
    if (sh.shares <= 0) continue;
    const payout = Math.floor((shareholderPool * sh.shares) / totalShares);
    if (sh.characterId) {
      const id = sh.characterId.toString();
      characterRows.push({
        characterId: id,
        name: nameById.get(id) ?? "Shareholder",
        shares: sh.shares,
        payout,
      });
    } else if (sh.imperialCharacterId) {
      const id = sh.imperialCharacterId.toString();
      characterRows.push({
        characterId: id,
        isImperial: true,
        name: nameById.get(id) ?? "Shareholder",
        shares: sh.shares,
        payout,
      });
    } else if (sh.corporationId) {
      const id = sh.corporationId.toString();
      corporationRows.push({
        corporationId: id,
        name: nameById.get(id) ?? "Corporate shareholder",
        shares: sh.shares,
        payout,
      });
    } else if (sh.fundId) {
      // #3451: index-fund shareholders were previously dropped here — their
      // pro-rata slice was computed (counted in totalShares) but matched no
      // branch, so it was silently discarded. Now emit a fund row so callers
      // can pay it (fund cash is ₳, same as the pool — no FX conversion).
      const id = sh.fundId.toString();
      fundRows.push({
        fundId: id,
        name: nameById.get(id) ?? "Index fund",
        shares: sh.shares,
        payout,
      });
    }
  }

  const floatShares = corp.publicFloat ?? 0;
  const publicFloatRow: PublicFloatPayoutRow | null =
    floatShares > 0
      ? {
          shares: floatShares,
          payout: Math.floor((shareholderPool * floatShares) / totalShares),
        }
      : null;

  return { characterRows, corporationRows, fundRows, publicFloatRow };
}

export function isBondDefaultCreditPenaltyActive(corp: Corporation, currentTurn: number): boolean {
  const until = corp.bondDefaultCreditPenaltyUntilTurn;
  return until != null && currentTurn < until;
}

export function mergeDefaultedBondHolders(defaultedBonds: Bond[]): {
  holderUnits: Map<string, { characterId: ObjectId; units: number }>;
  imperialHolderUnits: Map<string, { imperialCharacterId: ObjectId; units: number }>;
  corpHolderUnits: Map<string, { corporationId: ObjectId; units: number }>;
  publicFloat: number;
} {
  const holderUnits = new Map<string, { characterId: ObjectId; units: number }>();
  const imperialHolderUnits = new Map<string, { imperialCharacterId: ObjectId; units: number }>();
  const corpHolderUnits = new Map<string, { corporationId: ObjectId; units: number }>();
  let publicFloat = 0;

  for (const bond of defaultedBonds) {
    publicFloat += bond.publicFloat ?? 0;
    for (const h of bond.holders) {
      if (h.characterId) {
        const k = h.characterId.toString();
        const prev = holderUnits.get(k);
        if (prev) prev.units += h.units;
        else holderUnits.set(k, { characterId: h.characterId, units: h.units });
      } else if (h.imperialCharacterId) {
        const k = h.imperialCharacterId.toString();
        const prev = imperialHolderUnits.get(k);
        if (prev) prev.units += h.units;
        else
          imperialHolderUnits.set(k, {
            imperialCharacterId: h.imperialCharacterId,
            units: h.units,
          });
      } else if (h.corporationId) {
        const k = h.corporationId.toString();
        const prev = corpHolderUnits.get(k);
        if (prev) prev.units += h.units;
        else corpHolderUnits.set(k, { corporationId: h.corporationId, units: h.units });
      }
    }
  }

  return { holderUnits, imperialHolderUnits, corpHolderUnits, publicFloat };
}

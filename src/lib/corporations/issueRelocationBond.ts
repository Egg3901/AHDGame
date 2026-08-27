import type { Db } from "mongodb";
import { NextResponse } from "next/server";
import type { Corporation, Bond, CentralBank, CorporateSector } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import {
  BOND_ISSUANCE_COOLDOWN_TURNS,
  MAX_BOND_ISSUANCE_FRACTION,
  MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION,
  calculateCreditScore,
  getBondCouponRate,
} from "@/lib/constants/bonds";
import { loadCorpExitEquityAnchor } from "@/lib/bonds/corpExitEquity";
import {
  sumCorporateSectorNpv,
  sumCorporateSectorConstructionInProgress,
} from "@/lib/bonds/corporateCredit";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { buildPrimeRateByCountry } from "@/lib/centralBank/helpers";
import { isBondDefaultCreditPenaltyActive } from "@/lib/bonds/corporateBondDefault";
import { sumBondPrincipalAnchor, sumBondAnnualInterestAnchor } from "@/lib/bonds/bondPrincipalSum";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getCountryConfig } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  anchorToCorpCapital,
  corpLiquidCapitalToAnchor,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";

/** Relocation bond uses the longest corporate tenor (7yr = 336 turns). */
export const RELOCATION_BOND_MATURITY_TURNS: BondMaturityTurns = 336;

export interface RelocationBondPreflight {
  /** True when both cooldown and leverage cap allow issuance of this bond */
  ok: boolean;
  /** Turns remaining on bond issuance cooldown, or null if cooldown is clear */
  cooldownTurnsRemaining: number | null;
  /** Max additional debt issuable under the leverage cap, in anchor ₳ */
  availableBondCapacity: number;
  /** Computed credit rating letter for the hypothetical new bond */
  creditRating?: string;
  /** Computed coupon rate (%) for the hypothetical new bond */
  couponRate?: number;
  /** Total existing debt across all outstanding bonds, in anchor ₳ */
  existingDebt: number;
  /** Total equity (liquidCapital + sector NPV), in anchor ₳ */
  totalEquity: number;
}

/**
 * Validate whether the corp can issue a bond for `relocationCostAnchor` this turn.
 * Pure read — does not mutate.
 *
 * All monetary inputs/outputs here are ₳. `corporation.liquidCapital` and
 * `bond.totalIssued` are in the corp's/bond's home currency post-v0.2.6, so
 * they are anchor-normalized before being fed to the credit scorer. Pre-fix
 * this helper summed cross-currency LOCAL totals and compared them against
 * ₳ equity, producing wildly wrong credit scores for non-USD corps.
 */
export async function previewRelocationBond(
  db: Db,
  corporation: Corporation,
  relocationCostAnchor: number,
  currentTurn: number,
  /** Pre-loaded FX map — reused when the caller already has one (e.g. HQ relocate route). Omit to load fresh. */
  fxByCurrencyOverride?: ReadonlyMap<CurrencyCode, number>
): Promise<RelocationBondPreflight> {
  const latestBond = await db
    .collection<Bond>("bonds")
    .findOne({ corporationId: corporation._id }, { sort: { issuedAtTurn: -1 } });
  let cooldownTurnsRemaining: number | null = null;
  if (latestBond) {
    const cooldownEnd = latestBond.issuedAtTurn + BOND_ISSUANCE_COOLDOWN_TURNS;
    if (currentTurn < cooldownEnd) {
      cooldownTurnsRemaining = cooldownEnd - currentTurn;
    }
  }

  const existingBonds = await db
    .collection<Bond>("bonds")
    .find({ corporationId: corporation._id, matured: false })
    .toArray();
  const fxByCurrency = fxByCurrencyOverride ?? (await loadFxRatesByCurrency(db));
  const existingDebt = sumBondPrincipalAnchor(existingBonds, fxByCurrency);

  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find({ corporationId: corporation._id })
    .toArray();
  const centralBanks = await db.collection<CentralBank>("centralBanks").find({}).toArray();
  // Member-aware: shared-bank members (IE → ECB) must resolve the shared doc.
  const primeRateByCountry = buildPrimeRateByCountry(centralBanks);
  // Same equity identity as the ordinary bond-issuance route (plants-aware NPV
  // + capitalized build spend), so a relocation bond and a normal bond quote
  // the same headroom for the same corp on the same turn.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  const sectorNPV = sumCorporateSectorNpv(
    sectors,
    corporation._id,
    primeRateByCountry,
    corporation,
    fxByCurrency,
    plantsEnabled
  );
  const corpFxRate = fxByCurrency.get(resolveCorpLiquidCurrencyCode(corporation) ?? "USD") ?? 1;
  const liquidCapitalAnchor = corpLiquidCapitalToAnchor(
    corporation.liquidCapital,
    corporation,
    corpFxRate
  );
  const totalEquity =
    liquidCapitalAnchor +
    sectorNPV +
    sumCorporateSectorConstructionInProgress(sectors, corporation._id);
  // Ticket #1198: a relocation bond is new borrowing, so it answers to the same
  // exit-equity ceiling as an ordinary issuance. Without it this route stayed
  // the open door to the going-concern-vs-realizable gap the ordinary route
  // just closed.
  const { exitEquityAnchor } = await loadCorpExitEquityAnchor(db, {
    liquidCapitalAnchor,
    sectors,
    corporationId: corporation._id,
    corp: corporation,
    fxByCurrency,
    primeRateByCountry,
    plantsEnabled,
  });
  const availableBondCapacity = Math.max(
    0,
    Math.min(
      totalEquity * MAX_BOND_ISSUANCE_FRACTION - existingDebt,
      exitEquityAnchor * MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION - existingDebt
    )
  );

  const latestHistory = await db
    .collection("corporationHistory")
    .findOne({ corporationId: corporation._id }, { sort: { turn: -1 } });
  // corporationHistory.income is denominated in the corp's home currency
  // post-v0.2.6; normalize to ₳ before feeding the scorer.
  const incomeLocal = ((latestHistory?.income as number) ?? 0) * TURNS_PER_YEAR;
  const annualIncome = corpLiquidCapitalToAnchor(incomeLocal, corporation, corpFxRate);
  const annualInterest = sumBondAnnualInterestAnchor(existingBonds, fxByCurrency);
  const penaltyActive = isBondDefaultCreditPenaltyActive(corporation, currentTurn);
  const creditResult = calculateCreditScore(
    liquidCapitalAnchor,
    existingDebt + relocationCostAnchor,
    annualIncome,
    annualInterest,
    totalEquity,
    { bondDefaultCreditPenaltyActive: penaltyActive }
  );
  const centralBank = centralBanks.find((bank) => bank.countryId === corporation.countryId);
  const primeRate =
    centralBank?.primeRate ?? getCountryConfig(corporation.countryId).centralBank.defaultPrimeRate;
  const couponRate = getBondCouponRate(
    primeRate,
    creditResult.rating,
    RELOCATION_BOND_MATURITY_TURNS
  );

  const withinLeverage =
    existingDebt + relocationCostAnchor <= totalEquity * MAX_BOND_ISSUANCE_FRACTION &&
    existingDebt + relocationCostAnchor <=
      exitEquityAnchor * MAX_BOND_ISSUANCE_EXIT_EQUITY_FRACTION;
  const ok = cooldownTurnsRemaining === null && withinLeverage;

  return {
    ok,
    cooldownTurnsRemaining,
    availableBondCapacity,
    creditRating: creditResult.rating,
    couponRate,
    existingDebt,
    totalEquity,
  };
}

export interface IssueRelocationBondResult {
  /** Actual bond face value in ₳ (post-unit rounding). */
  bondFaceValue: number;
  /** Actual bond face value in the corp's home currency (what `bond.totalIssued` stores). */
  bondFaceValueLocal: number;
  couponRate: number;
  creditRating: string;
  totalUnits: number;
}

/**
 * Insert the relocation bond. Caller is responsible for updating liquidCapital
 * with the netted delta (bondFaceValueLocal - relocationCostLocal) in corp currency.
 *
 * `relocationCostAnchor` is in ₳; the bond's `totalIssued` is stored in the
 * corp's home currency (Task-18B contract) and `currencyCode` is stamped.
 * Returns an error response on validation failure.
 */
export async function issueRelocationBond(
  db: Db,
  corporation: Corporation,
  relocationCostAnchor: number,
  currentTurn: number,
  preflight: RelocationBondPreflight,
  /** Pre-loaded FX map — reused when the caller already has one. Omit to load fresh. */
  fxByCurrencyOverride?: ReadonlyMap<CurrencyCode, number>
): Promise<{ ok: true; data: IssueRelocationBondResult } | { ok: false; response: Response }> {
  if (preflight.cooldownTurnsRemaining != null) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Bond issuance on cooldown. ${preflight.cooldownTurnsRemaining} turns remaining.`,
        },
        { status: 400 }
      ),
    };
  }
  if (!preflight.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          // #1198: capacity is now the lower of the two ceilings, so the
          // message reports the remaining capacity rather than naming a limit
          // that may not be the one that bound.
          error: `Bond issuance would exceed this corporation's debt capacity (the lower of ${MAX_BOND_ISSUANCE_FRACTION}x equity and what it could realize by selling up). Current debt: $${Math.round(
            preflight.existingDebt
          ).toLocaleString()}, remaining capacity: $${Math.round(
            preflight.availableBondCapacity
          ).toLocaleString()}.`,
        },
        { status: 400 }
      ),
    };
  }

  // Translate ₳ cost → LOCAL face value, round down to whole bond units, then
  // mirror back to ₳ for wire + response payload.
  const fxByCurrency = fxByCurrencyOverride ?? (await loadFxRatesByCurrency(db));
  const corpCurrencyCode = resolveCorpLiquidCurrencyCode(corporation);
  const corpFxRate = fxByCurrency.get(corpCurrencyCode ?? "USD") ?? 1;
  const relocationCostLocal = anchorToCorpCapital(
    relocationCostAnchor,
    corpCurrencyCode,
    corpFxRate
  );
  const totalUnits = Math.floor(relocationCostLocal / BOND_UNIT_FACE_VALUE);
  if (totalUnits <= 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Relocation cost too low for bond issuance" },
        { status: 400 }
      ),
    };
  }
  const actualFaceValueLocal = totalUnits * BOND_UNIT_FACE_VALUE;
  const actualFaceValueAnchor = corpLiquidCapitalToAnchor(
    actualFaceValueLocal,
    corporation,
    corpFxRate
  );

  const now = new Date();
  const bondDoc: Omit<Bond, "_id"> = {
    corporationId: corporation._id,
    faceValue: BOND_UNIT_FACE_VALUE,
    couponRate: preflight.couponRate!,
    maturityTurns: RELOCATION_BOND_MATURITY_TURNS,
    issuedAtTurn: currentTurn,
    maturityTurn: currentTurn + RELOCATION_BOND_MATURITY_TURNS,
    marketPrice: 1.0,
    totalIssued: actualFaceValueLocal,
    publicFloat: totalUnits,
    holders: [],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    restructureHaircutPercent: null,
    restructureExtendedMaturityTurn: null,
    originalMaturityTurn: null,
    originalTotalIssued: null,
    // Corporate bonds denominate in the issuing corp's home currency.
    currencyCode: corpCurrencyCode,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection("bonds").insertOne(bondDoc);

  return {
    ok: true,
    data: {
      bondFaceValue: actualFaceValueAnchor,
      bondFaceValueLocal: actualFaceValueLocal,
      couponRate: preflight.couponRate!,
      creditRating: preflight.creditRating!,
      totalUnits,
    },
  };
}

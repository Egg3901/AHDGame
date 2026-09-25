/**
 * Government debt and why it grows: sovereign bond issuance. Every 12 turns
 * (shouldIssueQuarterlySovereignBondSeries) a country running a deficit issues a
 * quarter of its annual deficit as bonds (calculateQuarterlyIssuanceAmount) at
 * prime plus a term premium (getSovereignCouponRate); maturing bonds roll over
 * (calculateSovereignRolloverAmount) and unsold units are monetized. The budget's
 * debt principal and debt interest line move with each issue.
 */
/**
 * Sovereign bond issuance + gov-budget accounting.
 *
 * **Currency (v0.2.6):** Sovereign bonds are issued in the country's currency
 * (stamped onto `Bond.currencyCode` via `resolveCountryCurrencyCode`, matching
 * the issuing federal budget's currency). Because `bondDoc.totalIssued`,
 * `annualCouponCost`, and `federalBudget.debt.principal` /
 * `spending.debtInterest` all live in the same country currency, the
 * `applySovereignDebtAdjustment` arithmetic here is same-currency — no FX is
 * needed on issuance.
 *
 * Cross-currency flows (a holder whose home currency differs from the bond's)
 * settle at coupon-payment time in the bond turn processor, not here.
 */
import { ObjectId, type Db } from "mongodb";
import type {
  Bond,
  BondMaturityTurns,
  CentralBank,
  CreditRating,
  Corporation,
  FederalBudget,
  GameConfig,
  GameState,
} from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  consolidateSovereignTranches,
  planSovereignTranches,
  SOVEREIGN_MIN_TRANCHE_UNITS,
} from "@/lib/bonds/sovereignIssueDiagnostics";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { getBankId } from "@/lib/centralBank/helpers";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import {
  calculateCreditRating,
  calculateInterestRate,
  getSovereignConfidencePremium,
} from "@/lib/budget/debt";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { sovereignCredibilitySpread } from "@/lib/centralBank/marketEffects";
import {
  debitPoolForPrimary,
  monetizeUnsoldSovereignUnits,
  planSovereignMonetization,
  planSovereignUnderwriting,
  readPoolForPrimary,
  recordSovereignPrimaryFill,
} from "@/lib/bonds/primaryMarket";
import { createNotifications } from "@/lib/notifications";
import {
  sovereignBondOutstanding,
  sumOutstandingSovereignPrincipal,
  sovereignDebtTerms,
} from "@/lib/bonds/sovereignPrincipal";
import { loadDemocraticHealth } from "@/lib/governanceStyle/loadDemocraticHealth";
import { democraticHealthSovereignSpread } from "@/lib/governanceStyle/rules/democraticConsequences";

export const SOVEREIGN_ISSUANCE_INTERVAL_TURNS = 12;
export const SOVEREIGN_BOND_MATURITY_TURNS: BondMaturityTurns = 48;

/**
 * Term premium (pp over prime rate) added to sovereign bond coupon for longer-dated paper.
 * Mirrors real-world yield-curve steepening: 1yr T-bills at par prime, 2yr notes +0.25pp,
 * 5yr bonds +0.75pp. Used by issuance and the admin auto-reconcile endpoint.
 */
export const SOVEREIGN_BOND_TERM_PREMIUMS: Partial<Record<BondMaturityTurns, number>> = {
  48: 0,
  96: 0.25,
  240: 0.75,
};

/**
 * Default stagger distribution for the admin auto-reconcile.
 * Values are fractional shares of the uncovered gap; they must sum to 1.
 * Includes 1yr (48t) paper — reconcile bonds are stamped `reconcile: true`
 * so the quarterly scheduler's dedup query (which excludes reconcile bonds)
 * never treats them as a reason to skip regular issuance.
 */
export const SOVEREIGN_RECONCILE_DISTRIBUTION: Partial<Record<BondMaturityTurns, number>> = {
  48: 0.25,
  96: 0.35,
  240: 0.4,
};

async function loadDemocraticSovereignSpread(db: Db, countryId: CountryId): Promise<number> {
  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
  const health = await loadDemocraticHealth(db, countryId, gameState);
  return health == null ? 0 : democraticHealthSovereignSpread(health);
}

/**
 * Effective sovereign coupon rate = primeRate + term premium for the given maturity,
 * plus any central-bank credibility spread (B4 market effects).
 * Rounds to 2 dp so stored rates stay human-readable.
 *
 * `credibilitySpreadPp` defaults to 0, so every caller that does not know the
 * issuing bank's scrutiny (seeds, admin tools) prices exactly as before.
 */
export function getSovereignCouponRate(
  primeRate: number,
  maturityTurns: BondMaturityTurns,
  credibilitySpreadPp = 0
): number {
  const termPremium = SOVEREIGN_BOND_TERM_PREMIUMS[maturityTurns] ?? 0;
  const spread = Number.isFinite(credibilitySpreadPp) ? Math.max(0, credibilitySpreadPp) : 0;
  return Math.round((primeRate + termPremium + spread) * 100) / 100;
}

export function isSovereignBond(bond: Pick<Bond, "issuerType">): boolean {
  return bond.issuerType === "sovereign";
}

export function isCorporateBond(bond: Pick<Bond, "issuerType">): boolean {
  return !isSovereignBond(bond);
}

export function getBondCountryId(bond: Pick<Bond, "issuerType" | "countryId">): CountryId {
  if (isSovereignBond(bond) && bond.countryId) {
    return bond.countryId;
  }

  return COUNTRY_CONFIGS.US.id;
}

export function getNationalBudgetId(countryId: CountryId): string {
  // The US federal budget uses the legacy "federal" document ID.
  // Every other country's national budget document uses its country code as _id.
  return countryId === COUNTRY_CONFIGS.US.id ? "federal" : countryId;
}

/**
 * Resolve the sovereign-bond issuer corporation for a country: the **primary**
 * National Corporation (spec §24.1). Prefers the `isPrimaryNationalCorporation`
 * flag; falls back to any `{ countryOwnerId }` for pre-backfill safety so a
 * country whose NatCorp hasn't been flagged yet still resolves its issuer.
 * Sorted on `_id` so a data bug carrying two flagged primaries (ticket #1254)
 * resolves deterministically — the same corp every caller in the turn sees.
 */
async function findPrimaryNationalCorporation(
  db: Db,
  countryId: CountryId
): Promise<Pick<Corporation, "_id" | "name"> | null> {
  const corps = db.collection<Corporation>("corporations");
  return (
    (await corps
      .find({ countryOwnerId: countryId, isPrimaryNationalCorporation: true })
      .sort({ _id: 1 })
      .limit(1)
      .next()) ?? (await corps.find({ countryOwnerId: countryId }).sort({ _id: 1 }).limit(1).next())
  );
}

/**
 * Infer countryId from a federalBudget document's _id.
 * - "federal" → US (historical naming, presidential system)
 * - Otherwise, the _id is the countryId directly (UK, JP, BR, etc.)
 */
function getCountryIdFromBudgetId(budgetId: string): CountryId {
  if (budgetId === "federal") return COUNTRY_CONFIGS.US.id;
  if (budgetId in COUNTRY_CONFIGS) return budgetId as CountryId;
  return COUNTRY_CONFIGS.US.id;
}

export function shouldIssueQuarterlySovereignBondSeries(turn: number): boolean {
  return turn > 0 && turn % SOVEREIGN_ISSUANCE_INTERVAL_TURNS === 0;
}

export function calculateQuarterlyIssuanceAmount(annualDeficit: number): number {
  if (annualDeficit <= 0) return 0;
  const quarterlyAmount = annualDeficit / 4;
  return Math.floor(quarterlyAmount / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
}

export function getSovereignIssuerName(countryId: CountryId): string {
  return COUNTRY_CONFIGS[countryId].name;
}

export function getBondIssuerDisplayName(
  bond: Pick<Bond, "issuerType" | "issuerName" | "countryId">,
  fallbackName?: string
): string {
  if (isSovereignBond(bond)) {
    if (bond.issuerName) return bond.issuerName;
    if (bond.countryId) return getSovereignIssuerName(bond.countryId);
  }

  return fallbackName ?? bond.issuerName ?? "Unknown Issuer";
}

export interface SovereignBondIssueResult {
  countryId: CountryId;
  issueAmount: number;
  couponRate: number;
  bondId: ObjectId;
  newPrincipal: number;
  newDebtInterest: number;
  newSurplus: number;
}

export function applySovereignDebtAdjustment(
  budget: FederalBudget,
  principalDelta: number,
  annualInterestDelta: number
): Pick<FederalBudget, "debt" | "spending" | "surplus" | "debtToGdpRatio" | "creditRating"> {
  const newPrincipal = Math.max(0, budget.debt.principal + principalDelta);
  const newDebtInterest = Math.max(0, budget.spending.debtInterest + annualInterestDelta);
  const newSpendingTotal = Math.max(0, budget.spending.total + annualInterestDelta);
  const newSurplus = budget.revenue.total - newSpendingTotal;
  // Read the EMA-smoothed national GDP (design §5.4 / §6.1) so a one-year GDP
  // swing — now that state.gdp moves every turn (P1c) — can't trip the
  // sovereign-default threshold. Falls back to raw gdp for cutover safety.
  const ratioGdp = budget.gdpSmoothed && budget.gdpSmoothed > 0 ? budget.gdpSmoothed : budget.gdp;
  const debtToGdpRatio = ratioGdp > 0 ? newPrincipal / ratioGdp : 0;
  const creditRating: CreditRating = calculateCreditRating(
    debtToGdpRatio,
    budget.sovereignRiskAnchor
  );
  // Low investor confidence adds a sovereign risk premium (spec §12.4 feed 2).
  const interestRate =
    calculateInterestRate(
      debtToGdpRatio,
      budget.imfSovereignBailoutActive,
      budget.sovereignRiskAnchor
    ) + getSovereignConfidencePremium(budget.investorConfidence);

  return {
    debt: {
      ...budget.debt,
      principal: newPrincipal,
      interestRate,
    },
    spending: {
      ...budget.spending,
      debtInterest: newDebtInterest,
      total: newSpendingTotal,
    },
    surplus: newSurplus,
    debtToGdpRatio,
    creditRating,
  };
}

function buildSovereignBondDoc(params: {
  countryId: CountryId;
  turn: number;
  now: Date;
  issueAmount: number;
  maturityTurns: BondMaturityTurns;
  primeRate: number;
  countryCorporation: Pick<Corporation, "_id" | "name"> | null;
  /** B4: percentage points of credibility spread. 0 for a clean or absent bank. */
  credibilitySpreadPp?: number;
  /** Democratic backsliding premium in percentage points. */
  democraticSpreadPp?: number;
  /**
   * Explicit home currency (usually the budget's `currencyCode`). Preferred
   * over the era-blind map fallback, so 2027 euro members issue in EUR.
   */
  currencyCode?: CurrencyCode | string | null;
}): { bondDoc: Omit<Bond, "_id">; annualCouponCost: number } {
  const { countryId, turn, now, issueAmount, maturityTurns, primeRate, countryCorporation } =
    params;
  const normalizedIssueAmount =
    Math.floor(issueAmount / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
  const totalUnits = Math.floor(normalizedIssueAmount / BOND_UNIT_FACE_VALUE);
  const couponRate = getSovereignCouponRate(
    primeRate,
    maturityTurns,
    (params.credibilitySpreadPp ?? 0) + (params.democraticSpreadPp ?? 0)
  );

  const bondDoc: Omit<Bond, "_id"> = {
    issuerType: "sovereign",
    corporationId: countryCorporation?._id ?? new ObjectId(),
    countryId,
    issuerName: countryCorporation?.name ?? getSovereignIssuerName(countryId),
    faceValue: BOND_UNIT_FACE_VALUE,
    couponRate,
    maturityTurns,
    issuedAtTurn: turn,
    maturityTurn: turn + maturityTurns,
    marketPrice: 1.0,
    totalIssued: normalizedIssueAmount,
    publicFloat: totalUnits,
    holders: [],
    defaulted: false,
    defaultedAtTurn: null,
    matured: false,
    // Sovereign-default audit fields — set null at creation so the
    // sovereignDefaultPhase1Bonds migration doesn't need to backfill them.
    restructureHaircutPercent: null,
    restructureExtendedMaturityTurn: null,
    originalMaturityTurn: null,
    originalTotalIssued: null,
    // Sovereign bonds denominate in the issuing country's currency: the
    // caller's explicit code (the budget row) wins, the era-blind map is
    // only the fallback for callers without a budget in hand.
    currencyCode: resolveCountryCurrencyCode({ countryId, currencyCode: params.currencyCode }),
    createdAt: now,
    updatedAt: now,
  };

  const annualCouponCost = (couponRate / 100) * bondDoc.totalIssued;
  return { bondDoc, annualCouponCost };
}

async function issueSovereignBondSeries(
  db: Db,
  params: {
    countryId: CountryId;
    turn: number;
    now: Date;
    issueAmount: number;
    maturityTurns?: BondMaturityTurns;
  }
): Promise<SovereignBondIssueResult | null> {
  const { countryId, turn, now, issueAmount } = params;
  const maturityTurns = params.maturityTurns ?? SOVEREIGN_BOND_MATURITY_TURNS;
  if (issueAmount < BOND_UNIT_FACE_VALUE) return null;

  const budgetId = getNationalBudgetId(countryId);
  const [budget, centralBank, countryCorporation, democraticSpreadPp] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
    db
      .collection<CentralBank>("centralBanks")
      .findOne({ _id: getBankId(countryId) }, { projection: { primeRate: 1, chairInfamy: 1 } }),
    findPrimaryNationalCorporation(db, countryId),
    loadDemocraticSovereignSpread(db, countryId),
  ]);
  if (!budget) return null;

  const normalizedIssueAmount =
    Math.floor(issueAmount / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
  if (normalizedIssueAmount < BOND_UNIT_FACE_VALUE) return null;

  const primeRate =
    centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;

  const { bondDoc, annualCouponCost } = buildSovereignBondDoc({
    countryId,
    turn,
    now,
    issueAmount: normalizedIssueAmount,
    maturityTurns,
    primeRate,
    countryCorporation,
    currencyCode: budget.currencyCode,
    // B4: a discredited central bank makes its government borrow dearer. No
    // bank document means no scrutiny to read, so the spread is 0, not a guess.
    credibilitySpreadPp: centralBank ? sovereignCredibilitySpread(centralBank.chairInfamy ?? 0) : 0,
    democraticSpreadPp,
  });

  const budgetUpdate = applySovereignDebtAdjustment(budget, bondDoc.totalIssued, annualCouponCost);

  const insertResult = await db.collection<Omit<Bond, "_id">>("bonds").insertOne(bondDoc);
  await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: budgetId },
    {
      $set: {
        debt: budgetUpdate.debt,
        spending: budgetUpdate.spending,
        surplus: budgetUpdate.surplus,
        debtToGdpRatio: budgetUpdate.debtToGdpRatio,
        creditRating: budgetUpdate.creditRating,
        updatedAt: now,
      },
    }
  );

  return {
    countryId,
    issueAmount: bondDoc.totalIssued,
    couponRate: bondDoc.couponRate,
    bondId: insertResult.insertedId,
    newPrincipal: budgetUpdate.debt.principal,
    newDebtInterest: budgetUpdate.spending.debtInterest,
    newSurplus: budgetUpdate.surplus,
  };
}

export async function issueAdminSovereignBondSeries(
  db: Db,
  params: {
    countryId: CountryId;
    turn: number;
    now: Date;
    faceValue?: number;
    maturityTurns?: BondMaturityTurns;
    useQuarterDeficit?: boolean;
  }
): Promise<SovereignBondIssueResult | null> {
  const { countryId, turn, now, faceValue, maturityTurns, useQuarterDeficit = true } = params;
  let issueAmount = faceValue ?? 0;

  if (issueAmount <= 0 && useQuarterDeficit) {
    const budgetId = getNationalBudgetId(countryId);
    const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
    if (!budget) return null;
    // Derived, not read. `surplus` is a cache of `revenue.total - spending.total`
    // that drifts intra-turn through every writer's read-modify-write, and this runs
    // inside the turn, before the end-of-turn reconciliation lands. Reading the cache
    // here sized a quarter's sovereign issuance off a stale deficit.
    issueAmount = calculateQuarterlyIssuanceAmount(Math.max(0, -federalSurplus(budget)));
  }

  return issueSovereignBondSeries(db, { countryId, turn, now, issueAmount, maturityTurns });
}

/**
 * Sum the totalIssued of active sovereign bonds for `countryId` that will mature
 * during the upcoming issuance interval (`[turn, turn + SOVEREIGN_ISSUANCE_INTERVAL_TURNS)`).
 *
 * Used to roll over maturing debt so the bond market never drains to zero when a
 * country runs a surplus. Without this, surplus countries stop issuing entirely
 * and existing bonds progressively mature out of the public float.
 */
export async function calculateSovereignRolloverAmount(
  db: Db,
  countryId: CountryId,
  turn: number
): Promise<number> {
  const activeBonds = await db
    .collection<Bond>("bonds")
    .find({
      issuerType: "sovereign",
      countryId,
      matured: false,
      defaulted: false,
    })
    .toArray();
  const maturingSoon = activeBonds.filter(
    (bond) =>
      bond.maturityTurn >= turn && bond.maturityTurn < turn + SOVEREIGN_ISSUANCE_INTERVAL_TURNS
  );

  const maturingFace = maturingSoon.reduce((sum, bond) => sum + (bond.totalIssued ?? 0), 0);
  const activeFace = activeBonds.reduce((sum, bond) => sum + (bond.totalIssued ?? 0), 0);

  // Rollover refinances debt that still exists. A country that has paid its
  // debt down (or never owed it) must not keep reissuing paper just because an
  // old series is maturing: FR carried 4.2T FRF of bonds against a principal of
  // zero that way, and with a real market pool that paper would have drawn
  // coupons from nothing. Cap the rollover so bonds outstanding after this
  // quarter never exceed the budget's principal. A missing budget keeps the
  // old behaviour (roll everything) so seeds and tests without one still work.
  const budget = await db
    .collection<Pick<FederalBudget, "_id" | "debt">>("federalBudget")
    .findOne({ _id: getNationalBudgetId(countryId) }, { projection: { debt: 1 } });
  const principal = budget?.debt?.principal;
  const rollover =
    typeof principal === "number" && Number.isFinite(principal)
      ? Math.min(maturingFace, Math.max(0, principal - (activeFace - maturingFace)))
      : maturingFace;
  return Math.floor(rollover / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
}

export async function issueScheduledSovereignBondSeries(
  db: Db,
  turn: number,
  now: Date
): Promise<number> {
  if (!shouldIssueQuarterlySovereignBondSeries(turn)) {
    return 0;
  }

  // One read per scheduled quarter: the #1001 tranche-consolidation dark
  // gate. Absent or false keeps the historical ladder exactly as issued.
  const issuanceGate = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { sovereignIssuanceConsolidationEnabled: 1 } });
  const consolidationEnabled = issuanceGate?.sovereignIssuanceConsolidationEnabled === true;

  // Registered, not the raw static list: a country dissolved by a merge keeps
  // its budget doc, and the scheduler would otherwise keep rolling its debt
  // over — issuing fresh paper for a state that no longer exists.
  const configuredCountries: CountryId[] = await getRegisteredCountryIds(db);
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({
      _id: { $in: configuredCountries.map((countryId) => getNationalBudgetId(countryId)) },
    })
    .toArray();

  const budgetByCountry = new Map<CountryId, FederalBudget>();
  for (const budget of budgets) {
    const countryId =
      typeof budget.countryId === "string" && budget.countryId in COUNTRY_CONFIGS
        ? (budget.countryId as CountryId)
        : getCountryIdFromBudgetId(budget._id);
    budgetByCountry.set(countryId, budget);
  }

  let issuancesCreated = 0;
  const sovereignCountries = configuredCountries.filter((countryId) =>
    budgetByCountry.has(countryId)
  );
  for (const countryId of sovereignCountries) {
    const budget = budgetByCountry.get(countryId);
    if (!budget) continue;

    // Derived, not read: `surplus` is a cache of `revenue.total - spending.total`
    // that drifts intra-turn through every writer's read-modify-write (same
    // reason the admin issuance path uses federalSurplus, above). Sizing a
    // quarter's sovereign issuance off the stale cache issues the wrong face.
    const annualDeficit = Math.max(0, -federalSurplus(budget));
    const deficitAmount = calculateQuarterlyIssuanceAmount(annualDeficit);
    // Always roll over bonds maturing in the next quarter on top of any deficit-
    // driven issuance. Mirrors real-world Treasury behavior: maturing principal
    // is refinanced by new issuance, so bond market supply stays stable even
    // when the budget is in surplus. Without rollover, surplus countries would
    // see their bond float drain to zero as existing issues mature.
    const rolloverAmount = await calculateSovereignRolloverAmount(db, countryId, turn);
    const issueAmount = deficitAmount + rolloverAmount;
    if (issueAmount < BOND_UNIT_FACE_VALUE) continue;

    // Exclude reconcile-flagged bonds: the admin reconcile endpoint may issue
    // 1yr (48t) tranches at any turn (stamped reconcile:true). Without this
    // guard the scheduler would see them and skip, silently dropping regular
    // deficit/rollover issuance for that quarter.
    // Also guard against ANY non-reconcile sovereign bond issued this turn,
    // since staggered issuance may issue multiple maturities in one turn.
    const existingSeries = await db.collection<Bond>("bonds").findOne({
      issuerType: "sovereign",
      countryId,
      issuedAtTurn: turn,
      reconcile: { $ne: true },
    });
    if (existingSeries) continue;

    const budgetId = getNationalBudgetId(countryId);
    const [budgetDoc, centralBank, countryCorporation, democraticSpreadPp] = await Promise.all([
      db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
      db
        .collection<CentralBank>("centralBanks")
        .findOne({ _id: getBankId(countryId) }, { projection: { primeRate: 1, chairInfamy: 1 } }),
      findPrimaryNationalCorporation(db, countryId),
      loadDemocraticSovereignSpread(db, countryId),
    ]);
    if (!budgetDoc) continue;

    const primeRate =
      centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
    const distribution = budgetDoc.sovereignBondProfile ?? SOVEREIGN_RECONCILE_DISTRIBUTION;

    let totalIssued = 0;
    let totalAnnualCouponCost = 0;
    const bondDocs: Omit<Bond, "_id">[] = [];

    // Primary market: the currency's pool underwrites each tranche at par with
    // the cash it has and the appetite the demand model gives this issuer.
    // No pool for the currency (seeds, pre-migration) keeps full placement.
    const poolCurrency: CurrencyCode =
      resolveCountryCurrencyCode({ countryId, currencyCode: budgetDoc.currencyCode }) ??
      COUNTRY_CURRENCY_MAP[countryId] ??
      "USD";
    const pool = await readPoolForPrimary(db, poolCurrency);
    let poolCashRemaining = pool ? Math.max(0, pool.cashLocal) : Number.POSITIVE_INFINITY;
    const appetite = pool?.appetiteByCountry?.[countryId];
    let requestedUnitsTotal = 0;
    let placedUnitsTotal = 0;

    // Plan the ladder first so the gated consolidation (#1001) reshapes rungs
    // before pool underwriting sees them. Gate off: the same rungs, same order.
    const tranchePlans = consolidateSovereignTranches(
      planSovereignTranches(distribution, issueAmount),
      consolidationEnabled ? SOVEREIGN_MIN_TRANCHE_UNITS : 0
    );
    for (const tranche of tranchePlans) {
      const maturityTurns = tranche.maturityTurns;
      const trancheAmount = tranche.amount;

      const { bondDoc } = buildSovereignBondDoc({
        countryId,
        currencyCode: poolCurrency,
        turn,
        now,
        issueAmount: trancheAmount,
        maturityTurns,
        primeRate,
        countryCorporation,
        democraticSpreadPp,
      });
      const requestedUnits = Math.floor(bondDoc.totalIssued / BOND_UNIT_FACE_VALUE);
      let placedUnits = requestedUnits;
      if (pool) {
        const plan = planSovereignUnderwriting({
          requestedUnits,
          poolCashLocal: poolCashRemaining,
          appetite,
          pricePerUnitLocal: BOND_UNIT_FACE_VALUE,
        });
        placedUnits = plan.placedUnits;
        if (placedUnits > 0) {
          const paid = await debitPoolForPrimary(
            db,
            poolCurrency,
            placedUnits,
            BOND_UNIT_FACE_VALUE,
            now
          );
          if (paid <= 0) placedUnits = 0;
          poolCashRemaining = Math.max(0, poolCashRemaining - paid);
        }
      }
      bondDoc.totalIssued = placedUnits * BOND_UNIT_FACE_VALUE;
      bondDoc.publicFloat = placedUnits;
      bondDoc.requestedUnits = requestedUnits;
      bondDoc.unsoldUnits = requestedUnits - placedUnits;
      bondDoc.primaryFillRatio = requestedUnits > 0 ? placedUnits / requestedUnits : 1;
      requestedUnitsTotal += requestedUnits;
      placedUnitsTotal += placedUnits;

      bondDocs.push(bondDoc);
      totalIssued += bondDoc.totalIssued;
      totalAnnualCouponCost += (bondDoc.couponRate / 100) * bondDoc.totalIssued;
      issuancesCreated++;
    }

    if (bondDocs.length > 0) {
      const inserted = await db.collection<Omit<Bond, "_id">>("bonds").insertMany(bondDocs);
      if (pool) {
        const fillRatio = requestedUnitsTotal > 0 ? placedUnitsTotal / requestedUnitsTotal : 1;
        await recordSovereignPrimaryFill(db, budgetId, fillRatio, turn, now);
        const unsoldTotal = requestedUnitsTotal - placedUnitsTotal;
        if (unsoldTotal > 0) {
          const monetized = await handleSovereignShortfall(db, {
            countryId,
            centralBank,
            budget: budgetDoc,
            bondDocs,
            insertedIds: Object.values(inserted.insertedIds),
            unsoldTotal,
            requestedTotal: requestedUnitsTotal,
            turn,
            now,
          });
          totalIssued += monetized.face;
          totalAnnualCouponCost += monetized.annualCoupon;
        }
      }

      const budgetUpdate = applySovereignDebtAdjustment(
        budgetDoc,
        totalIssued,
        totalAnnualCouponCost
      );
      await db.collection<FederalBudget>("federalBudget").updateOne(
        { _id: budgetId },
        {
          $set: {
            debt: budgetUpdate.debt,
            spending: budgetUpdate.spending,
            surplus: budgetUpdate.surplus,
            debtToGdpRatio: budgetUpdate.debtToGdpRatio,
            creditRating: budgetUpdate.creditRating,
            updatedAt: now,
          },
        }
      );
    }
  }

  return issuancesCreated;
}

export interface SovereignReconcileTranche {
  maturityTurns: BondMaturityTurns;
  issueAmount: number;
  couponRate: number;
  bondId: ObjectId;
  annualCouponCost: number;
}

export interface SovereignReconcileResult {
  countryId: CountryId;
  /** Debt principal already covered by active sovereign bonds before this run. */
  coveredByExistingBonds: number;
  /** Gap between budget debt.principal and bond coverage (what was available to issue). */
  gap: number;
  /** Tranches issued across staggered maturities. Empty if gap was zero. */
  tranches: SovereignReconcileTranche[];
  totalIssued: number;
  /** Increase in annual coupon service added to spending.debtInterest. */
  budgetInterestDelta: number;
  newPrincipal: number;
  newDebtInterest: number;
  newSurplus: number;
  newDebtToGdpRatio: number;
  newCreditRating: string;
}

/**
 * Converts unrepresented sovereign debt principal into tradeable bond series,
 * spread across staggered maturities with term-premium yields.
 *
 * The gap = budget.debt.principal minus the haircut-adjusted outstanding
 * sovereign stock (see sovereignPrincipal.ts). Each tranche in `distribution`
 * (defaults to SOVEREIGN_RECONCILE_DISTRIBUTION) receives its share of the
 * gap at getSovereignCouponRate(primeRate, maturity).
 *
 * **Budget impact:** the new tranches add genuine annual coupon service, so
 * spending.debtInterest rises by the new coupons. debt.principal is
 * RE-POINTED at the canonical post-write ledger (pre-existing outstanding
 * plus the face just issued), never incremented by the gap: the gap was
 * already inside the stored principal, so old principal + gap would count
 * the same debt twice (#1975). debtToGdpRatio / creditRating are refreshed
 * off the re-pointed stock.
 *
 * Retry-safe: the principal write is a pure function of the ledger read
 * back, so a crash between the bond inserts and the budget update converges
 * on retry (the inserted tranches are already in the ledger, the gap reads
 * as zero, nothing issues twice, and the stock still lands on the ledger).
 */
export async function reconcileSovereignDebt(
  db: Db,
  params: {
    countryId: CountryId;
    turn: number;
    now: Date;
    distribution?: Partial<Record<BondMaturityTurns, number>>;
  }
): Promise<SovereignReconcileResult | null> {
  const { countryId, turn, now } = params;
  const distribution = params.distribution ?? SOVEREIGN_RECONCILE_DISTRIBUTION;

  const budgetId = getNationalBudgetId(countryId);
  const [budget, centralBank, countryCorporation, democraticSpreadPp] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
    db
      .collection<CentralBank>("centralBanks")
      .findOne({ _id: getBankId(countryId) }, { projection: { primeRate: 1, chairInfamy: 1 } }),
    findPrimaryNationalCorporation(db, countryId),
    loadDemocraticSovereignSpread(db, countryId),
  ]);
  if (!budget) return null;

  const primeRate =
    centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
  // B4 credibility spread, same rule as scheduled issuance: no bank, no spread.
  const credibilitySpreadPp = centralBank
    ? sovereignCredibilitySpread(centralBank.chairInfamy ?? 0)
    : 0;

  // Canonical outstanding stock: active non-defaulted face minus any
  // restructure haircuts (a haircut bond contributes its written-down stock).
  const activeBonds = await db
    .collection<Bond>("bonds")
    .find({ issuerType: "sovereign", countryId, matured: false, defaulted: false })
    .toArray();
  const coveredByExistingBonds = sumOutstandingSovereignPrincipal(activeBonds);

  const storedPrincipal = Math.max(0, budget.debt.principal ?? 0);
  const rawGap = storedPrincipal - coveredByExistingBonds;
  const gap = Math.floor(Math.max(0, rawGap) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;

  const tranches: SovereignReconcileTranche[] = [];
  let totalIssued = 0;
  let totalInterestDelta = 0;

  if (gap >= BOND_UNIT_FACE_VALUE) {
    const corporationId = countryCorporation?._id ?? new ObjectId();
    const issuerName = countryCorporation?.name ?? getSovereignIssuerName(countryId);
    const currencyCode = resolveCountryCurrencyCode({
      countryId,
      currencyCode: budget.currencyCode,
    });

    for (const [maturityStr, fraction] of Object.entries(distribution)) {
      if (!fraction || fraction <= 0) continue;
      const maturityTurns = Number(maturityStr) as BondMaturityTurns;
      const trancheAmount =
        Math.floor((gap * fraction) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
      if (trancheAmount < BOND_UNIT_FACE_VALUE) continue;

      const totalUnits = Math.floor(trancheAmount / BOND_UNIT_FACE_VALUE);
      const couponRate = getSovereignCouponRate(
        primeRate,
        maturityTurns,
        credibilitySpreadPp + democraticSpreadPp
      );
      const annualCouponCost = (couponRate / 100) * trancheAmount;

      const bondDoc: Omit<Bond, "_id"> = {
        issuerType: "sovereign",
        corporationId,
        countryId,
        issuerName,
        faceValue: BOND_UNIT_FACE_VALUE,
        couponRate,
        maturityTurns,
        issuedAtTurn: turn,
        maturityTurn: turn + maturityTurns,
        marketPrice: 1.0,
        totalIssued: trancheAmount,
        publicFloat: totalUnits,
        holders: [],
        defaulted: false,
        defaultedAtTurn: null,
        matured: false,
        // Sovereign-default audit fields — set null at creation so the
        // sovereignDefaultPhase1Bonds migration doesn't need to backfill them.
        restructureHaircutPercent: null,
        restructureExtendedMaturityTurn: null,
        originalMaturityTurn: null,
        originalTotalIssued: null,
        // Marks this as an admin-reconcile bond so the quarterly scheduler's
        // dedup query never mistakes it for a regular scheduled issuance.
        reconcile: true,
        currencyCode,
        createdAt: now,
        updatedAt: now,
      };

      const insertResult = await db.collection<Omit<Bond, "_id">>("bonds").insertOne(bondDoc);
      tranches.push({
        maturityTurns,
        issueAmount: trancheAmount,
        couponRate,
        bondId: insertResult.insertedId,
        annualCouponCost,
      });
      totalIssued += trancheAmount;
      totalInterestDelta += annualCouponCost;
    }
  }

  // Re-point principal at the post-write ledger. New tranches carry no
  // haircut, so their face adds to the outstanding stock in full. This must
  // NOT be old principal + gap: the gap was already inside the stored
  // principal, and adding it again double-counts the same debt (#1975).
  // Interest is a flow, not a stock, so it still rises incrementally by the
  // genuine new coupon service. The write lands whenever the stock moved or
  // drifted, so a crash/retry replay that issued nothing still converges the
  // stored value onto the ledger.
  const postWriteOutstanding = coveredByExistingBonds + totalIssued;
  const newPrincipal = Math.round(postWriteOutstanding);
  const newDebtInterest = Math.max(0, (budget.spending?.debtInterest ?? 0) + totalInterestDelta);
  const newSpendingTotal = Math.max(0, (budget.spending?.total ?? 0) + totalInterestDelta);
  const newSurplus = (budget.revenue?.total ?? 0) - newSpendingTotal;
  const terms = sovereignDebtTerms(newPrincipal, {
    gdp: budget.gdp ?? 0,
    gdpSmoothed: budget.gdpSmoothed,
    investorConfidence: budget.investorConfidence,
    imfBailoutActive: budget.imfSovereignBailoutActive,
    sovereignRiskAnchor: budget.sovereignRiskAnchor,
  });
  if (totalIssued > 0 || newPrincipal !== Math.round(storedPrincipal)) {
    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: budgetId },
      {
        $set: {
          debt: { ...budget.debt, principal: newPrincipal, interestRate: terms.interestRate },
          spending: {
            ...budget.spending,
            debtInterest: newDebtInterest,
            total: newSpendingTotal,
          },
          surplus: newSurplus,
          debtToGdpRatio: terms.debtToGdpRatio,
          creditRating: terms.creditRating,
          updatedAt: now,
        },
      }
    );
  }

  return {
    countryId,
    coveredByExistingBonds,
    gap,
    tranches,
    totalIssued,
    budgetInterestDelta: totalInterestDelta,
    newPrincipal,
    newDebtInterest,
    newSurplus,
    newDebtToGdpRatio: terms.debtToGdpRatio,
    newCreditRating: terms.creditRating,
  };
}

export async function settleSovereignBondMaturity(
  db: Db,
  bond: Pick<Bond, "countryId" | "couponRate" | "totalIssued" | "restructureHaircutPercent">
): Promise<void> {
  if (!bond.countryId) return;
  const budgetId = getNationalBudgetId(bond.countryId);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return;

  // Net exactly this bond's outstanding contribution (face minus any restructure
  // haircut, see sovereignPrincipal.ts), not raw face: a haircut bond carries
  // only its written-down stock on the books, so redeeming full face would push
  // principal below the remaining outstanding sum (#1975).
  const maturedFace = sovereignBondOutstanding({
    issuerType: "sovereign",
    matured: false,
    defaulted: false,
    totalIssued: bond.totalIssued,
    restructureHaircutPercent: bond.restructureHaircutPercent ?? null,
  });
  const annualCouponCost = (bond.couponRate / 100) * bond.totalIssued;
  const budgetUpdate = applySovereignDebtAdjustment(budget, -maturedFace, -annualCouponCost);

  await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: budgetId },
    {
      $set: {
        debt: budgetUpdate.debt,
        spending: budgetUpdate.spending,
        surplus: budgetUpdate.surplus,
        debtToGdpRatio: budgetUpdate.debtToGdpRatio,
        creditRating: budgetUpdate.creditRating,
        updatedAt: new Date(),
      },
    }
  );
}

export interface SovereignPrincipalResync {
  countryId: CountryId;
  stored: number;
  outstanding: number;
  corrected: boolean;
}

/**
 * Re-point a country's stored `debt.principal` at its authoritative outstanding
 * bond stock (see sovereignPrincipal.ts) and refresh the debt-service terms off
 * that stock. Treasury cash is deliberately untouched: a haircut, repudiation,
 * or merge writes down obligations, never cash (#1975).
 *
 * Idempotent: a pure function of the bonds read, so crash/retry replay and the
 * end-of-turn hygiene pass converge to the same value.
 */
export async function resyncSovereignPrincipalFromBonds(
  db: Db,
  countryId: CountryId
): Promise<SovereignPrincipalResync | null> {
  const budgetId = getNationalBudgetId(countryId);
  const [budget, bonds] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
    db
      .collection<Bond>("bonds")
      .find(
        { issuerType: "sovereign", countryId, matured: false, defaulted: false },
        // The outstanding sum re-checks the query-filtered fields, so they
        // must be projected: a doc arriving without `issuerType` reads as
        // non-sovereign and contributes 0, which would re-point the stored
        // principal at zero (refs #1975).
        {
          projection: {
            issuerType: 1,
            matured: 1,
            defaulted: 1,
            totalIssued: 1,
            restructureHaircutPercent: 1,
          },
        }
      )
      .toArray(),
  ]);
  if (!budget || !budget.debt) return null;
  const outstanding = Math.round(sumOutstandingSovereignPrincipal(bonds));
  const stored = budget.debt.principal ?? 0;
  const terms = sovereignDebtTerms(outstanding, {
    gdp: budget.gdp ?? 0,
    gdpSmoothed: budget.gdpSmoothed,
    investorConfidence: budget.investorConfidence,
    imfBailoutActive: budget.imfSovereignBailoutActive,
    sovereignRiskAnchor: budget.sovereignRiskAnchor,
  });
  await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: budgetId },
    {
      $set: {
        "debt.principal": outstanding,
        "debt.interestRate": terms.interestRate,
        debtToGdpRatio: terms.debtToGdpRatio,
        creditRating: terms.creditRating,
        updatedAt: new Date(),
      },
    }
  );
  return { countryId, stored, outstanding, corrected: stored !== outstanding };
}

/**
 * What happens to the part of a quarterly auction the pool would not take.
 * An autonomous chair (`chairMode: "npp"`) monetizes up to a share of GDP at
 * par: the bank books the units, deposits are created as under QE, and the
 * paper becomes real debt. A player-run bank is told and left to decide; the
 * units keep placing turn by turn as the pool's cash allows either way.
 * Returns the face and annual coupon the monetization added to the debt.
 */
async function handleSovereignShortfall(
  db: Db,
  args: {
    countryId: CountryId;
    centralBank: CentralBank | null;
    budget: FederalBudget;
    bondDocs: Omit<Bond, "_id">[];
    insertedIds: ObjectId[];
    unsoldTotal: number;
    requestedTotal: number;
    turn: number;
    now: Date;
  }
): Promise<{ face: number; annualCoupon: number }> {
  const bank = args.centralBank;
  let face = 0;
  let annualCoupon = 0;
  if (bank?.chairMode === "npp" && bank.chairControlsLocked !== true) {
    let gdpBudget = planSovereignMonetization({
      unsoldUnits: args.unsoldTotal,
      gdpLocal:
        args.budget.gdpSmoothed && args.budget.gdpSmoothed > 0
          ? args.budget.gdpSmoothed
          : (args.budget.gdp ?? 0),
      pricePerUnitLocal: BOND_UNIT_FACE_VALUE,
    }).units;
    for (let index = 0; index < args.bondDocs.length && gdpBudget > 0; index++) {
      const doc = args.bondDocs[index]!;
      const bondId = args.insertedIds[index];
      const unsold = doc.unsoldUnits ?? 0;
      if (!bondId || unsold <= 0) continue;
      const units = Math.min(unsold, gdpBudget);
      const ok = await monetizeUnsoldSovereignUnits(db, {
        bondId,
        bank,
        units,
        considerationLocal: units * BOND_UNIT_FACE_VALUE,
        turn: args.turn,
        now: args.now,
      });
      if (!ok) continue;
      gdpBudget -= units;
      face += units * BOND_UNIT_FACE_VALUE;
      annualCoupon += (doc.couponRate / 100) * units * BOND_UNIT_FACE_VALUE;
    }
    return { face, annualCoupon };
  }

  if (bank?.chairCharacterId) {
    const chair = await db
      .collection<{ _id: ObjectId; userId?: ObjectId }>("characters")
      .findOne({ _id: bank.chairCharacterId }, { projection: { userId: 1 } });
    if (chair?.userId) {
      const pct = Math.round((1 - args.unsoldTotal / Math.max(1, args.requestedTotal)) * 100);
      await createNotifications([
        {
          userId: chair.userId,
          type: "cb_auction_shortfall",
          title: "Bond auction undersubscribed",
          message: `${getSovereignIssuerName(args.countryId)}: the market took ${pct}% of this quarter's issue. ${args.unsoldTotal.toLocaleString("en-US")} units are unplaced. They will place as the market finds cash; the bank can buy the float to support demand.`,
          metadata: {
            countryId: args.countryId,
            turn: args.turn,
            unsoldUnits: args.unsoldTotal,
            requestedUnits: args.requestedTotal,
          },
        },
      ]);
    }
  }
  return { face, annualCoupon };
}

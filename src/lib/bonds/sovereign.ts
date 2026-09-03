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
} from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getRegisteredCountryIds } from "@/lib/country/registeredCountries";
import { getBankId } from "@/lib/centralBank/helpers";
import {
  calculateCreditRating,
  calculateInterestRate,
  getSovereignConfidencePremium,
} from "@/lib/budget/debt";
import { resolveCountryCurrencyCode } from "@/lib/currency/govBudgetFields";
import { sovereignCredibilitySpread } from "@/lib/centralBank/marketEffects";

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
 */
async function findPrimaryNationalCorporation(
  db: Db,
  countryId: CountryId
): Promise<Pick<Corporation, "_id" | "name"> | null> {
  const corps = db.collection<Corporation>("corporations");
  return (
    (await corps.findOne({ countryOwnerId: countryId, isPrimaryNationalCorporation: true })) ??
    (await corps.findOne({ countryOwnerId: countryId }))
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
}): { bondDoc: Omit<Bond, "_id">; annualCouponCost: number } {
  const { countryId, turn, now, issueAmount, maturityTurns, primeRate, countryCorporation } =
    params;
  const normalizedIssueAmount =
    Math.floor(issueAmount / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
  const totalUnits = Math.floor(normalizedIssueAmount / BOND_UNIT_FACE_VALUE);
  const couponRate = getSovereignCouponRate(
    primeRate,
    maturityTurns,
    params.credibilitySpreadPp ?? 0
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
    // Sovereign bonds denominate in the issuing country's currency.
    currencyCode: resolveCountryCurrencyCode({ countryId }),
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
  const [budget, centralBank, countryCorporation] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
    db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId(countryId) }),
    findPrimaryNationalCorporation(db, countryId),
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
    // B4: a discredited central bank makes its government borrow dearer. No
    // bank document means no scrutiny to read, so the spread is 0, not a guess.
    credibilitySpreadPp: centralBank ? sovereignCredibilitySpread(centralBank.chairInfamy ?? 0) : 0,
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
    issueAmount = calculateQuarterlyIssuanceAmount(Math.max(0, -(budget.surplus ?? 0)));
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

    const annualDeficit = Math.max(0, -(budget.surplus ?? 0));
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
    const [budgetDoc, centralBank, countryCorporation] = await Promise.all([
      db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
      db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId(countryId) }),
      findPrimaryNationalCorporation(db, countryId),
    ]);
    if (!budgetDoc) continue;

    const primeRate =
      centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
    const distribution = budgetDoc.sovereignBondProfile ?? SOVEREIGN_RECONCILE_DISTRIBUTION;

    let totalIssued = 0;
    let totalAnnualCouponCost = 0;
    const bondDocs: Omit<Bond, "_id">[] = [];

    for (const [maturityStr, fraction] of Object.entries(distribution)) {
      if (!fraction || fraction <= 0) continue;
      const maturityTurns = Number(maturityStr) as BondMaturityTurns;
      const trancheAmount =
        Math.floor((issueAmount * fraction) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
      if (trancheAmount < BOND_UNIT_FACE_VALUE) continue;

      const { bondDoc, annualCouponCost } = buildSovereignBondDoc({
        countryId,
        turn,
        now,
        issueAmount: trancheAmount,
        maturityTurns,
        primeRate,
        countryCorporation,
      });

      bondDocs.push(bondDoc);
      totalIssued += bondDoc.totalIssued;
      totalAnnualCouponCost += annualCouponCost;
      issuancesCreated++;
    }

    if (bondDocs.length > 0) {
      await db.collection<Omit<Bond, "_id">>("bonds").insertMany(bondDocs);

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
 * The gap = budget.debt.principal − Σ(active sovereign bond totalIssued).
 * Each tranche in `distribution` (defaults to SOVEREIGN_RECONCILE_DISTRIBUTION)
 * receives its share of the gap at getSovereignCouponRate(primeRate, maturity).
 *
 * **Budget impact:** both debt.principal and spending.debtInterest are updated, matching
 * the standard issuance path. This ensures settleSovereignBondMaturity can correctly
 * net principal back to its pre-reconcile value when each tranche matures, and that
 * debtToGdpRatio / creditRating reflect the fully-accounted bond obligations.
 * The gap analysis compares the budget principal BEFORE the update against existing bonds,
 * so running reconcile twice is safe: the second run will see gap = 0 (all principal
 * now backed by bonds) and issue nothing.
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
  const [budget, centralBank, countryCorporation] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
    db.collection<CentralBank>("centralBanks").findOne({ _id: getBankId(countryId) }),
    findPrimaryNationalCorporation(db, countryId),
  ]);
  if (!budget) return null;

  const primeRate =
    centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
  // B4 credibility spread, same rule as scheduled issuance: no bank, no spread.
  const credibilitySpreadPp = centralBank
    ? sovereignCredibilitySpread(centralBank.chairInfamy ?? 0)
    : 0;

  // Sum all active sovereign bonds already issued for this country.
  const activeBonds = await db
    .collection<Bond>("bonds")
    .find({ issuerType: "sovereign", countryId, matured: false, defaulted: false })
    .toArray();
  const coveredByExistingBonds = activeBonds.reduce((sum, b) => sum + (b.totalIssued ?? 0), 0);

  const rawGap = budget.debt.principal - coveredByExistingBonds;
  const gap = Math.floor(Math.max(0, rawGap) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;

  const tranches: SovereignReconcileTranche[] = [];
  let totalIssued = 0;
  let totalInterestDelta = 0;

  if (gap >= BOND_UNIT_FACE_VALUE) {
    const corporationId = countryCorporation?._id ?? new ObjectId();
    const issuerName = countryCorporation?.name ?? getSovereignIssuerName(countryId);
    const currencyCode = resolveCountryCurrencyCode({ countryId });

    for (const [maturityStr, fraction] of Object.entries(distribution)) {
      if (!fraction || fraction <= 0) continue;
      const maturityTurns = Number(maturityStr) as BondMaturityTurns;
      const trancheAmount =
        Math.floor((gap * fraction) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
      if (trancheAmount < BOND_UNIT_FACE_VALUE) continue;

      const totalUnits = Math.floor(trancheAmount / BOND_UNIT_FACE_VALUE);
      const couponRate = getSovereignCouponRate(primeRate, maturityTurns, credibilitySpreadPp);
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

  // Update both principal and interest service so that settleSovereignBondMaturity
  // can correctly net back to the original value when these bonds mature.
  // The principal also rises here — this is intentional: reconcile converts
  // "raw" historical debt into fully-accounted bond obligations; debtToGdpRatio
  // and creditRating are recomputed accordingly.
  const budgetUpdate = applySovereignDebtAdjustment(budget, totalIssued, totalInterestDelta);
  if (totalIssued > 0) {
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

  return {
    countryId,
    coveredByExistingBonds,
    gap,
    tranches,
    totalIssued,
    budgetInterestDelta: totalInterestDelta,
    newPrincipal: budgetUpdate.debt.principal,
    newDebtInterest: budgetUpdate.spending.debtInterest,
    newSurplus: budgetUpdate.surplus,
    newDebtToGdpRatio: budgetUpdate.debtToGdpRatio,
    newCreditRating: budgetUpdate.creditRating,
  };
}

export async function settleSovereignBondMaturity(
  db: Db,
  bond: Pick<Bond, "countryId" | "couponRate" | "totalIssued">
): Promise<void> {
  if (!bond.countryId) return;
  const budgetId = getNationalBudgetId(bond.countryId);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return;

  const annualCouponCost = (bond.couponRate / 100) * bond.totalIssued;
  const budgetUpdate = applySovereignDebtAdjustment(budget, -bond.totalIssued, -annualCouponCost);

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

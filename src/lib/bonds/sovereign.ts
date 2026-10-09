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
  calculateSovereignCouponRate,
  sovereignCreditSpreadPp,
} from "@/lib/bonds/rules/sovereignCreditSpread";
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
  planSovereignMonetization,
  planSovereignUnderwriting,
  readPoolForPrimary,
} from "@/lib/bonds/primaryMarket";
import {
  commitSovereignPrimary,
  loadPrimaryAccounting,
  primaryDocumentId,
  primarySettlementExists,
  type PrimaryAccountingContext,
} from "./sovereignPrimarySettlement";
import type { TransitionProjection } from "@/lib/banking/rules/boundary";
import {
  resumeSettlement,
  settleTransition,
  type SettlementResult,
} from "@/lib/banking/settlementJournal";
import { treasuryAdvanceMoneyDelta } from "@/lib/moneySupply/rules/assemble";
import { createNotifications } from "@/lib/notifications";
import {
  sovereignBondOutstanding,
  sumOutstandingSovereignPrincipal,
  sovereignDebtTerms,
} from "@/lib/bonds/sovereignPrincipal";
import { loadDemocraticHealth } from "@/lib/governanceStyle/loadDemocraticHealth";
import { democraticHealthSovereignSpread } from "@/lib/governanceStyle/rules/democraticConsequences";
import { settleSovereignPublicFloatDisposition } from "./publicFloatSovereignNovation";
import {
  FORCED_ROLLOVER_MATURITY,
  rollOverUnfundedSovereignPoolFloat,
} from "./forcedSovereignRollover";
import { publicFloatNovationShare } from "./rules/publicFloatNovation";

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
 * Effective sovereign coupon rate = primeRate + term premium, issuer credit risk,
 * and any central-bank credibility or democratic spread.
 * Rounds to 2 dp so stored rates stay human-readable.
 *
 * Both optional spread inputs default to 0 for legacy callers that lack current
 * issuer-risk or scrutiny inputs.
 */
export function getSovereignCouponRate(
  primeRate: number,
  maturityTurns: BondMaturityTurns,
  credibilitySpreadPp = 0,
  issuerRiskSpreadPp = 0
): number {
  const termPremium = SOVEREIGN_BOND_TERM_PREMIUMS[maturityTurns] ?? 0;
  return calculateSovereignCouponRate({
    primeRate,
    termPremiumPp: termPremium,
    credibilitySpreadPp,
    issuerRiskSpreadPp,
  });
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
  requestedAmount: number;
  unsoldAmount: number;
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
  /** Existing sovereign credit-tier premium in percentage points. */
  issuerRiskSpreadPp?: number;
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
    (params.credibilitySpreadPp ?? 0) + (params.democraticSpreadPp ?? 0),
    params.issuerRiskSpreadPp ?? 0
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
    issuanceKey: string;
    poolOnly?: boolean;
  }
): Promise<SovereignBondIssueResult | null> {
  const { countryId, turn, now, issueAmount } = params;
  const maturityTurns = params.maturityTurns ?? SOVEREIGN_BOND_MATURITY_TURNS;
  if (issueAmount < BOND_UNIT_FACE_VALUE) return null;

  const budgetId = getNationalBudgetId(countryId);
  const [budget, centralBank, countryCorporation, democraticSpreadPp] = await Promise.all([
    db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId }),
    db.collection<CentralBank>("centralBanks").findOne(
      { _id: getBankId(countryId) },
      {
        projection: {
          primeRate: 1,
          chairInfamy: 1,
          chairMode: 1,
          chairControlsLocked: 1,
          chairCharacterId: 1,
        },
      }
    ),
    findPrimaryNationalCorporation(db, countryId),
    loadDemocraticSovereignSpread(db, countryId),
  ]);
  if (!budget) return null;

  const normalizedIssueAmount =
    Math.floor(issueAmount / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE;
  if (normalizedIssueAmount < BOND_UNIT_FACE_VALUE) return null;

  const primeRate =
    centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;

  const { bondDoc } = buildSovereignBondDoc({
    countryId,
    turn,
    now,
    issueAmount: normalizedIssueAmount,
    maturityTurns,
    primeRate,
    countryCorporation,
    currencyCode: budget.currencyCode,
    issuerRiskSpreadPp: sovereignCreditSpreadPp(budget.creditRating),
    // B4: a discredited central bank makes its government borrow dearer. No
    // bank document means no scrutiny to read, so the spread is 0, not a guess.
    credibilitySpreadPp: centralBank ? sovereignCredibilitySpread(centralBank.chairInfamy ?? 0) : 0,
    democraticSpreadPp,
  });

  const key = params.issuanceKey;
  const accounting = await loadPrimaryAccounting(db);
  const funded = await fundSovereignSeries(db, {
    key,
    countryId,
    turn,
    now,
    budget,
    centralBank: params.poolOnly ? null : centralBank,
    bondDocs: [bondDoc],
    accounting,
  });
  const updatedBudget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: budgetId });
  const issued = funded[0];
  if (!issued || !updatedBudget) return null;
  return {
    countryId,
    issueAmount: issued.totalIssued,
    requestedAmount: (issued.requestedUnits ?? 0) * BOND_UNIT_FACE_VALUE,
    unsoldAmount: (issued.unsoldUnits ?? 0) * BOND_UNIT_FACE_VALUE,
    couponRate: issued.couponRate,
    bondId: issued._id,
    newPrincipal: updatedBudget.debt.principal,
    newDebtInterest: updatedBudget.spending.debtInterest,
    newSurplus: updatedBudget.surplus,
  };
}

/**
 * Issue a sovereign bond solely against the currency bond pool for a deposit
 * insurance backstop. Unsold units remain unissued until the normal primary
 * placement pass finds pool cash; this path never uses central bank money.
 */
export async function issueDepositInsuranceBackstopBond(
  db: Db,
  args: {
    countryId: CountryId;
    turn: number;
    now: Date;
    amount: number;
    issuanceKey: string;
  }
): Promise<SovereignBondIssueResult | null> {
  if (!Number.isFinite(args.amount) || args.amount <= 0) return null;
  const units = Math.ceil(args.amount / BOND_UNIT_FACE_VALUE);
  if (!Number.isSafeInteger(units)) return null;
  const rounded = units * BOND_UNIT_FACE_VALUE;
  return issueSovereignBondSeries(db, {
    countryId: args.countryId,
    turn: args.turn,
    now: args.now,
    issueAmount: rounded,
    issuanceKey: args.issuanceKey,
    poolOnly: true,
  });
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

  return issueSovereignBondSeries(db, {
    countryId,
    turn,
    now,
    issueAmount,
    maturityTurns,
    issuanceKey: `sovereign-primary:admin:${countryId}:${turn}:${maturityTurns ?? SOVEREIGN_BOND_MATURITY_TURNS}:${faceValue && faceValue > 0 ? faceValue : "quarter-deficit"}`,
  });
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
  const budget = await db
    .collection<Pick<FederalBudget, "_id" | "debt" | "countryId" | "currencyCode">>("federalBudget")
    .findOne(
      { _id: getNationalBudgetId(countryId) },
      { projection: { debt: 1, countryId: 1, currencyCode: 1 } }
    );
  // The pool exchanges its maturing float at par for fresh 48-turn paper
  // (publicFloatSovereignNovation.ts), so that share never needs cash. Only
  // the share that maturity will actually pay out is worth prefunding.
  const currency =
    (budget ? resolveCountryCurrencyCode(budget) : null) ?? COUNTRY_CURRENCY_MAP[countryId];
  const pool = currency ? await readPoolForPrimary(db, currency) : null;
  const novationShare = publicFloatNovationShare(pool?.appetiteByCountry?.[countryId]);
  return sovereignRolloverFromBonds(activeBonds, budget?.debt?.principal, turn, novationShare);
}

/**
 * Rollover for a country from its live (unmatured, undefaulted) sovereign
 * bonds and its budget principal. Pure, so a caller holding both for many
 * countries at once gets the same figure without a read per country.
 *
 * `novationShare` (0..1) is the share of each maturing public float the pool
 * will take in kind at par. A novated unit is already refinanced by the
 * exchange: it leaves principal unchanged, so issuing cash for it as well
 * counts the same debt twice and parks the proceeds in the Treasury. Default 0
 * keeps the gross maturing face, which is what default-risk callers want.
 */
export function sovereignRolloverFromBonds(
  activeBonds: ReadonlyArray<Pick<Bond, "maturityTurn" | "totalIssued"> & { publicFloat?: number }>,
  principal: unknown,
  turn: number,
  novationShare = 0
): number {
  const maturingSoon = activeBonds.filter(
    (bond) =>
      bond.maturityTurn >= turn && bond.maturityTurn < turn + SOVEREIGN_ISSUANCE_INTERVAL_TURNS
  );

  const share = Math.min(1, Math.max(0, novationShare));
  const maturingFace = maturingSoon.reduce((sum, bond) => {
    const face = bond.totalIssued ?? 0;
    const novated = Math.min(face, (bond.publicFloat ?? 0) * BOND_UNIT_FACE_VALUE) * share;
    return sum + (face - novated);
  }, 0);
  const activeFace = activeBonds.reduce((sum, bond) => sum + (bond.totalIssued ?? 0), 0);

  // Rollover refinances debt that still exists. A country that has paid its
  // debt down (or never owed it) must not keep reissuing paper just because an
  // old series is maturing: FR carried 4.2T FRF of bonds against a principal of
  // zero that way, and with a real market pool that paper would have drawn
  // coupons from nothing. Cap the rollover so bonds outstanding after this
  // quarter never exceed the budget's principal. A missing budget keeps the
  // old behaviour (roll everything) so seeds and tests without one still work.
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

  const accounting = await loadPrimaryAccounting(db);
  let issuancesCreated = 0;
  const sovereignCountries = configuredCountries.filter((countryId) =>
    budgetByCountry.has(countryId)
  );
  for (const countryId of sovereignCountries) {
    const budget = budgetByCountry.get(countryId);
    if (!budget) continue;
    const key = `sovereign-primary:scheduled:${countryId}:${turn}`;
    if (await primarySettlementExists(db, key)) continue;

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
      db.collection<CentralBank>("centralBanks").findOne(
        { _id: getBankId(countryId) },
        {
          projection: {
            primeRate: 1,
            chairInfamy: 1,
            chairMode: 1,
            chairControlsLocked: 1,
            chairCharacterId: 1,
          },
        }
      ),
      findPrimaryNationalCorporation(db, countryId),
      loadDemocraticSovereignSpread(db, countryId),
    ]);
    if (!budgetDoc) continue;

    const primeRate =
      centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
    const distribution = budgetDoc.sovereignBondProfile ?? SOVEREIGN_RECONCILE_DISTRIBUTION;

    const bondDocs: Omit<Bond, "_id">[] = [];

    // Primary market: the currency's pool underwrites each tranche at par with
    // the cash it has and the appetite the demand model gives this issuer.
    // Without a funded pool, units remain unplaced unless monetary financing supplies cash.
    const poolCurrency: CurrencyCode =
      resolveCountryCurrencyCode({ countryId, currencyCode: budgetDoc.currencyCode }) ??
      COUNTRY_CURRENCY_MAP[countryId] ??
      "USD";
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
        issuerRiskSpreadPp: sovereignCreditSpreadPp(budgetDoc.creditRating),
        democraticSpreadPp,
      });
      bondDocs.push(bondDoc);
    }
    if (bondDocs.length > 0) {
      const funded = await fundSovereignSeries(db, {
        key,
        countryId,
        turn,
        now,
        budget: budgetDoc,
        centralBank,
        bondDocs,
        accounting,
      });
      issuancesCreated += funded.length;
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
    db.collection<CentralBank>("centralBanks").findOne(
      { _id: getBankId(countryId) },
      {
        projection: {
          primeRate: 1,
          chairInfamy: 1,
          chairMode: 1,
          chairControlsLocked: 1,
          chairCharacterId: 1,
        },
      }
    ),
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
        credibilitySpreadPp + democraticSpreadPp,
        sovereignCreditSpreadPp(budget.creditRating)
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
  bond: Pick<
    Bond,
    "countryId" | "couponRate" | "totalIssued" | "restructureHaircutPercent" | "currencyCode"
  >,
  repaymentLocal = bond.totalIssued,
  bankRepaymentLocal = 0
): Promise<{ amountLocal: number; currencyCode: CurrencyCode } | null> {
  if (!bond.countryId) return null;
  const budgetId = getNationalBudgetId(bond.countryId);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return null;
  const currencyCode = resolveCountryCurrencyCode(budget) ?? COUNTRY_CURRENCY_MAP[bond.countryId];
  if (bond.currencyCode && bond.currencyCode !== currencyCode) {
    throw new Error("Sovereign maturity currency differs from its treasury");
  }
  if (!Number.isFinite(repaymentLocal) || repaymentLocal < 0) {
    throw new Error("Sovereign maturity requires a finite nonnegative repayment");
  }
  if (
    !Number.isFinite(bankRepaymentLocal) ||
    bankRepaymentLocal < 0 ||
    bankRepaymentLocal > repaymentLocal
  ) {
    throw new Error("Bank sovereign maturity share must be within the total repayment");
  }

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

  const landed = await db.collection<FederalBudget>("federalBudget").updateOne(
    { _id: budgetId },
    {
      // Rollover issuance credits this same treasury. Redemption must pay its
      // holders from cash as well as retiring the bond-owned debt stock.
      // Bank holders receive their exact share through the guarded settlement
      // journal. This legacy debit remains responsible for every other holder.
      $inc: { treasuryBalance: -(repaymentLocal - bankRepaymentLocal) },
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
  return landed.matchedCount === 1 ? { amountLocal: repaymentLocal, currencyCode } : null;
}

/** Coupon a fresh sovereign bond would carry now: prime, term, rating, credibility, democracy. */
async function marketSovereignRolloverCoupon(db: Db, countryId: CountryId): Promise<number> {
  const [budget, centralBank, democraticSpreadPp] = await Promise.all([
    db
      .collection<FederalBudget>("federalBudget")
      .findOne({ _id: getNationalBudgetId(countryId) }, { projection: { creditRating: 1 } }),
    db
      .collection<CentralBank>("centralBanks")
      .findOne({ _id: getBankId(countryId) }, { projection: { primeRate: 1, chairInfamy: 1 } }),
    loadDemocraticSovereignSpread(db, countryId),
  ]);
  const primeRate =
    centralBank?.primeRate ?? getCountryConfig(countryId).centralBank.defaultPrimeRate;
  return getSovereignCouponRate(
    primeRate,
    FORCED_ROLLOVER_MATURITY,
    (centralBank ? sovereignCredibilitySpread(centralBank.chairInfamy ?? 0) : 0) +
      democraticSpreadPp,
    sovereignCreditSpreadPp(budget?.creditRating)
  );
}

export interface SovereignMaturityCashLeg {
  collection: string;
  filter: Record<string, unknown>;
  path: string;
  amount: number;
  currencyCode: CurrencyCode;
  localPerAnchor: number;
  note: string;
}

/** Freeze the due-turn holder snapshot before any maturity claim can be paid. */
export async function freezeFundedSovereignBondMaturityQuote(
  db: Db,
  input: {
    bond: Bond;
    dueTurn: number;
    currencyCode: CurrencyCode;
    treasuryLocalPerAnchor: number;
    nonBankRepaymentLocal: number;
    holderLegs: readonly SovereignMaturityCashLeg[];
    now: Date;
  }
): Promise<NonNullable<Bond["sovereignMaturityClaim"]> | null> {
  const {
    bond,
    dueTurn,
    currencyCode,
    treasuryLocalPerAnchor,
    nonBankRepaymentLocal,
    holderLegs,
    now,
  } = input;
  if (!Number.isSafeInteger(dueTurn) || dueTurn !== bond.maturityTurn)
    throw new Error("Funded sovereign maturity requires its frozen due turn");
  if (
    !Number.isFinite(nonBankRepaymentLocal) ||
    nonBankRepaymentLocal < 0 ||
    !Number.isFinite(treasuryLocalPerAnchor) ||
    treasuryLocalPerAnchor <= 0
  )
    throw new Error("Funded sovereign maturity requires finite cash and valuation");
  if (holderLegs.some((leg) => !Number.isFinite(leg.amount) || leg.amount < 0))
    throw new Error("Funded sovereign maturity holder legs must be finite and nonnegative");

  const claimId = `sovereign-maturity:${bond._id.toHexString()}:${dueTurn}`;
  let quote = bond.sovereignMaturityClaim;
  if (!quote) {
    if (!bond.countryId) return null;
    if (bond.currencyCode && bond.currencyCode !== currencyCode)
      throw new Error("Sovereign maturity currency differs from its treasury");
    const candidate: NonNullable<Bond["sovereignMaturityClaim"]> = {
      id: claimId,
      dueTurn,
      currencyCode,
      treasuryLocalPerAnchor,
      amountLocal: nonBankRepaymentLocal,
      escrowLocal: 0,
      sourceHolders: bond.holders ?? [],
      sourcePublicFloat: bond.publicFloat,
      sourceCentralBankHoldings: bond.centralBankHoldings,
      holderLegs: holderLegs.map((leg) => ({ ...leg })),
    };
    await db.collection<Bond>("bonds").updateOne(
      {
        _id: bond._id,
        issuerType: "sovereign",
        countryId: bond.countryId,
        maturityTurn: dueTurn,
        matured: false,
        defaulted: false,
        holders: bond.holders,
        publicFloat: bond.publicFloat,
        ...(bond.centralBankHoldings === undefined
          ? { centralBankHoldings: { $exists: false } }
          : { centralBankHoldings: bond.centralBankHoldings }),
        sovereignMaturityClaim: { $exists: false },
      },
      { $set: { sovereignMaturityClaim: candidate, updatedAt: now } }
    );
    const saved = await db
      .collection<Bond>("bonds")
      .findOne({ _id: bond._id }, { projection: { sovereignMaturityClaim: 1 } });
    quote = saved?.sovereignMaturityClaim;
  }
  if (!quote || quote.id !== claimId || quote.dueTurn !== dueTurn)
    throw new Error("Sovereign maturity quote changed after it was frozen");
  return quote;
}

/**
 * Settle the non-bank holders of one matured sovereign bond from actual
 * spendable Treasury cash. The due-turn key freezes the original holder and
 * FX snapshot across retries. The budget's signed fiscal position and debt
 * service are accounting projections; the cash debit is a distinct guarded
 * leg. Bond retirement is deliberately the last projection, so a failed cash
 * or holder leg leaves the bond active and the original receipt resumable.
 */
export async function settleFundedSovereignBondMaturity(
  db: Db,
  input: {
    bond: Bond;
    turn: number;
    dueTurn: number;
    currencyCode: CurrencyCode;
    treasuryLocalPerAnchor: number;
    nonBankRepaymentLocal: number;
    holderLegs: readonly SovereignMaturityCashLeg[];
    now: Date;
    /** Test seam for the isolated native-Mongo settlement fixture. */
    transactionClient?: import("mongodb").MongoClient;
  }
): Promise<SettlementResult | null> {
  const {
    bond,
    turn,
    dueTurn,
    treasuryLocalPerAnchor,
    nonBankRepaymentLocal,
    holderLegs,
    now,
    transactionClient,
  } = input;
  if (!Number.isSafeInteger(dueTurn) || dueTurn !== bond.maturityTurn)
    throw new Error("Funded sovereign maturity requires its frozen due turn");
  if (
    !Number.isFinite(nonBankRepaymentLocal) ||
    nonBankRepaymentLocal < 0 ||
    !Number.isFinite(treasuryLocalPerAnchor) ||
    treasuryLocalPerAnchor <= 0
  )
    throw new Error("Funded sovereign maturity requires finite cash and valuation");
  if (holderLegs.some((leg) => !Number.isFinite(leg.amount) || leg.amount < 0))
    throw new Error("Funded sovereign maturity holder legs must be finite and nonnegative");
  if (!bond.countryId && !bond.sovereignMaturityClaim) return null;

  const claimId = `sovereign-maturity:${bond._id.toHexString()}:${dueTurn}`;
  const frozenQuote = await freezeFundedSovereignBondMaturityQuote(db, input);
  if (!frozenQuote) return null;
  let quote = frozenQuote;

  // Finish a previous attempt before opening another generation. A rejected
  // insufficient-cash attempt has no applied legs and is terminal by design;
  // its stable claim quote allows a new turn-keyed attempt without changing
  // payees, amounts, or FX.
  const pendingFunding = await db
    .collection<{ _id: string; status?: string }>("bankMoneyMoves")
    .find({ _id: { $regex: `^${claimId}:fund:` }, status: "partial" })
    .toArray();
  const currentBond = await db
    .collection<Bond>("bonds")
    .findOne({ _id: bond._id }, { projection: { sovereignMaturityClaim: 1 } });
  const currentQuote = currentBond?.sovereignMaturityClaim;
  if (!currentQuote || currentQuote.id !== claimId)
    throw new Error("Frozen sovereign maturity quote disappeared");
  quote = currentQuote;
  if (quote.paid) {
    const completedPayout = await db
      .collection<{ _id: string }>("bankMoneyMoves")
      .findOne({ _id: `${claimId}:payout` }, { projection: { _id: 1 } });
    return completedPayout ? resumeSettlement(db, completedPayout._id) : null;
  }

  const sourceCountryId =
    quote.publicFloatDisposition?.mode === "novation"
      ? quote.publicFloatDisposition.sourceCountryId
      : bond.countryId;
  if (!sourceCountryId) return null;
  if (
    quote.publicFloatDisposition?.mode !== "novation" &&
    bond.currencyCode &&
    bond.currencyCode !== quote.currencyCode
  )
    throw new Error("Sovereign maturity currency differs from its treasury");
  const budgetId =
    quote.publicFloatDisposition?.mode === "novation"
      ? quote.publicFloatDisposition.budgetId
      : getNationalBudgetId(sourceCountryId);
  const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
  if (!budget) return null;
  const budgetCurrency =
    resolveCountryCurrencyCode(budget) ?? COUNTRY_CURRENCY_MAP[sourceCountryId];
  if (budgetCurrency !== quote.currencyCode)
    throw new Error("Sovereign maturity currency differs from its treasury");
  if (
    quote.publicFloatDisposition?.mode === "novation" &&
    budget.countryId !== quote.publicFloatDisposition.budgetCountryId
  )
    throw new Error("Sovereign maturity treasury identity changed after novation");
  const frozenBudgetIdentity =
    quote.publicFloatDisposition?.mode === "novation"
      ? {
          countryId: quote.publicFloatDisposition.budgetCountryId,
          ...(quote.publicFloatDisposition.budgetCurrencyCode === null
            ? { currencyCode: { $exists: false } }
            : { currencyCode: quote.publicFloatDisposition.budgetCurrencyCode }),
        }
      : {};

  const allowNovation =
    quote.escrowLocal === 0 &&
    quote.fundingAttemptTurn === undefined &&
    pendingFunding.length === 0;
  quote = await settleSovereignPublicFloatDisposition(
    db,
    bond,
    quote,
    turn,
    now,
    allowNovation,
    transactionClient
  );
  if (
    quote.publicFloatDisposition?.mode === "novation" &&
    quote.publicFloatDisposition.status !== "applied"
  )
    return null;
  for (const receipt of pendingFunding) {
    const recovered = await resumeSettlement(db, receipt._id);
    if (recovered.status !== "applied" && !(recovered.status === "replayed" && !recovered.error))
      return recovered;
  }
  if (pendingFunding.length > 0) {
    const refreshed = await db
      .collection<Bond>("bonds")
      .findOne({ _id: bond._id }, { projection: { sovereignMaturityClaim: 1 } });
    const refreshedQuote = refreshed?.sovereignMaturityClaim;
    if (!refreshedQuote || refreshedQuote.id !== claimId)
      throw new Error("Frozen sovereign maturity quote disappeared during funding recovery");
    quote = refreshedQuote;
  }
  const novatedUnits =
    quote.publicFloatDisposition?.mode === "novation"
      ? quote.publicFloatDisposition.acceptedUnits
      : 0;
  const originalTotalIssued =
    quote.publicFloatDisposition?.mode === "novation"
      ? quote.publicFloatDisposition.sourceTotalIssued
      : bond.totalIssued;
  const originalCouponRate =
    quote.publicFloatDisposition?.mode === "novation"
      ? quote.publicFloatDisposition.sourceCouponRate
      : bond.couponRate;
  const originalHaircut =
    quote.publicFloatDisposition?.mode === "novation"
      ? (quote.publicFloatDisposition.sourceRestructureHaircutPercent ?? null)
      : (bond.restructureHaircutPercent ?? null);
  const cashAmountLocal =
    quote.publicFloatDisposition?.mode === "novation"
      ? (quote.publicFloatDisposition.residualAmountLocal ?? 0)
      : quote.amountLocal;

  const previousPayout = await db
    .collection<{ _id: string; status?: string }>("bankMoneyMoves")
    .findOne({ _id: `${claimId}:payout`, status: "partial" });
  if (previousPayout) {
    const recovered = await resumeSettlement(db, previousPayout._id);
    if (recovered.status === "applied" || (recovered.status === "replayed" && !recovered.error))
      return recovered;
    return recovered;
  }

  if (quote.escrowLocal < cashAmountLocal) {
    const currentBudget = await db
      .collection<FederalBudget>("federalBudget")
      .findOne(
        { _id: budgetId, ...frozenBudgetIdentity },
        { projection: { treasuryCashLocal: 1 } }
      );
    if ((currentBudget?.treasuryCashLocal ?? 0) < cashAmountLocal) {
      // An unfundable maturity rolls its pool holding into a par replacement
      // bond rather than sitting unpaid forever. Retry once on the rebased claim.
      if (quote.forcedRollover || !bond.countryId) return null;
      const rolled = await rollOverUnfundedSovereignPoolFloat(db, {
        bond: (await db.collection<Bond>("bonds").findOne({ _id: bond._id })) ?? bond,
        claim: quote,
        turn,
        now,
        couponRate: await marketSovereignRolloverCoupon(db, bond.countryId),
        budgetId,
        client: transactionClient,
      });
      if (!rolled) return null;
      const rebased = await db.collection<Bond>("bonds").findOne({ _id: bond._id });
      if (!rebased?.sovereignMaturityClaim?.forcedRollover) return null;
      return settleFundedSovereignBondMaturity(db, { ...input, bond: rebased });
    }
    if (quote.fundingAttemptTurn !== turn) {
      const priorAttemptTurn = quote.fundingAttemptTurn;
      const reservation = await db.collection<Bond>("bonds").updateOne(
        {
          _id: bond._id,
          "sovereignMaturityClaim.id": claimId,
          "sovereignMaturityClaim.escrowLocal": quote.escrowLocal,
          ...(priorAttemptTurn === undefined
            ? { "sovereignMaturityClaim.fundingAttemptTurn": { $exists: false } }
            : { "sovereignMaturityClaim.fundingAttemptTurn": priorAttemptTurn }),
        },
        { $set: { "sovereignMaturityClaim.fundingAttemptTurn": turn } }
      );
      if (reservation.matchedCount !== 1) {
        const reservedBond = await db
          .collection<Bond>("bonds")
          .findOne({ _id: bond._id }, { projection: { sovereignMaturityClaim: 1 } });
        const reservedQuote = reservedBond?.sovereignMaturityClaim;
        if (
          !reservedQuote ||
          reservedQuote.id !== claimId ||
          reservedQuote.fundingAttemptTurn !== turn
        )
          return null;
        quote = reservedQuote;
      } else {
        quote = { ...quote, fundingAttemptTurn: turn };
      }
    }
    const attemptKey = `${claimId}:fund:${turn}`;
    let attempt = await settleTransition(db, {
      key: attemptKey,
      kind: "sovereign_maturity_funding",
      turn,
      currency: quote.currencyCode,
      legs: [
        {
          kind: "debit",
          amount: cashAmountLocal,
          valuation: {
            currencyCode: quote.currencyCode,
            localPerAnchor: quote.treasuryLocalPerAnchor,
          },
          collection: "federalBudget",
          filter: {
            _id: budgetId,
            ...frozenBudgetIdentity,
            treasuryCashLocal: { $gte: cashAmountLocal },
          },
          path: "treasuryCashLocal",
          note: "Fund frozen sovereign maturity claim from Treasury cash",
        },
        {
          kind: "credit",
          amount: cashAmountLocal,
          valuation: {
            currencyCode: quote.currencyCode,
            localPerAnchor: quote.treasuryLocalPerAnchor,
          },
          collection: "bonds",
          filter: {
            _id: bond._id,
            "sovereignMaturityClaim.id": claimId,
            "sovereignMaturityClaim.escrowLocal": quote.escrowLocal,
          },
          path: "sovereignMaturityClaim.escrowLocal",
          note: "Hold funded sovereign maturity cash in its immutable bond claim",
        },
      ],
      projections: [
        {
          collection: "federalBudget",
          filter: { _id: budgetId, ...frozenBudgetIdentity },
          update: { $inc: { treasuryBalance: -cashAmountLocal } },
          note: "Record funded sovereign principal payment in signed fiscal position",
        },
      ],
      event: {
        kind: "monetary.executed",
        command: "turn.sovereign.maturity.fund",
        subjectType: "government",
        subjectId: sourceCountryId,
        amount: cashAmountLocal,
        meta: { bondId: bond._id.toHexString(), dueTurn },
      },
    });
    if (attempt.status === "partial" || (attempt.status === "replayed" && attempt.error))
      attempt = await resumeSettlement(db, attemptKey);
    if (attempt.status !== "applied" && !(attempt.status === "replayed" && !attempt.error))
      return attempt;
    const fundedBond = await db
      .collection<Bond>("bonds")
      .findOne({ _id: bond._id }, { projection: { sovereignMaturityClaim: 1 } });
    const fundedQuote = fundedBond?.sovereignMaturityClaim;
    if (!fundedQuote || fundedQuote.escrowLocal < cashAmountLocal) return attempt;
    quote = fundedQuote;
  }

  const remainingIssued = Math.max(0, originalTotalIssued - novatedUnits * BOND_UNIT_FACE_VALUE);
  const remainingPublicFloat = Math.max(0, quote.sourcePublicFloat - novatedUnits);
  const maturedFace = sovereignBondOutstanding({
    issuerType: "sovereign",
    matured: false,
    defaulted: false,
    totalIssued: remainingIssued,
    restructureHaircutPercent: originalHaircut,
  });
  const annualCouponCost = (originalCouponRate / 100) * remainingIssued;
  const payoutQuote =
    novatedUnits > 0
      ? {
          ...quote,
          amountLocal: cashAmountLocal,
          holderLegs: quote.holderLegs.map((leg) =>
            leg.collection === "bondMarketPools" &&
            String(leg.filter._id) === (bond.currencyCode ?? quote.currencyCode)
              ? { ...leg, amount: Math.max(0, leg.amount - novatedUnits * BOND_UNIT_FACE_VALUE) }
              : leg
          ),
        }
      : quote;
  const disposition = payoutQuote.publicFloatDisposition;
  const frozenSourceIdentity =
    disposition?.mode === "novation"
      ? {
          issuerName: disposition.sourceIssuerName,
          corporationId: disposition.sourceCorporationId,
          couponRate: disposition.sourceCouponRate,
          ...(disposition.sourceCurrencyCode === null
            ? { currencyCode: { $exists: false } }
            : { currencyCode: disposition.sourceCurrencyCode }),
          ...(disposition.sourceRestructureHaircutPercent === null
            ? { restructureHaircutPercent: null }
            : { restructureHaircutPercent: disposition.sourceRestructureHaircutPercent }),
        }
      : {};
  const payoutKey = `${claimId}:payout`;
  return settleTransition(db, {
    key: payoutKey,
    kind: "sovereign_maturity_payout",
    turn,
    currency: payoutQuote.currencyCode,
    legs: [
      ...(payoutQuote.amountLocal > 0
        ? [
            {
              kind: "debit" as const,
              amount: payoutQuote.amountLocal,
              valuation: {
                currencyCode: payoutQuote.currencyCode,
                localPerAnchor: payoutQuote.treasuryLocalPerAnchor,
              },
              collection: "bonds",
              filter: {
                _id: bond._id,
                "sovereignMaturityClaim.id": claimId,
                "sovereignMaturityClaim.escrowLocal": { $gte: payoutQuote.amountLocal },
              },
              path: "sovereignMaturityClaim.escrowLocal",
              note: "Pay non-bank sovereign maturity holders from funded claim escrow",
            },
          ]
        : []),
      ...payoutQuote.holderLegs
        .filter((leg) => leg.amount > 0)
        .map((leg) => ({
          kind: "credit" as const,
          amount: leg.amount,
          valuation: { currencyCode: leg.currencyCode, localPerAnchor: leg.localPerAnchor },
          collection: leg.collection,
          filter: leg.filter,
          path: leg.path,
          note: leg.note,
        })),
    ],
    projections: [
      {
        collection: "federalBudget",
        filter: { _id: budgetId },
        update: {
          // Delta projection preserves concurrent issuance and maturity
          // changes on the same country's budget. A stale $set here could
          // overwrite a second bond's newly issued or retired principal.
          $inc: {
            "debt.principal": -maturedFace,
            "spending.debtInterest": -annualCouponCost,
            "spending.total": -annualCouponCost,
            surplus: annualCouponCost,
          },
          $set: { updatedAt: now },
        },
        note: "Retire matured sovereign debt after funded payouts",
      },
      {
        collection: "bonds",
        filter: {
          _id: bond._id,
          issuerType: "sovereign",
          countryId: sourceCountryId,
          ...frozenSourceIdentity,
          maturityTurn: dueTurn,
          matured: false,
          defaulted: false,
          "sovereignMaturityClaim.id": claimId,
          "sovereignMaturityClaim.escrowLocal": 0,
          holders: quote.sourceHolders,
          publicFloat: remainingPublicFloat,
          totalIssued: remainingIssued,
          ...(quote.sourceCentralBankHoldings === undefined
            ? { centralBankHoldings: { $exists: false } }
            : { centralBankHoldings: quote.sourceCentralBankHoldings }),
        },
        update: {
          $set: {
            "sovereignMaturityClaim.escrowLocal": 0,
            "sovereignMaturityClaim.paid": true,
            matured: true,
            redeemedAtTurn: turn,
            marketPrice: 1,
            publicFloat: 0,
            holders: [],
            centralBankHoldings: 0,
            updatedAt: now,
          },
        },
        note: "Retire sovereign bond after every funded holder leg lands",
      },
    ],
    event: {
      kind: "monetary.executed",
      command: "turn.sovereign.maturity.payout",
      subjectType: "government",
      subjectId: sourceCountryId,
      amount: payoutQuote.amountLocal,
      meta: { bondId: bond._id.toHexString(), dueTurn },
    },
  });
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
  const face = 0;
  const annualCoupon = 0;

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

/** One durable intent owns the complete ladder, including autonomous funding. */
async function fundSovereignSeries(
  db: Db,
  args: {
    key: string;
    countryId: CountryId;
    turn: number;
    now: Date;
    budget: FederalBudget;
    centralBank: CentralBank | null;
    bondDocs: Omit<Bond, "_id">[];
    accounting: PrimaryAccountingContext;
  }
): Promise<Bond[]> {
  if (await primarySettlementExists(db, args.key)) {
    return db
      .collection<Bond>("bonds")
      .find({ _id: { $in: args.bondDocs.map((_, i) => primaryDocumentId(`${args.key}:${i}`)) } })
      .toArray();
  }
  const currency =
    resolveCountryCurrencyCode(args.budget) ?? COUNTRY_CURRENCY_MAP[args.countryId] ?? "USD";
  const pool = await readPoolForPrimary(db, currency);
  let available = Math.max(0, pool?.cashLocal ?? 0);
  const requested = args.bondDocs.reduce(
    (sum, doc) => sum + Math.floor(doc.totalIssued / BOND_UNIT_FACE_VALUE),
    0
  );
  // Funded Treasury cash forbids minting (#3401): the gap stays unsold and
  // places later as pool cash allows, with no face, principal or coupon now.
  let monetaryCapacity =
    args.accounting.treasuryCashLedgerEnabled !== true &&
    args.centralBank?.chairMode === "npp" &&
    args.centralBank.chairControlsLocked !== true
      ? planSovereignMonetization({
          unsoldUnits: requested,
          gdpLocal: args.budget.gdpSmoothed || args.budget.gdp,
          pricePerUnitLocal: BOND_UNIT_FACE_VALUE,
        }).units
      : 0;
  let poolCash = 0,
    monetaryCash = 0,
    face = 0,
    annualCoupon = 0,
    placedByPool = 0;
  const funded = args.bondDocs.map((doc, index): Bond => {
    const requestedUnits = Math.floor(doc.totalIssued / BOND_UNIT_FACE_VALUE);
    const placed = planSovereignUnderwriting({
      requestedUnits,
      poolCashLocal: available,
      appetite: pool?.appetiteByCountry?.[args.countryId],
      pricePerUnitLocal: BOND_UNIT_FACE_VALUE,
    }).placedUnits;
    const monetized = Math.min(requestedUnits - placed, monetaryCapacity);
    available -= placed * BOND_UNIT_FACE_VALUE;
    monetaryCapacity -= monetized;
    poolCash += placed * BOND_UNIT_FACE_VALUE;
    monetaryCash += monetized * BOND_UNIT_FACE_VALUE;
    placedByPool += placed;
    const issuedFace = (placed + monetized) * BOND_UNIT_FACE_VALUE;
    face += issuedFace;
    annualCoupon += (issuedFace * doc.couponRate) / 100;
    return {
      ...doc,
      _id: primaryDocumentId(`${args.key}:${index}`),
      totalIssued: issuedFace,
      publicFloat: placed,
      centralBankHoldings: monetized,
      requestedUnits,
      unsoldUnits: requestedUnits - placed - monetized,
      primaryFillRatio: requestedUnits ? placed / requestedUnits : 1,
      qeSupportRatio: placed + monetized > 0 ? monetized / (placed + monetized) : 0,
    };
  });
  const projections: TransitionProjection[] = funded.map((doc) => ({
    collection: "bonds",
    insert: doc as unknown as Record<string, unknown>,
    note: "Issued sovereign tranche",
  }));
  projections.push({
    collection: "federalBudget",
    filter: { _id: args.budget._id },
    update: {
      $set: {
        lastPrimaryFillRatio: requested
          ? Math.round((placedByPool / requested) * 10000) / 10000
          : 1,
        lastPrimaryAuctionTurn: args.turn,
        updatedAt: args.now,
      },
    },
    note: "Primary auction result",
  });
  if (monetaryCash > 0)
    projections.push({
      collection: "centralBanks",
      filter: { _id: args.centralBank!._id },
      update: {
        $push: {
          monetaryOperations: {
            $each: [
              {
                type: "qe",
                turn: args.turn,
                amount: monetaryCash,
                moneySupplyDelta: treasuryAdvanceMoneyDelta(
                  args.budget.treasuryBalance + poolCash,
                  monetaryCash
                ),
                reserveDelta: 0,
                actorName: "Autonomous chair",
                reason: "Primary auction funding credited to issuer treasury",
                createdAt: args.now,
              },
            ],
            $slice: -100,
          },
        },
      },
      note: "Monetary auction receipt",
    });
  await commitSovereignPrimary(
    db,
    {
      key: args.key,
      countryId: args.countryId,
      turn: args.turn,
      currency,
      budgetId: args.budget._id,
      poolCash,
      monetaryCash,
      centralBankId: args.centralBank?._id,
      face,
      annualCoupon,
      now: args.now,
    },
    projections,
    args.accounting
  );
  await refreshSovereignDebtTerms(db, args.budget._id);
  const unsold = funded.reduce((sum, doc) => sum + (doc.unsoldUnits ?? 0), 0);
  if (unsold > 0)
    await handleSovereignShortfall(db, {
      ...args,
      bondDocs: funded,
      insertedIds: funded.map((doc) => doc._id),
      unsoldTotal: unsold,
      requestedTotal: requested,
    });
  return funded;
}

/** Refresh derived debt terms after a funded principal/coupon projection. */
export async function refreshSovereignDebtTerms(
  db: Db,
  budgetId: FederalBudget["_id"]
): Promise<void> {
  // Only what applySovereignDebtAdjustment reads: the full budget carries an
  // ever-growing settledKeys list this refresh has no use for.
  const refreshed = await db.collection<FederalBudget>("federalBudget").findOne(
    { _id: budgetId },
    {
      projection: {
        debt: 1,
        "spending.debtInterest": 1,
        "spending.total": 1,
        "revenue.total": 1,
        gdp: 1,
        gdpSmoothed: 1,
        sovereignRiskAnchor: 1,
        imfSovereignBailoutActive: 1,
        investorConfidence: 1,
      },
    }
  );
  if (refreshed) {
    const terms = applySovereignDebtAdjustment(refreshed, 0, 0);
    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: budgetId },
      {
        $set: {
          "debt.interestRate": terms.debt.interestRate,
          debtToGdpRatio: terms.debtToGdpRatio,
          creditRating: terms.creditRating,
        },
      }
    );
  }
}

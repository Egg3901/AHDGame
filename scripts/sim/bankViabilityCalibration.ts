/**
 * Deterministic retail-bank viability calibration using current rules.
 *
 * This is an offline analytical model. It reads no world data. Sovereign supply
 * is generated from the 1991 US seed's quarterly funded issuance and a finite
 * pool-cash lower bound. Bank coupons and principal count as cash only when the
 * separate funded Treasury cash stock can fund them. The signed fiscal position
 * remains analytical, and the negative opening seed is never spendable cash.
 */

import { ObjectId } from "mongodb";
import {
  computeBankTreasuryCashFloor,
  computeBankTreasuryDueInterest,
  computeBankTreasuryFundingRatePercent,
  planBankTreasurySweep,
  quoteBankTreasuryBond,
} from "@/lib/banking/rules/bankTreasury";
import { planPublicFloatNovation } from "@/lib/bonds/rules/publicFloatNovation";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calculateBondMarketPrice, perTurnCouponPayment } from "@/lib/constants/bonds";
import { getOpeningPolicyRate } from "@/lib/centralBank/rules/openingPolicyRate";
import { BOND_UNIT_FACE_VALUE, type BondMaturityTurns } from "@/lib/db/types/bond";
import { effectiveBankRatesFromPrime } from "@/lib/banking/rules/rates";
import { computeNpcDepositShare } from "@/lib/banking/rules/deposits";
import { npcFlowDelta, fundedNpcFlowDelta, perTurnInterest } from "@/lib/banking/rules/loans";
import {
  bandOriginationTargets,
  getCreditBand,
  stressLossFraction,
  STRESS_LOSS_MULTIPLIER,
  type CreditBandId,
} from "@/lib/banking/rules/creditBands";
import {
  BASE_PREMIUM_ANNUAL,
  computeEvidenceBasedPremiumAnnualRate,
  computeInsurancePremium,
} from "@/lib/banking/rules/insurance";
import { quoteLoanOrigination } from "@/lib/banking/rules/loanFees";
import { computeDepositCeiling } from "@/lib/banking/rules/capacity";
import { MODERN_DEPOSIT_CORRIDOR, MODERN_LENDING_CORRIDOR } from "@/lib/banking/regulationQ";
import { computeConfidence } from "@/lib/banking/rules/confidence";
import { depositFlight, depositTakerFails } from "@/lib/banking/rules/solvency";
import { savingsApyPercent } from "@/lib/currency/savingsInterest";
import { quoteBondPrices } from "@/lib/bonds/marketPoolQuotes";
import {
  calculateQuarterlyIssuanceAmount,
  getSovereignCouponRate,
  sovereignRolloverFromBonds,
  SOVEREIGN_ISSUANCE_INTERVAL_TURNS,
  SOVEREIGN_RECONCILE_DISTRIBUTION,
} from "@/lib/bonds/sovereign";
import { sovereignDebtTerms } from "@/lib/bonds/sovereignPrincipal";
import { planSovereignTranches } from "@/lib/bonds/sovereignIssueDiagnostics";
import { MAX_NPC_FLOW_PER_TURN_FRACTION } from "@/lib/banking/rules/loans";
import { MIN_CAPITAL_RATIO, STRESS_CAPITAL_RATIO } from "@/lib/banking/rules/capitalAdequacy";
import type { LendingProfileId } from "@/lib/banking/rules/creditBands";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import { federalSurplus } from "@/lib/budget/federalSurplus";
import { getGdpAnchorRate } from "@/lib/currency/gdpAnchorRate";
import { getInitialRates } from "@/lib/constants/currencies";
import { broadMoneyToGdpRatio } from "@/lib/seeds/reference/moneySupply";
import { seedExternalBroadMoney } from "@/lib/moneySupply/rules/seed";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { CHARTER_CAPITAL_FOUNDING_MULTIPLE } from "@/lib/banking/charter";
import { CORPORATION_FOUNDING_COST } from "@/lib/constants/corporations";
import { SOVEREIGN_BOND_HOLDER_CAP } from "@/lib/bonds/holderCap";
import { BOND_POOL_M2_SHARE } from "@/lib/bonds/marketPool";
import { planPoolCashMoves } from "@/lib/bonds/marketPoolTurn";
import { planSovereignUnderwriting } from "@/lib/bonds/primaryMarket";

type Scenario = {
  name: string;
  profile: LendingProfileId;
  prime: number;
  inflation: number;
  depositOffset: number;
  lendingOffset: number;
  turns: number;
  openingEquity?: number;
  externalCash?: number;
  branchDepositCeiling?: number;
  treasuryAutoSweep?: boolean;
  /** Historical nearest-maturity sweep for comparison only. */
  legacyTreasurySweep?: boolean;
  /** Historical cash-only public-float maturity for comparison only. */
  publicFloatCashOnly?: boolean;
  openingPoolCash?: number;
  /** Experimental balance-based service charge for fee sensitivity only. */
  serviceFeeAnnualBps?: number;
  /** Premium sensitivity; production rules currently use BASE_PREMIUM_ANNUAL. */
  insurancePremiumBaseAnnualRate?: number;
  recessionShock?: {
    turn: number;
    primeIncreasePp: number;
    defaultRateMultiplier?: number;
    applyStressLoss?: boolean;
  };
};

const RESERVE_RATIO = 0.2;
const TURNS = 480;

const initialUs1991Budget = getInitialNationalBudgetsForPreset("1991-default").find(
  (budget) => budget.countryId === "US"
);
if (!initialUs1991Budget) throw new Error("The 1991 US national budget seed is missing");
const us1991Budget = initialUs1991Budget as NonNullable<typeof initialUs1991Budget>;
const us1991ExternalBroadMoney = seedExternalBroadMoney({
  storedGdp: us1991Budget.gdp,
  anchorPerGdpUnit: getGdpAnchorRate("US", "1991-default"),
  localPerAnchor: getInitialRates("1991-default").US ?? 1,
  broadMoneyToGdp: broadMoneyToGdpRatio("1991-default", "US"),
});
const us1991QuarterlyDeficitIssue = calculateQuarterlyIssuanceAmount(
  Math.max(0, -federalSurplus(us1991Budget))
);
const representativeCapital = CHARTER_CAPITAL_FOUNDING_MULTIPLE * CORPORATION_FOUNDING_COST;
const representativeBranchCeiling = computeDepositCeiling(250, 0.5);
const conservativePoolCashSeed = us1991ExternalBroadMoney * BOND_POOL_M2_SHARE;
const us1991Prime = getOpeningPolicyRate(
  "US",
  1991,
  COUNTRY_CONFIGS.US.centralBank.defaultPrimeRate
);
const INITIAL_EQUITY = representativeCapital;
const NPC_ECONOMY_CASH = us1991ExternalBroadMoney;
const BRANCH_DEPOSIT_CEILING = representativeBranchCeiling;
const us1991ShortIssueFace =
  planSovereignTranches(SOVEREIGN_RECONCILE_DISTRIBUTION, us1991QuarterlyDeficitIssue).find(
    (tranche) => tranche.maturityTurns === TURNS_PER_YEAR
  )?.amount ?? 0;
const openingSeedTranches = Object.entries(SOVEREIGN_RECONCILE_DISTRIBUTION)
  .filter((entry): entry is [string, number] => Number.isFinite(entry[1]) && entry[1] > 0)
  .map(([maturity, fraction]) => {
    const maturityTurns = Number(maturity);
    const units = Math.floor((us1991Budget.debt.principal * fraction) / BOND_UNIT_FACE_VALUE);
    return {
      maturityTurns,
      units,
      face: units * BOND_UNIT_FACE_VALUE,
      couponRate: getSovereignCouponRate(us1991Prime, maturityTurns as BondMaturityTurns),
    };
  })
  .filter((tranche) => tranche.units > 0);
const us1991AnnualPrimaryBalance =
  us1991Budget.revenue.total - (us1991Budget.spending.total - us1991Budget.spending.debtInterest);

type SimBond = {
  bondId: string;
  issuedTurn: number;
  maturityTurn: number;
  couponRate: number;
  totalUnits: number;
  floatUnits: number;
  heldUnits: number;
  heldCostLocal?: number;
  marketPrice?: number;
  maturityRegistered?: boolean;
  maturityPaid?: boolean;
};

type PendingCouponClaim = {
  bondId: string;
  dueTurn: number;
  bankLocal: number;
  publicFloatLocal: number;
};

type PendingMaturityClaim = {
  bondId: string;
  dueTurn: number;
  originalFaceLocal: number;
  annualCouponCost: number;
  dispositionRegistered?: boolean;
  bankCostBasisLocal: number;
  bankLocal: number;
  publicFloatLocal: number;
};

function simulate(scenario: Scenario) {
  const openingEquity = scenario.openingEquity ?? INITIAL_EQUITY;
  let externalCash = scenario.externalCash ?? NPC_ECONOMY_CASH;
  const branchDepositCeiling = scenario.branchDepositCeiling ?? BRANCH_DEPOSIT_CEILING;
  let cash = openingEquity;
  let deposits = 0;
  let feeIncome = 0;
  let serviceFeeIncome = 0;
  let premiumExpense = 0;
  let insuranceFundBalance = 0;
  let premiumExposureEquivalentDepositTurns = 0;
  let measuredInsuredDepositTurns = 0;
  let measuredGrossClaims = 0;
  const measuredRecoveries = 0;
  let measuredPaidClaims = 0;
  let pricingEvidenceStartTurn: number | undefined;
  const tranches = new Map<CreditBandId, { outstanding: number; rate: number }>();
  const sovereignLots: SimBond[] = openingSeedTranches.map((tranche) => ({
    bondId: `USD-seed-${tranche.maturityTurns}`,
    issuedTurn: 0,
    maturityTurn: tranche.maturityTurns,
    couponRate: tranche.couponRate,
    totalUnits: tranche.units,
    floatUnits: tranche.units,
    heldUnits: 0,
  }));
  // The registered pool migration seeds cash at its current M2 target. Zero is
  // an explicit sensitivity, not the normal seeded-world opening state.
  let poolCash = scenario.openingPoolCash ?? conservativePoolCashSeed;
  let poolTargetCash = poolCash > 0 ? conservativePoolCashSeed : 0;
  let poolCashInflow = 0;
  let poolCashSweep = 0;
  let treasuryCash = 0;
  let couponsReceived = 0;
  let treasuryPosition = us1991Budget.treasuryBalance;
  let sovereignPrincipal = us1991Budget.debt.principal;
  let annualBudgetInterest = us1991Budget.spending.debtInterest;
  let bankCouponClaimsDueTotal = 0;
  let publicFloatCouponClaimsDueTotal = 0;
  let bankMaturityPrincipalDueTotal = 0;
  let paidMaturityPrincipal = 0;
  let billCouponIncomeThisTurn = 0;
  let realizedBillGainThisTurn = 0;
  let realizedBillGainLifetime = 0;
  let cumulativeNetIncome = 0;
  let maximumCashConservationError = 0;
  let maximumEquityBridgeError = 0;
  const initialSystemCash = cash + externalCash + poolCash;
  const pendingCouponClaims: PendingCouponClaim[] = [];
  let paidPublicFloatCoupons = 0;
  const pendingMaturities: PendingMaturityClaim[] = [];
  let poolMaturityPrincipalDueTotal = 0;
  let paidPoolMaturityPrincipal = 0;
  let novatedPoolPrincipal = 0;
  let poolPurchaseAndSaleUnits = 0;
  let poolSaleCashPaid = 0;
  let forcedSaleUnits = 0;
  let lastNetIncome = 0;
  const equityHistory: number[] = [];
  const incomeHistory: number[] = [];
  let realizedRecessionWriteoff = 0;
  let warningBand: "green" | "amber" | "red" = "green";
  let failureTurn: number | null = null;
  let failureCause: "negative_equity" | "deposit_run" | null = null;
  let failureInsurancePayout = 0;
  let failureTreasuryBackstopRequired = 0;
  let failureTreasuryBackstopPaid = 0;
  let failureUnfundedBackstop = 0;
  let totalDepositFlight = 0;
  let turnTwelveSnapshot: Record<string, number> = {};

  // Production freezes bank coupon claims per charter epoch and turn, not
  // jointly with a bond's public float. Each funded claim can settle even if a
  // different claim is too large for the remaining Treasury cash.
  const settleBankClaims = () => {
    const couponTurns = [
      ...new Set(
        pendingCouponClaims.filter((claim) => claim.bankLocal > 0).map((claim) => claim.dueTurn)
      ),
    ];
    const bankClaims = [
      ...couponTurns.map((dueTurn) => ({
        kind: "coupon" as const,
        dueTurn,
        id: `bank-sovereign-coupon:${dueTurn}`,
        amount: round2(
          pendingCouponClaims
            .filter((claim) => claim.dueTurn === dueTurn)
            .reduce((sum, claim) => sum + claim.bankLocal, 0)
        ),
      })),
      ...pendingMaturities
        .filter((claim) => claim.bankLocal > 0)
        .map((claim) => ({
          kind: "maturity" as const,
          dueTurn: claim.dueTurn,
          id: `bank-sovereign-maturity:${claim.bondId}`,
          amount: claim.bankLocal,
          maturity: claim,
        })),
    ].sort((left, right) => left.dueTurn - right.dueTurn || left.id.localeCompare(right.id));
    for (const claim of bankClaims) {
      if (treasuryCash < claim.amount) continue;
      treasuryCash -= claim.amount;
      treasuryPosition -= claim.amount;
      cash += claim.amount;
      if (claim.kind === "coupon") {
        couponsReceived += claim.amount;
        billCouponIncomeThisTurn += claim.amount;
        for (const row of pendingCouponClaims) if (row.dueTurn === claim.dueTurn) row.bankLocal = 0;
      } else {
        const realizedGain = claim.amount - claim.maturity.bankCostBasisLocal;
        realizedBillGainThisTurn += realizedGain;
        realizedBillGainLifetime += realizedGain;
        claim.maturity.bankCostBasisLocal = 0;
        paidMaturityPrincipal += claim.amount;
        claim.maturity.bankLocal = 0;
        // The original bond holder snapshot remains frozen until the final
        // nonbank payout, but paid principal is no longer a bank asset.
        const bond = sovereignLots.find((row) => row.bondId === claim.maturity.bondId);
        if (bond) {
          bond.heldUnits = 0;
          bond.heldCostLocal = 0;
        }
      }
    }
  };

  const settlePublicFloatCoupons = () => {
    for (const claim of pendingCouponClaims) {
      if (!(claim.publicFloatLocal > 0) || treasuryCash < claim.publicFloatLocal) continue;
      treasuryCash -= claim.publicFloatLocal;
      poolCash += claim.publicFloatLocal;
      paidPublicFloatCoupons += claim.publicFloatLocal;
      claim.publicFloatLocal = 0;
    }
    for (let index = pendingCouponClaims.length - 1; index >= 0; index -= 1) {
      const claim = pendingCouponClaims[index]!;
      if (claim.bankLocal === 0 && claim.publicFloatLocal === 0)
        pendingCouponClaims.splice(index, 1);
    }
  };

  const settleNonBankMaturity = (claim: PendingMaturityClaim) => {
    if (claim.bankLocal > 0 || treasuryCash < claim.publicFloatLocal) return;
    treasuryCash -= claim.publicFloatLocal;
    poolCash += claim.publicFloatLocal;
    paidPoolMaturityPrincipal += claim.publicFloatLocal;
    treasuryPosition -= claim.publicFloatLocal;
    // Production retires the original entire principal only after every bank
    // claim and the frozen nonbank quote have completed their funded payouts.
    sovereignPrincipal = Math.max(0, sovereignPrincipal - claim.originalFaceLocal);
    annualBudgetInterest = Math.max(0, annualBudgetInterest - claim.annualCouponCost);
    const bond = sovereignLots.find((row) => row.bondId === claim.bondId);
    if (bond) {
      bond.heldUnits = 0;
      bond.floatUnits = 0;
      bond.maturityPaid = true;
    }
    pendingMaturities.splice(pendingMaturities.indexOf(claim), 1);
  };

  const assertCashConservation = () => {
    const observed = cash + externalCash + poolCash + treasuryCash + insuranceFundBalance;
    const expected = initialSystemCash + poolCashInflow - poolCashSweep;
    const error = Math.abs(observed - expected);
    maximumCashConservationError = Math.max(maximumCashConservationError, error);
    if (error > 1) throw new Error(`Unpaired model cash movement in ${scenario.name}: ${error}`);
  };
  for (let turn = 0; turn < scenario.turns; turn += 1) {
    billCouponIncomeThisTurn = 0;
    realizedBillGainThisTurn = 0;
    const prime =
      scenario.recessionShock && turn >= scenario.recessionShock.turn
        ? scenario.prime + scenario.recessionShock.primeIncreasePp
        : scenario.prime;
    // TreasuryTurn runs before bank actions and BondTurn. The signed fiscal
    // position remains a separate analytical track. Funded claims draw only
    // spendable cash credited by actual pool-funded issuance.
    const dueCouponClaims = sovereignLots
      .filter(
        (bond) =>
          bond.issuedTurn < turn &&
          !bond.maturityPaid &&
          bond.maturityTurn >= turn &&
          bond.heldUnits + bond.floatUnits > 0
      )
      .sort((left, right) => left.bondId.localeCompare(right.bondId))
      .map((bond) => ({
        bondId: bond.bondId,
        dueTurn: turn,
        bankLocal: perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * bond.heldUnits,
        publicFloatLocal:
          perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE) * bond.floatUnits,
      }))
      .filter((claim) => claim.bankLocal + claim.publicFloatLocal > 0);
    pendingCouponClaims.push(...dueCouponClaims);
    const openingBankCouponDue = dueCouponClaims.reduce((sum, claim) => sum + claim.bankLocal, 0);
    bankCouponClaimsDueTotal += openingBankCouponDue;
    publicFloatCouponClaimsDueTotal += dueCouponClaims.reduce(
      (sum, claim) => sum + claim.publicFloatLocal,
      0
    );
    const debtRate = sovereignDebtTerms(sovereignPrincipal, {
      gdp: us1991Budget.gdp,
      gdpSmoothed: us1991Budget.gdpSmoothed,
      investorConfidence: us1991Budget.investorConfidence,
      imfBailoutActive: us1991Budget.imfSovereignBailoutActive,
      sovereignRiskAnchor: us1991Budget.sovereignRiskAnchor,
    }).interestRate;
    const debtService = (sovereignPrincipal * debtRate) / TURNS_PER_YEAR;
    const bankCouponReserve = Math.min(debtService, openingBankCouponDue);
    const nonBankFiscalCashDelta =
      us1991AnnualPrimaryBalance / TURNS_PER_YEAR - (debtService - bankCouponReserve);
    treasuryPosition = Math.round(treasuryPosition + nonBankFiscalCashDelta);
    // TreasuryTurn pays bank coupon and prior maturity claims first, then
    // nonbank coupon claims. Nonbank principal waits for BondTurn below.
    settleBankClaims();
    settlePublicFloatCoupons();
    const rates = effectiveBankRatesFromPrime(
      { depositOffset: scenario.depositOffset, lendingOffset: scenario.lendingOffset },
      prime
    );
    const cbApy = savingsApyPercent(prime, scenario.inflation, 0);
    const depositShare =
      computeNpcDepositShare(
        [
          {
            bankId: "model-bank",
            effectiveDepositRatePercent:
              rates.depositRatePercent - (scenario.serviceFeeAnnualBps ?? 0) / 100,
          },
        ],
        cbApy
      )[0]?.share ?? 0;
    const loansBefore = sumLoans(tranches);
    const bondMarkBefore = sovereignLots.reduce((sum, bond) => {
      if (bond.heldUnits <= 0 || bond.maturityTurn <= turn) return sum;
      const quote = quoteSimBond(bond, turn, prime, poolCash, poolTargetCash);
      return sum + Math.round(quote.bid * BOND_UNIT_FACE_VALUE * bond.heldUnits * 100) / 100;
    }, 0);
    const equityBefore = cash + loansBefore + bondMarkBefore - deposits;
    const targetDeposits = Math.min(
      depositShare * externalCash,
      Math.max(0, equityBefore) * 12,
      branchDepositCeiling
    );
    const depositDelta = Math.max(npcFlowDelta(deposits, targetDeposits), -cash);
    cash += depositDelta;
    deposits += depositDelta;
    externalCash = Math.max(0, externalCash - depositDelta);

    const depositInterest = perTurnInterest(deposits, rates.depositRatePercent, "USD");
    deposits += depositInterest;
    const serviceFee = Math.min(
      deposits,
      (deposits * (scenario.serviceFeeAnnualBps ?? 0)) / 10_000 / TURNS_PER_YEAR
    );
    deposits -= serviceFee;
    serviceFeeIncome += serviceFee;
    if (deposits > 0 && pricingEvidenceStartTurn === undefined) pricingEvidenceStartTurn = turn;
    const evidencePremiumRate = computeEvidenceBasedPremiumAnnualRate({
      currentTurn: turn,
      firstMeasuredTurn: pricingEvidenceStartTurn ?? turn,
      insuredDepositTurns: measuredInsuredDepositTurns,
      paidClaims: measuredPaidClaims,
      grossPayouts: measuredGrossClaims,
      recoveries: measuredRecoveries,
      fundBalance: insuranceFundBalance,
    });
    const premiumBaseRate = scenario.insurancePremiumBaseAnnualRate ?? evidencePremiumRate;
    const premium = computeInsurancePremium(
      deposits,
      cash / Math.max(1, deposits),
      RESERVE_RATIO,
      premiumBaseRate
    );
    const premiumPaid = Math.min(premium, Math.max(0, cash));
    cash -= premiumPaid;
    premiumExpense += premiumPaid;
    insuranceFundBalance += premiumPaid;
    // Normalize exposure to the existing risk-weight formula at a 100% annual
    // base rate. This lets the report show the scenario rate needed to fund
    // one comparable failure claim without presenting it as a probability.
    premiumExposureEquivalentDepositTurns += (premium * TURNS_PER_YEAR) / BASE_PREMIUM_ANNUAL;
    measuredInsuredDepositTurns += deposits;

    const fundingCapacity = deposits * (1 - RESERVE_RATIO);
    const targets = bandOriginationTargets({
      fundingCapacity,
      lendingRatePercent: rates.lendingRatePercent,
      primeRatePercent: prime,
      profile: scenario.profile,
    });
    let loanInterest = 0;
    let defaultLoss = 0;
    let feesThisTurn = serviceFee;
    for (const target of targets) {
      const existing = tranches.get(target.band);
      if (!target.open && !existing) continue;
      const outstanding = existing?.outstanding ?? 0;
      const rate = existing?.rate ?? target.ratePercent;
      const principalDelta = fundedNpcFlowDelta(outstanding, target.target, {
        cashReserves: cash,
        requiredReserves: deposits * RESERVE_RATIO,
        householdPool: externalCash,
      });
      const origination = principalDelta > 0 ? quoteLoanOrigination(principalDelta, "USD") : null;
      const proceeds = origination?.proceeds ?? Math.max(0, principalDelta);
      const fundedPrincipalCash = principalDelta > 0 ? proceeds : principalDelta;
      cash -= fundedPrincipalCash;
      externalCash += fundedPrincipalCash;
      feesThisTurn += origination?.originationFee ?? 0;

      const nextOutstanding = Math.max(0, outstanding + principalDelta);
      const interest = perTurnInterest(nextOutstanding, rate, "USD");
      const defaults = perTurnInterest(
        nextOutstanding,
        getCreditBand(target.band).defaultRatePercent *
          (scenario.recessionShock && turn >= scenario.recessionShock.turn
            ? (scenario.recessionShock.defaultRateMultiplier ?? 1)
            : 1),
        "USD"
      );
      const affordableInterest = Math.min(interest, Math.max(0, externalCash));
      loanInterest += affordableInterest;
      defaultLoss += defaults;
      cash += affordableInterest;
      externalCash -= affordableInterest;
      tranches.set(target.band, { outstanding: Math.max(0, nextOutstanding - defaults), rate });
    }
    if (scenario.recessionShock?.applyStressLoss && turn === scenario.recessionShock.turn) {
      const lossFraction = stressLossFraction(
        [...tranches.entries()].map(([creditBand, tranche]) => ({
          creditBand,
          outstanding: tranche.outstanding,
        }))
      );
      for (const [creditBand, tranche] of tranches) {
        const loss = tranche.outstanding * lossFraction;
        realizedRecessionWriteoff += loss;
        tranches.set(creditBand, { ...tranche, outstanding: tranche.outstanding - loss });
      }
      defaultLoss += realizedRecessionWriteoff;
    }
    feeIncome += feesThisTurn;
    if (scenario.treasuryAutoSweep) {
      const dueInterestInput = {
        currency: "USD" as const,
        primeRate: prime,
        inflationRate: scenario.inflation,
        depositOffset: scenario.depositOffset,
        npcDeposits: deposits,
        totalDeposits: deposits,
        playerDeposits: 0,
        playerDepositsAreLiabilities: true,
        discountWindowDebt: 0,
        cbMarginDebt: 0,
        interbankLoans: [],
      };
      const cashFloor = computeBankTreasuryCashFloor({
        cashBackedDeposits: deposits,
        npcDeposits: deposits,
        reserveRatio: RESERVE_RATIO,
        nextTurnDueInterest: computeBankTreasuryDueInterest(dueInterestInput),
      }).floorLocal;
      const fundingRate = computeBankTreasuryFundingRatePercent(dueInterestInput);
      const quotes = sovereignLots.map((bond, index) =>
        quoteBankTreasuryBond({
          bond: {
            _id: new ObjectId(index.toString(16).padStart(24, "0")),
            issuerType: "sovereign",
            countryId: "US",
            currencyCode: "USD",
            marketPrice: bond.marketPrice ?? 1,
            couponRate: bond.couponRate,
            maturityTurn: bond.maturityTurn,
            matured: bond.maturityPaid === true,
            defaulted: false,
            publicFloat: bond.floatUnits,
          },
          currency: "USD",
          currentTurn: turn,
          poolCashLocal: poolCash,
          poolTargetCashLocal: poolTargetCash,
          appetite: 1,
        })
      );
      const plans = scenario.legacyTreasurySweep
        ? [...quotes]
            .filter((quote) => quote.eligible)
            .sort((a, b) => a.remainingTurns - b.remainingTurns || a.bondId.localeCompare(b.bondId))
            .map((quote) => ({
              ...quote,
              units: Math.floor(Math.max(0, cash - cashFloor) / quote.askPerUnitLocal),
            }))
        : planBankTreasurySweep(quotes, cash, cashFloor, fundingRate);
      for (const plan of plans) {
        const index = Number.parseInt(plan.bondId, 16);
        const bond = sovereignLots[index]!;
        // Like the shell, re-read cash and quote after preceding trades.
        const freshQuote = quoteBankTreasuryBond({
          bond: {
            _id: new ObjectId(plan.bondId),
            issuerType: "sovereign",
            countryId: "US",
            currencyCode: "USD",
            marketPrice: bond.marketPrice ?? 1,
            couponRate: bond.couponRate,
            maturityTurn: bond.maturityTurn,
            matured: bond.maturityPaid === true,
            defaulted: false,
            publicFloat: bond.floatUnits,
          },
          currency: "USD",
          currentTurn: turn,
          poolCashLocal: poolCash,
          poolTargetCashLocal: poolTargetCash,
          appetite: 1,
        });
        if (
          !scenario.legacyTreasurySweep &&
          (!Number.isFinite(freshQuote.annualizedContractYieldPercent) ||
            freshQuote.annualizedContractYieldPercent <= fundingRate)
        )
          continue;
        const ask = freshQuote.askPerUnitLocal;
        const holderCap = Math.floor(SOVEREIGN_BOND_HOLDER_CAP * bond.totalUnits);
        const units = Math.min(
          plan.units,
          bond.floatUnits,
          Math.max(0, holderCap - bond.heldUnits),
          Math.floor(Math.max(0, cash - cashFloor) / ask)
        );
        if (units <= 0 || !(ask > 0)) continue;
        const cost = round2(units * ask);
        cash -= cost;
        poolCash += cost;
        bond.floatUnits -= units;
        bond.heldUnits += units;
        bond.heldCostLocal = (bond.heldCostLocal ?? 0) + cost;
        poolPurchaseAndSaleUnits += units;
      }

      if (cash < cashFloor) {
        let shortfall = cashFloor - cash;
        for (const bond of [...sovereignLots].sort(
          (a, b) => a.maturityTurn - b.maturityTurn || a.bondId.localeCompare(b.bondId)
        )) {
          if (shortfall <= 0 || bond.heldUnits <= 0 || bond.maturityTurn <= turn) continue;
          const quote = quoteSimBond(bond, turn, prime, poolCash, poolTargetCash);
          const bid = Math.round(quote.bid * BOND_UNIT_FACE_VALUE * 100) / 100;
          if (!(bid > 0)) continue;
          const units = Math.min(
            bond.heldUnits,
            Math.ceil(shortfall / bid),
            Math.floor(poolCash / bid)
          );
          if (units <= 0) continue;
          const proceeds = Math.round(units * bid * 100) / 100;
          const disposedCost = ((bond.heldCostLocal ?? 0) * units) / bond.heldUnits;
          const realizedGain = proceeds - disposedCost;
          realizedBillGainThisTurn += realizedGain;
          realizedBillGainLifetime += realizedGain;
          bond.heldCostLocal = Math.max(0, (bond.heldCostLocal ?? 0) - disposedCost);
          cash += proceeds;
          poolCash -= proceeds;
          bond.heldUnits -= units;
          bond.floatUnits += units;
          shortfall = Math.max(0, cashFloor - cash);
          poolPurchaseAndSaleUnits += units;
          poolSaleCashPaid += proceeds;
          forcedSaleUnits += units;
        }
      }
    }

    lastNetIncome =
      loanInterest +
      feesThisTurn +
      billCouponIncomeThisTurn -
      depositInterest -
      premiumPaid -
      defaultLoss;
    // Trading sees the stored prior BondTurn mid. This phase refreshes marks
    // before the solvency pass, including the current rate shock.
    for (const bond of sovereignLots) {
      bond.marketPrice = calculateBondMarketPrice(
        bond.couponRate,
        prime,
        bond.maturityTurn - turn,
        false
      );
    }
    // BondTurn places scheduled sovereign issuance before pool maintenance.
    if (turn > 0 && turn % SOVEREIGN_ISSUANCE_INTERVAL_TURNS === 0) {
      const rolloverFace = sovereignRolloverFromBonds(
        sovereignLots
          .filter((bond) => !bond.maturityPaid)
          .map((bond) => ({
            maturityTurn: bond.maturityTurn,
            totalIssued: bond.totalUnits * BOND_UNIT_FACE_VALUE,
          })),
        sovereignPrincipal,
        turn
      );
      const annualDeficit = Math.max(
        0,
        us1991Budget.spending.total -
          us1991Budget.spending.debtInterest +
          annualBudgetInterest -
          us1991Budget.revenue.total
      );
      const issueAmount = calculateQuarterlyIssuanceAmount(annualDeficit) + rolloverFace;
      const planned = planSovereignTranches(SOVEREIGN_RECONCILE_DISTRIBUTION, issueAmount);
      for (const tranche of planned) {
        const requestedUnits = Math.floor(tranche.amount / BOND_UNIT_FACE_VALUE);
        const underwriting = planSovereignUnderwriting({
          requestedUnits,
          poolCashLocal: poolCash,
          appetite: 1,
          pricePerUnitLocal: BOND_UNIT_FACE_VALUE,
        });
        const fundedUnits = underwriting.placedUnits;
        if (fundedUnits <= 0) continue;
        const couponRate = getSovereignCouponRate(prime, tranche.maturityTurns);
        const lot: SimBond = {
          bondId: `USD-${turn}-${tranche.maturityTurns}`,
          issuedTurn: turn,
          maturityTurn: turn + tranche.maturityTurns,
          couponRate,
          totalUnits: fundedUnits,
          floatUnits: fundedUnits,
          heldUnits: 0,
        };
        poolCash -= fundedUnits * BOND_UNIT_FACE_VALUE;
        const fundedFace = fundedUnits * BOND_UNIT_FACE_VALUE;
        treasuryPosition += fundedFace;
        treasuryCash += fundedFace;
        sovereignPrincipal += fundedFace;
        annualBudgetInterest += (fundedFace * couponRate) / 100;
        sovereignLots.push(lot);
      }
    }

    // The production pool target is max(calibrated 5% M2 liquidity,
    // outstanding sovereign face due over the next issuance interval). The
    // inflow is applied after scheduled issuance and cannot fund that auction.
    const rolloverTarget = sovereignLots
      .filter(
        (bond) =>
          !bond.maturityPaid &&
          bond.maturityTurn >= turn &&
          bond.maturityTurn < turn + SOVEREIGN_ISSUANCE_INTERVAL_TURNS
      )
      .reduce((sum, bond) => sum + bond.totalUnits * BOND_UNIT_FACE_VALUE, 0);
    const poolTarget = Math.max(conservativePoolCashSeed, rolloverTarget);
    poolTargetCash = poolTarget;
    const cashMoves = planPoolCashMoves({ cashLocal: poolCash, targetCashLocal: poolTarget });
    if (cashMoves.inflow > 0) {
      poolCash += cashMoves.inflow;
      poolCashInflow += cashMoves.inflow;
    }
    if (cashMoves.sweep > 0) {
      const swept = Math.min(poolCash, cashMoves.sweep);
      poolCash -= swept;
      poolCashSweep += swept;
    }

    // The real maturity loop creates one due quote, pays that bond's bank
    // claims, then attempts its nonbank payout before moving to the next bond.
    for (const bond of sovereignLots) {
      if (bond.maturityTurn > turn || bond.maturityPaid) continue;
      if (!bond.maturityRegistered) {
        const bankPrincipalDue = bond.heldUnits * BOND_UNIT_FACE_VALUE;
        const poolPrincipalDue = bond.floatUnits * BOND_UNIT_FACE_VALUE;
        pendingMaturities.push({
          bondId: bond.bondId,
          dueTurn: bond.maturityTurn,
          originalFaceLocal: bond.totalUnits * BOND_UNIT_FACE_VALUE,
          annualCouponCost: (bond.totalUnits * BOND_UNIT_FACE_VALUE * bond.couponRate) / 100,
          bankCostBasisLocal: bond.heldCostLocal ?? 0,
          bankLocal: bankPrincipalDue,
          publicFloatLocal: poolPrincipalDue,
        });
        bankMaturityPrincipalDueTotal += bankPrincipalDue;
        poolMaturityPrincipalDueTotal += poolPrincipalDue;
        bond.maturityRegistered = true;
      }
      settleBankClaims();
      const claim = pendingMaturities.find((row) => row.bondId === bond.bondId);
      if (claim && !claim.dispositionRegistered) {
        claim.dispositionRegistered = true;
        const disposition = planPublicFloatNovation({
          sourceUnits: claim.publicFloatLocal / BOND_UNIT_FACE_VALUE,
          sourceCurrency: "USD",
          replacementCurrency: "USD",
          sourceFacePerUnitLocal: BOND_UNIT_FACE_VALUE,
          replacementPricePerUnitLocal: BOND_UNIT_FACE_VALUE,
          appetite: scenario.publicFloatCashOnly ? undefined : 1,
          maturityTurns: TURNS_PER_YEAR,
        });
        if (disposition.acceptedUnits > 0) {
          const face = disposition.faceLocal;
          const newAnnualCoupon = (face * prime) / 100;
          const oldAnnualCoupon = (face * bond.couponRate) / 100;
          claim.publicFloatLocal -= face;
          claim.originalFaceLocal -= face;
          claim.annualCouponCost -= oldAnnualCoupon;
          bond.floatUnits -= disposition.acceptedUnits;
          bond.totalUnits -= disposition.acceptedUnits;
          annualBudgetInterest += newAnnualCoupon - oldAnnualCoupon;
          novatedPoolPrincipal += face;
          sovereignLots.push({
            bondId: `${bond.bondId}-novation-${turn}`,
            issuedTurn: turn,
            maturityTurn: turn + TURNS_PER_YEAR,
            couponRate: prime,
            marketPrice: 1,
            totalUnits: disposition.acceptedUnits,
            floatUnits: disposition.acceptedUnits,
            heldUnits: 0,
          });
        }
      }
      if (claim) settleNonBankMaturity(claim);
    }
    if (turn === 11) {
      turnTwelveSnapshot = {
        bankCash: Math.round(cash),
        deposits: Math.round(deposits),
        loans: Math.round(sumLoans(tranches)),
        heldBillUnits: sovereignLots.reduce((sum, bond) => sum + bond.heldUnits, 0),
        heldBillMark: Math.round(
          sovereignLots.reduce((sum, bond) => {
            if (bond.heldUnits <= 0 || bond.maturityTurn <= turn) return sum;
            const quote = quoteSimBond(bond, turn, prime, poolCash, poolTargetCash);
            return sum + quote.bid * BOND_UNIT_FACE_VALUE * bond.heldUnits;
          }, 0)
        ),
        poolCash: Math.round(poolCash),
        fundedTreasuryCash: Math.round(treasuryCash),
        bankCouponsPaid: Math.round(couponsReceived),
        bankCouponsDue: Math.round(bankCouponClaimsDueTotal),
        unpaidBankCoupons: Math.round(
          pendingCouponClaims.reduce((sum, claim) => sum + claim.bankLocal, 0)
        ),
        unpaidPublicFloatCoupons: Math.round(
          pendingCouponClaims.reduce((sum, claim) => sum + claim.publicFloatLocal, 0)
        ),
      };
    }

    // Match the production solvency pass. The warning band from the prior
    // pass controls today's withdrawal run, then this turn's score becomes the
    // stored band for the next pass. Funded bill value is marked at the
    // executable pool bid and does not count as cash for the run line.
    const priorBand = warningBand;
    const loansAtSolvency = sumLoans(tranches);
    const maturedGovernmentReceivableAtSolvency = pendingMaturities.reduce(
      (sum, claim) => sum + claim.bankLocal,
      0
    );
    const billMarkAtSolvency = sovereignLots.reduce((sum, bond) => {
      if (bond.heldUnits <= 0 || bond.maturityTurn <= turn) return sum;
      const quote = quoteSimBond(bond, turn, prime, poolCash, poolTargetCash);
      return sum + Math.round(quote.bid * BOND_UNIT_FACE_VALUE * bond.heldUnits * 100) / 100;
    }, 0);
    const confidence = computeConfidence({
      cashReserves: cash,
      cashBackedDeposits: deposits,
      totalLoans: loansAtSolvency,
      reserveRatioRequired: RESERVE_RATIO,
      arrearsOutstanding: 0,
      defaultsLastTurn: defaultLoss,
      panicTurns: 0,
    });
    if (priorBand === "amber" || priorBand === "red") {
      const flight = depositFlight({ priorBand, npcDeposits: deposits, cashReserves: cash });
      cash -= flight;
      deposits -= flight;
      externalCash += flight;
      totalDepositFlight += flight;
    }
    const netAssets =
      cash +
      loansAtSolvency +
      billMarkAtSolvency +
      maturedGovernmentReceivableAtSolvency -
      deposits;
    // Payouts at BondTurn can complete coupons that TreasuryTurn could not
    // fund earlier. Count the whole turn and measure a full year, not one
    // possibly empty coupon-payment turn multiplied by 48.
    lastNetIncome =
      feesThisTurn +
      loanInterest +
      billCouponIncomeThisTurn -
      depositInterest -
      premiumPaid -
      defaultLoss;
    lastNetIncome += realizedBillGainThisTurn;
    incomeHistory.push(lastNetIncome);
    cumulativeNetIncome += lastNetIncome;
    const billCostBasis = sovereignLots.reduce(
      (sum, bond) => sum + (bond.maturityRegistered ? 0 : (bond.heldCostLocal ?? 0)),
      0
    );
    const maturedCostBasis = pendingMaturities.reduce(
      (sum, claim) => sum + claim.bankCostBasisLocal,
      0
    );
    const unrealizedBillGain =
      billMarkAtSolvency + maturedGovernmentReceivableAtSolvency - billCostBasis - maturedCostBasis;
    const equityBridgeError = Math.abs(
      netAssets - openingEquity - cumulativeNetIncome - unrealizedBillGain
    );
    maximumEquityBridgeError = Math.max(maximumEquityBridgeError, equityBridgeError);
    if (equityBridgeError > 1)
      throw new Error(
        `Unexplained bank equity in ${scenario.name} turn${turn}: ${equityBridgeError}`
      );
    equityHistory.push(netAssets);
    assertCashConservation();
    const failed = depositTakerFails({
      priorBand,
      cashReserves: cash,
      requiredLiquidity: RESERVE_RATIO * deposits,
      netAssets,
    });
    warningBand = confidence.band;
    if (failed) {
      failureTurn = turn;
      failureCause = netAssets < -0.01 ? "negative_equity" : "deposit_run";
      // The real failed estate liquidates eligible bank Treasury holdings
      // into the funded pool before sizing the insurance shortfall.
      for (const bond of sovereignLots) {
        if (bond.heldUnits <= 0 || bond.maturityTurn <= turn) continue;
        const quote = quoteSimBond(bond, turn, prime, poolCash, poolTargetCash);
        const bid = round2(quote.bid * BOND_UNIT_FACE_VALUE);
        if (!(bid > 0)) continue;
        const units = Math.min(bond.heldUnits, Math.floor(poolCash / bid));
        const proceeds = round2(units * bid);
        bond.heldUnits -= units;
        bond.floatUnits += units;
        cash += proceeds;
        poolCash -= proceeds;
      }
      const depositShortfall = Math.max(0, deposits - Math.max(0, cash));
      const insuranceRequired = Math.min(insuranceFundBalance, depositShortfall);
      failureTreasuryBackstopRequired = depositShortfall - insuranceRequired;
      // ensureTreasuryInsuranceCash uses actual positive cash first and then
      // pool-funded issuance. It does not reserve all other unpaid sovereign
      // claims against that cash before attempting the insurance obligation.
      if (treasuryCash < failureTreasuryBackstopRequired) {
        const issueAmount =
          Math.ceil((failureTreasuryBackstopRequired - treasuryCash) / BOND_UNIT_FACE_VALUE) *
          BOND_UNIT_FACE_VALUE;
        for (const tranche of planSovereignTranches(
          SOVEREIGN_RECONCILE_DISTRIBUTION,
          issueAmount
        )) {
          const placed = planSovereignUnderwriting({
            requestedUnits: Math.floor(tranche.amount / BOND_UNIT_FACE_VALUE),
            poolCashLocal: poolCash,
            appetite: 1,
            pricePerUnitLocal: BOND_UNIT_FACE_VALUE,
          }).placedUnits;
          if (placed <= 0) continue;
          const face = placed * BOND_UNIT_FACE_VALUE;
          const couponRate = getSovereignCouponRate(prime, tranche.maturityTurns);
          poolCash -= face;
          treasuryCash += face;
          treasuryPosition += face;
          sovereignPrincipal += face;
          annualBudgetInterest += (face * couponRate) / 100;
          sovereignLots.push({
            bondId: `USD-insurance-${turn}-${tranche.maturityTurns}`,
            issuedTurn: turn,
            maturityTurn: turn + tranche.maturityTurns,
            couponRate,
            totalUnits: placed,
            floatUnits: placed,
            heldUnits: 0,
          });
        }
      }
      const resolutionFunded = treasuryCash >= failureTreasuryBackstopRequired;
      failureInsurancePayout = resolutionFunded ? insuranceRequired : 0;
      failureTreasuryBackstopPaid = resolutionFunded ? failureTreasuryBackstopRequired : 0;
      failureUnfundedBackstop = failureTreasuryBackstopRequired - failureTreasuryBackstopPaid;
      const actualPaidClaim = failureInsurancePayout + failureTreasuryBackstopPaid;
      if (actualPaidClaim > 0 && pricingEvidenceStartTurn !== undefined) {
        measuredGrossClaims += actualPaidClaim;
        measuredPaidClaims += 1;
      }
      insuranceFundBalance -= failureInsurancePayout;
      treasuryCash -= failureTreasuryBackstopPaid;
      if (resolutionFunded) {
        const fromBankCash = Math.min(deposits, Math.max(0, cash));
        cash -= fromBankCash;
        externalCash += fromBankCash + actualPaidClaim;
        deposits = 0;
      }
      assertCashConservation();
      break;
    }
  }

  const totalLoans = sumLoans(tranches);
  const finalTurn = failureTurn ?? scenario.turns - 1;
  const primeAtEnd =
    scenario.recessionShock && finalTurn >= scenario.recessionShock.turn
      ? scenario.prime + scenario.recessionShock.primeIncreasePp
      : scenario.prime;
  const finalRates = effectiveBankRatesFromPrime(
    { depositOffset: scenario.depositOffset, lendingOffset: scenario.lendingOffset },
    primeAtEnd
  );
  const finalSavingsApy = savingsApyPercent(primeAtEnd, scenario.inflation, 0);
  const endingBillMark = sovereignLots.reduce((sum, bond) => {
    if (bond.heldUnits <= 0) return sum;
    const quote = quoteSimBond(bond, finalTurn, primeAtEnd, poolCash, poolTargetCash);
    return sum + Math.round(quote.bid * BOND_UNIT_FACE_VALUE * bond.heldUnits * 100) / 100;
  }, 0);
  const unpaidMaturityClaims = pendingMaturities.reduce((sum, claim) => sum + claim.bankLocal, 0);
  const unpaidPoolMaturityClaims = pendingMaturities.reduce(
    (sum, claim) => sum + claim.publicFloatLocal,
    0
  );
  // Matured but unfunded principal remains a government receivable, not bank
  // cash. Keep it visible in equity and separate from executable liquidity.
  const endingEquity =
    failureTurn === null
      ? cash + totalLoans + endingBillMark + unpaidMaturityClaims - deposits
      : equityHistory.at(-1)!;
  const recentIncome = incomeHistory.slice(-TURNS_PER_YEAR);
  const lastAnnualIncome =
    (recentIncome.reduce((sum, income) => sum + income, 0) * TURNS_PER_YEAR) /
    Math.max(1, recentIncome.length);
  const recentEquity = equityHistory.slice(-TURNS_PER_YEAR);
  const averageYearEquity =
    recentEquity.reduce((sum, equity) => sum + equity, 0) / Math.max(1, recentEquity.length);
  const yearOpeningEquity =
    equityHistory.length > TURNS_PER_YEAR
      ? equityHistory[equityHistory.length - TURNS_PER_YEAR - 1]!
      : openingEquity;
  const annualEconomicGain =
    ((endingEquity - yearOpeningEquity) * TURNS_PER_YEAR) / Math.max(1, recentEquity.length);
  const stressLoss = stressLossFraction(
    [...tranches.entries()].map(([band, loan]) => ({
      creditBand: band,
      outstanding: loan.outstanding,
    }))
  );
  const regulatoryCapital = cash + endingBillMark;
  const riskAssets = totalLoans + endingBillMark;
  const capitalRatio = riskAssets > 0 ? regulatoryCapital / riskAssets : 1;
  const stressedRiskAssets = riskAssets * (1 - stressLoss);
  const stressedCapitalRatio =
    stressedRiskAssets > 0
      ? (regulatoryCapital - riskAssets * stressLoss) / stressedRiskAssets
      : regulatoryCapital > 0
        ? 1
        : 0;
  const supervisoryStanding =
    failureTurn !== null
      ? "failed"
      : capitalRatio < MIN_CAPITAL_RATIO
        ? "undercapitalized"
        : stressedCapitalRatio < STRESS_CAPITAL_RATIO
          ? "stressed"
          : "adequate";
  return {
    endingEquity: Math.round(endingEquity),
    equityAtFailureBeforeEstateLiquidation:
      failureTurn === null ? null : Math.round(equityHistory.at(-1) ?? endingEquity),
    depositorResolutionOutcome:
      failureTurn === null ? null : failureUnfundedBackstop > 0 ? "resolving" : "funded",
    deposits: Math.round(deposits),
    loans: Math.round(totalLoans),
    loanToDeposit: round3(totalLoans / Math.max(1, deposits)),
    finalDepositRatePercent: round2(finalRates.depositRatePercent),
    finalDepositRateAfterServiceFeePercent: round2(
      finalRates.depositRatePercent - (scenario.serviceFeeAnnualBps ?? 0) / 100
    ),
    finalSavingsApyPercent: round2(finalSavingsApy),
    finalNetDepositSpreadOverSavingsApyPp: round2(
      finalRates.depositRatePercent - (scenario.serviceFeeAnnualBps ?? 0) / 100 - finalSavingsApy
    ),
    depositOffsetInModernCorridor:
      scenario.depositOffset >= MODERN_DEPOSIT_CORRIDOR.minOffset &&
      scenario.depositOffset <= MODERN_DEPOSIT_CORRIDOR.maxOffset,
    serviceFeeAnnualBps: scenario.serviceFeeAnnualBps ?? 0,
    annualRoePercent:
      averageYearEquity > 0 ? round2((lastAnnualIncome / averageYearEquity) * 100) : null,
    annualEconomicRoePercent:
      averageYearEquity > 0 ? round2((annualEconomicGain / averageYearEquity) * 100) : null,
    equityCompoundAnnualGrowthPercent:
      endingEquity > 0
        ? round2(
            ((endingEquity / openingEquity) **
              (TURNS_PER_YEAR / Math.max(1, equityHistory.length)) -
              1) *
              100
          )
        : null,
    lastTurnAnnualizedIncomeOnEquityPercent:
      endingEquity > 0 ? round2(((lastNetIncome * TURNS_PER_YEAR) / endingEquity) * 100) : null,
    averageYearEquity: Math.round(averageYearEquity),
    yearOpeningEquity: Math.round(yearOpeningEquity),
    annualRealizedNetIncome: Math.round(lastAnnualIncome),
    realizedBillGainLifetime: Math.round(realizedBillGainLifetime),
    cumulativeNetIncome: Math.round(cumulativeNetIncome),
    maximumCashConservationError: round2(maximumCashConservationError),
    maximumEquityBridgeError: round2(maximumEquityBridgeError),
    annualIncomeOnInitialEquityPercent: round2((lastAnnualIncome / openingEquity) * 100),
    cumulativeFees: Math.round(feeIncome),
    cumulativeServiceFees: Math.round(serviceFeeIncome),
    cumulativePremiums: Math.round(premiumExpense),
    insurancePremiumBaseAnnualRatePercent:
      ((scenario.insurancePremiumBaseAnnualRate ?? BASE_PREMIUM_ANNUAL) * 10000) / 100,
    realizedRecessionWriteoff: Math.round(realizedRecessionWriteoff),
    turnsCompleted: failureTurn === null ? scenario.turns : failureTurn + 1,
    lifecycleOutcome: failureTurn === null ? "active" : "failed",
    failureTurn,
    failureCause,
    finalWarningBand: warningBand,
    totalDepositFlight: Math.round(totalDepositFlight),
    insuranceFundBalanceBeforeFailure: Math.round(insuranceFundBalance + failureInsurancePayout),
    failureInsurancePayout: Math.round(failureInsurancePayout),
    failureTreasuryBackstopRequired: Math.round(failureTreasuryBackstopRequired),
    failureTreasuryBackstopPaid: Math.round(failureTreasuryBackstopPaid),
    failureUnfundedBackstop: Math.round(failureUnfundedBackstop),
    stressEventFullyFundedBasePremiumAnnualPercent:
      failureTurn === null || premiumExposureEquivalentDepositTurns <= 0
        ? null
        : round2(
            ((failureInsurancePayout + failureTreasuryBackstopRequired) /
              premiumExposureEquivalentDepositTurns) *
              TURNS_PER_YEAR *
              100
          ),
    otherUnpaidTreasuryClaims: Math.round(
      pendingMaturities.reduce((sum, claim) => sum + claim.bankLocal + claim.publicFloatLocal, 0) +
        pendingCouponClaims.reduce(
          (sum, claim) => sum + claim.bankLocal + claim.publicFloatLocal,
          0
        )
    ),
    endingInsuranceFundBalance: Math.round(insuranceFundBalance),
    endingHouseholdExternalCash: Math.round(externalCash),
    outstandingPoolAndBankBillUnits: sovereignLots.reduce(
      (sum, bond) => sum + bond.floatUnits + bond.heldUnits,
      0
    ),
    eligibleShortPublicFloatUnits: sovereignLots.reduce(
      (sum, bond) =>
        sum +
        (bond.maturityTurn > finalTurn && bond.maturityTurn - finalTurn <= TURNS_PER_YEAR
          ? bond.floatUnits
          : 0),
      0
    ),
    heldFundedBillUnits: sovereignLots.reduce((sum, bond) => sum + bond.heldUnits, 0),
    fundedBillCouponCash: Math.round(couponsReceived),
    bankCouponClaimsDueTotal: Math.round(bankCouponClaimsDueTotal),
    unpaidBankCouponClaims: Math.round(
      pendingCouponClaims.reduce((sum, claim) => sum + claim.bankLocal, 0)
    ),
    publicFloatCouponClaimsDueTotal: Math.round(publicFloatCouponClaimsDueTotal),
    paidPublicFloatCoupons: Math.round(paidPublicFloatCoupons),
    unpaidPublicFloatCouponClaims: Math.round(
      pendingCouponClaims.reduce((sum, claim) => sum + claim.publicFloatLocal, 0)
    ),
    bankMaturityPrincipalDueTotal: Math.round(bankMaturityPrincipalDueTotal),
    unpaidBankMaturityPrincipal: Math.round(unpaidMaturityClaims),
    endingSignedFiscalPosition: Math.round(treasuryPosition),
    endingFundedTreasuryCash: Math.round(treasuryCash),
    paidMaturityPrincipal: Math.round(paidMaturityPrincipal),
    poolMaturityPrincipalDueTotal: Math.round(poolMaturityPrincipalDueTotal),
    unpaidPoolMaturityPrincipal: Math.round(unpaidPoolMaturityClaims),
    paidPoolMaturityPrincipal: Math.round(paidPoolMaturityPrincipal),
    novatedPoolPrincipal: Math.round(novatedPoolPrincipal),
    endingPoolCash: Math.round(poolCash),
    openingPoolCash: Math.round(scenario.openingPoolCash ?? conservativePoolCashSeed),
    turnTwelveSnapshot,
    cumulativePoolCashInflow: Math.round(poolCashInflow),
    cumulativePoolCashSweep: Math.round(poolCashSweep),
    poolTradeUnits: poolPurchaseAndSaleUnits,
    poolSaleCashPaid: Math.round(poolSaleCashPaid),
    forcedLiquidationUnits: forcedSaleUnits,
    markedBillAssets: Math.round(endingBillMark),
    maturedGovernmentReceivableAssets: Math.round(unpaidMaturityClaims),
    bandWeightedStressLossPercent: round2(stressLoss * 100),
    regulatoryCapital: Math.round(regulatoryCapital),
    riskAssets: Math.round(riskAssets),
    capitalRatioPercent: round2(capitalRatio * 100),
    stressCapitalRatioPercent: round2(stressedCapitalRatio * 100),
    supervisoryStanding,
  };
}

function sumLoans(tranches: Map<CreditBandId, { outstanding: number; rate: number }>): number {
  return [...tranches.values()].reduce((sum, tranche) => sum + tranche.outstanding, 0);
}

function quoteSimBond(
  bond: SimBond,
  turn: number,
  prime: number,
  poolCash: number,
  targetCashLocal: number
) {
  const mid =
    bond.marketPrice ??
    calculateBondMarketPrice(bond.couponRate, prime, bond.maturityTurn - turn, false);
  return quoteBondPrices({
    marketPrice: mid,
    issuerType: "sovereign",
    cashLocal: poolCash,
    targetCashLocal,
    appetite: 1,
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function treasuryUnitEconomics(prime: number, inflation: number) {
  const face = BOND_UNIT_FACE_VALUE;
  const couponRate = getSovereignCouponRate(prime, TURNS_PER_YEAR);
  const mid = calculateBondMarketPrice(couponRate, prime, TURNS_PER_YEAR, false);
  const stressedMid = calculateBondMarketPrice(couponRate, prime + 5, TURNS_PER_YEAR, false);
  const neutralQuote = quoteBondPrices({
    marketPrice: mid,
    issuerType: "sovereign",
    cashLocal: 100_000_000,
    targetCashLocal: 100_000_000,
    appetite: 1,
  });
  const stressedPoolQuote = quoteBondPrices({
    marketPrice: stressedMid,
    issuerType: "sovereign",
    cashLocal: 0,
    targetCashLocal: 100_000_000,
    appetite: 1,
  });
  const floorDeposits = 100_000_000;
  const cbApy = savingsApyPercent(prime, inflation, 0);
  const midpointDepositRate =
    prime + (MODERN_DEPOSIT_CORRIDOR.minOffset + MODERN_DEPOSIT_CORRIDOR.maxOffset) / 2;
  const legalFloorDepositRate = prime + MODERN_DEPOSIT_CORRIDOR.minOffset;
  const cashFloor =
    floorDeposits * RESERVE_RATIO +
    floorDeposits * MAX_NPC_FLOW_PER_TURN_FRACTION +
    perTurnInterest(floorDeposits, midpointDepositRate, "USD");
  const annualCouponPerUnit = face * (couponRate / 100);
  const midpointPremiumAnnual =
    floorDeposits * 0.004 * Math.max(0.5, Math.min(3, 2 - RESERVE_RATIO / RESERVE_RATIO));
  return {
    primeRatePercent: prime,
    cbSavingsApyPercent: round2(cbApy),
    currentMidpointDepositRatePercent: round2(midpointDepositRate),
    currentLegalMinimumDepositRatePercent: round2(legalFloorDepositRate),
    hypotheticalApyPlus025DepositRatePercent: round2(cbApy + 0.25),
    cashFloorAt100mNpcDeposits: Math.round(cashFloor),
    annualInsurancePremiumAt100mDepositsAndExactReserveCover: Math.round(midpointPremiumAnnual),
    shortBill: {
      facePerUnit: face,
      termTurns: TURNS_PER_YEAR,
      couponRatePercent: couponRate,
      mid: mid,
      neutralBidPerUnit: round2(neutralQuote.bid * face),
      neutralAskPerUnit: round2(neutralQuote.ask * face),
      purchaseToExecutableBidLossPerUnit: round2((neutralQuote.ask - neutralQuote.bid) * face),
      couponPerYearPerUnit: Math.round(annualCouponPerUnit),
      conditionalNetFirstYearCashBeforeDefaultsPerUnit: Math.round(
        face + annualCouponPerUnit - neutralQuote.ask * face
      ),
      fivePointRateRiseMid: stressedMid,
      fivePointRateRiseCashShortBidPerUnit: round2(stressedPoolQuote.bid * face),
      fivePointRateRiseMarkLossPerUnitFromNeutralAsk: round2(
        (neutralQuote.ask - stressedPoolQuote.bid) * face
      ),
      availabilityNote:
        "Conditional unit economics only. Bank income is recognized only after the existing treasury claim guard funds the coupon. This opening seed starts with a negative signed fiscal position.",
    },
  };
}

const neutralPrime = 8.5;
const inflation = 4.2;
const midpointRate =
  neutralPrime + (MODERN_DEPOSIT_CORRIDOR.minOffset + MODERN_DEPOSIT_CORRIDOR.maxOffset) / 2;
const minRate = neutralPrime + MODERN_DEPOSIT_CORRIDOR.minOffset;
const lendingMidpointOffset =
  (MODERN_LENDING_CORRIDOR.minOffset + MODERN_LENDING_CORRIDOR.maxOffset) / 2;
const scenarios: Scenario[] = [
  {
    name: "1991-seed-us-balanced-funded-sweep-and-public-float-novation",
    profile: "balanced",
    prime: us1991Prime,
    inflation: 4.2,
    depositOffset: -1.75,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
  },
  {
    name: "1991-legacy-nearest-maturity-cash-only-comparison",
    legacyTreasurySweep: true,
    publicFloatCashOnly: true,
    profile: "balanced",
    prime: us1991Prime,
    inflation: 4.2,
    depositOffset: -1.75,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
  },
  {
    name: "1991-seed-us-balanced-starting-rates-zero-opening-pool-sensitivity",
    profile: "balanced",
    prime: us1991Prime,
    inflation: 4.2,
    depositOffset: -1.75,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
    openingPoolCash: 0,
  },
  {
    name: "1991-balanced-single-aggressive-failure-coverage-premium-sensitivity",
    profile: "balanced",
    prime: us1991Prime,
    inflation: 4.2,
    depositOffset: MODERN_DEPOSIT_CORRIDOR.minOffset,
    lendingOffset: (MODERN_LENDING_CORRIDOR.minOffset + MODERN_LENDING_CORRIDOR.maxOffset) / 2,
    turns: TURNS,
    treasuryAutoSweep: true,
    insurancePremiumBaseAnnualRate: 0.1067,
  },
  {
    name: "1991-seed-us-balanced-apy-plus-two-deposit-offset",
    profile: "balanced",
    prime: us1991Prime,
    inflation: 4.2,
    depositOffset: savingsApyPercent(us1991Prime, 4.2, 0) + 2 - us1991Prime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
  },
  {
    name: "neutral-balanced-current-midpoint",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: midpointRate - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
  },
  {
    name: "neutral-balanced-legal-minimum-deposit-rate",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: minRate - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
  },
  {
    name: "neutral-balanced-legal-maximum-deposit-rate",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: MODERN_DEPOSIT_CORRIDOR.maxOffset,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
  },
  {
    name: "neutral-balanced-legal-minimum-deposit-and-maximum-lending-rates",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: minRate - neutralPrime,
    lendingOffset: MODERN_LENDING_CORRIDOR.maxOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
  },
  {
    name: "recession-aggressive-current-midpoint-plus-five-point-prime-shock-at-turn-240",
    profile: "aggressive",
    prime: neutralPrime,
    inflation,
    depositOffset: midpointRate - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    recessionShock: {
      turn: 240,
      primeIncreasePp: 5,
      defaultRateMultiplier: STRESS_LOSS_MULTIPLIER,
      applyStressLoss: true,
    },
    treasuryAutoSweep: true,
  },
  {
    name: "first-year-aggressive-five-point-prime-and-five-times-defaults-at-turn-12",
    profile: "aggressive",
    prime: neutralPrime,
    inflation,
    depositOffset: midpointRate - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS_PER_YEAR,
    recessionShock: {
      turn: TURNS_PER_YEAR / 4,
      primeIncreasePp: 5,
      defaultRateMultiplier: STRESS_LOSS_MULTIPLIER,
      applyStressLoss: true,
    },
    treasuryAutoSweep: true,
  },
  {
    name: "neutral-balanced-legal-minimum-deposit-50bp-service-fee-sensitivity",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: MODERN_DEPOSIT_CORRIDOR.minOffset,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
    serviceFeeAnnualBps: 50,
  },
  {
    name: "neutral-balanced-legal-minimum-deposit-100bp-service-fee-sensitivity",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: MODERN_DEPOSIT_CORRIDOR.minOffset,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
    serviceFeeAnnualBps: 100,
  },
  {
    name: "neutral-balanced-legal-minimum-deposit-200bp-service-fee-sensitivity",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: MODERN_DEPOSIT_CORRIDOR.minOffset,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
    serviceFeeAnnualBps: 200,
  },
  {
    name: "recession-aggressive-legal-minimum-deposit-rate-100bp-service-fee-plus-five-point-prime-shock-at-turn-240",
    profile: "aggressive",
    prime: neutralPrime,
    inflation,
    depositOffset: MODERN_DEPOSIT_CORRIDOR.minOffset,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    recessionShock: { turn: 240, primeIncreasePp: 5 },
    treasuryAutoSweep: true,
    serviceFeeAnnualBps: 100,
  },
];

// Severity sweep for the legal aggressive risk posture at the 1991 seed rate.
// Price offsets remain inside the live modern 1991 corridors; only the
// recession default shock changes. This identifies the production solvency
// threshold rather than treating a negative ROE as a failure.
for (const defaultRateMultiplier of [5, 10, 15, 20]) {
  scenarios.push({
    name: `1991-aggressive-legal-max-deposit-min-lending-${defaultRateMultiplier}x-recession-defaults`,
    profile: "aggressive",
    prime: us1991Prime,
    inflation: 4.2,
    depositOffset: MODERN_DEPOSIT_CORRIDOR.maxOffset,
    lendingOffset: MODERN_LENDING_CORRIDOR.minOffset,
    turns: TURNS,
    recessionShock: {
      turn: TURNS / 2,
      primeIncreasePp: 5,
      defaultRateMultiplier,
      applyStressLoss: true,
    },
    treasuryAutoSweep: true,
  });
}

for (const scenario of scenarios) {
  console.log(JSON.stringify({ ...scenario, ...simulate(scenario) }));
}
console.log(
  JSON.stringify({
    seedMarketInputs: {
      preset: "1991-default",
      usGdp: us1991Budget.gdp,
      openingSignedFiscalPosition: us1991Budget.treasuryBalance,
      openingSovereignPrincipal: us1991Budget.debt.principal,
      openingSpendableCashAssumption: 0,
      annualDeficit: Math.max(0, -federalSurplus(us1991Budget)),
      annualPrimaryBalanceExDisplayedDebtInterest: us1991AnnualPrimaryBalance,
      displayedAnnualDebtInterest: us1991Budget.spending.debtInterest,
      liveOpeningDebtServiceRatePercent: sovereignDebtTerms(us1991Budget.debt.principal, {
        gdp: us1991Budget.gdp,
        gdpSmoothed: us1991Budget.gdpSmoothed,
        investorConfidence: us1991Budget.investorConfidence,
        imfBailoutActive: us1991Budget.imfSovereignBailoutActive,
        sovereignRiskAnchor: us1991Budget.sovereignRiskAnchor,
      }).interestRate,
      firstQuarterIssue: us1991QuarterlyDeficitIssue,
      openingCashConservativePoolTarget: conservativePoolCashSeed,
      externalBroadMoneyBaseline: us1991ExternalBroadMoney,
      reserveRatio: RESERVE_RATIO,
      usDefaultPrime: us1991Prime,
      usSeedInflation: us1991Budget.economicFactors.inflationRate,
      us48TurnRungFaceAtFirstIssue: us1991ShortIssueFace,
      representativeCapital,
      representativeFinancialSectorCapacity: 250,
      branchShare: 0.5,
      branchDepositCeiling: representativeBranchCeiling,
    },
    seed1991BondUnitEconomics: treasuryUnitEconomics(
      us1991Prime,
      us1991Budget.economicFactors.inflationRate
    ),
    neutralBondUnitEconomics: treasuryUnitEconomics(neutralPrime, inflation),
  })
);

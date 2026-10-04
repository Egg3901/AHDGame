/**
 * Deterministic retail-bank viability calibration using current rules.
 *
 * This is an offline analytical model. It reads no world data. Sovereign supply
 * is generated from the 1991 US seed's quarterly funded issuance and a finite
 * pool-cash lower bound. Bank coupons and principal count as cash only when the
 * existing signed treasury-position guard can fund them; the negative opening
 * seed is never treated as spendable cash.
 */

import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calculateBondMarketPrice } from "@/lib/constants/bonds";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { effectiveBankRatesFromPrime } from "@/lib/banking/rules/rates";
import { computeNpcDepositShare } from "@/lib/banking/rules/deposits";
import { npcFlowDelta, fundedNpcFlowDelta, perTurnInterest } from "@/lib/banking/rules/loans";
import {
  bandOriginationTargets,
  getCreditBand,
  stressLossFraction,
  type CreditBandId,
} from "@/lib/banking/rules/creditBands";
import { computeInsurancePremium } from "@/lib/banking/rules/insurance";
import { quoteLoanOrigination } from "@/lib/banking/rules/loanFees";
import { computeDepositCeiling } from "@/lib/banking/rules/capacity";
import { MODERN_DEPOSIT_CORRIDOR, MODERN_LENDING_CORRIDOR } from "@/lib/banking/regulationQ";
import { savingsApyPercent } from "@/lib/currency/savingsInterest";
import { quoteBondPrices } from "@/lib/bonds/marketPoolQuotes";
import {
  calculateQuarterlyIssuanceAmount,
  getSovereignCouponRate,
  SOVEREIGN_ISSUANCE_INTERVAL_TURNS,
  SOVEREIGN_RECONCILE_DISTRIBUTION,
} from "@/lib/bonds/sovereign";
import { sovereignDebtTerms } from "@/lib/bonds/sovereignPrincipal";
import { planSovereignTranches } from "@/lib/bonds/sovereignIssueDiagnostics";
import { MAX_NPC_FLOW_PER_TURN_FRACTION } from "@/lib/banking/rules/loans";
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
import { BOND_POOL_INFLOW_RATE } from "@/lib/bonds/marketPoolTurn";

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
  recessionShock?: { turn: number; primeIncreasePp: number };
};

const RESERVE_RATIO = 0.2;
const TURNS = 480;

const us1991Budget = getInitialNationalBudgetsForPreset("1991-default").find(
  (budget) => budget.countryId === "US"
);
if (!us1991Budget) throw new Error("The 1991 US national budget seed is missing");
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
const us1991Prime = COUNTRY_CONFIGS.US.centralBank.defaultPrimeRate;
const INITIAL_EQUITY = representativeCapital;
const NPC_ECONOMY_CASH = us1991ExternalBroadMoney;
const BRANCH_DEPOSIT_CEILING = representativeBranchCeiling;
const us1991ShortIssueFace =
  planSovereignTranches(SOVEREIGN_RECONCILE_DISTRIBUTION, us1991QuarterlyDeficitIssue).find(
    (tranche) => tranche.maturityTurns === TURNS_PER_YEAR
  )?.amount ?? 0;
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
};

function simulate(scenario: Scenario) {
  const openingEquity = scenario.openingEquity ?? INITIAL_EQUITY;
  const externalCash = scenario.externalCash ?? NPC_ECONOMY_CASH;
  const branchDepositCeiling = scenario.branchDepositCeiling ?? BRANCH_DEPOSIT_CEILING;
  let cash = openingEquity;
  let deposits = 0;
  let feeIncome = 0;
  let premiumExpense = 0;
  const tranches = new Map<CreditBandId, { outstanding: number; rate: number }>();
  const sovereignLots: SimBond[] = [];
  let poolCash = conservativePoolCashSeed;
  let couponsReceived = 0;
  let treasuryPosition = us1991Budget.treasuryBalance;
  let sovereignPrincipal = us1991Budget.debt.principal;
  let annualBudgetInterest = us1991Budget.spending.debtInterest;
  let bankCouponClaimsDueTotal = 0;
  let bankMaturityPrincipalDueTotal = 0;
  let paidMaturityPrincipal = 0;
  let billCouponIncomeThisTurn = 0;
  const pendingBankCoupons: number[] = [];
  const pendingBankMaturities: number[] = [];
  let poolPurchaseAndSaleUnits = 0;
  let poolSaleCashPaid = 0;
  let forcedSaleUnits = 0;
  let lastNetIncome = 0;

  for (let turn = 0; turn < scenario.turns; turn += 1) {
    const prime =
      scenario.recessionShock && turn >= scenario.recessionShock.turn
        ? scenario.prime + scenario.recessionShock.primeIncreasePp
        : scenario.prime;
    // TreasuryTurn runs before bank actions and BondTurn. Keep its legacy
    // signed fiscal-position gate in the model: the 1991 seed starts at
    // -$3.665T, which is debt history, not spendable opening cash.
    const openingBankCouponDue = sovereignLots.reduce((sum, bond) => {
      if (bond.issuedTurn >= turn || bond.maturityTurn < turn || bond.heldUnits <= 0) return sum;
      return sum + perTurnInterest(bond.heldUnits * BOND_UNIT_FACE_VALUE, bond.couponRate, "USD");
    }, 0);
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
    if (openingBankCouponDue > 0) {
      pendingBankCoupons.push(openingBankCouponDue);
      bankCouponClaimsDueTotal += openingBankCouponDue;
    }

    // A bank coupon becomes cash income only after the guarded treasury debit
    // can fund the whole frozen claim. Failed claims remain due, not income.
    while (pendingBankCoupons.length > 0 && treasuryPosition >= pendingBankCoupons[0]!) {
      const paid = pendingBankCoupons.shift()!;
      treasuryPosition -= paid;
      cash += paid;
      couponsReceived += paid;
      billCouponIncomeThisTurn += paid;
    }
    while (pendingBankMaturities.length > 0 && treasuryPosition >= pendingBankMaturities[0]!) {
      const paid = pendingBankMaturities.shift()!;
      treasuryPosition -= paid;
      cash += paid;
      paidMaturityPrincipal += paid;
    }
    const rates = effectiveBankRatesFromPrime(
      { depositOffset: scenario.depositOffset, lendingOffset: scenario.lendingOffset },
      prime
    );
    const cbApy = savingsApyPercent(prime, scenario.inflation, 0);
    const depositShare =
      computeNpcDepositShare(
        [{ bankId: "model-bank", effectiveDepositRatePercent: rates.depositRatePercent }],
        cbApy
      )[0]?.share ?? 0;
    const loansBefore = sumLoans(tranches);
    const bondMarkBefore = sovereignLots.reduce((sum, bond) => {
      if (bond.heldUnits <= 0 || bond.maturityTurn <= turn) return sum;
      const quote = quoteSimBond(bond, turn, prime, poolCash);
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

    const depositInterest = perTurnInterest(deposits, rates.depositRatePercent, "USD");
    deposits += depositInterest;
    const premium = computeInsurancePremium(deposits, cash / Math.max(1, deposits), RESERVE_RATIO);
    cash -= Math.min(premium, Math.max(0, cash));
    premiumExpense += premium;

    const fundingCapacity = deposits * (1 - RESERVE_RATIO);
    const targets = bandOriginationTargets({
      fundingCapacity,
      lendingRatePercent: rates.lendingRatePercent,
      primeRatePercent: prime,
      profile: scenario.profile,
    });
    let loanInterest = 0;
    let defaultLoss = 0;
    let feesThisTurn = 0;
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
      cash -= principalDelta > 0 ? proceeds : principalDelta;
      feesThisTurn += origination?.originationFee ?? 0;

      const nextOutstanding = Math.max(0, outstanding + principalDelta);
      const interest = perTurnInterest(nextOutstanding, rate, "USD");
      const defaults = perTurnInterest(
        nextOutstanding,
        getCreditBand(target.band).defaultRatePercent,
        "USD"
      );
      loanInterest += interest;
      defaultLoss += defaults;
      cash += interest;
      tranches.set(target.band, { outstanding: Math.max(0, nextOutstanding - defaults), rate });
    }
    feeIncome += feesThisTurn;
    if (scenario.treasuryAutoSweep) {
      const cashFloor =
        deposits * RESERVE_RATIO +
        deposits * MAX_NPC_FLOW_PER_TURN_FRACTION +
        perTurnInterest(deposits, rates.depositRatePercent, "USD");
      let spendable = Math.max(0, cash - cashFloor);
      for (const bond of [...sovereignLots].sort(
        (a, b) => a.maturityTurn - b.maturityTurn || a.bondId.localeCompare(b.bondId)
      )) {
        const remainingTurns = bond.maturityTurn - turn;
        if (remainingTurns <= 0 || remainingTurns > TURNS_PER_YEAR || bond.floatUnits <= 0)
          continue;
        const quote = quoteSimBond(bond, turn, prime, poolCash);
        const ask = Math.round(quote.ask * BOND_UNIT_FACE_VALUE * 100) / 100;
        if (!(ask > 0) || spendable < ask) continue;
        const holderCap = Math.floor(SOVEREIGN_BOND_HOLDER_CAP * bond.totalUnits);
        const holderRoom = Math.max(0, holderCap - bond.heldUnits);
        const units = Math.min(bond.floatUnits, holderRoom, Math.floor(spendable / ask));
        if (units <= 0) continue;
        const cost = Math.round(units * ask * 100) / 100;
        cash -= cost;
        poolCash += cost;
        bond.floatUnits -= units;
        bond.heldUnits += units;
        poolPurchaseAndSaleUnits += units;
        spendable = Math.max(0, spendable - cost);
      }

      if (cash < cashFloor) {
        let shortfall = cashFloor - cash;
        for (const bond of [...sovereignLots].sort(
          (a, b) => a.maturityTurn - b.maturityTurn || a.bondId.localeCompare(b.bondId)
        )) {
          if (shortfall <= 0 || bond.heldUnits <= 0 || bond.maturityTurn <= turn) continue;
          const quote = quoteSimBond(bond, turn, prime, poolCash);
          const bid = Math.round(quote.bid * BOND_UNIT_FACE_VALUE * 100) / 100;
          if (!(bid > 0)) continue;
          const units = Math.min(
            bond.heldUnits,
            Math.ceil(shortfall / bid),
            Math.floor(poolCash / bid)
          );
          if (units <= 0) continue;
          const proceeds = Math.round(units * bid * 100) / 100;
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
      premium -
      defaultLoss;
    billCouponIncomeThisTurn = 0;

    // BondTurn follows bankingTurn. The pool receives its existing public-float
    // coupon flow, but bank-holder coupons above require a funded treasury claim.
    for (const bond of sovereignLots) {
      if (bond.issuedTurn < turn && bond.maturityTurn >= turn) {
        const poolCoupon = perTurnInterest(
          bond.floatUnits * BOND_UNIT_FACE_VALUE,
          bond.couponRate,
          "USD"
        );
        poolCash += poolCoupon;
      }
    }

    if (turn > 0 && turn % SOVEREIGN_ISSUANCE_INTERVAL_TURNS === 0) {
      const rolloverFace = sovereignLots
        .filter(
          (bond) =>
            bond.maturityTurn >= turn &&
            bond.maturityTurn < turn + SOVEREIGN_ISSUANCE_INTERVAL_TURNS
        )
        .reduce((sum, bond) => sum + bond.totalUnits * BOND_UNIT_FACE_VALUE, 0);
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
        const fundedUnits = Math.min(
          requestedUnits,
          Math.floor((poolCash * 0.9) / BOND_UNIT_FACE_VALUE)
        );
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
        sovereignPrincipal += fundedFace;
        annualBudgetInterest += (fundedFace * couponRate) / 100;
        sovereignLots.push(lot);
      }
    }

    for (const bond of sovereignLots) {
      if (bond.maturityTurn !== turn) continue;
      const bankPrincipalDue = bond.heldUnits * BOND_UNIT_FACE_VALUE;
      const poolPrincipalDue = bond.floatUnits * BOND_UNIT_FACE_VALUE;
      if (bankPrincipalDue > 0) {
        pendingBankMaturities.push(bankPrincipalDue);
        bankMaturityPrincipalDueTotal += bankPrincipalDue;
      }
      // Legacy maturity debits the non-bank share from signed treasuryBalance,
      // even when negative. Preserve that rule for the pool, but never turn the
      // bank's protected claim into cash without its funded debit.
      treasuryPosition -= poolPrincipalDue;
      poolCash += poolPrincipalDue;
      sovereignPrincipal = Math.max(0, sovereignPrincipal - bond.totalUnits * BOND_UNIT_FACE_VALUE);
      annualBudgetInterest = Math.max(
        0,
        annualBudgetInterest - (bond.totalUnits * BOND_UNIT_FACE_VALUE * bond.couponRate) / 100
      );
      bond.heldUnits = 0;
      bond.floatUnits = 0;
    }
    for (let i = sovereignLots.length - 1; i >= 0; i -= 1) {
      if (sovereignLots[i]!.maturityTurn === turn) sovereignLots.splice(i, 1);
    }
    if (poolCash < conservativePoolCashSeed) {
      poolCash +=
        Math.round((conservativePoolCashSeed - poolCash) * BOND_POOL_INFLOW_RATE * 100) / 100;
    }
  }

  const totalLoans = sumLoans(tranches);
  const primeAtEnd = scenario.recessionShock
    ? scenario.prime + scenario.recessionShock.primeIncreasePp
    : scenario.prime;
  const endingBillMark = sovereignLots.reduce((sum, bond) => {
    if (bond.heldUnits <= 0) return sum;
    const quote = quoteSimBond(bond, scenario.turns - 1, primeAtEnd, poolCash);
    return sum + Math.round(quote.bid * BOND_UNIT_FACE_VALUE * bond.heldUnits * 100) / 100;
  }, 0);
  const unpaidMaturityClaims = pendingBankMaturities.reduce((sum, amount) => sum + amount, 0);
  // Matured but unfunded principal remains a government receivable, not bank
  // cash. Keep it visible in equity and separate from executable liquidity.
  const endingEquity = cash + totalLoans + endingBillMark + unpaidMaturityClaims - deposits;
  const lastAnnualIncome = lastNetIncome * TURNS_PER_YEAR;
  const stressLoss = stressLossFraction(
    [...tranches.entries()].map(([band, loan]) => ({
      creditBand: band,
      outstanding: loan.outstanding,
    }))
  );
  return {
    endingEquity: Math.round(endingEquity),
    deposits: Math.round(deposits),
    loans: Math.round(totalLoans),
    loanToDeposit: round3(totalLoans / Math.max(1, deposits)),
    annualRoePercent: endingEquity > 0 ? round2((lastAnnualIncome / endingEquity) * 100) : null,
    annualIncomeOnInitialEquityPercent: round2((lastAnnualIncome / openingEquity) * 100),
    cumulativeFees: Math.round(feeIncome),
    cumulativePremiums: Math.round(premiumExpense),
    outstandingPoolAndBankBillUnits: sovereignLots.reduce(
      (sum, bond) => sum + bond.floatUnits + bond.heldUnits,
      0
    ),
    eligibleShortPublicFloatUnits: sovereignLots.reduce(
      (sum, bond) =>
        sum +
        (bond.maturityTurn > scenario.turns - 1 &&
        bond.maturityTurn - (scenario.turns - 1) <= TURNS_PER_YEAR
          ? bond.floatUnits
          : 0),
      0
    ),
    heldFundedBillUnits: sovereignLots.reduce((sum, bond) => sum + bond.heldUnits, 0),
    fundedBillCouponCash: Math.round(couponsReceived),
    bankCouponClaimsDueTotal: Math.round(bankCouponClaimsDueTotal),
    unpaidBankCouponClaims: Math.round(pendingBankCoupons.reduce((sum, amount) => sum + amount, 0)),
    bankMaturityPrincipalDueTotal: Math.round(bankMaturityPrincipalDueTotal),
    unpaidBankMaturityPrincipal: Math.round(unpaidMaturityClaims),
    endingSignedFiscalPosition: Math.round(treasuryPosition),
    paidMaturityPrincipal: Math.round(paidMaturityPrincipal),
    endingPoolCash: Math.round(poolCash),
    poolTradeUnits: poolPurchaseAndSaleUnits,
    poolSaleCashPaid: Math.round(poolSaleCashPaid),
    forcedLiquidationUnits: forcedSaleUnits,
    markedBillAssets: Math.round(endingBillMark),
    maturedGovernmentReceivableAssets: Math.round(unpaidMaturityClaims),
    bandWeightedStressLossPercent: round2(stressLoss * 100),
    stressCapitalRatioPercent: round2(
      ((cash - stressLoss * totalLoans) / Math.max(1, totalLoans)) * 100
    ),
  };
}

function sumLoans(tranches: Map<CreditBandId, { outstanding: number; rate: number }>): number {
  return [...tranches.values()].reduce((sum, tranche) => sum + tranche.outstanding, 0);
}

function quoteSimBond(bond: SimBond, turn: number, prime: number, poolCash: number) {
  const remainingTurns = bond.maturityTurn - turn;
  const mid = calculateBondMarketPrice(bond.couponRate, prime, remainingTurns, false);
  return quoteBondPrices({
    marketPrice: mid,
    issuerType: "sovereign",
    cashLocal: poolCash,
    targetCashLocal: conservativePoolCashSeed,
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
const baseRate = savingsApyPercent(neutralPrime, inflation, 0);
const midpointRate =
  neutralPrime + (MODERN_DEPOSIT_CORRIDOR.minOffset + MODERN_DEPOSIT_CORRIDOR.maxOffset) / 2;
const minRate = neutralPrime + MODERN_DEPOSIT_CORRIDOR.minOffset;
const lendingMidpointOffset =
  (MODERN_LENDING_CORRIDOR.minOffset + MODERN_LENDING_CORRIDOR.maxOffset) / 2;
const scenarios: Scenario[] = [
  {
    name: "1991-seed-us-balanced-starting-rates",
    profile: "balanced",
    prime: us1991Prime,
    inflation: 4.2,
    depositOffset: -1.75,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    treasuryAutoSweep: true,
  },
  {
    name: "1991-seed-us-balanced-apy-plus-two-deposit-offset",
    profile: "balanced",
    prime: us1991Prime,
    inflation: 4.2,
    depositOffset: savingsApyPercent(3, 4.2, 0) + 2 - 3,
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
    name: "neutral-balanced-hypothetical-cb-apy-plus-0.25",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: baseRate + 0.25 - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
  },
  {
    name: "neutral-balanced-hypothetical-cb-apy-plus-2.0",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: baseRate + 2 - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
  },
  {
    name: "neutral-balanced-hypothetical-4.4-percent-deposit-rate",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: 4.4 - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
  },
  {
    name: "recession-aggressive-current-midpoint-plus-five-point-prime-shock-at-turn-240",
    profile: "aggressive",
    prime: neutralPrime,
    inflation,
    depositOffset: midpointRate - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    recessionShock: { turn: 240, primeIncreasePp: 5 },
    treasuryAutoSweep: true,
  },
  {
    name: "recession-aggressive-cb-apy-plus-2-deposit-offset-plus-five-point-prime-shock-at-turn-240",
    profile: "aggressive",
    prime: neutralPrime,
    inflation,
    depositOffset: baseRate + 2 - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
    recessionShock: { turn: 240, primeIncreasePp: 5 },
    treasuryAutoSweep: true,
  },
];

for (const scenario of scenarios) {
  console.log(JSON.stringify({ name: scenario.name, ...scenario, ...simulate(scenario) }));
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

/**
 * Deterministic retail-bank viability calibration using current rules.
 *
 * This is an offline analytical model. It reads no world data and starts with
 * no bill inventory. Bond figures are isolated unit economics, not assumed
 * holdings or funded coupon income for a bank.
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
import { MODERN_DEPOSIT_CORRIDOR, MODERN_LENDING_CORRIDOR } from "@/lib/banking/regulationQ";
import { savingsApyPercent } from "@/lib/currency/savingsInterest";
import { quoteBondPrices } from "@/lib/bonds/marketPoolQuotes";
import { getSovereignCouponRate } from "@/lib/bonds/sovereign";
import { MAX_NPC_FLOW_PER_TURN_FRACTION } from "@/lib/banking/rules/loans";
import type { LendingProfileId } from "@/lib/banking/rules/creditBands";

type Scenario = {
  name: string;
  profile: LendingProfileId;
  prime: number;
  inflation: number;
  depositOffset: number;
  lendingOffset: number;
  turns: number;
  recessionShock?: { turn: number; primeIncreasePp: number };
};

const INITIAL_EQUITY = 10_000_000;
const NPC_ECONOMY_CASH = 1_000_000_000_000;
const RESERVE_RATIO = 0.2;
const TURNS = 480;

function simulate(scenario: Scenario) {
  let cash = INITIAL_EQUITY;
  let deposits = 0;
  let feeIncome = 0;
  let premiumExpense = 0;
  const tranches = new Map<CreditBandId, { outstanding: number; rate: number }>();
  let lastNetIncome = 0;

  for (let turn = 0; turn < scenario.turns; turn += 1) {
    const prime =
      scenario.recessionShock && turn >= scenario.recessionShock.turn
        ? scenario.prime + scenario.recessionShock.primeIncreasePp
        : scenario.prime;
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
    const equityBefore = cash + loansBefore - deposits;
    const targetDeposits = Math.min(
      depositShare * NPC_ECONOMY_CASH,
      Math.max(0, equityBefore) * 14
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
        householdPool: NPC_ECONOMY_CASH,
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
    lastNetIncome = loanInterest + feesThisTurn - depositInterest - premium - defaultLoss;
  }

  const totalLoans = sumLoans(tranches);
  const endingEquity = cash + totalLoans - deposits;
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
    annualRoePercent: round2((lastAnnualIncome / Math.max(1, endingEquity)) * 100),
    annualIncomeOnInitialEquityPercent: round2((lastAnnualIncome / INITIAL_EQUITY) * 100),
    cumulativeFees: Math.round(feeIncome),
    cumulativePremiums: Math.round(premiumExpense),
    eligibleFundedBillUnits: 0,
    heldFundedBillUnits: 0,
    fundedBillCouponCash: 0,
    bandWeightedStressLossPercent: round2(stressLoss * 100),
    stressCapitalRatioPercent: round2(
      ((cash - stressLoss * totalLoans) / Math.max(1, totalLoans)) * 100
    ),
  };
}

function sumLoans(tranches: Map<CreditBandId, { outstanding: number; rate: number }>): number {
  return [...tranches.values()].reduce((sum, tranche) => sum + tranche.outstanding, 0);
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
        "Scenario unit only. Actual 1991 eligible publicFloat and pool-funded coupon cash are unverified, so base-case held units are zero.",
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
    name: "neutral-balanced-current-midpoint",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: midpointRate - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
  },
  {
    name: "neutral-balanced-legal-minimum-deposit-rate",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: minRate - neutralPrime,
    lendingOffset: lendingMidpointOffset,
    turns: TURNS,
  },
  {
    name: "neutral-balanced-legal-minimum-deposit-and-maximum-lending-rates",
    profile: "balanced",
    prime: neutralPrime,
    inflation,
    depositOffset: minRate - neutralPrime,
    lendingOffset: MODERN_LENDING_CORRIDOR.maxOffset,
    turns: TURNS,
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
  },
];

for (const scenario of scenarios) {
  console.log(JSON.stringify({ name: scenario.name, ...scenario, ...simulate(scenario) }));
}
console.log(JSON.stringify({ bondUnitEconomics: treasuryUnitEconomics(neutralPrime, inflation) }));

/** Pure quote, cash-floor, and automatic-sweep rules for funded bank bills. */
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE, type Bond } from "@/lib/db/types/bond";
import { MAX_NPC_FLOW_PER_TURN_FRACTION } from "@/lib/banking/rules/loans";
import { quoteBondPrices } from "@/lib/bonds/marketPoolQuotes";
import { effectiveBankRatesFromPrime, playerDepositRatePercent } from "@/lib/banking/rules/rates";
import { cbMarginRatePercent } from "@/lib/banking/rules/decide";
import { discountWindowRatePercent } from "@/lib/banking/rules/discountWindow";
import { perTurnInterest, perTurnInterestOn } from "@/lib/banking/rules/loans";
import { roundSavingsAmount } from "@/lib/currency/savingsInterest";

export const BANK_TREASURY_MAX_REMAINING_TURNS = 48;

export interface BankTreasuryHolderLot {
  bankId?: string;
  charteredTurn?: number;
  lotId?: string;
  tradeId?: string;
  units: number;
}

/** Count only settled units owned by this charter epoch. */
export function bankTreasuryHolderUnits(
  holders: readonly BankTreasuryHolderLot[],
  bankId: string,
  charteredTurn: number
): number {
  return holders.reduce((sum, holder) => {
    if (holder.bankId === bankId && holder.charteredTurn === charteredTurn && !holder.tradeId) {
      return sum + nonNegative(holder.units);
    }
    return sum;
  }, 0);
}

/** Allocate a whole-unit sale over active purchase lots in stored order. */
export function allocateBankTreasuryHolderLots(
  holders: readonly BankTreasuryHolderLot[],
  bankId: string,
  charteredTurn: number,
  requestedUnits: number
): Array<{ lotId: string; units: number }> {
  let remaining = Math.max(0, Math.floor(requestedUnits));
  const allocations: Array<{ lotId: string; units: number }> = [];
  for (const holder of holders) {
    if (
      holder.bankId !== bankId ||
      holder.charteredTurn !== charteredTurn ||
      holder.tradeId ||
      !holder.lotId
    )
      continue;
    const units = Math.min(remaining, Math.floor(nonNegative(holder.units)));
    if (units > 0) allocations.push({ lotId: holder.lotId, units });
    remaining -= units;
    if (remaining === 0) break;
  }
  return allocations;
}

export interface BankTreasuryCashFloorInput {
  cashBackedDeposits: number;
  npcDeposits: number;
  reserveRatio: number;
  nextTurnDueInterest: number;
}

export interface BankTreasuryCashFloor {
  requiredReserves: number;
  withdrawalBufferLocal: number;
  nextTurnDueInterest: number;
  floorLocal: number;
}

export interface BankTreasuryDueInterestInput {
  currency: CurrencyCode;
  primeRate: number;
  inflationRate: number;
  depositOffset: number;
  npcDeposits: number;
  totalDeposits: number;
  playerDeposits: number;
  playerDepositsAreLiabilities: boolean;
  discountWindowDebt: number;
  cbMarginDebt: number;
  interbankLoans: readonly { outstanding: number; ratePercent: number }[];
}

const nonNegative = (value: number): number => (Number.isFinite(value) ? Math.max(0, value) : 0);

/**
 * Exact next-turn interest on the currently recorded deposit and borrowing
 * balances, using the same prime and deposit-rate rules as bankingTurn. Loan
 * origination fees do not reduce this floor: only settled new-origin fees are
 * cash, and no future originations are assumed here.
 */
export function computeBankTreasuryDueInterest(input: BankTreasuryDueInterestInput): number {
  const rates = effectiveBankRatesFromPrime(
    { depositOffset: input.depositOffset, lendingOffset: 0 },
    input.primeRate
  );
  const npcDeposits = nonNegative(input.npcDeposits);
  const playerDeposits = input.playerDepositsAreLiabilities
    ? nonNegative(input.playerDeposits)
    : Math.max(0, nonNegative(input.totalDeposits) - npcDeposits);
  const playerRate = playerDepositRatePercent(
    rates.depositRatePercent,
    input.playerDepositsAreLiabilities,
    input.primeRate,
    input.inflationRate
  );
  const depositInterest =
    perTurnInterest(npcDeposits, rates.depositRatePercent, input.currency) +
    perTurnInterest(playerDeposits, playerRate, input.currency);
  const borrowingInterest =
    perTurnInterestOn(
      nonNegative(input.discountWindowDebt),
      discountWindowRatePercent(input.primeRate)
    ) +
    perTurnInterestOn(nonNegative(input.cbMarginDebt), cbMarginRatePercent(input.primeRate)) +
    input.interbankLoans.reduce(
      (sum, loan) => sum + perTurnInterestOn(nonNegative(loan.outstanding), loan.ratePercent),
      0
    );
  return roundSavingsAmount(depositInterest + borrowingInterest, input.currency);
}

export function computeBankTreasuryCashFloor(
  input: BankTreasuryCashFloorInput
): BankTreasuryCashFloor {
  const requiredReserves = nonNegative(input.cashBackedDeposits) * nonNegative(input.reserveRatio);
  const withdrawalBufferLocal = nonNegative(input.npcDeposits) * MAX_NPC_FLOW_PER_TURN_FRACTION;
  const nextTurnDueInterest = nonNegative(input.nextTurnDueInterest);
  return {
    requiredReserves,
    withdrawalBufferLocal,
    nextTurnDueInterest,
    floorLocal: requiredReserves + withdrawalBufferLocal + nextTurnDueInterest,
  };
}

export interface BankTreasuryQuoteInput {
  bond: Pick<
    Bond,
    | "_id"
    | "issuerType"
    | "countryId"
    | "currencyCode"
    | "marketPrice"
    | "couponRate"
    | "maturityTurn"
    | "matured"
    | "defaulted"
    | "publicFloat"
  >;
  currency: CurrencyCode;
  currentTurn: number;
  poolCashLocal: number;
  poolTargetCashLocal: number;
  appetite?: number;
}

export interface BankTreasuryQuote {
  bondId: string;
  currency: CurrencyCode;
  remainingTurns: number;
  couponRate: number;
  publicFloatUnits: number;
  bidPerUnitLocal: number;
  askPerUnitLocal: number;
  poolCashLocal: number;
  depthUnitsAtBid: number;
  eligible: boolean;
}

export function quoteBankTreasuryBond(input: BankTreasuryQuoteInput): BankTreasuryQuote {
  const { bond } = input;
  const remainingTurns = Number.isSafeInteger(bond.maturityTurn)
    ? bond.maturityTurn - input.currentTurn
    : -1;
  const quote = quoteBondPrices({
    marketPrice: bond.marketPrice,
    issuerType: bond.issuerType,
    cashLocal: input.poolCashLocal,
    targetCashLocal: input.poolTargetCashLocal,
    appetite: input.appetite,
    defaulted: bond.defaulted,
  });
  const bidPerUnitLocal = Math.round(BOND_UNIT_FACE_VALUE * quote.bid * 100) / 100;
  const askPerUnitLocal = Math.round(BOND_UNIT_FACE_VALUE * quote.ask * 100) / 100;
  const publicFloatUnits = Number.isSafeInteger(bond.publicFloat)
    ? Math.max(0, bond.publicFloat)
    : 0;
  const bondCurrency = (bond.currencyCode ??
    (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
      ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
      : "USD")) as CurrencyCode;
  return {
    bondId: bond._id.toHexString(),
    currency: bondCurrency,
    remainingTurns,
    couponRate: bond.couponRate,
    publicFloatUnits,
    bidPerUnitLocal,
    askPerUnitLocal,
    poolCashLocal: nonNegative(input.poolCashLocal),
    depthUnitsAtBid:
      bidPerUnitLocal > 0 ? Math.floor(nonNegative(input.poolCashLocal) / bidPerUnitLocal) : 0,
    eligible:
      bond.issuerType === "sovereign" &&
      bond.countryId !== undefined &&
      bondCurrency === input.currency &&
      bond.matured !== true &&
      bond.defaulted !== true &&
      remainingTurns > 0 &&
      remainingTurns <= BANK_TREASURY_MAX_REMAINING_TURNS &&
      publicFloatUnits > 0 &&
      askPerUnitLocal > 0,
  };
}

export interface BankTreasurySweepPlan {
  bondId: string;
  units: number;
  askPerUnitLocal: number;
  costLocal: number;
}

/** Buy nearest maturity first, without crossing the cash floor or float. */
export function planBankTreasurySweep(
  quotes: readonly BankTreasuryQuote[],
  cashReserves: number,
  floorLocal: number
): BankTreasurySweepPlan[] {
  let spendable = Math.max(0, nonNegative(cashReserves) - nonNegative(floorLocal));
  const plans: BankTreasurySweepPlan[] = [];
  for (const quote of [...quotes]
    .filter((item) => item.eligible)
    .sort((a, b) => a.remainingTurns - b.remainingTurns || a.bondId.localeCompare(b.bondId))) {
    if (spendable < quote.askPerUnitLocal) break;
    const units = Math.min(quote.publicFloatUnits, Math.floor(spendable / quote.askPerUnitLocal));
    if (units <= 0) continue;
    const costLocal = Math.round(units * quote.askPerUnitLocal * 100) / 100;
    plans.push({ bondId: quote.bondId, units, askPerUnitLocal: quote.askPerUnitLocal, costLocal });
    spendable = Math.max(0, spendable - costLocal);
  }
  return plans;
}

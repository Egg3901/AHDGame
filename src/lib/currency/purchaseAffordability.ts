import {
  euroLedgerCrossRate,
  euroLedgerSpendForTarget,
  type EuroMonetaryUnion,
} from "./euro/rules";
import {
  FOREX_ACTIVE_CURRENCIES,
  MARKET_MAKER_SPREAD,
  type CurrencyCode,
} from "@/lib/constants/currencies";

type RateMap = Partial<Record<CurrencyCode, number>>;
type BalanceMap = Partial<Record<CurrencyCode, number>>;

export interface ExplicitPayEstimate {
  requiredFromAmount: number;
  spendAmount: number;
  deliveredAmount: number;
  spreadFee: number;
  canAfford: boolean;
  remainingBalance: number;
}

export interface ImplicitAutoConvertEstimate {
  spendableInTarget: number;
  sourceSpends: Partial<Record<CurrencyCode, number>>;
  spreadFees: Partial<Record<CurrencyCode, number>>;
}

export function getMarketMakerTolerance(currency: CurrencyCode): number {
  return currency === "JPY" ? 1 : 0.02;
}

function getCrossRate(
  rates: RateMap,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  union?: EuroMonetaryUnion
) {
  if (fromCurrency === toCurrency) return 1;
  const fixedRate = euroLedgerCrossRate(union, fromCurrency, toCurrency);
  if (fixedRate != null) return fixedRate;
  const fromRate = rates[fromCurrency];
  const toRate = rates[toCurrency];
  if (!fromRate || !toRate) return null;
  return toRate / fromRate;
}

function estimateDeliveredAmount(
  spendAmount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  rates: RateMap,
  union?: EuroMonetaryUnion
) {
  if (fromCurrency === toCurrency) {
    return {
      deliveredAmount: spendAmount,
      spreadFee: 0,
    };
  }
  const crossRate = getCrossRate(rates, fromCurrency, toCurrency, union);
  if (!crossRate) {
    return {
      deliveredAmount: 0,
      spreadFee: 0,
    };
  }
  if (euroLedgerCrossRate(union, fromCurrency, toCurrency) != null)
    return { deliveredAmount: Math.floor(spendAmount * crossRate), spreadFee: 0 };
  const spreadFee = Math.round(spendAmount * MARKET_MAKER_SPREAD);
  const deliveredAmount = Math.round((spendAmount - spreadFee) * crossRate);
  return { deliveredAmount, spreadFee };
}

/**
 * Bump spendAmount up by enough source units that integer rounding inside
 * estimateDeliveredAmount can't drop deliveredAmount below the requested
 * minDelivered. Used by the implicit/explicit estimators when the user has
 * source balance to spare but the natural idealSpend rounds to a
 * deliveredAmount one unit short — the rounding-residue case that produced
 * "Short by $0.13" on the bond modal.
 */
function bumpSpendUntilDelivered(params: {
  spendAmount: number;
  sourceBalance: number;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rates: RateMap;
  union?: EuroMonetaryUnion;
  minDelivered: number;
  maxIterations?: number;
}): { spendAmount: number; deliveredAmount: number; spreadFee: number } {
  const { sourceBalance, fromCurrency, toCurrency, rates, minDelivered, union } = params;
  let spendAmount = params.spendAmount;
  let { deliveredAmount, spreadFee } = estimateDeliveredAmount(
    spendAmount,
    fromCurrency,
    toCurrency,
    rates,
    union
  );
  if (deliveredAmount >= minDelivered) return { spendAmount, deliveredAmount, spreadFee };

  const crossRate = getCrossRate(rates, fromCurrency, toCurrency, union);
  if (!crossRate || crossRate <= 0) return { spendAmount, deliveredAmount, spreadFee };

  // One source unit at this rate covers ~crossRate target units. Step by enough
  // that each bump moves delivered by at least 1 (relevant when crossRate < 1,
  // e.g. JPY → USD where 1 JPY rounds to 0 USD).
  const step = Math.max(1, Math.ceil(1 / crossRate));
  const cap = params.maxIterations ?? 16;
  for (let i = 0; i < cap; i++) {
    if (spendAmount >= sourceBalance) break;
    spendAmount = Math.min(sourceBalance, spendAmount + step);
    const next = estimateDeliveredAmount(spendAmount, fromCurrency, toCurrency, rates, union);
    deliveredAmount = next.deliveredAmount;
    spreadFee = next.spreadFee;
    if (deliveredAmount >= minDelivered) break;
  }
  return { spendAmount, deliveredAmount, spreadFee };
}

export function estimateExplicitPayCoverage(params: {
  requiredAmount: number;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  availableBalance: number;
  rates: RateMap;
  union?: EuroMonetaryUnion;
}): ExplicitPayEstimate | null {
  const { requiredAmount, fromCurrency, toCurrency, availableBalance, rates, union } = params;
  if (fromCurrency === toCurrency) {
    const spendAmount = Math.min(requiredAmount, availableBalance);
    return {
      requiredFromAmount: requiredAmount,
      spendAmount,
      deliveredAmount: spendAmount,
      spreadFee: 0,
      canAfford: availableBalance >= requiredAmount,
      remainingBalance: Math.max(0, availableBalance - spendAmount),
    };
  }

  const crossRate = getCrossRate(rates, fromCurrency, toCurrency, union);
  if (!crossRate) return null;

  const requiredFromAmount =
    euroLedgerCrossRate(union, fromCurrency, toCurrency) != null
      ? euroLedgerSpendForTarget(requiredAmount, crossRate)
      : requiredAmount / ((1 - MARKET_MAKER_SPREAD) * crossRate);
  const tolerance = getMarketMakerTolerance(fromCurrency);
  const initialSpend =
    requiredFromAmount <= availableBalance + tolerance
      ? Math.min(requiredFromAmount, availableBalance)
      : availableBalance;
  // Bump past Math.round residue so a user with surplus source balance is
  // never marked short by < 1 target unit (the "$0.13 short" case).
  const bumped = bumpSpendUntilDelivered({
    spendAmount: initialSpend,
    sourceBalance: availableBalance,
    fromCurrency,
    toCurrency,
    rates,
    union,
    minDelivered: requiredAmount,
  });
  const { spendAmount, deliveredAmount, spreadFee } = bumped;
  const canAfford = deliveredAmount >= requiredAmount;

  return {
    requiredFromAmount,
    spendAmount,
    deliveredAmount,
    spreadFee,
    canAfford,
    remainingBalance: canAfford ? Math.max(0, availableBalance - spendAmount) : 0,
  };
}

export function estimateImplicitAutoConvertCoverage(params: {
  requiredAmount: number;
  targetCurrency: CurrencyCode;
  balances: BalanceMap;
  rates: RateMap;
  union?: EuroMonetaryUnion;
  maxIterations?: number;
}): ImplicitAutoConvertEstimate | null {
  const { requiredAmount, targetCurrency, rates, union, maxIterations = 48 } = params;
  const balances = { ...params.balances } as Partial<Record<CurrencyCode, number>>;

  let spendableInTarget = balances[targetCurrency] ?? 0;
  const sourceSpends: Partial<Record<CurrencyCode, number>> = {};
  const spreadFees: Partial<Record<CurrencyCode, number>> = {};

  // Fast path: target balance already covers the requirement, so no FX
  // conversion (and no exchange rates) are needed. Without this shortcut the
  // modal-side rate-fetch race window would treat a US character buying a USD
  // bond as "short" simply because the rates hadn't loaded yet — see
  // src/app/bond/[id]/page.tsx affordability flow.
  if (spendableInTarget >= requiredAmount) {
    return { spendableInTarget, sourceSpends, spreadFees };
  }

  // Beyond this point we need rates to convert other balances into the target.
  if (!rates[targetCurrency]) return null;

  for (let iter = 0; iter < maxIterations; iter++) {
    if (spendableInTarget >= requiredAmount) break;
    let progressed = false;

    for (const code of FOREX_ACTIVE_CURRENCIES) {
      if (code === targetCurrency) continue;

      const sourceBalance = balances[code] ?? 0;
      if (sourceBalance <= 0) continue;

      const crossRate = getCrossRate(rates, code, targetCurrency, union);
      if (!crossRate) continue;

      const shortfall = requiredAmount - spendableInTarget;
      const idealSpend =
        euroLedgerCrossRate(union, code, targetCurrency) != null
          ? euroLedgerSpendForTarget(shortfall, crossRate)
          : shortfall / ((1 - MARKET_MAKER_SPREAD) * crossRate);
      const initialSpend = Math.min(sourceBalance, idealSpend);
      if (initialSpend <= 0) continue;

      // After Math.round inside estimateDeliveredAmount, delivered can land a
      // hair below shortfall (e.g. shortfall=267.13 → delivered=267, leaving
      // a $0.13 residue the next iteration can't price because 0.19 EUR
      // rounds to 0 USD). Bump past the rounding boundary while the source
      // balance still has room, then proceed.
      const { spendAmount, deliveredAmount, spreadFee } = bumpSpendUntilDelivered({
        spendAmount: initialSpend,
        sourceBalance,
        fromCurrency: code,
        toCurrency: targetCurrency,
        rates,
        union,
        minDelivered: shortfall,
      });
      if (deliveredAmount <= 0 && spreadFee <= 0) continue;

      balances[code] = sourceBalance - spendAmount;
      spendableInTarget += deliveredAmount;
      sourceSpends[code] = (sourceSpends[code] ?? 0) + spendAmount;
      spreadFees[code] = (spreadFees[code] ?? 0) + spreadFee;
      progressed = true;
      break;
    }

    if (!progressed) break;
  }

  return { spendableInTarget, sourceSpends, spreadFees };
}

export function estimateMaxConvertibleAmount(params: {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  balance: number;
  rates: RateMap;
  union?: EuroMonetaryUnion;
}) {
  const { fromCurrency, toCurrency, balance, rates, union } = params;
  return estimateDeliveredAmount(balance, fromCurrency, toCurrency, rates, union).deliveredAmount;
}

export function refineMaxAffordableInteger(params: {
  initialGuess: number;
  upperBound: number;
  canAfford: (value: number) => boolean;
}) {
  const { upperBound, canAfford } = params;
  let candidate = Math.max(0, Math.min(params.initialGuess, upperBound));

  while (candidate > 0 && !canAfford(candidate)) {
    candidate -= 1;
  }
  while (candidate < upperBound && canAfford(candidate + 1)) {
    candidate += 1;
  }

  return candidate;
}

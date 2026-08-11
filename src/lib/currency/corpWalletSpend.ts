/**
 * Corporate wallet-spend estimators — the CLIENT-SAFE half of
 * `corporationCapital`.
 *
 * ⚠️ This file exists to keep `mongodb` out of the browser bundle. These two
 * helpers are pure, but they used to live in `corporationCapital.ts`, which also
 * holds the DB-backed FX loaders and therefore imports
 * `@/lib/db/collections/gameState` → `@/lib/mongodb` → `mongodb`. Two client
 * components import them, so the whole driver was dragged into the client graph
 * and `next build` failed with a module-not-found on mongodb's node-only deps:
 *
 *   mongodb → lib/mongodb.ts → db/collections/gameState.ts
 *           → currency/corporationCapital.ts → BondTradeModal.tsx [client]
 *
 * ⚠️ NOTHING in this file may import from `corporationCapital.ts`, or from any
 * module that reaches `@/lib/mongodb` or `@/lib/db/*`. The dependency runs one
 * way: `corporationCapital.ts` re-exports these for its ~135 server-side
 * callers, so their imports are unchanged. Pinned by `corpWalletSpend.test.ts`.
 */
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  estimateExplicitPayCoverage,
  estimateMaxConvertibleAmount,
  type ExplicitPayEstimate,
} from "@/lib/currency/purchaseAffordability";

export function estimateCorpWalletSpend(params: {
  requiredAmount: number;
  availableBalance: number;
  fromCurrency?: CurrencyCode | null;
  toCurrency?: CurrencyCode | null;
  rates: Partial<Record<CurrencyCode, number>>;
}): ExplicitPayEstimate | null {
  const { requiredAmount, availableBalance, fromCurrency, toCurrency, rates } = params;
  if (!Number.isFinite(requiredAmount) || requiredAmount <= 0) {
    return {
      requiredFromAmount: 0,
      spendAmount: 0,
      deliveredAmount: 0,
      spreadFee: 0,
      canAfford: true,
      remainingBalance: Math.max(0, availableBalance),
    };
  }

  if (!fromCurrency || !toCurrency) {
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

  return estimateExplicitPayCoverage({
    requiredAmount,
    fromCurrency,
    toCurrency,
    availableBalance,
    rates,
  });
}

/**
 * Maximum target-currency amount a corporation can fund from its wallet after
 * market-maker spread. Same-currency / legacy paths return the raw balance.
 */
export function estimateCorpMaxSpendableTargetAmount(params: {
  availableBalance: number;
  fromCurrency?: CurrencyCode | null;
  toCurrency?: CurrencyCode | null;
  rates: Partial<Record<CurrencyCode, number>>;
}): number {
  const { availableBalance, fromCurrency, toCurrency, rates } = params;
  if (!Number.isFinite(availableBalance) || availableBalance <= 0) return 0;
  if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) {
    return availableBalance;
  }
  return estimateMaxConvertibleAmount({
    fromCurrency,
    toCurrency,
    balance: availableBalance,
    rates,
  });
}

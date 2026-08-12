"use client";

import { useEffect, useId, useState } from "react";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { Button } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import {
  estimateExplicitPayCoverage,
  estimateImplicitAutoConvertCoverage,
  estimateMaxConvertibleAmount,
  refineMaxAffordableInteger,
} from "@/lib/currency/purchaseAffordability";
import {
  estimateCorpMaxSpendableTargetAmount,
  estimateCorpWalletSpend,
} from "@/lib/currency/corpWalletSpend";
import {
  COUNTRY_CURRENCY_MAP,
  CURRENCY_SYMBOLS,
  FOREX_ACTIVE_CURRENCIES,
} from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondDetail, BondUserContext } from "./bondTypes";

export function BondTradeModal({
  bond,
  bondId,
  userContext,
  autoConvertEnabled = true,
  onAutoConvertChange,
  onClose,
  onSuccess,
}: {
  bond: BondDetail;
  bondId: string;
  userContext: BondUserContext;
  autoConvertEnabled?: boolean;
  onAutoConvertChange?: (enabled: boolean) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { formatAmount, formatPrice, formatFull, forexRates, ratesLoading, toInternalFrom } =
    useCurrency();
  const unitsInputId = useId();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [account, setAccount] = useState<"character" | "corporation" | "investmentBank">(
    "character"
  );
  // 0 == "empty"; lets users backspace the field without it snapping back to 1.
  const [units, setUnits] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // ─── Currency selector state ──────────────────────────────────────────────────
  // Canonical `bond.currencyCode` (Task-18B) — never derive from the issuer
  // corp's current country, as cross-country admin HQ moves don't change the
  // bond's denomination. See docs/design/corporations.md §HQ Relocation.
  const bondCurrency = (bond.currencyCode ??
    COUNTRY_CURRENCY_MAP[(bond.countryId ?? "US") as keyof typeof COUNTRY_CURRENCY_MAP] ??
    "USD") as CurrencyCode;
  // Display helper: bond.pricePerUnit / faceValue / costs are LOCAL in
  // `bondCurrency`; normalize LOCAL → ₳ before formatPrice.
  const fmtBondPrice = (val: number) =>
    formatPrice(toInternalFrom(val, bondCurrency), bondCurrency);
  const fmtBondAmount = (val: number) =>
    formatAmount(toInternalFrom(val, bondCurrency), bondCurrency);

  // Always default to the player's home currency; auto-convert handles the bridge
  // to the target currency. The dropdown still lets the player pay directly in the
  // target (or any other currency) when they have enough liquid in it.
  const defaultPayCurrency = (userContext.homeCurrency ?? bondCurrency) as CurrencyCode;

  const [selectedPayCurrency, setSelectedPayCurrency] = useState<CurrencyCode>(defaultPayCurrency);
  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);

  // Source of truth for FX rates is the page-level CurrencyContext (already
  // fetched via /api/forex/rates and cached). Reusing it here avoids the
  // duplicate /api/forex/exchange request and — more importantly — eliminates
  // the per-modal race window where affordability checks ran against an empty
  // rate map and falsely flagged personal-currency buys as "short".
  const exchangeRates = forexRates;
  const loadingRates = ratesLoading && !forexRates;

  useEffect(() => {
    if (!currencyDropdownOpen) return;
    const close = () => setCurrencyDropdownOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [currencyDropdownOpen]);

  const personalBalances = userContext.currencyBalances?.personal;
  const homeCurrency = (userContext.homeCurrency ?? bondCurrency) as CurrencyCode;
  const isCharacterBuy = account === "character" && side === "buy" && !!personalBalances;
  const shouldUseImplicitAutoConvert =
    isCharacterBuy && autoConvertEnabled && selectedPayCurrency === homeCurrency;

  function getAffordableCurrencies(cost: number): CurrencyCode[] {
    if (!personalBalances) return [];
    return (Object.entries(personalBalances) as [CurrencyCode, number][])
      .filter(([code, balance]) => {
        if ((balance ?? 0) <= 0) return false;
        if (code === bondCurrency) return (balance ?? 0) >= cost;
        if (
          !FOREX_ACTIVE_CURRENCIES.includes(code) ||
          !FOREX_ACTIVE_CURRENCIES.includes(bondCurrency)
        ) {
          return false;
        }
        if (!exchangeRates) return true;
        const estimate = estimateExplicitPayCoverage({
          requiredAmount: cost,
          fromCurrency: code,
          toCurrency: bondCurrency,
          availableBalance: balance ?? 0,
          rates: exchangeRates,
        });
        return estimate?.canAfford ?? false;
      })
      .map(([code]) => code);
  }

  const handleAutoConvertToggle = () => {
    if (!onAutoConvertChange) return;
    const newValue = !autoConvertEnabled;
    onAutoConvertChange(newValue);
    void fetch("/api/character/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoConvertEnabled: newValue }),
    });
  };

  const hasCorp = !!userContext.myCorporation;
  const investmentBank = userContext.investmentBank;
  const hasInvestmentBank = !!investmentBank;
  const corpLiquidCurrencyCode = (userContext.myCorporation?.liquidCurrencyCode ??
    null) as CurrencyCode | null;

  // Recompute anchor cash on the client to stay consistent with display rates.
  // The API returns `myCashOnHand` already converted to ₳ using the rates it
  // saw at request time; if rates shifted before render (turn boundary) the
  // re-conversion to display currency overshoots a same-currency wallet (the
  // "Personally $84M cash / Pay with $76M USD" mismatch — see Rashi #156).
  const personalCashAnchor =
    personalBalances !== undefined
      ? Object.entries(personalBalances).reduce(
          (sum, [code, val]) => sum + toInternalFrom(val ?? 0, code as CurrencyCode),
          0
        )
      : userContext.myCashOnHand;

  const budget =
    account === "character"
      ? personalCashAnchor
      : account === "corporation"
        ? (userContext.myCorporation?.liquidCapital ?? 0)
        : (investmentBank?.liquidCapital ?? 0);
  const heldUnits =
    account === "character"
      ? userContext.myBondUnits
      : account === "corporation"
        ? (userContext.myCorporation?.bondUnits ?? 0)
        : (investmentBank?.bondUnits ?? 0);

  const costPerUnit = bond.pricePerUnit;
  const costPerUnitAnchor = toInternalFrom(costPerUnit, bondCurrency);
  const totalCost = units * costPerUnit;
  // Convert bond-currency cost to anchor (₳) so it can be compared to budget,
  // which is always in ₳ (personalCashAnchor / corp liquidCapital are anchor values).
  const totalCostAnchor = toInternalFrom(totalCost, bondCurrency);
  const notEnoughToSell = side === "sell" && units > heldUnits;
  const floatShort = side === "buy" && account !== "investmentBank" && units > bond.publicFloat;
  const selectedPayBalance =
    account === "character" && personalBalances ? (personalBalances[selectedPayCurrency] ?? 0) : 0;
  const corpLiquidBalanceLocal =
    userContext.myCorporation?.liquidCapitalLocal ??
    (corpLiquidCurrencyCode && exchangeRates?.[corpLiquidCurrencyCode]
      ? budget * exchangeRates[corpLiquidCurrencyCode]
      : budget);
  const corpBuyEstimate =
    account === "corporation" && side === "buy" && hasCorp
      ? estimateCorpWalletSpend({
          requiredAmount: totalCost,
          availableBalance: corpLiquidBalanceLocal,
          fromCurrency: corpLiquidCurrencyCode,
          toCurrency: bondCurrency,
          rates: exchangeRates ?? {},
        })
      : null;
  const explicitPayEstimate =
    isCharacterBuy && !shouldUseImplicitAutoConvert
      ? estimateExplicitPayCoverage({
          requiredAmount: totalCost,
          fromCurrency: selectedPayCurrency,
          toCurrency: bondCurrency,
          availableBalance: selectedPayBalance,
          rates: exchangeRates ?? {},
        })
      : null;
  const implicitAutoConvertEstimate =
    isCharacterBuy && shouldUseImplicitAutoConvert
      ? estimateImplicitAutoConvertCoverage({
          requiredAmount: totalCost,
          targetCurrency: bondCurrency,
          balances: personalBalances ?? {},
          rates: exchangeRates ?? {},
        })
      : null;
  const maxImplicitSpendableInTarget =
    isCharacterBuy && shouldUseImplicitAutoConvert
      ? (Object.entries(personalBalances ?? {}) as [CurrencyCode, number][])
          .filter(([, balance]) => (balance ?? 0) > 0)
          .reduce((total, [code, balance]) => {
            if (code === bondCurrency) return total + balance;
            return (
              total +
              estimateMaxConvertibleAmount({
                fromCurrency: code,
                toCurrency: bondCurrency,
                balance,
                rates: exchangeRates ?? {},
              })
            );
          }, 0)
      : 0;
  const maxExplicitSpendableInTarget =
    isCharacterBuy && !shouldUseImplicitAutoConvert
      ? estimateMaxConvertibleAmount({
          fromCurrency: selectedPayCurrency,
          toCurrency: bondCurrency,
          balance: selectedPayBalance,
          rates: exchangeRates ?? {},
        })
      : 0;

  const fundsShort =
    side !== "buy"
      ? false
      : account === "corporation"
        ? !(corpBuyEstimate?.canAfford ?? totalCostAnchor <= budget)
        : account === "investmentBank"
          ? totalCostAnchor > budget
          : !personalBalances
            ? totalCostAnchor > budget
            : shouldUseImplicitAutoConvert
              ? !(
                  implicitAutoConvertEstimate &&
                  implicitAutoConvertEstimate.spendableInTarget >= totalCost
                )
              : selectedPayCurrency === bondCurrency
                ? selectedPayBalance < totalCost
                : !(explicitPayEstimate && explicitPayEstimate.canAfford);
  const approxMaxAffordableBuyUnits =
    side !== "buy"
      ? 0
      : account === "corporation"
        ? costPerUnit > 0
          ? Math.floor(
              estimateCorpMaxSpendableTargetAmount({
                availableBalance: corpLiquidBalanceLocal,
                fromCurrency: corpLiquidCurrencyCode,
                toCurrency: bondCurrency,
                rates: exchangeRates ?? {},
              }) / costPerUnit
            )
          : 0
        : account === "investmentBank"
          ? costPerUnitAnchor > 0
            ? Math.floor(budget / costPerUnitAnchor)
            : 0
          : !personalBalances
            ? costPerUnitAnchor > 0
              ? Math.floor(budget / costPerUnitAnchor)
              : 0
            : shouldUseImplicitAutoConvert
              ? costPerUnit > 0
                ? Math.floor(maxImplicitSpendableInTarget / costPerUnit)
                : 0
              : selectedPayCurrency === bondCurrency
                ? costPerUnit > 0
                  ? Math.floor(selectedPayBalance / costPerUnit)
                  : 0
                : costPerUnit > 0
                  ? Math.floor(maxExplicitSpendableInTarget / costPerUnit)
                  : 0;
  const canAffordBuyUnits = (candidateUnits: number) => {
    if (candidateUnits <= 0) return true;
    if (account === "corporation") {
      const estimate = estimateCorpWalletSpend({
        requiredAmount: candidateUnits * costPerUnit,
        availableBalance: corpLiquidBalanceLocal,
        fromCurrency: corpLiquidCurrencyCode,
        toCurrency: bondCurrency,
        rates: exchangeRates ?? {},
      });
      return estimate?.canAfford ?? false;
    }
    if (account === "investmentBank") {
      return candidateUnits * costPerUnitAnchor <= budget;
    }
    if (!personalBalances) {
      return candidateUnits * costPerUnitAnchor <= budget;
    }
    const candidateCost = candidateUnits * costPerUnit;
    if (shouldUseImplicitAutoConvert) {
      const estimate = estimateImplicitAutoConvertCoverage({
        requiredAmount: candidateCost,
        targetCurrency: bondCurrency,
        balances: personalBalances,
        rates: exchangeRates ?? {},
      });
      return (estimate?.spendableInTarget ?? 0) >= candidateCost;
    }
    if (selectedPayCurrency === bondCurrency) {
      return selectedPayBalance >= candidateCost;
    }
    const estimate = estimateExplicitPayCoverage({
      requiredAmount: candidateCost,
      fromCurrency: selectedPayCurrency,
      toCurrency: bondCurrency,
      availableBalance: selectedPayBalance,
      rates: exchangeRates ?? {},
    });
    return estimate?.canAfford ?? false;
  };
  const maxAffordableBuyUnits =
    side !== "buy"
      ? 0
      : refineMaxAffordableInteger({
          initialGuess: approxMaxAffordableBuyUnits,
          upperBound: bond.publicFloat,
          canAfford: canAffordBuyUnits,
        });
  const maxAllowedUnits =
    side === "buy"
      ? Math.max(
          0,
          account === "investmentBank"
            ? maxAffordableBuyUnits
            : Math.min(bond.publicFloat, maxAffordableBuyUnits)
        )
      : heldUnits;

  const budgetLabel =
    account === "corporation"
      ? "Corp liquid"
      : account === "investmentBank"
        ? "Bank liquid"
        : !personalBalances
          ? "Your cash"
          : shouldUseImplicitAutoConvert
            ? `Spendable in ${bondCurrency}`
            : `Available in ${selectedPayCurrency}`;

  const budgetValue =
    account === "corporation"
      ? formatFull(budget)
      : account === "investmentBank"
        ? formatFull(budget)
        : !personalBalances
          ? formatFull(budget)
          : shouldUseImplicitAutoConvert
            ? implicitAutoConvertEstimate
              ? formatCurrencyFaceAmount(
                  implicitAutoConvertEstimate.spendableInTarget,
                  bondCurrency
                )
              : formatFull(budget)
            : formatCurrencyFaceAmount(selectedPayBalance, selectedPayCurrency);

  const estimatedFxFeeAnchor =
    account === "corporation"
      ? toInternalFrom(corpBuyEstimate?.spreadFee ?? 0, corpLiquidCurrencyCode ?? bondCurrency)
      : account === "investmentBank"
        ? 0
        : account === "character" && personalBalances
          ? shouldUseImplicitAutoConvert
            ? Object.entries(implicitAutoConvertEstimate?.spreadFees ?? {}).reduce(
                (total, [code, fee]) => total + toInternalFrom(fee ?? 0, code as CurrencyCode),
                0
              )
            : toInternalFrom(explicitPayEstimate?.spreadFee ?? 0, selectedPayCurrency)
          : 0;

  const afterPurchaseValue =
    account === "corporation"
      ? (() => {
          if (fundsShort) {
            const shortfallAnchor =
              toInternalFrom(
                corpBuyEstimate?.requiredFromAmount ?? totalCost,
                corpLiquidCurrencyCode ?? bondCurrency
              ) - budget;
            return `Short by ${formatFull(shortfallAnchor)}`;
          }
          return formatFull(
            toInternalFrom(
              corpBuyEstimate?.remainingBalance ?? corpLiquidBalanceLocal,
              corpLiquidCurrencyCode ?? bondCurrency
            )
          );
        })()
      : account === "investmentBank"
        ? fundsShort
          ? `Short by ${formatFull(totalCostAnchor - budget)}`
          : formatFull(budget - totalCostAnchor)
        : !personalBalances
          ? fundsShort
            ? `Short by ${formatFull(totalCostAnchor - budget)}`
            : formatFull(budget - totalCostAnchor)
          : shouldUseImplicitAutoConvert
            ? (() => {
                const spendable = implicitAutoConvertEstimate?.spendableInTarget ?? 0;
                return fundsShort
                  ? `Short by ${formatCurrencyFaceAmount(totalCost - spendable, bondCurrency)}`
                  : formatCurrencyFaceAmount(spendable - totalCost, bondCurrency);
              })()
            : (() => {
                const requiredSpend = explicitPayEstimate?.spendAmount ?? totalCost;
                return fundsShort
                  ? `Short by ${formatCurrencyFaceAmount(
                      totalCost - (explicitPayEstimate?.deliveredAmount ?? 0),
                      bondCurrency
                    )}`
                  : formatCurrencyFaceAmount(
                      selectedPayBalance - requiredSpend,
                      selectedPayCurrency
                    );
              })();

  const requestPayCurrency =
    account === "character" && side === "buy" && personalBalances && !shouldUseImplicitAutoConvert
      ? selectedPayCurrency
      : undefined;

  async function handleTrade() {
    if (units <= 0) return;
    setLoading(true);
    setError("");
    try {
      if (account === "investmentBank" && investmentBank) {
        trackAction(`bond.${side}`, { bondId, units, account });
        const res = await fetch(`/api/corporations/${investmentBank.id}/bank/prop/positions`, {
          method: side === "buy" ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ asset: "bond", ref: bond._id, units }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? `Failed to ${side} bond`);
          return;
        }
        onSuccess();
        return;
      }
      const corpParam =
        account === "corporation" && userContext.myCorporation
          ? `?corporationId=${userContext.myCorporation.id}`
          : "";
      trackAction(`bond.${side}`, { bondId, units, account });
      const res = await fetch(`/api/bonds/${bondId}/${side}${corpParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          units,
          ...(requestPayCurrency ? { payCurrency: requestPayCurrency } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? `Failed to ${side} bond`);
        return;
      }
      onSuccess();
      requestCharacterStatsRefetch();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  // FX rates haven't returned yet *and* the affordability path actually needs
  // them. The fast-path inside estimateImplicitAutoConvertCoverage already
  // covers same-currency buys without rates, so we only need to block when
  // conversion is required. This prevents the modal from mislabelling a
  // valid buy as "Short by …" during the brief CurrencyContext fetch window.
  const ratesNeededButMissing =
    !exchangeRates &&
    ((isCharacterBuy &&
      (shouldUseImplicitAutoConvert
        ? (personalBalances?.[bondCurrency] ?? 0) < totalCost
        : selectedPayCurrency !== bondCurrency)) ||
      (account === "corporation" &&
        !!corpLiquidCurrencyCode &&
        corpLiquidCurrencyCode !== bondCurrency));

  const canSubmit =
    !loading &&
    !ratesNeededButMissing &&
    units > 0 &&
    !fundsShort &&
    !notEnoughToSell &&
    !floatShort &&
    !(account === "corporation" && !hasCorp) &&
    !(account === "investmentBank" && !hasInvestmentBank);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-card-border bg-card shadow-modal">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-card-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Trade Bond</h2>
            <p className="mt-0.5 text-sm text-muted">
              {bond.corporationName}
              <span className="mx-2 text-card-border">·</span>
              Series {bond.maturityLabel}
              <span className="mx-2 text-card-border">·</span>
              <span className="tabular-nums">{fmtBondPrice(bond.pricePerUnit)}/unit</span>
              {/* Native price for foreign-issuer bonds — surfaces the issuer-currency
                  price alongside the player's display currency. */}
              {(() => {
                if (!userContext.homeCurrency || bondCurrency === userContext.homeCurrency)
                  return null;
                const nativeRate = forexRates?.[bondCurrency];
                if (!nativeRate) return null;
                const native = bond.pricePerUnit * nativeRate;
                return (
                  <span className="ml-1 text-xs tabular-nums text-muted/70">
                    ({formatCurrencyFaceAmount(native, bondCurrency)} native)
                  </span>
                );
              })()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 -mt-0.5 text-muted hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Buy / Sell toggle */}
          <div className="flex overflow-hidden rounded-lg border border-card-border text-xs">
            <button
              type="button"
              onClick={() => {
                setSide("buy");
                setUnits(0);
                setError("");
              }}
              className={`flex-1 border-r border-card-border py-2.5 text-center font-semibold transition-colors ${
                side === "buy"
                  ? "bg-success/15 text-success"
                  : "bg-card-elevated text-muted hover:text-foreground"
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => {
                setSide("sell");
                setUnits(0);
                setError("");
              }}
              className={`flex-1 py-2.5 text-center font-semibold transition-colors ${
                side === "sell"
                  ? "bg-error/15 text-error"
                  : "bg-card-elevated text-muted hover:text-foreground"
              }`}
            >
              Sell
            </button>
          </div>

          {/* Account toggle */}
          <div>
            <div className="flex overflow-hidden rounded-lg border border-card-border text-xs">
              <button
                type="button"
                onClick={() => {
                  setAccount("character");
                  setUnits(0);
                }}
                className={`flex-1 border-r border-card-border px-3 py-2.5 text-left transition-colors ${
                  account === "character"
                    ? "bg-primary/10 text-primary"
                    : "bg-card-elevated text-muted hover:text-foreground"
                }`}
              >
                <div className="font-semibold">Personally</div>
                <div
                  className={`mt-0.5 tabular-nums ${account === "character" ? "text-primary/70" : "text-muted/60"}`}
                >
                  {side === "buy"
                    ? `${formatFull(personalCashAnchor)} cash`
                    : `${userContext.myBondUnits.toLocaleString("en-US")} units`}
                </div>
              </button>
              <button
                type="button"
                onClick={() => hasCorp && setAccount("corporation")}
                disabled={
                  !hasCorp || (side === "sell" && (userContext.myCorporation?.bondUnits ?? 0) === 0)
                }
                title={
                  !hasCorp
                    ? "No corporation available"
                    : side === "sell" && (userContext.myCorporation?.bondUnits ?? 0) === 0
                      ? "Corporation holds no units"
                      : undefined
                }
                className={`flex-1 px-3 py-2.5 text-left transition-colors ${
                  !hasCorp || (side === "sell" && (userContext.myCorporation?.bondUnits ?? 0) === 0)
                    ? "opacity-40 cursor-not-allowed bg-card-elevated text-muted"
                    : account === "corporation"
                      ? "bg-primary/10 text-primary"
                      : "bg-card-elevated text-muted hover:text-foreground"
                }`}
              >
                <div className="font-semibold">As Corporation</div>
                <div
                  className={`mt-0.5 tabular-nums ${account === "corporation" ? "text-primary/70" : "text-muted/60"}`}
                >
                  {!hasCorp
                    ? "No corporation"
                    : side === "buy"
                      ? `${formatFull(userContext.myCorporation!.liquidCapital)} liquid`
                      : `${userContext.myCorporation!.bondUnits.toLocaleString("en-US")} units`}
                </div>
              </button>
              {hasInvestmentBank && (
                <button
                  type="button"
                  onClick={() => {
                    setAccount("investmentBank");
                    setUnits(0);
                  }}
                  disabled={side === "sell" && investmentBank.bondUnits === 0}
                  title={
                    side === "sell" && investmentBank.bondUnits === 0
                      ? "Investment bank holds no units"
                      : undefined
                  }
                  className={`flex-1 border-l border-card-border px-3 py-2.5 text-left transition-colors ${
                    side === "sell" && investmentBank.bondUnits === 0
                      ? "opacity-40 cursor-not-allowed bg-card-elevated text-muted"
                      : account === "investmentBank"
                        ? "bg-primary/10 text-primary"
                        : "bg-card-elevated text-muted hover:text-foreground"
                  }`}
                >
                  <div className="font-semibold">Investment bank</div>
                  <div
                    className={`mt-0.5 tabular-nums ${account === "investmentBank" ? "text-primary/70" : "text-muted/60"}`}
                  >
                    {side === "buy"
                      ? `${formatFull(investmentBank.liquidCapital)} liquid`
                      : `${investmentBank.bondUnits.toLocaleString("en-US")} units`}
                  </div>
                </button>
              )}
            </div>
            {/* ─ Pay-currency selector (sibling of Personally so it isn't a button-in-button) ─ */}
            {account === "character" && side === "buy" && personalBalances && (
              <div className="flex items-center justify-between mt-2 px-0.5">
                <span className="text-xs text-muted">Pay with</span>
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrencyDropdownOpen((o) => !o);
                    }}
                    className="flex items-center gap-1 tabular-nums text-xs text-primary/80 hover:text-primary"
                  >
                    <span>
                      {CURRENCY_SYMBOLS[selectedPayCurrency] ?? selectedPayCurrency}
                      {(personalBalances[selectedPayCurrency] ?? 0).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
                      <path d="M6 8L2 4h8L6 8z" />
                    </svg>
                  </button>
                  {currencyDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-card-border bg-card shadow-xl py-1">
                      {loadingRates ? (
                        <div className="px-3 py-2 text-xs text-muted">Loading rates…</div>
                      ) : getAffordableCurrencies(totalCost).length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted">No sufficient balance</div>
                      ) : (
                        getAffordableCurrencies(totalCost).map((code) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() => {
                              setSelectedPayCurrency(code);
                              setCurrencyDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-card-elevated transition-colors ${
                              code === selectedPayCurrency
                                ? "text-primary font-medium"
                                : "text-foreground"
                            }`}
                          >
                            <span>{code}</span>
                            <span className="tabular-nums font-mono text-muted">
                              {CURRENCY_SYMBOLS[code] ?? code}
                              {(personalBalances[code] ?? 0).toLocaleString("en-US", {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─ Auto-convert toggle ─────────────────────── */}
            {account === "character" &&
              side === "buy" &&
              personalBalances &&
              onAutoConvertChange && (
                <div className="flex items-center justify-between mt-2 px-0.5">
                  <span className="text-xs text-muted">Auto-convert shortfall</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoConvertEnabled}
                    onClick={handleAutoConvertToggle}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                      autoConvertEnabled ? "bg-primary" : "bg-card-border"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                        autoConvertEnabled ? "translate-x-4" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              )}
          </div>

          {/* Units input */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor={unitsInputId} className="text-xs text-muted">
                {side === "buy"
                  ? "Units to buy"
                  : `Units to sell · ${heldUnits.toLocaleString("en-US")} held`}
              </label>
              {side === "buy" && account !== "investmentBank" && (
                <span className="text-xs text-muted tabular-nums">
                  {bond.publicFloat.toLocaleString("en-US")} in float
                </span>
              )}
              {side === "sell" && heldUnits > 0 && (
                <button
                  type="button"
                  onClick={() => setUnits(heldUnits)}
                  className="text-xs text-muted hover:text-foreground transition-colors"
                >
                  Sell all
                </button>
              )}
            </div>
            <input
              id={unitsInputId}
              type="number"
              value={units || ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  setUnits(0);
                  return;
                }
                setUnits(Math.max(0, Math.floor(Number(raw))));
              }}
              onBlur={() => {
                if (units <= 0) return;
                // While FX rates are still loading, maxAllowedUnits collapses
                // to 0 because the affordability helper can't price a
                // conversion yet. Don't punish the user by clearing their
                // input — let the disabled Buy + "Loading market rates…"
                // banner explain the wait, then re-enable once rates land.
                if (ratesNeededButMissing) return;
                if (units > maxAllowedUnits) {
                  setUnits(maxAllowedUnits);
                }
              }}
              min={1}
              max={side === "sell" ? heldUnits : bond.publicFloat}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            />
          </div>

          {/* Summary */}
          <div className="rounded-lg border border-card-border bg-card-elevated/40 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Price per unit</span>
              <span className="tabular-nums font-medium text-foreground">
                {fmtBondAmount(costPerUnit)}
              </span>
            </div>
            <div className="flex justify-between border-t border-card-border pt-2">
              <span className="text-muted">{side === "buy" ? "Total cost" : "Proceeds"}</span>
              <span
                className={`tabular-nums font-medium ${fundsShort ? "text-error" : side === "sell" ? "text-success" : "text-foreground"}`}
              >
                {fmtBondAmount(totalCost)}
                {totalCost > 0 &&
                  bondCurrency !== (userContext.homeCurrency as CurrencyCode | undefined) && (
                    <span className="ml-1.5 text-xs font-normal text-muted/70">
                      ≈ {formatFull(totalCostAnchor)}
                    </span>
                  )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{budgetLabel}</span>
              <span className="tabular-nums font-medium">{budgetValue}</span>
            </div>
            {side === "buy" && estimatedFxFeeAnchor > 0 && (
              <div className="flex justify-between">
                <span className="text-muted">Est. FX fee</span>
                <span className="tabular-nums font-medium text-warning">
                  {formatFull(estimatedFxFeeAnchor)}
                </span>
              </div>
            )}
            {side === "buy" && !ratesNeededButMissing && (
              <div className="flex justify-between border-t border-card-border pt-2">
                <span className="text-muted">After purchase</span>
                <span
                  className={`tabular-nums font-medium ${fundsShort ? "text-error" : "text-foreground"}`}
                >
                  {afterPurchaseValue}
                </span>
              </div>
            )}
            {ratesNeededButMissing && (
              <p className="text-xs text-muted border-t border-card-border pt-2">
                Loading market rates…
              </p>
            )}
            {floatShort && (
              <p className="text-xs text-error border-t border-card-border pt-2">
                Only {bond.publicFloat.toLocaleString("en-US")} units available in float.
              </p>
            )}
            {notEnoughToSell && (
              <p className="text-xs text-error border-t border-card-border pt-2">
                You only hold {heldUnits.toLocaleString("en-US")} units.
              </p>
            )}
          </div>

          {error && <p className="text-xs text-error">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-card-border px-6 py-4">
          <Button variant="ghost" onClick={onClose} className="text-sm">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleTrade}
            disabled={!canSubmit}
            isLoading={loading}
            className={`text-sm shadow-none ${side === "sell" ? "bg-error hover:bg-error/90" : "bg-success hover:bg-success/90"}`}
          >
            {units > 0
              ? side === "buy"
                ? `Buy ${units} Unit${units !== 1 ? "s" : ""}`
                : `Sell ${units} Unit${units !== 1 ? "s" : ""}`
              : side === "buy"
                ? "Buy"
                : "Sell"}
          </Button>
        </div>
      </div>
    </div>
  );
}

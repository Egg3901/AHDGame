"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import {
  estimateExplicitPayCoverage,
  estimateImplicitAutoConvertCoverage,
} from "@/lib/currency/purchaseAffordability";
import { FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { quoteIndexFundSubscription, blendedRedeemFxRate } from "@/lib/indexFunds/unitAccounting";

type Mode = "subscribe" | "redeem";

type CharacterWallet = {
  currencyBalances?: { personal?: Partial<Record<CurrencyCode, number>> };
  homeCurrency?: CurrencyCode;
  autoConvertEnabled?: boolean;
  cashOnHand?: number;
};

export function FundTradePanel({
  fundId,
  quotedNav,
  anchorCurrencyCode,
  status,
  myUnits,
  myLegacyUnits,
  onSuccess,
  defaultMode = "subscribe",
}: {
  fundId: string;
  quotedNav: number;
  anchorCurrencyCode: string;
  status: string;
  myUnits: number;
  /**
   * Units held that redeem rate-free (× 1) under the #857 grandfather. Callers
   * pass `position.legacyUnits ?? position.units` — the same `?? units`
   * fail-safe the server redeem debit applies, so an un-stamped legacy position
   * quotes rate-free rather than over-promising. Post-fix positions pass 0.
   */
  myLegacyUnits: number;
  onSuccess: () => void;
  defaultMode?: Mode;
}) {
  const { formatFull, forexEnabled, forexRates, ratesLoading, toInternalFrom, formatPrice } =
    useCurrency();
  const fundCurrency = anchorCurrencyCode as CurrencyCode;

  const unitsInputId = useId();
  const [mode, setMode] = useState<Mode>(defaultMode);
  const [units, setUnits] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [wallet, setWallet] = useState<CharacterWallet | null>(null);
  const [autoConvertEnabled, setAutoConvertEnabled] = useState(true);
  const [selectedPayCurrency, setSelectedPayCurrency] = useState<CurrencyCode>(fundCurrency);
  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);

  const loadWallet = useCallback(async () => {
    try {
      const res = await fetch("/api/character/me", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { character?: CharacterWallet };
      if (!data.character) return;
      setWallet(data.character);
      if (data.character.autoConvertEnabled !== undefined) {
        setAutoConvertEnabled(data.character.autoConvertEnabled);
      }
      const home = (data.character.homeCurrency ?? fundCurrency) as CurrencyCode;
      setSelectedPayCurrency(home);
    } catch {
      // Non-fatal — subscribe still works for same-currency wallets.
    }
  }, [fundCurrency]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    if (!currencyDropdownOpen) return;
    const close = () => setCurrencyDropdownOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [currencyDropdownOpen]);

  const parsedUnits = useMemo(() => {
    const n = parseInt(units, 10);
    return Number.isInteger(n) && n >= 1 ? n : null;
  }, [units]);

  const subscribeEstimate = useMemo(() => {
    if (!parsedUnits || quotedNav <= 0) return null;
    try {
      return quoteIndexFundSubscription(quotedNav, parsedUnits);
    } catch {
      return null;
    }
  }, [parsedUnits, quotedNav]);

  const redeemEstimate = useMemo(() => {
    if (!parsedUnits || quotedNav <= 0) return null;
    // Grandfather (#857): a redemption drains legacy units first. Legacy units
    // (bought before the currency-scale fix) pay out rate-free (× 1); post-fix
    // units pay at the fund's native rate. Reuse the SAME helper the server
    // redeem debit uses (blendedRedeemFxRate) so this quote can never drift from
    // the credited cash — NOT the marked-to-market NAV × rate, which
    // over-promises ~rate× (≈100×) for legacy holders. Clamp legacy to units
    // actually held so a stale/oversized count can't inflate the quote.
    const rate = forexEnabled ? (forexRates?.[fundCurrency] ?? 1) : 1;
    const legacyHeld = Math.min(myUnits, Math.max(0, myLegacyUnits));
    const legacyRedeemed = Math.min(parsedUnits, legacyHeld);
    const blendedRate = blendedRedeemFxRate({
      legacyUnitsRedeemed: legacyRedeemed,
      totalUnits: parsedUnits,
      fundFxRate: rate,
      forexEnabled,
    });
    const payoutNative = parsedUnits * quotedNav * blendedRate;
    return {
      units: parsedUnits,
      payoutNative,
      legacyRedeemed,
      rate,
    };
  }, [parsedUnits, quotedNav, myUnits, myLegacyUnits, forexEnabled, forexRates, fundCurrency]);

  const personalBalances = wallet?.currencyBalances?.personal;
  const homeCurrency = (wallet?.homeCurrency ?? fundCurrency) as CurrencyCode;
  const exchangeRates = forexRates;
  const loadingRates = ratesLoading && !forexRates;
  const isSubscribe = mode === "subscribe";
  const showPaymentControls =
    isSubscribe && forexEnabled && !!personalBalances && Object.keys(personalBalances).length > 0;
  const shouldUseImplicitAutoConvert =
    showPaymentControls && autoConvertEnabled && selectedPayCurrency === homeCurrency;

  // `costAnchor` is denominated in ₳. The wallet legs (debit + affordability)
  // happen in the fund's native currency, so the native cost is ₳ × rate — the
  // same conversion the subscribe route applies server-side. Comparisons
  // against ₳ balances (`personalCashAnchor`) use the raw ₳ value.
  const totalCostAnchor = subscribeEstimate?.costAnchor ?? 0;
  const fundRate = forexEnabled ? (forexRates?.[fundCurrency] ?? 1) : 1;
  const totalCostNative = totalCostAnchor * fundRate;
  const selectedPayBalance = personalBalances?.[selectedPayCurrency] ?? 0;

  const explicitPayEstimate =
    showPaymentControls && !shouldUseImplicitAutoConvert
      ? estimateExplicitPayCoverage({
          requiredAmount: totalCostNative,
          fromCurrency: selectedPayCurrency,
          toCurrency: fundCurrency,
          availableBalance: selectedPayBalance,
          rates: exchangeRates ?? {},
        })
      : null;

  const implicitAutoConvertEstimate =
    showPaymentControls && shouldUseImplicitAutoConvert
      ? estimateImplicitAutoConvertCoverage({
          requiredAmount: totalCostNative,
          targetCurrency: fundCurrency,
          balances: personalBalances ?? {},
          rates: exchangeRates ?? {},
        })
      : null;

  function getAffordableCurrencies(cost: number): CurrencyCode[] {
    if (!personalBalances) return [];
    return (Object.entries(personalBalances) as [CurrencyCode, number][])
      .filter(([code, balance]) => {
        if ((balance ?? 0) <= 0) return false;
        if (code === fundCurrency) return (balance ?? 0) >= cost;
        if (
          !FOREX_ACTIVE_CURRENCIES.includes(code) ||
          !FOREX_ACTIVE_CURRENCIES.includes(fundCurrency)
        ) {
          return false;
        }
        if (!exchangeRates) return true;
        const estimate = estimateExplicitPayCoverage({
          requiredAmount: cost,
          fromCurrency: code,
          toCurrency: fundCurrency,
          availableBalance: balance ?? 0,
          rates: exchangeRates,
        });
        return estimate?.canAfford ?? false;
      })
      .map(([code]) => code);
  }

  const personalCashAnchor =
    personalBalances !== undefined
      ? Object.entries(personalBalances).reduce(
          (sum, [code, val]) => sum + toInternalFrom(val ?? 0, code as CurrencyCode),
          0
        )
      : (wallet?.cashOnHand ?? 0);

  const fundsShort =
    isSubscribe &&
    parsedUnits != null &&
    totalCostNative > 0 &&
    (showPaymentControls
      ? shouldUseImplicitAutoConvert
        ? !(
            implicitAutoConvertEstimate &&
            implicitAutoConvertEstimate.spendableInTarget >= totalCostNative
          )
        : selectedPayCurrency === fundCurrency
          ? selectedPayBalance < totalCostNative
          : !(explicitPayEstimate && explicitPayEstimate.canAfford)
      : totalCostAnchor > personalCashAnchor);

  const budgetLabel = !showPaymentControls
    ? "Your cash"
    : shouldUseImplicitAutoConvert
      ? `Spendable in ${fundCurrency}`
      : `Available in ${selectedPayCurrency}`;

  const budgetValue = !showPaymentControls
    ? formatFull(personalCashAnchor)
    : shouldUseImplicitAutoConvert
      ? implicitAutoConvertEstimate
        ? formatCurrencyFaceAmount(implicitAutoConvertEstimate.spendableInTarget, fundCurrency)
        : formatFull(personalCashAnchor)
      : formatCurrencyFaceAmount(selectedPayBalance, selectedPayCurrency);

  const estimatedFxFeeAnchor = showPaymentControls
    ? shouldUseImplicitAutoConvert
      ? Object.entries(implicitAutoConvertEstimate?.spreadFees ?? {}).reduce(
          (total, [code, fee]) => total + toInternalFrom(fee ?? 0, code as CurrencyCode),
          0
        )
      : toInternalFrom(explicitPayEstimate?.spreadFee ?? 0, selectedPayCurrency)
    : 0;

  const afterPurchaseValue = !showPaymentControls
    ? fundsShort
      ? `Short by ${formatFull(totalCostAnchor - personalCashAnchor)}`
      : formatFull(personalCashAnchor - totalCostAnchor)
    : shouldUseImplicitAutoConvert
      ? (() => {
          const spendable = implicitAutoConvertEstimate?.spendableInTarget ?? 0;
          return fundsShort
            ? `Short by ${formatCurrencyFaceAmount(totalCostNative - spendable, fundCurrency)}`
            : formatCurrencyFaceAmount(spendable - totalCostNative, fundCurrency);
        })()
      : (() => {
          const requiredSpend = explicitPayEstimate?.spendAmount ?? totalCostNative;
          return fundsShort
            ? `Short by ${formatCurrencyFaceAmount(
                totalCostNative - (explicitPayEstimate?.deliveredAmount ?? 0),
                fundCurrency
              )}`
            : formatCurrencyFaceAmount(selectedPayBalance - requiredSpend, selectedPayCurrency);
        })();

  const ratesNeededButMissing =
    isSubscribe &&
    !exchangeRates &&
    showPaymentControls &&
    (shouldUseImplicitAutoConvert
      ? (personalBalances?.[fundCurrency] ?? 0) < totalCostNative
      : selectedPayCurrency !== fundCurrency);

  const canSubscribe = status === "active";
  const canRedeem = status !== "delisted" && myUnits > 0;

  const handleAutoConvertToggle = () => {
    const newValue = !autoConvertEnabled;
    setAutoConvertEnabled(newValue);
    void fetch("/api/character/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoConvertEnabled: newValue }),
    });
  };

  const requestPayCurrency =
    showPaymentControls && !shouldUseImplicitAutoConvert ? selectedPayCurrency : undefined;

  const handleSubmit = async () => {
    if (!parsedUnits) {
      setError("Enter at least 1 whole unit");
      return;
    }
    if (mode === "redeem" && parsedUnits > myUnits) {
      setError(`You hold ${myUnits.toLocaleString("en-US")} units`);
      return;
    }
    if (mode === "subscribe" && !canSubscribe) {
      setError("This fund is not accepting subscriptions");
      return;
    }
    if (mode === "subscribe" && fundsShort) {
      setError("Insufficient funds");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const endpoint =
        mode === "subscribe"
          ? `/api/investment-funds/${fundId}/subscribe`
          : `/api/investment-funds/${fundId}/redeem`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          units: parsedUnits,
          ...(mode === "subscribe" && requestPayCurrency
            ? { payCurrency: requestPayCurrency }
            : {}),
        }),
      });
      const data = (await res.json()) as { error?: string; status?: string; queuedUnits?: number };

      if (!res.ok) {
        setError(data.error || "Request failed");
        return;
      }

      if (mode === "subscribe") {
        setMessage(`Subscribed to ${parsedUnits.toLocaleString("en-US")} unit(s).`);
        void loadWallet();
        requestCharacterStatsRefetch();
      } else if (data.status === "queued") {
        setMessage(
          `Redemption queued for ${(data.queuedUnits ?? parsedUnits).toLocaleString("en-US")} unit(s) — fund cash will pay out on the next cycle.`
        );
      } else if (data.status === "partial") {
        setMessage("Partial redemption paid; remainder queued for liquidity.");
      } else {
        setMessage(`Redeemed ${parsedUnits.toLocaleString("en-US")} unit(s).`);
      }
      setUnits("1");
      onSuccess();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const submitDisabled =
    loading ||
    ratesNeededButMissing ||
    (mode === "subscribe" ? !canSubscribe || fundsShort : !canRedeem);

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("subscribe")}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
            mode === "subscribe"
              ? "bg-primary/15 text-primary border border-primary/30"
              : "text-muted hover:text-foreground border border-transparent"
          }`}
        >
          Subscribe
        </button>
        <button
          type="button"
          onClick={() => setMode("redeem")}
          disabled={!canRedeem}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 ${
            mode === "redeem"
              ? "bg-secondary/15 text-secondary border border-secondary/30"
              : "text-muted hover:text-foreground border border-transparent"
          }`}
        >
          Redeem
        </button>
      </div>

      {showPaymentControls && (
        <div className="rounded-lg border border-card-border bg-card-elevated/40 px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
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
                  {formatCurrencyFaceAmount(
                    personalBalances?.[selectedPayCurrency] ?? 0,
                    selectedPayCurrency
                  )}
                </span>
                <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 8L2 4h8L6 8z" />
                </svg>
              </button>
              {currencyDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-card-border bg-card shadow-xl py-1">
                  {loadingRates ? (
                    <div className="px-3 py-2 text-xs text-muted">Loading rates…</div>
                  ) : getAffordableCurrencies(totalCostNative).length === 0 ? (
                    <div className="px-3 py-2 text-xs text-muted">No sufficient balance</div>
                  ) : (
                    getAffordableCurrencies(totalCostNative).map((code) => (
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
                          {formatCurrencyFaceAmount(personalBalances?.[code] ?? 0, code)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
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
        </div>
      )}

      <div>
        <label
          htmlFor={unitsInputId}
          className="text-[10px] uppercase tracking-widest text-muted font-semibold"
        >
          Units (whole numbers)
        </label>
        <input
          id={unitsInputId}
          type="number"
          min={1}
          step={1}
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm font-mono tabular-nums focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        {mode === "redeem" && myUnits > 0 && (
          <p className="mt-1 text-xs text-muted">
            You hold {myUnits.toLocaleString("en-US")} units
          </p>
        )}
      </div>

      <div className="rounded-lg bg-card-elevated border border-card-border px-3 py-2 text-sm space-y-1">
        <div className="flex justify-between gap-2">
          <span className="text-muted">NAV / unit</span>
          <span className="font-mono font-semibold tabular-nums">
            {/*
              Redeem mode shows the per-unit value at the SAME basis the payout
              is credited (× blendedRate), so the panel can't self-contradict for
              #857 grandfathered holders — whose legacy units pay ×1, not the
              ×FX-rate NAV shown fund-wide. For non-legacy holders blendedRate ===
              the fund rate, so this is identical to formatPrice(quotedNav).
              Subscribe mode keeps the true fund NAV (new units are charged × rate).
            */}
            {mode === "redeem" && redeemEstimate && redeemEstimate.units > 0
              ? formatCurrencyFaceAmount(
                  redeemEstimate.payoutNative / redeemEstimate.units,
                  fundCurrency
                )
              : formatPrice(quotedNav, fundCurrency)}
          </span>
        </div>
        {mode === "subscribe" && subscribeEstimate && (
          <>
            <div className="flex justify-between gap-2">
              <span className="text-muted">Estimated cost</span>
              <span
                className={`font-mono font-semibold tabular-nums ${fundsShort ? "text-error" : ""}`}
              >
                {formatFull(subscribeEstimate.costAnchor, fundCurrency)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted">{budgetLabel}</span>
              <span className="font-mono tabular-nums">{budgetValue}</span>
            </div>
            {estimatedFxFeeAnchor > 0 && (
              <div className="flex justify-between gap-2">
                <span className="text-muted">Est. FX fee</span>
                <span className="font-mono tabular-nums text-warning">
                  {formatFull(estimatedFxFeeAnchor)}
                </span>
              </div>
            )}
            {!ratesNeededButMissing && (
              <div className="flex justify-between gap-2 border-t border-card-border pt-1 mt-1">
                <span className="text-muted">After purchase</span>
                <span
                  className={`font-mono tabular-nums ${fundsShort ? "text-error" : "text-foreground"}`}
                >
                  {afterPurchaseValue}
                </span>
              </div>
            )}
            {ratesNeededButMissing && (
              <p className="text-[10px] text-muted pt-1">Loading market rates…</p>
            )}
            {fundsShort && !ratesNeededButMissing && (
              <p className="text-xs text-error pt-1">Insufficient funds</p>
            )}
          </>
        )}
        {mode === "redeem" && redeemEstimate && (
          <>
            <div className="flex justify-between gap-2">
              <span className="text-muted">Quoted payout</span>
              <span className="font-mono font-semibold tabular-nums">
                {formatCurrencyFaceAmount(redeemEstimate.payoutNative, fundCurrency)}
              </span>
            </div>
            {redeemEstimate.legacyRedeemed > 0 && redeemEstimate.rate !== 1 && (
              <p className="text-[10px] text-muted pt-1">
                {redeemEstimate.legacyRedeemed.toLocaleString("en-US")} of these unit
                {redeemEstimate.legacyRedeemed === 1 ? "" : "s"} are grandfathered from before the
                pricing fix and pay out at NAV without the currency conversion applied to newer
                units.
              </p>
            )}
            <p className="text-[10px] text-muted pt-1">
              Payout uses fund cash first; illiquid redemptions may queue until the hourly fund
              cycle.
            </p>
          </>
        )}
      </div>

      {error && (
        <p className="text-xs text-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="text-xs text-success" role="status">
          {message}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitDisabled}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {loading ? "Processing…" : mode === "subscribe" ? "Subscribe" : "Redeem units"}
      </button>
    </div>
  );
}

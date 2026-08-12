"use client";

import { useRef, useState } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { useCurrency } from "@/contexts/CurrencyContext";
import { CURRENCY_SYMBOLS, FOREX_ACTIVE_CURRENCIES } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { estimateExplicitPayCoverage } from "@/lib/currency/purchaseAffordability";
import type { OrderSide } from "./sharePurchaseModalTypes";

interface SharePurchaseAtMarketViewProps {
  atMarketSide: OrderSide;
  buyAsCorp: boolean;
  buyAsInvestmentBank: boolean;
  sellAsCorp: boolean;
  sellAsInvestmentBank: boolean;
  quantity: number;
  quantityDraft: string | null;
  selectedPayCurrency: CurrencyCode;
  onSwitchSide: (side: OrderSide) => void;
  setBuyAsCorp: (v: boolean) => void;
  setBuyAsInvestmentBank: (v: boolean) => void;
  setSellAsCorp: (v: boolean) => void;
  setSellAsInvestmentBank: (v: boolean) => void;
  setQuantity: (v: number) => void;
  setQuantityDraft: (v: string | null) => void;
  setSelectedPayCurrency: (v: CurrencyCode) => void;
  resetQuantity: (q: number) => void;
  parseQtyDigits: (raw: string, max?: number) => number;
  myCorporation: {
    id: string;
    name: string;
    liquidCapital: number;
    liquidCurrencyCode?: string;
    isInvestmentBank?: boolean;
  } | null;
  myShares: number;
  myCorporationShares: number;
  /** Whether the viewer is the current CEO of this corporation — drives the divest warning. */
  isCeo?: boolean;
  myCurrencyBalances: Partial<Record<string, number>> | undefined;
  autoConvertEnabled: boolean;
  onAutoConvertChange: ((enabled: boolean) => void) | undefined;
  corporationSharePrice: number;
  personalCashAnchor: number;
  myCorpLiquidInternal: number;
  myCorpLiquidCurrency: CurrencyCode;
  floatAvailable: number;
  maxBuyableShares: number;
  buyCost: number;
  activeBudget: number;
  personalBudgetLabel: string;
  personalBudgetValue: string;
  personalAfterPurchase: string;
  corpAtMarketAfterPurchase: string;
  estimatedFxFeeAnchor: number;
  floatInsufficient: boolean;
  floatFundsShort: boolean;
  sellAtMarketInsufficient: boolean;
  ratesNeededButMissing: boolean;
  homeCurrencyCode: CurrencyCode;
  corpCurrency: CurrencyCode;
}

export function SharePurchaseAtMarketView({
  atMarketSide,
  buyAsCorp,
  buyAsInvestmentBank,
  sellAsCorp,
  sellAsInvestmentBank,
  quantity,
  quantityDraft,
  selectedPayCurrency,
  onSwitchSide,
  setBuyAsCorp,
  setBuyAsInvestmentBank,
  setSellAsCorp,
  setSellAsInvestmentBank,
  setQuantity,
  setQuantityDraft,
  setSelectedPayCurrency,
  resetQuantity,
  parseQtyDigits,
  myCorporation,
  myShares,
  myCorporationShares,
  isCeo = false,
  myCurrencyBalances,
  autoConvertEnabled,
  onAutoConvertChange,
  corporationSharePrice,
  personalCashAnchor,
  myCorpLiquidInternal,
  myCorpLiquidCurrency,
  floatAvailable,
  maxBuyableShares,
  buyCost,
  activeBudget,
  personalBudgetLabel,
  personalBudgetValue,
  personalAfterPurchase,
  corpAtMarketAfterPurchase,
  estimatedFxFeeAnchor,
  floatInsufficient,
  floatFundsShort,
  sellAtMarketInsufficient,
  ratesNeededButMissing,
  homeCurrencyCode,
  corpCurrency,
}: SharePurchaseAtMarketViewProps) {
  const { formatAmount, toInternalFrom, forexRates, ratesLoading } = useCurrency();
  const exchangeRates = forexRates;
  const loadingRates = ratesLoading && !forexRates;

  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);
  const currencyDropdownRef = useRef<HTMLDivElement | null>(null);

  useClickOutside(currencyDropdownRef, currencyDropdownOpen, () => setCurrencyDropdownOpen(false));

  function getAffordableCurrencies(cost: number): CurrencyCode[] {
    if (!myCurrencyBalances) return [];
    const homeRate = exchangeRates?.[homeCurrencyCode];
    const costInHome = homeRate ? cost * homeRate : cost;
    return (Object.entries(myCurrencyBalances) as [string, number][])
      .filter(([code, balance]) => {
        if ((balance ?? 0) <= 0) return false;
        const c = code as CurrencyCode;
        if (c === homeCurrencyCode) return (balance ?? 0) >= costInHome;
        if (
          !FOREX_ACTIVE_CURRENCIES.includes(c) ||
          !FOREX_ACTIVE_CURRENCIES.includes(homeCurrencyCode)
        ) {
          return false;
        }
        if (!exchangeRates) return true;
        const estimate = estimateExplicitPayCoverage({
          requiredAmount: costInHome,
          fromCurrency: c,
          toCurrency: homeCurrencyCode,
          availableBalance: balance ?? 0,
          rates: exchangeRates,
        });
        return estimate?.canAfford ?? false;
      })
      .map(([code]) => code as CurrencyCode);
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

  return (
    <div className="space-y-4">
      {/* Buy / Sell toggle */}
      <div className="flex overflow-hidden rounded-lg border border-card-border text-xs">
        <button
          type="button"
          onClick={() => onSwitchSide("buy")}
          className={`flex-1 border-r border-card-border py-2.5 text-center font-semibold transition-colors ${
            atMarketSide === "buy"
              ? "bg-success/15 text-success"
              : "bg-card-elevated text-muted hover:text-foreground"
          }`}
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => onSwitchSide("sell")}
          className={`flex-1 py-2.5 text-center font-semibold transition-colors ${
            atMarketSide === "sell"
              ? "bg-error/15 text-error"
              : "bg-card-elevated text-muted hover:text-foreground"
          }`}
        >
          Sell
        </button>
      </div>

      {/* ─ Buy side ─────────────────────────────────────── */}
      {atMarketSide === "buy" && (
        <>
          <p className="text-xs text-muted">
            Buy at the current price. Personal and corporate purchases use the public float; an
            investment bank opens a prop-book position.
          </p>

          {myCorporation && (
            <div>
              <label className="mb-1.5 block text-xs text-muted">Purchase as</label>
              <div className="flex overflow-hidden rounded-lg border border-card-border text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setBuyAsCorp(false);
                    setBuyAsInvestmentBank(false);
                  }}
                  className={`flex-1 border-r border-card-border px-3 py-2.5 text-left transition-colors ${
                    !buyAsCorp && !buyAsInvestmentBank
                      ? "bg-primary/10 text-primary"
                      : "bg-card-elevated text-muted hover:text-foreground"
                  }`}
                >
                  <div className="font-semibold">Personally</div>
                  <div
                    className={`mt-0.5 tabular-nums ${!buyAsCorp && !buyAsInvestmentBank ? "text-primary/70" : "text-muted/60"}`}
                  >
                    {formatAmount(personalCashAnchor)}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBuyAsCorp(true);
                    setBuyAsInvestmentBank(false);
                  }}
                  className={`flex-1 px-3 py-2.5 text-left transition-colors ${
                    buyAsCorp
                      ? "bg-primary/10 text-primary"
                      : "bg-card-elevated text-muted hover:text-foreground"
                  }`}
                >
                  <div className="font-semibold">{myCorporation.name}</div>
                  <div
                    className={`mt-0.5 tabular-nums ${buyAsCorp ? "text-primary/70" : "text-muted/60"}`}
                  >
                    {formatAmount(myCorpLiquidInternal, myCorpLiquidCurrency)}
                  </div>
                </button>
                {myCorporation.isInvestmentBank && (
                  <button
                    type="button"
                    onClick={() => setBuyAsInvestmentBank(true)}
                    className={`flex-1 border-l border-card-border px-3 py-2.5 text-left transition-colors ${
                      buyAsInvestmentBank
                        ? "bg-primary/10 text-primary"
                        : "bg-card-elevated text-muted hover:text-foreground"
                    }`}
                  >
                    <div className="font-semibold">Investment bank</div>
                    <div
                      className={`mt-0.5 tabular-nums ${buyAsInvestmentBank ? "text-primary/70" : "text-muted/60"}`}
                    >
                      {formatAmount(myCorpLiquidInternal, myCorpLiquidCurrency)}
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Pay-currency selector + auto-convert */}
          {!buyAsCorp && !buyAsInvestmentBank && myCurrencyBalances && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-xs text-muted">Pay with</span>
                <div className="relative" ref={currencyDropdownRef}>
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
                      {(myCurrencyBalances[selectedPayCurrency] ?? 0).toLocaleString("en-US", {
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
                      ) : getAffordableCurrencies(buyCost).length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted">No sufficient balance</div>
                      ) : (
                        getAffordableCurrencies(buyCost).map((code) => (
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
                              {(myCurrencyBalances[code] ?? 0).toLocaleString("en-US", {
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
              {onAutoConvertChange && (
                <div className="flex items-center justify-between px-0.5">
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
          )}

          <div>
            <label className="mb-1.5 block text-xs text-muted">
              Shares to buy
              <span className="mx-1.5 text-card-border">·</span>
              {floatAvailable.toLocaleString("en-US")} in float
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={
                quantityDraft !== null ? quantityDraft : quantity === 0 ? "" : String(quantity)
              }
              onFocus={() => setQuantityDraft(quantity === 0 ? "" : String(quantity))}
              onChange={(e) => {
                const raw = e.target.value;
                setQuantityDraft(raw);
                setQuantity(
                  parseQtyDigits(raw, ratesNeededButMissing ? floatAvailable : maxBuyableShares)
                );
              }}
              onBlur={() => setQuantityDraft(null)}
              placeholder="Quantity"
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            />
          </div>

          {quantity > 0 && (
            <div className="rounded-lg border border-card-border bg-card-elevated/40 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Total cost</span>
                <span
                  className={`tabular-nums font-medium ${floatFundsShort ? "text-error" : "text-foreground"}`}
                >
                  {formatAmount(Math.round(buyCost))}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">
                  {buyAsCorp || buyAsInvestmentBank
                    ? buyAsInvestmentBank
                      ? "Bank liquid capital"
                      : "Corp liquid capital"
                    : personalBudgetLabel}
                </span>
                <span className="tabular-nums font-medium">
                  {buyAsCorp || buyAsInvestmentBank
                    ? formatAmount(activeBudget)
                    : personalBudgetValue}
                </span>
              </div>
              {estimatedFxFeeAnchor > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Est. FX fee</span>
                  <span className="tabular-nums font-medium text-warning">
                    {formatAmount(Math.round(estimatedFxFeeAnchor))}
                  </span>
                </div>
              )}
              {!ratesNeededButMissing && (
                <div className="flex justify-between border-t border-card-border pt-2">
                  <span className="text-muted">After purchase</span>
                  <span
                    className={`tabular-nums font-medium ${
                      floatFundsShort ? "text-error" : "text-success"
                    }`}
                  >
                    {buyAsCorp || buyAsInvestmentBank
                      ? buyAsInvestmentBank
                        ? formatAmount(activeBudget - buyCost)
                        : corpAtMarketAfterPurchase
                      : personalAfterPurchase}
                  </span>
                </div>
              )}
              {ratesNeededButMissing && (
                <p className="text-xs text-muted border-t border-card-border pt-2">
                  Loading market rates…
                </p>
              )}
              {floatInsufficient && (
                <p className="text-xs text-error border-t border-card-border pt-2">
                  Only {floatAvailable.toLocaleString("en-US")} shares available.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* ─ Sell side ────────────────────────────────────── */}
      {atMarketSide === "sell" && (
        <>
          <p className="text-xs text-muted">
            Sell shares instantly at the current market price. Proceeds credited immediately.
          </p>

          {myCorporation && (
            <div>
              <label className="mb-1.5 block text-xs text-muted">Sell as</label>
              <div className="flex overflow-hidden rounded-lg border border-card-border text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setSellAsCorp(false);
                    setSellAsInvestmentBank(false);
                    resetQuantity(0);
                  }}
                  className={`flex-1 border-r border-card-border px-3 py-2.5 text-left transition-colors ${
                    !sellAsCorp && !sellAsInvestmentBank
                      ? "bg-primary/10 text-primary"
                      : "bg-card-elevated text-muted hover:text-foreground"
                  }`}
                >
                  <div className="font-semibold">Personally</div>
                  <div
                    className={`mt-0.5 tabular-nums ${!sellAsCorp && !sellAsInvestmentBank ? "text-primary/70" : "text-muted/60"}`}
                  >
                    {myShares.toLocaleString("en-US")} shares
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (myCorporationShares > 0) {
                      setSellAsCorp(true);
                      setSellAsInvestmentBank(false);
                      resetQuantity(0);
                    }
                  }}
                  disabled={myCorporationShares === 0}
                  title={
                    myCorporationShares === 0 ? "Your corporation holds no shares here" : undefined
                  }
                  className={`flex-1 px-3 py-2.5 text-left transition-colors ${
                    myCorporationShares === 0
                      ? "opacity-40 cursor-not-allowed bg-card-elevated text-muted"
                      : sellAsCorp
                        ? "bg-primary/10 text-primary"
                        : "bg-card-elevated text-muted hover:text-foreground"
                  }`}
                >
                  <div className="font-semibold">{myCorporation.name}</div>
                  <div className="mt-0.5 tabular-nums text-muted/60">
                    {myCorporationShares === 0
                      ? "No shares held"
                      : `${myCorporationShares.toLocaleString("en-US")} shares`}
                  </div>
                </button>
                {myCorporation.isInvestmentBank && (
                  <button
                    type="button"
                    onClick={() => {
                      setSellAsInvestmentBank(true);
                      setSellAsCorp(false);
                      resetQuantity(0);
                    }}
                    className={`flex-1 border-l border-card-border px-3 py-2.5 text-left transition-colors ${
                      sellAsInvestmentBank
                        ? "bg-primary/10 text-primary"
                        : "bg-card-elevated text-muted hover:text-foreground"
                    }`}
                  >
                    <div className="font-semibold">Investment bank</div>
                    <div className="mt-0.5 tabular-nums text-muted/60">Prop-book position</div>
                  </button>
                )}
              </div>
              {myCorporationShares === 0 && (
                <p className="mt-1.5 text-xs text-muted">
                  Your corporation holds no shares in this company.
                </p>
              )}
            </div>
          )}

          {myCorporation && sellAsCorp && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-warning">
              This sells corporate-held shares back into the public float, reducing your
              corporation&apos;s ownership stake. This is the reverse of a buyback.
            </div>
          )}

          {isCeo && !sellAsCorp && myShares > 0 && quantity === myShares && (
            <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2.5 text-xs text-error">
              You are the CEO. Selling all {myShares.toLocaleString("en-US")} of your remaining
              shares will remove you as CEO — you&apos;ll need to be re-appointed to become CEO
              again. You&apos;ll be asked to confirm before this goes through.
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs text-muted">
                Shares to sell
                {!sellAsCorp && !sellAsInvestmentBank && (
                  <>
                    <span className="mx-1.5 text-card-border">·</span>
                    {myShares.toLocaleString("en-US")} owned
                  </>
                )}
              </label>
              {!sellAsInvestmentBank && (sellAsCorp ? myCorporationShares : myShares) > 0 && (
                <button
                  type="button"
                  onClick={() => resetQuantity(sellAsCorp ? myCorporationShares : myShares)}
                  className="text-xs text-muted hover:text-foreground transition-colors"
                >
                  Sell all
                </button>
              )}
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={
                quantityDraft !== null ? quantityDraft : quantity === 0 ? "" : String(quantity)
              }
              onFocus={() => setQuantityDraft(quantity === 0 ? "" : String(quantity))}
              onChange={(e) => {
                const raw = e.target.value;
                setQuantityDraft(raw);
                setQuantity(
                  parseQtyDigits(
                    raw,
                    sellAsInvestmentBank
                      ? Number.MAX_SAFE_INTEGER
                      : sellAsCorp
                        ? myCorporationShares
                        : myShares
                  )
                );
              }}
              onBlur={() => setQuantityDraft(null)}
              placeholder="Quantity"
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            />
            {sellAtMarketInsufficient && (
              <p className="mt-1 text-xs text-error">
                {sellAsCorp
                  ? `Corporation only holds ${myCorporationShares.toLocaleString("en-US")} shares.`
                  : `You only own ${myShares.toLocaleString("en-US")} shares.`}
              </p>
            )}
          </div>

          {quantity > 0 && (
            <div className="rounded-lg border border-card-border bg-card-elevated/40 p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Proceeds</span>
                <span className="tabular-nums font-medium text-success">
                  {formatAmount(
                    toInternalFrom(Math.round(quantity * corporationSharePrice), corpCurrency),
                    corpCurrency
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Credited to</span>
                <span className="tabular-nums font-medium text-foreground">
                  {sellAsCorp ? "Corp liquid capital" : "Your cash"}
                </span>
              </div>
              <div className="flex justify-between border-t border-card-border pt-2">
                <span className="text-muted">Shares remaining</span>
                <span className="tabular-nums font-medium text-foreground">
                  {Math.max(
                    0,
                    (sellAsCorp ? myCorporationShares : myShares) - quantity
                  ).toLocaleString("en-US")}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

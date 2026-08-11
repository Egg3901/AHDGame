"use client";

import { useState, useEffect, useId } from "react";
import type { ExchangeRateDisplay, WalletBalances } from "@/app/country/[code]/forex/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  FOREX_ACTIVE_CURRENCIES,
  MARKET_MAKER_SPREAD,
  LIMIT_ORDER_SPREAD,
} from "@/lib/constants/currencies";
import { calculateSpreadFee } from "@/lib/currency/spreadFees";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { requestCharacterStatsRefetch } from "@/lib/characterStatsSync";

type TradeMethod = "market" | "limit";

const SPREAD: Record<TradeMethod, number> = {
  market: MARKET_MAKER_SPREAD,
  limit: LIMIT_ORDER_SPREAD,
};

const METHOD_LABEL: Record<TradeMethod, string> = {
  market: "Market Order",
  limit: "Limit Order",
};

const METHOD_DESC: Record<TradeMethod, string> = {
  market: "Instant execution at current rate. 0.275% spread.",
  limit: "Executes when rate reaches your target. 0.175% spread.",
};

interface Props {
  open: boolean;
  onClose: () => void;
  rates: ExchangeRateDisplay[];
  wallet: WalletBalances | null;
  initialFrom?: CurrencyCode;
  initialTo?: CurrencyCode;
  onTradeComplete: () => void;
}

export function CurrencyTradeModal({
  open,
  onClose,
  rates,
  wallet,
  initialFrom,
  initialTo,
  onTradeComplete,
}: Props) {
  const available = FOREX_ACTIVE_CURRENCIES.filter((c) => rates.some((r) => r.currencyCode === c));

  const defaultFrom = initialFrom ?? wallet?.homeCurrency ?? available[0] ?? "USD";
  const defaultTo = initialTo ?? available.find((c) => c !== defaultFrom) ?? "GBP";

  const idBase = useId();
  const [method, setMethod] = useState<TradeMethod>("market");
  const [from, setFrom] = useState<CurrencyCode>(defaultFrom as CurrencyCode);
  const [to, setTo] = useState<CurrencyCode>(defaultTo as CurrencyCode);
  const [amount, setAmount] = useState("");
  const [limitRate, setLimitRate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Reset when opened with new pair
  useEffect(() => {
    if (open) {
      const newFrom = (initialFrom ??
        wallet?.homeCurrency ??
        available[0] ??
        "USD") as CurrencyCode;
      const candidateTo = (initialTo ??
        available.find((c) => c !== newFrom) ??
        "GBP") as CurrencyCode;
      const newTo =
        candidateTo === newFrom
          ? ((available.find((c) => c !== newFrom) ?? "GBP") as CurrencyCode)
          : candidateTo;
      setFrom(newFrom);
      setTo(newTo);
      setAmount("");
      setLimitRate("");
      setError("");
      setSuccess(false);
      setMethod("market");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFrom, initialTo]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const fromRate = rates.find((r) => r.currencyCode === from)?.rate ?? 1;
  const toRate = rates.find((r) => r.currencyCode === to)?.rate ?? 1;
  const crossRate = toRate / fromRate;
  const amt = parseFloat(amount) || 0;
  const spread = calculateSpreadFee(amt, SPREAD[method]);
  const received = amt > 0 && method === "market" ? Math.round((amt - spread) * crossRate) : 0;
  const personalBalance = wallet?.personal?.[from] ?? 0;

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amt || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (method === "limit" && !(parseFloat(limitRate) > 0)) {
      setError("Enter a valid limit rate");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      const body =
        method === "market"
          ? { fromCurrency: from, toCurrency: to, amount: amt }
          : {
              fromCurrency: from,
              toCurrency: to,
              amount: amt,
              type: "limit",
              limitRate: parseFloat(limitRate),
            };

      const res = await fetch(method === "market" ? "/api/forex/exchange" : "/api/forex/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Trade failed");
        setSubmitting(false);
        return;
      }

      setSuccess(true);
      requestCharacterStatsRefetch();
      onTradeComplete();
      setTimeout(onClose, 1500);
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close dialog"
      />
      <div className="relative w-full max-w-md rounded-xl border border-card-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-card-border">
          <h2 className="text-base font-bold text-foreground">Exchange Currency</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted hover:text-foreground hover:bg-card-elevated transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Method tabs */}
        <div className="flex border-b border-card-border">
          {(["market", "limit"] as TradeMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => setMethod(m)}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                method === m
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-muted">{METHOD_DESC[method]}</p>

          {/* Currency pair */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1 block">
                From
              </label>
              <select
                value={from}
                onChange={(e) => {
                  const newFrom = e.target.value as CurrencyCode;
                  // Auto-swap when the picked From matches current To, otherwise the
                  // To <select> would silently desync (filtered options vs. stale state).
                  if (newFrom === to) setTo(from);
                  setFrom(newFrom);
                }}
                className="w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none"
              >
                {available.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[10px] text-muted">
                Balance: {formatCurrencyFaceAmount(personalBalance ?? 0, from)}
              </div>
            </div>

            <button
              type="button"
              onClick={swap}
              className="mt-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-card-border bg-card-elevated text-muted hover:text-foreground transition-colors text-sm"
              title="Swap currencies"
            >
              ⇄
            </button>

            <div className="flex-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1 block">
                To
              </label>
              <select
                value={to}
                onChange={(e) => setTo(e.target.value as CurrencyCode)}
                className="w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-sm font-medium text-foreground focus:border-primary focus:outline-none"
              >
                {available
                  .filter((c) => c !== from)
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>
              <div className="mt-1 text-[10px] text-muted">
                Rate: {crossRate >= 10 ? crossRate.toFixed(2) : crossRate.toFixed(4)} {to}/{from}
              </div>
            </div>
          </div>

          {/* Amount slider */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label
                htmlFor={`${idBase}-amount`}
                className="text-[10px] font-semibold uppercase tracking-wider text-muted block"
              >
                Amount ({from})
              </label>
              <span className="text-xs font-medium tabular-nums">
                {formatCurrencyFaceAmount(amt, from)}
              </span>
            </div>
            <input
              id={`${idBase}-amount`}
              type="range"
              min={0}
              max={Math.max(personalBalance, 1)}
              step={1}
              value={amt}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-card-border accent-primary"
            />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-muted">0</span>
              <button
                type="button"
                onClick={() => setAmount(String(personalBalance))}
                className="text-[10px] text-primary hover:underline"
              >
                Max: {formatCurrencyFaceAmount(personalBalance, from)}
              </button>
            </div>
          </div>

          {/* Limit rate input */}
          {method === "limit" && (
            <div>
              <label
                htmlFor={`${idBase}-limit-rate`}
                className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1 block"
              >
                Limit Rate ({to}/{from})
              </label>
              <input
                id={`${idBase}-limit-rate`}
                type="number"
                value={limitRate}
                onChange={(e) => setLimitRate(e.target.value)}
                min="0.000001"
                step="any"
                placeholder={crossRate >= 10 ? crossRate.toFixed(2) : crossRate.toFixed(4)}
                className="w-full rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-[10px] text-muted">
                Order fills when rate reaches this level.
              </p>
            </div>
          )}

          {/* Preview */}
          {amt > 0 && (
            <div className="rounded-lg border border-card-border bg-card-elevated px-4 py-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">You send</span>
                <span className="font-medium tabular-nums">
                  {formatCurrencyFaceAmount(amt, from)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Spread ({(SPREAD[method] * 100).toFixed(3)}%)</span>
                <span className="text-error tabular-nums">
                  −{formatCurrencyFaceAmount(spread, from)}
                </span>
              </div>
              {method === "market" && (
                <div className="flex justify-between border-t border-card-border pt-1">
                  <span className="font-semibold text-foreground">You receive</span>
                  <span className="font-bold text-success tabular-nums">
                    {formatCurrencyFaceAmount(received, to)}
                  </span>
                </div>
              )}
              {method === "limit" && (
                <div className="text-muted pt-1 border-t border-card-border">
                  Order placed; fills when rate hits{" "}
                  <span className="font-medium text-foreground">
                    {parseFloat(limitRate) > 0
                      ? parseFloat(limitRate) >= 10
                        ? parseFloat(limitRate).toFixed(2)
                        : parseFloat(limitRate).toFixed(4)
                      : "—"}
                  </span>
                  .
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs text-error">{error}</p>}
          {success && <p className="text-xs text-success">Trade executed!</p>}

          <button
            type="submit"
            disabled={submitting || !amt || amt <= 0}
            className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Processing…" : method === "market" ? "Exchange Now" : "Place Order"}
          </button>
        </form>
      </div>
    </div>
  );
}

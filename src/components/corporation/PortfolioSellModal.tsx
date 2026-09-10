"use client";

import { useState, useId } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { PortfolioStockHolding, PortfolioBondHolding } from "./CorporationPageTypes";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { useDialogA11y } from "@/components/ui";

type SellMode = "instant" | "limit";

interface StockSellProps {
  type: "stock";
  holding: PortfolioStockHolding;
  corpId: string; // the corp being sold FROM (target corp whose shares we're selling)
  onClose: () => void;
  onSuccess: () => void;
}

interface BondSellProps {
  type: "bond";
  holding: PortfolioBondHolding;
  onClose: () => void;
  onSuccess: () => void;
}

type PortfolioSellModalProps = StockSellProps | BondSellProps;

export default function PortfolioSellModal(props: PortfolioSellModalProps) {
  const { dialogProps, titleId } = useDialogA11y(props.onClose);
  const { formatAmount, formatPrice: fmtPrice, toInternalFrom } = useCurrency();
  const norm = (value: number, ccy: CurrencyCode | undefined) =>
    ccy ? toInternalFrom(value, ccy) : value;
  const holdingCcy = props.holding.currencyCode;
  const idBase = useId();
  const [mode, setMode] = useState<SellMode>("instant");
  const [shares, setShares] = useState(props.type === "stock" ? String(props.holding.shares) : "");
  const [units, setUnits] = useState(props.type === "bond" ? String(props.holding.units) : "");
  const [limitPrice, setLimitPrice] = useState(
    props.type === "stock" ? String(props.holding.sharePrice) : ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      if (props.type === "bond") {
        const u = parseInt(units, 10);
        if (isNaN(u) || u <= 0) {
          setError("Enter a valid number of units");
          setSubmitting(false);
          return;
        }
        const res = await fetch(
          `/api/bonds/${props.holding.bondId}/sell?corporationId=${props.holding.holderCorpId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ units: u }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to sell bond");
          setSubmitting(false);
          return;
        }
        props.onSuccess();
        return;
      }

      const s = parseInt(shares, 10);
      if (isNaN(s) || s <= 0) {
        setError("Enter a valid number of shares");
        setSubmitting(false);
        return;
      }

      if (mode === "instant") {
        const res = await fetch(`/api/corporations/${props.corpId}/shares/sell`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shares: s, sellAsCorporation: true }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to sell");
          setSubmitting(false);
          return;
        }
      } else {
        const price = parseFloat(limitPrice);
        if (isNaN(price) || price <= 0) {
          setError("Enter a valid limit price");
          setSubmitting(false);
          return;
        }
        const res = await fetch(`/api/corporations/${props.corpId}/shares/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "sell",
            shares: s,
            pricePerShare: price,
            placeAsCorporation: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Failed to place order");
          setSubmitting(false);
          return;
        }
      }

      props.onSuccess();
    } catch {
      setError("Network error");
      setSubmitting(false);
    }
  }

  const pnlColor =
    props.type === "stock" && props.holding.unrealizedPnl !== null
      ? props.holding.unrealizedPnl >= 0
        ? "text-success"
        : "text-error"
      : "text-muted";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      {...dialogProps}
    >
      <div className="w-full max-w-md rounded-2xl border border-card-border bg-card shadow-2xl">
        <div className="border-b border-card-border px-6 py-4 flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            Sell {props.type === "stock" ? props.holding.corporationName : props.holding.issuerName}
          </h2>
          <button
            onClick={props.onClose}
            className="text-muted hover:text-foreground transition-colors"
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

        {/* Position summary */}
        <div className="px-6 py-4 border-b border-card-border bg-card-muted/20">
          {props.type === "stock" ? (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                  Shares Held
                </div>
                <div className="font-mono font-semibold">
                  {props.holding.shares.toLocaleString("en-US")}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                  Mkt Price
                </div>
                <div className="font-mono font-semibold">
                  {fmtPrice(norm(props.holding.sharePrice, holdingCcy))}
                </div>
              </div>
              {props.holding.avgCostPerShare !== null && (
                <>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                      Avg Cost
                    </div>
                    <div className="font-mono text-muted">
                      {fmtPrice(norm(props.holding.avgCostPerShare, holdingCcy))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                      Unr. P&amp;L
                    </div>
                    <div className={`font-mono font-semibold ${pnlColor}`}>
                      {props.holding.unrealizedPnl !== null
                        ? `${props.holding.unrealizedPnl >= 0 ? "+" : ""}${formatAmount(norm(props.holding.unrealizedPnl, holdingCcy))}`
                        : "—"}
                      {props.holding.unrealizedPnlPct !== null && (
                        <span className="text-xs ml-1">
                          ({props.holding.unrealizedPnlPct >= 0 ? "+" : ""}
                          {props.holding.unrealizedPnlPct}%)
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                  Units Held
                </div>
                <div className="font-mono font-semibold">
                  {props.holding.units.toLocaleString("en-US")}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                  Market Price
                </div>
                <div className="font-mono font-semibold">
                  {(props.holding.marketPrice * 100).toFixed(1)}¢
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Coupon</div>
                <div className="font-mono font-semibold text-warning">
                  {props.holding.couponRate}%
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
                  Turns Left
                </div>
                <div className="font-mono">{props.holding.turnsRemaining}</div>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {props.type === "stock" && (
            <div className="flex rounded-lg overflow-hidden border border-card-border text-sm">
              <button
                type="button"
                onClick={() => setMode("instant")}
                className={`flex-1 py-2 font-medium transition-colors ${
                  mode === "instant"
                    ? "bg-primary text-white"
                    : "bg-card-elevated text-muted hover:text-foreground"
                }`}
              >
                Instant Sell
              </button>
              <button
                type="button"
                onClick={() => setMode("limit")}
                className={`flex-1 py-2 font-medium transition-colors ${
                  mode === "limit"
                    ? "bg-primary text-white"
                    : "bg-card-elevated text-muted hover:text-foreground"
                }`}
              >
                Limit Order
              </button>
            </div>
          )}

          {props.type === "stock" ? (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor={`${idBase}-shares`}
                  className="block text-xs font-medium text-muted mb-1.5"
                >
                  Shares to sell
                </label>
                <input
                  id={`${idBase}-shares`}
                  type="number"
                  min={1}
                  max={props.holding.shares}
                  value={shares}
                  onChange={(e) => setShares(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-card-muted/40 px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-[11px] text-muted mt-1">
                  {props.holding.shares.toLocaleString("en-US")} shares available
                </p>
              </div>
              {mode === "limit" && (
                <div>
                  <label
                    htmlFor={`${idBase}-limit-price`}
                    className="block text-xs font-medium text-muted mb-1.5"
                  >
                    Limit price per share
                  </label>
                  <input
                    id={`${idBase}-limit-price`}
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    className="w-full rounded-lg border border-card-border bg-card-muted/40 px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              )}
            </div>
          ) : (
            <div>
              <label
                htmlFor={`${idBase}-units`}
                className="block text-xs font-medium text-muted mb-1.5"
              >
                Units to sell
              </label>
              <input
                id={`${idBase}-units`}
                type="number"
                min={1}
                max={props.holding.units}
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className="w-full rounded-lg border border-card-border bg-card-muted/40 px-3 py-2 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-[11px] text-muted mt-1">
                {props.holding.units.toLocaleString("en-US")} units available
              </p>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-error/10 border border-error/20 px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={props.onClose}
              className="flex-1 rounded-lg border border-card-border px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Selling…" : mode === "limit" ? "Place Order" : "Sell"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

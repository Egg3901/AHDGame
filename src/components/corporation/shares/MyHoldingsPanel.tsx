"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";

interface MyHoldingsPanelProps {
  myShares: number;
  myShareValue: number;
  myOwnershipPct: number;
  myCashOnHand: number;
  myEscrowedTotal: number;
}

export default function MyHoldingsPanel({
  myShares,
  myShareValue,
  myOwnershipPct,
  myCashOnHand,
  myEscrowedTotal,
}: MyHoldingsPanelProps) {
  const { formatAmount } = useCurrency();
  const [open, setOpen] = useState(false);

  // Hidden when the user holds no shares
  if (myShares === 0) return null;

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {/* Collapsed summary row — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-3 text-left group hover:bg-card-elevated/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold text-foreground">Your Holdings</span>
          <span className="text-sm text-muted tabular-nums">
            {myShares.toLocaleString("en-US")} shares
          </span>
          <span className="hidden sm:inline text-xs text-muted">·</span>
          <span className="hidden sm:inline text-xs text-muted tabular-nums">
            {myOwnershipPct.toFixed(2)}%
          </span>
          <span className="hidden sm:inline text-xs text-muted">·</span>
          <span className="hidden sm:inline text-xs text-success tabular-nums">
            {formatAmount(myShareValue)}
          </span>
        </div>
        <span className="text-xs text-muted group-hover:text-foreground transition-colors shrink-0 ml-3">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {/* Expanded details */}
      {open && (
        <div className="border-t border-card-border">
          {/* Stats strip */}
          <div className="grid grid-cols-3 divide-x divide-card-border">
            <div className="px-4 py-3">
              <div className="text-xs text-muted mb-0.5">Shares Owned</div>
              <div className="text-sm font-semibold text-primary tabular-nums">
                {myShares.toLocaleString("en-US")}
              </div>
              <div className="text-xs text-muted">{myOwnershipPct.toFixed(2)}%</div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs text-muted mb-0.5">Portfolio Value</div>
              <div className="text-sm font-semibold text-success tabular-nums">
                {formatAmount(myShareValue)}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs text-muted mb-0.5">Cash on Hand</div>
              <div className="text-sm font-semibold text-foreground tabular-nums">
                {formatAmount(myCashOnHand)}
              </div>
            </div>
          </div>

          {/* Escrow warning */}
          {myEscrowedTotal > 0 && (
            <div className="px-4 py-2.5 border-t border-card-border text-sm">
              <span className="text-muted">In open buy orders: </span>
              <span className="font-medium text-warning">
                {formatAmount(Math.round(myEscrowedTotal))} reserved
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

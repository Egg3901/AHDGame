"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { BondDetail, BondUserContext } from "./bondTypes";

export function BondMyHoldingsPanel({
  userContext,
  bond,
}: {
  userContext: BondUserContext;
  bond: BondDetail;
}) {
  const { formatAmount, formatFull, toInternalFrom } = useCurrency();
  const [open, setOpen] = useState(false);
  const charValue = userContext.myBondUnits * bond.pricePerUnit;
  const charCouponPerTurn = userContext.myBondUnits * bond.perTurnCoupon;
  const corpCouponPerTurn = (userContext.myCorporation?.bondUnits ?? 0) * bond.perTurnCoupon;
  // `myCashOnHand` is server-anchored against the rates the API saw; rates can
  // shift before the client renders (turn boundary), inflating a same-currency
  // round-trip. When raw balances are present, recompute anchor with client
  // rates so this row matches the wallet on the profile strip.
  const personalCashAnchor =
    userContext.currencyBalances?.personal !== undefined
      ? Object.entries(userContext.currencyBalances.personal).reduce(
          (sum, [code, val]) => sum + toInternalFrom(val ?? 0, code as CurrencyCode),
          0
        )
      : userContext.myCashOnHand;

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-3 text-left group hover:bg-card-elevated/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold text-foreground">Your Holdings</span>
          {userContext.myBondUnits > 0 && (
            <>
              <span className="text-sm text-muted tabular-nums">
                {userContext.myBondUnits.toLocaleString("en-US")} units
              </span>
              <span className="hidden sm:inline text-xs text-muted">·</span>
              <span className="hidden sm:inline text-xs text-success tabular-nums">
                {formatAmount(charValue)}
              </span>
            </>
          )}
          {(userContext.myCorporation?.bondUnits ?? 0) > 0 && (
            <span className="text-xs text-muted">
              + {userContext.myCorporation!.bondUnits.toLocaleString("en-US")} corp units
            </span>
          )}
        </div>
        <span className="text-xs text-muted group-hover:text-foreground transition-colors shrink-0 ml-3">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="border-t border-card-border">
          <div
            className={`grid divide-x divide-card-border ${userContext.myCorporation ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}
          >
            <div className="px-4 py-3">
              <div className="text-xs text-muted mb-0.5">Units Held</div>
              <div className="text-sm font-semibold text-primary tabular-nums">
                {userContext.myBondUnits.toLocaleString("en-US")}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs text-muted mb-0.5">Portfolio Value</div>
              <div className="text-sm font-semibold text-success tabular-nums">
                {formatAmount(charValue)}
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="text-xs text-muted mb-0.5">Coupon / Turn</div>
              <div className="text-sm font-semibold text-foreground tabular-nums">
                {formatAmount(charCouponPerTurn)}
              </div>
            </div>
            {userContext.myCorporation && (userContext.myCorporation.bondUnits > 0 || true) && (
              <div className="px-4 py-3">
                <div className="text-xs text-muted mb-0.5">{userContext.myCorporation.name}</div>
                <div className="text-sm font-semibold text-foreground tabular-nums">
                  {userContext.myCorporation.bondUnits.toLocaleString("en-US")} units
                </div>
                {corpCouponPerTurn > 0 && (
                  <div className="text-xs text-muted tabular-nums">
                    {formatAmount(corpCouponPerTurn)}/turn
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="px-4 py-2.5 border-t border-card-border">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Cash on Hand</span>
              <span className="font-medium tabular-nums">{formatFull(personalCashAnchor)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  assessCapital,
  capitalShortfall,
  type BankBorrowings,
} from "@/lib/banking/capitalAdequacy";
import type { ShowToast } from "../types";

export function RecapitalizePanel({
  corporationId,
  currency,
  cashReserves,
  requiredReservesAmount,
  withdrawable,
  totalLoans,
  propBookMarkValue,
  borrowings,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  cashReserves: number;
  requiredReservesAmount: number;
  withdrawable: number;
  totalLoans: number;
  propBookMarkValue: number;
  borrowings: BankBorrowings;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const position = assessCapital({
    cashReserves,
    totalLoans,
    borrowings,
    propBookMarkValue,
  });
  const shortfall = capitalShortfall(position);
  const [amount, setAmount] = useState(shortfall > 0 ? String(shortfall) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (shortfall > 0) setAmount(String(shortfall));
  }, [shortfall]);

  const move = async (direction: "in" | "out") => {
    const a = parseFloat(amount);
    if (!(a > 0)) {
      showToast("Positive amount required", "error");
      return;
    }
    setBusy(true);
    try {
      const path = direction === "in" ? "recapitalize" : "upstream";
      const res = await fetch(`/api/corporations/${corporationId}/bank/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: a }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not move capital", "error");
        return;
      }
      showToast(
        json.message ?? (direction === "in" ? "Capital posted" : "Cash withdrawn"),
        "success"
      );
      setAmount("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 space-y-4 max-w-xl">
      <div>
        <h3 className="text-base font-semibold text-foreground">Capital adequacy</h3>
        <p className="text-sm text-muted">
          Money moved here crosses into the bank and stands behind the depositors. It can only come
          back out of reserves the bank holds above its requirement, and only while the supervisor
          rates it adequate.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted">Bank cash</div>
          <div className="font-mono tabular-nums text-foreground">
            {formatBankMoney(cashReserves, currency)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted">Held vs deposits</div>
          <div className="font-mono tabular-nums text-foreground">
            {formatBankMoney(requiredReservesAmount, currency)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted">Free to withdraw</div>
          <div className="font-mono tabular-nums text-foreground">
            {formatBankMoney(withdrawable, currency)}
          </div>
        </div>
      </div>
      <div className="text-sm space-y-1">
        <p className="font-mono tabular-nums text-foreground">
          Capital ratio {(position.capitalRatio * 100).toFixed(1)}%
        </p>
        {shortfall > 0 ? (
          <p className="text-error">
            Undercapitalized. Post {formatBankMoney(shortfall, currency)} to clear the minimum.
          </p>
        ) : (
          <p className="text-muted">
            Standing: {position.standing}. No capital shortfall at current book values.
          </p>
        )}
      </div>
      {canMutate && (
        <>
          <label className="block space-y-1 text-xs text-muted max-w-xs">
            Amount
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              aria-label="Capital transfer amount"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void move("in")} disabled={busy}>
              {busy ? "Working..." : "Move into bank"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void move("out")}
              disabled={busy || withdrawable <= 0}
              title={
                withdrawable > 0
                  ? undefined
                  : "Nothing free to withdraw: reserves are required against deposits, or the supervisor has not cleared the bank."
              }
            >
              Withdraw to treasury
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

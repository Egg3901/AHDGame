"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  MIN_CAPITAL_RATIO,
  RECAP_GRACE_TURNS,
  assessCapital,
  capitalShortfall,
  type BankBorrowings,
} from "@/lib/banking/capitalAdequacy";
import type { ShowToast } from "../types";
import { turnsToHours } from "../lib/helpers";
import { SmallButton } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";
import { StatCell } from "../components/StatCell";

export function RecapitalizePanel({
  corporationId,
  currency,
  cashReserves,
  requiredReservesAmount,
  withdrawable,
  totalLoans,
  sovereignTreasuryMarkValue,
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
  sovereignTreasuryMarkValue: number;
  propBookMarkValue: number;
  borrowings: BankBorrowings;
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const position = assessCapital({
    cashReserves,
    totalLoans,
    sovereignTreasuryMarkValue,
    borrowings,
    propBookMarkValue,
  });
  const shortfall = capitalShortfall(position);
  const [amount, setAmount] = useState(shortfall > 0 ? String(shortfall) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (shortfall > 0) setAmount(String(shortfall));
  }, [shortfall]);

  const minPercent = (MIN_CAPITAL_RATIO * 100).toFixed(0);

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
        direction === "in"
          ? `Posted ${formatBankMoney(a, currency)}: it now stands behind depositors and lifts the capital ratio toward the ${minPercent}% minimum.`
          : `Withdrew ${formatBankMoney(a, currency)} to the treasury: only cash above the reserve requirement can leave, and only while capital clears the ${minPercent}% minimum.`,
        "success"
      );
      setAmount("");
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BankPanel kind="ceoControl" title="Capital adequacy">
      <div className="space-y-2 py-1.5">
        <p className="text-xs text-muted">
          The supervisor requires your own cash, after every borrowed claim on it, to cover at least{" "}
          {minPercent}% of the loan book plus your own investments. Money moved here crosses into
          the bank and stands behind the depositors. It can only come back out of reserves the bank
          holds above its requirement, and only while the supervisor rates it adequate.
        </p>
        <p className="text-[11px] text-muted">
          Falling below {minPercent}% starts a {turnsToHours(RECAP_GRACE_TURNS)} clock to post
          capital. Missing it revokes the charter: the bank is wound up in an orderly way and
          remaining capital is returned. That is not a bank failure: depositors are paid out, they
          do not take a haircut.{" "}
          <Link
            href="/wiki/private-banking"
            className="text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
          >
            How banking works
          </Link>
        </p>
      </div>
      <div className="grid gap-x-8 gap-y-4 pt-1 md:grid-cols-2">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <StatCell label="Bank cash" value={formatBankMoney(cashReserves, currency)} />
            <StatCell
              label="Held vs deposits"
              value={formatBankMoney(requiredReservesAmount, currency)}
            />
            <StatCell label="Free to withdraw" value={formatBankMoney(withdrawable, currency)} />
            <StatCell
              label="Capital ratio"
              value={`${(position.capitalRatio * 100).toFixed(1)}%`}
              tone={
                shortfall > 0
                  ? "text-error"
                  : position.standing === "stressed"
                    ? "text-warning"
                    : "text-success"
              }
            />
          </div>
          {shortfall > 0 ? (
            <p className="text-xs text-error">
              Below the {minPercent}% minimum. Post {formatBankMoney(shortfall, currency)} to clear
              it, within {turnsToHours(RECAP_GRACE_TURNS)} of the breach starting, or the charter is
              revoked.
            </p>
          ) : position.standing === "stressed" ? (
            <p className="text-xs text-muted">
              Capital {(position.capitalRatio * 100).toFixed(1)}%, above the {minPercent}% minimum
              but failing the supervisor&apos;s shock scenario: payouts stay barred until the
              stressed ratio clears. No capital shortfall at current book values.
            </p>
          ) : (
            <p className="text-xs text-muted">
              Capital {(position.capitalRatio * 100).toFixed(1)}%, above the {minPercent}% minimum
              and clearing the shock scenario. No capital shortfall at current book values.
            </p>
          )}
        </div>
        {canMutate && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Amount
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                aria-label="Capital transfer amount"
                className="h-8 w-40 rounded-md border border-card-border bg-background px-2 font-mono text-[13px] text-foreground focus:border-foreground focus:outline-none"
              />
            </label>
            <SmallButton tone="primary" onClick={() => void move("in")} disabled={busy}>
              {busy ? "Working..." : "Move into bank"}
            </SmallButton>
            <SmallButton
              onClick={() => void move("out")}
              disabled={busy || withdrawable <= 0}
              title={
                withdrawable > 0
                  ? undefined
                  : "Nothing free to withdraw: reserves are required against deposits, or the supervisor has not cleared the bank."
              }
            >
              Withdraw to treasury
            </SmallButton>
          </div>
        )}
      </div>
    </BankPanel>
  );
}

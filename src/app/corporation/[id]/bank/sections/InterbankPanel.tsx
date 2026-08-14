"use client";

import { useReducer } from "react";
import Link from "next/link";
import { Badge, Button, Input } from "@/components/ui";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ConsolePayload, Party, ShowToast } from "../types";
import { mergeState, partyHref } from "../lib/helpers";
import { PartySearch } from "../components/PartySearch";
import { StatCell } from "../components/StatCell";

/**
 * Both desks on this panel share one in-flight flag, and the lend form clears
 * its three fields together on success, so the panel carries a single state
 * group rather than a setter per input.
 */
type InterbankState = {
  borrower: Party | null;
  amount: string;
  rate: string;
  marginAmount: string;
  busy: boolean;
};

export function InterbankPanel({
  corporationId,
  currency,
  depositTaking,
  interbankDebt,
  cbMarginDebt,
  loans,
  canMutate,
  onChanged,
  showToast,
}: {
  corporationId: string;
  currency: CurrencyCode;
  depositTaking: boolean;
  interbankDebt: number;
  cbMarginDebt: number;
  loans: ConsolePayload["interbankLoans"];
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const [{ borrower, amount, rate, marginAmount, busy }, updateInterbankState] = useReducer(
    mergeState<InterbankState>,
    { borrower: null, amount: "", rate: "", marginAmount: "", busy: false }
  );

  const lend = async () => {
    const a = parseFloat(amount);
    const r = parseFloat(rate);
    if (!borrower || !(a > 0) || !(r >= 0)) {
      showToast("Pick a borrowing bank and enter an amount and a non-negative rate", "error");
      return;
    }
    updateInterbankState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/interbank/loans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrowerCorporationId: borrower.id,
          amount: a,
          ratePercent: r,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not lend interbank", "error");
        return;
      }
      showToast("Interbank loan originated", "success");
      updateInterbankState({ borrower: null, amount: "", rate: "" });
      await onChanged();
    } finally {
      updateInterbankState({ busy: false });
    }
  };

  const margin = async (action: "draw" | "repay") => {
    const a = parseFloat(marginAmount);
    if (!(a > 0)) {
      showToast("Positive amount required", "error");
      return;
    }
    updateInterbankState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/interbank/margin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, amount: a }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? `Could not ${action} margin`, "error");
        return;
      }
      showToast(action === "draw" ? "Margin drawn" : "Margin repaid", "success");
      updateInterbankState({ marginAmount: "" });
      await onChanged();
    } finally {
      updateInterbankState({ busy: false });
    }
  };

  return (
    <section className="space-y-4">
      <h3 className="text-base font-semibold text-foreground">Interbank &amp; CB margin</h3>
      <div className="rounded-xl border border-card-border bg-card grid grid-cols-2 divide-x divide-card-border max-w-xl">
        <StatCell
          label="Interbank debt"
          value={formatBankMoney(interbankDebt, currency)}
          sub="borrowed outstanding"
        />
        <StatCell
          label="CB margin debt"
          value={formatBankMoney(cbMarginDebt, currency)}
          sub="collateralised line"
        />
      </div>

      {depositTaking && canMutate && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3 max-w-2xl">
          <p className="text-sm text-muted">Lend non-reserved deposits to an investment bank.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 text-xs text-muted sm:col-span-3">
              Borrowing bank
              {borrower ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground">{borrower.name}</span>
                  <button
                    type="button"
                    onClick={() => updateInterbankState({ borrower: null })}
                    className="text-xs text-muted underline hover:text-foreground"
                  >
                    change
                  </button>
                </div>
              ) : (
                <PartySearch
                  kind="corporation"
                  excludeIds={[corporationId]}
                  disabled={busy}
                  onPick={(party) => updateInterbankState({ borrower: party })}
                />
              )}
            </div>
            <label className="block space-y-1 text-xs text-muted">
              Amount
              <Input
                value={amount}
                onChange={(e) => updateInterbankState({ amount: e.target.value })}
                inputMode="decimal"
                aria-label="Interbank lend amount"
              />
            </label>
            <label className="block space-y-1 text-xs text-muted">
              Rate %
              <Input
                value={rate}
                onChange={(e) => updateInterbankState({ rate: e.target.value })}
                inputMode="decimal"
                aria-label="Interbank lend rate"
              />
            </label>
          </div>
          <Button type="button" onClick={() => void lend()} disabled={busy}>
            {busy ? "Working..." : "Lend interbank"}
          </Button>
        </div>
      )}

      {canMutate && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3 max-w-xl">
          <p className="text-sm text-muted">Draw or repay the central bank margin line.</p>
          <label className="block space-y-1 text-xs text-muted max-w-xs">
            Amount
            <Input
              value={marginAmount}
              onChange={(e) => updateInterbankState({ marginAmount: e.target.value })}
              inputMode="decimal"
              aria-label="CB margin amount"
            />
          </label>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void margin("draw")} disabled={busy}>
              Draw
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void margin("repay")}
              disabled={busy}
            >
              Repay
            </Button>
          </div>
        </div>
      )}

      {loans.length > 0 && (
        <div className="overflow-x-auto overflow-hidden rounded-xl border border-card-border bg-card">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-widest text-muted">
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Counterparty</th>
                <th className="px-4 py-3 font-semibold text-right">Outstanding</th>
                <th className="px-4 py-3 font-semibold text-right">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {loans.map((loan) => (
                <tr key={loan.id}>
                  <td className="px-4 py-3">
                    <Badge color="default" variant="subtle">
                      {loan.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {loan.counterparty ? (
                      <Link
                        href={partyHref("corporation", loan.counterparty)}
                        className="text-primary hover:opacity-80"
                      >
                        {loan.counterparty.name}
                      </Link>
                    ) : (
                      <span className="text-muted">Unknown bank</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatBankMoney(loan.outstanding, currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {formatRatePercent(loan.ratePercent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

"use client";

import { useReducer } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Button, Input } from "@/components/ui";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { perTurnInterestOn } from "@/lib/banking/rules/loans";
import { CB_MARGIN_COLLATERAL_FRACTION, cbMarginRatePercent } from "@/lib/banking/rules/decide";
import type { ConsolePayload, Party, ShowToast } from "../types";
import { mergeState, partyHref } from "../lib/helpers";
import { PartySearch } from "../components/PartySearch";
import { StatCell } from "../components/StatCell";
import { Eyebrow } from "../components/BankSection";

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
  propBookMarkValue,
  primeRate,
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
  /** Current value of the bank's own investments: the credit line's collateral. */
  propBookMarkValue: number;
  /** Prime rate, so the credit-line cost preview prices the full rate. */
  primeRate: number | null;
  loans: ConsolePayload["interbankLoans"];
  canMutate: boolean;
  onChanged: () => Promise<void>;
  showToast: ShowToast;
}) {
  const t = useTranslations("corporations.bankConsole");
  const [{ borrower, amount, rate, marginAmount, busy }, updateInterbankState] = useReducer(
    mergeState<InterbankState>,
    { borrower: null, amount: "", rate: "", marginAmount: "", busy: false }
  );

  // Consequence preview for the lend form: interbank loans are interest-only
  // with no fixed maturity (rules/interbankServicing: principal returns
  // through repayment), so the preview prices one turn of income at the
  // entered rate and names the reserve cost up front.
  const lendAmount = parseFloat(amount);
  const lendRate = parseFloat(rate);
  const validLend =
    borrower != null &&
    Number.isFinite(lendAmount) &&
    lendAmount > 0 &&
    Number.isFinite(lendRate) &&
    lendRate >= 0;
  const lendIncomePerTurn = validLend ? perTurnInterestOn(lendAmount, lendRate) : null;

  const lend = async () => {
    if (!validLend) {
      showToast("Pick a borrowing bank and enter an amount and a non-negative rate", "error");
      return;
    }
    updateInterbankState({ busy: true });
    try {
      const res = await fetch(`/api/corporations/${corporationId}/bank/interbank/loans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          borrowerCorporationId: borrower!.id,
          amount: lendAmount,
          ratePercent: lendRate,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast(json.error ?? "Could not lend interbank", "error");
        return;
      }
      showToast(
        `Lent ${formatBankMoney(lendAmount, currency)} to ${borrower!.name}: earns about ${formatBankMoney(lendIncomePerTurn ?? 0, currency)} each turn until repaid, and ties up ${formatBankMoney(lendAmount, currency)} of cash above the reserve requirement.`,
        "success"
      );
      updateInterbankState({ borrower: null, amount: "", rate: "" });
      await onChanged();
    } finally {
      updateInterbankState({ busy: false });
    }
  };

  // The central bank credit line is collateralised: debt may not exceed half
  // the current value of the bank's own investments
  // (rules/decide.CB_MARGIN_COLLATERAL_FRACTION), priced at prime plus the
  // margin spread (rules/decide.cbMarginRatePercent).
  const prime = primeRate ?? 0;
  const marginCap = CB_MARGIN_COLLATERAL_FRACTION * Math.max(0, propBookMarkValue);
  const marginHeadroom = Math.max(0, marginCap - Math.max(0, cbMarginDebt));
  const enteredMargin = parseFloat(marginAmount);
  const validMarginDraw =
    Number.isFinite(enteredMargin) && enteredMargin > 0 && enteredMargin <= marginHeadroom;

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
        showToast(json.error ?? `Could not ${action} the credit line`, "error");
        return;
      }
      if (action === "draw") {
        const owed = Math.max(0, cbMarginDebt) + a;
        showToast(
          `Credit line drawn: now owes ${formatBankMoney(owed, currency)}, costing about ${formatBankMoney(perTurnInterestOn(owed, cbMarginRatePercent(prime)), currency)} next turn, with ${formatBankMoney(Math.max(0, marginHeadroom - a), currency)} of collateral room left.`,
          "success"
        );
      } else {
        showToast(
          `Credit line repaid ${formatBankMoney(a, currency)}: owes ${formatBankMoney(Math.max(0, Math.max(0, cbMarginDebt) - a), currency)}.`,
          "success"
        );
      }
      updateInterbankState({ marginAmount: "" });
      await onChanged();
    } finally {
      updateInterbankState({ busy: false });
    }
  };

  return (
    <section className="space-y-4">
      <Eyebrow kind="ceoControl" />
      <h3 className="text-base font-semibold text-foreground">
        Interbank &amp; central bank credit
      </h3>
      <div className="rounded-xl border border-card-border bg-card grid grid-cols-2 divide-x divide-card-border max-w-xl">
        <StatCell
          label="Interbank debt"
          value={formatBankMoney(interbankDebt, currency)}
          sub="borrowed outstanding"
          tooltip={t("tooltips.interbankDebt")}
        />
        <StatCell
          label="Central bank credit line"
          value={formatBankMoney(cbMarginDebt, currency)}
          sub={`secured on your investments · room ${formatBankMoney(marginHeadroom, currency)}`}
          tooltip={t("tooltips.marginDebt")}
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
          {validLend && lendIncomePerTurn != null && (
            <p className="text-[11px] text-muted">
              Lending {formatBankMoney(lendAmount, currency)} at {lendRate.toFixed(2)}% earns about{" "}
              {formatBankMoney(lendIncomePerTurn, currency)} each turn, has no fixed maturity
              (interest-only until the borrower repays), and moves{" "}
              {formatBankMoney(lendAmount, currency)} of cash out of reserves. Missed interest
              counts arrears turns and can default the loan after 8 turns (about 8 hours).
            </p>
          )}
          <Button type="button" onClick={() => void lend()} disabled={busy || !validLend}>
            {busy ? "Working..." : "Lend interbank"}
          </Button>
        </div>
      )}

      {canMutate && (
        <div className="rounded-xl border border-card-border bg-card p-4 space-y-3 max-w-xl">
          <p className="text-sm text-muted">
            Draw or repay the central bank credit line. It lends against your own investments as
            collateral: up to half their current value ({formatBankMoney(marginCap, currency)} on
            investments worth {formatBankMoney(Math.max(0, propBookMarkValue), currency)}), priced
            above prime. Arrears here draw supervisory attention.
          </p>
          <label className="block space-y-1 text-xs text-muted max-w-xs">
            Amount
            <Input
              value={marginAmount}
              onChange={(e) => updateInterbankState({ marginAmount: e.target.value })}
              inputMode="decimal"
              aria-label="Central bank credit line amount"
            />
          </label>
          {Number.isFinite(enteredMargin) && enteredMargin > 0 && (
            <p className="text-[11px] text-muted">
              {validMarginDraw
                ? `Drawing ${formatBankMoney(enteredMargin, currency)} leaves ${formatBankMoney(marginHeadroom - enteredMargin, currency)} of collateral room, and adds about ${formatBankMoney(perTurnInterestOn(Math.max(0, cbMarginDebt) + enteredMargin, cbMarginRatePercent(prime)), currency)} next turn. Interest accrues every turn (about every hour) until repaid.`
                : `That draw exceeds the ${formatBankMoney(marginHeadroom, currency)} of collateral room left.`}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => void margin("draw")}
              disabled={busy || !validMarginDraw}
              title={validMarginDraw ? undefined : "Enter an amount within the collateral room"}
            >
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

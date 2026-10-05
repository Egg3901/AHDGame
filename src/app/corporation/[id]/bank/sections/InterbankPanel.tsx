"use client";

import { useReducer } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatBankMoney, formatRatePercent } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { perTurnInterestOn } from "@/lib/banking/rules/loans";
import { CB_MARGIN_COLLATERAL_FRACTION, cbMarginRatePercent } from "@/lib/banking/rules/decide";
import type { ConsolePayload, Party, ShowToast } from "../types";
import { mergeState, partyHref } from "../lib/helpers";
import { PartySearch } from "../components/PartySearch";
import { StatCell } from "../components/StatCell";
import { SmallButton, TableScroll, Td, Th } from "@/components/corporation/dense/DenseKit";
import { BankPanel } from "../components/BankSection";
import { apiErrorText } from "@/lib/errors/catalog";

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
        showToast(apiErrorText(json, "Could not lend interbank"), "error");
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
        showToast(apiErrorText(json, `Could not ${action} the credit line`), "error");
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

  const inputClass =
    "h-8 w-full rounded-md border border-card-border bg-background px-2 font-mono text-[13px] text-foreground focus:border-foreground focus:outline-none";

  return (
    <BankPanel kind="ceoControl" title="Interbank and central bank credit">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 py-1.5 sm:max-w-xl">
        <StatCell
          label="Interbank debt"
          value={formatBankMoney(interbankDebt, currency)}
          sub="borrowed outstanding"
          tooltip={t("tooltips.interbankDebt")}
        />
        <StatCell
          label="Central bank credit line"
          value={formatBankMoney(cbMarginDebt, currency)}
          sub={`secured on your investments, room ${formatBankMoney(marginHeadroom, currency)}`}
          tooltip={t("tooltips.marginDebt")}
        />
      </div>

      <div className="grid gap-x-8 gap-y-5 pt-2 lg:grid-cols-2">
        {depositTaking && canMutate && (
          <div className="min-w-0 space-y-2">
            <h3 className="border-b border-card-border pb-1 text-xs font-medium text-foreground">
              Lend interbank
            </h3>
            <p className="text-xs text-muted">Lend non-reserved deposits to an investment bank.</p>
            <div className="space-y-1 text-xs text-muted">
              Borrowing bank
              {borrower ? (
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-foreground">{borrower.name}</span>
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
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex w-40 flex-col gap-1 text-xs text-muted">
                Amount
                <input
                  value={amount}
                  onChange={(e) => updateInterbankState({ amount: e.target.value })}
                  inputMode="decimal"
                  aria-label="Interbank lend amount"
                  className={inputClass}
                />
              </label>
              <label className="flex w-24 flex-col gap-1 text-xs text-muted">
                Rate %
                <input
                  value={rate}
                  onChange={(e) => updateInterbankState({ rate: e.target.value })}
                  inputMode="decimal"
                  aria-label="Interbank lend rate"
                  className={inputClass}
                />
              </label>
              <SmallButton tone="primary" onClick={() => void lend()} disabled={busy || !validLend}>
                {busy ? "Working..." : "Lend interbank"}
              </SmallButton>
            </div>
            {validLend && lendIncomePerTurn != null && (
              <p className="text-[11px] text-muted">
                Lending {formatBankMoney(lendAmount, currency)} at {lendRate.toFixed(2)}% earns
                about {formatBankMoney(lendIncomePerTurn, currency)} each turn, has no fixed
                maturity (interest-only until the borrower repays), and moves{" "}
                {formatBankMoney(lendAmount, currency)} of cash out of reserves. Missed interest
                counts arrears turns and can default the loan after 8 turns (about 8 hours).
              </p>
            )}
          </div>
        )}

        {canMutate && (
          <div className="min-w-0 space-y-2">
            <h3 className="border-b border-card-border pb-1 text-xs font-medium text-foreground">
              Central bank credit line
            </h3>
            <p className="text-xs text-muted">
              It lends against your own investments as collateral: up to half their current value (
              {formatBankMoney(marginCap, currency)} on investments worth{" "}
              {formatBankMoney(Math.max(0, propBookMarkValue), currency)}), priced above prime.
              Arrears here draw supervisory attention.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex w-40 flex-col gap-1 text-xs text-muted">
                Amount
                <input
                  value={marginAmount}
                  onChange={(e) => updateInterbankState({ marginAmount: e.target.value })}
                  inputMode="decimal"
                  aria-label="Central bank credit line amount"
                  className={inputClass}
                />
              </label>
              <SmallButton
                tone="primary"
                onClick={() => void margin("draw")}
                disabled={busy || !validMarginDraw}
                title={validMarginDraw ? undefined : "Enter an amount within the collateral room"}
              >
                Draw
              </SmallButton>
              <SmallButton onClick={() => void margin("repay")} disabled={busy}>
                Repay
              </SmallButton>
            </div>
            {Number.isFinite(enteredMargin) && enteredMargin > 0 && (
              <p className="text-[11px] text-muted">
                {validMarginDraw
                  ? `Drawing ${formatBankMoney(enteredMargin, currency)} leaves ${formatBankMoney(marginHeadroom - enteredMargin, currency)} of collateral room, and adds about ${formatBankMoney(perTurnInterestOn(Math.max(0, cbMarginDebt) + enteredMargin, cbMarginRatePercent(prime)), currency)} next turn. Interest accrues every turn (about every hour) until repaid.`
                  : `That draw exceeds the ${formatBankMoney(marginHeadroom, currency)} of collateral room left.`}
              </p>
            )}
          </div>
        )}
      </div>

      {loans.length > 0 && (
        <div className="pt-3">
          <TableScroll>
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr>
                  <Th>Role</Th>
                  <Th>Counterparty</Th>
                  <Th align="right">Outstanding</Th>
                  <Th align="right">Rate</Th>
                </tr>
              </thead>
              <tbody>
                {loans.map((loan) => (
                  <tr key={loan.id}>
                    <Td className="text-muted">{loan.role}</Td>
                    <Td>
                      {loan.counterparty ? (
                        <Link
                          href={partyHref("corporation", loan.counterparty)}
                          className="text-foreground hover:underline"
                        >
                          {loan.counterparty.name}
                        </Link>
                      ) : (
                        <span className="text-muted">Unknown bank</span>
                      )}
                    </Td>
                    <Td align="right">{formatBankMoney(loan.outstanding, currency)}</Td>
                    <Td align="right">{formatRatePercent(loan.ratePercent)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
    </BankPanel>
  );
}

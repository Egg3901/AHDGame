"use client";

import Link from "next/link";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ConsolePayload, OutlookPayload } from "../types";
import { BankPanel } from "../components/BankSection";
import { StatCell } from "../components/StatCell";

const BAND_TONE: Record<"green" | "amber" | "red", string> = {
  green: "text-success",
  amber: "text-warning",
  red: "text-error",
};

function flowText(outlook: OutlookPayload, currency: CurrencyCode): { value: string; sub: string } {
  if (outlook.depositFlow == null || outlook.depositDirection == null) {
    return { value: "n/a", sub: "this charter takes no household deposits" };
  }
  const amount = formatBankMoney(Math.abs(outlook.depositFlow), currency);
  if (outlook.depositDirection === "flat") {
    return { value: "About flat", sub: "inflows roughly match outflows at these rates" };
  }
  return {
    value: `${outlook.depositDirection === "in" ? "+" : "-"}${amount}`,
    sub:
      outlook.depositDirection === "in"
        ? "household cash flowing in at your deposit rate"
        : "households withdrawing more than they deposit",
  };
}

/**
 * Next turn if the CEO changes nothing. Every figure is projected server-side
 * from the rule module that enforces the mechanic (deposit shares, credit
 * bands, reserve arithmetic, insurance, confidence), so the strip cannot drift
 * from what the turn will actually do.
 */
export function OutlookStrip({ data }: { data: ConsolePayload }) {
  const outlook = data.outlook;
  const charter = data.charter;
  if (!outlook || !charter) return null;
  const currency = charter.currency;
  const flow = flowText(outlook, currency);
  const reserveShort = outlook.projectedCash < outlook.projectedRequired;

  return (
    <BankPanel
      kind="monitor"
      title="Next turn outlook"
      meta="if you change nothing"
      actions={
        <Link
          href="/wiki/private-banking"
          className="text-xs text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
        >
          How banking works
        </Link>
      }
    >
      <p className="py-1.5 text-xs text-muted">
        Household deposits are cash in the vault; player savings pointed at the bank are pointers,
        not cash, and only bind the deposit ceiling.
      </p>
      <p className="pb-2 text-xs text-foreground">
        <span className="font-medium">Recommended action</span>: {outlook.recommendation}
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCell label="Deposit flow" value={flow.value} sub={flow.sub} />
        <StatCell
          label="New loan demand"
          value={formatBankMoney(outlook.newLoanDemand, currency)}
          sub={`run-off ${formatBankMoney(outlook.loanRunoff, currency)}, capped at 2.5% of book per turn`}
        />
        <StatCell
          label="Expected defaults"
          value={formatBankMoney(outlook.expectedDefaults, currency)}
          sub="household book write-offs, from band default rates"
        />
        <StatCell
          label="Reserves after the turn"
          value={formatBankMoney(outlook.projectedCash, currency)}
          sub={`required ${formatBankMoney(outlook.projectedRequired, currency)}`}
          tone={reserveShort ? "text-error" : "text-success"}
        />
        <StatCell
          label="Confidence band"
          value={outlook.projectedBand}
          sub={outlook.bandReason ?? "holds where it is"}
          tone={BAND_TONE[outlook.projectedBand]}
        />
        <StatCell
          label="Bottom line"
          value={formatBankMoney(outlook.projectedBottomLine, currency)}
          sub={`earned ${formatBankMoney(outlook.projectedEarnedPerTurn, currency)}, paid ${formatBankMoney(outlook.projectedPaidPerTurn, currency)}`}
          tone={outlook.projectedBottomLine < 0 ? "text-error" : "text-success"}
        />
        <StatCell
          label="Net interest margin"
          value={
            outlook.netInterestMarginPercent == null
              ? "n/a"
              : `${outlook.netInterestMarginPercent.toFixed(2)}%`
          }
          sub="annualised net interest over the loan book"
        />
        <StatCell
          label="Cost of funds"
          value={
            outlook.costOfFundsPercent == null ? "n/a" : `${outlook.costOfFundsPercent.toFixed(2)}%`
          }
          sub="annualised interest paid over deposits"
        />
      </div>
    </BankPanel>
  );
}

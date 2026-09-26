"use client";

import Link from "next/link";
import { formatBankMoney } from "@/components/banking/formatBankMoney";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { ConsolePayload, OutlookPayload } from "../types";
import { Eyebrow } from "../components/BankSection";

const BAND_TONE: Record<"green" | "amber" | "red", string> = {
  green: "text-emerald-500",
  amber: "text-amber-500",
  red: "text-rose-500",
};

function OutlookCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <div className={`mt-1 text-sm font-semibold tabular-nums ${tone ?? "text-foreground"}`}>
        {value}
      </div>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

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
    <section className="overflow-hidden rounded-xl border border-card-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-card-border px-4 py-2">
        <div className="flex items-center gap-2">
          <Eyebrow kind="monitor" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Next turn outlook
          </span>
        </div>
        <Link
          href="/wiki/private-banking"
          className="text-xs text-accent underline underline-offset-2"
        >
          How banking works
        </Link>
      </div>
      <p className="border-b border-card-border px-4 py-2 text-xs text-muted">
        If you change nothing. Household deposits are cash in the vault; player savings pointed at
        the bank are pointers, not cash, and only bind the deposit ceiling.
      </p>
      <div className="border-b border-card-border bg-accent/5 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Recommended action
        </p>
        <p className="mt-1 text-sm text-foreground">{outlook.recommendation}</p>
      </div>
      <div className="grid grid-cols-2 divide-card-border sm:grid-cols-3 sm:divide-x lg:grid-cols-4">
        <OutlookCell label="Deposit flow" value={flow.value} sub={flow.sub} />
        <OutlookCell
          label="New loan demand"
          value={formatBankMoney(outlook.newLoanDemand, currency)}
          sub={`run-off ${formatBankMoney(outlook.loanRunoff, currency)} · capped at 2.5% of book per turn`}
        />
        <OutlookCell
          label="Expected defaults"
          value={formatBankMoney(outlook.expectedDefaults, currency)}
          sub="household book write-offs, from band default rates"
        />
        <OutlookCell
          label="Reserves after the turn"
          value={formatBankMoney(outlook.projectedCash, currency)}
          sub={`required ${formatBankMoney(outlook.projectedRequired, currency)}`}
          tone={reserveShort ? "text-error" : "text-success"}
        />
        <OutlookCell
          label="Confidence band"
          value={outlook.projectedBand}
          sub={outlook.bandReason ?? "holds where it is"}
          tone={BAND_TONE[outlook.projectedBand]}
        />
        <OutlookCell
          label="Bottom line"
          value={formatBankMoney(outlook.projectedBottomLine, currency)}
          sub={`earned ${formatBankMoney(outlook.projectedEarnedPerTurn, currency)} · paid ${formatBankMoney(outlook.projectedPaidPerTurn, currency)}`}
          tone={outlook.projectedBottomLine < 0 ? "text-error" : "text-success"}
        />
        <OutlookCell
          label="Net interest margin"
          value={
            outlook.netInterestMarginPercent == null
              ? "n/a"
              : `${outlook.netInterestMarginPercent.toFixed(2)}%`
          }
          sub="annualised net interest over the loan book"
        />
        <OutlookCell
          label="Cost of funds"
          value={
            outlook.costOfFundsPercent == null ? "n/a" : `${outlook.costOfFundsPercent.toFixed(2)}%`
          }
          sub="annualised interest paid over deposits"
        />
      </div>
    </section>
  );
}

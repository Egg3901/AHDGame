"use client";

import type { DefenseFundingPosition } from "@/lib/publicFinance/queries/defenseFunding";
import { formatFundsCompact1dp } from "@/lib/utils/formatters";

export interface DefenseFundingNoteProps {
  sym: string;
  funding: DefenseFundingPosition;
}

/**
 * Defence funding reconciliation (ticket #1269). The surplus tile counts the
 * enacted defence line, but the standing force costs its upkeep: anything
 * beyond the line leaves the treasury as national debt without touching any
 * spending row. This memo puts both sides on the page so a falling treasury
 * under a surplus reconciles on screen. Read-only; the turn phase stays the
 * sole writer of the pot.
 */
export function DefenseFundingNote({ sym, funding }: DefenseFundingNoteProps) {
  const money = (n: number) => formatFundsCompact1dp(n, sym);
  const moneySigned = (n: number) =>
    `${n < 0 ? "-" : ""}${formatFundsCompact1dp(Math.abs(n), sym)}`;
  const overdrawn = (funding.potBalance ?? 0) < 0;

  return (
    <section
      aria-label="Defence funding"
      className="rounded-xl border border-card-border bg-card p-4"
    >
      <div className="text-sm font-semibold text-foreground">Defence funding</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Appropriated per turn
          </div>
          <div className="mt-0.5 font-mono text-body-sm font-semibold text-foreground">
            {money(funding.accrualPerTurn)}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            This turn&apos;s slice of the enacted line ({money(funding.lineAnnual)}/yr), the figure
            the surplus counts.
          </p>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Force upkeep per turn
          </div>
          <div className="mt-0.5 font-mono text-body-sm font-semibold text-foreground">
            {money(funding.upkeepPerTurn)}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            What {funding.unitCount} standing units cost, whether the line covers it or not.
          </p>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Beyond the line per turn
          </div>
          <div className="mt-0.5 font-mono text-body-sm font-semibold text-foreground">
            {money(funding.shortfallPerTurn)}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            Drawn from the treasury as debt. It never appears in spending, so the surplus reads high
            by this much.
          </p>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Appropriation balance
          </div>
          <div className="mt-0.5 font-mono text-body-sm font-semibold text-foreground">
            {funding.potBalance == null ? "—" : moneySigned(funding.potBalance)}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            {overdrawn
              ? "Overdrawn: past shortfalls already borrowed against the treasury."
              : "The pot still covers the force; no overdraft drawn."}
          </p>
        </div>
      </div>
    </section>
  );
}

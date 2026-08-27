import { TAX_RATE_PHASE_IN_MAX_STEP_PP } from "@/lib/budget/taxRatePhaseIn";
import { deriveFiscalLegibility } from "@/lib/budget/fiscalLegibility";
import { formatFundsCompact1dp } from "@/lib/utils/formatters";

interface FiscalMechanicsNoteProps {
  sym: string;
  debtPrincipal: number;
  rawGdp: number;
  smoothedGdp?: number | null;
  revenue: number;
  spending: number;
  debtInterest: number;
}

function balanceLabel(value: number): string {
  return value >= 0 ? "surplus" : "deficit";
}

/**
 * Short explanation of the fiscal mechanics behind the headline budget cards.
 * It is deliberately informational: tax and spending policy flow through the
 * ordinary legislation system, including measures bundled in an annual Budget.
 */
export function FiscalMechanicsNote({
  sym,
  debtPrincipal,
  rawGdp,
  smoothedGdp,
  revenue,
  spending,
  debtInterest,
}: FiscalMechanicsNoteProps) {
  const figures = deriveFiscalLegibility({
    debtPrincipal,
    rawGdp,
    smoothedGdp,
    revenue,
    spending,
    debtInterest,
  });
  const money = (value: number) => formatFundsCompact1dp(Math.abs(value), sym);

  return (
    <section
      aria-label="How fiscal figures work"
      className="rounded-xl border border-card-border bg-card p-4"
    >
      <div className="text-sm font-semibold text-foreground">How these fiscal figures work</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Raw debt-to-GDP
          </div>
          <div className="mt-0.5 font-mono text-body-sm font-semibold text-foreground">
            {(figures.rawDebtToGdp * 100).toFixed(1)}%
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">Debt divided by fiscal GDP.</p>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Solvency debt-to-GDP (smoothed)
          </div>
          <div className="mt-0.5 font-mono text-body-sm font-semibold text-foreground">
            {(figures.solvencyDebtToGdp * 100).toFixed(1)}%
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            The credit rating uses smoothed GDP to avoid short-term GDP swings moving solvency.
          </p>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Primary balance
          </div>
          <div className="mt-0.5 font-mono text-body-sm font-semibold text-foreground">
            {money(figures.primaryBalance)} {balanceLabel(figures.primaryBalance)}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            Revenue less programme spending, before debt interest.
          </p>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
            Debt interest
          </div>
          <div className="mt-0.5 font-mono text-body-sm font-semibold text-foreground">
            {money(debtInterest)}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            This must be paid before the primary balance becomes the overall balance.
          </p>
        </div>
      </div>
      <p className="mt-3 border-t border-card-border pt-3 text-body-xs leading-relaxed text-muted">
        Tax and spending settings change through enacted laws. Tax-rate changes move by at most{" "}
        {TAX_RATE_PHASE_IN_MAX_STEP_PP} percentage point
        {TAX_RATE_PHASE_IN_MAX_STEP_PP === 1 ? "" : "s"} per turn, so larger changes phase in rather
        than arriving at once.
      </p>
    </section>
  );
}

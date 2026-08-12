"use client";

/**
 * A8: what the union's pension scheme is worth and what it owes.
 *
 * Renders nothing at all when there is no scheme. A union that has never
 * bargained a pension has not got an empty fund, it has not got a fund, and a
 * panel full of zeroes would suggest otherwise.
 */

export interface UnionPensionScheme {
  /** Cash only. `totalAssetsAnchor` is the number the funding ratio is built on. */
  assetsAnchor: number;
  investedValueAnchor: number;
  totalAssetsAnchor: number;
  liabilitiesAnchor: number;
  benefitsInPaymentAnchor: number;
  totalContributionsAnchor: number;
  totalTopUpsAnchor: number;
  totalInvestedAnchor: number;
  totalBenefitsPaidAnchor: number;
  totalBenefitsUnpaidAnchor: number;
  /** Fraction of this turn's benefit bill the scheme could not pay, 0 when it paid in full. */
  lastBenefitCutFraction: number;
  fundingRatio: number;
  band: "surplus" | "funded" | "deficit" | "critical";
  explanation: string;
}

/**
 * Semantic tokens only, and the same chip shape the bargaining panel uses for
 * campaign status, so the two panels on this tab read as one surface across
 * all eleven themes.
 */
const BAND_STYLE: Record<UnionPensionScheme["band"], string> = {
  surplus: "bg-success/15 text-success",
  funded: "bg-success/15 text-success",
  deficit: "bg-warning/15 text-warning",
  critical: "bg-error/15 text-error",
};

const BAND_LABEL: Record<UnionPensionScheme["band"], string> = {
  surplus: "In surplus",
  funded: "Funded",
  deficit: "In deficit",
  critical: "Critically underfunded",
};

function anchor(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `₳${Math.round(safe).toLocaleString("en-US")}`;
}

function percent(value: number): string {
  return `${(Number.isFinite(value) ? value * 100 : 0).toFixed(0)}%`;
}

/** One figure. `caption` carries the supporting detail so the grid stays four wide. */
function Figure({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "error";
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`font-mono font-semibold ${tone === "error" ? "text-error" : "text-foreground"}`}>
        {value}
      </p>
      {caption && <p className="mt-0.5 text-body-sm text-muted">{caption}</p>}
    </div>
  );
}

export function UnionPensionSchemePanel({ scheme }: { scheme: UnionPensionScheme | null }) {
  if (!scheme) return null;

  // The pension code calls a benefit cut "the visible face of underfunding",
  // so it gets a banner rather than a cell in the grid: a pensioner who was
  // paid 70% of what they were promised should not have to read a table to
  // find that out.
  const cutFraction = Number.isFinite(scheme.lastBenefitCutFraction)
    ? Math.max(0, Math.min(1, scheme.lastBenefitCutFraction))
    : 0;
  const cutPercent = cutFraction * 100;
  const benefitCut = cutPercent >= 0.5;
  const inArrears = scheme.totalBenefitsUnpaidAnchor > 0;
  const neverPaid = scheme.totalBenefitsPaidAnchor <= 0 && !inArrears;

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-heading-sm font-semibold text-foreground">Pension scheme</h3>
        <span
          className={`rounded-full px-2.5 py-1 text-body-sm font-semibold ${BAND_STYLE[scheme.band]}`}
        >
          {BAND_LABEL[scheme.band]} · {percent(scheme.fundingRatio)} funded
        </span>
      </div>

      <p className="text-body text-muted">{scheme.explanation}</p>

      {benefitCut && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-body font-medium text-error"
        >
          <span aria-hidden>⚠</span>
          <span>
            Benefits were cut {cutPercent.toFixed(0)}% last turn. The scheme did not have the cash
            to pay what it owed, so pensioners took the shortfall.
          </span>
        </p>
      )}

      {/* Position today: the four numbers a leader acts on. Cash and invested
          value ride along as a caption on total assets rather than as tiles of
          their own, because they are that number's components. */}
      <div className="grid grid-cols-2 gap-3 text-body sm:grid-cols-4">
        <Figure
          label="Total assets"
          value={anchor(scheme.totalAssetsAnchor)}
          caption={`${anchor(scheme.assetsAnchor)} cash · ${anchor(scheme.investedValueAnchor)} invested`}
        />
        <Figure label="Promised" value={anchor(scheme.liabilitiesAnchor)} />
        <Figure label="Benefits due / turn" value={anchor(scheme.benefitsInPaymentAnchor)} />
        <Figure
          label="Unpaid to date"
          value={inArrears ? `${anchor(scheme.totalBenefitsUnpaidAnchor)} in arrears` : anchor(0)}
          tone={inArrears ? "error" : undefined}
        />
      </div>

      <details className="rounded-lg bg-card-elevated px-3 py-2 text-body">
        <summary className="cursor-pointer font-medium text-foreground">
          Scheme history since it opened
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Contributions" value={anchor(scheme.totalContributionsAnchor)} />
          <Figure label="Deficit top-ups" value={anchor(scheme.totalTopUpsAnchor)} />
          <Figure label="Placed in funds" value={anchor(scheme.totalInvestedAnchor)} />
          <Figure label="Benefits paid" value={anchor(scheme.totalBenefitsPaidAnchor)} />
        </div>
        <p className="mt-2 text-body-sm text-muted">
          {neverPaid
            ? "This scheme has not paid a benefit yet. Contributions are still building the fund."
            : "Lifetime totals. Contributions are the agreed employer rate, top-ups are the extra charged while the scheme is short of what it promised."}
        </p>
      </details>
    </div>
  );
}

export default UnionPensionSchemePanel;

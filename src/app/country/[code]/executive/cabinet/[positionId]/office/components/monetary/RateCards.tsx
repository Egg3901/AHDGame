import { MonetaryCard, Stat, pct } from "./monetaryUi";
import type { MonetaryView } from "../../useCabinetOffice";

export function RateCards({ m }: { m: MonetaryView }) {
  // sovereignRate + confidencePremium are decimal fractions (0.05 = 5%); primeRate
  // is already a percentage-number (2.5 = 2.5%). Scale the decimals to points here.
  const sovereignPct = m.sovereignRate != null ? m.sovereignRate * 100 : null;
  const premiumPts = m.confidencePremium * 100;
  const base =
    m.sovereignRate != null ? Math.max(0, (m.sovereignRate - m.confidencePremium) * 100) : null;
  const belowBaseline = m.investorConfidence != null && m.investorConfidence < m.confidenceBaseline;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <MonetaryCard
        title="Central Bank Prime Rate"
        hint={
          m.chairName
            ? `Set by the Central Bank (Chair: ${m.chairName})`
            : "Set by the Central Bank"
        }
      >
        <div className="text-2xl font-bold tabular-nums text-foreground">{pct(m.primeRate)}</div>
        <p className="mt-1 text-[12px] text-muted">
          Read-only — this seat cannot set the prime rate.
        </p>
      </MonetaryCard>

      <MonetaryCard
        title="Sovereign Borrowing Rate"
        hint="Debt-to-GDP base + investor-confidence premium"
      >
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Base" value={pct(base)} />
          <Stat
            label="Confidence premium"
            value={pct(premiumPts)}
            tone={premiumPts > 0 ? "warn" : "good"}
          />
          <Stat label="Effective" value={pct(sovereignPct)} />
        </div>
        <p className="mt-2 text-[12px] text-muted">
          {belowBaseline
            ? `Confidence ${m.investorConfidence?.toFixed(0)} / ${m.confidenceBaseline} — a Debt Management Operation can lower the premium.`
            : "Premium already 0 — an operation would not lower your rate."}
        </p>
      </MonetaryCard>
    </div>
  );
}

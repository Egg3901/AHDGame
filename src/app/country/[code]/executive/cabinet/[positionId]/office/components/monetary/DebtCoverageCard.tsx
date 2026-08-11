import { MonetaryCard, Stat } from "./monetaryUi";

export function DebtCoverageCard({
  debtPrincipal,
  sovereignBondsOutstanding,
  sym,
}: {
  debtPrincipal: number;
  sovereignBondsOutstanding: number;
  sym: string;
}) {
  const money = (n: number) => `${sym}${Math.round(n).toLocaleString()}`;
  const gap = Math.max(0, debtPrincipal - sovereignBondsOutstanding);
  return (
    <MonetaryCard
      title="Debt Coverage"
      hint="National debt principal vs sovereign bonds outstanding"
    >
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Debt principal" value={money(debtPrincipal)} />
        <Stat label="Covered by bonds" value={money(sovereignBondsOutstanding)} />
        <Stat label="Uncovered gap" value={money(gap)} tone={gap > 0 ? "warn" : "good"} />
      </div>
    </MonetaryCard>
  );
}

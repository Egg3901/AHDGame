import type { MonetaryView } from "../useCabinetOffice";

export function CabinetMonetaryStrip({ m }: { m: MonetaryView }) {
  const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(2)}%`);
  const items = [
    { label: "Prime rate", value: pct(m.primeRate) },
    // sovereignRate is a decimal fraction (0.05 = 5%); primeRate is already a %.
    { label: "Sovereign rate", value: m.sovereignRate == null ? "—" : pct(m.sovereignRate * 100) },
    {
      label: "Confidence",
      value:
        m.investorConfidence == null
          ? "—"
          : `${m.investorConfidence.toFixed(0)} / ${m.confidenceBaseline}`,
    },
    { label: "Debt op", value: m.debtOp.active ? `Active → ${m.debtOp.expiresTurn}` : "Idle" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-lg border border-card-border bg-card-elevated px-3 py-2"
        >
          <div className="text-[11px] text-muted">{it.label}</div>
          <div className="font-semibold tabular-nums text-foreground">{it.value}</div>
        </div>
      ))}
    </div>
  );
}

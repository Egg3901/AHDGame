import type { MonetaryView } from "../useCabinetOffice";
import { Tile } from "./dossier";

export function CabinetMonetaryStrip({ m }: { m: MonetaryView }) {
  const pct = (n: number | null) => (n == null ? "N/A" : `${n.toFixed(2)}%`);
  const items = [
    { label: "Prime rate", value: pct(m.primeRate), tone: "gov" as const, sub: "policy rate" },
    // sovereignRate is a decimal fraction (0.05 = 5%); primeRate is already a %.
    {
      label: "Sovereign rate",
      value: m.sovereignRate == null ? "N/A" : pct(m.sovereignRate * 100),
      sub: "government borrowing",
    },
    {
      label: "Confidence",
      value:
        m.investorConfidence == null
          ? "N/A"
          : `${m.investorConfidence.toFixed(0)} / ${m.confidenceBaseline}`,
      tone:
        m.investorConfidence == null
          ? ("muted" as const)
          : m.investorConfidence >= m.confidenceBaseline
            ? ("up" as const)
            : ("down" as const),
      sub: m.investorConfidence == null ? "not reported" : "current / baseline",
    },
    {
      label: "Debt operation",
      value: m.debtOp.active ? "Active" : "Idle",
      tone: m.debtOp.active ? ("warning" as const) : ("muted" as const),
      sub:
        m.debtOp.active && m.debtOp.expiresTurn != null
          ? `through turn ${m.debtOp.expiresTurn}`
          : "no intervention",
    },
  ];
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-card-border bg-card-muted/60 sm:grid-cols-4 sm:divide-y-0">
      {items.map((it) => (
        <Tile key={it.label} label={it.label} value={it.value} tone={it.tone} sub={it.sub} />
      ))}
    </div>
  );
}

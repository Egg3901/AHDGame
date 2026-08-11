"use client";

/**
 * Visual diagram of cheapest-first clearing.
 * Demand fills the lowest-posture sellers first; premium sellers can be left
 * holding unsold stock in a glut. User-facing: no code references.
 */

interface Seller {
  name: string;
  posture: "Undercut" | "At-market" | "Premium";
  price: number;
  units: number;
  color: string;
}

// Buyers only want 220 units this turn. Cheapest sellers fill first.
const DEMAND = 220;

const SELLERS: Seller[] = [
  { name: "You (undercut)", posture: "Undercut", price: 92, units: 100, color: "bg-primary/60" },
  { name: "Rival A", posture: "At-market", price: 100, units: 100, color: "bg-cyan-500/50" },
  { name: "Rival B", posture: "Premium", price: 115, units: 100, color: "bg-amber-500/50" },
];

// Fill cheapest first. SELLERS/DEMAND are static, so compute once at module
// scope — no mutable bindings inside render (react-hooks/immutability).
const FILLED = SELLERS.reduce<{ rows: (Seller & { sold: number; pct: number })[]; left: number }>(
  (acc, s) => {
    const sold = Math.max(0, Math.min(s.units, acc.left));
    acc.rows.push({ ...s, sold, pct: Math.round((sold / s.units) * 100) });
    acc.left -= sold;
    return acc;
  },
  { rows: [], left: DEMAND }
).rows;

export function ClearingPostureDiagram() {
  const filled = FILLED;

  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-card-border bg-card/40 p-4">
      <h4 className="mb-1 text-sm font-semibold text-foreground">Cheapest sellers clear first</h4>
      <p className="mb-4 text-xs text-muted">
        Buyers want {DEMAND} units this turn, but three sellers each offer 100. Demand fills the
        lowest-posture sellers first, so the premium seller is left holding unsold stock.
      </p>

      <div className="space-y-3">
        {filled.map((s) => (
          <div key={s.name} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-xs font-medium text-foreground">{s.name}</span>
            <span className="w-16 shrink-0 text-xs text-muted">₳{s.price}</span>
            <div className="relative h-6 flex-1 min-w-[160px] max-w-[280px] overflow-hidden rounded bg-card-border">
              <div className={`h-full ${s.color}`} style={{ width: `${s.pct}%` }} aria-hidden />
              {s.pct < 100 && (
                <div
                  className="absolute inset-y-0 flex items-center pl-1 text-[10px] font-medium text-muted"
                  style={{ left: `${s.pct}%` }}
                >
                  unsold
                </div>
              )}
            </div>
            <span
              className={`w-24 shrink-0 text-right text-xs font-semibold ${
                s.pct === 100 ? "text-success" : s.pct === 0 ? "text-error" : "text-amber-500"
              }`}
            >
              {s.pct}% sold
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted">
        <span className="font-semibold text-foreground">Your posture is the decision.</span>{" "}
        Undercutting sells you out first (thinner margin, fuller sales). Skimming for a premium
        earns more per unit but risks unsold output in a glut. In a genuine shortage everyone sells
        out and the premium pays off. Your{" "}
        <span className="font-semibold text-foreground">&ldquo;% sold last turn&rdquo;</span> badge
        on the sector page shows how much of your output actually cleared.
      </p>
    </div>
  );
}

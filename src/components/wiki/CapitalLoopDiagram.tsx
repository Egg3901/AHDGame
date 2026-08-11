"use client";

/**
 * Visual diagram of the capital loop: growth budget -> investment -> capacity,
 * eroded by depreciation, gating output; plus the per-unit economics breakdown.
 * User-facing: no code references.
 */

const LOOP_STEPS = [
  {
    label: "Growth budget",
    detail: "The slider you set — the share of earnings you plough back in.",
    color: "bg-primary/20 text-primary",
  },
  {
    label: "Investment",
    detail: "That budget is spent building new productive capacity.",
    color: "bg-cyan-500/20 text-cyan-500",
  },
  {
    label: "Capacity (builds)",
    detail: "A durable asset you own. It caps how much you can produce.",
    color: "bg-emerald-500/20 text-emerald-600",
  },
  {
    label: "Output (gated)",
    detail: "You can only sell what your capacity supports.",
    color: "bg-amber-500/20 text-amber-600",
  },
];

// Per-unit P&L breakdown (illustrative ₳ values).
const UNIT = [
  { label: "Price", value: 100, kind: "credit" as const },
  { label: "− Labour", value: 34, kind: "debit" as const },
  { label: "− Inputs", value: 28, kind: "debit" as const },
  { label: "− Capital charge", value: 14, kind: "debit" as const },
];
const UNIT_PROFIT = 100 - 34 - 28 - 14;

export function CapitalLoopDiagram() {
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-card-border bg-card/40 p-4">
      <h4 className="mb-1 text-sm font-semibold text-foreground">The capital loop</h4>
      <p className="mb-4 text-xs text-muted">
        Reinvested earnings become capacity you own. Keep investing and capacity grows; stop and
        depreciation slowly erodes it. Your output is gated by the capacity you can support.
      </p>

      <div className="mb-3 flex flex-wrap items-stretch gap-2">
        {LOOP_STEPS.map((s, i) => (
          <div key={s.label} className="flex items-stretch gap-2">
            <div className="flex w-40 flex-col rounded-lg border border-card-border bg-card/60 p-2">
              <span
                className={`mb-1 inline-block self-start rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.color}`}
              >
                {s.label}
              </span>
              <span className="text-[11px] leading-snug text-muted">{s.detail}</span>
            </div>
            {i < LOOP_STEPS.length - 1 && (
              <span className="flex items-center text-muted" aria-hidden>
                →
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="mb-4 text-[11px] text-muted">
        <span className="font-semibold text-error">Depreciation</span> pulls on the capacity box
        every turn — if investment stops, capacity (and therefore output) drifts down.
      </p>

      <div className="rounded-lg border border-card-border bg-card/60 p-3">
        <h5 className="mb-2 text-xs font-semibold text-foreground">Unit economics</h5>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {UNIT.map((u) => (
            <span
              key={u.label}
              className={u.kind === "credit" ? "font-semibold text-foreground" : "text-muted"}
            >
              {u.label} ₳{u.value}
            </span>
          ))}
          <span className="text-muted">=</span>
          <span className="rounded bg-success/15 px-2 py-0.5 font-semibold text-success">
            ₳{UNIT_PROFIT} unit profit
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          The sector page shows this breakdown so you can see the true economics of every unit — the
          capital charge is the cost of the capacity that unit was produced on.
        </p>
      </div>
    </div>
  );
}

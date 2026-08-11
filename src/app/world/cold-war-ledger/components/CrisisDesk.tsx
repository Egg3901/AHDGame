import { PER_NATION_TURN_CAP } from "@/lib/constants/alignmentEras";
import type { LedgerCrisis } from "@/lib/alignment/queries/worldAlignment";

/**
 * Open flashpoints.
 *
 * A crisis grants nobody ground of its own — it lifts the ceiling on how far its
 * target can move in a turn, so influence spent here goes further than it would
 * anywhere else, and a flashpoint nobody acts on changes nothing.
 */
export function CrisisDesk({ crises }: { crises: LedgerCrisis[] }) {
  if (crises.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-body font-semibold text-foreground">Flashpoints</h2>
        <p className="max-w-prose text-body-sm text-muted">
          Nations in play. While a flashpoint runs, its country can move further in a turn than any
          other — influence spent here goes furthest, and a crisis nobody acts on changes nothing.
        </p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {crises.map((c) => (
          <li key={c.id} className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-body-sm font-semibold text-foreground">
                {c.targetName} &middot; {c.title}
              </h3>
              <span
                className={`font-mono text-body-xs tabular-nums ${
                  c.turnsRemaining <= 3 ? "text-warning" : "text-muted"
                }`}
              >
                {c.turnsRemaining === 0 ? "settling" : `${c.turnsRemaining} turns left`}
              </span>
            </div>
            <p className="mt-1 text-body-sm text-muted">{c.headline}</p>
            <p className="mt-3 font-mono text-body-xs tabular-nums text-foreground">
              moves up to {c.movementCap} a turn
              <span className="text-muted"> · normally {PER_NATION_TURN_CAP}</span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

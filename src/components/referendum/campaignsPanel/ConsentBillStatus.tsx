import Link from "next/link";
import type { ConsentBillView, ConsentOutcome } from "@/lib/referendum/consentBillView";
import type { ReferendumKind } from "@/lib/db/types/referendum";

const OUTCOME_META: Record<ConsentOutcome, { label: string; cls: string }> = {
  passed: { label: "Passed", cls: "bg-success/15 text-success" },
  failed: { label: "Failed", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
  pending: { label: "Before the house", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
};

/**
 * The consent-bill panel shown while a passed referendum is in its conversion
 * window (status "actuating"). Lists each bill Parliament must consent to, its
 * standing, and the window deadline — so a voter understands the result is not
 * yet final and can follow through to the actual vote.
 */
export function ConsentBillStatus({
  kind,
  bills,
  deadlineTurn,
  currentTurn,
}: {
  kind: ReferendumKind;
  bills: ConsentBillView[];
  deadlineTurn: number | null;
  currentTurn: number;
}) {
  if (bills.length === 0) return null;
  const turnsLeft = deadlineTurn != null ? deadlineTurn - currentTurn : null;
  const explainer =
    kind === "reunification"
      ? "Both consent bills must pass within the window for the union to take effect. If either fails or the window closes, the conversion is cancelled."
      : "The Westminster consent bill must pass within the window for independence to take effect. If it fails or the window closes, the conversion is cancelled.";

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 shadow-card">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted">
        Consent in Parliament
      </h2>
      <p className="mb-4 text-xs text-muted">{explainer}</p>
      <ul className="space-y-2">
        {bills.map((b) => {
          const meta = OUTCOME_META[b.outcome];
          return (
            <li key={b.id}>
              <Link
                href={b.href}
                className="group flex items-center gap-3 rounded-lg border border-card-border bg-card-elevated/40 px-3 py-2.5 transition-colors hover:border-primary/50"
              >
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${meta.cls}`}
                >
                  {meta.label}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                    {b.title}
                  </p>
                  <p className="text-xs text-muted">
                    {b.countryName} · {b.votesFor}–{b.votesAgainst}
                  </p>
                </div>
                <span className="shrink-0 text-muted transition-colors group-hover:text-primary">
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {deadlineTurn != null && (
        <p className="mt-4 border-t border-card-border/40 pt-3 text-xs text-muted">
          {turnsLeft != null && turnsLeft > 0
            ? `Conversion window closes on turn ${deadlineTurn} (in ${turnsLeft} turns).`
            : `Conversion window closes on turn ${deadlineTurn}.`}
        </p>
      )}
    </div>
  );
}

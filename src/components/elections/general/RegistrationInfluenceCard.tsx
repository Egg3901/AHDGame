/**
 * Registration influence card — displays per-state Reg as partisan-lean
 * influence breakdown. Phase 5b D3 enforces honest framing: values are
 * labeled "lean" / "influence" / "strength," NEVER "% of votes" or
 * "votes locked." Reg is the slow partisan baseline per Phase 0.5 §4.2,
 * not a literal vote-share promise.
 *
 * When the state's `RegBreakdown.bootstrapped === false` (the Phase 1.5 /
 * Phase 2 prereq seed hasn't run yet for this state), the card shows an
 * honest "data populating" placeholder rather than fabricating zeros.
 *
 * Pure presentational; the parent passes the breakdown from the
 * `generalViewModel`'s `regBreakdownByState[selectedStateId]`.
 *
 * See plan §"Phase 5b — Tasks" 5b.2 and §"Phase 5b — D3".
 */

import { useTranslations } from "next-intl";
import { persuadableSlicePct } from "@/lib/elections/computePersuasionDriverDisplay";
import type { RegBreakdown } from "@/lib/elections/generalViewModel";

export function RegistrationInfluenceCard({
  stateId,
  stateName,
  breakdown,
}: {
  stateId: string;
  stateName: string;
  /** From `generalViewModel.regBreakdownByState[stateId]`. Undefined when state isn't tracked. */
  breakdown?: RegBreakdown;
}) {
  const t = useTranslations("elections");
  if (!breakdown) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
          {t("registration.title")}
        </h3>
        <p className="text-xs italic text-muted">
          {t("registration.noData", { state: stateName, stateId })}
        </p>
      </div>
    );
  }

  if (!breakdown.bootstrapped) {
    return (
      <div className="rounded-xl border border-dashed border-card-border bg-card p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted">
          {t("registration.title")}
        </h3>
        <p className="text-xs leading-snug">
          {t.rich("registration.populating", {
            b: (chunks) => <span className="font-semibold">{chunks}</span>,
            state: stateName,
          })}
        </p>
      </div>
    );
  }

  const totalParty = breakdown.partyShares.reduce((s, p) => s + p.leanPct, 0);
  const independent = breakdown.independent ?? 0;
  const unregistered = breakdown.unregistered ?? 0;

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {t("registration.title")}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-muted">{stateId}</span>
      </div>
      <p className="mb-3 text-xs text-muted leading-snug">
        {t("registration.intro", { state: stateName })}
      </p>

      {/* Stacked bar */}
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-background">
        <div className="absolute inset-0 flex">
          {breakdown.partyShares.map((p) => (
            <span
              key={p.partyId}
              className="h-full"
              style={{ width: `${p.leanPct}%`, backgroundColor: p.color }}
              title={t("registration.leanTitle", { party: p.partyAbbr, pct: p.leanPct.toFixed(1) })}
            />
          ))}
          {independent > 0 ? (
            <span
              className="h-full"
              style={{ width: `${independent}%`, backgroundColor: "var(--card-border)" }}
              title={t("registration.independentTitle", { pct: independent.toFixed(1) })}
            />
          ) : null}
          {unregistered > 0 ? (
            <span
              className="h-full"
              style={{
                width: `${unregistered}%`,
                background:
                  "repeating-linear-gradient(135deg, var(--card-border) 0 4px, transparent 4px 8px)",
              }}
              title={t("registration.unregisteredTitle", { pct: unregistered.toFixed(1) })}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1.5 text-xs">
        {breakdown.partyShares.map((p) => (
          <div key={p.partyId} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: p.color }}
            />
            <span className="font-semibold" style={{ color: p.color }}>
              {p.partyAbbr}
            </span>
            <span className="ml-auto tabular-nums font-bold">
              {t("registration.leanValue", { pct: p.leanPct.toFixed(1) })}
            </span>
            {/* Ticket #1131 — the lean is not a vote-share floor. Show how much
                of that party's vote persuasion can still move in one cycle, the
                same fraction the engine peels (`effectivePeelableFraction`). */}
            <span
              className="shrink-0 tabular-nums text-[10px] text-muted"
              title={t("registration.movableTitle", { party: p.partyAbbr })}
            >
              {t("registration.movableValue", {
                pct: persuadableSlicePct(p.leanPct).toFixed(1),
              })}
            </span>
          </div>
        ))}
        {independent > 0 ? (
          <div className="flex items-center gap-2 text-muted">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: "var(--card-border)" }}
            />
            <span>{t("registration.independent")}</span>
            <span className="ml-auto tabular-nums">{independent.toFixed(1)}%</span>
          </div>
        ) : null}
        {unregistered > 0 ? (
          <div className="flex items-center gap-2 text-muted">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{
                background:
                  "repeating-linear-gradient(135deg, var(--card-border) 0 3px, transparent 3px 6px)",
              }}
            />
            <span>{t("registration.unregistered")}</span>
            <span className="ml-auto tabular-nums">{unregistered.toFixed(1)}%</span>
          </div>
        ) : null}
      </div>

      <p className="mt-2 text-[10px] leading-snug text-muted">{t("registration.movableNote")}</p>

      {/* Sanity hint when shares don't sum to ~100, the underlying data needs renormalization. */}
      {totalParty + independent + unregistered < 95 ||
      totalParty + independent + unregistered > 105 ? (
        <p className="mt-2 text-[10px] italic text-muted opacity-70">
          {t("registration.normalizationNote", {
            pct: (totalParty + independent + unregistered).toFixed(1),
          })}
        </p>
      ) : null}
    </div>
  );
}

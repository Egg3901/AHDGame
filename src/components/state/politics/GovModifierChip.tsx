"use client";

import type { RegionalExecutive } from "@/lib/states/regionalExecutive";

/**
 * Compact chip showing the regional executive (governor / Ministerpräsident)
 * for the state. Returns `null` when no comparable office exists in this
 * country (UK / JP per Gate 0 audit) — render as placeholder so callers
 * still know to allocate the slot.
 *
 * Consumes the `RegionalExecutive` shape from `getRegionalExecutive()`
 * (Phase 1).
 *
 * See plan §"Phase 2 — Task 2.1".
 */
export function GovModifierChip({
  regionalExecutive,
  partyAbbreviationById,
  partyColorById,
}: {
  regionalExecutive: RegionalExecutive | null;
  /** Lookup of partyId → abbreviation for display enrichment. */
  partyAbbreviationById?: Map<string, string>;
  /** Lookup of partyId → color for chip tinting. */
  partyColorById?: Map<string, string>;
}) {
  if (!regionalExecutive) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-5 opacity-70">
        <h3 className="text-sm font-semibold text-muted">Regional executive</h3>
        <p className="mt-2 text-body-sm">No comparable executive office in this country.</p>
      </div>
    );
  }

  const abbr =
    partyAbbreviationById?.get(regionalExecutive.partyId) ??
    regionalExecutive.partyId.toUpperCase();
  const color = partyColorById?.get(regionalExecutive.partyId);
  const signLabel =
    regionalExecutive.sign === 3
      ? "Strong modifier"
      : regionalExecutive.sign === 2
        ? "Moderate modifier"
        : "Light modifier";

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h3 className="text-body text-muted">{regionalExecutive.label}</h3>
      <div className="mt-2 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 text-body font-semibold"
          style={{ color: color ?? undefined }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: color ?? "var(--muted)" }}
            aria-hidden
          />
          {abbr}
        </span>
        <span className="text-body-sm text-muted">{signLabel}</span>
      </div>
      <p className="mt-2 text-body-sm text-muted">
        Boosts {abbr} registration and down-ballot candidates in this state.
      </p>
    </div>
  );
}

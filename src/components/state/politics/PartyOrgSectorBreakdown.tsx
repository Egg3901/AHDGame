"use client";

import type { PartyOrgDisplay } from "../StatePageTabsTypes";

/**
 * Sectors-style stacked bar of all-party Org% in this state.
 *
 * Mirrors the corporation/sector "marketing strength" visual idiom:
 * a single horizontal bar segmented by party share, with hovers
 * surfacing per-party stake. The Unaffiliated remainder gets a muted
 * neutral segment so the total reads as 100%.
 *
 * Phase 2: read-only display. The "preview Contest" hover hint is
 * decorative until Phase 3 wires the live mechanic.
 *
 * See plan §"Phase 2 — Task 2.1".
 */
export function PartyOrgSectorBreakdown({ partyOrg }: { partyOrg: PartyOrgDisplay[] }) {
  const active = partyOrg
    .filter((po) => po.organization > 0)
    .sort((a, b) => b.organization - a.organization);
  const sumOrg = active.reduce((s, po) => s + po.organization, 0);
  const unaffiliatedPct = Math.max(0, 100 - sumOrg);

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Party Organization
        </h3>
        <span className="text-[10px] italic opacity-60">
          Hover slices for detail · Contest preview Phase 3
        </span>
      </div>

      <div className="flex h-8 w-full overflow-hidden rounded-md border border-card-border">
        {active.map((po) => (
          <div
            key={po.partyId}
            className="group relative h-full"
            style={{
              width: `${po.organization}%`,
              backgroundColor: po.partyColor,
            }}
            title={`${po.partyAbbreviation} ${po.organization.toFixed(1)}%`}
          >
            {po.organization >= 8 && (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow tabular-nums">
                {po.partyAbbreviation}
              </span>
            )}
          </div>
        ))}
        {unaffiliatedPct > 0 && (
          <div
            className="h-full bg-[var(--card-muted)]"
            style={{ width: `${unaffiliatedPct}%` }}
            title={`Unaffiliated ${unaffiliatedPct.toFixed(1)}%`}
          />
        )}
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-3 md:grid-cols-4">
        {active.map((po) => (
          <li key={po.partyId} className="flex items-center gap-2 truncate" title={po.partyName}>
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: po.partyColor }}
              aria-hidden
            />
            <span className="truncate font-medium">{po.partyAbbreviation}</span>
            <span className="text-muted tabular-nums">{po.organization.toFixed(1)}%</span>
          </li>
        ))}
        {unaffiliatedPct > 0 && (
          <li className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm bg-[var(--card-muted)]"
              aria-hidden
            />
            <span className="font-medium">Unaffiliated</span>
            <span className="text-muted tabular-nums">{unaffiliatedPct.toFixed(1)}%</span>
          </li>
        )}
      </ul>
    </div>
  );
}

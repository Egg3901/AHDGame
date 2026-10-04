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
 * Read-only: Build Org on the Overview tab and the party pages changes it.
 */
export function PartyOrgSectorBreakdown({ partyOrg }: { partyOrg: PartyOrgDisplay[] }) {
  const active = partyOrg
    .filter((po) => po.organization > 0)
    .sort((a, b) => b.organization - a.organization);
  const sumOrg = active.reduce((s, po) => s + po.organization, 0);
  const unaffiliatedPct = Math.max(0, 100 - sumOrg);

  return (
    <div>
      <h3 className="mb-3 text-body text-muted">Party organization</h3>

      <div className="flex h-6 w-full gap-px overflow-hidden rounded-md">
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
              <span className="absolute inset-0 flex items-center justify-center text-body-sm font-semibold text-white tabular-nums">
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

      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-body sm:grid-cols-3">
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

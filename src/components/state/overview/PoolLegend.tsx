"use client";

import { PartyLogo } from "@/components/PartyLogo";
import type { CountryId } from "@/lib/constants/countries";

/**
 * One row of an Overview pool legend (Org Pool / Registration Pool).
 *
 * Party rows carry `partyId` and render the party logo plus the full party
 * name, with the abbreviation as a muted tag so the row still maps to the
 * pie's slice labels. Non-party buckets (Unaffiliated / Independent /
 * Unregistered) have no logo and keep the plain colour dot.
 */
export interface PoolLegendRow {
  key: string;
  /** Full party name, or the bucket label for non-party rows. */
  label: string;
  /** Party abbreviation. Omitted for non-party buckets. */
  abbr?: string;
  /** sequentialId-string of the party; drives the logo lookup. */
  partyId?: string;
  color: string;
  /** Percentage share, 0..100. */
  value: number;
}

export function PoolLegend({ rows, countryId }: { rows: PoolLegendRow[]; countryId: CountryId }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-2 text-sm">
          {r.partyId ? (
            <PartyLogo
              partyId={r.partyId}
              partyColor={r.color}
              countryId={countryId}
              size="h-5 w-5"
              className="shrink-0"
            />
          ) : (
            <span
              className="mx-[5px] h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: r.color }}
              aria-hidden
            />
          )}
          <span className="flex-1 truncate" title={r.abbr ? `${r.label} (${r.abbr})` : r.label}>
            {r.label}
          </span>
          {r.abbr && (
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--muted)]">
              {r.abbr}
            </span>
          )}
          <span className="shrink-0 tabular-nums">{r.value.toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  );
}

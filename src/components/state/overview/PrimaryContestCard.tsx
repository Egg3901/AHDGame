"use client";

import Link from "next/link";
import type { OverviewViewModel } from "@/lib/states/overview/types";
import { raceLabel } from "./raceLabel";

/**
 * Contested Primaries card. Lists primary-phase races in this state where
 * a single party has 2+ active candidates. Shows up to 5 entries; if more
 * exist, the rest are summarized by count.
 *
 * One row per `(election × party)` pair — a single race can produce
 * multiple rows when multiple parties have contested primaries.
 */
export function ContestedPrimariesCard({ vm }: { vm: OverviewViewModel }) {
  const rows = vm.contestedPrimaries;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
          Contested Primaries
        </div>
        <div className="mt-2 text-sm opacity-70">
          No contested primaries in this state right now.
        </div>
        <div className="mt-1 text-[10px] italic opacity-60">
          A primary becomes &ldquo;contested&rdquo; when a party fields 2+ active candidates.
        </div>
      </div>
    );
  }

  const visible = rows.slice(0, 5);
  const overflow = rows.length - visible.length;

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
        Contested Primaries
      </div>
      <ul className="mt-2 space-y-1.5">
        {visible.map((row) => (
          <li key={`${row.electionId}-${row.partyId}`} className="flex items-center gap-2 text-sm">
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide shrink-0"
              style={{
                backgroundColor: `${row.partyColor}20`,
                color: row.partyColor,
                border: `1px solid ${row.partyColor}40`,
              }}
            >
              {row.partyAbbr}
            </span>
            <Link href={row.url} className="flex-1 truncate font-medium hover:underline">
              {raceLabel(row)}
            </Link>
            <span className="shrink-0 text-xs tabular-nums opacity-70">
              {row.candidateCount} candidates
            </span>
          </li>
        ))}
      </ul>
      {overflow > 0 && (
        <div className="mt-2 text-[11px] italic text-[var(--muted)]">
          + {overflow} more contested primar{overflow === 1 ? "y" : "ies"}
        </div>
      )}
    </div>
  );
}

/**
 * @deprecated Backwards-compat alias — prefer the new name.
 * The card was repurposed from "single primary winner" to "list of
 * contested primaries". Kept exported under the old name to avoid
 * breaking unrelated imports during the transition.
 */
export const PrimaryContestCard = ContestedPrimariesCard;

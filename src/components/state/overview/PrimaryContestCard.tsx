"use client";

import Link from "next/link";
import type { OverviewViewModel } from "@/lib/states/overview/types";
import { raceLabel } from "./raceLabel";

/**
 * Contested primaries. Lists primary-phase races in this state where
 * a single party has 2+ active candidates. Shows up to 5 entries; if more
 * exist, the rest are summarized by count.
 *
 * One row per `(election × party)` pair — a single race can produce
 * multiple rows when multiple parties have contested primaries.
 */
export function ContestedPrimariesCard({ vm }: { vm: OverviewViewModel }) {
  const rows = vm.contestedPrimaries;
  const visible = rows.slice(0, 5);
  const overflow = rows.length - visible.length;

  return (
    <section
      aria-labelledby="overview-primaries-title"
      className="rounded-xl border border-card-border bg-card p-5 sm:p-6"
    >
      <h2 id="overview-primaries-title" className="text-heading-sm font-semibold text-foreground">
        Contested primaries
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-body text-muted">
          None right now. A primary is contested once a party has two or more active candidates.
        </p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-card-border">
            {visible.map((row) => (
              <li
                key={`${row.electionId}-${row.partyId}`}
                className="flex items-center gap-2 py-2 text-body"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: row.partyColor }}
                  aria-hidden
                />
                <span className="shrink-0 text-body-sm text-muted">{row.partyAbbr}</span>
                <Link
                  href={row.url}
                  className="min-w-0 flex-1 truncate font-medium text-foreground hover:underline underline-offset-4"
                >
                  {raceLabel(row)}
                </Link>
                <span className="shrink-0 text-body-sm tabular-nums text-muted">
                  {row.candidateCount} running
                </span>
              </li>
            ))}
          </ul>
          {overflow > 0 && (
            <p className="mt-1 text-body-sm text-muted">
              {overflow} more contested primar{overflow === 1 ? "y" : "ies"}
            </p>
          )}
        </>
      )}
    </section>
  );
}

/**
 * @deprecated Backwards-compat alias — prefer the new name.
 * The card was repurposed from "single primary winner" to "list of
 * contested primaries". Kept exported under the old name to avoid
 * breaking unrelated imports during the transition.
 */
export const PrimaryContestCard = ContestedPrimariesCard;

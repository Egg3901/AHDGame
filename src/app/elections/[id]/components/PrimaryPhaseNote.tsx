"use client";

import React from "react";
import type { ElectionDetail } from "./ElectionDetailTypes";

interface PrimaryPhaseNoteProps {
  election: ElectionDetail;
  localInPrimary: boolean;
  advancingCount: number;
}

/**
 * The one place that explains primary scoring. The headline stays short; the
 * full formula sits behind a disclosure. The page used to print a second,
 * near-identical paragraph at the very bottom — that has been folded in here.
 */
export function PrimaryPhaseNote({
  election,
  localInPrimary,
  advancingCount,
}: PrimaryPhaseNoteProps) {
  if (!localInPrimary) return null;
  // US presidential is the only race using the staggered state-by-state
  // primary map; everyone else (parliamentary lower chambers, state-level
  // single-winner races) shares the standard primary-share formula.
  const isUSPresidential = election.countryId === "US" && election.electionType === "president";
  const plural = advancingCount === 1 ? "" : "s";

  return (
    <div className="mb-6 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2">
      <div className="flex items-start gap-2">
        <svg
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-xs text-muted/90">
          <span className="font-medium text-warning">Primary Phase.</span>{" "}
          {isUSPresidential
            ? "Shares show projected delegate share from the live state-by-state primary map. Top candidate per party advances."
            : `Only your own party's members vote. Top ${advancingCount} candidate${plural} per party advance${advancingCount === 1 ? "s" : ""} to the general.`}{" "}
          Updates hourly.
        </p>
      </div>

      <details className="group mt-1.5 pl-5">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-warning/80 hover:text-warning">
          <span className="group-open:hidden">How primary scoring works</span>
          <span className="hidden group-open:inline">Hide scoring detail</span>
        </summary>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted/80">
          {isUSPresidential
            ? "Primary share = candidate score ÷ total in that party. Pre-stagger projections use policy alignment (40) + party influence (30) + national influence (20) + favorability (10). Once the final 6 turns begin, awarded delegates stay locked while uncalled states keep projecting forward."
            : `Primary share = candidate score ÷ total in that party. Score = party alignment (40, split into state-lean 25 + party 15 where available) + favorability (35) + in-region influence (25). NPP opponents take a 25% score penalty against players.`}
        </p>
      </details>
    </div>
  );
}

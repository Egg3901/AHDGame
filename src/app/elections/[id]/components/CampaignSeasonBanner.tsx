"use client";

import React from "react";
import { useGameClock } from "@/contexts/useGameClock";
import { ELECTION_DAY_TURNS } from "@/lib/electionEngine/voteCalculations";
import type { ElectionDetail } from "./ElectionDetailTypes";

/**
 * Campaign season is the single most decision-relevant fact in a general
 * election — the closing turns carry a disproportionate share of the vote and
 * every campaign passive doubles — and nothing on the page said it was open.
 * Renders only while the window is actually live.
 */
export function CampaignSeasonBanner({
  election,
  localInPrimary,
  localIsEnded,
}: {
  election: ElectionDetail;
  localInPrimary: boolean;
  localIsEnded: boolean;
}) {
  const clock = useGameClock();
  if (localInPrimary || localIsEnded) return null;
  if (election.endTurn == null || !clock.currentTurn) return null;

  const turnsLeft = election.endTurn - clock.currentTurn;
  if (turnsLeft <= 0 || turnsLeft > ELECTION_DAY_TURNS) return null;

  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
      <span className="mt-0.5 h-2 w-2 shrink-0 animate-pulse rounded-full bg-warning" />
      <p className="text-xs text-muted">
        <span className="font-semibold text-warning">Campaign season is open.</span> {turnsLeft}{" "}
        turn
        {turnsLeft === 1 ? "" : "s"} left. Campaign passive effects are doubled, and the closing
        turns carry a large share of the total vote. This is the window to spend actions.
      </p>
    </div>
  );
}

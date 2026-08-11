"use client";

import React from "react";
import { ElectionPhaseStatusStrip } from "@/components/elections/ElectionPhaseStatusStrip";
import { buildElectionPhaseStatusSummary } from "@/lib/elections/electionPhaseStatus";
import { ElectionTimeline } from "./ElectionTimeline";
import type { ElectionDetail } from "./ElectionDetailTypes";

interface ElectionScheduleCardProps {
  election: ElectionDetail;
  localIsUpcoming: boolean;
  localInPrimary: boolean;
  localIsEnded: boolean;
}

/**
 * The schedule block. The shared `ElectionPhaseStatusStrip` answers the only
 * question most visits have — "how long until the next deadline?" — and the
 * full phase-by-phase timeline sits behind a disclosure for the rare visit
 * that wants absolute dates for every stage.
 */
export function ElectionScheduleCard({
  election,
  localIsUpcoming,
  localInPrimary,
  localIsEnded,
}: ElectionScheduleCardProps) {
  if (!election.endTime && !election.primaryEndTime) return null;
  const phaseStatus = buildElectionPhaseStatusSummary(election);

  return (
    <div className="mb-6">
      <ElectionPhaseStatusStrip phaseStatus={phaseStatus} />

      <details className="group mt-2">
        <summary className="cursor-pointer list-none text-[11px] font-medium text-muted hover:text-foreground">
          <span className="group-open:hidden">Show full schedule</span>
          <span className="hidden group-open:inline">Hide full schedule</span>
        </summary>
        <div className="mt-2">
          <ElectionTimeline
            election={election}
            localIsUpcoming={localIsUpcoming}
            localInPrimary={localInPrimary}
            localIsEnded={localIsEnded}
          />
        </div>
      </details>
    </div>
  );
}

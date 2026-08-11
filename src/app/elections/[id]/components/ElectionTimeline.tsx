"use client";

import React from "react";
import { getTimerUrgencyStyle } from "@/lib/utils/formatters";
import { useGameClock } from "@/contexts/useGameClock";
import type { ElectionDetail } from "./ElectionDetailTypes";

interface ElectionTimelineProps {
  election: ElectionDetail;
  localIsUpcoming: boolean;
  localInPrimary: boolean;
  localIsEnded: boolean;
}

export function ElectionTimeline({
  election,
  localIsUpcoming,
  localInPrimary,
  localIsEnded,
}: ElectionTimelineProps) {
  const clock = useGameClock();
  if (!election.endTime && !election.primaryEndTime) return null;

  // Countdown turn-first so the timer freezes on pause and tracks the game turn
  // counter rather than wall-clock — matching the engine's phase transitions
  // (`computeElectionPhase` is also turn-first). Falls back to the timestamp
  // countdown only for legacy rows that predate the turn fields.
  const electionTimer =
    election.endTurn != null
      ? clock.formatRemainingTurns(election.endTurn)
      : clock.formatRemaining(election.endTime ?? undefined);
  const primaryTimer =
    election.primaryEndTurn != null
      ? clock.formatRemainingTurns(election.primaryEndTurn)
      : clock.formatRemaining(election.primaryEndTime ?? undefined);
  const primaryOpensTimer =
    election.startTurn != null
      ? clock.formatRemainingTurns(election.startTurn)
      : clock.formatRemaining(election.startTime ?? undefined);

  const opensYear = clock.formatYear(election.startTime);
  const primaryEndYear = clock.formatYear(election.primaryEndTime);
  const closesYear = clock.formatYear(election.endTime);

  return (
    <div className="mb-6 rounded-lg border border-card-border bg-card px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:gap-x-8">
        {localIsUpcoming ? (
          <>
            {/* Only show "Primary opens" if startTime is genuinely in the future.
                With zero-gap timing, primaries open immediately — skip this line
                when the countdown has ended to avoid confusing display. */}
            {election.startTime && primaryOpensTimer.urgency !== "ended" && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
                  <span className="text-xs text-muted">
                    Primary opens
                    {opensYear ? <span className="text-muted/50"> · {opensYear}</span> : null}
                  </span>
                </div>
                <span className="text-sm font-semibold text-blue-400 tabular-nums">
                  {primaryOpensTimer.text}
                </span>
              </>
            )}
            {election.primaryEndTime && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-card-border shrink-0" />
                  <span className="text-xs text-muted">
                    Primary ends
                    {primaryEndYear ? (
                      <span className="text-muted/50"> · {primaryEndYear}</span>
                    ) : null}
                  </span>
                </div>
                <span className="text-sm font-semibold text-muted/60 tabular-nums">
                  {primaryTimer.text}
                </span>
              </>
            )}
            {election.endTime && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-card-border shrink-0" />
                  <span className="text-xs text-muted">
                    Closes
                    {closesYear ? <span className="text-muted/50"> · {closesYear}</span> : null}
                  </span>
                </div>
                <span
                  className={`text-sm font-semibold tabular-nums ${getTimerUrgencyStyle(electionTimer.urgency)}`}
                >
                  {electionTimer.text}
                </span>
              </>
            )}
          </>
        ) : (
          <>
            {election.primaryEndTime && (
              <>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${localInPrimary ? "bg-warning animate-pulse" : "bg-card-border"}`}
                  />
                  <span className={`text-xs ${localInPrimary ? "text-muted" : "text-muted/40"}`}>
                    {localInPrimary ? "Primary ends" : "Primary closed"}
                    {primaryEndYear ? (
                      <span className="text-muted/40"> · {primaryEndYear}</span>
                    ) : null}
                  </span>
                </div>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    localInPrimary
                      ? primaryTimer.urgency === "critical"
                        ? "text-error"
                        : "text-warning"
                      : "text-muted/30 line-through"
                  }`}
                >
                  {localInPrimary ? primaryTimer.text : "—"}
                </span>
              </>
            )}
            {election.endTime && (
              <>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${!localInPrimary && !localIsEnded ? "bg-success animate-pulse" : "bg-card-border"}`}
                  />
                  <span className="text-xs text-muted">
                    {localIsEnded ? "Closed" : "Closes"}
                    {closesYear ? <span className="text-muted/50"> · {closesYear}</span> : null}
                  </span>
                </div>
                <span
                  className={`text-sm font-semibold tabular-nums ${getTimerUrgencyStyle(electionTimer.urgency)}`}
                >
                  {electionTimer.text}
                </span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

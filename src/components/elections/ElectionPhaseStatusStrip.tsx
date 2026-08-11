"use client";

import { useGameClock } from "@/contexts/useGameClock";
import { getTimerUrgencyStyle } from "@/lib/utils/formatters";
import { LocalTime } from "@/components/time/LocalTime";
import type { ElectionPhaseStatusSummary } from "@/lib/elections/electionPhaseStatus";

interface ElectionPhaseStatusStripProps {
  phaseStatus: ElectionPhaseStatusSummary;
  className?: string;
}

export function ElectionPhaseStatusStrip({
  phaseStatus,
  className = "",
}: ElectionPhaseStatusStripProps) {
  const clock = useGameClock();
  if (!phaseStatus.endTime) return null;

  // Turn-first countdowns (freeze on pause, no wall-clock drift), matching the
  // turn-based engine; fall back to timestamps only for legacy rows.
  const electionTimer =
    phaseStatus.endTurn != null
      ? clock.formatRemainingTurns(phaseStatus.endTurn)
      : clock.formatRemaining(phaseStatus.endTime);
  const primaryTimer =
    phaseStatus.primaryEndTurn != null
      ? clock.formatRemainingTurns(phaseStatus.primaryEndTurn)
      : clock.formatRemaining(phaseStatus.primaryEndTime ?? undefined);
  const primaryOpensTimer =
    phaseStatus.startTurn != null
      ? clock.formatRemainingTurns(phaseStatus.startTurn)
      : clock.formatRemaining(phaseStatus.startTime ?? undefined);
  const primaryEnded = primaryTimer.urgency === "ended";
  // status="upcoming" with startTime already in the past is the one-turn gap
  // before advanceElectionTimers flips status to "active". Treat it as active
  // for display so we don't render "Opens in Ended".
  const isUpcoming = phaseStatus.status === "upcoming" && primaryOpensTimer.urgency !== "ended";

  // Absolute deadlines must render through <LocalTime>: this strip is
  // server-rendered on /country/[code]/elections, and formatting with the
  // host's locale/timezone (clock.formatAbsoluteDeadline → toLocaleString)
  // produced different SSR vs client text — React #418 (GlitchTip AHD-17C).
  // <LocalTime> emits a deterministic UTC string on SSR + first client render,
  // then swaps to the viewer's local time after mount. `toAbsoluteWallClock`
  // keeps the cron-drift shift the old string had.
  const absoluteDeadline = (value: string | null | undefined) => {
    const shifted = clock.toAbsoluteWallClock(value ?? null);
    return shifted ? <LocalTime value={shifted} /> : null;
  };

  return (
    <div
      className={`grid grid-cols-2 gap-4 rounded-lg border border-card-border/40 bg-card-muted/50 p-3 ${className}`.trim()}
    >
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
          Primary Election
        </div>
        {isUpcoming ? (
          <div className="text-sm font-medium text-blue-400">Opens in {primaryOpensTimer.text}</div>
        ) : (
          <div
            className={`text-sm font-medium ${
              primaryTimer.urgency === "paused"
                ? "text-purple-400"
                : primaryEnded
                  ? "text-muted"
                  : "text-blue-400"
            }`}
          >
            {primaryEnded ? "Completed" : `Ends in ${primaryTimer.text}`}
          </div>
        )}
        <div className="text-[10px] text-muted/60">
          {isUpcoming && phaseStatus.startTime
            ? absoluteDeadline(phaseStatus.startTime)
            : absoluteDeadline(phaseStatus.primaryEndTime)}
        </div>
      </div>

      <div className="space-y-1 border-l border-card-border/40 pl-4">
        <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
          General Election
        </div>
        <div className={`text-sm font-medium ${getTimerUrgencyStyle(electionTimer.urgency)}`}>
          Ends in {electionTimer.text}
        </div>
        <div className="text-[10px] text-muted/60">{absoluteDeadline(phaseStatus.endTime)}</div>
      </div>
    </div>
  );
}

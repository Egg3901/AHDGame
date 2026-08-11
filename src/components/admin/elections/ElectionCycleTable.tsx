"use client";

import Link from "next/link";
import { formatTimeRemainingSimple, realTimestampToLarpDate } from "@/lib/utils/formatters";
import {
  DEFAULT_CYCLE_ANCHOR_CONTEXT,
  type CycleAnchorContext,
} from "@/lib/elections/cycleAnchorContext";
import {
  canonicalEndTurn,
  isElectionInPrimaryPhase,
  type ElectionData,
} from "./electionsAdminTypes";

interface CycleGroup {
  cycle: number;
  elections: ElectionData[];
}

interface ElectionCycleTableProps {
  byCycle: CycleGroup[];
  currentTurn: number | null;
  lastTurnProcessed: string | null;
  /**
   * Calendar year of turn 1 from GameState. Null when the API response
   * omits it (legacy GameState rows): falls back to the 2019-default
   * preset year so legacy worlds render unchanged.
   */
  startingYear: number | null;
  /**
   * Reset-preset id from GameState (e.g. `"1991-default"`). Null when
   * the API response omits it: falls back to `"2019-default"`.
   */
  preset: string | null;
  loading: boolean;
  onDeleteCycle: (cycle: number) => void;
}

export function ElectionCycleTable({
  byCycle,
  currentTurn,
  lastTurnProcessed,
  startingYear,
  preset,
  loading,
  onDeleteCycle,
}: ElectionCycleTableProps) {
  const ctx: CycleAnchorContext = {
    startingYear: startingYear ?? DEFAULT_CYCLE_ANCHOR_CONTEXT.startingYear,
    preset: preset ?? DEFAULT_CYCLE_ANCHOR_CONTEXT.preset,
  };
  if (byCycle.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-card-border p-8 text-center text-muted">
        No elections found. Initialize positions above to create elections.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {byCycle.map(({ cycle, elections: cycleElections }) => (
        <div key={cycle} className="rounded-lg border border-card-border">
          <div className="flex items-center justify-between border-b border-card-border bg-background/50 px-4 py-2">
            <h4 className="font-semibold">Cycle {cycle}</h4>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted">
                {cycleElections.length} election{cycleElections.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => onDeleteCycle(cycle)}
                disabled={loading}
                className="rounded bg-red-500/20 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-500/30"
              >
                Delete Cycle
              </button>
            </div>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-card-border text-left text-xs text-muted">
                  {[
                    "State",
                    "Type",
                    "Details",
                    "Ends (LARP)",
                    "Ends (real)",
                    "Primary (LARP)",
                    "Candidates",
                    "Phase",
                    "",
                  ].map((h, i) => (
                    <th key={i} className="px-4 py-2">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {cycleElections.map((e) => {
                  const expectedEndTurn = canonicalEndTurn(e, undefined, ctx);
                  const larpEnd = realTimestampToLarpDate(
                    e.endTime,
                    currentTurn,
                    lastTurnProcessed,
                    ctx.startingYear
                  );
                  const larpPrimary = realTimestampToLarpDate(
                    e.primaryEndTime,
                    currentTurn,
                    lastTurnProcessed,
                    ctx.startingYear
                  );
                  const isOff =
                    expectedEndTurn !== null && currentTurn !== null && larpEnd
                      ? Math.abs(
                          expectedEndTurn -
                            (currentTurn +
                              Math.ceil(
                                (new Date(e.endTime!).getTime() - Date.now()) / (60 * 60 * 1000)
                              ))
                        ) > 5
                      : false;
                  return (
                    <tr
                      key={e._id}
                      className={`hover:bg-background/30 ${isOff ? "bg-red-500/5" : ""}`}
                    >
                      <td className="px-4 py-2 font-medium">{e.state}</td>
                      <td className="px-4 py-2 capitalize">{e.electionType}</td>
                      <td className="px-4 py-2 text-muted">
                        {e.electionType === "senate"
                          ? `Class ${e.senateClass}`
                          : `${e.totalSeats} seat${(e.totalSeats || 1) > 1 ? "s" : ""}`}
                      </td>
                      <td className="px-4 py-2">
                        {larpEnd ? (
                          <span className={isOff ? "text-red-400 font-medium" : "text-green-400"}>
                            {larpEnd}
                            {expectedEndTurn !== null && (
                              <span className="ml-1 text-xs text-muted">
                                (should be t{expectedEndTurn})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={
                            formatTimeRemainingSimple(e.endTime) === "Ended"
                              ? "text-red-400"
                              : "text-muted text-xs"
                          }
                        >
                          {formatTimeRemainingSimple(e.endTime)}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {larpPrimary ? (
                          <span className="text-xs text-blue-400">{larpPrimary}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className={e.candidateCount > 0 ? "text-green-400" : "text-muted"}>
                          {e.candidateCount}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        {(() => {
                          if (e.status !== "active") {
                            const style =
                              e.status === "upcoming"
                                ? "bg-blue-500/20 text-blue-400"
                                : e.status === "completed"
                                  ? "bg-gray-500/20 text-gray-400"
                                  : "bg-red-500/20 text-red-400";
                            const label =
                              e.status === "upcoming"
                                ? "Upcoming"
                                : e.status === "completed"
                                  ? "Completed"
                                  : e.status;
                            return (
                              <span className={`rounded-full px-2 py-0.5 text-xs ${style}`}>
                                {label}
                              </span>
                            );
                          }
                          // For active elections, show Primary or General phase.
                          // Turn-first (actual game phase) so the badge doesn't
                          // drift when the cron lags behind wall-clock. The
                          // larp-date / time-remaining columns above stay
                          // wall-clock on purpose — they're the calibration
                          // reference this table exists to surface.
                          const inPrimary = isElectionInPrimaryPhase(e, currentTurn);
                          return (
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs ${
                                inPrimary
                                  ? "bg-amber-500/20 text-amber-400"
                                  : "bg-green-500/20 text-green-400"
                              }`}
                            >
                              {inPrimary ? "Primary" : "General"}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2">
                        {e.electionType === "president" && (
                          <Link
                            href={`/elections/${e._id}`}
                            className="rounded px-2 py-1 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                          >
                            Manage →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

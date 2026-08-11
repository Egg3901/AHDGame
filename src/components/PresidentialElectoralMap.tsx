"use client";

import { USAMapPaths, type StateMapData } from "@/components/USAMapPaths";
import type { ElectoralMapState } from "@/app/elections/[id]/components/ElectionDetailTypes";

interface PresidentialElectoralMapProps {
  /** Per-state map data (stateId -> color, label, tooltip) */
  electoralMapData: Record<string, ElectoralMapState>;
  /** Electoral votes per candidate (for lead summary) */
  electoralVotesByCandidate?: Record<string, number>;
  /** Candidate names for EV display */
  candidateNames?: Record<string, string>;
  /** Candidate party sequentialIds (unused for colour, retained for future filters) */
  candidateParties?: Record<string, string>;
  /**
   * candidateId → party hex colour, resolved server-side from the country-scoped
   * party lookup. Needed because candidateParties stores sequentialId strings
   * the client cannot map to hex on its own.
   */
  candidateColors?: Record<string, string>;
  /** Optional: state IDs to highlight with purple border (e.g. 5 closest states) */
  highlightedStates?: string[];
  /** Optional: callback when a state is clicked */
  onStateClick?: (stateId: string) => void;
  /** candidateId → state code they are currently campaigning in */
  candidateTravelStates?: Record<string, string>;
}

/** Converts ElectoralMapState to StateMapData for USAMapPaths */
function toStateMapData(data: ElectoralMapState): StateMapData {
  return {
    color: data.color,
    label: data.label,
    tooltip: data.tooltip,
  };
}

/**
 * Presidential electoral map — same map used on /map (presidential mode) and
 * on the presidential election detail page. Renders US states shaded by
 * leading candidate (electoral votes).
 */
export function PresidentialElectoralMap({
  electoralMapData,
  electoralVotesByCandidate,
  candidateNames = {},
  candidateColors = {},
  highlightedStates,
  onStateClick,
  candidateTravelStates = {},
}: PresidentialElectoralMapProps) {
  const stateData: Record<string, StateMapData> = {};
  const legendEntries = new Map<string, string>();
  for (const [stateId, data] of Object.entries(electoralMapData)) {
    stateData[stateId] = toStateMapData(data);
    const candidateLine = data.tooltip?.[0];
    if (candidateLine) {
      const match = candidateLine.match(/^(.+?):/);
      const label = match ? match[1].trim() : candidateLine;
      legendEntries.set(label, data.color);
    }
  }

  const hasData = Object.keys(electoralMapData).length > 0;

  const evSorted = electoralVotesByCandidate
    ? Object.entries(electoralVotesByCandidate)
        .filter(([, ev]) => ev > 0)
        .sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="rounded-xl border border-card-border bg-card p-3 sm:p-6 overflow-hidden shadow-panel">
      {evSorted.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-4 px-2">
          <span className="text-xs text-muted uppercase tracking-wider">
            Electoral votes — who&apos;s leading:
          </span>
          {evSorted.map(([candidateId, ev], i) => {
            const name = candidateNames[candidateId] ?? "Unknown";
            const color = candidateColors[candidateId] ?? "#9CA3AF";
            const isLeader = i === 0;
            return (
              <div key={candidateId} className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-sm shrink-0"
                  style={{ backgroundColor: color, opacity: 0.9 }}
                />
                <span
                  className={`text-sm font-medium ${isLeader ? "text-foreground" : "text-muted"}`}
                >
                  {name}: <span className="tabular-nums">{ev} EV</span>
                  {isLeader && evSorted.length > 1 && (
                    <span className="ml-1 text-xs text-green-500 font-normal">(leading)</span>
                  )}
                  {candidateTravelStates[candidateId] && (
                    <span
                      className="ml-1 text-xs text-muted/70 tabular-nums"
                      title={`Currently campaigning in ${candidateTravelStates[candidateId]}`}
                    >
                      📍 {candidateTravelStates[candidateId]}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div
        className="w-full max-w-full rounded-lg bg-background p-2 sm:p-4 min-h-[280px] sm:min-h-[320px] overflow-hidden"
        style={{ aspectRatio: "960/600", boxShadow: "inset 0 2px 8px 0 rgb(0 0 0 / 0.4)" }}
      >
        <USAMapPaths
          stateData={stateData}
          highlightedStates={highlightedStates}
          onStateClick={onStateClick}
        />
      </div>
      {!hasData && (
        <div className="mt-4 px-2 text-sm text-muted">
          Votes will appear as they accumulate each turn. Hover over states to see results.
        </div>
      )}
      {legendEntries.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 px-2">
          <span className="text-xs text-muted uppercase tracking-wider">Legend:</span>
          {[...legendEntries.entries()].map(([label, color]) => (
            <div key={label} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: color, opacity: 0.85 }}
              />
              <span className="text-xs text-muted">{label}</span>
            </div>
          ))}
          {highlightedStates && highlightedStates.length > 0 && (
            <span className="flex items-center gap-1.5 text-purple-400">
              <span className="inline-block h-3 w-3 rounded-sm border-2 border-purple-400" />
              <span className="text-xs">5 closest states</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

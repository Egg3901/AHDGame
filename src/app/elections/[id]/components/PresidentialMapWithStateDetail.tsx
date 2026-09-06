"use client";

import { useState, useMemo } from "react";
import { PresidentialElectoralMap } from "@/components/PresidentialElectoralMap";
import { StateDetailModal } from "./StateDetailModal";
import type { ElectoralMapState, VoteTurnSnapshot } from "./ElectionDetailTypes";

interface PresidentialMapWithStateDetailProps {
  electionId: string;
  electoralMapData: Record<string, ElectoralMapState>;
  electoralVotesByCandidate?: Record<string, number>;
  candidateNames?: Record<string, string>;
  candidateParties?: Record<string, string>;
  /** candidateId → party hex colour, resolved server-side. */
  candidateColors?: Record<string, string>;
  stateVoteData?: Record<
    string,
    { votesByCandidate: Record<string, number>; evByCandidate: Record<string, number> }
  >;
  stateVotesOverTime?: Record<string, VoteTurnSnapshot[]>;
  /** candidateId → state code they are currently campaigning in */
  candidateTravelStates?: Record<string, string>;
  /**
   * Whether to print the "Electoral Map" heading. False where a tab above
   * already names this pane, so the section is not titled twice.
   */
  showHeading?: boolean;
}

/** Returns the 5 state IDs with the smallest margin between top 2 candidates (closest races) */
function getFiveClosestStates(
  stateVoteData: Record<string, { votesByCandidate: Record<string, number> }>
): string[] {
  const margins: { stateId: string; margin: number }[] = [];
  for (const [stateId, { votesByCandidate }] of Object.entries(stateVoteData)) {
    const votes = Object.values(votesByCandidate).filter((v) => v > 0);
    if (votes.length < 2) continue;
    const total = votes.reduce((s, v) => s + v, 0);
    if (total <= 0) continue;
    const sorted = [...votes].sort((a, b) => b - a);
    const topPct = (sorted[0] / total) * 100;
    const secondPct = (sorted[1] / total) * 100;
    const margin = topPct - secondPct;
    margins.push({ stateId, margin });
  }
  return margins
    .sort((a, b) => a.margin - b.margin)
    .slice(0, 5)
    .map((m) => m.stateId);
}

export function PresidentialMapWithStateDetail({
  electionId,
  electoralMapData,
  electoralVotesByCandidate,
  candidateNames = {},
  candidateParties = {},
  candidateColors = {},
  stateVoteData,
  stateVotesOverTime,
  candidateTravelStates = {},
  showHeading = true,
}: PresidentialMapWithStateDetailProps) {
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [filterCompetitive, setFilterCompetitive] = useState(false);
  const [viewMode, setViewMode] = useState<"ev" | "popular">("ev");

  const fiveClosestStates = useMemo(() => {
    if (!stateVoteData || Object.keys(stateVoteData).length === 0) return [];
    return getFiveClosestStates(stateVoteData);
  }, [stateVoteData]);

  // Compute popular vote margin-based map coloring
  const displayMapData = useMemo(() => {
    if (viewMode === "ev" || !stateVoteData) return electoralMapData;

    const popularVoteData: Record<string, ElectoralMapState> = {};

    for (const [stateId, data] of Object.entries(electoralMapData)) {
      const voteData = stateVoteData[stateId];
      if (!voteData) {
        popularVoteData[stateId] = data;
        continue;
      }

      const votes = Object.entries(voteData.votesByCandidate).filter(([, v]) => v > 0);
      if (votes.length < 2) {
        popularVoteData[stateId] = data;
        continue;
      }

      const total = votes.reduce((s, [, v]) => s + v, 0);
      if (total <= 0) {
        popularVoteData[stateId] = data;
        continue;
      }

      const sorted = votes.sort((a, b) => b[1] - a[1]);
      const [leaderId, leaderVotes] = sorted[0];
      const [, secondVotes] = sorted[1];
      const topPct = (leaderVotes / total) * 100;
      const secondPct = (secondVotes / total) * 100;
      const margin = topPct - secondPct;

      // Get leader's party color and create shaded versions.
      // candidateColors is resolved server-side via the countryId-scoped party
      // lookup; falling back to gray avoids the default-purple bug when a colour
      // is missing.
      const baseColor = candidateColors[leaderId] ?? "#9CA3AF";

      // Parse base color
      const r = parseInt(baseColor.slice(1, 3), 16);
      const g = parseInt(baseColor.slice(3, 5), 16);
      const b = parseInt(baseColor.slice(5, 7), 16);

      // Create 4 shades: solid (dark), shaded (medium), light, and white (swing)
      let color: string;
      if (margin >= 15) {
        // Solid/Dark - safe (darken the base color)
        const darkR = Math.floor(r * 0.7);
        const darkG = Math.floor(g * 0.7);
        const darkB = Math.floor(b * 0.7);
        color = `rgb(${darkR}, ${darkG}, ${darkB})`;
      } else if (margin >= 10) {
        // Medium shade - likely (use base color)
        color = baseColor;
      } else if (margin >= 5) {
        // Light shade - lean (lighten toward white)
        const lightR = Math.floor(r + (255 - r) * 0.5);
        const lightG = Math.floor(g + (255 - g) * 0.5);
        const lightB = Math.floor(b + (255 - b) * 0.5);
        color = `rgb(${lightR}, ${lightG}, ${lightB})`;
      } else {
        // White/very light - toss-up (mostly white with slight tint)
        const tintR = Math.floor(r + (255 - r) * 0.85);
        const tintG = Math.floor(g + (255 - g) * 0.85);
        const tintB = Math.floor(b + (255 - b) * 0.85);
        color = `rgb(${tintR}, ${tintG}, ${tintB})`;
      }

      const leaderName = candidateNames[leaderId] ?? "Unknown";
      popularVoteData[stateId] = {
        ...data,
        color,
        tooltip: [
          `${leaderName}: ${topPct.toFixed(1)}% (+${margin.toFixed(1)})`,
          ...(data.tooltip?.slice(1) ?? []),
        ],
      };
    }
    return popularVoteData;
  }, [viewMode, electoralMapData, stateVoteData, candidateNames, candidateColors]);

  const stateData = stateVoteData?.[selectedStateId ?? ""];
  const stateSnapshots = selectedStateId ? (stateVotesOverTime?.[selectedStateId] ?? []) : [];
  const stateName = selectedStateId
    ? (electoralMapData[selectedStateId]?.label ?? selectedStateId)
    : "";

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        {showHeading ? <h3 className="text-sm font-semibold">Electoral Map</h3> : <span />}
        <div className="flex items-center gap-2">
          {/* EV/Popular vote toggle */}
          <div className="flex items-center rounded-lg border border-card-border bg-card">
            <button
              onClick={() => setViewMode("ev")}
              className={`px-3 py-1.5 text-sm font-medium transition-colors rounded-l-lg ${
                viewMode === "ev" ? "bg-primary text-white" : "text-muted hover:text-foreground"
              }`}
            >
              EV
            </button>
            <button
              onClick={() => setViewMode("popular")}
              className={`px-3 py-1.5 text-sm font-medium transition-colors rounded-r-lg ${
                viewMode === "popular"
                  ? "bg-primary text-white"
                  : "text-muted hover:text-foreground"
              }`}
            >
              Popular
            </button>
          </div>

          {/* Competitive filter */}
          <button
            onClick={() => setFilterCompetitive((v) => !v)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
              filterCompetitive
                ? "border-yellow-500/60 bg-yellow-500/15 text-yellow-400"
                : "border-card-border bg-card text-muted hover:text-foreground"
            }`}
            title="Highlight the 5 states with the closest margins"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            Competitive
            {filterCompetitive && (
              <span className="rounded-full bg-yellow-500/30 px-1.5 py-0.5 text-[10px] leading-none">
                ON
              </span>
            )}
          </button>
        </div>
      </div>
      <PresidentialElectoralMap
        electoralMapData={displayMapData}
        electoralVotesByCandidate={electoralVotesByCandidate}
        candidateNames={candidateNames}
        candidateParties={candidateParties}
        candidateColors={candidateColors}
        highlightedStates={filterCompetitive ? fiveClosestStates : undefined}
        onStateClick={(stateId) => setSelectedStateId(stateId)}
        candidateTravelStates={candidateTravelStates}
      />
      {selectedStateId && (
        <StateDetailModal
          electionId={electionId}
          stateId={selectedStateId}
          countryId="US"
          stateName={stateName}
          votesByCandidate={stateData?.votesByCandidate ?? {}}
          evByCandidate={stateData?.evByCandidate ?? {}}
          candidateNames={candidateNames}
          candidateColors={candidateColors}
          snapshots={stateSnapshots}
          onClose={() => setSelectedStateId(null)}
        />
      )}
    </div>
  );
}

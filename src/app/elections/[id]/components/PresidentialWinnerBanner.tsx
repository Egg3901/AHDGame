"use client";

import type { CandidateDetail } from "./ElectionDetailTypes";
import type {
  ContingentElectionDisplay,
  PresidentialResolutionMode,
} from "@/lib/elections/presidentialResolutionDisplay";
import { isContingentResolutionMode } from "@/lib/elections/presidentialResolutionDisplay";

interface PresidentialWinnerBannerProps {
  winner: CandidateDetail;
  winnerColor: string;
  electoralVotes: Record<string, number>;
  popularVotePct: number;
  resolutionMode?: PresidentialResolutionMode;
  contingentResult?: ContingentElectionDisplay;
}

export function PresidentialWinnerBanner({
  winner,
  winnerColor,
  electoralVotes,
  popularVotePct,
  resolutionMode,
  contingentResult,
}: PresidentialWinnerBannerProps) {
  const isContingent = isContingentResolutionMode(resolutionMode);
  const ev = electoralVotes[winner.id] ?? 0;
  const houseVotes = contingentResult?.houseVoteTotals[winner.id] ?? 0;

  const subtitle = isContingent
    ? `${houseVotes} state delegation vote${houseVotes === 1 ? "" : "s"} · ${ev} Electoral Votes · ${popularVotePct.toFixed(1)}% Popular Vote`
    : `${ev} Electoral Votes · ${popularVotePct.toFixed(1)}% Popular Vote`;

  const headline = isContingent
    ? `${winner.characterName} Wins the Presidency (House Ballot)`
    : `${winner.characterName} Wins the Presidency`;

  return (
    <div className="rounded-2xl border-2 border-yellow-500/40 bg-gradient-to-br from-yellow-500/10 to-yellow-500/5 p-8">
      <div className="text-center">
        <div className="mb-2">
          <span className="text-yellow-400 text-5xl">★</span>
        </div>
        <h2 className="text-3xl font-bold mb-2">{headline}</h2>
        <p className="text-lg text-muted">{subtitle}</p>
        {isContingent && (
          <p className="mt-2 text-sm text-amber-300/90">
            No candidate reached 270 electoral votes. The House of Representatives elected the
            President by state delegation.
          </p>
        )}
        <div className="mt-4 flex items-center justify-center gap-2">
          <span className="text-sm font-medium" style={{ color: winnerColor }}>
            {winner.partyName}
          </span>
          {winner.runningMateName && (
            <span className="text-sm text-muted">· Running Mate: {winner.runningMateName}</span>
          )}
        </div>
      </div>
    </div>
  );
}

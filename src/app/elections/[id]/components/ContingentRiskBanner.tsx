"use client";

import type {
  ContingentEvRiskAssessment,
  ContingentProjectionDisplay,
} from "@/lib/elections/presidentialResolutionDisplay";

interface ContingentRiskBannerProps {
  risk: ContingentEvRiskAssessment;
  candidateNames: Record<string, string>;
  projection?: ContingentProjectionDisplay;
}

const CHAMBER_BASIS_COPY: Record<ContingentProjectionDisplay["basis"], string> = {
  founding:
    "No House is seated yet, so the House being elected now would cast that ballot, read here from its current projection.",
  incoming:
    "The House elected alongside this race would cast that ballot, read here from its current projection.",
  mixed:
    "The House elected alongside this race would cast that ballot, together with sitting members from states with no House race this cycle.",
  sitting: "No House races resolve before this one, so the sitting House would cast that ballot.",
};

function HouseOutcome({
  projection,
  winnerName,
}: {
  projection: ContingentProjectionDisplay;
  winnerName: string;
}) {
  const delegations = projection.houseVoteTotals[projection.presidentWinnerId] ?? 0;
  if (!projection.houseDeadlocked) {
    return (
      <>
        Projected House ballot: <span className="text-foreground font-medium">{winnerName}</span>{" "}
        wins {delegations} of the {projection.houseThreshold} state delegations needed.
      </>
    );
  }
  return (
    <>
      Projected House ballot: no candidate reaches {projection.houseThreshold} state delegations
      {delegations > 0 ? `; ${winnerName} leads with ${delegations}` : ""}. The deadlock breaker
      would seat <span className="text-foreground font-medium">{winnerName}</span>.
    </>
  );
}

export function ContingentRiskBanner({
  risk,
  candidateNames,
  projection,
}: ContingentRiskBannerProps) {
  if (!risk.atRisk) return null;

  const leaderName = risk.leaderId ? (candidateNames[risk.leaderId] ?? "Leader") : "Leader";
  const winnerName = projection
    ? (candidateNames[projection.presidentWinnerId] ?? "Unknown candidate")
    : null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
      <p className="font-semibold text-amber-200">Contingent election risk</p>
      <p className="mt-1 text-muted">
        Current projection: <span className="text-foreground font-medium">{leaderName}</span> leads
        with {risk.leaderEv} electoral votes, short of the {risk.evNeeded} needed for an outright
        win. If no candidate reaches {risk.evNeeded}, the House elects the president from the top
        three electoral vote finishers, one vote per state delegation, and the Senate elects the
        vice president from the top two running mates.
        {projection ? ` ${CHAMBER_BASIS_COPY[projection.basis]}` : ""}
      </p>
      {projection && winnerName && (
        <ul className="mt-2 space-y-1 text-muted">
          <li>
            <HouseOutcome projection={projection} winnerName={winnerName} />
          </li>
          {projection.vicePresidentWinnerId && (
            <li>
              Projected Senate ballot:{" "}
              <span className="text-foreground font-medium">
                {projection.vicePresidentWinnerName ?? "Unknown running mate"}
              </span>{" "}
              {projection.senateDeadlocked
                ? `leads without reaching ${projection.senateThreshold} votes and would be seated by the deadlock breaker.`
                : `for vice president, with ${projection.senateVoteTotals[projection.vicePresidentWinnerId] ?? 0} of ${projection.senateThreshold} votes needed.`}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

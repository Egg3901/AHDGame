"use client";

import type { ContingentEvRiskAssessment } from "@/lib/elections/presidentialResolutionDisplay";

interface ContingentRiskBannerProps {
  risk: ContingentEvRiskAssessment;
  candidateNames: Record<string, string>;
}

export function ContingentRiskBanner({ risk, candidateNames }: ContingentRiskBannerProps) {
  if (!risk.atRisk) return null;

  const leaderName = risk.leaderId ? (candidateNames[risk.leaderId] ?? "Leader") : "Leader";

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
      <p className="font-semibold text-amber-200">Contingent election risk</p>
      <p className="mt-1 text-muted">
        Current projection: <span className="text-foreground font-medium">{leaderName}</span> leads
        with {risk.leaderEv} electoral votes — below the {risk.evNeeded} needed for an outright win.
        If no candidate reaches {risk.evNeeded}, the presidency would be decided by a House
        state-delegation ballot (top three EV finishers; 26 states required) and the Senate would
        elect the Vice President from the top two running mates.
      </p>
    </div>
  );
}

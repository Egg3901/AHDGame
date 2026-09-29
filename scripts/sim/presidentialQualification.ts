interface Snapshot {
  candidates: Array<{
    id: string;
    party: string;
    isNPP: boolean;
    totalVotes: number;
    electoralVotes?: number;
  }>;
  units: Array<{
    id: string;
    weight: number;
    candidates: Array<{ candidateId: string; votes: number }>;
  }>;
  totalEv?: number;
  evNeeded?: number;
  summary: { totalVotes: number };
}
interface Tally {
  totalVotes: Record<string, number>;
  totalVotesByUnit?: Record<string, Record<string, number>>;
  electoralVotesByCandidate?: Record<string, number>;
  resolutionMode?: "majority" | "contingent" | "contingent_deadlock";
  contingentResult?: { presidentWinnerId: string };
}

export interface PresidentialRaceQualification {
  electionId: string;
  popularMarginPct: number | null;
  evMargin: number | null;
  winnerId: string | null;
  winnerParty: string | null;
  winnerIsNPP: boolean | null;
  contingent: boolean;
  actorMix: "npp-only" | "player-only" | "mixed" | "unknown";
  electionTimeApportionment: Record<string, number> | null;
  reconciliation: string[];
}

/** Compare the frozen election-night view with the persisted tally, without using today's EV map. */
export function qualifyPresidentialRace(
  electionId: string,
  snapshot: Snapshot | null,
  tally: Tally | null
): PresidentialRaceQualification {
  const errors: string[] = [];
  if (!snapshot) errors.push("missing election-time result snapshot");
  if (!tally) errors.push("missing persisted tally");
  const votes = Object.entries(tally?.totalVotes ?? {}).sort((a, b) => b[1] - a[1]);
  const totalVotes = votes.reduce((sum, [, count]) => sum + count, 0);
  const popularMarginPct =
    votes.length >= 2 && totalVotes > 0 ? (100 * (votes[0][1] - votes[1][1])) / totalVotes : null;
  const ev = Object.entries(tally?.electoralVotesByCandidate ?? {}).sort((a, b) => b[1] - a[1]);
  const evMargin = ev.length >= 2 ? ev[0][1] - ev[1][1] : null;
  const winnerId =
    tally?.contingentResult?.presidentWinnerId ??
    (ev.length && snapshot?.evNeeded && ev[0][1] >= snapshot.evNeeded ? ev[0][0] : null);
  const winner = snapshot?.candidates.find((candidate) => candidate.id === winnerId);
  const actorMix = !snapshot?.candidates.length
    ? "unknown"
    : snapshot.candidates.every((candidate) => candidate.isNPP)
      ? "npp-only"
      : snapshot.candidates.every((candidate) => !candidate.isNPP)
        ? "player-only"
        : "mixed";
  const electionTimeApportionment = snapshot
    ? Object.fromEntries(snapshot.units.map((unit) => [unit.id, unit.weight]))
    : null;

  if (snapshot && tally) {
    for (const candidate of snapshot.candidates) {
      if (candidate.totalVotes !== (tally.totalVotes[candidate.id] ?? 0))
        errors.push(`national votes differ for ${candidate.id}`);
      if (candidate.electoralVotes !== (tally.electoralVotesByCandidate?.[candidate.id] ?? 0))
        errors.push(`electoral votes differ for ${candidate.id}`);
    }
    for (const candidateId of Object.keys(tally.totalVotes)) {
      if (!snapshot.candidates.some((candidate) => candidate.id === candidateId))
        errors.push(`candidate ${candidateId} missing from election-time result`);
    }
    if (snapshot.summary.totalVotes !== totalVotes) errors.push("national vote total differs");
    const unitWeight = snapshot.units.reduce((sum, unit) => sum + unit.weight, 0);
    if (snapshot.totalEv !== undefined && unitWeight !== snapshot.totalEv)
      errors.push("election-time unit weights differ from total EV");
    const assignedEv = ev.reduce((sum, [, count]) => sum + count, 0);
    if (snapshot.totalEv !== undefined && assignedEv !== snapshot.totalEv)
      errors.push("assigned EV differs from election-time total");
    const byUnit = tally.totalVotesByUnit ?? {};
    for (const unitId of Object.keys(byUnit)) {
      if (!snapshot.units.some((unit) => unit.id === unitId))
        errors.push(`stored unit ${unitId} missing from election-time result`);
    }
    for (const unit of snapshot.units) {
      const stored = byUnit[unit.id];
      if (!stored) {
        errors.push(`missing stored unit ${unit.id}`);
        continue;
      }
      for (const candidate of unit.candidates) {
        if (candidate.votes !== (stored[candidate.candidateId] ?? 0))
          errors.push(`unit votes differ for ${unit.id}/${candidate.candidateId}`);
      }
      for (const candidateId of Object.keys(stored)) {
        if (!unit.candidates.some((candidate) => candidate.candidateId === candidateId))
          errors.push(`stored vote ${unit.id}/${candidateId} missing from election-time result`);
      }
    }
  }
  return {
    electionId,
    popularMarginPct,
    evMargin,
    winnerId,
    winnerParty: winner?.party ?? null,
    winnerIsNPP: winner?.isNPP ?? null,
    contingent:
      tally?.resolutionMode === "contingent" || tally?.resolutionMode === "contingent_deadlock",
    actorMix,
    electionTimeApportionment,
    reconciliation: errors,
  };
}

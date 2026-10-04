/**
 * Modern Hungarian constituency vacancies use a single plurality ballot.
 * Each frozen vacant district elects one person; equal leaders or no votes
 * leave it vacant. These results never recalculate national-list mandates.
 */
export interface HuModernByElectionBallot {
  districtId: string;
  registeredVoters: number;
  candidates: readonly { personId: string; votes: number }[];
}
export interface HuModernByElectionCount {
  winners: Record<string, string | null>;
  vacancies: string[];
}
/** Act CCIII of2011 §§11,13 and19: one round, plurality and tied-seat retry. */
export function countHuModernByElection(
  frozenDistrictIds: readonly string[],
  vacantDistrictIds: readonly string[],
  ballots: readonly HuModernByElectionBallot[]
): HuModernByElectionCount {
  const known = new Set(frozenDistrictIds);
  const vacant = new Set(vacantDistrictIds);
  if (
    frozenDistrictIds.length !== 106 ||
    known.size !== 106 ||
    frozenDistrictIds.some((id) => !id) ||
    !vacant.size ||
    vacant.size !== vacantDistrictIds.length ||
    vacantDistrictIds.some((id) => !known.has(id)) ||
    ballots.length !== vacant.size ||
    new Set(ballots.map((row) => row.districtId)).size !== vacant.size ||
    ballots.some((row) => !vacant.has(row.districtId))
  )
    throw new Error("Modern Hungarian by-election must cover its frozen vacant districts");
  const people = new Set<string>();
  const winners: Record<string, string | null> = {};
  const vacancies: string[] = [];
  for (const ballot of [...ballots].sort((a, b) => a.districtId.localeCompare(b.districtId))) {
    if (!Number.isSafeInteger(ballot.registeredVoters) || ballot.registeredVoters < 1)
      throw new Error("Modern Hungarian by-election has an invalid frozen register");
    let total = 0;
    for (const candidate of ballot.candidates) {
      if (
        !candidate.personId ||
        people.has(candidate.personId) ||
        !Number.isSafeInteger(candidate.votes) ||
        candidate.votes < 0
      )
        throw new Error("Modern Hungarian by-election has invalid or duplicate people");
      people.add(candidate.personId);
      total += candidate.votes;
    }
    if (!Number.isSafeInteger(total) || total > ballot.registeredVoters)
      throw new Error("Modern Hungarian by-election exceeds its frozen electorate");
    const ranked = [...ballot.candidates].sort((a, b) => b.votes - a.votes);
    const winner =
      ranked[0]?.votes > 0 && ranked[0].votes !== ranked[1]?.votes ? ranked[0].personId : null;
    winners[ballot.districtId] = winner;
    if (!winner) vacancies.push(ballot.districtId);
  }
  return { winners, vacancies };
}

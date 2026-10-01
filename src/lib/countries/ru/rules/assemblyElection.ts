/**
 * Bound Assembly ballots use cohort admission and certification exclusively.
 * isNativeRussianAssemblyElection keeps invalid or incomplete native families
 * from falling back to a single-race candidate or office writer.
 */
export function isNativeRussianAssemblyElection(election: {
  countryId?: string;
  electionType: string;
  russianDumaRound?: unknown;
  russianCouncilRound?: unknown;
}) {
  return (
    election.countryId === "RU" &&
    ((election.electionType === "dumaDeputy" && !!election.russianDumaRound) ||
      (election.electionType === "federationCouncilMember" && !!election.russianCouncilRound))
  );
}

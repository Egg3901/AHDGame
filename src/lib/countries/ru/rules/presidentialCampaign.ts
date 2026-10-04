/**
 * Russian presidential races count a nationwide popular ballot.
 * usesLegacyPresidentialCampaign keeps Russia out of US-style delegate,
 * electoral-college accumulation and tally initialization.
 */
export function usesLegacyPresidentialCampaign(election: {
  electionType: string;
  countryId?: string | null;
}): boolean {
  return (
    election.electionType === "president" &&
    election.countryId !== "RU" &&
    election.countryId !== "BR"
  );
}

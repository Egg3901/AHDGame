/**
 * Russia's first-Duma national list admits party nominees from every home region.
 * isRussianDumaNationalList identifies the frozen ballot for display; the filing
 * API separately validates the world mandate, party registration and residence.
 */
export function isRussianDumaNationalList(election: {
  countryId: string;
  electionType: string;
  state: string;
  seatId?: string | null;
  totalSeats?: number | null;
  russianDumaRound?: { cohortId: string; mandateSinceTurn: number; tier: string };
}): boolean {
  const binding = election.russianDumaRound;
  return (
    election.countryId === "RU" &&
    election.electionType === "dumaDeputy" &&
    election.state === "RU" &&
    election.seatId === "RU-duma-national-list" &&
    election.totalSeats === 225 &&
    binding?.tier === "list" &&
    /^[a-f0-9]{24}$/.test(binding.cohortId) &&
    Number.isSafeInteger(binding.mandateSinceTurn) &&
    binding.mandateSinceTurn > 0
  );
}

/** National list nominees remain registered together; seats are assigned only at certification. */
export function russianDumaPrimaryAdvanceLimit(
  election: Parameters<typeof isRussianDumaNationalList>[0],
  registeredCandidates: number
): number | null {
  if (!isRussianDumaNationalList(election)) return null;
  if (!Number.isSafeInteger(registeredCandidates) || registeredCandidates < 0)
    throw new Error("Duma list registration needs a safe candidate count");
  return registeredCandidates;
}

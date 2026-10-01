/**
 * Russia's first-Duma national list admits party nominees from every home region.
 * isRussianDumaNationalList identifies the frozen ballot for display; the filing
 * API separately validates the world mandate, party registration and residence.
 */
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";

const councilDistricts = new Map(
  RUSSIAN_COUNCIL_SUBJECTS_1993.map(([number, , region]) => [
    `RU-council-${number}`,
    { number, region },
  ])
);

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

/** The Council's registration period does not eliminate nominees through party primaries. */
export function russianCouncilPrimaryAdvanceLimit(
  election: Omit<Parameters<typeof isRussianDumaNationalList>[0], "russianDumaRound"> & {
    russianCouncilRound?: {
      cohortId: string;
      mandateSinceTurn: number;
      registeredVoters: number;
      districtNumber: number;
    };
  },
  registeredCandidates: number
): number | null {
  const binding = election.russianCouncilRound;
  const district = councilDistricts.get(election.seatId ?? "");
  if (
    election.countryId !== "RU" ||
    election.electionType !== "federationCouncilMember" ||
    election.totalSeats !== 2 ||
    !district ||
    election.state !== district.region ||
    !binding ||
    binding.districtNumber !== district.number ||
    !/^[a-f0-9]{24}$/.test(binding.cohortId) ||
    !Number.isSafeInteger(binding.mandateSinceTurn) ||
    binding.mandateSinceTurn <= 0 ||
    !Number.isSafeInteger(binding.registeredVoters) ||
    binding.registeredVoters < 0
  )
    return null;
  if (!Number.isSafeInteger(registeredCandidates) || registeredCandidates < 0)
    throw new Error("Council registration needs a safe candidate count");
  // Independent voter groups have no shared two-candidate cap. Association
  // limits belong to filing, not a primary that can discard registered nominees.
  return registeredCandidates;
}

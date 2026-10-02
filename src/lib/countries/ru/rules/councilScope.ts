/**
 * Registered first-Council nominees advance together through the registration period.
 * russianCouncilPrimaryAdvanceLimit requires the complete frozen subject binding,
 * preserving independent voter groups without applying generic party primaries.
 */
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import type { isRussianDumaNationalList } from "./assemblyScope";
const councilDistricts = new Map(
  RUSSIAN_COUNCIL_SUBJECTS_1993.map(([number, , region]) => [
    `RU-council-${number}`,
    { number, region },
  ])
);

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

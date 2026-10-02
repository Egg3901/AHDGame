/**
 * Duma ballots count against the electoral register frozen when their cohort opens.
 * bindRussianDumaElectorate scales each district or national list separately and
 * avoids applying voter registration twice, without changing other races' inputs.
 */
import type { Election } from "@/lib/db/types";
import type { AccumulateVoteTurnPreload } from "@/lib/electionEngine/types";
import { isRussianDumaNationalList } from "./rules/assemblyScope";

export function usesRussianDumaNationalElectorate(election: Election): boolean {
  return isRussianDumaNationalList({
    ...election,
    russianDumaRound: election.russianDumaRound
      ? {
          ...election.russianDumaRound,
          cohortId: election.russianDumaRound.cohortId.toHexString(),
        }
      : undefined,
  });
}

export function bindRussianDumaElectorate(
  election: Election,
  preload: AccumulateVoteTurnPreload
): AccumulateVoteTurnPreload {
  if (
    election.countryId !== "RU" ||
    election.electionType !== "dumaDeputy" ||
    !election.russianDumaRound
  )
    return preload;
  const binding = election.russianDumaRound;
  const state = preload.stateMap.get(election.state);
  const validTier =
    binding.tier === "list"
      ? usesRussianDumaNationalElectorate(election)
      : binding.tier === "constituency" &&
        election.state !== "RU" &&
        election.totalSeats === 1 &&
        Number.isSafeInteger(binding.regionalDistrictCount) &&
        binding.regionalDistrictCount! > 0;
  if (
    !validTier ||
    !Number.isSafeInteger(binding.mandateSinceTurn) ||
    binding.mandateSinceTurn < 1 ||
    !state ||
    !Number.isSafeInteger(binding.registeredVoters) ||
    binding.registeredVoters < 0
  )
    throw new Error("Duma ballot needs its frozen district or national electorate");
  const stateMap = new Map(preload.stateMap);
  stateMap.set(election.state, {
    ...state,
    votingEligiblePopulation: binding.registeredVoters,
  });
  const registrationPoolByState = new Map(preload.registrationPoolByState);
  // The opening transaction already applied registration to this ballot's register.
  registrationPoolByState.set(election.state, {
    _id: `RU_${election.state}`,
    countryId: "RU",
    stateId: election.state,
    independent: 100,
    unregistered: 0,
    lastUpdatedTurn: election.startTurn ?? 0,
    createdAt: election.createdAt,
    updatedAt: election.updatedAt,
  });
  return { ...preload, stateMap, registrationPoolByState };
}

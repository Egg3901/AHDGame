/**
 * Each Council subject counts against the register frozen when its cohort opens.
 * bindRussianCouncilElectorate scales only this ballot's home macroregion input,
 * avoids applying registration twice and keeps shared turn preloads unchanged.
 */
import type { Election } from "@/lib/db/types";
import type { AccumulateVoteTurnPreload } from "@/lib/electionEngine/types";
import { russianAssemblyPrimaryAdvanceLimit } from "./assemblyPrimaryProgression";

export function bindRussianCouncilElectorate(
  election: Election,
  preload: AccumulateVoteTurnPreload
): AccumulateVoteTurnPreload {
  if (
    election.countryId !== "RU" ||
    election.electionType !== "federationCouncilMember" ||
    !election.russianCouncilRound
  )
    return preload;
  const state = preload.stateMap.get(election.state);
  if (!state || russianAssemblyPrimaryAdvanceLimit(election, 0) === null)
    throw new Error("Council ballot needs its frozen subject electorate");
  const stateMap = new Map(preload.stateMap);
  stateMap.set(election.state, {
    ...state,
    votingEligiblePopulation: election.russianCouncilRound.registeredVoters,
  });
  const registrationPoolByState = new Map(preload.registrationPoolByState);
  // The opening transaction already applied registration to this subject's register.
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

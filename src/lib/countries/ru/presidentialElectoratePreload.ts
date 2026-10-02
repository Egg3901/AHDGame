/**
 * Russia's direct ballot counts against the electoral register frozen at opening.
 * bindRussianPresidentialElectorate changes only this race's national preload;
 * live regional electorates and other elections keep their existing inputs.
 */
import type { Election } from "@/lib/db/types";
import type { AccumulateVoteTurnPreload } from "@/lib/electionEngine/types";
export function bindRussianPresidentialElectorate(
  election: Election,
  preload: AccumulateVoteTurnPreload
): AccumulateVoteTurnPreload {
  if (
    election.countryId !== "RU" ||
    election.electionType !== "president" ||
    !election.russianPresidentialRound
  )
    return preload;
  const registered = election.russianPresidentialRound.registeredVoters;
  const nation = preload.stateMap.get("RU");
  if (!nation || !Number.isSafeInteger(registered) || registered < 1)
    throw new Error("Russian ballot needs its frozen national electorate");
  const stateMap = new Map(preload.stateMap);
  stateMap.set("RU", { ...nation, votingEligiblePopulation: registered });
  const registrationPoolByState = new Map(preload.registrationPoolByState);
  // Registration has already been applied when freezing the register.
  registrationPoolByState.set("RU", {
    _id: "RU_RU",
    countryId: "RU",
    stateId: "RU",
    independent: 100,
    unregistered: 0,
    lastUpdatedTurn: election.startTurn ?? 0,
    createdAt: election.createdAt,
    updatedAt: election.updatedAt,
  });
  return { ...preload, stateMap, registrationPoolByState };
}

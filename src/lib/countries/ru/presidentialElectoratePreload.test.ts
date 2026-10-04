import { describe, expect, it } from "vitest";
import type { Election, State } from "@/lib/db/types";
import type { AccumulateVoteTurnPreload } from "@/lib/electionEngine/types";
import { bindRussianPresidentialElectorate as bind } from "./presidentialElectoratePreload";
function fixture() {
  const preload = {
    categories: [],
    stateMap: new Map([
      ["RU", { _id: "RU", population: 1200, votingEligiblePopulation: 900 } as State],
    ]),
    demographicsMap: new Map(),
    statePartyOrgsByState: new Map(),
    turnoutByState: new Map(),
  } as AccumulateVoteTurnPreload;
  const election = {
    countryId: "RU",
    electionType: "president",
    russianPresidentialRound: { round: 1, registeredVoters: 750, mandateSinceTurn: 72 },
  } as Election;
  return { preload, election };
}
describe("Russian frozen presidential electorate", () => {
  it("uses the frozen register without applying registration twice or changing shared inputs", () => {
    const { preload, election } = fixture();
    const bound = bind(election, preload);
    expect(bound.stateMap.get("RU")?.votingEligiblePopulation).toBe(750);
    expect(bound.registrationPoolByState?.get("RU")?.unregistered).toBe(0);
    expect(preload.stateMap.get("RU")?.votingEligiblePopulation).toBe(900);
    expect(preload.registrationPoolByState).toBeUndefined();
  });
  it("leaves other national elections unchanged and rejects a missing register", () => {
    const { preload, election } = fixture();
    expect(bind({ ...election, electionType: "stateDuma" }, preload)).toBe(preload);
    preload.stateMap.clear();
    expect(() => bind(election, preload)).toThrow("frozen national electorate");
  });
});

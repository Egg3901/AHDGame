import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Election, State } from "@/lib/db/types";
import type { AccumulateVoteTurnPreload } from "@/lib/electionEngine/types";
import { bindBallotElectorate as bind } from "@/lib/electionEngine/ballotElectoratePreload";

function fixture() {
  const preload = {
    categories: [],
    stateMap: new Map([
      ["CEN", { _id: "CEN", population: 10000, votingEligiblePopulation: 7500 } as State],
      ["VOL", { _id: "VOL", population: 8000, votingEligiblePopulation: 6000 } as State],
    ]),
    demographicsMap: new Map(),
    statePartyOrgsByState: new Map(),
    turnoutByState: new Map(),
    registrationPoolByState: new Map(),
  } as AccumulateVoteTurnPreload;
  const election = {
    countryId: "RU",
    electionType: "federationCouncilMember",
    state: "CEN",
    seatId: "RU-council-77",
    totalSeats: 2,
    russianCouncilRound: {
      cohortId: new ObjectId(),
      mandateSinceTurn: 129,
      districtNumber: 77,
      registeredVoters: 750,
    },
  } as Election;
  return { preload, election };
}
describe("Council frozen subject electorates", () => {
  it("scales one subject without applying registration twice or changing shared inputs", () => {
    const { preload, election } = fixture();
    const bound = bind(election, preload);
    expect(bound.stateMap.get("CEN")?.votingEligiblePopulation).toBe(750);
    expect(bound.registrationPoolByState?.get("CEN")?.unregistered).toBe(0);
    expect(preload.stateMap.get("CEN")?.votingEligiblePopulation).toBe(7500);
    expect(preload.registrationPoolByState?.size).toBe(0);
    expect(bound.stateMap.get("VOL")).toBe(preload.stateMap.get("VOL"));
    expect(bound.demographicsMap).toBe(preload.demographicsMap);
  });
  it("binds two subjects in the same macroregion independently", () => {
    const { preload, election } = fixture();
    const first = bind(election, preload);
    const second = bind(
      {
        ...election,
        seatId: "RU-council-50",
        russianCouncilRound: {
          ...election.russianCouncilRound!,
          districtNumber: 50,
          registeredVoters: 1200,
        },
      },
      preload
    );
    expect(first.stateMap.get("CEN")?.votingEligiblePopulation).toBe(750);
    expect(second.stateMap.get("CEN")?.votingEligiblePopulation).toBe(1200);
    expect(preload.stateMap.get("CEN")?.votingEligiblePopulation).toBe(7500);
  });
  it("preserves an empty frozen subject without restoring a live electorate", () => {
    const { preload, election } = fixture();
    election.russianCouncilRound!.registeredVoters = 0;
    expect(bind(election, preload).stateMap.get("CEN")?.votingEligiblePopulation).toBe(0);
  });
  it.each(["region", "subject", "number", "capacity", "register", "state"])(
    "rejects a corrupt frozen %s",
    (reason) => {
      const { preload, election } = fixture();
      if (reason === "region") election.state = "VOL";
      if (reason === "subject") election.seatId = "RU-council-90";
      if (reason === "number") election.russianCouncilRound!.districtNumber = 78;
      if (reason === "capacity") election.totalSeats = 1;
      if (reason === "register") election.russianCouncilRound!.registeredVoters = -1;
      if (reason === "state") preload.stateMap.clear();
      expect(() => bind(election, preload)).toThrow("frozen subject");
    }
  );
  it("leaves unrelated and unbound ballots unchanged", () => {
    const { preload, election } = fixture();
    expect(bind({ ...election, russianCouncilRound: undefined }, preload)).toBe(preload);
    expect(bind({ ...election, countryId: "US" }, preload)).toBe(preload);
    expect(bind({ ...election, electionType: "senate" }, preload)).toBe(preload);
  });
});

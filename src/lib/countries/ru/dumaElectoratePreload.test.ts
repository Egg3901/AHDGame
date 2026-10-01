import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Election, State } from "@/lib/db/types";
import type { AccumulateVoteTurnPreload } from "@/lib/electionEngine/types";
import {
  bindRussianDumaElectorate as bind,
  usesRussianDumaNationalElectorate as national,
} from "./dumaElectoratePreload";

function fixture(tier: "list" | "constituency" = "list") {
  const preload = {
    categories: [],
    stateMap: new Map([
      ["RU", { _id: "RU", population: 1200, votingEligiblePopulation: 900 } as State],
      ["CEN", { _id: "CEN", population: 600, votingEligiblePopulation: 450 } as State],
    ]),
    demographicsMap: new Map(),
    statePartyOrgsByState: new Map(),
    turnoutByState: new Map(),
    registrationPoolByState: new Map(),
  } as AccumulateVoteTurnPreload;
  const election = {
    countryId: "RU",
    electionType: "dumaDeputy",
    state: tier === "list" ? "RU" : "CEN",
    seatId: tier === "list" ? "RU-duma-national-list" : "RU-duma-CEN-1",
    totalSeats: tier === "list" ? 225 : 1,
    russianDumaRound: {
      tier,
      cohortId: new ObjectId(),
      registeredVoters: 75,
      mandateSinceTurn: 72,
      regionalDistrictCount: 3,
    },
  } as Election;
  return { preload, election };
}

describe("Duma frozen electorates", () => {
  it.each(["list", "constituency"] as const)(
    "freezes the %s ballot without altering another race or double-gating registration",
    (tier) => {
      const { preload, election } = fixture(tier);
      const bound = bind(election, preload);
      expect(bound.stateMap.get(election.state)?.votingEligiblePopulation).toBe(75);
      expect(bound.registrationPoolByState.get(election.state)?.unregistered).toBe(0);
      expect(preload.stateMap.get(election.state)?.votingEligiblePopulation).toBe(
        tier === "list" ? 900 : 450
      );
      expect(preload.registrationPoolByState.size).toBe(0);
      expect(bound.stateMap.get(tier === "list" ? "CEN" : "RU")).toBe(
        preload.stateMap.get(tier === "list" ? "CEN" : "RU")
      );
      expect(national(election)).toBe(tier === "list");
    }
  );
  it("permits an empty district and rejects a missing or corrupt frozen electorate", () => {
    const { preload, election } = fixture("constituency");
    election.russianDumaRound!.registeredVoters = 0;
    expect(bind(election, preload).stateMap.get("CEN")?.votingEligiblePopulation).toBe(0);
    election.russianDumaRound!.registeredVoters = -1;
    expect(() => bind(election, preload)).toThrow("frozen district");
    election.russianDumaRound!.registeredVoters = 75;
    preload.stateMap.clear();
    expect(() => bind(election, preload)).toThrow("frozen district");
  });
  it("does not synthesize a national electorate for unbound or malformed list elections", () => {
    const { preload, election } = fixture();
    expect(bind({ ...election, russianDumaRound: undefined }, preload)).toBe(preload);
    expect(national({ ...election, russianDumaRound: undefined })).toBe(false);
    expect(national({ ...election, totalSeats: 1 })).toBe(false);
    expect(() => bind({ ...election, totalSeats: 1 }, preload)).toThrow("frozen district");
    expect(bind({ ...election, countryId: "US" }, preload)).toBe(preload);
  });
});

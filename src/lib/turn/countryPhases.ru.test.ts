import { describe, it, expect } from "vitest";
import { COUNTRY_ELECTION_PHASES } from "./countryPhases";

describe("COUNTRY_ELECTION_PHASES — RU registration", () => {
  it("registers every Soviet election family in declared order", () => {
    const ru = COUNTRY_ELECTION_PHASES.RU;
    expect(ru).toBeDefined();
    expect(ru!.map((p) => p.name)).toEqual([
      "ruSupremeSovietElections",
      "ruNationalitiesElections",
      "ruRepublicSovietElections",
      "ruGovernorElections",
      "ruUnionCongressElections",
    ]);
  });
});

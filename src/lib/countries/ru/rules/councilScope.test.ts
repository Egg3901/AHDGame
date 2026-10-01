import { describe, expect, it } from "vitest";
import { RUSSIAN_COUNCIL_SUBJECTS_1993 } from "../data/councilSubjects1993";
import { russianCouncilPrimaryAdvanceLimit as limit } from "./assemblyScope";

function fixture(): Parameters<typeof limit>[0] {
  return {
    countryId: "RU",
    electionType: "federationCouncilMember",
    state: "CEN",
    seatId: "RU-council-77",
    totalSeats: 2,
    russianCouncilRound: {
      cohortId: "000000000000000000000001",
      mandateSinceTurn: 129,
      districtNumber: 77,
      registeredVoters: 1000,
    },
  };
}

describe("Council registration progression", () => {
  it("retains all registered nominees, including distinct independent voter groups", () => {
    const election = fixture();
    const before = structuredClone(election);
    expect(limit(election, 7)).toBe(7);
    expect(limit(election, 0)).toBe(0);
    expect(election).toEqual(before);
  });
  it("recognizes all 89 frozen subject ballots without combining nested okrugs", () => {
    for (const [number, , region] of RUSSIAN_COUNCIL_SUBJECTS_1993) {
      const election = fixture();
      election.seatId = `RU-council-${number}`;
      election.state = region;
      election.russianCouncilRound!.districtNumber = number;
      expect(limit(election, 4)).toBe(4);
    }
  });
  it.each([
    "country",
    "type",
    "capacity",
    "subject",
    "region",
    "binding",
    "cohort",
    "mandate",
    "number",
    "register",
  ])("leaves generic elections unchanged for an invalid %s", (reason) => {
    const election = fixture();
    if (reason === "country") election.countryId = "US";
    if (reason === "type") election.electionType = "dumaDeputy";
    if (reason === "capacity") election.totalSeats = 1;
    if (reason === "subject") election.seatId = "RU-council-90";
    if (reason === "region") election.state = "VOL";
    if (reason === "binding") delete election.russianCouncilRound;
    if (reason === "cohort") election.russianCouncilRound!.cohortId = "legacy";
    if (reason === "mandate") election.russianCouncilRound!.mandateSinceTurn = 0;
    if (reason === "number") election.russianCouncilRound!.districtNumber = 78;
    if (reason === "register") election.russianCouncilRound!.registeredVoters = -1;
    expect(limit(election, 7)).toBeNull();
  });
  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe candidate counts %s", (count) => {
    expect(() => limit(fixture(), count)).toThrow("safe candidate count");
  });
});

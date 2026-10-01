import { describe, expect, it } from "vitest";
import {
  planRussianCouncilNpcSlates as plan,
  type RussianCouncilNpcSlateInput,
} from "./councilNpcSlates";
function fixture(): RussianCouncilNpcSlateInput {
  return {
    ballots: [
      { id: "a", regionId: "CEN" },
      { id: "b", regionId: "NWR" },
    ],
    parties: ["1", "2"],
    profiles: [
      { id: "duma", party: "1", homeState: "CEN", eligible: true },
      { id: "local", party: "1", homeState: "CEN", eligible: true },
      { id: "other", party: "1", homeState: "NWR", eligible: true },
      { id: "party2", party: "2", homeState: "NWR", eligible: true },
    ],
    excludedProfileIds: ["duma"],
    activeCandidates: [],
  };
}
describe("Council bounded NPC slates", () => {
  it("fills two individual nominations per association without using Duma-reserved profiles", () => {
    const output = plan(fixture());
    expect(output.nominees).toHaveLength(8);
    expect(output.nominees.every((row) => row.profileId !== "duma" && row.capacity === 1)).toBe(
      true
    );
    expect(
      output.nominees
        .filter((row) => row.electionId === "a" && row.party === "1")
        .map((row) => row.profileId)
    ).toEqual(["local", "local"]);
    expect(
      output.nominees
        .filter((row) => row.electionId === "b" && row.party === "1")
        .map((row) => row.profileId)
    ).toEqual(["other", "other"]);
    expect(new Set(output.nominees.map((row) => row.nomineeKey)).size).toBe(8);
  });
  it("preserves a player's nomination and creates only the other association slot", () => {
    const input = fixture();
    input.activeCandidates = [{ electionId: "a", party: "1" }];
    expect(
      plan(input).nominees.filter((row) => row.electionId === "a" && row.party === "1")
    ).toMatchObject([{ nomineeKey: "a:1:2" }]);
  });
  it("replays a full slate without creating additional nominees", () => {
    const input = fixture();
    const first = plan(input);
    input.activeCandidates = first.nominees;
    expect(plan(input).nominees).toEqual([]);
  });
  it("records absent eligible parties instead of inventing profiles or overriding exclusions", () => {
    const input = fixture();
    input.excludedProfileIds = ["duma", "local", "other"];
    input.profiles[3].eligible = false;
    expect(plan(input)).toEqual({ nominees: [], unrepresentedParties: ["1", "2"] });
  });
  it("keeps selection stable under database ordering and bounds a full 89-subject cohort", () => {
    const input = fixture();
    expect(
      plan({
        ...input,
        profiles: [...input.profiles].reverse(),
        ballots: [...input.ballots].reverse(),
        parties: [...input.parties].reverse(),
      })
    ).toEqual(plan(input));
    input.ballots = Array.from({ length: 89 }, (_, i) => ({
      id: `district-${i}`,
      regionId: "CEN",
    }));
    expect(plan(input).nominees).toHaveLength(356);
  });
  it.each([
    "duplicate-ballot",
    "duplicate-party",
    "duplicate-profile",
    "foreign-entry",
    "excess-nominations",
  ])("rejects %s", (reason) => {
    const input = fixture();
    if (reason === "duplicate-ballot") input.ballots = [input.ballots[0], input.ballots[0]];
    if (reason === "duplicate-party") input.parties = ["1", "1"];
    if (reason === "duplicate-profile") input.profiles = [input.profiles[0], input.profiles[0]];
    if (reason === "foreign-entry")
      input.activeCandidates = [{ electionId: "missing", party: "1" }];
    if (reason === "excess-nominations")
      input.activeCandidates = Array.from({ length: 3 }, () => ({ electionId: "a", party: "1" }));
    expect(() => plan(input)).toThrow();
  });
});

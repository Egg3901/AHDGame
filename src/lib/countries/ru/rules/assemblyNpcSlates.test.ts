import { describe, expect, it } from "vitest";
import {
  planRussianDumaNpcSlates as plan,
  type RussianDumaNpcSlateInput,
} from "./assemblyNpcSlates";
function input(): RussianDumaNpcSlateInput {
  return {
    ballots: [
      { id: "district", regionId: "CEN", tier: "constituency" },
      { id: "list", regionId: "RU", tier: "list" },
    ],
    parties: ["1", "2"],
    profiles: [
      { id: "a", party: "1", homeState: "NWR", eligible: true },
      { id: "b", party: "1", homeState: "CEN", eligible: true },
      { id: "c", party: "2", homeState: "CEN", eligible: true },
    ],
    activeCandidates: [],
  };
}
describe("Bounded Duma NPC party slates", () => {
  it("uses local profiles for individual districts and bounded national lists", () => {
    expect(plan(input()).nominees).toEqual([
      { electionId: "district", party: "1", profileId: "b", nomineeKey: "district:1", capacity: 1 },
      { electionId: "district", party: "2", profileId: "c", nomineeKey: "district:2", capacity: 1 },
      { electionId: "list", party: "1", profileId: "a", nomineeKey: "list:1", capacity: 225 },
      { electionId: "list", party: "2", profileId: "c", nomineeKey: "list:2", capacity: 225 },
    ]);
  });
  it("preserves player constituency slots while adding list fallback capacity", () => {
    const scenario = input();
    scenario.activeCandidates = [
      { electionId: "district", party: "1", isNpc: false },
      { electionId: "list", party: "1", isNpc: false },
    ];
    const output = plan(scenario);
    expect(output.nominees.some((row) => row.nomineeKey === "district:1")).toBe(false);
    expect(output.nominees.find((row) => row.nomineeKey === "list:1")?.capacity).toBe(225);
  });
  it("does not add duplicate slates on replay", () => {
    const scenario = input();
    const first = plan(scenario);
    scenario.activeCandidates = first.nominees.map((row) => ({ ...row, isNpc: true }));
    expect(plan(scenario).nominees).toEqual([]);
  });
  it("reports missing eligible party representation instead of inventing NPCs", () => {
    const scenario = input();
    scenario.profiles = scenario.profiles.map((row) => ({ ...row, eligible: row.party !== "2" }));
    expect(plan(scenario).unrepresentedParties).toEqual(["2"]);
    expect(plan(scenario).nominees.every((row) => row.party === "1")).toBe(true);
  });
  it("keeps selection stable under database ordering", () => {
    const scenario = input();
    expect(
      plan({
        ...scenario,
        ballots: [...scenario.ballots].reverse(),
        parties: [...scenario.parties].reverse(),
        profiles: [...scenario.profiles].reverse(),
      })
    ).toEqual(plan(scenario));
  });
  it("bounds a full cohort to one nomination per party per ballot", () => {
    const scenario = input();
    scenario.ballots = [
      ...Array.from({ length: 225 }, (_, i) => ({
        id: `district-${i}`,
        regionId: "CEN",
        tier: "constituency" as const,
      })),
      { id: "list", regionId: "RU", tier: "list" },
    ];
    const output = plan(scenario);
    expect(output.nominees).toHaveLength(452);
    expect(new Set(output.nominees.map((row) => row.nomineeKey)).size).toBe(452);
    expect(output.nominees.filter((row) => row.capacity === 225)).toHaveLength(2);
  });
  it("rejects duplicate profile identities", () => {
    const scenario = input();
    scenario.profiles = [...scenario.profiles, scenario.profiles[0]];
    expect(() => plan(scenario)).toThrow("unique ballots");
  });
});

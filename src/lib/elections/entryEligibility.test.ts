import { describe, expect, it } from "vitest";
import type { EntryEligibilityInput } from "./entryEligibility";
import { resolveEntryAction } from "./entryEligibility";
function scenario(): EntryEligibilityInput {
  return {
    election: {
      id: "election",
      electionType: "dumaDeputy",
      state: "RU",
      countryId: "RU",
      seatId: "RU-duma-national-list",
      totalSeats: 225,
      cycle: 1,
      status: "primary",
      candidates: [],
      russianDumaRound: { cohortId: "a".repeat(24), mandateSinceTurn: 129, tier: "list" },
    },
    character: { _id: "player", name: "Nominee", party: "1", homeState: "CEN", countryId: "RU" },
    stateId: "RU",
    inThisRace: false,
    inAnyRace: false,
    primaryEnded: false,
  };
}
describe("First-Duma filing display", () => {
  it("offers national list entry from a Russian region", () => {
    expect(resolveEntryAction(scenario())).toBe("enter");
  });
  it.each([
    "foreign",
    "successor-home",
    "independent",
    "empty-party",
    "unbound",
    "fake-cohort",
    "future-shape",
    "district",
    "already-running",
    "closed",
  ])("does not offer national entry for %s", (reason) => {
    const input = scenario();
    if (!input.character) throw new Error("Missing fixture character");
    if (reason === "foreign") input.character.countryId = "PL";
    if (reason === "successor-home") input.character.homeState = "LTU";
    if (reason === "independent") input.character.party = "independent";
    if (reason === "empty-party") input.character.party = "";
    if (reason === "unbound") delete input.election.russianDumaRound;
    if (reason === "fake-cohort")
      input.election.russianDumaRound = { cohortId: "fake", mandateSinceTurn: 129, tier: "list" };
    if (reason === "future-shape") input.election.totalSeats = 450;
    if (reason === "district") input.election.seatId = "RU-duma-CEN-1";
    if (reason === "already-running") input.inAnyRace = true;
    if (reason === "closed") input.primaryEnded = true;
    expect(resolveEntryAction(input)).toBe("none");
  });
  it("retains home constituency entry for independents", () => {
    const input = scenario();
    if (!input.character) throw new Error("Missing fixture character");
    input.character.party = "independent";
    input.election.state = input.stateId = "CEN";
    input.election.seatId = "RU-duma-CEN-1";
    input.election.totalSeats = 1;
    expect(resolveEntryAction(input)).toBe("enter");
  });
  it("offers no re-entry after the viewer withdrew from this election", () => {
    const input = scenario();
    input.election.viewerWithdrew = true;
    expect(resolveEntryAction(input)).toBe("none");
  });
  it("permits withdrawal before resolution and hides it after resolution", () => {
    const input = scenario();
    input.inThisRace = true;
    expect(resolveEntryAction(input)).toBe("withdraw");
    input.election.status = "resolved";
    expect(resolveEntryAction(input)).toBe("none");
  });
});

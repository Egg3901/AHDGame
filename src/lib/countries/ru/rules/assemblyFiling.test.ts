import { describe, expect, it } from "vitest";
import { decideRussianDumaFiling as decide, type RussianDumaFilingInput } from "./assemblyFiling";
function scenario(): RussianDumaFilingInput {
  return {
    preset: "1991-default",
    turn: 130,
    registrationOrder: 1000,
    successionSinceTurn: 48,
    mandateSinceTurn: 129,
    boundCohortId: "cohort",
    election: {
      countryId: "RU",
      type: "dumaDeputy",
      state: "RU",
      seatId: "RU-duma-national-list",
      totalSeats: 225,
      primaryEndTurn: 139,
      cohortId: "cohort",
      mandateSinceTurn: 129,
      tier: "list",
    },
    character: {
      countryId: "RU",
      homeState: "CEN",
      party: "1",
      pendingRelocation: false,
      recognizedParty: true,
    },
  };
}
describe("Ratified first-Duma player filing", () => {
  it("rejects unknown or banned list associations while allowing independent constituencies", () => {
    const input = scenario();
    input.character.recognizedParty = false;
    expect(decide(input)).toEqual({ allowed: false, reason: "unregistered-list" });
    Object.assign(input.election, {
      tier: "constituency",
      state: "CEN",
      seatId: "RU-duma-CEN-1",
      totalSeats: 1,
    });
    input.character.party = "independent";
    expect(decide(input)).toMatchObject({ allowed: true });
  });
  it("admits a national party-list nominee from a Russian home region with capacity one", () => {
    expect(decide(scenario())).toEqual({
      allowed: true,
      nationalList: true,
      nomination: { registrationOrder: 1000, nominationOrder: 1000, capacity: 1 },
    });
  });
  it("admits an independent into their own canonical constituency", () => {
    const input = scenario();
    Object.assign(input.election, {
      tier: "constituency",
      state: "CEN",
      seatId: "RU-duma-CEN-1",
      totalSeats: 1,
    });
    input.character.party = "independent";
    expect(decide(input)).toMatchObject({ allowed: true, nationalList: false });
    input.character.homeState = "NWR";
    expect(decide(input)).toEqual({ allowed: false, reason: "invalid-residence" });
  });
  it.each(["independent", ""])("rejects national list filing by %s", (party) => {
    const input = scenario();
    input.character.party = party;
    expect(decide(input)).toEqual({ allowed: false, reason: "independent-list" });
  });
  it.each(["pending", "foreign", "successor-home"])("protects %s residents", (reason) => {
    const input = scenario();
    if (reason === "pending") input.character.pendingRelocation = true;
    if (reason === "foreign") input.character.countryId = "PL";
    if (reason === "successor-home") input.character.homeState = "LTU";
    expect(decide(input)).toEqual({ allowed: false, reason: "invalid-residence" });
  });
  it.each(["other-world", "other-cohort", "other-mandate", "future-succession", "future-mandate"])(
    "rejects %s bindings",
    (reason) => {
      const input = scenario();
      if (reason === "other-world") input.preset = "1953-default";
      if (reason === "other-cohort") input.election.cohortId = "unbound";
      if (reason === "other-mandate") input.election.mandateSinceTurn = 128;
      if (reason === "future-succession") input.successionSinceTurn = 131;
      if (reason === "future-mandate") input.mandateSinceTurn = 131;
      expect(decide(input)).toEqual({ allowed: false, reason: "unbound-mandate" });
    }
  );
  it("protects constituency winners while permitting list campaigning without a second mandate", () => {
    const input = scenario();
    input.character.holdsConstituencyMandate = true;
    expect(decide(input)).toMatchObject({ allowed: true, nationalList: true });
    Object.assign(input.election, {
      tier: "constituency",
      state: "CEN",
      seatId: "RU-duma-CEN-1",
      totalSeats: 1,
    });
    expect(decide(input)).toEqual({ allowed: false, reason: "constituency-mandate" });
    input.character.holdsConstituencyMandate = false;
    expect(decide(input)).toMatchObject({ allowed: true });
  });
  it("closes filing exactly at its raw-turn deadline", () => {
    const input = scenario();
    input.turn = 139;
    expect(decide(input)).toEqual({ allowed: false, reason: "filing-closed" });
  });
  it.each([
    "fake-seat",
    "wrong-country",
    "wrong-type",
    "wrong-region",
    "multi-seat-district",
    "missing-deadline",
    "unsafe-order",
  ])("rejects %s ballot shapes", (reason) => {
    const input = scenario();
    if (reason === "fake-seat") input.election.seatId = "RU-duma-CEN-10000";
    if (reason === "wrong-country") input.election.countryId = "PL";
    if (reason === "wrong-type") input.election.type = "president";
    if (reason === "wrong-region") input.election.state = "CEN";
    if (reason === "multi-seat-district")
      Object.assign(input.election, {
        tier: "constituency",
        state: "CEN",
        seatId: "RU-duma-CEN-1",
        totalSeats: 225,
      });
    if (reason === "missing-deadline") delete input.election.primaryEndTurn;
    if (reason === "unsafe-order") input.registrationOrder = Number.MAX_SAFE_INTEGER + 1;
    expect(decide(input)).toEqual({ allowed: false, reason: "invalid-ballot" });
  });
});

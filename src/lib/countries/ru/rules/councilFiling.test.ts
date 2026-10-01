import { describe, expect, it } from "vitest";
import {
  decideRussianCouncilFiling as decide,
  type RussianCouncilFilingInput,
} from "./councilFiling";
function fixture(): RussianCouncilFilingInput {
  return {
    preset: "1991-default",
    turn: 130,
    registrationOrder: 1000,
    successionSinceTurn: 48,
    mandateSinceTurn: 129,
    boundCohortId: "cohort",
    associationNominees: 1,
    election: {
      countryId: "RU",
      type: "federationCouncilMember",
      state: "CEN",
      seatId: "RU-council-77",
      totalSeats: 2,
      primaryEndTurn: 139,
      cohortId: "cohort",
      mandateSinceTurn: 129,
      districtNumber: 77,
    },
    character: {
      countryId: "RU",
      homeState: "CEN",
      party: "1",
      pendingRelocation: false,
      recognizedParty: true,
      holdsOtherChamberMandate: false,
      holdsCouncilMandate: false,
      hasOtherActiveCandidacy: false,
    },
  };
}
describe("Council subject filing", () => {
  it("admits one player nomination in a subject of their home macroregion", () => {
    const input = fixture();
    const before = structuredClone(input);
    expect(decide(input)).toEqual({ allowed: true, nomination: { registrationOrder: 1000 } });
    expect(input).toEqual(before);
  });
  it("caps associations at two nominees while independent voter groups remain separate", () => {
    const input = fixture();
    input.associationNominees = 2;
    expect(decide(input)).toEqual({ allowed: false, reason: "association-full" });
    input.character.party = "independent";
    input.character.recognizedParty = false;
    expect(decide(input).allowed).toBe(true);
  });
  it.each(["other-chamber-mandate", "council-mandate", "other-candidacy"] as const)(
    "blocks %s",
    (reason) => {
      const input = fixture();
      if (reason === "other-chamber-mandate") input.character.holdsOtherChamberMandate = true;
      if (reason === "council-mandate") input.character.holdsCouncilMandate = true;
      if (reason === "other-candidacy") input.character.hasOtherActiveCandidacy = true;
      expect(decide(input)).toEqual({ allowed: false, reason });
    }
  );
  it.each([
    "world",
    "missing-mandate",
    "unbound",
    "district",
    "number",
    "region",
    "capacity",
    "window",
    "deadline",
    "relocation",
    "residence",
    "foreign-character",
    "party",
    "association-count",
    "unsafe-order",
  ])("rejects invalid %s", (reason) => {
    const input = fixture();
    if (reason === "world") input.preset = "2019-default";
    if (reason === "missing-mandate") delete input.mandateSinceTurn;
    if (reason === "unbound") input.election.cohortId = "different";
    if (reason === "district") input.election.seatId = "RU-council-90";
    if (reason === "number") input.election.districtNumber = 1;
    if (reason === "region") input.election.state = "NWR";
    if (reason === "capacity") input.election.totalSeats = 178;
    if (reason === "window") input.election.primaryEndTurn = 129;
    if (reason === "deadline") input.turn = 139;
    if (reason === "relocation") input.character.pendingRelocation = true;
    if (reason === "residence") input.character.homeState = "NWR";
    if (reason === "foreign-character") input.character.countryId = "US";
    if (reason === "party") input.character.recognizedParty = false;
    if (reason === "association-count") input.associationNominees = -1;
    if (reason === "unsafe-order") input.registrationOrder = Number.MAX_SAFE_INTEGER + 1;
    expect(decide(input).allowed).toBe(false);
  });
});

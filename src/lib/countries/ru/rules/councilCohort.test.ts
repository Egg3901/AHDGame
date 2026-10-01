import { describe, expect, it } from "vitest";
import { planRussianCouncilDistricts } from "./councilDistricts";
import {
  resolveRussianCouncilCohort as resolve,
  type RussianCouncilCohortBallot,
} from "./councilCohort";

function fixture(): RussianCouncilCohortBallot[] {
  return planRussianCouncilDistricts(
    Object.fromEntries(Array.from({ length: 89 }, (_, i) => [`RU-council-${i + 1}`, 1000]))
  ).map((district) => ({
    id: `election-${district.districtNumber}`,
    seatId: district.seatId,
    regionId: district.regionId,
    registeredVoters: 1000,
    validBallots: 500,
    againstAllVotes: 0,
    candidates: [0, 1].map((number) => ({
      id: `${district.seatId}-${number}`,
      ownerId: `profile-${district.districtNumber}-${number}`,
      party: "independent",
      isNpc: true,
      eligible: true,
      registrationOrder: number,
      votes: 500,
    })),
  }));
}

describe("First Council cohort certification", () => {
  it("certifies 178 individual mandates and orders results by historical district number", () => {
    const input = fixture().reverse();
    const before = structuredClone(input);
    const result = resolve(input);
    expect(result.reduce((sum, row) => sum + row.winners.length, 0)).toBe(178);
    expect(result[0].seatId).toBe("RU-council-1");
    expect(result[88].seatId).toBe("RU-council-89");
    expect(input).toEqual(before);
  });
  it("retains one-mandate and failed-district vacancies while certifying other subjects", () => {
    const input = fixture();
    input[0].againstAllVotes = 200;
    input[0].candidates[0].votes = 300;
    input[0].candidates[1].votes = 150;
    input[1].validBallots = 200;
    input[1].candidates.forEach((row) => {
      row.votes = 200;
    });
    const result = resolve(input);
    expect(result[0]).toMatchObject({ vacancies: 1, decision: { outcome: "elected" } });
    expect(result[0].winners).toHaveLength(1);
    expect(result[1]).toMatchObject({
      vacancies: 2,
      decision: { outcome: "repeat", reason: "low-valid-turnout" },
    });
    expect(result.reduce((sum, row) => sum + row.winners.length, 0)).toBe(175);
  });
  it("defers an ineligible winner instead of assigning the next candidate", () => {
    const input = fixture();
    input[0].candidates[0].eligible = false;
    expect(resolve(input)[0]).toMatchObject({
      winners: [],
      vacancies: 2,
      decision: { outcome: "repeat", reason: "ineligible-winner" },
    });
  });
  it("permits a player to win one mandate alongside an NPC", () => {
    const input = fixture();
    input[0].candidates[0].isNpc = false;
    expect(resolve(input)[0].winners.filter((row) => !row.isNpc)).toHaveLength(1);
  });
  it.each([
    "missing",
    "extra",
    "duplicate-election",
    "duplicate-subject",
    "wrong-region",
    "duplicate-candidacy",
    "multiple-player-mandates",
    "unknown-owner",
    "missing-party",
  ])("rejects %s", (reason) => {
    const input = fixture();
    if (reason === "missing") input.pop();
    if (reason === "extra") input.push(input[0]);
    if (reason === "duplicate-election") input[1].id = input[0].id;
    if (reason === "duplicate-subject") input[1].seatId = input[0].seatId;
    if (reason === "wrong-region") input[0].regionId = "CEN";
    if (reason === "duplicate-candidacy") input[1].candidates[0].id = input[0].candidates[0].id;
    if (reason === "multiple-player-mandates") {
      input[0].candidates[0].isNpc = false;
      input[1].candidates[0].isNpc = false;
      input[1].candidates[0].ownerId = input[0].candidates[0].ownerId;
    }
    if (reason === "unknown-owner") input[0].candidates[0].ownerId = "";
    if (reason === "missing-party") input[0].candidates[0].party = "";
    expect(() => resolve(input)).toThrow();
  });
});

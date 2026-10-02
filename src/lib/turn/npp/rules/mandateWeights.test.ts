import { describe, expect, it } from "vitest";
import { aggregateNppMandateWeights as aggregate } from "./mandateWeights";
const row = { ownerId: "npc", countryId: "RU", field: "votes" as const, seatsHeld: 1 };
describe("NPC individual mandate weights", () => {
  it("counts225 constituency offices and75 list mandates as300 votes for one profile", () => {
    expect(
      aggregate("RU", [
        ...Array.from({ length: 225 }, (_, index) => ({
          ...row,
          individualMandateId: `district-${index}`,
        })),
        { ...row, seatsHeld: 75, individualMandateId: "list" },
      ])
        .get("votes")
        ?.get("npc")
    ).toBe(300);
  });
  it("separates country and concurrent chamber scopes", () => {
    const result = aggregate("RU", [
      { ...row, individualMandateId: "district" },
      { ...row, seatsHeld: 75, individualMandateId: "list" },
      { ...row, countryId: "US", seatsHeld: 500 },
      { ...row, field: "otherChamberVotes", seatsHeld: 89 },
    ]);
    expect(result.get("votes")?.get("npc")).toBe(76);
    expect(result.get("otherChamberVotes")?.get("npc")).toBe(89);
  });
  it.each([-1, 1.5, Infinity, NaN])("rejects malformed seat weight %s", (seatsHeld) => {
    expect(() => aggregate("RU", [{ ...row, seatsHeld }])).toThrow();
  });
  it("does not invent a vote for a vacant profile", () => {
    expect(
      aggregate("RU", [{ ...row, seatsHeld: 0 }])
        .get("votes")
        ?.get("npc")
    ).toBe(0);
  });
});

describe("NPC duplicate records", () => {
  it("keeps legacy duplicate records from counting twice", () => {
    expect(aggregate("RU", [row, row]).get("votes")?.get("npc")).toBe(1);
  });
  it("deduplicates the same physical native mandate", () => {
    const mandate = { ...row, individualMandateId: "same" };
    expect(aggregate("RU", [mandate, mandate]).get("votes")?.get("npc")).toBe(1);
  });
});

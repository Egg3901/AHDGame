import { describe, expect, it } from "vitest";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { buildPeaceApplicationPlan } from "./peaceApplication";

const conflict = {
  sideA: { countries: ["US", "UK"] },
  sideB: { countries: ["DD", "RU"] },
  treatyEntries: [{ countryId: "RU", defending: "DD" }],
} as unknown as ConflictDoc;

describe("buildPeaceApplicationPlan", () => {
  it("freezes released allies, their truces, and the winner before rosters change", () => {
    const plan = buildPeaceApplicationPlan(
      {
        fromCountry: "DD",
        toCountry: "US",
        leaver: "DD",
        term: { kind: "indemnity", payer: "DD", amount: 1 },
      },
      conflict,
      50,
      "character"
    );

    expect(plan.leavers).toEqual([
      { countryId: "DD", side: "B" },
      { countryId: "RU", side: "B" },
    ]);
    expect(plan.trucePairs).toEqual([
      { first: "DD", second: "US" },
      { first: "RU", second: "US" },
      { first: "RU", second: "UK" },
    ]);
    expect(plan.resolutionWinner).toBe("A");
  });

  it("deduplicates repeated treaty-entry history before scheduling side effects", () => {
    const plan = buildPeaceApplicationPlan(
      {
        fromCountry: "DD",
        toCountry: "US",
        leaver: "DD",
        term: { kind: "white_peace" },
      },
      {
        ...conflict,
        treatyEntries: [
          { countryId: "RU", defending: "DD" },
          { countryId: "RU", defending: "DD" },
        ],
      } as unknown as ConflictDoc,
      50,
      "character"
    );

    expect(plan.leavers.filter((entry) => entry.countryId === "RU")).toHaveLength(1);
    expect(plan.trucePairs.filter((pair) => pair.first === "RU")).toHaveLength(2);
  });
});

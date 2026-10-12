import { describe, expect, it } from "vitest";
import type { ResetLawProgramDocument } from "@/lib/resetLegislation/program";
import type { ResetDepartmentAccountSnapshot } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { planConvertedLawPrograms } from "./conversionPrograms";
const regional = {
  _id: "old",
  worldId: "w",
  country: "UK",
  scope: "regional",
  regionId: "SCO",
  familyId: "L01",
  annualAgencyAllocation: 101,
  effectiveTurn: 90,
  choice: 3,
} as unknown as ResetLawProgramDocument;
describe("conversion preserves enacted law programs", () => {
  it("conserves allocations and choices across successor regions", () => {
    const result = planConvertedLawPrograms({
      programs: [regional],
      accounts: [],
      regions: [
        { _id: "LOT", population: 1, gdp: 10 },
        { _id: "HIG", population: 2, gdp: 20 },
      ],
      rump: [{ gdp: 270 }],
      countryId: "SCO",
      independent: true,
      scale: 1,
    });
    expect(result.removals).toEqual(["old"]);
    const rows = result.updates.map((row) => row.replaceOne.replacement);
    expect(rows.reduce((sum, row) => sum + row.annualAgencyAllocation, 0)).toBe(101);
    expect(rows.every((row) => row.choice === regional.choice && row.effectiveTurn === 90)).toBe(
      true
    );
  });
  it("moves a GDP share of national funding to the successor's actual department", () => {
    const program = { ...regional, scope: "national" as const };
    const result = planConvertedLawPrograms({
      programs: [program],
      accounts: [
        {
          _id: "SCO:health",
          departmentId: "health",
          familyAnnualDemand: { L01: 1 },
        } as unknown as ResetDepartmentAccountSnapshot,
      ],
      regions: [{ _id: "LOT", population: 1, gdp: 10 }],
      rump: [{ gdp: 90 }],
      countryId: "SCO",
      independent: true,
      scale: 1,
    });
    expect(result.updates.map((row) => row.replaceOne.replacement.annualAgencyAllocation)).toEqual([
      91, 10,
    ]);
    expect(result.updates[1].replaceOne.replacement.fundingAccountId).toBe("SCO:health");
  });
});

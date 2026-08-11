import { describe, expect, it } from "vitest";
import type { CabinetPositionDef } from "@/lib/constants/cabinetMechanics";
import {
  PERPETUAL_YEAR,
  isSeatActive,
  resolveSeatName,
  resolveCabinetRoster,
  resolveDepartment,
} from "./rosterEra";

const perpetual: CabinetPositionDef = {
  id: "chancellor",
  name: "Chancellor of the Exchequer",
  order: 2,
  yearEnabled: PERPETUAL_YEAR,
};

const dhs: CabinetPositionDef = {
  id: "secretary_of_homeland",
  name: "Secretary of Homeland Security",
  order: 15,
  yearEnabled: 2002,
};

const maff: CabinetPositionDef = {
  id: "agriculture_secretary",
  name: "Minister of Agriculture, Fisheries and Food",
  order: 12,
  yearEnabled: PERPETUAL_YEAR,
  yearRetired: 2001,
  succeededBy: "environment_secretary",
  namesByYear: [
    { from: PERPETUAL_YEAR, name: "Minister of Agriculture and Fisheries" },
    { from: 1955, name: "Minister of Agriculture, Fisheries and Food" },
  ],
};

const ddLeader: CabinetPositionDef = {
  id: "generalSecretary",
  name: "General Secretary",
  order: 0,
  isHeadOfGovernment: true,
  yearEnabled: PERPETUAL_YEAR,
  namesByYear: [
    { from: PERPETUAL_YEAR, name: "General Secretary" },
    { from: 1953, name: "First Secretary" },
    { from: 1976, name: "General Secretary" },
  ],
};

describe("isSeatActive", () => {
  it("null year → everything active (legacy passthrough)", () => {
    expect(isSeatActive(dhs, null)).toBe(true);
    expect(isSeatActive(maff, null)).toBe(true);
  });
  it("respects yearEnabled edges (inclusive)", () => {
    expect(isSeatActive(dhs, 2001)).toBe(false);
    expect(isSeatActive(dhs, 2002)).toBe(true);
  });
  it("respects yearRetired edges (exclusive)", () => {
    expect(isSeatActive(maff, 2000)).toBe(true);
    expect(isSeatActive(maff, 2001)).toBe(false);
  });
  it("missing yearEnabled defaults to perpetual", () => {
    const bare = { id: "x", name: "X", order: 0 } as CabinetPositionDef;
    expect(isSeatActive(bare, 1953)).toBe(true);
  });
});

describe("resolveSeatName", () => {
  it("null year or no bands → canonical name", () => {
    expect(resolveSeatName(maff, null)).toBe("Minister of Agriculture, Fisheries and Food");
    expect(resolveSeatName(perpetual, 1953)).toBe("Chancellor of the Exchequer");
  });
  it("picks the last band with from <= year", () => {
    expect(resolveSeatName(maff, 1953)).toBe("Minister of Agriculture and Fisheries");
    expect(resolveSeatName(maff, 1955)).toBe("Minister of Agriculture, Fisheries and Food");
  });
  it("supports round-trip bands (DD First Secretary)", () => {
    expect(resolveSeatName(ddLeader, 1953)).toBe("First Secretary");
    expect(resolveSeatName(ddLeader, 1975)).toBe("First Secretary");
    expect(resolveSeatName(ddLeader, 1976)).toBe("General Secretary");
  });
});

describe("resolveCabinetRoster", () => {
  const roster = [perpetual, dhs, maff];
  it("null year → full roster, canonical names, same order", () => {
    const out = resolveCabinetRoster(roster, null);
    expect(out.map((p) => p.id)).toEqual([
      "chancellor",
      "secretary_of_homeland",
      "agriculture_secretary",
    ]);
    expect(out[2].name).toBe("Minister of Agriculture, Fisheries and Food");
  });
  it("filters inactive and substitutes era names", () => {
    const out = resolveCabinetRoster(roster, 1953);
    expect(out.map((p) => p.id)).toEqual(["chancellor", "agriculture_secretary"]);
    expect(out[1].name).toBe("Minister of Agriculture and Fisheries");
  });
  it("2019: retired seat gone, unlocked seat present", () => {
    const out = resolveCabinetRoster(roster, 2019);
    expect(out.map((p) => p.id)).toEqual(["chancellor", "secretary_of_homeland"]);
  });
});

describe("resolveDepartment", () => {
  const mech = {
    positionId: "secretary_of_health",
    department: "Department of Health and Human Services",
    departmentByYear: [
      { from: 1953, name: "Department of Health, Education, and Welfare" },
      { from: 1980, name: "Department of Health and Human Services" },
    ],
    nationalMetrics: [],
    regionalMetrics: [],
  };
  it("bands resolve; null year → canonical", () => {
    expect(resolveDepartment(mech, 1979)).toBe("Department of Health, Education, and Welfare");
    expect(resolveDepartment(mech, 1980)).toBe("Department of Health and Human Services");
    expect(resolveDepartment(mech, null)).toBe("Department of Health and Human Services");
  });
});

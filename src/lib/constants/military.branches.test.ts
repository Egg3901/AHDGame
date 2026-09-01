import { describe, expect, it } from "vitest";
import {
  MILITARY_BRANCHES_BY_COUNTRY,
  MILITARY_COUNTRY_SCALE,
  DEFENSE_POSITION_BY_COUNTRY,
  getBranches,
  absorbedBranchesOf,
} from "./military";
import { getCabinetPositions } from "./cabinetMechanics";
import { isSeatActive } from "@/lib/cabinet/rosterEra";
import type { CountryId } from "./countries";

const IN_SCOPE = [
  "RU",
  "DD",
  "PL",
  "CS",
  "HU",
  "RO",
  "BG",
  "YU",
  "NG",
  "FR",
  "IT",
  "ES",
  "SE",
  "TR",
  "GR",
  "AT",
  "FI",
  "BR",
] as CountryId[];

/** Countries with a cabinet, so a defense seat can exist (spec §3.1). */
const COMMANDABLE = IN_SCOPE;

/** Scale values that must change from the placeholder 1.0 this task replaces. */
const EXPECTED_SCALE: Partial<Record<string, number>> = {
  NG: 0.85,
  HU: 0.9,
  RO: 0.9,
  YU: 0.95,
  BG: 0.85,
  FR: 1.5,
  IT: 1.2,
  SE: 1.1,
  GR: 0.9,
  AT: 0.85,
  FI: 0.9,
};

describe("military branches for in-scope countries", () => {
  it("gives every in-scope country at least one branch", () => {
    for (const id of IN_SCOPE) {
      expect(MILITARY_BRANCHES_BY_COUNTRY[id]?.length ?? 0, id).toBeGreaterThan(0);
    }
  });

  it("sets the authored cost scales", () => {
    for (const [id, expected] of Object.entries(EXPECTED_SCALE)) {
      expect(MILITARY_COUNTRY_SCALE[id as CountryId], id).toBe(expected);
    }
  });

  it("uses unique branch ids within each country", () => {
    for (const id of IN_SCOPE) {
      const ids = (MILITARY_BRANCHES_BY_COUNTRY[id] ?? []).map((b) => b.id);
      expect(new Set(ids).size, id).toBe(ids.length);
    }
  });

  it("points every defense position at a real cabinet seat", () => {
    for (const id of COMMANDABLE) {
      const positionId = DEFENSE_POSITION_BY_COUNTRY[id];
      expect(positionId, `${id} needs a defense position`).toBeTruthy();
      expect(
        getCabinetPositions(id).map((p) => p.id),
        `${id}:${positionId}`
      ).toContain(positionId);
    }
  });

  it("never leaves an in-scope country with 1953 branches but no active seat", () => {
    // getCabinetPositions does NOT year-filter — isSeatActive is the real gate.
    // Task 2 relaxes the inherited 1956 gate that would otherwise fail this.
    for (const id of COMMANDABLE) {
      if (getBranches(id, 1953).length === 0) continue;
      const positionId = DEFENSE_POSITION_BY_COUNTRY[id]!;
      const seat = getCabinetPositions(id).find((p) => p.id === positionId)!;
      expect(isSeatActive(seat, 1953), `${id} has a 1953 army but no active defence seat`).toBe(
        true
      );
    }
  });

  it("gates DD's NVA to 1956 and retires it with the state in 1990", () => {
    expect(getBranches("DD", 1953)).toHaveLength(0);
    expect(getBranches("DD", 1956).length).toBeGreaterThan(0);
    expect(getBranches("DD", 1990)).toHaveLength(0);
  });

  it("gates Austria's Bundesheer to the 1955 State Treaty", () => {
    expect(getBranches("AT", 1953)).toHaveLength(0);
    expect(getBranches("AT", 1955).length).toBeGreaterThan(0);
  });

  it("retires Czechoslovakia and Yugoslavia when the states dissolve", () => {
    expect(getBranches("CS", 1993)).toHaveLength(0);
    expect(getBranches("YU", 1992)).toHaveLength(0);
  });

  it("gates Nigeria's services to their real stand-up years", () => {
    expect(getBranches("NG", 1953)).toHaveLength(0);
    expect(getBranches("NG", 1960).map((b) => b.id)).toContain("army");
    expect(getBranches("NG", 1964).map((b) => b.id)).toContain("airforce");
  });
});

// Ticket #1248: after a country merge the survivor holds the absorbed side's
// units, whose branchIds its own catalog has never named. The roster UI derives
// tabs from the branch list, so those units need derived branch definitions to
// be visible at all.
describe("absorbedBranchesOf", () => {
  it("derives the absorbed side's branches from live units the catalog does not name", () => {
    const units = [
      { branchId: "heer", domain: "ground" as const },
      { branchId: "landstreitkraefte", domain: "ground" as const },
      { branchId: "volksmarine", domain: "naval" as const },
    ];
    const out = absorbedBranchesOf("DE", units);
    expect(out.map((b) => b.id)).toEqual(["landstreitkraefte", "volksmarine"]);
    // Labels resolve from the absorbed country's own table (DD names LaSK/VM).
    const lask = out.find((b) => b.id === "landstreitkraefte")!;
    expect(lask.name).toBe("Land Forces");
    expect(lask.abbr).toBe("LaSK");
    expect(lask.domain).toBe("ground");
  });

  it("returns nothing for a roster entirely within the country's own catalog", () => {
    expect(absorbedBranchesOf("DE", [{ branchId: "heer", domain: "ground" as const }])).toEqual([]);
    expect(absorbedBranchesOf("DE", [])).toEqual([]);
  });

  it("degrades an unknown branch id to a titled placeholder, not a hidden tab", () => {
    const out = absorbedBranchesOf("DE", [{ branchId: "mystery_corps", domain: "ground" as const }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "mystery_corps", name: "Mystery Corps" });
  });

  it("never lists a branch the country's own catalog already names", () => {
    const out = absorbedBranchesOf(
      "US",
      [{ branchId: "army", domain: "ground" as const }, { branchId: "navy", domain: "naval" as const }]
    );
    expect(out).toEqual([]);
  });
});

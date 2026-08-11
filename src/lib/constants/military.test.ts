import { describe, it, expect } from "vitest";
import {
  getUnitArchetype,
  computeEffectivePower,
  computeEffectiveUpkeep,
  MILITARY_BRANCHES_BY_COUNTRY,
  DEFENSE_POSITION_BY_COUNTRY,
  techPowerMult,
  VETM,
  eqAvg,
} from "./military";

describe("DEFENSE_POSITION_BY_COUNTRY — playable defense seats", () => {
  it("registers a defense seat for every playable nation", () => {
    expect(DEFENSE_POSITION_BY_COUNTRY.US).toBe("secretary_of_defense");
    expect(DEFENSE_POSITION_BY_COUNTRY.UK).toBe("defence_secretary");
    expect(DEFENSE_POSITION_BY_COUNTRY.RU).toBe("minister_of_defence");
    expect(DEFENSE_POSITION_BY_COUNTRY.DD).toBe("minister_of_defence");
  });
});

describe("military config", () => {
  it("defines branches for all six countries", () => {
    for (const id of ["US", "UK", "CN", "DE", "JP", "IE"] as const) {
      expect(MILITARY_BRANCHES_BY_COUNTRY[id].length).toBeGreaterThan(0);
      expect(DEFENSE_POSITION_BY_COUNTRY[id]).toBeTruthy();
    }
  });

  it("computeEffectivePower folds posture, tech, veterancy, and equipment", () => {
    // standard 1.0, tier 1 (0.88), vet 2 (1.08), equipment avg 1 → 1.03
    const p = computeEffectivePower({
      basePower: 100,
      posture: "standard",
      techTier: 1,
      vet: 2,
      equipment: { firepower: 1, protection: 1, support: 1 },
    });
    const expected = Math.round(
      100 *
        1.0 *
        techPowerMult(1) *
        VETM[2] *
        (1 + eqAvg({ firepower: 1, protection: 1, support: 1 }) * 0.03)
    );
    expect(p).toBe(expected);
  });

  it("vet 1 + zero equipment reproduces the legacy base×posture×tech value", () => {
    const p = computeEffectivePower({
      basePower: 100,
      posture: "standard",
      techTier: 1,
      vet: 1,
      equipment: { firepower: 0, protection: 0, support: 0 },
    });
    expect(p).toBe(Math.round(100 * 1.0 * techPowerMult(1))); // VETM[1]=1.0, eqAvg=0
  });

  // A malformed/unmigrated unit missing equipment must degrade to zero, not throw —
  // otherwise one bad unit white-screens the entire force-aggregation path.
  it("eqAvg tolerates missing or partial equipment", () => {
    expect(eqAvg(undefined)).toBe(0);
    expect(eqAvg(null)).toBe(0);
    expect(eqAvg({})).toBe(0);
    expect(eqAvg({ firepower: 3 })).toBe(1); // (3 + 0 + 0) / 3
  });

  it("computeEffectivePower does not throw on a unit missing equipment", () => {
    const p = computeEffectivePower({
      basePower: 100,
      posture: "standard",
      techTier: 1,
      vet: 1,
    } as never);
    expect(p).toBe(Math.round(100 * 1.0 * techPowerMult(1))); // equipment absent → eqAvg 0
  });

  it("computeEffectiveUpkeep applies posture, country scale and tier modifier", () => {
    const base = computeEffectiveUpkeep(
      { upkeepBase: 100, posture: "standard", techTier: 1 },
      "US",
      "standard"
    );
    const elevated = computeEffectiveUpkeep(
      { upkeepBase: 100, posture: "standard", techTier: 1 },
      "US",
      "elevated"
    );
    expect(elevated).toBeGreaterThan(base); // elevated tier raises upkeep
  });

  // A modern unit costs more to run. Without this, tech tier was pure upside: +8%
  // power per step, a political defenseIndustry bump, and no cost anywhere.
  describe("tech tier and upkeep", () => {
    const at = (techTier: 0 | 1 | 2 | 3) =>
      computeEffectiveUpkeep({ upkeepBase: 100, posture: "standard", techTier }, "DE", "standard");

    it("rises with every tech tier", () => {
      expect(at(0)).toBeLessThan(at(1));
      expect(at(1)).toBeLessThan(at(2));
      expect(at(2)).toBeLessThan(at(3));
    });

    it("makes Legacy cheaper to run than Standard, and Cutting-Edge dearest", () => {
      expect(at(0)).toBe(85);
      expect(at(1)).toBe(100);
      expect(at(2)).toBe(120);
      expect(at(3)).toBe(145);
    });

    // The whole point of the change: upkeep must outrun the power it buys, or
    // modernizing is still the obviously correct move in every situation.
    it("costs more than the power it buys, Legacy → Cutting-Edge", () => {
      const upkeepRatio = at(3) / at(0);
      const powerRatio = techPowerMult(3) / techPowerMult(0);
      expect(upkeepRatio).toBeGreaterThan(powerRatio);
    });

    it("treats a malformed tier as Standard rather than making the unit free", () => {
      const bad = computeEffectiveUpkeep(
        { upkeepBase: 100, posture: "standard", techTier: 99 as never },
        "DE",
        "standard"
      );
      expect(bad).toBe(100);
    });
  });

  it("getUnitArchetype resolves a known ground type", () => {
    expect(getUnitArchetype("ground", "Infantry Division")).toBeTruthy();
    expect(getUnitArchetype("ground", "Nope")).toBeUndefined();
  });
});

describe("computeEffectivePower — strength scaling", () => {
  // techTier/vet are literal unions on MilitaryUnit — an extracted fixture widens them
  // to `number` without `as const` (inline literals get narrowed contextually instead).
  const full = {
    basePower: 100,
    posture: "standard" as const,
    techTier: 1 as const,
    vet: 1 as const,
    equipment: { firepower: 0, protection: 0, support: 0 },
    domain: "ground" as const,
    type: "Infantry Division", // archetype establishment: 12000
  };

  it("is unchanged at full strength (peacetime balance must not move)", () => {
    const atEstablishment = computeEffectivePower({ ...full, personnel: 12000 });
    const noPersonnelField = computeEffectivePower(full);
    expect(atEstablishment).toBe(noPersonnelField);
    expect(atEstablishment).toBe(Math.round(100 * 1.0 * techPowerMult(1)));
  });

  it("scales linearly with personnel", () => {
    const fullP = computeEffectivePower({ ...full, personnel: 12000 });
    expect(computeEffectivePower({ ...full, personnel: 6000 })).toBe(Math.round(fullP * 0.5));
    expect(computeEffectivePower({ ...full, personnel: 0 })).toBe(0);
  });

  it("never exceeds full strength when over establishment", () => {
    const fullP = computeEffectivePower({ ...full, personnel: 12000 });
    expect(computeEffectivePower({ ...full, personnel: 99999 })).toBe(fullP);
  });

  it("falls back to full strength for an unknown archetype (never zero)", () => {
    const p = computeEffectivePower({ ...full, type: "Not A Real Unit", personnel: 5 });
    expect(p).toBe(Math.round(100 * 1.0 * techPowerMult(1)));
  });
});

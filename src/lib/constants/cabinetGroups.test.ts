import { describe, it, expect } from "vitest";
import { getCabinetPositions, getCabinetPositionGroup } from "./cabinetMechanics";

const COUNTRIES = ["US", "UK", "CN", "DE", "JP", "IE", "NG"] as const;
const VALID = new Set([
  "Centre",
  "Economy",
  "Security & Foreign",
  "Society",
  "Domestic",
  "Nations",
]);

describe("cabinet position groups", () => {
  it("assigns every position an explicit, valid group in every country", () => {
    for (const c of COUNTRIES) {
      const positions = getCabinetPositions(c);
      expect(positions.length).toBeGreaterThan(0);
      for (const p of positions) {
        expect(VALID.has(getCabinetPositionGroup(c, p.id))).toBe(true);
      }
    }
  });

  it("maps representative seats to their portfolio group", () => {
    expect(getCabinetPositionGroup("US", "secretary_of_treasury")).toBe("Economy");
    expect(getCabinetPositionGroup("US", "secretary_of_defense")).toBe("Security & Foreign");
    expect(getCabinetPositionGroup("US", "secretary_of_health")).toBe("Society");
    expect(getCabinetPositionGroup("US", "secretary_of_energy")).toBe("Domestic");
    expect(getCabinetPositionGroup("UK", "northern_ireland")).toBe("Nations");
    expect(getCabinetPositionGroup("IE", "taoiseach")).toBe("Centre");
    expect(getCabinetPositionGroup("CN", "premier")).toBe("Centre");
    expect(getCabinetPositionGroup("DE", "environment_minister")).toBe("Domestic");
  });
});

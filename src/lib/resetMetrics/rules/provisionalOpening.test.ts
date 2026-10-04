import { describe, expect, it } from "vitest";
import {
  opening1991Anchors,
  provisionalRegionalOpening,
  type ProvisionalRegionInput,
} from "./provisionalOpening";

const seed: ProvisionalRegionInput = {
  regionId: "one",
  population: 100,
  medianIncome: 20_000,
  costOfLiving: 100,
  rdIntensity: 2,
  workforceSkill: 70,
  universityEnrollment: 50,
  uninsuredRate: 15,
  physicianRate: 2,
  publicHealthPreparedness: 70,
  lifeExpectancy: 76,
  housingAffordability: 10,
  publicTrust: 50,
  populationGrowth: 0.4,
};

describe("provisional 1991 regional openings", () => {
  it("labels every provisional metric and never invents national energy security", () => {
    const values = provisionalRegionalOpening("US", [seed]).get("one")!;
    expect(Object.keys(values).sort()).toEqual(["02", "15", "16", "18", "20", "24", "49", "54"]);
    for (const observation of Object.values(values)) {
      expect(observation.status).toBe("proxy");
      expect(observation.source).toContain("provisional 1991 game estimate");
      expect(observation.note).toContain("Opening estimate only");
    }
    expect(values["20"].value).toBe(opening1991Anchors.US.lifeYears);
    expect(values["54"].value).toBe(opening1991Anchors.US.growthPercent);
    expect(values["16"].value).toBe(85);
    expect(values["02"].value).toBe(20_000);
    expect(values["58"]).toBeUndefined();
  });

  it("does not silently turn missing inputs into zero or a plausible value", () => {
    const values = provisionalRegionalOpening("JP", [
      { ...seed, physicianRate: null, medianIncome: null, housingAffordability: null },
    ]).get("one")!;
    for (const id of ["02", "16", "18", "24"]) {
      expect(values[id]).toMatchObject({ status: "unavailable", value: null });
    }
    expect(values["20"].value).toBe(opening1991Anchors.JP.lifeYears);
  });

  it("uses national entitlement in UK/JP without treating their uniform v1 uninsured field as history", () => {
    const uk = provisionalRegionalOpening("UK", [{ ...seed, uninsuredRate: null }]).get("one")!;
    const jp = provisionalRegionalOpening("JP", [{ ...seed, uninsuredRate: null }]).get("one")!;
    expect(uk["16"].value).toBe(94);
    expect(jp["16"].value).toBe(94);
  });

  it("rejects duplicate region IDs rather than silently dropping one seed", () => {
    expect(() => provisionalRegionalOpening("US", [seed, { ...seed, population: 200 }])).toThrow(
      "duplicate region"
    );
  });
});

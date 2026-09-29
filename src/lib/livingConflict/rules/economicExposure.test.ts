import { describe, expect, it } from "vitest";
import { normalizeConflictState } from "../engine";
import { YUGOSLAVIA_DEF } from "../defs/yugoslavia";
import {
  crisisEconomicExposure,
  crisisParticipationMultiplier,
  crisisPotentialGrowthPenalty,
  type CrisisEconomicExposure,
} from "./economicExposure";

const region = { _id: "YU_BIH", countryId: "YU" };
const conflict = normalizeConflictState(YUGOSLAVIA_DEF, {
  defKey: YUGOSLAVIA_DEF.key,
  hasOpened: true,
  tracks: { displacement: 100, infrastructureDamage: 100, reconstruction: 0 },
});

describe("living crisis economic exposure", () => {
  it("bounds prolonged damage and displacement, and recovers after relief", () => {
    let exposure: CrisisEconomicExposure | undefined;
    for (let turn = 1; turn <= 480; turn++)
      exposure = crisisEconomicExposure(conflict, region, exposure, turn);
    expect(exposure?.displacedShare).toBeCloseTo(0.1);
    expect(crisisParticipationMultiplier(exposure!)).toBeCloseTo(0.9);
    expect(crisisPotentialGrowthPenalty(exposure!)).toBe(2);
    const recovered = {
      ...conflict,
      tracks: { ...conflict.tracks, displacement: 0, reconstruction: 100 },
    };
    for (let turn = 481; turn <= 720; turn++)
      exposure = crisisEconomicExposure(recovered, region, exposure, turn);
    expect(crisisParticipationMultiplier(exposure!)).toBe(1);
    expect(crisisPotentialGrowthPenalty(exposure!)).toBe(0);
  });

  it("does not apply local combat damage to external backers and limits host strain", () => {
    const us = crisisEconomicExposure(conflict, { _id: "CA", countryId: "US" }, undefined, 1);
    const at = crisisEconomicExposure(conflict, { _id: "AT_WIE", countryId: "AT" }, undefined, 1);
    expect(crisisParticipationMultiplier(us)).toBe(1);
    expect(crisisPotentialGrowthPenalty(at)).toBe(0);
    expect(at.displacedShare).toBe(0);
    expect(at.hostingShare).toBeGreaterThan(0);
  });

  it("keeps same-turn replay stable and never invents population transfers", () => {
    const exposure = crisisEconomicExposure(conflict, region, undefined, 5);
    expect(crisisEconomicExposure(conflict, region, exposure, 5)).toEqual(exposure);
    expect(exposure.displacedShare).toBe(0.0005);
    const ceased = crisisEconomicExposure(null, region, exposure, 6);
    expect(ceased.displacedShare).toBe(0);
  });
});

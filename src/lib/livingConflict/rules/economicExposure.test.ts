import { describe, expect, it } from "vitest";
import { normalizeConflictState } from "../engine";
import { YUGOSLAVIA_DEF } from "../defs/yugoslavia";
import { RUSSIA_UKRAINE_DEF } from "../defs/russiaUkraine";
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
  it("charges the potential-growth proxy only for damage not already destroyed as capital", () => {
    const run = (realized?: number) => {
      const state = normalizeConflictState(YUGOSLAVIA_DEF, {
        defKey: YUGOSLAVIA_DEF.key,
        hasOpened: true,
        tracks: { displacement: 0, infrastructureDamage: 40, reconstruction: 0 },
        ...(realized !== undefined ? { realizedInfrastructureDamage: realized } : {}),
      });
      let exposure: CrisisEconomicExposure | undefined;
      for (let turn = 1; turn <= 240; turn++)
        exposure = crisisEconomicExposure(state, region, exposure, turn);
      return exposure!.infrastructureDamage;
    };
    expect(run()).toBeCloseTo(0.4);
    expect(run(40)).toBeCloseTo(0);
    expect(run(10)).toBeCloseTo(0.3);
  });
  it("does not assume Yugoslav reception by fixed host country", () => {
    const host = crisisEconomicExposure(conflict, { _id: "AT", countryId: "AT" }, undefined, 8);
    expect(host.hostingShare).toBe(0);
    expect(crisisParticipationMultiplier(host)).toBe(1);
  });
  it("keeps Ukraine damage and host strain after a ceasefire, with bounded overlapping exposure", () => {
    const war = normalizeConflictState(RUSSIA_UKRAINE_DEF, {
      defKey: RUSSIA_UKRAINE_DEF.key,
      hasOpened: true,
      status: "ceasefire",
      tracks: { displacement: 100, infrastructureDamage: 100, reconstruction: 0 },
    });
    let local: CrisisEconomicExposure | undefined;
    let host: CrisisEconomicExposure | undefined;
    for (let turn = 1; turn <= 240; turn++) {
      local = crisisEconomicExposure(
        [conflict, war],
        { _id: "UKR", countryId: "UKR" },
        local,
        turn
      );
      host = crisisEconomicExposure(
        [conflict, war],
        { _id: "PL_MAZ", countryId: "PL" },
        host,
        turn
      );
    }
    expect(local?.displacedShare).toBeCloseTo(0.1);
    expect(local?.infrastructureDamage).toBe(1);
    expect(host?.hostingShare).toBeCloseTo(0.005);
    expect(host?.infrastructureDamage).toBe(0);
    const unaffected = crisisEconomicExposure(
      [conflict, war],
      { _id: "CA", countryId: "US" },
      undefined,
      240
    );
    expect(crisisParticipationMultiplier(unaffected)).toBe(1);
    const recovered = {
      ...war,
      tracks: { displacement: 0, infrastructureDamage: 100, reconstruction: 100 },
    };
    for (let turn = 241; turn <= 480; turn++)
      local = crisisEconomicExposure(
        [conflict, recovered],
        { _id: "UKR", countryId: "UKR" },
        local,
        turn
      );
    expect(crisisParticipationMultiplier(local!)).toBe(1);
    expect(crisisPotentialGrowthPenalty(local!)).toBe(0);
  });

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
    expect(at.hostingShare).toBe(0);
  });

  it("keeps same-turn replay stable and never invents population transfers", () => {
    const exposure = crisisEconomicExposure(conflict, region, undefined, 5);
    expect(crisisEconomicExposure(conflict, region, exposure, 5)).toEqual(exposure);
    expect(exposure.displacedShare).toBe(0.0005);
    const ceased = crisisEconomicExposure(null, region, exposure, 6);
    expect(ceased.displacedShare).toBe(0);
  });
});

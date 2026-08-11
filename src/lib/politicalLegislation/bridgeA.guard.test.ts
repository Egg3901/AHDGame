/**
 * Bridge A structural guard.
 *
 * Every legacy path the demographic/TFP engines consume must be resolvable end
 * to end: ADAPTER_TIER1 maps it to a family, and LEGACY_UNIT_BANDS converts
 * that family's score into the real unit the engine expects. A path that loses
 * either half silently reverts to a neutral constant — which is exactly the
 * failure this bridge exists to remove, and it would be invisible at runtime.
 */
import { describe, expect, it } from "vitest";
import { ADAPTER_TIER1 } from "./marginAdapter";
import { LEGACY_UNIT_BANDS, legacyUnitFromPoliticalScore } from "./legacyUnitBands";

const BRIDGED_PATHS = [
  "healthcare.lifeExpectancy",
  "healthcare.preventableMortality",
  "education.workforceSkill",
  "infrastructure.transportEfficiency",
  "infrastructure.broadbandAccess",
  "infrastructure.powerGridReliability",
] as const;

describe("Bridge A end-to-end resolution", () => {
  it("every bridged path has both a family mapping and a unit band", () => {
    for (const path of BRIDGED_PATHS) {
      expect(ADAPTER_TIER1[path], `${path} lost its ADAPTER_TIER1 family`).toBeDefined();
      expect(LEGACY_UNIT_BANDS[path], `${path} lost its unit band`).toBeDefined();
      expect(legacyUnitFromPoliticalScore(path, 72), path).toBeTypeOf("number");
    }
  });

  it("every bridged path is monotonic in the political score", () => {
    for (const path of BRIDGED_PATHS) {
      const low = legacyUnitFromPoliticalScore(path, 10)!;
      const high = legacyUnitFromPoliticalScore(path, 90)!;
      expect(low, path).not.toBe(high);
    }
  });
});

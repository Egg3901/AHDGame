import { describe, expect, it } from "vitest";
import { getCabinetMechanics } from "./cabinetMechanics";

/**
 * HEW carries education + welfare policy levers on top of its healthcare tier
 * (ticket #1070). These guard against typos in the extra-tier config: every
 * tier needs a stable `key`, a valid defaultTier, and effect keys shaped like
 * `category.metricId`.
 */
describe("HEW extra portfolios (secretary_of_health)", () => {
  const mechanics = getCabinetMechanics("US", "secretary_of_health");

  it("exists and keeps its primary healthcare tier", () => {
    expect(mechanics).toBeTruthy();
    expect(mechanics?.tierSetting?.name).toBe("Healthcare Model");
  });

  it("carries education + welfare tiers, each keyed and well-formed", () => {
    const tiers = mechanics?.tierSettings ?? [];
    const keys = tiers.map((t) => t.key);
    expect(keys).toContain("education");
    expect(keys).toContain("welfare");

    for (const tier of tiers) {
      expect(tier.key, "extra tier must have a stable key").toBeTruthy();
      const optionIds = tier.options.map((o) => o.id);
      expect(optionIds).toContain(tier.defaultTier);
      for (const option of tier.options) {
        for (const metric of Object.keys(option.effects)) {
          expect(metric, `effect key '${metric}' must be category.metricId`).toMatch(
            /^[a-zA-Z]+\.[a-zA-Z]+$/
          );
        }
      }
    }
  });
});

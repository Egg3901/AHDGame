import { describe, expect, it } from "vitest";
import { getUkModel } from "@/lib/countries/uk/layer1Model";
import { computeDerivedCompositionGeneric, editorConfigFromCountryModel } from "./derive";

describe("regional position editor bounds", () => {
  it.each([
    { decimals: 1, direction: 1 },
    { decimals: 1, direction: -1 },
    { decimals: 2, direction: 1 },
    { decimals: 2, direction: -1 },
  ] as const)(
    "clamps regional offsets with $decimals decimal precision and direction $direction",
    ({ decimals, direction }) => {
      const model = {
        ...getUkModel("1991"),
        regionLeanDecimals: decimals,
        regionalContext: {
          LON: { economicLean: 20 * direction, socialLean: -20 * direction },
        },
      };
      const config = editorConfigFromCountryModel(model, "LON", "1991", {});
      for (const entries of Object.values(config.layer1)) {
        for (const entry of Object.values(entries)) {
          expect(entry.economicLean * direction).toBeGreaterThan(5);
          expect(entry.socialLean * direction).toBeLessThan(-5);
        }
      }

      const derived = computeDerivedCompositionGeneric(config);
      expect(derived.stateEconomicLean).toBe(5 * direction);
      expect(derived.stateSocialLean).toBe(-5 * direction);
      for (const archetype of derived.archetypes) {
        expect(archetype.economicLean).toBe(5 * direction);
        expect(archetype.socialLean).toBe(-5 * direction);
      }
    }
  );
});

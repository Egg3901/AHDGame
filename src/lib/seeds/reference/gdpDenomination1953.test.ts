import { describe, expect, it } from "vitest";
import { NATIONAL_BUDGET_SEED_CONFIGS_1953 } from "./budgets";
import { GDP_DENOMINATION_1953 } from "./gdpDenomination";

describe("GDP_DENOMINATION_1953 — machine-readable denomination marker", () => {
  it("covers every country in the 1953 budget configs", () => {
    const configCountryIds = new Set<string>(
      NATIONAL_BUDGET_SEED_CONFIGS_1953.map((c) => c.countryId)
    );
    const markerCountryIds = new Set(Object.keys(GDP_DENOMINATION_1953));
    for (const id of configCountryIds) {
      expect(markerCountryIds.has(id), `${id} missing from GDP_DENOMINATION_1953`).toBe(true);
    }
  });

  it("has no extra entries beyond the 1953 budget configs", () => {
    const configCountryIds = new Set<string>(
      NATIONAL_BUDGET_SEED_CONFIGS_1953.map((c) => c.countryId)
    );
    for (const id of Object.keys(GDP_DENOMINATION_1953)) {
      expect(
        configCountryIds.has(id),
        `${id} in GDP_DENOMINATION_1953 but not in 1953 configs`
      ).toBe(true);
    }
  });

  it("pins the denomination of every 1953 country — change triggers marker update", () => {
    // If this test fails, a country's GDP denomination changed. Update
    // GDP_DENOMINATION_1953 in gdpDenomination.ts to match. Do NOT add a new
    // USD-anchored country without updating both the marker and this test.
    expect(GDP_DENOMINATION_1953).toStrictEqual({
      US: "local",
      UK: "local",
      UKR: "local",
      RU: "local",
      FR: "local",
      IT: "usd",
      ES: "local",
      SE: "local",
      TR: "local",
      GR: "local",
      AT: "local",
      FI: "local",
      DE: "local",
      JP: "usd",
      CN: "usd",
      BR: "local",
      IE: "local",
      NG: "usd",
      DD: "local",
      HU: "local",
      PL: "local",
      RO: "local",
      YU: "local",
      BG: "local",
      BLR: "local",
      CS: "local",
      BAL: "local",
    });
  });
});

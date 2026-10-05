import { describe, expect, it } from "vitest";
import {
  FOREX_ACTIVE_CURRENCIES,
  ZOD_ACTIVE_CURRENCY_ENUM,
  getInitialRates,
  getSeedCurrencyCode,
} from "./currencies";
import { getPresetMonetaryScope } from "@/lib/monetaryPolicy/presetMonetaryScope";

describe("1991 native forex opening", () => {
  it("makes every era-present monetary country tradable, including transition currencies", () => {
    for (const country of getPresetMonetaryScope("1991-default").forexCountries) {
      const code = getSeedCurrencyCode(country, "1991-default");
      expect(FOREX_ACTIVE_CURRENCIES, country).toContain(code);
      expect(ZOD_ACTIVE_CURRENCY_ENUM, country).toContain(code);
      expect(getInitialRates("1991-default")[country], country).toBeGreaterThan(0);
    }
  });
  it("uses the 1991 WDI native annual quotes, restoring pre-2005 Turkish lira", () => {
    expect(getInitialRates("1991-default")).toMatchObject({
      IE: 0.6212975,
      FR: 5.64211666666667,
      IT: 1240.61333333333,
      ES: 103.911583333333,
      SE: 6.04746666666666,
      TR: 4171.81583333333,
      GR: 182.266416666667,
      AT: 11.6759166666667,
      FI: 4.04397916666667,
    });
    expect(getInitialRates("1979-default").TR).toBeLessThan(100);
  });
});

/** Native GDP seeds retain their authored units before and after Soviet succession. */
import { describe, expect, it } from "vitest";
import { getCountryConfigForRuntime } from "@/lib/constants/countries";
import { INITIAL_RATES_1991 } from "@/lib/constants/currencies";
import { ngRegions1991 } from "@/lib/countries/ng/data/ngRegions1991";
import { NG_1991_NOMINAL_GDP_NGN } from "@/lib/countries/ng/data/ngGdp1991";
import { ruRegions1991 } from "@/lib/countries/ru/data/ruRegions1991";
import {
  sovietUnionRegions1991,
  SOVIET_UNION_1991_GDP_MILLION_RUB,
} from "@/lib/countries/ru/data/sovietUnionRegions1991";
import { gdpToAnchor } from "./gdpAnchorRate";

describe("1991 Soviet and Nigerian GDP basis", () => {
  it("conserves observed Nigerian nominal output and existing regional relative weights", () => {
    const total = ngRegions1991.reduce((sum, row) => sum + row.gdp, 0);
    expect(total * 1_000_000).toBeCloseTo(NG_1991_NOMINAL_GDP_NGN, 2);
    const weights = [35, 22, 28, 72, 58, 26];
    ngRegions1991.forEach((row, i) => expect(row.gdp / total).toBeCloseTo(weights[i] / 241, 10));
    expect(gdpToAnchor(total, "NG", "1991-default")).toBeCloseTo(total / 9.9, 7);
  });
  it("preserves Nigerian population and parliamentary allocation", () => {
    expect(ngRegions1991.reduce((sum, row) => sum + row.population, 0)).toBe(88_992_220);
    expect(ngRegions1991.reduce((sum, row) => sum + row.houseDistricts, 0)).toBe(360);
    expect(ngRegions1991.reduce((sum, row) => sum + (row.stateSenateSeats ?? 0), 0)).toBe(109);
  });
  it("uses original rubles for both the federal opening and retained Russian regions", () => {
    expect(gdpToAnchor(SOVIET_UNION_1991_GDP_MILLION_RUB, "RU", "1991-default")).toBeCloseTo(
      SOVIET_UNION_1991_GDP_MILLION_RUB / INITIAL_RATES_1991.RU!,
      7
    );
    for (const row of ruRegions1991) {
      expect(sovietUnionRegions1991.find((region) => region._id === row._id)?.gdp).toBe(row.gdp);
    }
  });
  it.each([
    {},
    { ruSovietSuccessionSinceTurn: 12 },
    { ruPresidencySinceTurn: 12 },
    { ruCongressDissolvedSinceTurn: 12 },
    { ruFederalAssemblySinceTurn: 12 },
  ])("preserves the ruble GDP conversion across institutional markers %j", (state) => {
    expect(getCountryConfigForRuntime("RU", "1991-default", state).usdExchangeRate).toBeCloseTo(
      1 / INITIAL_RATES_1991.RU!,
      10
    );
  });
});

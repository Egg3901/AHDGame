import { describe, expect, it } from "vitest";
import { getSeedCurrencyCode, INITIAL_RATES_1991 } from "@/lib/constants/currencies";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "@/lib/seeds/reference/successorGdp1991";
import { getGdpAnchorRate, gdpToAnchor } from "./gdpAnchorRate";
import { plRegions1991 } from "@/lib/countries/pl/data/plRegions1991";
import { huRegions1991 } from "@/lib/countries/hu/data/huRegions1991";
import { csRegions1991 } from "@/lib/countries/cs/data/csRegions1991";
import { roRegions1991 } from "@/lib/countries/ro/data/roRegions1991";
import { bgRegions1991 } from "@/lib/countries/bg/data/bgRegions1991";
import { yuRegions1991 } from "@/lib/countries/yu/data/yuRegions1991";
const regions = {
  PL: plRegions1991,
  HU: huRegions1991,
  CS: csRegions1991,
  RO: roRegions1991,
  BG: bgRegions1991,
  YU: yuRegions1991,
};
type Country = keyof typeof regions;
describe("1991 successor GDP seed denominations", () => {
  it.each(Object.keys(regions) as Country[])(
    "%s values the authored original currency at its opening parity",
    (country) => {
      const localMillions = regions[country].reduce((sum, row) => sum + row.gdp, 0);
      expect(localMillions).toBeCloseTo(SUCCESSOR_NOMINAL_GDP_1991[country] / 1_000_000, 3);
      const expectedAnchorMillions = localMillions / INITIAL_RATES_1991[country]!;
      const anchored = gdpToAnchor(localMillions, country, "1991-default");
      process.stdout.write(
        JSON.stringify({
          country,
          localMillions,
          anchorRate: getGdpAnchorRate(country, "1991-default"),
          anchorMillions: anchored,
          expectedAnchorMillions,
        }) + "\n"
      );
      expect(anchored).toBeCloseTo(expectedAnchorMillions, 5);
      expect(getSeedCurrencyCode(country, "1991-default")).toBe(
        { PL: "PLZ", HU: "HUF", CS: "CSK", RO: "ROL", BG: "BGL", YU: "YUD" }[country]
      );
    }
  );
});

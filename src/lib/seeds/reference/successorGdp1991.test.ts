import { describe, expect, it } from "vitest";
import { PL_1991_NOMINAL_GDP_OLD_PLZ } from "@/lib/countries/pl/data/plFiscal1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "./successorGdp1991";
import { SUCCESSOR_REGION_POPULATION_1991 } from "./successorPopulation1991";

describe("January 1991 successor national GDP anchors", () => {
  it("covers exactly the successor countries with census geography", () => {
    expect(Object.keys(SUCCESSOR_NOMINAL_GDP_1991).sort()).toEqual(
      Object.keys(SUCCESSOR_REGION_POPULATION_1991).sort()
    );
  });

  it("keeps Poland's pre-redenomination złoty GDP aligned with its budget source", () => {
    expect(SUCCESSOR_NOMINAL_GDP_1991.PL).toBe(PL_1991_NOMINAL_GDP_OLD_PLZ);
  });

  it("restores the Slovak euro-restated series before adding it to Czech koruna GDP", () => {
    expect(SUCCESSOR_NOMINAL_GDP_1991.CS).toBe(1_238_776_053_758);
  });

  it("uses positive, finite nominal values", () => {
    for (const gdp of Object.values(SUCCESSOR_NOMINAL_GDP_1991)) {
      expect(Number.isFinite(gdp)).toBe(true);
      expect(gdp).toBeGreaterThan(0);
    }
  });
});

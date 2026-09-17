import { describe, expect, it } from "vitest";
import { UK_REGION_POLLING_2024 } from "./ukRegionPolling2024";
import { UK_REGION_POLLING_2020 } from "./ukRegionPolling2020";

const REGIONS = [
  "LON",
  "SEE",
  "SWE",
  "EAE",
  "EMI",
  "WMI",
  "YHU",
  "NWE",
  "NEE",
  "SCO",
  "WAL",
  "NIR",
];

describe("UK_REGION_POLLING_2024", () => {
  it("covers the same 12 regions as the 2020 table", () => {
    expect(new Set(Object.keys(UK_REGION_POLLING_2024))).toEqual(new Set(REGIONS));
    expect(new Set(Object.keys(UK_REGION_POLLING_2024))).toEqual(
      new Set(Object.keys(UK_REGION_POLLING_2020))
    );
  });

  it("carries the same party slugs as the 2020 table (plus uup in NIR)", () => {
    for (const id of REGIONS) {
      const keys2020 = new Set(Object.keys(UK_REGION_POLLING_2020[id]));
      for (const slug of keys2020) {
        expect(UK_REGION_POLLING_2024[id], `${id} has ${slug}`).toHaveProperty(slug);
      }
    }
    expect(UK_REGION_POLLING_2024.NIR).toHaveProperty("uk_uup", 12);
  });

  it("matches the 2024 general election outcome in the anchor regions", () => {
    // London: Labour landslide on 43.0%.
    expect(UK_REGION_POLLING_2024.LON.uk_labour).toBe(43);
    // North East: Reform level with the Conservatives at ~20%.
    expect(UK_REGION_POLLING_2024.NEE.uk_reform).toBe(20);
    expect(UK_REGION_POLLING_2024.NEE.uk_conservative).toBe(20);
    // Scotland: SNP down to 30, Labour ahead on 35.
    expect(UK_REGION_POLLING_2024.SCO.uk_snp).toBe(30);
    expect(UK_REGION_POLLING_2024.SCO.uk_labour).toBe(35);
    // Wales: Plaid at 15 on 14.8% actual.
    expect(UK_REGION_POLLING_2024.WAL.uk_plaid).toBe(15);
    // Northern Ireland: SF 27 first past DUP 22.
    expect(UK_REGION_POLLING_2024.NIR.uk_sf).toBe(27);
    expect(UK_REGION_POLLING_2024.NIR.uk_dup).toBe(22);
  });

  it("Reform is a real presence everywhere in GB and absent in NI", () => {
    for (const id of REGIONS) {
      if (id === "NIR" || id === "SCO") continue;
      expect(UK_REGION_POLLING_2024[id].uk_reform, `${id} reform`).toBeGreaterThanOrEqual(9);
    }
    expect(UK_REGION_POLLING_2024.NIR.uk_reform).toBe(0);
    expect(UK_REGION_POLLING_2024.SCO.uk_reform).toBe(7);
  });

  it("regional parties poll 0 outside their home nations", () => {
    for (const id of REGIONS) {
      if (id !== "SCO") expect(UK_REGION_POLLING_2024[id].uk_snp).toBe(0);
      if (id !== "WAL") expect(UK_REGION_POLLING_2024[id].uk_plaid).toBe(0);
      if (id !== "NIR") {
        expect(UK_REGION_POLLING_2024[id].uk_dup).toBe(0);
        expect(UK_REGION_POLLING_2024[id].uk_sf).toBe(0);
      }
    }
  });
});

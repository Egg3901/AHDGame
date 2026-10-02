import { describe, expect, it } from "vitest";
import { ruRegions1991 } from "./ruRegions1991";
import {
  SOVIET_UNION_1991_GDP_MILLION_RUB,
  SOVIET_UNION_1991_POPULATION,
  sovietUnionRegions1991,
} from "./sovietUnionRegions1991";

describe("1991 Soviet federal regions", () => {
  it("adds all fourteen non-Russian republics exactly once to the RSFSR", () => {
    expect(sovietUnionRegions1991).toHaveLength(24);
    expect(new Set(sovietUnionRegions1991.map((region) => region._id)).size).toBe(24);
    expect(sovietUnionRegions1991.filter((region) => region._id.startsWith("SU_"))).toHaveLength(
      14
    );
    expect(sovietUnionRegions1991.map((region) => region._id)).toContain("SU_UKR");
    expect(sovietUnionRegions1991.map((region) => region._id)).toContain("SU_EE");
    expect(sovietUnionRegions1991.every((region) => region.countryId === "RU")).toBe(true);
    expect(ruRegions1991).toHaveLength(10);
  });

  it("conserves the source population, output proxy and represented Congress seats", () => {
    expect(SOVIET_UNION_1991_POPULATION).toBe(288_747_000);
    expect(SOVIET_UNION_1991_GDP_MILLION_RUB).toBeCloseTo((1_398_500 * 10_000) / 6_110);
    expect(sovietUnionRegions1991.reduce((sum, region) => sum + region.houseDistricts, 0)).toBe(
      2_250
    );
    expect(sovietUnionRegions1991.every((region) => region.houseDistricts > 0)).toBe(true);
  });
});

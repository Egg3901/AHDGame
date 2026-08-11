import { describe, it, expect } from "vitest";
import { scoRegions } from "./scoRegions";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";

const ukSco = ukRegions.find((r) => r._id === "SCO")!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("scoRegions seed (latent — not inserted in SP1)", () => {
  it("has 7 sub-regions, all countryId SCO, regionType region", () => {
    expect(scoRegions).toHaveLength(7);
    expect(scoRegions.every((r) => r.countryId === "SCO")).toBe(true);
    expect(scoRegions.every((r) => r.regionType === "region")).toBe(true);
  });
  it("conserves the UK Scotland nation-region's population and GDP", () => {
    expect(sum(scoRegions.map((r) => r.population))).toBe(ukSco.population); // 5_440_000
    expect(sum(scoRegions.map((r) => r.gdp))).toBe(ukSco.gdp); // 163_000
  });
  it("apportions houseDistricts to the Holyrood size and zeroes the upper chamber", () => {
    expect(sum(scoRegions.map((r) => r.houseDistricts))).toBe(ukSco.stateSenateSeats); // 129
    expect(sum(scoRegions.map((r) => r.stateSenateSeats))).toBe(0);
  });
  it("uses unique 3-letter ids with no duplicates", () => {
    const ids = scoRegions.map((r) => r._id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[A-Z]{3}$/.test(id))).toBe(true);
  });
});

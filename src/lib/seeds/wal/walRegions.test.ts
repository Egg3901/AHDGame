import { describe, it, expect } from "vitest";
import { walRegions } from "./walRegions";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";

const ukWal = ukRegions.find((r) => r._id === "WAL")!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("walRegions seed (latent — not inserted in SP1)", () => {
  it("has 6 sub-regions, all countryId WAL, regionType region", () => {
    expect(walRegions).toHaveLength(6);
    expect(walRegions.every((r) => r.countryId === "WAL")).toBe(true);
    expect(walRegions.every((r) => r.regionType === "region")).toBe(true);
  });
  it("conserves the UK Wales nation-region's population and GDP", () => {
    expect(sum(walRegions.map((r) => r.population))).toBe(ukWal.population); // 3_170_000
    expect(sum(walRegions.map((r) => r.gdp))).toBe(ukWal.gdp); // 74_000
  });
  it("apportions houseDistricts to the Senedd size and zeroes the upper chamber", () => {
    expect(sum(walRegions.map((r) => r.houseDistricts))).toBe(ukWal.stateSenateSeats); // 60
    expect(sum(walRegions.map((r) => r.stateSenateSeats))).toBe(0);
  });
  it("uses unique 3-letter ids with no duplicates", () => {
    const ids = walRegions.map((r) => r._id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[A-Z]{3}$/.test(id))).toBe(true);
  });
});

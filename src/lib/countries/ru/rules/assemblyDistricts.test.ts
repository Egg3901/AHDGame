import { describe, expect, it } from "vitest";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "../data/ruPopulation1991";
import { planRussianDumaDistricts as plan } from "./assemblyDistricts";

const register = Object.fromEntries(
  Object.entries(RU_1991_ECONOMIC_REGION_POPULATION).map(([region, population]) => [
    region,
    Math.floor(population * 0.71) + 7,
  ])
);
describe("Russian Duma individual district plans", () => {
  it("creates 225 unique one-seat constituencies across all ten regions", () => {
    const districts = plan(register);
    expect(districts).toHaveLength(225);
    expect(new Set(districts.map((district) => district.seatId)).size).toBe(225);
    expect(new Set(districts.map((district) => district.regionId)).size).toBe(10);
  });
  it("preserves every registered voter exactly, including division remainders", () => {
    const districts = plan(register);
    for (const [region, voters] of Object.entries(register)) {
      const local = districts.filter((district) => district.regionId === region);
      expect(local.reduce((sum, district) => sum + district.registeredVoters, 0)).toBe(voters);
      expect(
        Math.max(...local.map((row) => row.registeredVoters)) -
          Math.min(...local.map((row) => row.registeredVoters))
      ).toBeLessThanOrEqual(1);
      expect(local.map((row) => row.districtNumber)).toEqual(
        Array.from({ length: local.length }, (_, index) => index + 1)
      );
    }
  });
  it("keeps identities and population-based seats stable when registration changes", () => {
    expect(plan({ ...register, CEN: 1 }).map((row) => row.seatId)).toEqual(
      plan(register).map((row) => row.seatId)
    );
  });
  it("preserves a region with no registered voters without moving its seats", () => {
    const districts = plan({ ...register, FEA: 0 });
    const farEast = districts.filter((row) => row.regionId === "FEA");
    expect(farEast.length).toBeGreaterThan(0);
    expect(farEast.every((row) => row.registeredVoters === 0)).toBe(true);
  });
  it("uses the canonical ordering regardless of input insertion order", () => {
    expect(plan(Object.fromEntries(Object.entries(register).reverse()))).toEqual(plan(register));
  });
  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid regional voter count %s",
    (CEN) => {
      expect(() => plan({ ...register, CEN })).toThrow("register");
    }
  );
  it("rejects missing regions, Soviet republics, an empty register and unsafe totals", () => {
    const { CEN: _central, ...missing } = register;
    expect(() => plan(missing)).toThrow("complete");
    expect(() => plan({ ...register, KAZ: 50 })).toThrow("complete");
    expect(() => plan(Object.fromEntries(Object.keys(register).map((id) => [id, 0])))).toThrow(
      "empty"
    );
    expect(() => plan({ ...register, CEN: Number.MAX_SAFE_INTEGER })).toThrow("precision");
  });
});

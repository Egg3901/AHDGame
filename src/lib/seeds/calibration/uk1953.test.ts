import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "./deriveRegionLeans";

/**
 * UK 1953 had no calibration cell, which is why its model drifted unchecked
 * (#3755): every region displayed left of centre, so the world could not return
 * the Conservative government Britain actually had in 1953.
 *
 * `getDisplayLean` takes whichever axis is larger in magnitude, so this era's
 * social level acts as the threshold the economic axis crosses — regions more
 * economically left than that level read left, the rest read right. The 1953
 * level had sat at ~0.26 while every region's economic lean was 0.48–1.14, so the
 * economic axis always won. Raising it into the economic range restores the
 * split. Keep that in mind before flattening or lifting the social values here.
 */
describe("UK 1953 calibration — UK 1951/1955 generals (near-ties; Churchill government)", () => {
  const leans = deriveRegionLeans("UK", "1953");
  const byId = Object.fromEntries(leans.map((l) => [l.regionId, l]));

  it("produces a wide spread (not compressed)", () => {
    const dVals = leans.map((l) => l.display);
    const spread = Math.max(...dVals) - Math.min(...dVals);
    expect(spread).toBeGreaterThanOrEqual(1.8);
  });

  it("mean display lean is centered", () => {
    const dVals = leans.map((l) => l.display);
    const mean = dVals.reduce((a, b) => a + b, 0) / dVals.length;
    expect(Math.abs(mean)).toBeLessThanOrEqual(0.6);
  });

  it("the country is not uniformly one-sided", () => {
    const dVals = leans.map((l) => l.display);
    expect(
      dVals.some((d) => d < 0),
      "no region leans left"
    ).toBe(true);
    expect(
      dVals.some((d) => d > 0),
      "no region leans right"
    ).toBe(true);
  });

  it("NEE is left of center (Durham/Tyneside coal and shipbuilding)", () => {
    expect(byId.NEE.display).toBeLessThan(-0.4);
  });

  it("NWE is left of center (Lancashire mills, Liverpool/Manchester)", () => {
    expect(byId.NWE.display).toBeLessThan(-0.4);
  });

  it("YHU is left of center (Yorkshire coalfield, Sheffield steel)", () => {
    expect(byId.YHU.display).toBeLessThan(-0.4);
  });

  it("SCO is left of center (Clydeside industry)", () => {
    expect(byId.SCO.display).toBeLessThan(-0.4);
  });

  it("WAL is left of center (South Wales valleys — coal and steel)", () => {
    expect(byId.WAL.display).toBeLessThan(-0.2);
  });

  it("LON is left of center (Labour held most London seats in 1951)", () => {
    expect(byId.LON.display).toBeLessThan(-0.8);
  });

  it("SEE is right of center (Home Counties)", () => {
    expect(byId.SEE.display).toBeGreaterThan(0.3);
  });

  it("SWE is right of center (rural West Country)", () => {
    expect(byId.SWE.display).toBeGreaterThan(0.3);
  });

  it("EAE is right of center (agricultural East Anglia)", () => {
    expect(byId.EAE.display).toBeGreaterThan(0.3);
  });

  it("EMI is right of center", () => {
    expect(byId.EMI.display).toBeGreaterThan(0.3);
  });

  it("ordering: LON is left of SEE", () => {
    expect(byId.LON.display).toBeLessThan(byId.SEE.display);
  });

  it("ordering: NEE is left of EMI", () => {
    expect(byId.NEE.display).toBeLessThan(byId.EMI.display);
  });

  it("keeps genuine econ/social axis separation (no region collapsed to zero on both axes)", () => {
    for (const l of leans) {
      expect(Math.abs(l.economic) + Math.abs(l.social)).toBeGreaterThanOrEqual(0.1);
    }
  });
});

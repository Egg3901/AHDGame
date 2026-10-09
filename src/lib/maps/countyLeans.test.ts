import { describe, expect, it } from "vitest";
import { countyLeanEraForPreset, countyLeanSourceLabel, loadCountyLeans } from "./countyLeans";
import { loadSubdivisionFile } from "./subdivisionData";

describe("countyLeanEraForPreset", () => {
  it("maps each preset to the latest era at or before its start year", () => {
    expect(countyLeanEraForPreset("1953-default")).toBe(1953);
    expect(countyLeanEraForPreset("1991-default")).toBe(1991);
    expect(countyLeanEraForPreset("1999-default")).toBe(1999);
    expect(countyLeanEraForPreset("2007-default")).toBe(2007);
    expect(countyLeanEraForPreset("2027-default")).toBe(2027);
    expect(countyLeanEraForPreset("1997-custom")).toBe(1991);
  });
  it("falls back sensibly for odd presets", () => {
    expect(countyLeanEraForPreset(undefined)).toBe(2027);
    expect(countyLeanEraForPreset("sandbox")).toBe(2027);
    expect(countyLeanEraForPreset("1900-default")).toBe(1953);
  });
  it("names the source elections", () => {
    expect(countyLeanSourceLabel("1991-default")).toBe("1984 and 1988 presidential results");
  });
});

describe("era county leans", () => {
  it("covers every committed county in every era", async () => {
    const pa = await loadSubdivisionFile("counties", "PA");
    for (const preset of ["1953-default", "1991-default", "2027-default"]) {
      const leans = (await loadCountyLeans(preset))!;
      for (const c of pa!.subdivisions) expect(typeof leans[c.id]).toBe("number");
    }
  });

  it("reflects the era: the 1952 Deep South voted left, 2024 voted right", async () => {
    const autauga = "01001";
    expect((await loadCountyLeans("1953-default"))![autauga]).toBeLessThan(-10);
    expect((await loadCountyLeans("2027-default"))![autauga]).toBeGreaterThan(15);
  });

  it("swaps the era baseline into the subdivision loader", async () => {
    const modern = await loadSubdivisionFile("counties", "AL");
    const fifties = await loadSubdivisionFile("counties", "AL", { preset: "1953-default" });
    const m = modern!.subdivisions.find((s) => s.id === "01001")!.leanScalar!;
    const f = fifties!.subdivisions.find((s) => s.id === "01001")!.leanScalar!;
    expect(m).toBeGreaterThan(0);
    expect(f).toBeLessThan(0);
  });
});

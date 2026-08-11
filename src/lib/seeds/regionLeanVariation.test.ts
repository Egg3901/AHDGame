import { describe, it, expect } from "vitest";
import { deriveRegionLeans } from "@/lib/seeds/calibration/deriveRegionLeans";
import { getLeanLabel } from "@/lib/utils/demographics";

describe("Region lean variation — 1953", () => {
  it("DE 1953: at least two regions resolve to different displayed leans", () => {
    const leans = deriveRegionLeans("DE", "1953");
    const distinct = new Set(leans.map((r) => getLeanLabel(r.display)));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("IE 1953: at least two regions resolve to different displayed leans", () => {
    const leans = deriveRegionLeans("IE", "1953");
    const distinct = new Set(leans.map((r) => getLeanLabel(r.display)));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("DE 1953: industrial Ruhr (NW) leans left, Catholic Bavaria (BY) leans right", () => {
    const leans = deriveRegionLeans("DE", "1953");
    const nw = leans.find((r) => r.regionId === "NW");
    const by = leans.find((r) => r.regionId === "BY");
    expect(nw).toBeDefined();
    expect(by).toBeDefined();
    expect(nw!.display).toBeLessThan(0);
    expect(by!.display).toBeGreaterThan(0);
  });

  it("IE 1953: Dublin leans left, rural west leans right", () => {
    const leans = deriveRegionLeans("IE", "1953");
    const dub = leans.find((r) => r.regionId === "DUB");
    const gal = leans.find((r) => r.regionId === "GAL");
    expect(dub).toBeDefined();
    expect(gal).toBeDefined();
    expect(dub!.display).toBeLessThan(0);
    expect(gal!.display).toBeGreaterThan(0);
  });
});

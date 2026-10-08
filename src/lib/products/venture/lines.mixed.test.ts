import { describe, expect, it } from "vitest";
import { availableVentureLines } from "./lines";

describe("mixed manufacturing corporation lines", () => {
  it("offers steel and vehicle lines when it owns both kinds of plant", () => {
    const lines = availableVentureLines({
      domain: "manufacturing",
      corporationId: "c1",
      sectors: [
        {
          sectorId: "s1",
          sectorType: "manufacturing",
          strategyId: "standard",
          capitalStock: 100,
          plantCount: 3,
        },
        {
          sectorId: "s2",
          sectorType: "manufacturing",
          industryModel: "vehicles",
          strategyId: "standard",
          capitalStock: 100,
          plantCount: 3,
        },
      ],
    });
    const open = lines.filter((l) => l.available).map((l) => l.line.id);
    expect(open).toEqual(expect.arrayContaining(["structural_steel", "cement", "passenger_car"]));
    expect(open).not.toContain("home_appliance");
  });
});

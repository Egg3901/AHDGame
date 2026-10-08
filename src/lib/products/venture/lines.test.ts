import { describe, expect, it } from "vitest";
import { availableVentureLines, liftedSectorIds, type VentureSector } from "./lines";

const plant = (
  id: string,
  strategyId: string,
  extra: Partial<VentureSector> = {}
): VentureSector => ({
  sectorId: id,
  sectorType: "manufacturing",
  strategyId,
  capitalStock: 1000,
  plantCount: 2,
  ...extra,
});

function ids(sectors: VentureSector[], domain: "media" | "manufacturing" = "manufacturing") {
  return availableVentureLines({ domain, corporationId: "c", sectors, currentYear: 1991 })
    .filter((s) => s.available)
    .map((s) => s.line.id);
}

describe("manufacturing line gating", () => {
  it("an auto-only corporation cannot release a washing machine", () => {
    const sectors = [plant("a", "vehicle_assembly")];
    const available = ids(sectors);
    expect(available).toContain("passenger_car");
    expect(available).not.toContain("home_appliance");
    const status = availableVentureLines({
      domain: "manufacturing",
      corporationId: "c",
      sectors,
      currentYear: 1991,
    }).find((s) => s.line.id === "home_appliance");
    expect(status?.reason).toMatch(/electronics/);
  });

  it("a dedicated vehicle sector can make cars but not appliances", () => {
    const sectors = [plant("a", "standard", { sectorType: "automobiles" })];
    const available = ids(sectors);
    expect(available).toContain("passenger_car");
    expect(available).not.toContain("home_appliance");
  });

  it("an electronics plant unlocks home appliances", () => {
    expect(ids([plant("e", "electronics_manufacturing")])).toContain("home_appliance");
  });

  it("a mothballed plant does not count", () => {
    expect(ids([plant("e", "electronics_manufacturing", { mothballed: true })])).not.toContain(
      "home_appliance"
    );
  });

  it("lifts only sectors that make the line's output", () => {
    const sectors = [
      plant("e", "electronics_manufacturing"),
      plant("s", "heavy_metals"),
      plant("v", "vehicle_assembly"),
    ];
    const lifted = liftedSectorIds({
      domain: "manufacturing",
      lineId: "consumer_electronics",
      corporationId: "c",
      sectors,
    });
    expect(lifted).toEqual(["e"]);
  });
});

describe("media line gating", () => {
  it("needs an owned media sector on the line's operating model and lifts all media sectors", () => {
    const sectors: VentureSector[] = [
      { sectorId: "n", sectorType: "media", strategyId: "newspaper" },
      {
        sectorId: "f",
        sectorType: "media",
        strategyId: "film_studio",
        mediaDiscriminator: "entertainment",
      },
      plant("p", "standard"),
    ];
    const available = ids(sectors, "media");
    expect(available).toContain("newspaper_edition");
    expect(available).toContain("film");
    expect(available).not.toContain("radio_program");
    expect(
      liftedSectorIds({ domain: "media", lineId: "film", corporationId: "c", sectors }).sort()
    ).toEqual(["f", "n"]);
  });
});

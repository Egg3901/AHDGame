import { describe, it, expect } from "vitest";
import {
  GRID_ENERGY_MAX_BONUS,
  GRID_ENERGY_MAX_PENALTY,
  GRID_ENERGY_REFERENCE_SHARE,
  gridEnergyAdequacyTerm,
} from "./infrastructure";

/**
 * Suggestion #90: a player was building generation every turn and watching grid
 * reliability sit at the bottom of its band, because installed energy capacity
 * was not an input to the grid metric at all — while the same metric taxed
 * every corporation's margin through `getGridReliabilityMarginModifier`.
 */

const rows = (energyRevenue: number, otherRevenue: number) => [
  { revenue: energyRevenue, sectorType: "energy" },
  { revenue: otherRevenue, sectorType: "manufacturing" },
];

describe("gridEnergyAdequacyTerm", () => {
  it("is neutral at exactly the reference share", () => {
    const total = 1_000;
    const term = gridEnergyAdequacyTerm(
      rows(total * GRID_ENERGY_REFERENCE_SHARE, total * (1 - GRID_ENERGY_REFERENCE_SHARE))
    );
    expect(term).toBeCloseTo(0, 10);
  });

  it("penalises an under-supplied region", () => {
    // Half the generation the region needs.
    const total = 1_000;
    const energy = total * GRID_ENERGY_REFERENCE_SHARE * 0.5;
    const term = gridEnergyAdequacyTerm(rows(energy, total - energy));
    expect(term).toBeLessThan(0);
    expect(term).toBeGreaterThanOrEqual(-GRID_ENERGY_MAX_PENALTY);
  });

  it("bottoms out rather than collapsing when there is no generation at all", () => {
    const term = gridEnergyAdequacyTerm(rows(0, 1_000));
    expect(term).toBeCloseTo(-GRID_ENERGY_MAX_PENALTY, 10);
  });

  it("rewards building generation — the whole point of the suggestion", () => {
    const total = 1_000;
    const thin = gridEnergyAdequacyTerm(rows(10, total));
    const built = gridEnergyAdequacyTerm(rows(60, total));
    expect(built).toBeGreaterThan(thin);
  });

  it("counts utilities alongside energy", () => {
    const withUtilities = gridEnergyAdequacyTerm([
      { revenue: 40, sectorType: "utilities" },
      { revenue: 960, sectorType: "manufacturing" },
    ]);
    const withEnergy = gridEnergyAdequacyTerm(rows(40, 960));
    expect(withUtilities).toBeCloseTo(withEnergy, 10);
  });

  it("caps the bonus so generation cannot buy a perfect grid", () => {
    const term = gridEnergyAdequacyTerm(rows(900, 100));
    expect(term).toBeCloseTo(GRID_ENERGY_MAX_BONUS, 10);
  });

  it("is exactly neutral with no sector data, so unseen regions keep the old target", () => {
    expect(gridEnergyAdequacyTerm([])).toBe(0);
    expect(gridEnergyAdequacyTerm([{ revenue: 0, sectorType: "energy" }])).toBe(0);
  });

  it("ignores malformed revenue rather than propagating NaN into the grid target", () => {
    const term = gridEnergyAdequacyTerm([
      { revenue: Number.NaN, sectorType: "energy" },
      { revenue: 1_000, sectorType: "manufacturing" },
    ]);
    expect(Number.isFinite(term)).toBe(true);
    expect(term).toBeCloseTo(-GRID_ENERGY_MAX_PENALTY, 10);
  });
});

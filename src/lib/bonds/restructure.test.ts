import { describe, expect, it } from "vitest";
import { previewRestructure } from "./restructure";
import { RESTRUCTURE_SECTOR_SALVAGE_FRACTION } from "@/lib/constants/corporations";

const F = RESTRUCTURE_SECTOR_SALVAGE_FRACTION; // 0.85

describe("previewRestructure", () => {
  it("needs no sectors when cash already covers the defaulted principal", () => {
    const p = previewRestructure({
      defaultedPrincipalAnchor: 1000,
      liquidCapitalAnchor: 1500,
      sectorNpvByIdAnchor: [{ sectorId: "a", npvAnchor: 5000 }],
    });
    expect(p.feasible).toBe(true);
    expect(p.needFromSectors).toBe(0);
    expect(p.sectorsToLiquidate).toEqual([]);
    expect(p.proceeds).toBe(0);
    expect(p.residualLiquidCapital).toBe(500);
  });

  it("liquidates the minimum, highest-salvage sectors to cover the shortfall", () => {
    // need = 1000 - 0 = 1000. Salvage per sector = npv × 0.85.
    // sector b: 1000×0.85=850, sector a: 800×0.85=680, sector c: 400×0.85=340.
    // Sorted desc: b(850), a(680), c(340). Greedy: b(850) < 1000 → add a → 1530 ≥ 1000. Stop.
    const p = previewRestructure({
      defaultedPrincipalAnchor: 1000,
      liquidCapitalAnchor: 0,
      sectorNpvByIdAnchor: [
        { sectorId: "a", npvAnchor: 800 },
        { sectorId: "b", npvAnchor: 1000 },
        { sectorId: "c", npvAnchor: 400 },
      ],
    });
    expect(p.feasible).toBe(true);
    expect(p.needFromSectors).toBe(1000);
    expect(p.sectorsToLiquidate.map((s) => s.sectorId)).toEqual(["b", "a"]);
    expect(p.proceeds).toBeCloseTo(1000 * F + 800 * F, 6);
    expect(p.residualLiquidCapital).toBeCloseTo(0 + 1530 - 1000, 6);
  });

  it("treats a negative cash balance as part of the hole sectors must fill", () => {
    // liquidCapital -500, owe 1000 → needFromSectors = 1500.
    // Two sectors so the last-sector guard does not apply; `big` alone covers it.
    const p = previewRestructure({
      defaultedPrincipalAnchor: 1000,
      liquidCapitalAnchor: -500,
      sectorNpvByIdAnchor: [
        { sectorId: "big", npvAnchor: 10000 }, // salvage 8500
        { sectorId: "small", npvAnchor: 100 },
      ],
    });
    expect(p.needFromSectors).toBe(1500);
    expect(p.feasible).toBe(true);
    expect(p.sectorsToLiquidate.map((s) => s.sectorId)).toEqual(["big"]);
    // residual = -500 + 8500 - 1000 = 7000
    expect(p.residualLiquidCapital).toBeCloseTo(7000, 6);
  });

  it("refuses to liquidate a single-sector corporation's only sector", () => {
    // Ticket #1130: COSTCO owned exactly one sector worth far more than the
    // debt. The greedy pass selects it, which ends the business entirely while
    // telling the player "the corporation survives with its remaining sectors".
    const p = previewRestructure({
      defaultedPrincipalAnchor: 167010,
      liquidCapitalAnchor: -597,
      sectorNpvByIdAnchor: [{ sectorId: "only", npvAnchor: 232407 }],
    });
    expect(p.feasible).toBe(false);
    expect(p.sectorsToLiquidate).toEqual([]);
    expect(p.proceeds).toBe(0);
  });

  it("refuses when covering the debt would take every sector a corp owns", () => {
    // need = 2000. Both sectors together salvage to exactly 1700 + 850 = 2550,
    // and the greedy pass needs both — that is a dissolution, not a restructure.
    const p = previewRestructure({
      defaultedPrincipalAnchor: 2000,
      liquidCapitalAnchor: 0,
      sectorNpvByIdAnchor: [
        { sectorId: "a", npvAnchor: 2000 }, // salvage 1700
        { sectorId: "b", npvAnchor: 1000 }, // salvage 850
      ],
    });
    expect(p.feasible).toBe(false);
    expect(p.sectorsToLiquidate).toEqual([]);
  });

  it("still restructures when a strict subset of sectors covers the debt", () => {
    const p = previewRestructure({
      defaultedPrincipalAnchor: 1000,
      liquidCapitalAnchor: 0,
      sectorNpvByIdAnchor: [
        { sectorId: "a", npvAnchor: 2000 }, // salvage 1700 ≥ 1000 on its own
        { sectorId: "b", npvAnchor: 1000 },
      ],
    });
    expect(p.feasible).toBe(true);
    expect(p.sectorsToLiquidate.map((s) => s.sectorId)).toEqual(["a"]);
  });

  it("is infeasible when total salvage cannot cover the shortfall", () => {
    // need = 1000, only sector salvage = 100×0.85 = 85.
    const p = previewRestructure({
      defaultedPrincipalAnchor: 1000,
      liquidCapitalAnchor: 0,
      sectorNpvByIdAnchor: [{ sectorId: "tiny", npvAnchor: 100 }],
    });
    expect(p.feasible).toBe(false);
    expect(p.sectorsToLiquidate).toEqual([]);
    expect(p.proceeds).toBe(0);
  });

  it("ignores non-positive-NPV sectors as having no salvage value", () => {
    const p = previewRestructure({
      defaultedPrincipalAnchor: 500,
      liquidCapitalAnchor: 0,
      sectorNpvByIdAnchor: [
        { sectorId: "dead", npvAnchor: -200 },
        { sectorId: "good", npvAnchor: 1000 },
      ],
    });
    expect(p.sectorsToLiquidate.map((s) => s.sectorId)).toEqual(["good"]);
    expect(p.totalSalvageAvailable).toBeCloseTo(1000 * F, 6);
  });

  it("is infeasible when nothing is owed", () => {
    const p = previewRestructure({
      defaultedPrincipalAnchor: 0,
      liquidCapitalAnchor: 100,
      sectorNpvByIdAnchor: [{ sectorId: "a", npvAnchor: 1000 }],
    });
    expect(p.feasible).toBe(false);
  });
});

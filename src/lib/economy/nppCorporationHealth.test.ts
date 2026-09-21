import { describe, expect, it } from "vitest";
import {
  computeNppCorporationHealth,
  type NppCorporationHealthCorporation,
} from "./nppCorporationHealth";
import type { NppOperatorAggregate } from "@/lib/corporations/nppOperatorTelemetry/rules";

function corp(
  overrides: Partial<NppCorporationHealthCorporation> = {}
): NppCorporationHealthCorporation {
  return {
    ceoId: "npp-1",
    ceoType: "npp",
    type: "retail",
    liquidCapital: 100,
    ...overrides,
  };
}

describe("computeNppCorporationHealth", () => {
  it("returns nulls (not fabricated zeros) for an empty world", () => {
    const report = computeNppCorporationHealth({ corporations: [] });
    expect(report.sectors).toEqual([]);
    expect(report.totals).toEqual({
      nppLed: 0,
      cashNegative: 0,
      cashNegativeShare: null,
      medianLiquidCapitalAnchor: null,
    });
    expect(report.bindingGateCounts).toEqual({});
    expect(report.bindingConstraintCounts).toEqual({});
    expect(report.bindingConstraintLegCounts).toEqual({});
    expect(report.operatorObservations).toBe(0);
  });

  it("computes the per-sector cash-negative share and median for NPP-led corps", () => {
    const report = computeNppCorporationHealth({
      corporations: [
        corp({ ceoId: "a", type: "retail", liquidCapital: -50 }),
        corp({ ceoId: "b", type: "retail", liquidCapital: 10 }),
        corp({ ceoId: "c", type: "retail", liquidCapital: -30 }),
        corp({ ceoId: "d", type: "retail", liquidCapital: 100 }),
        corp({ ceoId: "e", type: "energy", liquidCapital: 500 }),
      ],
    });

    expect(report.sectors).toEqual([
      {
        sectorType: "energy",
        nppLed: 1,
        cashNegative: 0,
        cashNegativeShare: 0,
        medianLiquidCapitalAnchor: 500,
        stateOwned: 0,
        bankChartered: 0,
      },
      {
        sectorType: "retail",
        nppLed: 4,
        cashNegative: 2,
        cashNegativeShare: 0.5,
        // sorted: -50, -30, 10, 100 → median = (-30 + 10) / 2
        medianLiquidCapitalAnchor: -10,
        stateOwned: 0,
        bankChartered: 0,
      },
    ]);
    expect(report.totals).toEqual({
      nppLed: 5,
      cashNegative: 2,
      cashNegativeShare: 0.4,
      medianLiquidCapitalAnchor: 10,
    });
  });

  it("classifies NPP-led by CEO id set and by explicit cohort, excluding players", () => {
    const nppCeoIds = new Set(["via-id"]);
    const report = computeNppCorporationHealth({
      corporations: [
        corp({ ceoId: "via-id", ceoType: undefined, type: "technology", liquidCapital: -5 }),
        corp({ ceoId: "cohort", ceoType: "npp", type: "retail", liquidCapital: 20 }),
        // Player-led: neither cohort nor id membership.
        corp({ ceoId: "player", ceoType: "character", type: "retail", liquidCapital: -900 }),
      ],
      nppCeoIds,
    });

    const bySector = Object.fromEntries(report.sectors.map((s) => [s.sectorType, s]));
    expect(report.totals.nppLed).toBe(2);
    expect(bySector.retail.nppLed).toBe(1);
    expect(bySector.retail.cashNegative).toBe(0);
    expect(bySector.technology.cashNegative).toBe(1);
    // The player-led cash-negative retail corp is not counted anywhere.
    expect(report.totals.cashNegative).toBe(1);
  });

  it("annotates state-owned and chartered-bank corps within the cohort", () => {
    const report = computeNppCorporationHealth({
      corporations: [
        corp({ ceoId: "soe", countryOwnerId: "US", liquidCapital: 1 }),
        corp({ ceoId: "bank", bankCharter: { status: "active" }, liquidCapital: 2 }),
      ],
      // Both are ceoType "npp" by the default factory.
    });
    const retail = report.sectors[0];
    expect(retail.stateOwned).toBe(1);
    expect(retail.bankChartered).toBe(1);
    expect(retail.nppLed).toBe(2);
  });

  it("passes the persisted operator diagnostics through and rolls constraints up to legs", () => {
    const diagnostics: NppOperatorAggregate = {
      corporationsObserved: 7,
      bindingGateCounts: { cash_floor: 3, no_enterable_market: 4 },
      constraintCounts: {
        budget_cash_crisis: 2,
        growth_unaffordable: 3,
        dividend_cash_floor: 1,
      },
      budgetBandCounts: { distress: 5, thin: 2 },
      dividendPolicyCounts: { withheld: 6, paying: 1 },
      dividendRateSum: 3,
      divestedSectors: 1,
      reinvestments: 2,
      marginPctSum: 40,
      cashHeadroomAnchorSum: 12,
    };

    const report = computeNppCorporationHealth({
      corporations: [],
      operatorDiagnostics: diagnostics,
    });
    expect(report.operatorObservations).toBe(7);
    expect(report.bindingGateCounts).toEqual({ cash_floor: 3, no_enterable_market: 4 });
    expect(report.bindingConstraintCounts).toEqual({
      budget_cash_crisis: 2,
      growth_unaffordable: 3,
      dividend_cash_floor: 1,
    });
    expect(report.bindingConstraintLegCounts).toEqual({
      budget: 2,
      growth: 3,
      dividend: 1,
    });
  });

  it("is deterministic and pure — same input, same output, no mutation", () => {
    const input = {
      corporations: [
        corp({ ceoId: "x", type: "chemical_industries", liquidCapital: -1 }),
        corp({ ceoId: "y", type: "retail", liquidCapital: 7 }),
      ],
    };
    const first = computeNppCorporationHealth(input);
    const second = computeNppCorporationHealth(input);
    expect(second).toEqual(first);
  });
});

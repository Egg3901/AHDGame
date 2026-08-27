import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { findBestUnownedSector, HQ_STATE_SCORE_BONUS } from "./marketSignals";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";

const us = (sectorType: string, stateId: string, revenue = 100_000): UnownedSector =>
  ({
    _id: new ObjectId(),
    stateId,
    countryId: "US" as CountryId,
    sectorType: sectorType as UnownedSector["sectorType"],
    revenue,
    headroomUnits: revenue,
  }) as UnownedSector;

const ratios =
  (map: Partial<Record<CommodityType, number>>) =>
  (commodity: CommodityType): number | null =>
    map[commodity] ?? 1;

describe("state-resolution placement signals (supply dislocation, t202)", () => {
  it("prefers an adjacent frontier state and allows the same sector type there", () => {
    const pool = new Map([
      ["US", [us("manufacturing", "AZ", 100_000), us("manufacturing", "TX", 10_000_000)]],
    ]);
    const pick = findBestUnownedSector(
      "US",
      "CA",
      "manufacturing",
      null,
      new Set(["CA:manufacturing"]),
      pool,
      new Set(),
      ratios({}),
      false,
      1,
      undefined,
      new Set(["AZ", "NV", "OR"])
    );

    expect(pick?.stateId).toBe("AZ");
    expect(pick?.sectorType).toBe("manufacturing");
  });

  it("a starved non-HQ state outscores the HQ state", () => {
    // Two open manufacturing buckets, same size. NY's state prices show a real
    // shortage; the HQ state (PA) is at base. The old unconditional HQ pick
    // returned PA regardless — the shortage signal must now win.
    const pool = new Map([["US", [us("manufacturing", "PA"), us("manufacturing", "NY")]]]);
    const pick = findBestUnownedSector(
      "US",
      "PA",
      "manufacturing",
      null,
      new Set(),
      pool,
      new Set(),
      ratios({}),
      false,
      1,
      { statePriceRatioOf: (_commodity, stateId) => (stateId === "NY" ? 1.5 : 1.0) }
    );
    expect(pick?.stateId).toBe("NY");
  });

  it("the HQ state still wins a tie (score bonus, not a hard pick)", () => {
    const pool = new Map([["US", [us("manufacturing", "NY"), us("manufacturing", "PA")]]]);
    const pick = findBestUnownedSector(
      "US",
      "PA",
      "manufacturing",
      null,
      new Set(),
      pool,
      new Set(),
      ratios({}),
      false,
      1,
      { statePriceRatioOf: () => 1.0 }
    );
    expect(HQ_STATE_SCORE_BONUS).toBeGreaterThan(1);
    expect(pick?.stateId).toBe("PA");
  });

  it("without signals the behavior is score-ranked with the HQ bonus (no signals = country scope)", () => {
    // Legacy callers pass no signals; ranking still runs and HQ still gets its
    // preference on equal candidates.
    const pool = new Map([["US", [us("manufacturing", "NY"), us("manufacturing", "PA")]]]);
    const pick = findBestUnownedSector(
      "US",
      "PA",
      "manufacturing",
      null,
      new Set(),
      pool,
      new Set(),
      ratios({}),
      false
    );
    expect(pick?.stateId).toBe("PA");
  });

  it("extraction never founds in a state with zero deposit headroom", () => {
    // TX has deposits, the HQ state (NY) has none. Even with the HQ bonus the
    // NY candidate is dropped outright — a depositless extraction sector clamps
    // at zero output forever.
    const pool = new Map([["US", [us("extraction", "NY"), us("extraction", "TX")]]]);
    const pick = findBestUnownedSector(
      "US",
      "NY",
      "extraction",
      null,
      new Set(),
      pool,
      new Set(),
      ratios({}),
      false,
      1,
      { extractionHeadroomOf: (stateId) => (stateId === "TX" ? 0.8 : 0) }
    );
    expect(pick?.stateId).toBe("TX");
  });

  it("extraction ranks by deposit headroom between viable states", () => {
    const pool = new Map([["US", [us("extraction", "MN"), us("extraction", "WV")]]]);
    const pick = findBestUnownedSector(
      "US",
      "WV",
      "extraction",
      null,
      new Set(),
      pool,
      new Set(),
      ratios({}),
      false,
      1,
      // MN wide open, WV nearly claimed. MN's 0.9 vs WV's 0.2 × HQ bonus 1.3.
      { extractionHeadroomOf: (stateId) => (stateId === "MN" ? 0.9 : 0.2) }
    );
    expect(pick?.stateId).toBe("MN");
  });

  it("returns null when every extraction candidate is depositless", () => {
    const pool = new Map([["US", [us("extraction", "NY"), us("extraction", "NJ")]]]);
    const pick = findBestUnownedSector(
      "US",
      "NY",
      "extraction",
      null,
      new Set(),
      pool,
      new Set(),
      ratios({}),
      false,
      1,
      { extractionHeadroomOf: () => 0 }
    );
    expect(pick).toBeNull();
  });

  it("state ratio falls back to country ratio where no state price exists", () => {
    // NY has no state price for the manufactured outputs; the country ratio says
    // shortage. PA has an explicit at-base state price. NY should inherit the
    // country shortage and beat PA plus its HQ bonus.
    const pool = new Map([["US", [us("manufacturing", "PA"), us("manufacturing", "NY")]]]);
    const pick = findBestUnownedSector(
      "US",
      "PA",
      "manufacturing",
      null,
      new Set(),
      pool,
      new Set(),
      ratios({ steel: 2.0, vehicles: 2.0, electronics: 2.0, chemicals: 2.0 }),
      false,
      1,
      { statePriceRatioOf: (_c, stateId) => (stateId === "PA" ? 1.0 : null) }
    );
    expect(pick?.stateId).toBe("NY");
  });
});

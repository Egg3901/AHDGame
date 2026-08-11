import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { computeDissolutionSectorSalvageAnchor } from "@/lib/corporations/dissolutionSectorSalvage";
import { sumCorporateSectorNpv } from "@/lib/bonds/corporateCredit";
import { DISSOLUTION_SECTOR_SALVAGE_FRACTION } from "@/lib/constants/corporations";
import type { Corporation, CorporateSector } from "@/lib/db/types";

const CORP_ID = new ObjectId();

function makeCorp(): Corporation {
  return {
    _id: CORP_ID,
    countryId: "US",
    liquidCurrencyCode: "USD",
  } as unknown as Corporation;
}

function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: CORP_ID,
    countryId: "US",
    stateId: "CA",
    sectorType: "retail",
    revenue: 10_000_000,
    profitMargin: 35,
    currentGrowthRate: 0,
    ...overrides,
  } as unknown as CorporateSector;
}

describe("computeDissolutionSectorSalvageAnchor", () => {
  let db: MockDb;
  const fx = new Map<string, number>([["USD", 1]]);

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporateSectors");
    db.collection("centralBanks");
    db.collectionMocks["centralBanks"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ countryId: "US", primeRate: 0.05 }]),
    });
  });

  function seedSectors(sectors: CorporateSector[]) {
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(sectors),
    });
  }

  it("returns exactly the salvage fraction of the corp's sector NPV", async () => {
    const sectors = [makeSector(), makeSector({ revenue: 20_000_000 })];
    seedSectors(sectors);

    const expectedNpv = sumCorporateSectorNpv(
      sectors,
      CORP_ID,
      new Map([["US", 0.05]]),
      makeCorp(),
      fx as ReadonlyMap<string, number> as never
    );
    expect(expectedNpv).toBeGreaterThan(0);

    const salvage = await computeDissolutionSectorSalvageAnchor(
      db as unknown as Db,
      makeCorp(),
      fx as never
    );
    expect(salvage).toBeCloseTo(DISSOLUTION_SECTOR_SALVAGE_FRACTION * expectedNpv, 2);
  });

  it("returns 0 when the corp has no positive-NPV sectors", async () => {
    // Zero-margin sectors: maintenance == revenue, so no positive profit → no NPV.
    seedSectors([makeSector({ profitMargin: 0 }), makeSector({ profitMargin: 0 })]);

    const salvage = await computeDissolutionSectorSalvageAnchor(
      db as unknown as Db,
      makeCorp(),
      fx as never
    );
    expect(salvage).toBe(0);
  });

  it("returns 0 when the corp owns no sectors", async () => {
    seedSectors([]);
    const salvage = await computeDissolutionSectorSalvageAnchor(
      db as unknown as Db,
      makeCorp(),
      fx as never
    );
    expect(salvage).toBe(0);
  });
});

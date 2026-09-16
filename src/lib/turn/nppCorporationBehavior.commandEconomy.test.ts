/**
 * REGRESSION: the NPP corporate brain must not expand into a command economy.
 *
 * Roughly 80 of the 92 private sectors found inside command economies on the
 * live world arrived through THIS sweep, not through founding. `#676` gated the
 * player-facing `expandSector` route and left the turn loop untouched, and under
 * v4 autonomy the brain runs in every country with no country filter at all.
 *
 * These drive the real `processNppCorporationDecisions` rather than the pure
 * decision function, because the filter lives in the sweep: a unit test of
 * `makeNppCorpDecision` would keep passing with the filter deleted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector, UnownedSector } from "@/lib/db/types";
import { stubMarketizationDb } from "@/lib/test-utils/stubMarketizationDb";

// Spied rather than stubbed: the assertion that the sweep CONSULTS the gate is
// what makes this test fail if the filter is deleted. The sweep's entry
// heuristics depend on headroom, capacity anchors, placement signals and
// module-level state that make purely behavioural fixtures order-dependent -
// verified on 2026-09-15, where the same UKR fixture was load-bearing in one
// arrangement and vacuous in another. So this pins the seam, not the heuristic.
vi.mock("@/lib/economy/queries/privateEnterpriseGate", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/economy/queries/privateEnterpriseGate")>();
  return {
    ...actual,
    loadPrivateEnterpriseBlockedCountries: vi.fn(actual.loadPrivateEnterpriseBlockedCountries),
  };
});
import { loadPrivateEnterpriseBlockedCountries } from "@/lib/economy/queries/privateEnterpriseGate";
import { processNppCorporationDecisions } from "./nppCorporationBehavior";

const CURRENT_YEAR = 1970;
const TURN = 900;

function makeCorp(countryId: string, stateId: string): Corporation {
  return {
    _id: new ObjectId(),
    name: `${countryId} NPP Corp`,
    countryId,
    type: "manufacturing",
    headquartersState: stateId,
    ceoType: "npp",
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    ceoVacant: false,
    liquidCapital: 500_000_000,
    liquidCurrencyCode: "USD",
    marketingBudget: 0,
    marketingStrength: 10,
    logisticsBudget: 0,
    logisticsStrength: 0,
    totalShares: 100_000,
    sharePrice: 10,
    shareholders: [],
    publicFloat: 0,
  } as unknown as Corporation;
}

function makeOwnedSector(corp: Corporation, stateId: string): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: corp._id,
    countryId: corp.countryId,
    stateId,
    sectorType: "manufacturing",
    targetGrowthRate: 2,
    currentGrowthRate: 2,
    currentGrowthCost: 0,
    revenue: 50_000_000,
    profitMargin: 30,
    workers: 1000,
  } as unknown as CorporateSector;
}

function makeUnowned(countryId: string, stateId: string): UnownedSector {
  return {
    _id: new ObjectId(),
    countryId,
    stateId,
    sectorType: "technology",
    revenue: 80_000_000,
    profitMargin: 35,
    workers: 2000,
  } as unknown as UnownedSector;
}

/** Minimal read-only db over the nine collections the sweep touches. */
function makeDb(rows: {
  corporations: Corporation[];
  corporateSectors: CorporateSector[];
  unownedSectors: UnownedSector[];
}): Db {
  const find = (docs: unknown[]) => ({
    toArray: async () => docs,
    project: () => ({ toArray: async () => docs }),
    sort: () => ({ toArray: async () => docs, limit: () => ({ toArray: async () => docs }) }),
    limit: () => ({ toArray: async () => docs }),
  });
  const base = {
    collection: (name: string) => {
      const docs =
        name === "corporations"
          ? rows.corporations
          : name === "corporateSectors"
            ? rows.corporateSectors
            : name === "unownedSectors"
              ? rows.unownedSectors
              : [];
      return {
        find: () => find(docs),
        findOne: async () => null,
        bulkWrite: async () => ({}),
        updateOne: async () => ({}),
        aggregate: () => find([]),
        countDocuments: async () => 0,
      };
    },
  } as unknown as Db;
  return stubMarketizationDb({ currentYear: CURRENT_YEAR, base });
}

describe("processNppCorporationDecisions - command economy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consults the private-enterprise gate before proposing any entry", async () => {
    // The deletion guard. If the filter is removed the gate is never called and
    // this fails, regardless of whether the fixture happened to trigger entry.
    const ru = makeCorp("RU", "CEN");
    const db = makeDb({
      corporations: [ru],
      corporateSectors: [makeOwnedSector(ru, "CEN")],
      unownedSectors: [makeUnowned("RU", "CEN")],
    });

    await processNppCorporationDecisions(db, TURN, new Date());

    expect(loadPrivateEnterpriseBlockedCountries).toHaveBeenCalledTimes(1);
  });

  it("returns the real blocked set, so RU, CN and UKR are excluded from entry", async () => {
    // Pins WHAT the gate reports for this world, which is the other half of the
    // contract: the sweep could call it and still receive an empty set.
    const us = makeCorp("US", "CA");
    const db = makeDb({
      corporations: [us],
      corporateSectors: [makeOwnedSector(us, "CA")],
      unownedSectors: [makeUnowned("US", "CA")],
    });

    await processNppCorporationDecisions(db, TURN, new Date());

    const blocked = await vi.mocked(loadPrivateEnterpriseBlockedCountries).mock.results[0].value;
    for (const id of ["RU", "CN", "UKR", "DD", "BLR", "BAL"]) {
      expect(blocked.has(id), id).toBe(true);
    }
    expect(blocked.has("US")).toBe(false);
  });

  it("proposes no new sector inside a command economy", async () => {
    const ru = makeCorp("RU", "CEN");
    const cn = makeCorp("CN", "HB");
    const db = makeDb({
      corporations: [ru, cn],
      corporateSectors: [makeOwnedSector(ru, "CEN"), makeOwnedSector(cn, "HB")],
      unownedSectors: [makeUnowned("RU", "CEN"), makeUnowned("CN", "HB")],
    });

    const result = await processNppCorporationDecisions(db, TURN, new Date());

    expect(
      result.newSectors.filter((s) => ["RU", "CN"].includes(String(s.countryId)))
    ).toHaveLength(0);
  });
});

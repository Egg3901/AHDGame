import { describe, it, expect, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
vi.mock("@/lib/currency/corporationCapital", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currency/corporationCapital")>(
    "@/lib/currency/corporationCapital"
  );
  return {
    ...actual,
    loadValuationFxRates: vi.fn(
      async () =>
        new Map([
          ["USD", 5],
          ["GBP", 2],
        ])
    ),
  };
});
import { loadGroupBalanceSheet } from "./groupBalanceSheet";
describe("group balance sheet host currency", () => {
  it("values foreign sectors in their host currency and domestic sectors in their stamped currency", async () => {
    const root = new ObjectId(),
      sub = new ObjectId(),
      db = createInMemoryDb();
    db.seed("corporations", [
      {
        _id: root,
        name: "Parent",
        countryId: "US",
        liquidCurrencyCode: "USD",
        liquidCapital: 500,
        totalShares: 100,
        shareholders: [],
      },
      {
        _id: sub,
        name: "Subsidiary",
        countryId: "US",
        liquidCurrencyCode: "USD",
        liquidCapital: 100,
        totalShares: 100,
        shareholders: [{ corporationId: root, shares: 100 }],
        subsidiaryFormalizedAtTurn: 1,
      },
    ]);
    db.seed("corporateSectors", [
      {
        _id: new ObjectId(),
        corporationId: root,
        sectorType: "logistics",
        countryId: "UK",
        stateId: "S",
        revenue: 100,
      },
      {
        _id: new ObjectId(),
        corporationId: sub,
        sectorType: "logistics",
        countryId: "US",
        stateId: "S",
        revenue: 100,
      },
    ]);
    const sheet = await loadGroupBalanceSheet(db as unknown as Db, root);
    expect(sheet?.members.find((m) => m.isRoot)?.revenueAnchor).toBe(50);
    expect(sheet?.members.find((m) => !m.isRoot)?.revenueAnchor).toBe(20);
    expect(sheet?.totalRevenueAnchor).toBe(70);
    expect(sheet?.totalRegionCount).toBe(2);
    expect(sheet?.members.map((m) => m.regionCount)).toEqual([1, 1]);
  });
});

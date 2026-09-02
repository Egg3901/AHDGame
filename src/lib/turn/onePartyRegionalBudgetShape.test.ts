/**
 * A `regionalBudgets` document must carry exactly ONE country shape.
 *
 * `RegionalBudget` is a union of per-country field sets, and
 * `buildRegionalRevenueShape` dispatches on which fields are PRESENT — checking
 * the DE branch (`incomeTaxShare`/`vatShare`) before the CN one. A region that
 * changes model keeps its old fields under a plain `$set`, so it would carry two
 * shapes and readers would resolve the stale one.
 *
 * Found while auditing #1323: DD's Länder froze on turn 550 holding the DE
 * fields, and had DD been put on the one-party processor the region would have
 * reported the old `federalEqualizationGrant` as income while the national
 * budget booked `centralTransferGrant` as the expense. DD ended up staying on
 * the Länder model for a different reason, so this is now a guard rather than a
 * live path — but the collision is real for any region that changes model, and
 * costs one `$unset` to make impossible.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import { buildRegionalRevenueShape } from "@/lib/budget/regionalRevenueShape";

vi.mock("@/lib/subsidies/subsidyBudgetCosts", () => ({
  loadAnnualSubsidyCostMaps: vi.fn().mockResolvedValue({ stateCostByStateId: new Map() }),
}));

/** The DE-shaped fields a converted region arrives holding. */
const STALE_DE_FIELDS = {
  incomeTaxShare: 1_000_000_000,
  vatShare: 2_000_000_000,
  federalEqualizationGrant: 500_217_406,
  tradeTaxRevenue: 300_000_000,
};

describe("one-party regional budget writes exactly one shape", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function wire() {
    const setup = <T>(name: string, data: T[]) => {
      db.collection(name);
      db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
        toArray: vi.fn().mockResolvedValue(data),
      });
      db.collectionMocks[name]!.findOne = vi.fn().mockResolvedValue(null);
      db.collectionMocks[name]!.bulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    };
    setup("states", [{ _id: "NE", countryId: "CN", population: 2_500_000, gdp: 8_158 }]);
    setup("statePolicies", []);
    setup("legislationTypes", []);
    setup("regionalBudgets", [{ _id: "NE", countryId: "CN", ...STALE_DE_FIELDS }]);
    setup("cabinetSettings", []);
    db.collection.mockImplementation((name: string) => db.collectionMocks[name]);
  }

  it("clears the foreign-shape fields it does not own", async () => {
    wire();
    const { processOnePartyRegionalBudgets } = await import("./cnRegionalBudget");
    await processOnePartyRegionalBudgets(db as unknown as Db, "CN", 600, "1953-default");

    const ops = db.collectionMocks.regionalBudgets!.bulkWrite.mock.calls[0]?.[0];
    expect(ops).toBeTruthy();
    const update = ops[0].updateOne.update;

    // It writes its own shape...
    expect(update.$set.centralTransferGrant).toBeGreaterThan(0);
    // ...and removes every field belonging to another country's shape, so the
    // shape-keyed reader cannot resolve the stale one.
    for (const key of Object.keys(STALE_DE_FIELDS)) {
      expect(update.$unset).toHaveProperty(key);
    }
    expect(update.$unset).toHaveProperty("nationalGrant");
    expect(update.$unset).toHaveProperty("unionGrant");
  });

  it("leaves the reader resolving the CN branch, not the stale DE one", async () => {
    wire();
    const { processOnePartyRegionalBudgets } = await import("./cnRegionalBudget");
    await processOnePartyRegionalBudgets(db as unknown as Db, "CN", 600, "1953-default");

    const ops = db.collectionMocks.regionalBudgets!.bulkWrite.mock.calls[0]?.[0];
    const update = ops[0].updateOne.update;

    // Apply the write the way Mongo would: $set then $unset.
    const stored: Record<string, unknown> = {
      _id: "NE",
      countryId: "CN",
      ...STALE_DE_FIELDS,
      ...update.$set,
    };
    for (const key of Object.keys(update.$unset)) delete stored[key];

    const shape = buildRegionalRevenueShape(stored as unknown as RegionalBudget);
    // The grant the region reports is the central transfer the nation books,
    // not the frozen equalization figure.
    expect(shape.grantAmount).toBe(update.$set.centralTransferGrant);
    expect(shape.revenue).not.toHaveProperty("incomeTaxShare");
  });

  it("is a no-op for a country with no onePartyRegionalBudget config", async () => {
    wire();
    const { processOnePartyRegionalBudgets } = await import("./cnRegionalBudget");
    const out = await processOnePartyRegionalBudgets(
      db as unknown as Db,
      "UK",
      600,
      "1953-default"
    );
    expect(out.regionsProcessed).toBe(0);
  });
});

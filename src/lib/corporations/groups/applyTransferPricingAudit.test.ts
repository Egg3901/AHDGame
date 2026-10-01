import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { applyTransferPricingAudit } from "./applyTransferPricingAudit";

vi.mock("./groupMembership", () => ({
  resolveFormalizedGroups: vi.fn(async () => ({
    membersByRootId: new Map([["root", ["supplier", "buyer"]]]),
    rootByCorpId: { get: () => "root" },
  })),
}));

describe("applyTransferPricingAudit accrual batching", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accrues all tracked agreements in one bulk write and one projected read", async () => {
    const supplierId = new ObjectId();
    const buyerId = new ObjectId();
    const agreementIds = [new ObjectId(), new ObjectId()];
    const bulkWrite = vi.fn().mockResolvedValue({ modifiedCount: 2 });
    const agreementFind = vi.fn(() => ({
      toArray: vi.fn(async () =>
        agreementIds.map((_id) => ({ _id, transferPricingExposureAnchor: 10 }))
      ),
    }));
    const corporationFind = vi.fn(() => ({
      project: vi.fn(() => ({
        toArray: vi.fn(async () => [
          { _id: supplierId, name: "Supplier", countryId: "US" },
          { _id: buyerId, name: "Buyer", countryId: "JP" },
        ]),
      })),
    }));
    const db = {
      collection: vi.fn((name: string) =>
        name === "corporations" ? { find: corporationFind } : { bulkWrite, find: agreementFind }
      ),
    } as unknown as Db;

    const result = await applyTransferPricingAudit(
      db,
      agreementIds.map((agreementId) => ({
        agreementId: agreementId.toString(),
        supplierCorpId: supplierId.toString(),
        buyerCorpId: buyerId.toString(),
        pricePremium: 0.1,
        premiumAnchor: 100,
      })),
      new Map([["US", 20]]),
      10,
      new Date("2026-01-01T00:00:00Z")
    );

    expect(result.positionsTracked).toBe(2);
    expect(bulkWrite).toHaveBeenCalledOnce();
    expect(bulkWrite.mock.calls[0]![0]).toHaveLength(2);
    expect(agreementFind).toHaveBeenCalledOnce();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
  marketAtLeast: vi.fn().mockReturnValue(true),
}));

let db: MockDb;
const supplierId = new ObjectId();
const buyerId = new ObjectId();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("supplyAgreements");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: "user1" },
  } as never);

  const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: supplierId, userId: "user1" },
  } as never);
  vi.mocked(requireCeo).mockReturnValue(null);
});

describe("proposeSupplyAgreement", () => {
  function propose(body: Record<string, unknown>) {
    return import("./supplyAgreements").then(({ proposeSupplyAgreement }) =>
      proposeSupplyAgreement(
        new Request("http://localhost/api/corporations/supplier/supply-agreements", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        supplierId.toString()
      )
    );
  }

  function seedFreightSupplier() {
    db.collection("states").findOne.mockImplementation(async (filter: { _id: string }) =>
      filter._id === "TX" || filter._id === "NY" ? { _id: filter._id } : null
    );
    db.collection("corporateSectors").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          sectorType: "logistics",
          capitalStock: 10_000,
          strategyId: "standard",
          productionPolicyLevel: 0,
          stateId: "TX",
        },
      ])
    );
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 10, currentYear: 1953 });
    db.collection("gameConfig").findOne.mockResolvedValue({ commandEconomyEnabled: false });
    db.collection("corporations").findOne.mockResolvedValue({ _id: new ObjectId() });
  }

  it("rejects a freight proposal that does not name the state it is fulfilled from", async () => {
    seedFreightSupplier();
    const response = await propose({
      buyerCorpId: new ObjectId().toString(),
      commodity: "freight",
      volumeCap: 100,
      pricePremium: 0,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("state");
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a freight proposal for a state with no freight plants", async () => {
    seedFreightSupplier();
    const response = await propose({
      buyerCorpId: new ObjectId().toString(),
      commodity: "freight",
      stateId: "NY",
      volumeCap: 100,
      pricePremium: 0,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("NY");
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });

  it("rejects an unknown state", async () => {
    seedFreightSupplier();
    const response = await propose({
      buyerCorpId: new ObjectId().toString(),
      commodity: "freight",
      stateId: "ZZ",
      volumeCap: 100,
      pricePremium: 0,
    });
    expect(response.status).toBe(400);
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });

  it("stores the state on a freight proposal sized against that state's plants", async () => {
    seedFreightSupplier();
    const response = await propose({
      buyerCorpId: new ObjectId().toString(),
      commodity: "freight",
      stateId: "TX",
      volumeCap: 1,
      pricePremium: 0,
    });
    expect(response.status).toBe(200);
    expect(db.collectionMocks.supplyAgreements.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        commodity: "freight",
        stateId: "TX",
        volumeCapBasis: "scaledCapacity",
        status: "pending",
        proposedByCorpId: supplierId,
        currentOffer: expect.objectContaining({
          revision: 1,
          proposedByCorpId: supplierId,
          volumeCap: 1,
          pricePremium: 0,
          exclusive: false,
        }),
        offers: [
          expect.objectContaining({
            revision: 1,
            proposedByCorpId: supplierId,
            volumeCap: 1,
            pricePremium: 0,
            exclusive: false,
          }),
        ],
      })
    );
  });

  it("lets the buyer initiate a proposal and notifies the supplier", async () => {
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: buyerId, userId: new ObjectId() },
    } as never);
    db.collection("corporateSectors").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          sectorType: "manufacturing",
          capitalStock: 10_000,
          strategyId: "standard",
          productionPolicyLevel: 0,
          stateId: "TX",
        },
      ])
    );
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 12, currentYear: 1953 });
    db.collection("gameConfig").findOne.mockResolvedValue({ commandEconomyEnabled: false });
    const supplierUserId = new ObjectId();
    db.collection("corporations").findOne.mockResolvedValue({
      _id: supplierId,
      name: "Gridworks",
      userId: supplierUserId,
    });

    const { proposeSupplyAgreement } = await import("./supplyAgreements");
    const response = await proposeSupplyAgreement(
      new Request("http://localhost/api/corporations/buyer/supply-agreements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          supplierCorpId: supplierId.toString(),
          commodity: "steel",
          volumeCap: 100,
          pricePremium: -0.1,
          durationTurns: 48,
        }),
      }),
      buyerId.toString()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(db.collectionMocks.supplyAgreements.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierCorpId: supplierId,
        buyerCorpId: buyerId,
        proposedByCorpId: buyerId,
        durationTurns: 48,
        currentOffer: expect.objectContaining({
          proposedByCorpId: buyerId,
          pricePremium: -0.1,
          durationTurns: 48,
        }),
      })
    );
    const { createNotification } = await import("@/lib/notifications");
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: supplierUserId,
        type: "corp_supply_agreement_offer",
      })
    );
  });

  it("ignores a state on a reachable commodity", async () => {
    seedFreightSupplier();
    db.collection("corporateSectors").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          sectorType: "manufacturing",
          capitalStock: 10_000,
          strategyId: "standard",
          stateId: "TX",
        },
      ])
    );
    const response = await propose({
      buyerCorpId: new ObjectId().toString(),
      commodity: "steel",
      stateId: "TX",
      volumeCap: 1,
      pricePremium: 0,
    });
    expect(response.status).toBe(200);
    const doc = db.collectionMocks.supplyAgreements.insertOne.mock.calls[0]![0] as {
      stateId?: string;
    };
    expect(doc.stateId).toBeUndefined();
  });

  it("rejects freight because corporation-wide agreements have no state identity", async () => {
    const { proposeSupplyAgreement } = await import("./supplyAgreements");
    const response = await proposeSupplyAgreement(
      new Request("http://localhost/api/corporations/supplier/supply-agreements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          buyerCorpId: new ObjectId().toString(),
          commodity: "freight",
          volumeCap: 100,
          pricePremium: 0,
        }),
      }),
      supplierId.toString()
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("state");
    expect(db.collectionMocks.supplyAgreements.insertOne).not.toHaveBeenCalled();
  });
});

describe("updateSupplyAgreement", () => {
  function update(body: Record<string, unknown>, corpId: ObjectId = buyerId) {
    return import("./supplyAgreements").then(({ updateSupplyAgreement }) =>
      import("@/lib/api/corporations/resolveQuery").then(({ resolveCorporation }) => {
        vi.mocked(resolveCorporation).mockResolvedValue({
          ok: true,
          corporation: { _id: corpId, userId: "user1" },
        } as never);
        return updateSupplyAgreement(
          new Request(
            "http://localhost/api/corporations/counterparty/supply-agreements/agreement",
            {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          ),
          corpId.toString(),
          new ObjectId().toString()
        );
      })
    );
  }

  function seedPendingAgreement(proposedByCorpId = supplierId, durationTurns?: number) {
    const agreementId = new ObjectId();
    db.collectionMocks.supplyAgreements.findOne.mockResolvedValue({
      _id: agreementId,
      supplierCorpId: supplierId,
      buyerCorpId: buyerId,
      commodity: "steel",
      volumeCap: 100,
      pricePremium: 0,
      exclusive: false,
      status: "pending",
      proposedByCorpId,
      ...(durationTurns !== undefined ? { durationTurns } : {}),
      currentOffer: {
        revision: 1,
        proposedByCorpId,
        volumeCap: 100,
        pricePremium: 0,
        exclusive: false,
        proposedAt: new Date("2026-09-12T00:00:00Z"),
      },
      offers: [
        {
          revision: 1,
          proposedByCorpId,
          volumeCap: 100,
          pricePremium: 0,
          exclusive: false,
          proposedAt: new Date("2026-09-12T00:00:00Z"),
        },
      ],
      createdAt: new Date("2026-09-12T00:00:00Z"),
      updatedAt: new Date("2026-09-12T00:00:00Z"),
    });
    db.collection("corporateSectors").find.mockReturnValue(
      createAsyncIterableCursor([
        {
          sectorType: "manufacturing",
          capitalStock: 10_000,
          strategyId: "standard",
          productionPolicyLevel: 0,
          stateId: "TX",
        },
      ])
    );
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 20, currentYear: 1953 });
    db.collection("gameConfig").findOne.mockResolvedValue({ commandEconomyEnabled: false });
    db.collection("corporations").findOne.mockResolvedValue({
      _id: supplierId,
      name: "Gridworks",
      userId: new ObjectId(),
    });
    return agreementId;
  }

  it("lets the receiving CEO counter and appends the new offer revision", async () => {
    seedPendingAgreement();
    const response = await update({
      action: "counter",
      volumeCap: 120,
      pricePremium: 0.05,
      exclusive: true,
      durationTurns: 48,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, status: "pending", revision: 2 });
    expect(db.collectionMocks.supplyAgreements.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", proposedByCorpId: supplierId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          volumeCap: 120,
          pricePremium: 0.05,
          exclusive: true,
          durationTurns: 48,
          proposedByCorpId: buyerId,
          currentOffer: expect.objectContaining({
            revision: 2,
            proposedByCorpId: buyerId,
          }),
        }),
        $push: {
          offers: expect.objectContaining({
            revision: 2,
            proposedByCorpId: buyerId,
            volumeCap: 120,
            pricePremium: 0.05,
            durationTurns: 48,
          }),
        },
      })
    );
  });

  it("lets the other side accept a buyer-initiated offer", async () => {
    seedPendingAgreement(buyerId, 48);
    const response = await update({ action: "accept" }, supplierId);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, status: "active" });
    expect(db.collectionMocks.supplyAgreements.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", proposedByCorpId: buyerId }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "active",
          startsAtTurn: 20,
          durationTurns: 48,
          expiresAtTurn: 68,
        }),
      })
    );
  });

  it("does not let the current offer author counter their own offer", async () => {
    seedPendingAgreement(supplierId);
    const response = await update(
      { action: "counter", volumeCap: 120, pricePremium: 0, exclusive: false },
      supplierId
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain("counterparty");
    expect(db.collectionMocks.supplyAgreements.updateOne).not.toHaveBeenCalled();
  });
});

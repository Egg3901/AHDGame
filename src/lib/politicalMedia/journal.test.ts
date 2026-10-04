import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import {
  applyPoliticalMediaOrderEffect,
  fundPoliticalMediaOrder,
  loadPoliticalMediaOrdersForClearing,
  politicalMediaOrderKey,
  resumePoliticalMediaOrderFunding,
  savePoliticalMediaSettlementPlan,
  settlePoliticalMediaOrder,
} from "./journal";
import { settlePoliticalAdMarket } from "./market";
import type { SectorClearingInput, SectorClearingResult } from "@/lib/market/clearing";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function setup() {
  const memory = createInMemoryDb();
  memory.seed("characters", [{ _id: "payer", cash: 250, actions: 4 }]);
  memory.seed("corporations", [{ _id: "corp", liquidCapital: 5 }]);
  const db = memory as unknown as Db;
  return { memory, db };
}

const funding = (targetStateId = "CA") => ({
  orderId: "order-1",
  source: "advertise" as const,
  createdTurn: 12,
  countryId: "US",
  targetStateId,
  payer: {
    collection: "characters" as const,
    documentId: "payer",
    path: "cash",
    currencyCode: "USD",
    localPerAnchor: 2,
    amountLocal: 100,
    currentActions: 4,
    actionCost: 1,
  },
});

const plan = {
  plannedTurn: 12,
  deliveredAnchor: 30,
  unfilledAnchor: 20,
  deliveredUnits: 3,
  sellers: [
    {
      allocationId: "alloc-1",
      sectorId: "media-sector",
      corporationId: "corp",
      units: 3,
      amountAnchor: 30,
      sellerLocalAmount: 45,
      sellerCurrencyCode: "EUR",
      sellerLocalPerAnchor: 1.5,
    },
  ],
};

describe("political media order journal", () => {
  it("projects only order data when loading current and open orders", async () => {
    const { memory, db } = setup();
    expect((await fundPoliticalMediaOrder(db, funding())).status).toBe("applied");
    const find = vi.spyOn(memory.collection("bankMoneyMoves"), "find");

    await loadPoliticalMediaOrdersForClearing(db, 12);

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "political-media-order",
        status: "applied",
        $or: expect.any(Array),
      }),
      { projection: { _id: 1, kind: 1, status: 1, politicalMediaOrder: 1 } }
    );
  });

  it("funds once, pays exact seller receipt, and refunds unfilled escrow at frozen payer FX", async () => {
    const { memory, db } = setup();

    expect((await fundPoliticalMediaOrder(db, funding())).status).toBe("applied");
    expect((await fundPoliticalMediaOrder(db, funding())).status).toBe("replayed");
    await savePoliticalMediaSettlementPlan(db, "order-1", plan);
    await expect(
      savePoliticalMediaSettlementPlan(db, "order-1", { ...plan, deliveredAnchor: 31 })
    ).rejects.toThrow("invalid settlement total");
    const results = await settlePoliticalMediaOrder(db, "order-1", 12);

    expect(results.every((result) => result.status === "applied")).toBe(true);
    expect(memory.collection("characters").docs[0]).toMatchObject({ cash: 190, actions: 3 });
    expect(memory.collection("corporations").docs[0]).toMatchObject({
      liquidCapital: 50,
      politicalMediaReceipts: {
        "order-1": { "alloc-1": expect.objectContaining({ sellerLocalAmount: 45 }) },
      },
    });
    const journal = memory
      .collection("bankMoneyMoves")
      .docs.find((row) => row._id === politicalMediaOrderKey("order-1"));
    expect(journal?.politicalMediaOrder).toMatchObject({
      status: "settled",
      escrowBalanceAnchor: 0,
    });
    expect((await settlePoliticalMediaOrder(db, "order-1", 13)).length).toBe(0);
    expect(memory.collection("characters").docs[0]?.cash).toBe(190);
  });

  it("replays a paid seller allocation after interruption before sector P&L publish", async () => {
    const { memory, db } = setup();
    const journal = memory.collection("bankMoneyMoves");
    expect((await fundPoliticalMediaOrder(db, funding())).status).toBe("applied");
    await savePoliticalMediaSettlementPlan(db, "order-1", plan);

    const write = journal.updateOne.bind(journal);
    const interrupt = vi
      .spyOn(journal, "updateOne")
      .mockImplementation(async (filter, update, options) => {
        const set = !Array.isArray(update)
          ? (update.$set as Record<string, unknown> | undefined)
          : undefined;
        if (set?.["politicalMediaOrder.status"] === "settled") {
          throw new Error("turn stopped before sector P&L publish");
        }
        return write(filter, update, options);
      });
    await expect(settlePoliticalMediaOrder(db, "order-1", 12)).rejects.toThrow(
      "turn stopped before sector P&L publish"
    );
    interrupt.mockRestore();

    expect(memory.collection("corporations").docs[0]?.liquidCapital).toBe(50);
    expect(memory.collection("characters").docs[0]?.cash).toBe(190);
    const pendingPnlReplay = await loadPoliticalMediaOrdersForClearing(db, 12);
    expect(pendingPnlReplay).toHaveLength(1);

    const sectorInput: SectorClearingInput = {
      sectorId: "media-sector",
      revenue: 100,
      supplyRates: { advertising: 0.5, entertainment_services: 0.5 },
      posture: 0,
    };
    const sectorClearing: SectorClearingResult = {
      factor: 0.5,
      soldFraction: 0.5,
      soldByCommodity: { advertising: 0.5, entertainment_services: 0.5 },
      effectivePosture: 0,
    };
    const published = settlePoliticalAdMarket({
      orders: [],
      persistedPlans: pendingPnlReplay
        .filter((order) => order.settlementPlan?.plannedTurn === 12)
        .map((order) => ({ orderId: order.orderId, plan: order.settlementPlan! })),
      offers: [
        {
          input: sectorInput,
          clearing: sectorClearing,
          corporationId: "corp",
          countryId: "US",
          stateId: "CA",
          basePrice: 240,
          priceRatio: 1,
          sellerCurrencyCode: "EUR",
          sellerLocalPerAnchor: 99,
          offeredUnits: 20,
        },
      ],
      clearingBySectorId: new Map([["media-sector", sectorClearing]]),
      clearingEnabled: true,
      qualityPremiumEnabled: true,
      turn: 12,
    });
    expect(published.sellerPayoutLocalByCorpId.get("corp")).toBe(45);
    expect(published.clearingBySectorId.get("media-sector")?.soldByCommodity?.advertising).toBe(
      0.65
    );

    await settlePoliticalMediaOrder(db, "order-1", 12);
    expect(memory.collection("corporations").docs[0]?.liquidCapital).toBe(50);
    expect(memory.collection("characters").docs[0]?.cash).toBe(190);
    expect(await applyPoliticalMediaOrderEffect(db, "order-1")).toBe(true);
    expect(await loadPoliticalMediaOrdersForClearing(db, 12)).toHaveLength(1);
    expect(await loadPoliticalMediaOrdersForClearing(db, 13)).toHaveLength(0);
  });

  it("rejects a changed target identity without taking a second payer debit", async () => {
    const { memory, db } = setup();

    expect((await fundPoliticalMediaOrder(db, funding())).status).toBe("applied");
    expect((await fundPoliticalMediaOrder(db, funding("NY"))).status).toBe("rejected");
    expect(memory.collection("characters").docs[0]?.cash).toBe(150);
  });

  it("does not create funded demand when the quoted payer balance is no longer available", async () => {
    const { memory, db } = setup();
    memory.collection("characters").docs[0]!.cash = 50;

    expect((await fundPoliticalMediaOrder(db, funding())).status).toBe("rejected");
    expect(memory.collection("characters").docs[0]?.cash).toBe(50);
    expect(memory.collection("bankMoneyMoves").docs[0]?.politicalMediaOrder).toMatchObject({
      status: "rejected",
      escrowBalanceAnchor: 0,
    });
  });

  it("resumes a crash after the escrow credit lands without repeating the funding debit", async () => {
    const { memory, db } = setup();
    const journal = memory.collection("bankMoneyMoves");
    const write = journal.updateOne.bind(journal);
    let interrupted = false;
    vi.spyOn(journal, "updateOne").mockImplementation(async (filter, update, options) => {
      const result = await write(filter, update, options);
      const increment = !Array.isArray(update)
        ? (update.$inc as Record<string, unknown> | undefined)
        : undefined;
      if (!interrupted && increment?.["politicalMediaOrder.escrowBalanceAnchor"] === 50) {
        interrupted = true;
        throw new Error("lost escrow acknowledgement");
      }
      return result;
    });

    await expect(fundPoliticalMediaOrder(db, funding())).rejects.toThrow(
      "lost escrow acknowledgement"
    );
    expect(memory.collection("characters").docs[0]?.cash).toBe(150);
    expect((await resumePoliticalMediaOrderFunding(db, "order-1")).status).toBe("applied");
    expect(memory.collection("characters").docs[0]?.cash).toBe(150);
    expect(journal.docs[0]?.politicalMediaOrder).toMatchObject({
      status: "open",
      escrowBalanceAnchor: 50,
    });
  });
});

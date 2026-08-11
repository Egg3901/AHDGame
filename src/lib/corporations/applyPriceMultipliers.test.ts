import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("applyPriceMultipliers — FTA threading", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("suppresses foreign-side tariff pulses for FTA-partnered corp HQs", async () => {
    // Setup: UK has fired four foreign-penalty energy pulses (would otherwise peg
    // the sentiment cap at -25%). A US-HQ corp with US:energy and UK:energy operations
    // should be exempt because UK and US are bound by an active FTA.
    const usCorpId = new ObjectId();
    const fundamentalPrice = 100;

    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("sentimentPulses");
    db.collection("organizationLegislation");

    db.collectionMocks["corporations"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: usCorpId,
          countryId: "US",
          type: "energy",
          fundamentalSharePrice: fundamentalPrice,
          sharePrice: fundamentalPrice, // start at 1.0× multiplier
          publicFloat: 0, // disable order-flow contribution
          totalShares: 10_000_000,
          orderFlowMultiplier: 1.0,
          orderFlowWindowBuyValue: 0,
          orderFlowWindowSellValue: 0,
        },
      ]),
    });

    db.collectionMocks["corporateSectors"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ corporationId: usCorpId, countryId: "UK", sectorType: "energy" }]),
    });

    db.collectionMocks["sentimentPulses"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(
        Array.from({ length: 4 }, () => ({
          _id: new ObjectId(),
          scope: "sector",
          countryId: "UK",
          sectorType: "energy",
          hqRelation: "foreign",
          initialImpact: -0.07,
          decayRate: 1.0,
          createdAt: new Date(0),
          eventType: "tariff_passed",
        }))
      ),
    });

    // Active FTA between UK and US — the pulses should be filtered out for this corp.
    db.collectionMocks["organizationLegislation"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          type: "free_trade_agreement",
          status: "active",
          parties: ["UK", "US"],
        },
      ]),
    });

    const { applyPriceMultipliers } = await import("./applyPriceMultipliers");
    const result = await applyPriceMultipliers();

    expect(result.updated).toBe(1);

    // The single bulkWrite call should contain a sharePrice equal to fundamental ×
    // 1.0 × 1.0 (sentiment fully filtered, order-flow neutralised by zero float).
    const corpsMock = db.collectionMocks["corporations"]!;
    expect(corpsMock.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = corpsMock.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { update: { $set: { sharePrice: number } } };
    }>;
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update.$set.sharePrice).toBeCloseTo(fundamentalPrice);
  });

  it("still applies foreign-side pulses to non-FTA-partner corps", async () => {
    // Same scenario, but the corp is HQ'd in CN (not in the UK FTA). The
    // sentiment cap should peg the multiplier at 0.75, producing a sharePrice
    // of 75 from a fundamental of 100.
    const cnCorpId = new ObjectId();
    const fundamentalPrice = 100;

    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("sentimentPulses");
    db.collection("organizationLegislation");

    db.collectionMocks["corporations"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: cnCorpId,
          countryId: "CN",
          type: "energy",
          fundamentalSharePrice: fundamentalPrice,
          sharePrice: fundamentalPrice,
          publicFloat: 0,
          totalShares: 10_000_000,
          orderFlowMultiplier: 1.0,
          orderFlowWindowBuyValue: 0,
          orderFlowWindowSellValue: 0,
        },
      ]),
    });

    db.collectionMocks["corporateSectors"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ corporationId: cnCorpId, countryId: "UK", sectorType: "energy" }]),
    });

    db.collectionMocks["sentimentPulses"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(
        Array.from({ length: 4 }, () => ({
          _id: new ObjectId(),
          scope: "sector",
          countryId: "UK",
          sectorType: "energy",
          hqRelation: "foreign",
          initialImpact: -0.07,
          decayRate: 1.0,
          createdAt: new Date(0),
          eventType: "tariff_passed",
        }))
      ),
    });

    // Same UK-US FTA, but this corp is in CN — still exposed to the penalty.
    db.collectionMocks["organizationLegislation"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          type: "free_trade_agreement",
          status: "active",
          parties: ["UK", "US"],
        },
      ]),
    });

    const { applyPriceMultipliers } = await import("./applyPriceMultipliers");
    await applyPriceMultipliers();

    const corpsMock = db.collectionMocks["corporations"]!;
    const ops = corpsMock.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { update: { $set: { sharePrice: number } } };
    }>;
    // 4 × −0.07 = −0.28 raw, clamped to −SENTIMENT_CAP=−0.25 → 0.75× multiplier.
    expect(ops[0].updateOne.update.$set.sharePrice).toBeCloseTo(fundamentalPrice * 0.75);
  });
});

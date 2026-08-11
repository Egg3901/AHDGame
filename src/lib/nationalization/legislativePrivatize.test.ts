import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("./privatizeAsset", () => ({
  privatizeAsset: vi.fn().mockResolvedValue({
    newCorporationId: new ObjectId(),
    sectorsCarved: 1,
    totalShares: 10_000_000,
    goldenShares: 0,
    proceedsLocal: 1000,
  }),
}));
vi.mock("@/lib/corporations/marketShare", () => ({
  fetchSectorMarketSharePercent: vi.fn().mockResolvedValue(0),
}));

describe("applyPrivatizeProvision", () => {
  let db: MockDb;
  const natCorpId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("gameState");
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
  });

  it("calls privatizeAsset for an in-country National Corporation source", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: natCorpId,
      countryId: "US",
      countryOwnerId: "US",
      ownershipState: "stateOwned",
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 12 });

    const { applyPrivatizeProvision } = await import("./legislativePrivatize");
    await applyPrivatizeProvision(db as unknown as Db, "US", {
      type: "privatize",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId: new ObjectId(), carveFraction: 1 }],
      newCorpName: "Floated Co",
      goldenSharePercent: 0,
    });

    const { privatizeAsset } = await import("./privatizeAsset");
    expect(privatizeAsset).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        countryId: "US",
        method: "ipo",
        turn: 12,
        newCorpName: "Floated Co",
        sourceNationalCorporationId: natCorpId,
      })
    );
  });

  it("no-ops when the source is not a National Corporation of the bill's country", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: natCorpId,
      countryId: "UK",
      countryOwnerId: "UK",
      ownershipState: "stateOwned",
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 1 });

    const { applyPrivatizeProvision } = await import("./legislativePrivatize");
    await applyPrivatizeProvision(db as unknown as Db, "US", {
      type: "privatize",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId: new ObjectId(), carveFraction: 1 }],
      newCorpName: "Wrong Country Co",
      goldenSharePercent: 0,
    });

    const { privatizeAsset } = await import("./privatizeAsset");
    expect(privatizeAsset).not.toHaveBeenCalled();
  });

  it("no-ops when the source is missing or not state-owned", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    const { applyPrivatizeProvision } = await import("./legislativePrivatize");
    await applyPrivatizeProvision(db as unknown as Db, "US", {
      type: "privatize",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId: new ObjectId(), carveFraction: 1 }],
      newCorpName: "Gone Co",
      goldenSharePercent: 0,
    });
    const { privatizeAsset } = await import("./privatizeAsset");
    expect(privatizeAsset).not.toHaveBeenCalled();
  });

  it("clamps the carve fraction to the anti-monopoly cap for a dominant holding", async () => {
    const sectorId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: natCorpId,
      countryId: "CN",
      countryOwnerId: "CN",
      ownershipState: "stateOwned",
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 40 });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: sectorId,
      corporationId: natCorpId,
      stateId: "XB",
      sectorType: "extraction",
      revenue: 1000,
    });
    const { fetchSectorMarketSharePercent } = await import("@/lib/corporations/marketShare");
    vi.mocked(fetchSectorMarketSharePercent).mockResolvedValue(100); // full monopoly

    const { applyPrivatizeProvision } = await import("./legislativePrivatize");
    await applyPrivatizeProvision(db as unknown as Db, "CN", {
      type: "privatize",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId, carveFraction: 1 }],
      newCorpName: "Monopoly Carve Co",
      goldenSharePercent: 0,
    });

    const { privatizeAsset } = await import("./privatizeAsset");
    expect(privatizeAsset).toHaveBeenCalledTimes(1);
    const call = vi.mocked(privatizeAsset).mock.calls[0][1];
    expect(call.selections).toHaveLength(1);
    // 30% market-control cap ÷ 100% share = max carve 0.3
    expect(call.selections[0].carveFraction).toBeCloseTo(0.3, 10);
  });

  it("leaves the carve fraction untouched when the holding is under the cap", async () => {
    const sectorId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: natCorpId,
      countryId: "US",
      countryOwnerId: "US",
      ownershipState: "stateOwned",
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 5 });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: sectorId,
      corporationId: natCorpId,
      stateId: "CA",
      sectorType: "technology",
      revenue: 100,
    });
    const { fetchSectorMarketSharePercent } = await import("@/lib/corporations/marketShare");
    vi.mocked(fetchSectorMarketSharePercent).mockResolvedValue(20); // small holding

    const { applyPrivatizeProvision } = await import("./legislativePrivatize");
    await applyPrivatizeProvision(db as unknown as Db, "US", {
      type: "privatize",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId, carveFraction: 1 }],
      newCorpName: "Small Carve Co",
      goldenSharePercent: 0,
    });

    const { privatizeAsset } = await import("./privatizeAsset");
    const call = vi.mocked(privatizeAsset).mock.calls[0][1];
    expect(call.selections[0].carveFraction).toBe(1);
  });

  it("logs and swallows engine errors so enactment is not aborted", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: natCorpId,
      countryId: "US",
      countryOwnerId: "US",
      ownershipState: "stateOwned",
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 3 });
    const { privatizeAsset } = await import("./privatizeAsset");
    vi.mocked(privatizeAsset).mockRejectedValueOnce(new Error("name taken"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { applyPrivatizeProvision } = await import("./legislativePrivatize");
    await expect(
      applyPrivatizeProvision(db as unknown as Db, "US", {
        type: "privatize",
        sourceNationalCorporationId: natCorpId,
        selections: [{ sectorId: new ObjectId(), carveFraction: 1 }],
        newCorpName: "Boom Co",
        goldenSharePercent: 0,
      })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[legislativePrivatize]"),
      expect.any(Error)
    );
    errorSpy.mockRestore();
  });
});

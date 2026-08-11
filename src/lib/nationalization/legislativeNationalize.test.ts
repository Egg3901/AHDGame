import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { STRATEGIC_NOTICE_TURNS } from "./constants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("./ownershipTransition", () => ({
  nationalizeWholeCorp: vi.fn().mockResolvedValue({
    nationalCorporationId: new ObjectId(),
    sectorsAbsorbed: 1,
    bondsAssumed: 0,
    shareholderPayoutAnchor: 100,
  }),
  nationalizeSector: vi.fn().mockResolvedValue({
    nationalCorporationId: new ObjectId(),
    compensationPaid: 50,
  }),
}));
// Default: no strategic designation, no monopoly. Individual tests override.
vi.mock("./strategicSectors", () => ({
  getDesignatedSectorTypes: vi.fn().mockResolvedValue(new Set()),
  corpHasStrategicSector: vi.fn().mockReturnValue(false),
}));
vi.mock("./monopolyTrigger", () => ({ getTopMarketSharePercent: vi.fn().mockResolvedValue(0) }));
vi.mock("./nationalizeSectorWide", () => ({
  nationalizeSectorWide: vi.fn().mockResolvedValue({
    affectedCorps: 2,
    sectorsCarved: 3,
    unownedCarved: 1,
    totalCompensationAnchor: 1000,
  }),
}));

describe("applyNationalizeProvision", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("countryLeaderStates");
    db.collection("gameState");
    db.collection("pendingNationalizations");
  });

  it("defers a player whole-corp taking into a pending-taking (notice window)", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "PlayerCo",
      countryId: "US",
      userId: new ObjectId(), // player-owned
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue({
      countryId: "US",
      governingPartyId: "3",
    });

    const { applyNationalizeProvision } = await import("./legislativeNationalize");
    await applyNationalizeProvision(db as unknown as Db, "US", {
      type: "nationalize",
      targetCorporationId: corpId,
    });

    const ins = db.collectionMocks.pendingNationalizations.insertOne.mock.calls[0][0];
    expect(ins.status).toBe("pending");
    expect(ins.noticeDeadlineTurn).toBe(42 + STRATEGIC_NOTICE_TURNS);
    expect(ins.triggers).toEqual(["supermajority"]); // player, no condition cited
    expect(ins.governingPartyId).toBe("3");
    expect(ins.targetCorporationId).toEqual(corpId);
    // Deferred — the transition does NOT run yet.
    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    expect(nationalizeWholeCorp).not.toHaveBeenCalled();
  });

  it("dispatches an industry-wide sector taking to nationalizeSectorWide", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue({
      countryId: "US",
      governingPartyId: "3",
    });
    const { applyNationalizeProvision } = await import("./legislativeNationalize");
    await applyNationalizeProvision(db as unknown as Db, "US", {
      type: "nationalize",
      targetSectorType: "technology",
      sectorCarveFraction: 0.4,
      sectorScope: "all",
    });
    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    expect(nationalizeSectorWide).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        countryId: "US",
        sectorType: "technology",
        carveFraction: 0.4,
        scope: "all",
        tier: "fair",
      })
    );
    // The whole-corp + single-sector primitives are NOT touched.
    const { nationalizeWholeCorp, nationalizeSector } = await import("./ownershipTransition");
    expect(nationalizeWholeCorp).not.toHaveBeenCalled();
    expect(nationalizeSector).not.toHaveBeenCalled();
  });

  it("frames a deferred player monopoly break-up with the monopoly trigger", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "MonopolyCo",
      countryId: "US",
      userId: new ObjectId(),
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 8 });
    const { getTopMarketSharePercent } = await import("./monopolyTrigger");
    vi.mocked(getTopMarketSharePercent).mockResolvedValueOnce(82); // monopoly

    const { applyNationalizeProvision } = await import("./legislativeNationalize");
    await applyNationalizeProvision(db as unknown as Db, "US", {
      type: "nationalize",
      targetCorporationId: corpId,
    });

    const ins = db.collectionMocks.pendingNationalizations.insertOne.mock.calls[0][0];
    expect(ins.triggers).toEqual(["monopoly"]);
    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    expect(nationalizeWholeCorp).not.toHaveBeenCalled();
  });

  it("routes a sector target to nationalizeSector", async () => {
    const corpId = new ObjectId();
    const sectorId = new ObjectId();
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: sectorId,
      corporationId: corpId,
      countryId: "US",
    });
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      countryId: "US",
      userId: null, // npc-owned
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 7 });

    const { applyNationalizeProvision } = await import("./legislativeNationalize");
    await applyNationalizeProvision(db as unknown as Db, "US", {
      type: "nationalize",
      targetSectorId: sectorId,
    });

    const { nationalizeSector } = await import("./ownershipTransition");
    expect(nationalizeSector).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        countryId: "US",
        sectorId,
        tier: "fair",
        consequence: expect.objectContaining({ method: "legislative", triggers: ["npc"] }),
      })
    );
  });

  it("skips a target still inside the re-nationalization cooldown", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "RecentlyPrivatized",
      countryId: "US",
      userId: new ObjectId(),
      privatizedAtTurn: 50,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 60 }); // 60-50 < cooldown

    const { applyNationalizeProvision } = await import("./legislativeNationalize");
    await applyNationalizeProvision(db as unknown as Db, "US", {
      type: "nationalize",
      targetCorporationId: corpId,
    });

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    expect(nationalizeWholeCorp).not.toHaveBeenCalled();
    expect(db.collectionMocks.pendingNationalizations.insertOne).not.toHaveBeenCalled();
  });

  it("skips a target in another country (jurisdiction) without throwing", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      countryId: "UK", // bill is US
      userId: new ObjectId(),
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 1 });

    const { applyNationalizeProvision } = await import("./legislativeNationalize");
    await applyNationalizeProvision(db as unknown as Db, "US", {
      type: "nationalize",
      targetCorporationId: corpId,
    });

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    expect(nationalizeWholeCorp).not.toHaveBeenCalled();
  });

  it("skips an already-state-owned target without throwing", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      countryId: "US",
      countryOwnerId: "US",
      ownershipState: "stateOwned",
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 1 });

    const { applyNationalizeProvision } = await import("./legislativeNationalize");
    await applyNationalizeProvision(db as unknown as Db, "US", {
      type: "nationalize",
      targetCorporationId: corpId,
    });

    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    expect(nationalizeWholeCorp).not.toHaveBeenCalled();
  });
});

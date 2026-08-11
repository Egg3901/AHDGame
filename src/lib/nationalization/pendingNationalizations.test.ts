import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("./ownershipTransition", () => ({
  nationalizeWholeCorp: vi.fn().mockResolvedValue({ nationalCorporationId: new ObjectId() }),
  nationalizeSector: vi.fn().mockResolvedValue({ nationalCorporationId: new ObjectId() }),
}));
vi.mock("./strategicSectors", () => ({
  getDesignatedSectorTypes: vi.fn().mockResolvedValue(new Set()),
  corpHasStrategicSector: vi.fn().mockReturnValue(false),
}));
vi.mock("./monopolyTrigger", () => ({ getTopMarketSharePercent: vi.fn().mockResolvedValue(0) }));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("processPendingNationalizations", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["pendingNationalizations", "corporations", "corporateSectors"]) {
      db.collection(n);
    }
  });

  it("cancels an executive monopoly taking whose share has dropped below threshold", async () => {
    const corpId = new ObjectId();
    const pendingId = new ObjectId();
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(
      cursor([
        {
          _id: pendingId,
          countryId: "US",
          targetCorporationId: corpId,
          tier: "fair",
          method: "executive",
          triggers: ["monopoly"],
          governingPartyId: null,
          noticeDeadlineTurn: 100,
          status: "pending",
        },
      ])
    );
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "PlayerCo",
      countryId: "US",
      userId: new ObjectId(),
    });
    // getTopMarketSharePercent mock defaults to 0 ⇒ monopoly cleared.

    const { processPendingNationalizations } = await import("./pendingNationalizations");
    const result = await processPendingNationalizations(db as unknown as Db, 100);

    expect(result.cancelled).toBe(1);
    expect(result.completed).toBe(0);
    const upd = db.collectionMocks.pendingNationalizations.updateOne.mock.calls[0];
    expect(upd[0]).toEqual({ _id: pendingId });
    expect(upd[1].$set.status).toBe("cancelled");
    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    expect(nationalizeWholeCorp).not.toHaveBeenCalled();
  });

  it("completes an executive taking whose condition still holds (monopoly persists)", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          countryId: "US",
          targetCorporationId: corpId,
          tier: "fair",
          method: "executive",
          triggers: ["monopoly"],
          governingPartyId: null,
          noticeDeadlineTurn: 100,
          status: "pending",
        },
      ])
    );
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "PlayerCo",
      countryId: "US",
      userId: new ObjectId(),
    });
    const { getTopMarketSharePercent } = await import("./monopolyTrigger");
    vi.mocked(getTopMarketSharePercent).mockResolvedValueOnce(82); // still a monopoly

    const { processPendingNationalizations } = await import("./pendingNationalizations");
    const result = await processPendingNationalizations(db as unknown as Db, 100);

    expect(result.completed).toBe(1);
    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    expect(nationalizeWholeCorp).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ corporationId: corpId, tier: "fair" })
    );
  });

  it("completes a legislative taking even after its cited trigger clears (passed bills are not curable)", async () => {
    // Regression for BYD #141: a legislatively-mandated taking must NOT auto-cancel
    // when the cited condition later clears (e.g. the corp's monopoly share collapsed
    // under a vacant CEO). The cure path is for automatic executive takings only.
    const corpId = new ObjectId();
    const pendingId = new ObjectId();
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(
      cursor([
        {
          _id: pendingId,
          countryId: "CN",
          targetCorporationId: corpId,
          tier: "fair",
          method: "legislative",
          triggers: ["monopoly"],
          governingPartyId: "1",
          noticeDeadlineTurn: 100,
          status: "pending",
        },
      ])
    );
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "BYD",
      countryId: "CN",
      userId: new ObjectId(),
    });
    const { getTopMarketSharePercent } = await import("./monopolyTrigger");
    vi.mocked(getTopMarketSharePercent).mockResolvedValueOnce(1.72); // monopoly long gone

    const { processPendingNationalizations } = await import("./pendingNationalizations");
    const result = await processPendingNationalizations(db as unknown as Db, 100);

    // Completes despite the cleared trigger — the legislature's mandate stands.
    expect(result.completed).toBe(1);
    expect(result.cancelled).toBe(0);
    const upd = db.collectionMocks.pendingNationalizations.updateOne.mock.calls[0];
    expect(upd[1].$set.status).toBe("completed");
    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    expect(nationalizeWholeCorp).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ corporationId: corpId, tier: "fair" })
    );
    // The monopoly re-check must be skipped entirely for legislative takings.
    expect(getTopMarketSharePercent).not.toHaveBeenCalled();
  });

  it("isolates a throwing taking (treasury unaffordable) without aborting the sweep", async () => {
    const failCorpId = new ObjectId();
    const okCorpId = new ObjectId();
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          countryId: "US",
          targetCorporationId: failCorpId,
          tier: "fair",
          method: "legislative",
          triggers: ["supermajority"],
          governingPartyId: null,
          noticeDeadlineTurn: 100,
          status: "pending",
        },
        {
          _id: new ObjectId(),
          countryId: "US",
          targetCorporationId: okCorpId,
          tier: "fair",
          method: "legislative",
          triggers: ["supermajority"],
          governingPartyId: null,
          noticeDeadlineTurn: 100,
          status: "pending",
        },
      ])
    );
    db.collectionMocks.corporations.findOne.mockImplementation(async (q: { _id: ObjectId }) => ({
      _id: q._id,
      name: "Co",
      countryId: "US",
      userId: new ObjectId(),
    }));
    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    vi.mocked(nationalizeWholeCorp)
      .mockRejectedValueOnce(new Error("Treasury cannot afford this compensation"))
      .mockResolvedValueOnce({ nationalCorporationId: new ObjectId() } as never);

    const { processPendingNationalizations } = await import("./pendingNationalizations");
    // Must not throw despite the first taking failing.
    const result = await processPendingNationalizations(db as unknown as Db, 100);

    // Second taking still completed; failed one left pending (1 completed, 0 cancelled).
    expect(result.completed).toBe(1);
    expect(result.cancelled).toBe(0);
    expect(nationalizeWholeCorp).toHaveBeenCalledTimes(2);
  });

  it("cancels (no-op) when the target is gone or already state-owned", async () => {
    db.collectionMocks.pendingNationalizations.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          countryId: "US",
          targetCorporationId: new ObjectId(),
          tier: "fair",
          method: "legislative",
          triggers: ["supermajority"],
          governingPartyId: null,
          noticeDeadlineTurn: 100,
          status: "pending",
        },
      ])
    );
    db.collectionMocks.corporations.findOne.mockResolvedValue(null); // gone

    const { processPendingNationalizations } = await import("./pendingNationalizations");
    const result = await processPendingNationalizations(db as unknown as Db, 100);
    expect(result.cancelled).toBe(1);
    const { nationalizeWholeCorp } = await import("./ownershipTransition");
    expect(nationalizeWholeCorp).not.toHaveBeenCalled();
  });
});

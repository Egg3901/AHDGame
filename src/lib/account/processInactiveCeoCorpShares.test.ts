import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const releaseMock = vi.fn();
const cleanupMock = vi.fn();
const notifyMock = vi.fn();

vi.mock("@/lib/corporations/releaseHeldSharesToFloat", () => ({
  releaseCorporationHeldSharesToFloat: (...args: unknown[]) => releaseMock(...args),
}));
vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCorporations: (...args: unknown[]) => cleanupMock(...args),
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: (...args: unknown[]) => notifyMock(...args),
}));

const TURN_MS = 60 * 60 * 1000;
const NOW = new Date("2026-06-25T00:00:00.000Z");
const ago = (turns: number) => new Date(NOW.getTime() - turns * TURN_MS);

// Two corporations.find calls happen in order: (1) issuers-with-corp-holders,
// (2) holder-corp eligibility. Queue results in that order.
function wireFinds(db: MockDb, issuers: unknown[], holderCorps: unknown[], users: unknown[]) {
  const corpFind = vi
    .fn()
    .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue(issuers) })
    .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue(holderCorps) });
  db.collection("corporations").find = corpFind;
  db.collection("users").find.mockReturnValue({ toArray: vi.fn().mockResolvedValue(users) });
}

// Warn-pass wiring: corporations.find fires three times — (1) issuers,
// (2) candidates, (3) corp-holder owners — plus characters.find for char holders.
function wireWarnFinds(
  db: MockDb,
  opts: {
    issuers: unknown[];
    candidates: unknown[];
    holderOwnerCorps: unknown[];
    holderChars: unknown[];
    users: unknown[];
  }
) {
  const corpFind = vi
    .fn()
    .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue(opts.issuers) })
    .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue(opts.candidates) })
    .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue(opts.holderOwnerCorps) });
  db.collection("corporations").find = corpFind;
  db.collection("characters").find = vi
    .fn()
    .mockReturnValue({ toArray: vi.fn().mockResolvedValue(opts.holderChars) });
  db.collection("users").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(opts.users),
  });
}

describe("processInactiveCeoCorpShares", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    releaseMock.mockResolvedValue({ sharesReleased: 0, corpsShareholderCleared: 0 });
    cleanupMock.mockResolvedValue({
      ordersCancelled: 0,
      listingsCancelled: 0,
      offersCancelled: 0,
    });
  });

  it("returns zeros when no issuer has a corporation shareholder", async () => {
    wireFinds(db, [], [], []);
    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });
    expect(result.corpsProcessed).toBe(0);
    expect(releaseMock).not.toHaveBeenCalled();
    expect(cleanupMock).not.toHaveBeenCalled();
  });

  it("releases a holder corp whose CEO is inactive", async () => {
    const issuer = new ObjectId();
    const holder = new ObjectId();
    const owner = new ObjectId();

    wireFinds(
      db,
      [{ _id: issuer, shareholders: [{ corporationId: holder, shares: 300 }] }],
      [{ _id: holder, userId: owner }],
      [{ _id: owner, lastActivity: ago(200) }]
    );
    releaseMock.mockResolvedValue({ sharesReleased: 300, corpsShareholderCleared: 1 });

    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: true,
    });

    expect(result.corpsProcessed).toBe(1);
    expect(result.sharesReleasedToFloat).toBe(300);
    expect(result.sharePositionsReleased).toBe(1);
    expect(cleanupMock).toHaveBeenCalledWith(db, [holder], NOW, true);
    expect(releaseMock).toHaveBeenCalledWith(db, holder, NOW);
  });

  it("leaves a holder corp with an active CEO untouched", async () => {
    const issuer = new ObjectId();
    const holder = new ObjectId();
    const owner = new ObjectId();

    wireFinds(
      db,
      [{ _id: issuer, shareholders: [{ corporationId: holder, shares: 300 }] }],
      [{ _id: holder, userId: owner }],
      [{ _id: owner, lastActivity: ago(10) }]
    );

    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });
    expect(result.corpsProcessed).toBe(0);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("skips non-candidate holder corps (vacant, imperial, npp, nationalized, country-owned)", async () => {
    const issuer = new ObjectId();
    const vacant = new ObjectId();
    const imperial = new ObjectId();
    const npp = new ObjectId();
    const nat = new ObjectId();
    const stateOwned = new ObjectId();
    const owner = new ObjectId();

    wireFinds(
      db,
      [
        {
          _id: issuer,
          shareholders: [
            { corporationId: vacant, shares: 1 },
            { corporationId: imperial, shares: 1 },
            { corporationId: npp, shares: 1 },
            { corporationId: nat, shares: 1 },
            { corporationId: stateOwned, shares: 1 },
          ],
        },
      ],
      [
        { _id: vacant, userId: owner, ceoVacant: true },
        { _id: imperial, userId: owner, ceoType: "imperial" },
        { _id: npp, userId: owner, ceoType: "npp" },
        { _id: nat, userId: owner, isNationalized: true },
        { _id: stateOwned, userId: owner, countryOwnerId: "US" },
      ],
      [{ _id: owner, lastActivity: ago(300) }]
    );

    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });
    expect(result.corpsProcessed).toBe(0);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("falls back to createdAt when the owner has no lastActivity", async () => {
    const issuer = new ObjectId();
    const holder = new ObjectId();
    const owner = new ObjectId();

    wireFinds(
      db,
      [{ _id: issuer, shareholders: [{ corporationId: holder, shares: 50 }] }],
      [{ _id: holder, userId: owner }],
      [{ _id: owner, createdAt: ago(300) }]
    );
    releaseMock.mockResolvedValue({ sharesReleased: 50, corpsShareholderCleared: 1 });

    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });
    expect(result.corpsProcessed).toBe(1);
    expect(result.sharesReleasedToFloat).toBe(50);
  });

  it("treats an owner with neither date as active (untouched)", async () => {
    const issuer = new ObjectId();
    const holder = new ObjectId();
    const owner = new ObjectId();

    wireFinds(
      db,
      [{ _id: issuer, shareholders: [{ corporationId: holder, shares: 50 }] }],
      [{ _id: holder, userId: owner }],
      [{ _id: owner }]
    );

    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });
    expect(result.corpsProcessed).toBe(0);
  });

  it("warns X's shareholders the turn the CEO enters the warning window", async () => {
    const issuer = new ObjectId();
    const X = new ObjectId();
    const owner = new ObjectId();
    const charHolder = new ObjectId();
    const charHolderUser = new ObjectId();
    const corpHolder = new ObjectId();
    const corpHolderCeo = new ObjectId();

    wireWarnFinds(db, {
      issuers: [{ _id: issuer, shareholders: [{ corporationId: X, shares: 100 }] }],
      candidates: [
        {
          _id: X,
          userId: owner,
          name: "X Corp",
          shareholders: [
            { characterId: charHolder, shares: 50 },
            { corporationId: corpHolder, shares: 25 },
          ],
        },
      ],
      holderOwnerCorps: [{ _id: corpHolder, userId: corpHolderCeo }],
      holderChars: [{ _id: charHolder, userId: charHolderUser }],
      users: [{ _id: owner, lastActivity: ago(144) }],
    });

    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });

    expect(result.corpsWarned).toBe(1);
    expect(result.warningsSent).toBe(2);
    expect(result.corpsProcessed).toBe(0);
    expect(releaseMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledTimes(1);

    const inputs = notifyMock.mock.calls[0][0] as Array<{
      userId: ObjectId;
      type: string;
      message: string;
    }>;
    expect(inputs.map((i) => i.userId.toString()).sort()).toEqual(
      [charHolderUser.toString(), corpHolderCeo.toString()].sort()
    );
    expect(inputs[0].type).toBe("corp_inactive_ceo_share_release_warning");
    expect(inputs[0].message).toContain("X Corp");
    expect(inputs[0].message).toContain("24 turns");
  });

  it("dedupes to one warning when a user holds X via two positions", async () => {
    const issuer = new ObjectId();
    const X = new ObjectId();
    const owner = new ObjectId();
    const charHolder = new ObjectId();
    const corpHolder = new ObjectId();
    const sharedUser = new ObjectId();

    wireWarnFinds(db, {
      issuers: [{ _id: issuer, shareholders: [{ corporationId: X, shares: 100 }] }],
      candidates: [
        {
          _id: X,
          userId: owner,
          name: "X Corp",
          shareholders: [
            { characterId: charHolder, shares: 50 },
            { corporationId: corpHolder, shares: 25 },
          ],
        },
      ],
      holderOwnerCorps: [{ _id: corpHolder, userId: sharedUser }],
      holderChars: [{ _id: charHolder, userId: sharedUser }],
      users: [{ _id: owner, lastActivity: ago(144) }],
    });

    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });

    expect(result.warningsSent).toBe(1);
    const inputs = notifyMock.mock.calls[0][0] as unknown[];
    expect(inputs).toHaveLength(1);
  });

  it("skips corp holders with no userId and fund/npp/imperial holders", async () => {
    const issuer = new ObjectId();
    const X = new ObjectId();
    const owner = new ObjectId();
    const vacantCorpHolder = new ObjectId();

    wireWarnFinds(db, {
      issuers: [{ _id: issuer, shareholders: [{ corporationId: X, shares: 100 }] }],
      candidates: [
        {
          _id: X,
          userId: owner,
          name: "X Corp",
          shareholders: [
            { corporationId: vacantCorpHolder, shares: 25 },
            { fundId: new ObjectId(), shares: 10 },
            { nppId: new ObjectId(), shares: 10 },
            { imperialCharacterId: new ObjectId(), shares: 10 },
          ],
        },
      ],
      holderOwnerCorps: [{ _id: vacantCorpHolder }], // no userId
      holderChars: [],
      users: [{ _id: owner, lastActivity: ago(144) }],
    });

    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });

    expect(result.corpsWarned).toBe(1);
    expect(result.warningsSent).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("does not warn between the window and release", async () => {
    const issuer = new ObjectId();
    const X = new ObjectId();
    const owner = new ObjectId();

    wireWarnFinds(db, {
      issuers: [{ _id: issuer, shareholders: [{ corporationId: X, shares: 100 }] }],
      candidates: [
        {
          _id: X,
          userId: owner,
          name: "X Corp",
          shareholders: [{ characterId: new ObjectId(), shares: 5 }],
        },
      ],
      holderOwnerCorps: [],
      holderChars: [],
      users: [{ _id: owner, lastActivity: ago(150) }],
    });

    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });

    expect(result.corpsWarned).toBe(0);
    expect(result.corpsProcessed).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("releases past 168 without warning", async () => {
    const issuer = new ObjectId();
    const X = new ObjectId();
    const owner = new ObjectId();

    wireWarnFinds(db, {
      issuers: [{ _id: issuer, shareholders: [{ corporationId: X, shares: 100 }] }],
      candidates: [
        {
          _id: X,
          userId: owner,
          name: "X Corp",
          shareholders: [{ characterId: new ObjectId(), shares: 5 }],
        },
      ],
      holderOwnerCorps: [],
      holderChars: [],
      users: [{ _id: owner, lastActivity: ago(200) }],
    });
    releaseMock.mockResolvedValue({ sharesReleased: 100, corpsShareholderCleared: 1 });

    const { processInactiveCeoCorpShares } = await import("./processInactiveCeoCorpShares");
    const result = await processInactiveCeoCorpShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });

    expect(result.corpsProcessed).toBe(1);
    expect(result.corpsWarned).toBe(0);
    expect(result.warningsSent).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

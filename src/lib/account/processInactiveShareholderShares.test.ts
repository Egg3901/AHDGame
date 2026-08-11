import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const releaseMock = vi.fn();
const cleanupMock = vi.fn();

vi.mock("@/lib/corporations/releaseCharacterHeldSharesToFloat", () => ({
  releaseCharacterHeldSharesToFloat: (...args: unknown[]) => releaseMock(...args),
}));
vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCharacters: (...args: unknown[]) => cleanupMock(...args),
}));

const TURN_MS = 60 * 60 * 1000;
const NOW = new Date("2026-06-25T00:00:00.000Z");
const ago = (turns: number) => new Date(NOW.getTime() - turns * TURN_MS);

function wireCollections(db: MockDb, corps: unknown[], chars: unknown[], users: unknown[]) {
  db.collection("corporations").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(corps),
  });
  db.collection("characters").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(chars),
  });
  db.collection("users").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(users),
  });
}

describe("processInactiveShareholderShares", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    releaseMock.mockResolvedValue({ sharesReleased: 0, positionsReleased: 0 });
    cleanupMock.mockResolvedValue({
      ordersCancelled: 0,
      listingsCancelled: 0,
      offersCancelled: 0,
    });
  });

  it("returns zeros and does nothing when no corp has character shareholders", async () => {
    wireCollections(db, [], [], []);
    const { processInactiveShareholderShares } = await import("./processInactiveShareholderShares");
    const result = await processInactiveShareholderShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });
    expect(result.usersProcessed).toBe(0);
    expect(releaseMock).not.toHaveBeenCalled();
    expect(cleanupMock).not.toHaveBeenCalled();
  });

  it("sweeps a non-exempt holding of an inactive user and excludes their owned corp", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const ownedCorp = new ObjectId();
    const otherCorp = new ObjectId();

    wireCollections(
      db,
      [
        // user owns this corp AND holds shares in it → exempt
        {
          _id: ownedCorp,
          userId,
          ceoId: charId,
          shareholders: [{ characterId: charId, shares: 1000 }],
        },
        // user holds shares here, does not own → swept
        {
          _id: otherCorp,
          userId: new ObjectId(),
          shareholders: [{ characterId: charId, shares: 400 }],
        },
      ],
      [{ _id: charId, userId }],
      [{ _id: userId, lastActivity: ago(200) }]
    );
    releaseMock.mockResolvedValue({ sharesReleased: 400, positionsReleased: 1 });

    const { processInactiveShareholderShares } = await import("./processInactiveShareholderShares");
    const result = await processInactiveShareholderShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: true,
    });

    expect(result.usersProcessed).toBe(1);
    expect(result.charactersProcessed).toBe(1);
    expect(result.sharesReleasedToFloat).toBe(400);
    expect(result.sharePositionsReleased).toBe(1);

    const exclude = (releaseMock.mock.calls[0][3] as { excludeCorporationIds: ObjectId[] })
      .excludeCorporationIds;
    expect(exclude.map((id) => id.toString())).toEqual([ownedCorp.toString()]);

    expect(cleanupMock).toHaveBeenCalledWith(db, [charId], NOW, true, {
      excludeCorporationIds: [ownedCorp],
    });
  });

  it("leaves an active holder untouched", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corp = new ObjectId();

    wireCollections(
      db,
      [{ _id: corp, userId: new ObjectId(), shareholders: [{ characterId: charId, shares: 100 }] }],
      [{ _id: charId, userId }],
      [{ _id: userId, lastActivity: ago(10) }]
    );

    const { processInactiveShareholderShares } = await import("./processInactiveShareholderShares");
    const result = await processInactiveShareholderShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });
    expect(result.usersProcessed).toBe(0);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("treats a holder with neither date as active (untouched)", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corp = new ObjectId();

    wireCollections(
      db,
      [{ _id: corp, userId: new ObjectId(), shareholders: [{ characterId: charId, shares: 100 }] }],
      [{ _id: charId, userId }],
      [{ _id: userId }]
    );

    const { processInactiveShareholderShares } = await import("./processInactiveShareholderShares");
    const result = await processInactiveShareholderShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });
    expect(result.usersProcessed).toBe(0);
  });

  it("skips an inactive user whose only holdings are in their own corp", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const ownedCorp = new ObjectId();

    wireCollections(
      db,
      [
        {
          _id: ownedCorp,
          userId,
          ceoId: charId,
          shareholders: [{ characterId: charId, shares: 9000 }],
        },
      ],
      [{ _id: charId, userId }],
      [{ _id: userId, lastActivity: ago(300) }]
    );

    const { processInactiveShareholderShares } = await import("./processInactiveShareholderShares");
    const result = await processInactiveShareholderShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });
    expect(result.usersProcessed).toBe(0);
    expect(releaseMock).not.toHaveBeenCalled();
    expect(cleanupMock).not.toHaveBeenCalled();
  });

  it("exempts a corp where the user sits as CEO but does not own (ceoId fallback)", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const ceoCorp = new ObjectId();
    const otherCorp = new ObjectId();

    wireCollections(
      db,
      [
        // user is CEO here (ceoId === their char) though userId differs → exempt
        {
          _id: ceoCorp,
          userId: new ObjectId(),
          ceoId: charId,
          shareholders: [{ characterId: charId, shares: 500 }],
        },
        {
          _id: otherCorp,
          userId: new ObjectId(),
          shareholders: [{ characterId: charId, shares: 600 }],
        },
      ],
      [{ _id: charId, userId }],
      [{ _id: userId, lastActivity: ago(300) }]
    );
    releaseMock.mockResolvedValue({ sharesReleased: 600, positionsReleased: 1 });

    const { processInactiveShareholderShares } = await import("./processInactiveShareholderShares");
    await processInactiveShareholderShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });

    const exclude = (releaseMock.mock.calls[0][3] as { excludeCorporationIds: ObjectId[] })
      .excludeCorporationIds;
    expect(exclude.map((id) => id.toString())).toEqual([ceoCorp.toString()]);
  });

  it("falls back to createdAt when lastActivity is missing", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corp = new ObjectId();

    wireCollections(
      db,
      [{ _id: corp, userId: new ObjectId(), shareholders: [{ characterId: charId, shares: 250 }] }],
      [{ _id: charId, userId }],
      [{ _id: userId, createdAt: ago(300) }]
    );
    releaseMock.mockResolvedValue({ sharesReleased: 250, positionsReleased: 1 });

    const { processInactiveShareholderShares } = await import("./processInactiveShareholderShares");
    const result = await processInactiveShareholderShares(db as unknown as Db, {
      now: NOW,
      forexEnabled: false,
    });
    expect(result.usersProcessed).toBe(1);
    expect(result.sharesReleasedToFloat).toBe(250);
  });
});

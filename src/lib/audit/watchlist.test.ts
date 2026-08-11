import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { WatchlistEntry } from "@/lib/db/types/watchlist";

let db: MockDb;

const watchedUserId = new ObjectId();
const addedByUserId = new ObjectId();
const otherUserId = new ObjectId();

function makeEntry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    _id: new ObjectId(),
    userId: watchedUserId,
    addedBy: addedByUserId,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  db = createMockDb();
  db.collection("watchlist");
  db.collection("users");
  db.collection("actionAuditLog");
  db.collection("altLinks");
  db.collectionMocks.actionAuditLog!.countDocuments.mockResolvedValue(0);
  db.collectionMocks.actionAuditLog!.find.mockReturnValue({
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  });
  db.collectionMocks.altLinks!.find.mockReturnValue({
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  });
});

describe("buildWatchlistViews", () => {
  it("returns an empty array without touching users/actionAuditLog/altLinks for an empty entry list", async () => {
    const { buildWatchlistViews } = await import("./watchlist");
    const result = await buildWatchlistViews(db as unknown as Db, [], true);
    expect(result).toEqual([]);
    expect(db.collectionMocks.users!.find).not.toHaveBeenCalled();
  });

  it("computes newActivityCount/newLinks strictly after the lastNotifiedTurn baseline", async () => {
    db.collectionMocks.users!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: watchedUserId, username: "suspectA", isBanned: false },
        { _id: addedByUserId, username: "mod1" },
      ]),
    });
    db.collectionMocks.actionAuditLog!.countDocuments.mockImplementation(
      (filter: Record<string, unknown>) => Promise.resolve(filter.turn ? 2 : 9)
    );
    db.collectionMocks.altLinks!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue([
          { userA: watchedUserId, userB: otherUserId, confidence: 0.55, turn: 42 },
        ]),
    });

    const { buildWatchlistViews } = await import("./watchlist");
    const [view] = await buildWatchlistViews(
      db as unknown as Db,
      [makeEntry({ lastNotifiedTurn: 40 })],
      true
    );

    expect(view.alerts.sinceTurn).toBe(40);
    expect(view.alerts.newActivityCount).toBe(2);
    expect(view.alerts.hasNewActivity).toBe(true);
    expect(view.activity.totalActions).toBe(9);
    expect(view.alerts.hasNewLinks).toBe(true);
    expect(view.alerts.newLinks[0]).toEqual({
      userId: otherUserId.toString(),
      username: null,
      confidence: 0.55,
      turn: 42,
    });

    // The altLinks query is filtered to `turn > lastNotifiedTurn` server-side.
    expect(db.collectionMocks.altLinks!.find).toHaveBeenCalledWith(
      expect.objectContaining({ turn: { $gt: 40 } })
    );
  });

  it("no alerts when nothing happened after the baseline", async () => {
    db.collectionMocks.users!.find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

    const { buildWatchlistViews } = await import("./watchlist");
    const [view] = await buildWatchlistViews(
      db as unknown as Db,
      [makeEntry({ lastNotifiedTurn: 100 })],
      false
    );

    expect(view.alerts.hasNewActivity).toBe(false);
    expect(view.alerts.hasNewLinks).toBe(false);
    expect(view.alerts.newLinks).toEqual([]);
  });
});

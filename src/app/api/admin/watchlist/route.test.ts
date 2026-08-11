import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));

let db: MockDb;

const watchedUserId = new ObjectId();
const addedByUserId = new ObjectId();
const otherUserId = new ObjectId();

function makeEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new ObjectId(),
    userId: watchedUserId,
    addedBy: addedByUserId,
    reason: "Suspected ring operator",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("watchlist");
  db.collection("users");
  db.collection("gameState");
  db.collection("actionAuditLog");
  db.collection("altLinks");
  db.collectionMocks.gameState!.findOne.mockResolvedValue({ _id: "current", currentTurn: 500 });
  db.collectionMocks.actionAuditLog!.countDocuments.mockResolvedValue(0);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

async function mockModerator(isAdmin: boolean, userId = new ObjectId().toString()) {
  const { requireModerator } = await import("@/lib/api/requireModerator");
  vi.mocked(requireModerator).mockResolvedValue({
    ok: true,
    user: { userId, username: "staff1", isAdmin },
  } as Awaited<ReturnType<typeof requireModerator>>);
}

async function mockForbidden() {
  const { requireModerator } = await import("@/lib/api/requireModerator");
  vi.mocked(requireModerator).mockResolvedValue({
    ok: false,
    response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
  } as Awaited<ReturnType<typeof requireModerator>>);
}

function get() {
  return import("./route").then(({ GET }) => GET());
}

function post(body: unknown) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request("http://localhost/api/admin/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    )
  );
}

describe("GET /api/admin/watchlist", () => {
  it("returns 403 when not a moderator/admin", async () => {
    await mockForbidden();
    const res = await get();
    expect(res.status).toBe(403);
  });

  it("lists entries with an activity summary and alert flags computed since lastNotifiedTurn", async () => {
    await mockModerator(true);
    db.collectionMocks.watchlist!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([makeEntry({ lastNotifiedTurn: 500 })]),
    });
    db.collectionMocks.users!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: watchedUserId, username: "suspectA", isBanned: false },
        { _id: addedByUserId, username: "mod1" },
      ]),
    });
    db.collectionMocks.actionAuditLog!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          ts: new Date("2026-01-05T00:00:00Z"),
          turn: 510,
          action: "wire.send",
          category: "money",
          outcome: "ok",
        },
      ]),
    });
    db.collectionMocks.actionAuditLog!.countDocuments.mockImplementation(
      (filter: Record<string, unknown>) => Promise.resolve(filter.turn ? 3 : 12)
    );
    db.collectionMocks.altLinks!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue([
          { userA: watchedUserId, userB: otherUserId, confidence: 0.72, turn: 505 },
        ]),
    });

    const res = await get();
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.currentTurn).toBe(500);
    expect(data.entries).toHaveLength(1);
    const entry = data.entries[0];
    expect(entry.userId).toBe(watchedUserId.toString());
    expect(entry.username).toBe("suspectA");
    expect(entry.addedByName).toBe("mod1");
    expect(entry.lastNotifiedTurn).toBe(500);
    expect(entry.activity.totalActions).toBe(12);
    expect(entry.activity.recentActions).toHaveLength(1);
    expect(entry.activity.lastActionTurn).toBe(510);
    // Alerts baseline is lastNotifiedTurn (500): the new-activity count comes
    // from the `turn > 500` countDocuments call (mocked to 3 above).
    expect(entry.alerts.sinceTurn).toBe(500);
    expect(entry.alerts.newActivityCount).toBe(3);
    expect(entry.alerts.hasNewActivity).toBe(true);
    // The altLinks row (turn 505 > 500) is a new link since review.
    expect(entry.alerts.hasNewLinks).toBe(true);
    expect(entry.alerts.newLinks).toHaveLength(1);
    expect(entry.alerts.newLinks[0].userId).toBe(otherUserId.toString());
    expect(entry.alerts.newLinks[0].confidence).toBe(0.72);
  });

  it("treats a never-reviewed entry's entire history as outstanding (baseline 0)", async () => {
    await mockModerator(false);
    db.collectionMocks.watchlist!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([makeEntry()]), // no lastNotifiedTurn
    });
    db.collectionMocks.users!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: watchedUserId, username: "suspectA" }]),
    });
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

    let capturedFilter: Record<string, unknown> | undefined;
    db.collectionMocks.actionAuditLog!.countDocuments.mockImplementation(
      (filter: Record<string, unknown>) => {
        if (filter.turn) capturedFilter = filter;
        return Promise.resolve(0);
      }
    );

    const res = await get();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries[0].alerts.sinceTurn).toBe(0);
    expect(capturedFilter?.turn).toEqual({ $gt: 0 });
  });

  it("returns an empty list without querying detail collections when nothing is watched", async () => {
    await mockModerator(false);
    db.collectionMocks.watchlist!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const res = await get();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toEqual([]);
    expect(db.collectionMocks.users!.find).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/watchlist", () => {
  it("returns 403 when not a moderator/admin", async () => {
    await mockForbidden();
    const res = await post({ userId: watchedUserId.toString() });
    expect(res.status).toBe(403);
  });

  it("rejects a malformed userId", async () => {
    await mockModerator(true);
    const res = await post({ userId: "not-an-id" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid JSON body", async () => {
    await mockModerator(true);
    const res = await import("./route").then(({ POST }) =>
      POST(
        new Request("http://localhost/api/admin/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the user does not exist", async () => {
    await mockModerator(true);
    db.collectionMocks.users!.findOne.mockResolvedValue(null);
    const res = await post({ userId: watchedUserId.toString() });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the user is already watched", async () => {
    await mockModerator(true);
    db.collectionMocks.users!.findOne.mockResolvedValue({ _id: watchedUserId });
    db.collectionMocks.watchlist!.findOne.mockResolvedValue(makeEntry());
    const res = await post({ userId: watchedUserId.toString(), reason: "dup" });
    expect(res.status).toBe(409);
  });

  it("moderators (not just admins) can add an entry", async () => {
    const modId = new ObjectId().toString();
    await mockModerator(false, modId);
    db.collectionMocks.users!.findOne.mockResolvedValue({ _id: watchedUserId });
    db.collectionMocks.watchlist!.findOne.mockResolvedValue(null);
    db.collectionMocks.watchlist!.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.users!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: watchedUserId, username: "suspectA" }]),
    });
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

    const res = await post({ userId: watchedUserId.toString(), reason: "flagged by mod" });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.entry.userId).toBe(watchedUserId.toString());
    expect(data.entry.reason).toBe("flagged by mod");
    expect(data.entry.addedBy).toBe(modId);

    expect(db.collectionMocks.watchlist!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: watchedUserId,
        addedBy: new ObjectId(modId),
        reason: "flagged by mod",
      })
    );
  });

  it("returns 409 when a concurrent duplicate-key error races the findOne check", async () => {
    await mockModerator(true);
    db.collectionMocks.users!.findOne.mockResolvedValue({ _id: watchedUserId });
    db.collectionMocks.watchlist!.findOne.mockResolvedValue(null);
    db.collectionMocks.watchlist!.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );

    const res = await post({ userId: watchedUserId.toString() });
    expect(res.status).toBe(409);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/notifications/notificationBundle", () => ({
  getNotificationBundleUserIds: vi.fn((user: { _id: ObjectId }) => [user._id]),
  resolveAccountFilter: vi.fn((param: string | null, ids: ObjectId[]) => ({
    ok: true,
    userIds: ids,
  })),
  resolveCharacterProfileFilter: vi.fn(() => ({ ok: true, characterId: null })),
}));

const testUserId = new ObjectId();
const notificationId = new ObjectId();

let db: MockDb;

beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  db.collection("notifications");
  db.collection("users");
  db.collection("characters");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: testUserId.toString() },
  } as never);

  // Default user fixture for PATCH (loadBundleContext skipped in PATCH — user lookup done inline)
  db.collectionMocks.users!.findOne.mockResolvedValue({
    _id: testUserId,
    notificationBundleUserIds: [],
  });
});

describe("PATCH /api/notifications — archive action", () => {
  it("calls updateOne with $set archivedAt when action is archive", async () => {
    const { PATCH } = await import("./route");

    const request = new Request("http://localhost/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: notificationId.toString(), action: "archive" }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(200);

    const updateOneMock = db.collectionMocks.notifications!.updateOne;
    expect(updateOneMock).toHaveBeenCalledOnce();
    const [, update] = updateOneMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(update).toHaveProperty("$set.archivedAt");
    expect(update.$set).toMatchObject({ read: true });
    const archivedAt = (update.$set as Record<string, unknown>).archivedAt;
    expect(archivedAt).toBeInstanceOf(Date);
  });
});

describe("PATCH /api/notifications — snooze action", () => {
  it("calls updateOne with $set snoozedUntil ~1h ahead when snoozeMinutes:60", async () => {
    const before = Date.now();
    const { PATCH } = await import("./route");

    const request = new Request("http://localhost/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: notificationId.toString(), action: "snooze", snoozeMinutes: 60 }),
    });

    const res = await PATCH(request);
    expect(res.status).toBe(200);

    const updateOneMock = db.collectionMocks.notifications!.updateOne;
    expect(updateOneMock).toHaveBeenCalledOnce();
    const [, update] = updateOneMock.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(update).toHaveProperty("$set.snoozedUntil");
    const snoozedUntil = (update.$set as Record<string, unknown>).snoozedUntil as Date;
    expect(snoozedUntil).toBeInstanceOf(Date);
    const diffMs = snoozedUntil.getTime() - before;
    // Should be ~60 minutes ahead (within 5 second tolerance)
    expect(diffMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5000);
    expect(diffMs).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
  });
});

describe("GET /api/notifications — archive/snooze filtering", () => {
  function makeAggregateResult(notifications: unknown[]) {
    return [{ notifications, total: [{ count: notifications.length }] }];
  }

  beforeEach(async () => {
    // loadBundleContext: users.findOne + users.find (for labelDocs) + characters.find
    const labelCursor = {
      project: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: testUserId, username: "tester", displayName: "Tester" }]),
    };
    const charCursor = {
      find: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    // users.findOne for the bundle user
    db.collectionMocks.users!.findOne.mockResolvedValue({
      _id: testUserId,
      notificationBundleUserIds: [],
      username: "tester",
      displayName: "Tester",
    });
    // users.find for label resolution
    db.collectionMocks.users!.find.mockReturnValue(labelCursor);
    // characters.find for profile scope
    db.collectionMocks.characters!.find.mockReturnValue(charCursor);
  });

  function makeAggregateMock(onFacetQuery: (q: Record<string, unknown>) => void) {
    // The GET handler runs 3 aggregate calls in parallel:
    //   1. unreadByUserAgg — has $group stage
    //   2. unreadByCharacterAgg — has $group stage
    //   3. listResult (facet) — has $facet stage; this one has the query we care about
    return vi.fn().mockImplementation((pipeline: unknown[]) => {
      const stages = pipeline as Array<Record<string, unknown>>;
      const hasFacet = stages.some((s) => s.$facet);
      if (hasFacet) {
        const matchStage = stages.find((s) => s.$match);
        if (matchStage) onFacetQuery(matchStage.$match as Record<string, unknown>);
        return { toArray: vi.fn().mockResolvedValue(makeAggregateResult([])) };
      }
      // unread aggregates — return empty arrays (no $group rows to iterate)
      return { toArray: vi.fn().mockResolvedValue([]) };
    });
  }

  it("GET without include=archived omits archived notifications (archivedAt: {$exists: false} in query)", async () => {
    let capturedQuery: Record<string, unknown> | null = null;
    db.collectionMocks.notifications!.aggregate = makeAggregateMock((q) => {
      capturedQuery = q;
    });
    db.collectionMocks.notifications!.countDocuments.mockResolvedValue(0);

    const { GET } = await import("./route");
    const request = new Request("http://localhost/api/notifications");
    const res = await GET(request);
    expect(res.status).toBe(200);

    expect(capturedQuery).not.toBeNull();
    expect(capturedQuery!.archivedAt).toEqual({ $exists: false });
  });

  it("GET with ?include=archived does NOT add archivedAt exists filter", async () => {
    let capturedQuery: Record<string, unknown> | null = null;
    db.collectionMocks.notifications!.aggregate = makeAggregateMock((q) => {
      capturedQuery = q;
    });
    db.collectionMocks.notifications!.countDocuments.mockResolvedValue(0);

    const { GET } = await import("./route");
    const request = new Request("http://localhost/api/notifications?include=archived");
    const res = await GET(request);
    expect(res.status).toBe(200);

    expect(capturedQuery).not.toBeNull();
    expect(capturedQuery!.archivedAt).toBeUndefined();
  });

  it("GET without include=snoozed adds $and snoozedUntil filter", async () => {
    let capturedQuery: Record<string, unknown> | null = null;
    db.collectionMocks.notifications!.aggregate = makeAggregateMock((q) => {
      capturedQuery = q;
    });
    db.collectionMocks.notifications!.countDocuments.mockResolvedValue(0);

    const { GET } = await import("./route");
    const request = new Request("http://localhost/api/notifications");
    const res = await GET(request);
    expect(res.status).toBe(200);

    expect(capturedQuery).not.toBeNull();
    const andClauses = capturedQuery!.$and as Array<Record<string, unknown>>;
    expect(Array.isArray(andClauses)).toBe(true);
    const snoozeClause = andClauses.find((c) => c.$or !== undefined);
    expect(snoozeClause).toBeDefined();
  });
});

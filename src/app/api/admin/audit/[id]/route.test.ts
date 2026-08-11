import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));

function makeRecord(overrides: Partial<ActionAuditRecord> = {}): ActionAuditRecord {
  return {
    _id: new ObjectId(),
    ts: new Date("2026-07-21T00:00:00.000Z"),
    turn: 100,
    traceId: "turn:100:testPhase",
    source: "api",
    action: "wire.send",
    category: "money",
    actor: { kind: "player", userId: new ObjectId(), characterId: new ObjectId() },
    subject: { type: "character", id: new ObjectId() },
    outcome: "ok",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    net: { ipHash: "abc123" },
    meta: { raw: "sensitive" },
    refs: { financialTxLogId: new ObjectId() },
    ...overrides,
  };
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function chainFind(rows: ActionAuditRecord[]) {
  return () => ({ sort: () => ({ limit: () => ({ toArray: async () => rows }) }) });
}

describe("GET /api/admin/audit/[id]", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("actionAuditLog");
    db.collectionMocks.actionAuditLog.find.mockImplementation(chainFind([]));
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns 403 when not at least a moderator", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    const forbidden = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    vi.mocked(requireModerator).mockResolvedValue({ ok: false, response: forbidden } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx(new ObjectId().toString()));
    expect(res.status).toBe(403);
  });

  it("returns 400 for a malformed id", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "mod", isAdmin: false },
    } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx("not-an-id"));
    expect(res.status).toBe(400);
  });

  it("moderator: an admin-category record 404s (existence not revealed) and findOne is called with the category guard", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "mod", isAdmin: false },
    } as never);
    // Simulates real Mongo: the {category: {$ne: "admin"}} guard means an
    // admin-category record's _id simply doesn't match anything.
    db.collectionMocks.actionAuditLog.findOne.mockResolvedValue(null);

    const id = new ObjectId().toString();
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx(id));
    expect(res.status).toBe(404);

    const [filterArg, optionsArg] = db.collectionMocks.actionAuditLog.findOne.mock.calls[0];
    expect(filterArg).toEqual({ _id: new ObjectId(id), category: { $ne: "admin" } });
    expect(optionsArg).toEqual({ projection: { net: 0, meta: 0 } });
  });

  it("moderator: a visible record has net/meta stripped and related rows use the same guard+projection", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "mod", isAdmin: false },
    } as never);

    const record = makeRecord();
    const strippedRecord = { ...record };
    delete (strippedRecord as Partial<ActionAuditRecord>).net;
    delete (strippedRecord as Partial<ActionAuditRecord>).meta;
    db.collectionMocks.actionAuditLog.findOne.mockResolvedValue(strippedRecord);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx(record._id.toString()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record.net).toBeUndefined();
    expect(body.record.meta).toBeUndefined();
    // ObjectId round-trips to its hex string through JSON serialization.
    expect(body.related.refs).toEqual({
      financialTxLogId: record.refs!.financialTxLogId!.toHexString(),
    });
    expect(body.related.actorRecent).toEqual([]);
    expect(body.related.subjectHistory).toEqual([]);

    // actorRecent + subjectHistory queries both carry the category guard and projection.
    const calls = db.collectionMocks.actionAuditLog.find.mock.calls;
    expect(calls.length).toBe(2);
    for (const [filterArg, optionsArg] of calls) {
      expect(filterArg.category).toEqual({ $ne: "admin" });
      expect(optionsArg).toEqual({ projection: { net: 0, meta: 0 } });
    }
  });

  it("admin: sees raw net/meta and refs on the record", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "admin", isAdmin: true },
    } as never);

    const record = makeRecord({ category: "admin", action: "admin.ban" });
    db.collectionMocks.actionAuditLog.findOne.mockResolvedValue(record);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx(record._id.toString()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record.net).toEqual({ ipHash: "abc123" });
    expect(body.record.meta).toEqual({ raw: "sensitive" });
    expect(body.related.refs).toEqual({
      financialTxLogId: record.refs!.financialTxLogId!.toHexString(),
    });

    const [filterArg, optionsArg] = db.collectionMocks.actionAuditLog.findOne.mock.calls[0];
    expect(filterArg).toEqual({ _id: record._id });
    expect(optionsArg).toEqual({ projection: undefined });
  });
});

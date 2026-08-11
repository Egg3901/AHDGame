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
    actor: { kind: "player", userId: new ObjectId() },
    subject: { type: "character", id: new ObjectId() },
    outcome: "ok",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    net: { ipHash: "abc123", fingerprint: "fp1" },
    meta: { raw: "sensitive" },
    ...overrides,
  };
}

function chainFind(rows: ActionAuditRecord[]) {
  return () => ({ sort: () => ({ limit: () => ({ toArray: async () => rows }) }) });
}

describe("GET /api/admin/audit", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("actionAuditLog");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns 403 when the caller is not at least a moderator", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    const forbidden = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    vi.mocked(requireModerator).mockResolvedValue({ ok: false, response: forbidden } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/audit"));
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid filter param", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "mod", isAdmin: false },
    } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/audit?category=bogus"));
    expect(res.status).toBe(400);
  });

  it("moderator: excludes admin-category rows and strips net/meta via projection", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "mod", isAdmin: false },
    } as never);

    // Simulate what real Mongo would actually return under the projection:
    // net/meta absent.
    const strippedRow = makeRecord();
    delete (strippedRow as Partial<ActionAuditRecord>).net;
    delete (strippedRow as Partial<ActionAuditRecord>).meta;
    db.collectionMocks.actionAuditLog.find.mockImplementation(chainFind([strippedRow]));

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/audit"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].net).toBeUndefined();
    expect(body.rows[0].meta).toBeUndefined();
    expect(body.truncated).toBe(false);

    const [filterArg, optionsArg] = db.collectionMocks.actionAuditLog.find.mock.calls[0];
    expect(filterArg.category).toEqual({ $ne: "admin" });
    expect(optionsArg).toEqual({ projection: { net: 0, meta: 0 } });
  });

  it("moderator: an explicit category=admin filter yields zero rows and cannot be satisfied", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "mod", isAdmin: false },
    } as never);
    db.collectionMocks.actionAuditLog.find.mockImplementation(chainFind([]));

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/audit?category=admin"));
    expect(res.status).toBe(200);

    const [filterArg] = db.collectionMocks.actionAuditLog.find.mock.calls[0];
    expect(filterArg.category).toEqual({ $eq: "admin", $ne: "admin" });
  });

  it("admin: sees admin-category rows and raw net/meta (no projection)", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "admin", isAdmin: true },
    } as never);

    const adminRow = makeRecord({ category: "admin", action: "admin.ban" });
    db.collectionMocks.actionAuditLog.find.mockImplementation(chainFind([adminRow]));

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/audit?category=admin"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows[0].net).toEqual({ ipHash: "abc123", fingerprint: "fp1" });
    expect(body.rows[0].meta).toEqual({ raw: "sensitive" });

    const [filterArg, optionsArg] = db.collectionMocks.actionAuditLog.find.mock.calls[0];
    expect(filterArg.category).toBe("admin");
    expect(optionsArg).toEqual({ projection: undefined });
  });

  it("marks the page truncated and returns nextCursor when more rows exist beyond the limit", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "admin", isAdmin: true },
    } as never);

    // limit=1 → route fetches 2; second row indicates truncation.
    const rows = [makeRecord(), makeRecord()];
    db.collectionMocks.actionAuditLog.find.mockImplementation(chainFind(rows));

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/audit?limit=1"));
    const body = await res.json();
    expect(body.truncated).toBe(true);
    expect(body.rows).toHaveLength(1);
    expect(body.nextCursor).toBe(rows[0]._id.toHexString());
  });
});

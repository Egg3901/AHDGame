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
    seq: 0,
    source: "api",
    action: "wire.send",
    category: "money",
    actor: { kind: "player", userId: new ObjectId() },
    subject: { type: "character", id: new ObjectId() },
    outcome: "ok",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    net: { ipHash: "abc123" },
    meta: { raw: "sensitive" },
    ...overrides,
  };
}

function ctx(traceId: string) {
  return { params: Promise.resolve({ traceId }) };
}

function chainFind(rows: ActionAuditRecord[]) {
  return () => ({ sort: () => ({ limit: () => ({ toArray: async () => rows }) }) });
}

describe("GET /api/admin/audit/trace/[traceId]", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("actionAuditLog");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns 403 when not at least a moderator", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    const forbidden = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    vi.mocked(requireModerator).mockResolvedValue({ ok: false, response: forbidden } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx("turn:100:testPhase"));
    expect(res.status).toBe(403);
  });

  it("returns 400 for a blank traceId", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "mod", isAdmin: false },
    } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx("  "));
    expect(res.status).toBe(400);
  });

  it("moderator: excludes admin-category rows and strips net/meta", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "mod", isAdmin: false },
    } as never);

    const strippedRow = makeRecord({ seq: 0 });
    delete (strippedRow as Partial<ActionAuditRecord>).net;
    delete (strippedRow as Partial<ActionAuditRecord>).meta;
    db.collectionMocks.actionAuditLog.find.mockImplementation(chainFind([strippedRow]));

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx("turn:100:testPhase"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.traceId).toBe("turn:100:testPhase");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].net).toBeUndefined();
    expect(body.rows[0].meta).toBeUndefined();

    const [filterArg, optionsArg] = db.collectionMocks.actionAuditLog.find.mock.calls[0];
    expect(filterArg).toEqual({ traceId: "turn:100:testPhase", category: { $ne: "admin" } });
    expect(optionsArg).toEqual({ projection: { net: 0, meta: 0 } });
  });

  it("admin: sees the full trace including admin-category rows and raw net/meta", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), username: "admin", isAdmin: true },
    } as never);

    const rows = [
      makeRecord({ seq: 0, category: "money" }),
      makeRecord({ seq: 1, category: "admin", action: "admin.ban" }),
    ];
    db.collectionMocks.actionAuditLog.find.mockImplementation(chainFind(rows));

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost"), ctx("turn:100:testPhase"));
    const body = await res.json();
    expect(body.rows).toHaveLength(2);
    expect(body.rows[1].category).toBe("admin");
    expect(body.rows[1].net).toEqual({ ipHash: "abc123" });

    const [filterArg, optionsArg] = db.collectionMocks.actionAuditLog.find.mock.calls[0];
    expect(filterArg).toEqual({ traceId: "turn:100:testPhase" });
    expect(optionsArg).toEqual({ projection: undefined });
  });
});

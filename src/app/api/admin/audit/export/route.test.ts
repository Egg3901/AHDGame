import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, createAsyncIterableCursor, type MockDb } from "@/lib/test-utils/mockDb";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

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
    net: { ipHash: "abc123" },
    meta: { raw: "sensitive" },
    ...overrides,
  };
}

async function readNdjson(res: Response): Promise<unknown[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("GET /api/admin/audit/export", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("actionAuditLog");
    db.collectionMocks.actionAuditLog.countDocuments.mockResolvedValue(0);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns 403 for a non-admin caller (moderators are not granted export)", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const forbidden = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    vi.mocked(requireAdmin).mockResolvedValue({ ok: false, response: forbidden } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/audit/export"));
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid filter param", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: new ObjectId().toString(), username: "admin", isAdmin: true },
    } as never);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/audit/export?outcome=bogus"));
    expect(res.status).toBe(400);
  });

  it("streams NDJSON rows including raw net/meta (admin-only export sees everything)", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: new ObjectId().toString(), username: "admin", isAdmin: true },
    } as never);

    const rows = [makeRecord({ category: "admin", action: "admin.ban" }), makeRecord()];
    db.collectionMocks.actionAuditLog.find.mockReturnValue(createAsyncIterableCursor(rows));
    db.collectionMocks.actionAuditLog.countDocuments.mockResolvedValue(rows.length);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/audit/export"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(res.headers.get("X-Capped")).toBe("false");

    const parsed = (await readNdjson(res)) as Array<{ category: string; net?: unknown }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].category).toBe("admin");
    expect(parsed[0].net).toEqual({ ipHash: "abc123" });
  });

  it("sets X-Capped when the matching set exceeds the export cap", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: new ObjectId().toString(), username: "admin", isAdmin: true },
    } as never);

    db.collectionMocks.actionAuditLog.find.mockReturnValue(
      createAsyncIterableCursor([makeRecord()])
    );
    // Simulate countDocuments hitting the (limit + 1) cap.
    db.collectionMocks.actionAuditLog.countDocuments.mockResolvedValue(50_001);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/audit/export"));
    expect(res.headers.get("X-Capped")).toBe("true");
  });

  it("ignores a cursor param — export always starts fresh, not paginated", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: new ObjectId().toString(), username: "admin", isAdmin: true },
    } as never);

    db.collectionMocks.actionAuditLog.find.mockReturnValue(createAsyncIterableCursor([]));

    const { GET } = await import("./route");
    const cursor = new ObjectId().toString();
    await GET(new Request(`http://localhost/api/admin/audit/export?cursor=${cursor}`));

    const [filterArg] = db.collectionMocks.actionAuditLog.find.mock.calls[0];
    expect(filterArg._id).toBeUndefined();
  });
});

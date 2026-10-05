import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
});

async function asAdmin() {
  const { getDb } = await import("@/lib/mongodb");
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: { userId: "a" } } as never);
}

describe("GET /api/admin/telemetry/research", () => {
  it("rejects a non-admin before reading anything", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { NextResponse } = await import("next/server");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    } as never);
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/admin/telemetry/research?panel=trade"));
    expect(res.status).toBe(403);
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("rejects an unbounded window with 400", async () => {
    await asAdmin();
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 5000 });
    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://x/api/admin/telemetry/research?panel=trade&fromTurn=0&toTurn=5000")
    );
    expect(res.status).toBe(400);
  });

  it("returns a self-describing, uncached envelope", async () => {
    await asAdmin();
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 50 });
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/admin/telemetry/research?panel=country-turn"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({
      panel: "country-turn",
      rows: [],
      nextCursor: null,
      turnRange: { from: 0, to: 50 },
    });
    expect(body.units.missing).toBeDefined();
  });

  it("rejects a window before the live retention boundary with the boundary", async () => {
    await asAdmin();
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 2000 });
    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        "http://x/api/admin/telemetry/research?panel=country-turn&fromTurn=1000&toTurn=1100"
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("RESEARCH_WINDOW_BEFORE_RETENTION");
    expect(body.availableFromTurn).toBe(2000 - 504);
    expect(body.retentionTurns).toBe(504);
  });

  it("serves a window inside the live retention", async () => {
    await asAdmin();
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 2000 });
    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        "http://x/api/admin/telemetry/research?panel=country-turn&fromTurn=1600&toTurn=1700"
      )
    );
    expect(res.status).toBe(200);
  });
});

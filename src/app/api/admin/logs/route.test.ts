import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

function makeLog(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new ObjectId(),
    category: "account",
    action: "account_created",
    username: "player1",
    characterName: null,
    adminUsername: null,
    details: null,
    createdAt: new Date("2026-08-27T23:09:20.060Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("adminLogs");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

/** Stub the find().sort().limit().toArray() chain the route uses. */
function seedLogs(docs: unknown[]) {
  db.collectionMocks.adminLogs.find.mockReturnValue({
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(docs),
  });
}

async function mockAdmin() {
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { _id: new ObjectId(), username: "admin1", isAdmin: true },
  } as unknown as Awaited<ReturnType<typeof requireAdmin>>);
}

describe("GET /api/admin/logs", () => {
  it("returns 403 when not an admin", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as Awaited<ReturnType<typeof requireAdmin>>);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/logs"));

    expect(res.status).toBe(403);
  });

  // The 2026-08-28 admin-panel outage. `adminLogs` is written by ad-hoc heal
  // scripts as well as the app, and some rows carry a structured object in
  // `details`. The route used to pass it through, so it reached the client and
  // `{log.details}` in LogsTab threw React error #31 ("Objects are not valid as
  // a React child") — which escaped to the admin error boundary and replaced the
  // WHOLE panel with "Couldn't load admin panel", on every load, because the row
  // sat in the default limit=100 window and in the `account` category the tab
  // opens on.
  it("serialises an object-valued details into a string", async () => {
    await mockAdmin();
    seedLogs([
      makeLog({
        action: "general_traits_refunded",
        details: {
          characterId: "6a77b5d218e42bc9dfb159f2",
          refundedPoints: 19,
          traitsCleared: 19,
          reason: "Player mistakenly trained general traits across categories",
          backupId: "backup-1",
        },
      }),
    ]);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/logs"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(typeof body.logs[0].details).toBe("string");
    // Serialised rather than dropped, so the admin can still read the payload.
    expect(body.logs[0].details).toContain("refundedPoints");
  });

  // Same bug class, same blast radius: `action` is rendered as the display
  // label whenever it has no ACTION_CONFIG entry, so an object there reaches
  // JSX exactly as `details` did. These two are contract-non-nullable, so they
  // floor at "" rather than null.
  it("coerces object-valued action and username without nulling them", async () => {
    await mockAdmin();
    seedLogs([
      makeLog({
        action: { kind: "migration", ticket: 1044 },
        username: { legacy: "unmigrated" },
      }),
    ]);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/logs"));
    const body = await res.json();

    expect(typeof body.logs[0].action).toBe("string");
    expect(typeof body.logs[0].username).toBe("string");
    expect(body.logs[0].action).toContain("migration");
  });

  it("floors a missing action or username at empty string, not null", async () => {
    await mockAdmin();
    seedLogs([makeLog({ action: undefined, username: null })]);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/logs"));
    const body = await res.json();

    expect(body.logs[0].action).toBe("");
    expect(body.logs[0].username).toBe("");
  });

  it("passes a string details through unchanged and maps empty to null", async () => {
    await mockAdmin();
    seedLogs([makeLog({ details: "appointed to office" }), makeLog({ details: "" })]);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/admin/logs"));
    const body = await res.json();

    expect(body.logs[0].details).toBe("appointed to office");
    expect(body.logs[1].details).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(),
}));

let db: MockDb;
const ELECTION_ID = new ObjectId().toString();

/** Captures the filter/sort/limit the route hands to Mongo. */
function stubWireRows(rows: Array<Record<string, unknown>>) {
  const calls: { filter?: unknown; sort?: unknown; limit?: number } = {};
  const cursor = {
    sort: vi.fn((s: unknown) => {
      calls.sort = s;
      return cursor;
    }),
    limit: vi.fn((n: number) => {
      calls.limit = n;
      return cursor;
    }),
    toArray: vi.fn().mockResolvedValue(rows),
  };
  db.collection("wireEvents").find.mockImplementation((f: unknown) => {
    calls.filter = f;
    return cursor;
  });
  return calls;
}

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("wireEvents");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);

  // Default: the route param resolves to a race with the id in the path.
  const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
  vi.mocked(resolveElectionRouteParam).mockResolvedValue({
    ok: true,
    election: { _id: new ObjectId(ELECTION_ID) },
  } as never);
});

async function callRoute(url: string, id = ELECTION_ID) {
  const { GET } = await import("./route");
  return GET(new Request(url), { params: Promise.resolve({ id }) });
}

describe("GET /api/elections/[id]/wire", () => {
  it("returns the race's headlines newest first", async () => {
    const now = new Date("2026-09-03T12:00:00.000Z");
    const older = new Date("2026-09-03T11:00:00.000Z");
    const calls = stubWireRows([
      { headline: "PENNSYLVANIA CALLED FOR VANCE BY 1.4", timestamp: now },
      { headline: "TIER 2 DELEGATES LOCKED: 1,240 AWARDED", timestamp: older },
    ]);

    const res = await callRoute(`http://t/api/elections/${ELECTION_ID}/wire`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.items).toHaveLength(2);
    expect(body.items[0].headline).toContain("PENNSYLVANIA");
    expect(body.items[0].timestamp).toBe(now.toISOString());
    expect(calls.sort).toEqual({ timestamp: -1 });
  });

  it("scopes the query to the election in the path", async () => {
    const calls = stubWireRows([]);
    await callRoute(`http://t/api/elections/${ELECTION_ID}/wire`);
    expect(calls.filter).toEqual({ electionId: ELECTION_ID });
  });

  it("narrows to one campaign when campaignId is supplied", async () => {
    const calls = stubWireRows([]);
    await callRoute(`http://t/api/elections/${ELECTION_ID}/wire?campaignId=camp1`);
    expect(calls.filter).toEqual({ electionId: ELECTION_ID, campaignId: "camp1" });
  });

  it("defaults to 8 headlines", async () => {
    const calls = stubWireRows([]);
    await callRoute(`http://t/api/elections/${ELECTION_ID}/wire`);
    expect(calls.limit).toBe(8);
  });

  it("honours an explicit in-range limit", async () => {
    const calls = stubWireRows([]);
    await callRoute(`http://t/api/elections/${ELECTION_ID}/wire?limit=3`);
    expect(calls.limit).toBe(3);
  });

  it("rejects a limit above the cap rather than serving an unbounded page", async () => {
    stubWireRows([]);
    const res = await callRoute(`http://t/api/elections/${ELECTION_ID}/wire?limit=500`);
    expect(res.status).toBe(400);
  });

  it("rejects a malformed limit", async () => {
    stubWireRows([]);
    const res = await callRoute(`http://t/api/elections/${ELECTION_ID}/wire?limit=abc`);
    expect(res.status).toBe(400);
  });

  it("rejects a malformed election id", async () => {
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: false,
      reason: "invalid_id",
    } as never);
    stubWireRows([]);
    const res = await callRoute("http://t/api/elections/not-an-id/wire", "not-an-id");
    expect(res.status).toBe(400);
  });

  it("accepts a seat slug and scopes the feed to the race it resolves to", async () => {
    // The election pages address races as `US-president`, not only by ObjectId;
    // a slug used to 400 here, so the ticker never loaded on those URLs.
    const resolvedId = new ObjectId();
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: { _id: resolvedId },
    } as never);

    const calls = stubWireRows([]);
    const res = await callRoute("http://t/api/elections/US-president/wire", "US-president");

    expect(res.status).toBe(200);
    expect(calls.filter).toEqual({ electionId: resolvedId.toString() });
  });

  it("reports a race that does not exist as not found", async () => {
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: false,
      reason: "not_found",
    } as never);
    stubWireRows([]);
    const res = await callRoute("http://t/api/elections/ZZ-nothing/wire", "ZZ-nothing");
    expect(res.status).toBe(404);
  });

  it("returns an empty list, not a 404, for a race with no wire traffic", async () => {
    stubWireRows([]);
    const res = await callRoute(`http://t/api/elections/${ELECTION_ID}/wire`);
    expect(res.status).toBe(200);
    expect((await res.json()).items).toEqual([]);
  });

  it("requires authentication", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: NextJsonUnauthorized(),
    } as never);

    const res = await callRoute(`http://t/api/elections/${ELECTION_ID}/wire`);
    expect(res.status).toBe(401);
  });
});

function NextJsonUnauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

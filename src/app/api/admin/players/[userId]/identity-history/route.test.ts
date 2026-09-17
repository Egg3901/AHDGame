import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { IdentityObservation } from "@/lib/db/types/identityObservation";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireModerator", () => ({ requireModerator: vi.fn() }));

const USER_ID = new ObjectId("507f1f77bcf86cd799439011");
const OTHER_ID = new ObjectId("507f191e810c19729de860ea");
const RAW_IP = "68.192.35.139";

let db: MockDb;

function run(userId: ObjectId, value: string, day: number): IdentityObservation {
  return {
    userId,
    track: "ip",
    value,
    firstSeen: new Date(Date.UTC(2026, 8, day)),
    lastSeen: new Date(Date.UTC(2026, 8, day)),
    observations: 1,
    source: "login",
    datesKnown: true,
  };
}

/** Wire the identityObservations collection mock to serve `rows`. */
function seed(rows: IdentityObservation[], sharers: ObjectId[] = [USER_ID]) {
  const coll = db.collection("identityObservations");
  coll.countDocuments.mockResolvedValue(rows.length);
  coll.find.mockReturnValue({
    sort: () => ({
      skip: (s: number) => ({
        limit: (l: number) => ({ toArray: async () => rows.slice(s, s + l) }),
      }),
    }),
  });
  coll.aggregate.mockReturnValue({
    toArray: async () =>
      [...new Set(rows.map((r) => r.value))].map((value) => ({ _id: value, users: sharers })),
  });
}

async function callRoute(userId: string, query: string, isAdmin: boolean) {
  const { requireModerator } = await import("@/lib/api/requireModerator");
  vi.mocked(requireModerator).mockResolvedValue({
    ok: true,
    user: { isAdmin },
  } as unknown as Awaited<ReturnType<typeof requireModerator>>);
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/admin/players/${userId}/identity-history${query}`), {
    params: Promise.resolve({ userId }),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("GET /api/admin/players/[userId]/identity-history", () => {
  it("rejects a malformed userId with 400", async () => {
    const res = await callRoute("not-an-object-id", "?track=ip", true);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown track with 400", async () => {
    const res = await callRoute(USER_ID.toHexString(), "?track=banana", true);
    expect(res.status).toBe(400);
  });

  it("rejects a missing track with 400", async () => {
    const res = await callRoute(USER_ID.toHexString(), "", true);
    expect(res.status).toBe(400);
  });

  it("returns 403 for a caller who is not a moderator", async () => {
    const { requireModerator } = await import("@/lib/api/requireModerator");
    vi.mocked(requireModerator).mockResolvedValue({
      ok: false,
      response: NextResponseForbidden(),
    } as unknown as Awaited<ReturnType<typeof requireModerator>>);
    const { GET } = await import("./route");
    const res = await GET(
      new Request(
        `http://localhost/api/admin/players/${USER_ID.toHexString()}/identity-history?track=ip`
      ),
      { params: Promise.resolve({ userId: USER_ID.toHexString() }) }
    );
    expect(res.status).toBe(403);
  });

  it("defaults to page 1 when page is not a usable number", async () => {
    seed([run(USER_ID, "1.1.1.1", 1)]);
    const res = await callRoute(USER_ID.toHexString(), "?track=ip&page=abc", true);
    expect(res.status).toBe(200);
    expect((await res.json()).page).toBe(1);
  });

  it("returns the requested page and total page count", async () => {
    seed(Array.from({ length: 23 }, (_, i) => run(USER_ID, `10.0.0.${i}`, (i % 27) + 1)));
    const res = await callRoute(USER_ID.toHexString(), "?track=ip&page=2", true);
    const body = await res.json();
    expect(body.page).toBe(2);
    expect(body.total).toBe(23);
    expect(body.totalPages).toBe(3);
    expect(body.rows).toHaveLength(10);
  });

  it("returns an empty row list past the last page", async () => {
    seed([run(USER_ID, "1.1.1.1", 1)]);
    const res = await callRoute(USER_ID.toHexString(), "?track=ip&page=99", true);
    const body = await res.json();
    expect(body.rows).toHaveLength(0);
    expect(body.total).toBe(1);
  });

  it("gives an admin the raw IP when the admin panel asks explicitly", async () => {
    seed([run(USER_ID, RAW_IP, 1)]);
    const res = await callRoute(USER_ID.toHexString(), "?track=ip&context=admin", true);
    expect(JSON.stringify(await res.json())).toContain(RAW_IP);
  });

  it("NEVER emits a raw IP in a moderator (non-admin) response", async () => {
    seed([run(USER_ID, RAW_IP, 1)]);
    const res = await callRoute(USER_ID.toHexString(), "?track=ip", false);
    expect(JSON.stringify(await res.json())).not.toContain(RAW_IP);
  });

  it("NEVER emits a raw fingerprint in a moderator (non-admin) response", async () => {
    const RAW_FP = "10f9219d43944d1ec95b59b6135395b7";
    seed([{ ...run(USER_ID, RAW_FP, 1), track: "fingerprint" }]);
    const res = await callRoute(USER_ID.toHexString(), "?track=fingerprint", false);
    expect(JSON.stringify(await res.json())).not.toContain(RAW_FP);
  });

  it("masks the IP for an ADMIN when the moderator panel is asking", async () => {
    seed([run(USER_ID, RAW_IP, 1)]);
    const res = await callRoute(USER_ID.toHexString(), "?track=ip&context=moderator", true);
    // The moderator card says "Network details hidden" one row above this
    // table; it must not then print the address.
    expect(JSON.stringify(await res.json())).not.toContain(RAW_IP);
  });

  it("masks the fingerprint for an ADMIN when the moderator panel is asking", async () => {
    const RAW_FP = "10f9219d43944d1ec95b59b6135395b7";
    seed([{ ...run(USER_ID, RAW_FP, 1), track: "fingerprint" }]);
    const res = await callRoute(
      USER_ID.toHexString(),
      "?track=fingerprint&context=moderator",
      true
    );
    expect(JSON.stringify(await res.json())).not.toContain(RAW_FP);
  });

  it("still masks for a non-admin who claims the admin context", async () => {
    // `context` is client-supplied, so it must only ever ADD masking. The role
    // check is the security boundary and cannot be widened from the request.
    seed([run(USER_ID, RAW_IP, 1)]);
    const res = await callRoute(USER_ID.toHexString(), "?track=ip&context=admin", false);
    expect(JSON.stringify(await res.json())).not.toContain(RAW_IP);
  });

  it("fails CLOSED on an unknown context: serves, but withholds", async () => {
    seed([run(USER_ID, RAW_IP, 1)]);
    const res = await callRoute(USER_ID.toHexString(), "?track=ip&context=banana", true);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(RAW_IP);
  });

  it("fails CLOSED when the caller omits context entirely", async () => {
    // A future surface that forgets the parameter must withhold rather than
    // silently over-disclose to an admin. Revealing is opt-in.
    seed([run(USER_ID, RAW_IP, 1)]);
    const res = await callRoute(USER_ID.toHexString(), "?track=ip", true);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain(RAW_IP);
  });

  it("counts other accounts sharing a value, excluding the subject", async () => {
    seed([run(USER_ID, RAW_IP, 1)], [USER_ID, OTHER_ID]);
    const res = await callRoute(USER_ID.toHexString(), "?track=ip", true);
    expect((await res.json()).rows[0].sharedWithCount).toBe(1);
  });
});

function NextResponseForbidden() {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

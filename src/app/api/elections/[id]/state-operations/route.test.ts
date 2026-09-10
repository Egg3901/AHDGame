import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/elections/electionParamResolution", () => ({
  resolveElectionRouteParam: vi.fn(),
}));
vi.mock("@/lib/elections/primaryStateOperations", () => ({
  buildStateOperations: vi.fn(),
}));

let db: MockDb;
const ELECTION_OID = new ObjectId();
const USER_ID = new ObjectId().toString();
const VIEW = { electionId: ELECTION_OID.toString(), currentTurn: 12, opponents: [] };

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: USER_ID, character: { _id: new ObjectId() } },
  } as never);

  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);

  const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
  vi.mocked(resolveElectionRouteParam).mockResolvedValue({
    ok: true,
    election: { _id: ELECTION_OID, electionType: "president", countryId: "US" },
  } as never);

  const { buildStateOperations } = await import("@/lib/elections/primaryStateOperations");
  vi.mocked(buildStateOperations).mockResolvedValue(VIEW as never);
});

async function callRoute(id: string) {
  const { GET } = await import("./route");
  return GET(new Request(`http://t/api/elections/${id}/state-operations`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/elections/[id]/state-operations", () => {
  it("serves the hub for a candidate", async () => {
    const res = await callRoute(ELECTION_OID.toString());
    expect(res.status).toBe(200);
    expect((await res.json()).electionId).toBe(ELECTION_OID.toString());
  });

  it("accepts a seat slug as well as an ObjectId", async () => {
    // The election pages address races as `US-president`, not only by ObjectId.
    expect((await callRoute("US-president")).status).toBe(200);
  });

  it("404s when the viewer has nothing to act on", async () => {
    const { buildStateOperations } = await import("@/lib/elections/primaryStateOperations");
    vi.mocked(buildStateOperations).mockResolvedValue(null);
    expect((await callRoute(ELECTION_OID.toString())).status).toBe(404);
  });

  it("400s a malformed election id", async () => {
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: false,
      reason: "invalid_id",
    } as never);
    expect((await callRoute("nope")).status).toBe(400);
  });

  it("404s a race that does not exist", async () => {
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: false,
      reason: "not_found",
    } as never);
    expect((await callRoute("ZZ-nothing")).status).toBe(404);
  });

  it("spends a read budget, not the player's action budget", async () => {
    // The shared `election:` bucket is 20 a minute and every other member of it
    // is an action the player takes. Browsing must not starve acting.
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    await callRoute(ELECTION_OID.toString());
    expect(vi.mocked(checkRateLimit).mock.calls[0][0]).toBe(USER_ID);
  });

  it("requires a character", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);
    expect((await callRoute(ELECTION_OID.toString())).status).toBe(401);
  });
});

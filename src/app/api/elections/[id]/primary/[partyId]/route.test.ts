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
vi.mock("@/lib/elections/primaryPartyDetail", () => ({
  buildPrimaryPartyDetail: vi.fn(),
}));

let db: MockDb;
const ELECTION_OID = new ObjectId();
const USER_ID = new ObjectId().toString();
const ACTIVE_CHARACTER_ID = new ObjectId().toString();

const DETAIL = {
  partyId: "1",
  partyName: "Democratic Party",
  partyColor: "#2563eb",
  candidates: [],
  byState: { IA: { c1: 700, c2: 300 } },
  stateNameById: { IA: "Iowa" },
  votedStateIds: ["IA"],
  viewerCampaign: null,
};

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: USER_ID, activeCharacterId: ACTIVE_CHARACTER_ID },
  } as never);

  const { checkRateLimit } = await import("@/lib/api/rateLimit");
  vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);

  const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
  vi.mocked(resolveElectionRouteParam).mockResolvedValue({
    ok: true,
    election: { _id: ELECTION_OID, electionType: "president", countryId: "US" },
  } as never);

  const { buildPrimaryPartyDetail } = await import("@/lib/elections/primaryPartyDetail");
  vi.mocked(buildPrimaryPartyDetail).mockResolvedValue(DETAIL as never);
});

async function callRoute(id: string, partyId: string) {
  const { GET } = await import("./route");
  return GET(new Request(`http://t/api/elections/${id}/primary/${partyId}`), {
    params: Promise.resolve({ id, partyId }),
  });
}

describe("GET /api/elections/[id]/primary/[partyId]", () => {
  it("returns the party detail for an ObjectId path", async () => {
    const res = await callRoute(ELECTION_OID.toString(), "1");
    expect(res.status).toBe(200);
    expect((await res.json()).byState).toEqual(DETAIL.byState);
  });

  it("accepts a seat slug and passes the resolved race to the builder", async () => {
    // The election pages address races as `US-president`, not only by ObjectId.
    // The wire endpoint shipped without this and 400'd on every slug URL.
    const { buildPrimaryPartyDetail } = await import("@/lib/elections/primaryPartyDetail");
    const res = await callRoute("US-president", "1");

    expect(res.status).toBe(200);
    const args = vi.mocked(buildPrimaryPartyDetail).mock.calls[0][1];
    expect(String(args.election._id)).toBe(ELECTION_OID.toString());
    expect(args.partyId).toBe("1");
  });

  it("identifies the viewer by their active profile, as the deep-dive page does", async () => {
    // Resolving a different character here than the page resolves would make
    // the two surfaces disagree about whose campaign is on screen.
    const { buildPrimaryPartyDetail } = await import("@/lib/elections/primaryPartyDetail");
    await callRoute(ELECTION_OID.toString(), "1");

    const args = vi.mocked(buildPrimaryPartyDetail).mock.calls[0][1];
    expect(args.viewer).toEqual({
      userId: USER_ID,
      activeCharacterId: ACTIVE_CHARACTER_ID,
    });
  });

  it("404s a party that does not exist in this race", async () => {
    const { buildPrimaryPartyDetail } = await import("@/lib/elections/primaryPartyDetail");
    vi.mocked(buildPrimaryPartyDetail).mockResolvedValue(null);

    const res = await callRoute(ELECTION_OID.toString(), "9");
    expect(res.status).toBe(404);
  });

  it("404s a race that is not presidential, without calling the builder", async () => {
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: true,
      election: { _id: ELECTION_OID, electionType: "senate", countryId: "US" },
    } as never);
    const { buildPrimaryPartyDetail } = await import("@/lib/elections/primaryPartyDetail");

    const res = await callRoute(ELECTION_OID.toString(), "1");
    expect(res.status).toBe(404);
    expect(buildPrimaryPartyDetail).not.toHaveBeenCalled();
  });

  it("400s a malformed election id", async () => {
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: false,
      reason: "invalid_id",
    } as never);

    const res = await callRoute("not-an-id", "1");
    expect(res.status).toBe(400);
  });

  it("404s a race that does not exist", async () => {
    const { resolveElectionRouteParam } = await import("@/lib/elections/electionParamResolution");
    vi.mocked(resolveElectionRouteParam).mockResolvedValue({
      ok: false,
      reason: "not_found",
    } as never);

    const res = await callRoute("ZZ-nothing", "1");
    expect(res.status).toBe(404);
  });

  it("rejects a party segment that is too long to be an id", async () => {
    const res = await callRoute(ELECTION_OID.toString(), "x".repeat(100));
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const res = await callRoute(ELECTION_OID.toString(), "1");
    expect(res.status).toBe(401);
  });

  it("spends a read budget of its own, not the player's action budget", async () => {
    // The shared `election:` bucket is for actions the player takes. Browsing
    // parties here must not leave them unable to camp in a state.
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    await callRoute(ELECTION_OID.toString(), "1");
    expect(vi.mocked(checkRateLimit).mock.calls[0][0]).toBe(USER_ID);
  });

  it("rate limits", async () => {
    const { checkRateLimit, rateLimitResponse } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({ ok: false, retryAfter: 30 } as never);
    vi.mocked(rateLimitResponse).mockReturnValue(
      new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }) as never
    );

    const res = await callRoute(ELECTION_OID.toString(), "1");
    expect(res.status).toBe(429);
  });
});

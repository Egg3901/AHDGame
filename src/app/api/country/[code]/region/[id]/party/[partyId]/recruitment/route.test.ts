/**
 * Growth-frontier gate on state-level NPP recruitment.
 *
 * `partyFrontier` is mocked: its behaviour is unit-tested in
 * `src/lib/parties/partyFrontier.test.ts`. This file proves the wiring on both
 * verbs — GET reports eligibility for the picker, POST enforces it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return { ...actual, findPartyBySequentialId: vi.fn() };
});
vi.mock("@/lib/parties/partyFrontier", () => ({
  getPartyFrontier: vi.fn(),
  isInFrontier: vi.fn(),
}));
vi.mock("@/lib/parties/antiAbuseGuards", () => ({
  getPartyNppControlStatus: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/npp/partyCapacity", () => ({
  getPartyNppCapacity: vi.fn().mockResolvedValue({ maxNpps: 500 }),
  partyNppCapacityError: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/db/sequentialId", () => ({ getNextSequentialId: vi.fn().mockResolvedValue(42) }));
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi.fn(async (_tx, fallback) => fallback()),
}));

const stateChairId = new ObjectId();
const partyObjectId = new ObjectId();

function makeRequest() {
  return new Request("http://localhost/api/country/us/region/CA/party/7/recruitment", {
    method: "POST",
  });
}

const params = Promise.resolve({ code: "us", id: "CA", partyId: "7" });

describe("state-level recruitment — growth frontier gate", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getGameTime } = await import("@/lib/time/gameTime");
    vi.mocked(getGameTime).mockResolvedValue({
      currentTurn: 900,
      effectiveNow: new Date("2026-09-19T00:00:00Z"),
    } as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "statechair",
        isAdmin: false,
        hasCharacter: true,
        character: { _id: stateChairId, name: "State Chair", countryId: "US", homeState: "CA" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyObjectId,
      sequentialId: 7,
      countryId: "US",
      name: "Northeast Labor Party",
      treasury: 100_000_000,
      economicPosition: 0,
      socialPosition: 0,
    } as never);

    db.collection("states").findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      population: 1000,
    });
    db.collection("statePartyOrg").findOne.mockResolvedValue({
      _id: "CA_7",
      stateId: "CA",
      partyId: "7",
      organization: 10,
      chairId: stateChairId,
      viceChairId: null,
      treasury: 100_000_000,
      nppActionPoints: 50,
    });
    db.collection("npps").countDocuments.mockResolvedValue(0);
    db.collection("statePartyOrg").updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { getPartyFrontier } = await import("@/lib/parties/partyFrontier");
    vi.mocked(getPartyFrontier).mockResolvedValue({
      presence: new Set(["NY"]),
      frontier: new Set(["NY", "PA"]),
    });
  });

  it("POST rejects recruitment outside the frontier and inserts nothing", async () => {
    const { isInFrontier } = await import("@/lib/parties/partyFrontier");
    vi.mocked(isInFrontier).mockReturnValue(false);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not established in or next to");
    expect(db.collection("npps").insertOne).not.toHaveBeenCalled();
  });

  it("POST proceeds when the region is inside the frontier", async () => {
    const { isInFrontier } = await import("@/lib/parties/partyFrontier");
    vi.mocked(isInFrontier).mockReturnValue(true);

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(db.collection("npps").insertOne).toHaveBeenCalledOnce();
  });

  it("GET reports inFrontier false and clears canRecruit outside the frontier", async () => {
    const { isInFrontier } = await import("@/lib/parties/partyFrontier");
    vi.mocked(isInFrontier).mockReturnValue(false);

    const { GET } = await import("./route");
    const body = await (await GET(makeRequest(), { params })).json();

    expect(body.inFrontier).toBe(false);
    expect(body.canRecruit).toBe(false);
  });

  it("GET reports inFrontier true for a reachable region", async () => {
    const { isInFrontier } = await import("@/lib/parties/partyFrontier");
    vi.mocked(isInFrontier).mockReturnValue(true);

    const { GET } = await import("./route");
    const body = await (await GET(makeRequest(), { params })).json();

    expect(body.inFrontier).toBe(true);
  });
});

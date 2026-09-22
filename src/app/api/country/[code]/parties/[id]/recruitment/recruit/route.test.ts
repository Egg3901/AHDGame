/**
 * Growth-frontier gate on national NPP recruitment.
 *
 * `partyFrontier` is mocked here on purpose: its own behaviour has dedicated
 * unit coverage in `src/lib/parties/partyFrontier.test.ts`. What this file
 * proves is the wiring — that the route consults the gate with the right
 * country/party, and that it honours the verdict without touching `npps`.
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

const chairId = new ObjectId();
const partyObjectId = new ObjectId();

function makeRequest(stateId: string) {
  return new Request("http://localhost/api/country/us/parties/7/recruitment/recruit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stateId }),
  });
}

const params = Promise.resolve({ code: "us", id: "7" });

describe("POST recruit — growth frontier gate", () => {
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
        username: "chair",
        isAdmin: false,
        hasCharacter: true,
        character: { _id: chairId, name: "Chair", countryId: "US", homeState: "NY" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: partyObjectId,
      sequentialId: 7,
      countryId: "US",
      name: "Northeast Labor Party",
      chairId,
      viceChairId: null,
      treasury: 100_000_000,
      nppActionPoints: 50,
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
      organization: 10,
    });
    db.collection("npps").countDocuments.mockResolvedValue(0);
    db.collection("politicalParties").updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { getPartyFrontier } = await import("@/lib/parties/partyFrontier");
    vi.mocked(getPartyFrontier).mockResolvedValue({
      presence: new Set(["NY"]),
      frontier: new Set(["NY", "PA"]),
    });
  });

  it("rejects recruitment into a region outside the party frontier", async () => {
    const { isInFrontier } = await import("@/lib/parties/partyFrontier");
    vi.mocked(isInFrontier).mockReturnValue(false);

    const { POST } = await import("./route");
    const res = await POST(makeRequest("CA"), { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("not established in or next to");
    expect(body.error).toContain("California");
    expect(db.collection("npps").insertOne).not.toHaveBeenCalled();
  });

  it("consults the gate with this country and party, and the target region", async () => {
    const { isInFrontier, getPartyFrontier } = await import("@/lib/parties/partyFrontier");
    vi.mocked(isInFrontier).mockReturnValue(false);

    const { POST } = await import("./route");
    await POST(makeRequest("CA"), { params });

    expect(vi.mocked(getPartyFrontier)).toHaveBeenCalledWith(expect.anything(), "US", "7");
    const [, , stateArg] = vi.mocked(isInFrontier).mock.calls[0];
    expect(stateArg).toBe("CA");
  });

  it("proceeds to recruit when the region is inside the frontier", async () => {
    const { isInFrontier } = await import("@/lib/parties/partyFrontier");
    vi.mocked(isInFrontier).mockReturnValue(true);

    const { POST } = await import("./route");
    const res = await POST(makeRequest("CA"), { params });

    expect(res.status).toBe(200);
    expect(db.collection("npps").insertOne).toHaveBeenCalledOnce();
  });

  it("carries no em dash or en dash in the rejection copy", async () => {
    const { isInFrontier } = await import("@/lib/parties/partyFrontier");
    vi.mocked(isInFrontier).mockReturnValue(false);

    const { POST } = await import("./route");
    const res = await POST(makeRequest("CA"), { params });
    expect((await res.json()).error).not.toMatch(/[\u2013\u2014]/);
  });
});

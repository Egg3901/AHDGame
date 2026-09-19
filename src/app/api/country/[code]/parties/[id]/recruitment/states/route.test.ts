/**
 * Growth-frontier eligibility on the recruitment states list.
 *
 * Exercises the real `partyFrontier` module (and therefore real adjacency) so
 * the reported `inFrontier` matches what the POST gate will actually enforce.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return { ...actual, findPartyBySequentialId: vi.fn() };
});
vi.mock("@/lib/npp/partyCapacity", () => ({
  getPartyNppCapacity: vi.fn().mockResolvedValue({ maxNpps: 500 }),
  partyNppCapacityError: vi.fn().mockReturnValue(null),
}));

const chairId = new ObjectId();

function makeRequest() {
  return new Request("http://localhost/api/country/us/parties/7/recruitment/states");
}

const params = Promise.resolve({ code: "us", id: "7" });

const REGIONS = [
  { _id: "NY", countryId: "US", name: "New York" },
  { _id: "PA", countryId: "US", name: "Pennsylvania" },
  { _id: "CA", countryId: "US", name: "California" },
];

describe("GET recruitment states — frontier eligibility", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

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
      _id: new ObjectId(),
      sequentialId: 7,
      countryId: "US",
      name: "Northeast Labor Party",
      chairId,
      treasury: 100_000_000,
      nppActionPoints: 50,
    } as never);

    // `states.find` serves both the route's region list and getCountryRegionIds.
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(REGIONS),
    });
    db.collection("statePartyOrg").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("npps").aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    // Presence: NY only. PA is adjacent, CA is not.
    db.collection("characters").distinct.mockResolvedValue(["NY"]);
  });

  it("marks regions outside the frontier and clears canRecruit for them", async () => {
    const { GET } = await import("./route");
    const body = await (await GET(makeRequest(), { params })).json();

    const byId = Object.fromEntries(body.states.map((s: { stateId: string }) => [s.stateId, s]));
    expect(byId.CA.inFrontier).toBe(false);
    expect(byId.CA.canRecruit).toBe(false);
  });

  it("marks the presence region and its neighbour as in frontier", async () => {
    const { GET } = await import("./route");
    const body = await (await GET(makeRequest(), { params })).json();

    const byId = Object.fromEntries(body.states.map((s: { stateId: string }) => [s.stateId, s]));
    expect(byId.NY.inFrontier).toBe(true);
    expect(byId.PA.inFrontier).toBe(true);
  });

  it("marks every region in frontier for a party with no presence at all", async () => {
    db.collection("characters").distinct.mockResolvedValue([]);

    const { GET } = await import("./route");
    const body = await (await GET(makeRequest(), { params })).json();

    expect(body.states.every((s: { inFrontier: boolean }) => s.inFrontier)).toBe(true);
  });
});

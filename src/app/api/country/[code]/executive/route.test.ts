import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));

const nppId = new ObjectId();
const presidentOfficial = {
  _id: new ObjectId(),
  countryId: "NG",
  officeType: "president",
  characterId: null,
  nppId,
  electedAt: new Date("2005-01-01"),
};

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();

  db.collection("electedOfficials").findOne.mockImplementation(
    async (q: Record<string, unknown>) => (q.officeType === "president" ? presidentOfficial : null)
  );
  db.collection("npps").findOne.mockResolvedValue({
    _id: nppId,
    sequentialId: 42,
    name: "Dapo Olatunji",
    party: "6",
    countryId: "NG",
  });
  db.collection("politicalParties").findOne.mockResolvedValue({
    _id: new ObjectId(),
    sequentialId: 6,
    name: "Social Democratic Party",
    color: "#0a0",
    countryId: "NG",
  });

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { getAuthUser } = await import("@/lib/auth");
  vi.mocked(getAuthUser).mockResolvedValue({
    userId: new ObjectId().toString(),
    isAdmin: true,
  } as never);
});

describe("GET /api/country/NG/executive", () => {
  it("resolves the NPP-backed NG president via the presidential handler", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/country/NG/executive"), {
      params: Promise.resolve({ code: "ng" }),
    });
    const body = await res.json();
    expect(body.countryId).toBe("NG");
    expect(body.president).toMatchObject({
      isNPP: true,
      characterName: "Dapo Olatunji",
      partyName: "Social Democratic Party",
      sequentialId: 42,
    });
    expect(body.vicePresident).toBeNull();
    expect(body.isAdmin).toBe(true);
    expect(body.isPresident).toBe(false);
    expect(body.supported).toBeUndefined();
  });
});

describe("GET /api/country/UK/executive — government.seatsByParty", () => {
  it("derives seatsByParty live from electedOfficials, ignoring a stale governmentFormations cache", async () => {
    // Regression for the stale-cache defect: `governmentFormations.seatsByParty`
    // is a write-triggered cache that can drift arbitrarily far from the real
    // chamber (measured in the field: DE showed 630 seats against a real 487;
    // BR/NG summed to 0 against real totals of 513/360). Seed the stored doc
    // with the opposite composition from the live Commons roll and assert the
    // response reflects the live tally.
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 10,
      currentYear: 1953,
      lastTurnProcessed: new Date("2026-01-01T00:00:00Z"),
      isActive: true,
      pausedAt: null,
      startingYear: 1953,
    });
    db.collection("governmentFormations").findOne.mockResolvedValue({
      _id: "UK",
      status: "formed",
      pmCharacterId: null,
      pmName: null,
      formationType: "majority",
      lostMajority: false,
      governingPartyId: "1",
      coalitionId: null,
      coalitionPartyIds: null,
      totalSeatsSupporting: 400,
      majorityThreshold: 326,
      totalSeats: 650,
      formedAt: null,
      activeVoteId: null,
      // Stale cache: says party "2" has almost every seat — the opposite of
      // the live Commons roll below.
      seatsByParty: { "1": 1, "2": 640 },
    });
    db.collection("electedOfficials").findOne.mockResolvedValue(null);
    db.collection("electedOfficials").find.mockImplementation((query: Record<string, unknown>) => {
      if (query?.officeType === "commons") {
        return {
          toArray: () =>
            Promise.resolve([
              { officeType: "commons", countryId: "UK", party: "1", seatsHeld: 400 },
              { officeType: "commons", countryId: "UK", party: "2", seatsHeld: 250 },
            ]),
        };
      }
      return { toArray: () => Promise.resolve([]) };
    });
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/country/UK/executive"), {
      params: Promise.resolve({ code: "uk" }),
    });
    const body = await res.json();

    expect(body.government.seatsByParty).toEqual({ "1": 400, "2": 250 });
  });
});

describe("GET /api/country/UK/executive — pmCharacterId shape", () => {
  it("resolves a PM whose id was persisted as a string instead of an ObjectId", async () => {
    // GlitchTip #566: `pmCharacterId` is typed ObjectId, but a string in the
    // stored doc made `pmCharacterId.equals(...)` throw and 500 the whole
    // executive page. A string id must resolve the PM, not crash.
    const pmId = new ObjectId();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 10,
      currentYear: 1953,
      lastTurnProcessed: new Date("2026-01-01T00:00:00Z"),
      isActive: true,
      pausedAt: null,
      startingYear: 1953,
    });
    db.collection("governmentFormations").findOne.mockResolvedValue({
      _id: "UK",
      status: "formed",
      // The defect: a string where the type promises an ObjectId.
      pmCharacterId: pmId.toString(),
      pmName: "Sarah Spencer",
      formationType: "majority",
      governingPartyId: "1",
      totalSeats: 650,
      formedAt: null,
      seatsByParty: { "1": 400 },
    });
    db.collection("characters").findOne.mockResolvedValue({
      _id: pmId,
      name: "Sarah Spencer",
      countryId: "UK",
      party: "1",
    });
    db.collection("politicalParties").findOne.mockResolvedValue({
      _id: "lab-uk",
      sequentialId: 1,
      countryId: "UK",
      name: "Labour",
      color: "#e4003b",
    });
    db.collection("electedOfficials").findOne.mockResolvedValue(null);
    db.collection("electedOfficials").find.mockImplementation(() => ({
      toArray: () => Promise.resolve([]),
    }));
    // Sign a user in. `isPrimeMinister` short-circuits on a null viewer, so
    // without one the `.equals` call this regression is about is never reached.
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: new ObjectId().toString(),
      username: "viewer",
    } as Awaited<ReturnType<typeof getAuthUser>>);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/country/UK/executive"), {
      params: Promise.resolve({ code: "uk" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.primeMinister).toMatchObject({
      id: pmId.toString(),
      characterName: "Sarah Spencer",
    });
    // The viewer IS the PM here (the shared characters mock returns the same
    // doc), which is precisely the comparison that used to throw on a string.
    expect(body.isPrimeMinister).toBe(true);
  });

  it("degrades to no PM when the stored id is not a usable ObjectId", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 10,
      currentYear: 1953,
      lastTurnProcessed: new Date("2026-01-01T00:00:00Z"),
      isActive: true,
      pausedAt: null,
      startingYear: 1953,
    });
    db.collection("governmentFormations").findOne.mockResolvedValue({
      _id: "UK",
      status: "formed",
      pmCharacterId: "not-an-object-id",
      pmName: "Ghost",
      formationType: "majority",
      governingPartyId: "1",
      totalSeats: 650,
      formedAt: null,
      seatsByParty: {},
    });
    db.collection("electedOfficials").findOne.mockResolvedValue(null);
    db.collection("electedOfficials").find.mockImplementation(() => ({
      toArray: () => Promise.resolve([]),
    }));
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/country/UK/executive"), {
      params: Promise.resolve({ code: "uk" }),
    });

    // The page still renders; it just has no prime minister to show.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.primeMinister).toBeNull();
  });
});

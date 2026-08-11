import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("GET /api/npps/[id]", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("npps");
    db.collection("states");
    db.collection("politicalParties");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("rejects malformed NPP ids", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/npps/bad"), {
      params: Promise.resolve({ id: "bad-id" }),
    });

    expect(response.status).toBe(400);
  });

  it("returns the shared NPP profile payload with country-scoped party data", async () => {
    const nppId = new ObjectId();
    db.collectionMocks.npps.findOne.mockResolvedValue({
      _id: nppId,
      name: "Pat Doe",
      homeState: "US_CA",
      party: "7",
      countryId: "US",
      currentOffice: { type: "house", state: "US_CA", seatsHeld: 1 },
      politicalInfluence: 14,
      favorability: 61,
      policies: { economic: 1, social: -1 },
      personality: { loyalty: 50, ambition: 45, stubbornness: 35 },
      retiredAt: null,
      generatedAt: new Date("2026-05-01T00:00:00Z"),
    } as never);
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "US_CA",
      name: "California",
    } as never);
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      sequentialId: 7,
      countryId: "US",
      name: "Forward Party",
      color: "#123456",
      abbreviation: "FWD",
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/npps/profile"), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.npp).toMatchObject({
      id: nppId.toString(),
      name: "Pat Doe",
      homeStateName: "California",
      partyName: "Forward Party",
      partyAbbreviation: "FWD",
      partyColor: "#123456",
      isNPP: true,
    });
    expect(db.collectionMocks.politicalParties.findOne).toHaveBeenCalledWith({
      sequentialId: 7,
      countryId: "US",
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;
beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("GET /api/country/NG/legislature/presiding-officers", () => {
  it("returns both officers null when none are seeded", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/country/NG/legislature/presiding-officers"), {
      params: Promise.resolve({ code: "ng" }),
    });
    const body = await res.json();
    expect(body).toEqual({ speaker: null, senatePresident: null });
  });

  it("resolves an NPP-backed Speaker to an isNPP holder", async () => {
    const nppId = new ObjectId();
    db.collection("electedOfficials").findOne.mockImplementation(
      async (q: Record<string, unknown>) =>
        q.officeType === "speaker"
          ? {
              _id: new ObjectId(),
              countryId: "NG",
              officeType: "speaker",
              characterId: null,
              nppId,
            }
          : null
    );
    db.collection("npps").findOne.mockResolvedValue({
      _id: nppId,
      sequentialId: 88,
      name: "Femi Adewale",
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
    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/country/NG/legislature/presiding-officers"), {
      params: Promise.resolve({ code: "ng" }),
    });
    const body = await res.json();
    expect(body.speaker).toMatchObject({
      isNPP: true,
      characterName: "Femi Adewale",
      sequentialId: 88,
    });
    expect(body.senatePresident).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeRequest() {
  return new Request("http://localhost/api/country/ie/region/DUB/party-org");
}

describe("GET /api/country/[code]/region/[id]/party-org", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();

    db.collectionMocks.states = db.collection("states");
    db.collectionMocks.states.findOne.mockResolvedValue({ _id: "DUB", countryId: "IE" });

    db.collectionMocks.politicalParties = db.collection("politicalParties");
    db.collectionMocks.politicalParties.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("excludes defunct (merged-away) parties from the region org listing", async () => {
    const { GET } = await import("./route");
    await GET(makeRequest(), { params: Promise.resolve({ code: "ie", id: "DUB" }) });

    const filter = db.collectionMocks.politicalParties!.find.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(filter.isDefunct).toEqual({ $ne: true });
  });
});

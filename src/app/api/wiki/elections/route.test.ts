import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/wikiGuard", () => ({ checkWikiDisabled: vi.fn().mockResolvedValue(null) }));
let db: MockDb;
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  db.collection("elections")
    .find()
    .toArray.mockResolvedValue([
      {
        _id: new ObjectId(),
        electionType: "snap_commons",
        countryId: "UK",
        state: "LON",
        status: "resolved",
        cycle: 2,
        electionYear: 1978,
        endTime: new Date("2026-09-29T12:00:00Z"),
      },
    ]);
  db.collection("states")
    .find()
    .toArray.mockResolvedValue([{ _id: "LON", name: "London" }]);
});
describe("wiki snap election history", () => {
  it("keeps legacy game-year records reachable without using their real resolution year", async () => {
    const cursor = db.collection("elections").find();
    const election = {
      _id: new ObjectId(),
      electionType: "commons",
      countryId: "UK",
      state: "LON",
      status: "resolved",
      cycle: 1,
      endTime: new Date("2026-09-29T12:00:00Z"),
    };
    cursor.toArray.mockResolvedValue([election]);
    db.collection("gameState").findOne.mockResolvedValue({
      preset: "1953-default",
      startingYear: 1953,
    });
    const response = await GET(
      new Request("http://localhost/api/wiki/elections?year=1955&type=commons")
    );
    expect((await response.json()).elections).toHaveLength(1);
  });
  it("rejects unknown types", async () => {
    expect(
      (await GET(new Request("http://localhost/api/wiki/elections?state=LON&type=made_up"))).status
    ).toBe(400);
  });

  it.each(["senat", "senato", "senado", "chamber", "nationalrat", "eduskunta", "vouli"])(
    "accepts the live chamber type %s without changing the gameplay label registry",
    async (electionType) => {
      const response = await GET(
        new Request(`http://localhost/api/wiki/elections?state=LON&type=${electionType}`)
      );

      expect(response.status).toBe(200);
      expect(db.collection("elections").find).toHaveBeenLastCalledWith(
        expect.objectContaining({ state: "LON", electionType })
      );
    }
  );

  it("opens the snap election regional browse link", async () => {
    const response = await GET(
      new Request("http://localhost/api/wiki/elections?state=LON&type=snap_commons")
    );
    expect(response.status).toBe(200);
    expect((await response.json()).elections[0].label).toContain("Snap");
  });
  it("opens the snap election game-year browse link", async () => {
    const response = await GET(
      new Request("http://localhost/api/wiki/elections?year=1978&type=snap_commons")
    );
    expect(response.status).toBe(200);
    expect(db.collection("elections").find).toHaveBeenLastCalledWith(
      expect.objectContaining({ $or: expect.arrayContaining([{ electionYear: 1978 }]) })
    );
  });
  it("labels snap elections correctly in the index", async () => {
    const response = await GET(new Request("http://localhost/api/wiki/elections"));
    const data = await response.json();
    expect(data.groups[0].typeLabel).toContain("Snap");
    expect(data.stateGroups[0].typeLabel).toContain("Snap");
  });
});

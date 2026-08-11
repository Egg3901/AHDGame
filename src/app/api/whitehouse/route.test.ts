import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));

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
  vi.mocked(getAuthUser).mockResolvedValue(null as never);
  const { getGameTime } = await import("@/lib/time/gameTime");
  vi.mocked(getGameTime).mockResolvedValue({
    currentTurn: 770,
    lastTurnProcessed: new Date("2026-07-01"),
    startingYear: 1991,
  } as never);
});

describe("GET /api/whitehouse?country=ng", () => {
  it("resolves an NPP-backed president to an isNPP holder (not Vacant)", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://t/api/whitehouse?country=ng"));
    const body = await res.json();
    expect(body.president).toMatchObject({
      isNPP: true,
      characterName: "Dapo Olatunji",
      partyName: "Social Democratic Party",
      sequentialId: 42,
    });
    expect(body.vicePresident).toBeNull();
    expect(body.isPresident).toBe(false);
  });
});

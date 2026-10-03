import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { huRegions1991 } from "@/lib/countries/hu/data/huRegions1991";
import { ensureHUElections } from "./perpetualElections";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("./assemblyCampaignBinding2011", () => ({
  bindHu2011Campaigns: vi.fn().mockResolvedValue(false),
}));

const NOW = new Date("2026-01-01T00:00:00Z");
let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "HU", status: "active" });
  db.collection("states").find.mockReturnValue({ toArray: async () => huRegions1991 });
  const live = huRegions1991.map((region) => ({
    _id: new ObjectId(),
    state: String(region._id),
    totalSeats: region.houseDistricts,
  }));
  db.collection("elections").find.mockImplementation((filter: { status?: { $in?: string[] } }) => {
    const rows = filter.status?.$in?.includes("active") ? live : [];
    return { toArray: async () => rows, sort: () => ({ toArray: async () => rows }) };
  });
});

describe("Hungary's authorized campaign capacities", () => {
  it("keeps an existing campaign capacity when the authorized transition did not bind it", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "1991-default",
      startingYear: 1991,
      currentYear: 2014,
      currentTurn: 1105,
    });
    db.collection("countryGameStates").findOne.mockResolvedValue({
      _id: "HU",
      status: "active",
      huElectoralSystem2011SinceTurn: 1005,
    });
    await ensureHUElections(NOW, 1105);
    expect(db.collection("elections").bulkWrite).not.toHaveBeenCalled();
    expect(db.collection("states").bulkWrite).not.toHaveBeenCalled();
    expect(db.collection("governmentFormations").updateOne).not.toHaveBeenCalled();
  });

  it.each([
    ["1991-default", 2013],
    ["1991-default", 2014],
    ["1979-default", 2014],
    ["2027-default", 2027],
  ])("leaves live regional races unchanged for %s in %i", async (preset, currentYear) => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset,
      startingYear: currentYear,
      currentYear,
      currentTurn: 1,
    });
    await ensureHUElections(NOW, 1);
    expect(db.collection("elections").bulkWrite).not.toHaveBeenCalled();
  });
});

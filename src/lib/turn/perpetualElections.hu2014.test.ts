import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { huRegions1991 } from "@/lib/countries/hu/data/huRegions1991";
import { hu2014RegionSeats } from "./huAssemblyReform";
import { ensureHUElections } from "./perpetualElections/countries/easternBloc";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

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

describe("Hungary's 2014 election race magnitudes", () => {
  it("resizes the pending 2014 races to 199 seats while leaving the sitting 386-seat chamber intact", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      preset: "1991-default",
      startingYear: 1991,
      currentYear: 2014,
      currentTurn: 1105,
    });
    await ensureHUElections(NOW, 1105);
    const ops = db.collection("elections").bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { update: { $set: { totalSeats: number } } };
    }>;
    expect(ops).toHaveLength(huRegions1991.length);
    expect(ops.reduce((sum, op) => sum + op.updateOne.update.$set.totalSeats, 0)).toBe(199);
    expect(hu2014RegionSeats(huRegions1991)).toHaveProperty("HU_BUD");
    expect(db.collection("states").bulkWrite).not.toHaveBeenCalled();
    expect(db.collection("governmentFormations").updateOne).not.toHaveBeenCalled();
  });

  it.each([
    ["1991-default", 2013],
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

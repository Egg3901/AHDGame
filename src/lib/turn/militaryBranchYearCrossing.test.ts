import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { runMilitaryBranchYearCrossing } from "./militaryBranchYearCrossing";
import { createSystemNewsPost } from "@/lib/news";

vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldPreset: vi.fn().mockResolvedValue("1953-default"),
}));

/** Units staged by the run, flattened from the insertMany call. */
function inserted(db: MockDb): Array<{ countryId: string; branchId: string }> {
  const calls = db.collection("militaryUnits").insertMany.mock.calls as unknown[][];
  return calls.flatMap((call) => call[0] as Array<{ countryId: string; branchId: string }>);
}

describe("runMilitaryBranchYearCrossing", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Default: no country holds any units yet.
    db.collection("militaryUnits").find().toArray.mockResolvedValue([]);
  });

  it("no-ops without a finite currentYear", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current" });
    const result = await runMilitaryBranchYearCrossing(db as unknown as Db);
    expect(result.ran).toBe(false);
    expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
  });

  it("does not raise the NVA before 1956", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1953,
      lastMilitaryBranchYearProcessed: 1952,
      eraSystemEnabled: true,
    });
    const result = await runMilitaryBranchYearCrossing(db as unknown as Db);
    expect(result.raised.filter((r) => r.startsWith("DD:"))).toEqual([]);
    expect(inserted(db).filter((u) => u.countryId === "DD")).toEqual([]);
  });

  it("raises all three NVA branches on the 1955 to 1956 crossing, with news", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1956,
      lastMilitaryBranchYearProcessed: 1955,
      eraSystemEnabled: true,
    });
    const result = await runMilitaryBranchYearCrossing(db as unknown as Db);

    const ddBranches = result.raised
      .filter((r) => r.startsWith("DD:"))
      .map((r) => r.split(":")[1].split(" ")[0]);
    expect(ddBranches.sort()).toEqual(["landstreitkraefte", "luftstreitkraefte", "volksmarine"]);

    // The authored DD order of battle is 3+2+1 ground, 1 naval, 2+1 air = 10 units.
    const ddUnits = inserted(db).filter((u) => u.countryId === "DD");
    expect(ddUnits).toHaveLength(10);

    expect(createSystemNewsPost).toHaveBeenCalledWith(
      expect.stringContaining("Land Forces"),
      "executive",
      expect.objectContaining({ title: expect.stringContaining("Land Forces") })
    );
    expect(db.collection("gameState").updateOne).toHaveBeenCalledWith(
      { _id: "current" },
      expect.objectContaining({
        $set: expect.objectContaining({ lastMilitaryBranchYearProcessed: 1956 }),
      })
    );
  });

  it("first run stands up an already-active empty branch silently", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1979,
      eraSystemEnabled: true,
    });
    const result = await runMilitaryBranchYearCrossing(db as unknown as Db);

    expect(result).toMatchObject({ ran: true, healed: true, posted: [] });
    expect(inserted(db).filter((u) => u.countryId === "DD").length).toBeGreaterThan(0);
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });

  it("never tops up a branch that already holds units", async () => {
    db.collection("militaryUnits")
      .find()
      .toArray.mockResolvedValue([
        { countryId: "DD", branchId: "landstreitkraefte" },
        { countryId: "DD", branchId: "volksmarine" },
        { countryId: "DD", branchId: "luftstreitkraefte" },
      ]);
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1956,
      lastMilitaryBranchYearProcessed: 1955,
      eraSystemEnabled: true,
    });
    const result = await runMilitaryBranchYearCrossing(db as unknown as Db);
    expect(result.raised.filter((r) => r.startsWith("DD:"))).toEqual([]);
    expect(inserted(db).filter((u) => u.countryId === "DD")).toEqual([]);
  });

  it("does not re-run for a year already processed", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentYear: 1956,
      lastMilitaryBranchYearProcessed: 1956,
    });
    const result = await runMilitaryBranchYearCrossing(db as unknown as Db);
    expect(result.ran).toBe(false);
    expect(db.collection("militaryUnits").insertMany).not.toHaveBeenCalled();
  });
});

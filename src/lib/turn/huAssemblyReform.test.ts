import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { huRegions1991 } from "@/lib/countries/hu/data/huRegions1991";
import { runHuAssemblyReform } from "./huAssemblyReform";

const now = new Date("2026-01-01T00:00:00.000Z");

function setup(preset = "1991-default", reformed = false) {
  const db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({
    preset,
    ...(reformed ? { huAssemblyReformedAtYear: 2014 } : {}),
  });
  db.collection("states").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(huRegions1991),
  });
  const officials = huRegions1991.map((region) => ({
    _id: new ObjectId(),
    state: region._id,
    seatsHeld: region.houseDistricts,
  }));
  db.collection("electedOfficials").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(officials),
  });
  const electionId = new ObjectId();
  db.collection("elections").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([
      {
        _id: electionId,
        state: String(huRegions1991[0]._id),
        totalSeats: huRegions1991[0].houseDistricts,
      },
    ]),
  });
  return { db, officials, electionId };
}

describe("2014 Hungarian Assembly reform", () => {
  it("leaves the 386-seat 1991 Assembly intact before 2014", async () => {
    const { db } = setup();
    expect(await runHuAssemblyReform(db as unknown as Db, 2013, now)).toBe(false);
    expect(db.collection("states").bulkWrite).not.toHaveBeenCalled();
  });

  it("reapportions to 199 seats, scales the sitting delegation and stamps once", async () => {
    const { db, electionId } = setup();
    expect(huRegions1991.reduce((sum, region) => sum + (region.houseDistricts ?? 0), 0)).toBe(386);
    expect(await runHuAssemblyReform(db as unknown as Db, 2014, now)).toBe(true);

    const regionOps = db.collection("states").bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { houseDistricts: number } } };
    }>;
    expect(regionOps.reduce((sum, op) => sum + op.updateOne.update.$set.houseDistricts, 0)).toBe(
      199
    );
    const officialOps = db.collection("electedOfficials").bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { update: { $set: { seatsHeld: number } } };
    }>;
    expect(officialOps.reduce((sum, op) => sum + op.updateOne.update.$set.seatsHeld, 0)).toBe(199);
    expect(db.collection("elections").bulkWrite).toHaveBeenCalledWith([
      {
        updateOne: {
          filter: { _id: electionId },
          update: {
            $set: {
              totalSeats: regionOps.find((op) => op.updateOne.filter._id === huRegions1991[0]._id)!
                .updateOne.update.$set.houseDistricts,
              updatedAt: now,
            },
          },
        },
      },
    ]);
    expect(db.collection("governmentFormations").updateOne).toHaveBeenCalledWith(
      { _id: "HU" },
      { $set: { totalSeats: 199, majorityThreshold: 100, updatedAt: now } }
    );
    expect(db.collection("gameState").updateOne).toHaveBeenCalledWith(
      { _id: "current", huAssemblyReformedAtYear: { $exists: false } },
      { $set: { huAssemblyReformedAtYear: 2014, updatedAt: now } }
    );
  });

  it.each(["1979-default", "2027-default"])("does not rewrite the %s world", async (preset) => {
    const { db } = setup(preset);
    expect(await runHuAssemblyReform(db as unknown as Db, 2014, now)).toBe(false);
    expect(db.collection("states").bulkWrite).not.toHaveBeenCalled();
  });

  it("does not replay a completed reform", async () => {
    const { db } = setup("1991-default", true);
    expect(await runHuAssemblyReform(db as unknown as Db, 2015, now)).toBe(false);
    expect(db.collection("states").bulkWrite).not.toHaveBeenCalled();
  });

  it("leaves the retry guard clear when a chamber write fails", async () => {
    const { db } = setup();
    db.collection("states").bulkWrite.mockRejectedValueOnce(new Error("write failed"));
    await expect(runHuAssemblyReform(db as unknown as Db, 2014, now)).rejects.toThrow(
      "write failed"
    );
    expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
  });
});

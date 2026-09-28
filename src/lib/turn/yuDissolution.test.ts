import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { yuDissolutionDue } from "@/lib/countries/yu/rules/succession";
import { processYuDissolution } from "./yuDissolution";

describe("SFRY 1992 political retirement", () => {
  it("uses the final April 1992 turn only in the 1991 preset", () => {
    expect(yuDissolutionDue("1991-default", 63)).toBe(false);
    expect(yuDissolutionDue("1991-default", 64)).toBe(true);
    expect(yuDissolutionDue("1979-default", 64)).toBe(false);
    expect(yuDissolutionDue("2027-default", 64)).toBe(false);
  });

  it("retires elections and offices before setting the durable country marker", async () => {
    const db = createMockDb();
    db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "YU" });
    const writes: string[] = [];
    db.collection("elections").updateMany.mockImplementation(async () => {
      writes.push("elections");
    });
    db.collection("electedOfficials").deleteMany.mockImplementation(async () => {
      writes.push("officials");
    });
    db.collection("governmentFormations").updateOne.mockImplementation(async () => {
      writes.push("government");
    });
    db.collection("countryGameStates").updateOne.mockImplementation(async () => {
      writes.push("country");
    });

    expect(
      await processYuDissolution(db as unknown as Db, { preset: "1991-default" }, 64, new Date())
    ).toBe(true);
    expect(writes).toEqual(["elections", "officials", "government", "country"]);
    expect(db.collectionMocks.electedOfficials.deleteMany.mock.calls[0]![0]).toEqual({
      countryId: "YU",
    });
    expect(db.collectionMocks.countryGameStates.updateOne.mock.calls[0]![1].$set).toMatchObject({
      dissolvedTurn: 64,
    });
  });

  it("waits for calendar time and does not retire other presets or an absent country", async () => {
    const db = createMockDb();
    db.collection("elections");
    db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "YU" });
    expect(
      await processYuDissolution(db as unknown as Db, { preset: "1991-default" }, 63, new Date())
    ).toBe(false);
    expect(
      await processYuDissolution(db as unknown as Db, { preset: "1979-default" }, 64, new Date())
    ).toBe(false);
    expect(
      await processYuDissolution(
        db as unknown as Db,
        { preset: "1991-default", preIteration: { active: true, startedTurn: 1 } },
        100,
        new Date()
      )
    ).toBe(false);
    expect(db.collectionMocks.elections.updateMany).not.toHaveBeenCalled();

    expect(
      await processYuDissolution(
        db as unknown as Db,
        { preset: "1991-default", preIterationTurns: 48 },
        111,
        new Date()
      )
    ).toBe(false);

    db.collection("countryGameStates").findOne.mockResolvedValue(null);
    expect(
      await processYuDissolution(
        db as unknown as Db,
        { preset: "1991-default", preIterationTurns: 48 },
        112,
        new Date()
      )
    ).toBe(false);
  });

  it("retries when an earlier write fails and does not repeat after the marker", async () => {
    const db = createMockDb();
    db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "YU" });
    db.collection("governmentFormations").updateOne.mockRejectedValueOnce(new Error("interrupted"));
    await expect(
      processYuDissolution(db as unknown as Db, { preset: "1991-default" }, 64, new Date())
    ).rejects.toThrow("interrupted");
    expect(db.collectionMocks.countryGameStates.updateOne).not.toHaveBeenCalled();

    expect(
      await processYuDissolution(db as unknown as Db, { preset: "1991-default" }, 65, new Date())
    ).toBe(true);
    db.collection("countryGameStates").findOne.mockResolvedValue({ _id: "YU", dissolvedTurn: 65 });
    expect(
      await processYuDissolution(db as unknown as Db, { preset: "1991-default" }, 66, new Date())
    ).toBe(false);
    expect(db.collectionMocks.countryGameStates.updateOne).toHaveBeenCalledTimes(1);
  });
});

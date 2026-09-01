import { describe, it, expect, vi, beforeEach } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { mergeMilitary } from "./mergeMilitary";

describe("mergeMilitary", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("militaryUnits").updateMany.mockResolvedValue({ modifiedCount: 11 });
    for (const coll of [
      "militaryCommands",
      "militaryFormations",
      "nationalArsenal",
      "nationalManpower",
      "nationalDoctrine",
    ]) {
      db.collection(coll).findOne.mockResolvedValue(null);
    }
  });

  const args = { fromCountryId: "DD" as const, toCountryId: "DE" as const };

  it("re-flags every unit", async () => {
    const res = await mergeMilitary(db as unknown as Db, args);
    expect(res.unitsRescoped).toBe(11);
    const [filter, update] = db.collectionMocks["militaryUnits"].updateMany.mock.calls[0];
    expect(filter).toEqual({ countryId: "DD" });
    expect(update.$set.countryId).toBe("DE");
  });

  it("appends absorbed command groups into the survivor's single doc and deletes the old one", async () => {
    db.collection("militaryCommands")
      .findOne.mockResolvedValueOnce({ countryId: "DD", commands: [{ id: "gsvg" }] })
      .mockResolvedValueOnce({ countryId: "DE", commands: [{ id: "bundeswehr-west" }] });

    const res = await mergeMilitary(db as unknown as Db, args);

    expect(res.commandsMerged).toBe(1);
    const set = db.collectionMocks["militaryCommands"].updateOne.mock.calls[0][1].$set;
    expect(set.commands).toEqual([{ id: "bundeswehr-west" }, { id: "gsvg" }]);
    expect(db.collectionMocks["militaryCommands"].deleteOne).toHaveBeenCalledWith({
      countryId: "DD",
    });
  });

  it("rescopes the command doc when the survivor has none (one doc per country stays true)", async () => {
    db.collection("militaryCommands")
      .findOne.mockResolvedValueOnce({ countryId: "DD", commands: [{ id: "gsvg" }] })
      .mockResolvedValueOnce(null);

    await mergeMilitary(db as unknown as Db, args);

    const [filter, update] = db.collectionMocks["militaryCommands"].updateOne.mock.calls[0];
    expect(filter).toEqual({ countryId: "DD" });
    expect(update.$set.countryId).toBe("DE");
    expect(db.collectionMocks["militaryCommands"].deleteOne).not.toHaveBeenCalled();
  });

  it("merges formations: assignments concat, survivor wins position collisions", async () => {
    db.collection("militaryFormations")
      .findOne.mockResolvedValueOnce({
        countryId: "DD",
        conflictAssignments: [{ unitId: "u-dd" }],
        positions: { shared: "dd-place", "only-dd": "beo" },
      })
      .mockResolvedValueOnce({
        countryId: "DE",
        conflictAssignments: [{ unitId: "u-de" }],
        positions: { shared: "de-place" },
      });

    await mergeMilitary(db as unknown as Db, args);

    const set = db.collectionMocks["militaryFormations"].updateOne.mock.calls[0][1].$set;
    expect(set.conflictAssignments).toEqual([{ unitId: "u-de" }, { unitId: "u-dd" }]);
    expect(set.positions.shared).toBe("de-place");
    expect(set.positions["only-dd"]).toBe("beo");
  });

  it("sums arsenal stocks and volume-weights the grades", async () => {
    db.collection("nationalArsenal")
      .findOne.mockResolvedValueOnce({
        countryId: "DD",
        stock: { ground: 30, air: 0 },
        grade: { ground: 1, air: 2 },
      })
      .mockResolvedValueOnce({
        countryId: "DE",
        stock: { ground: 10, air: 0, naval: 5, rocket: 0, space: 0, marine: 0 },
        grade: { ground: 3, air: 0, naval: 2, rocket: 0, space: 0, marine: 0 },
      });

    const res = await mergeMilitary(db as unknown as Db, args);

    expect(res.arsenalMerged).toBe(true);
    const set = db.collectionMocks["nationalArsenal"].updateOne.mock.calls[0][1].$set;
    expect(set.stock.ground).toBe(40);
    expect(set.grade.ground).toBeCloseTo((3 * 10 + 1 * 30) / 40); // 1.5
    expect(set.stock.naval).toBe(5); // untouched survivor domain
    expect(set.grade.naval).toBe(2);
    expect(set.grade.air).toBe(0); // both stocks empty → survivor grade kept
    expect(db.collectionMocks["nationalArsenal"].deleteOne).toHaveBeenCalledWith({
      countryId: "DD",
    });
  });

  it("adds the manpower pool and the winner's reinforcement mode governs", async () => {
    db.collection("nationalManpower")
      .findOne.mockResolvedValueOnce({ countryId: "DD", pool: 40_000, mode: "conscript" })
      .mockResolvedValueOnce({ countryId: "DE", pool: 25_000, mode: "volunteer" });

    const res = await mergeMilitary(db as unknown as Db, args);

    expect(res.manpowerMerged).toBe(true);
    const [filter, update] = db.collectionMocks["nationalManpower"].updateOne.mock.calls[0];
    expect(filter).toEqual({ countryId: "DE" });
    expect(update.$inc.pool).toBe(40_000);
    // The merge runs winner-into-shell: the absorbed side's rules for feeding
    // its army stand, not the shell's.
    expect(update.$set.mode).toBe("conscript");
    expect(db.collectionMocks["nationalManpower"].deleteOne).toHaveBeenCalledWith({
      countryId: "DD",
    });
  });

  it("keeps the survivor's reinforcement mode when the SURVIVOR is the winner", async () => {
    db.collection("nationalManpower")
      .findOne.mockResolvedValueOnce({ countryId: "DD", pool: 40_000, mode: "conscript" })
      .mockResolvedValueOnce({ countryId: "DE", pool: 25_000, mode: "volunteer" });

    await mergeMilitary(db as unknown as Db, { ...args, carryStance: false });

    const [, update] = db.collectionMocks["nationalManpower"].updateOne.mock.calls[0];
    // The pool is a QUANTITY and crosses either way; the mode is a rule, and the
    // side that lost does not get to say how the winner feeds its army.
    expect(update.$inc.pool).toBe(40_000);
    expect(update.$set?.mode).toBeUndefined();
  });

  it("keeps the survivor's doctrine when the SURVIVOR is the winner", async () => {
    db.collection("nationalDoctrine")
      .findOne.mockResolvedValueOnce({ countryId: "DD", doctrine: "mass-mobilisation" })
      .mockResolvedValueOnce({ countryId: "DE", doctrine: "manoeuvre" });

    await mergeMilitary(db as unknown as Db, { ...args, carryStance: false });

    // The survivor's doc STANDS and the absorbed one is dropped -- the reverse of
    // the default, where the survivor's is the one deleted.
    expect(db.collectionMocks["nationalDoctrine"].deleteOne).toHaveBeenCalledWith({
      countryId: "DD",
    });
    const [filter] = db.collectionMocks["nationalDoctrine"].updateOne.mock.calls[0];
    expect(filter).toEqual({ countryId: "DE" });
  });

  it("the winner's doctrine replaces the survivor's", async () => {
    db.collection("nationalDoctrine")
      .findOne.mockResolvedValueOnce({ countryId: "DD", doctrine: "mass-mobilisation" })
      .mockResolvedValueOnce({ countryId: "DE", doctrine: "manoeuvre" });

    await mergeMilitary(db as unknown as Db, args);

    expect(db.collectionMocks["nationalDoctrine"].deleteOne).toHaveBeenCalledWith({
      countryId: "DE",
    });
    const [filter, update] = db.collectionMocks["nationalDoctrine"].updateOne.mock.calls[0];
    expect(filter).toEqual({ countryId: "DD" });
    expect(update.$set.countryId).toBe("DE");
  });

  it("a re-run with nothing absorbed left is a clean no-op", async () => {
    db.collection("militaryUnits").updateMany.mockResolvedValue({ modifiedCount: 0 });
    const res = await mergeMilitary(db as unknown as Db, args);
    expect(res).toEqual({
      unitsRescoped: 0,
      commandsMerged: 0,
      arsenalMerged: false,
      manpowerMerged: false,
    });
  });
});

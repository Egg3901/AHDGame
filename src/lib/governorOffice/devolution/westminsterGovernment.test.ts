import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { loadWestminsterGovernment } from "./westminsterGovernment";
describe("Westminster ministry identity", () => {
  it("uses the canonical ministry and distinguishes same-turn successors and new parliaments", async () => {
    const db = createMockDb();
    const row = {
      status: "formed",
      pmCharacterId: "pm-a",
      cycle: 1,
      formedTurn: 100,
      formedAt: new Date(0),
    };
    db.collection("governmentFormations").findOne.mockResolvedValue(row);
    const original = await loadWestminsterGovernment(db as unknown as Db);
    expect(db.collection("parliamentaryGovernments").findOne).not.toHaveBeenCalled();
    for (const update of [{ pmCharacterId: "pm-b" }, { cycle: 2 }, { formedAt: new Date(1) }]) {
      db.collection("governmentFormations").findOne.mockResolvedValue({ ...row, ...update });
      expect((await loadWestminsterGovernment(db as unknown as Db))?.key).not.toBe(original?.key);
    }
  });
  it("falls back only when no canonical row exists and rejects unformed ministries", async () => {
    const db = createMockDb();
    db.collection("parliamentaryGovernments").findOne.mockResolvedValue({
      status: "formed",
      pmCharacterId: "legacy-pm",
      cycle: 1,
      formedTurn: 20,
    });
    expect((await loadWestminsterGovernment(db as unknown as Db))?.formedTurn).toBe(20);
    db.collection("governmentFormations").findOne.mockResolvedValue({
      status: "pending",
      pmCharacterId: null,
    });
    expect(await loadWestminsterGovernment(db as unknown as Db)).toBeNull();
  });
});

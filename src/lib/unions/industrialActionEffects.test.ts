import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { OVERTIME_BAN_OUTPUT_FACTOR } from "./bargaining";
import { loadIndustrialActionOutputFactors } from "./industrialActionEffects";

describe("loadIndustrialActionOutputFactors", () => {
  it("maps active overtime bans to their snapshotted locals", async () => {
    const first = new ObjectId();
    const second = new ObjectId();
    const toArray = vi
      .fn()
      .mockResolvedValue([{ sectorIds: [first, second] }, { sectorIds: [second] }]);
    const find = vi.fn().mockReturnValue({ toArray });
    const db = { collection: vi.fn().mockReturnValue({ find }) } as unknown as Db;

    const factors = await loadIndustrialActionOutputFactors(db);

    expect(find).toHaveBeenCalledWith(
      { status: "dispute", escalationLevel: "overtime_ban" },
      { projection: { sectorIds: 1 } }
    );
    expect(factors.get(first.toString())).toBe(OVERTIME_BAN_OUTPUT_FACTOR);
    expect(factors.get(second.toString())).toBe(OVERTIME_BAN_OUTPUT_FACTOR);
  });
});

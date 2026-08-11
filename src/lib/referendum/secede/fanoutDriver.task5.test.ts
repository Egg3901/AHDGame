import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { applyFanout, buildFanoutContext } from "./fanoutDriver";
import { SECEDE_FANOUT } from "./fanoutPolicy";
import { scoRegions } from "@/lib/seeds/sco/scoRegions";

const ctx = buildFanoutContext("SCO", scoRegions);
const scopeFor = (c: string) => SECEDE_FANOUT.find((s) => s.collection === c)!;
const SUB_IDS = scoRegions.map((s) => s._id);
const cursorOf = <T>(docs: T[]) => ({ toArray: vi.fn().mockResolvedValue(docs) });

describe("applyFanout — Task 5 policies", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("partitionGdp re-stateIds every sector exactly once, GDP-weighted", async () => {
    const sectors = Array.from({ length: 21 }, (_, i) => ({
      _id: `sec${i}`,
      stateId: "SCO",
      revenue: 100,
    }));
    db.collection("corporateSectors").find.mockReturnValue(cursorOf(sectors));

    const writes = await applyFanout(db as unknown as Db, scopeFor("corporateSectors"), ctx);

    expect(writes).toBe(21);
    const calls = db.collectionMocks["corporateSectors"]!.updateMany.mock.calls;
    let covered = 0;
    for (const [filter, update] of calls) {
      const ids = (filter as { _id: { $in: string[] } })._id.$in;
      covered += ids.length;
      const set = (update as { $set: { stateId: string; countryId: string } }).$set;
      expect(SUB_IDS).toContain(set.stateId);
      expect(set.countryId).toBe("SCO");
    }
    expect(covered).toBe(21);
  });

  it("rekeyCopyShares re-keys the pool per sub-region and copies the shares", async () => {
    db.collection("stateRegistrationPool").findOne.mockImplementation(async (q: { _id: string }) =>
      q._id === "UK_SCO"
        ? { _id: "UK_SCO", countryId: "UK", stateId: "SCO", independent: 30, unregistered: 20 }
        : null
    );

    const writes = await applyFanout(db as unknown as Db, scopeFor("stateRegistrationPool"), ctx);

    expect(writes).toBe(7);
    const docs = db.collectionMocks["stateRegistrationPool"]!.insertMany.mock.calls[0][0] as Array<{
      _id: string;
      stateId: string;
      countryId: string;
      independent: number;
      unregistered: number;
    }>;
    expect(docs.map((d) => d._id).sort()).toEqual(SUB_IDS.map((id) => `SCO_${id}`).sort());
    for (const d of docs) {
      expect(d.independent).toBe(30);
      expect(d.unregistered).toBe(20);
      expect(d.countryId).toBe("SCO");
    }
    expect(db.collectionMocks["stateRegistrationPool"]!.deleteOne).toHaveBeenCalledWith({
      _id: "UK_SCO",
    });
  });

  it("rehomeCapital moves residents to the capital and flips countryId", async () => {
    db.collectionMocks["characters"] = undefined as never; // ensure fresh
    db.collection("characters").updateMany.mockResolvedValue({ modifiedCount: 5 });

    const writes = await applyFanout(db as unknown as Db, scopeFor("characters"), ctx);

    expect(writes).toBe(5);
    const [filter, update] = db.collectionMocks["characters"]!.updateMany.mock.calls[0];
    expect(filter).toEqual({ homeState: "SCO" });
    const set = (update as { $set: { homeState: string; countryId: string } }).$set;
    expect(set.homeState).toBe("LOT");
    expect(set.countryId).toBe("SCO");
  });

  it("rehomeCapital moves devolved artifacts (stateId) to the capital", async () => {
    db.collection("statePolicies").updateMany.mockResolvedValue({ modifiedCount: 3 });

    const writes = await applyFanout(db as unknown as Db, scopeFor("statePolicies"), ctx);

    expect(writes).toBe(3);
    const [filter, update] = db.collectionMocks["statePolicies"]!.updateMany.mock.calls[0];
    expect(filter).toEqual({ stateId: "SCO" });
    const set = (update as { $set: { stateId: string; countryId: string } }).$set;
    expect(set.stateId).toBe("LOT");
    expect(set.countryId).toBe("SCO");
  });
});

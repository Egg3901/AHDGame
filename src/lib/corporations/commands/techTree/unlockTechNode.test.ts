import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { unlockTechNode } from "./unlockTechNode";
import { corpNodeId, sectorNodeId } from "@/lib/constants/techTree";

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    type: "energy",
    rdScore: 300,
    liquidCapital: 10_000_000,
    unlockedTechNodeIds: [],
    techDecadeLane: {},
    userId: new ObjectId(),
    ceoId: new ObjectId(),
    name: "TestCorp",
    countryId: "US",
    ...overrides,
  } as unknown as Corporation;
}

/**
 * Mock db: corporateSectors.find().toArray() yields the given per-turn revenues;
 * corporations.updateOne reports the given modifiedCount.
 *
 * `gameConfig.findOne` is stubbed too: the cash-cost base now resolves the market
 * tier (below plants it is Σ revenue exactly as before; at/above plants it is
 * Σ max(revenue, capacity nameplate), so a mothballed estate cannot unlock tech
 * for free). Returning null makes `getMarketSystemModeForDb` fall back to the
 * default mode, which keeps every assertion in this file on the legacy basis.
 */
function mockDb({ revenues = [24_000], modifiedCount = 1 } = {}) {
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount });
  const db = {
    collection: (name: string) => {
      if (name === "corporateSectors") {
        return {
          find: () => ({ toArray: () => Promise.resolve(revenues.map((r) => ({ revenue: r }))) }),
        };
      }
      if (name === "gameConfig") {
        return { findOne: () => Promise.resolve(null) };
      }
      if (name === "exchangeRates") {
        // Empty rate book: every currency falls back to 1.0, so the cash base
        // stays the plain sum these assertions were written against.
        return { find: () => ({ toArray: () => Promise.resolve([]) }) };
      }
      return { updateOne, findOne: () => Promise.resolve(null) };
    },
  } as unknown as Db;
  return { db, updateOne };
}

describe("unlockTechNode (v2 dual cost + lane)", () => {
  const YEAR = 2020;
  const TURN = 100;

  it("spends rdScore + cash and commits the lane on first unlock", async () => {
    const corp = makeCorp();
    const { db, updateOne } = mockDb({ revenues: [24_000] }); // daily gross 24k, 15% => 3.6k
    const nodeId = corpNodeId("2019", 1); // cost 17

    const res = await unlockTechNode(db, corp, nodeId, YEAR, TURN);

    expect(res).toMatchObject({ ok: true, status: 200, nodeId, cashSpent: 3_600 });
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter.rdScore).toEqual({ $gte: 48 }); // 2019 decade cost
    expect(filter.liquidCapital).toEqual({ $gte: 3_600 });
    expect(update.$inc).toMatchObject({ rdScore: -48, liquidCapital: -3_600 });
    expect(update.$push).toEqual({ unlockedTechNodeIds: nodeId });
    expect(update.$set["techDecadeLane.2019"]).toBe("generic");
  });

  it("rejects on insufficient cash (402) without writing", async () => {
    const corp = makeCorp({ liquidCapital: 1_000 });
    const { db, updateOne } = mockDb({ revenues: [24_000] });

    const res = await unlockTechNode(db, corp, corpNodeId("2019", 1), YEAR, TURN);

    expect(res).toMatchObject({ ok: false, status: 402, reason: "insufficient-cash" });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("rejects on insufficient rdScore (402)", async () => {
    const corp = makeCorp({ rdScore: 1 });
    const { db, updateOne } = mockDb();
    const res = await unlockTechNode(db, corp, corpNodeId("2019", 1), YEAR, TURN);
    expect(res).toMatchObject({ ok: false, status: 402, reason: "insufficient-rd" });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("rejects a future decade (400)", async () => {
    const corp = makeCorp();
    const { db } = mockDb();
    const res = await unlockTechNode(db, corp, corpNodeId("2029", 1), YEAR, TURN);
    expect(res).toMatchObject({ ok: false, status: 400, reason: "decade-locked" });
  });

  it("rejects the other lane once committed (409)", async () => {
    const corp = makeCorp({
      unlockedTechNodeIds: [sectorNodeId("energy", "2019", 1)],
      techDecadeLane: { "2019": "sector" },
    });
    const { db } = mockDb();
    const res = await unlockTechNode(db, corp, corpNodeId("2019", 1), YEAR, TURN);
    expect(res).toMatchObject({ ok: false, status: 409, reason: "lane-locked" });
  });

  it("also grants marketing strength when the node carries it", async () => {
    // corp-1979-3 (Corporate Telephony, +30 marketing) is slot 3 → needs slot 1 first.
    const corp = makeCorp({
      unlockedTechNodeIds: [corpNodeId("1979", 1)],
      techDecadeLane: { "1979": "generic" },
    });
    const { db, updateOne } = mockDb();
    const res = await unlockTechNode(db, corp, corpNodeId("1979", 3), YEAR, TURN);
    expect(res.ok).toBe(true);
    const [filter, update] = updateOne.mock.calls[0];
    // Guard requires the parent node to be owned (tree order).
    expect(JSON.stringify(filter.$and)).toContain(corpNodeId("1979", 1));
    expect(update.$inc.marketingStrength).toBe(30);
  });

  it("rejects a node whose prerequisite isn't owned (409)", async () => {
    const corp = makeCorp(); // owns nothing
    const { db, updateOne } = mockDb();
    // corp-2019-2 needs corp-2019-1 first.
    const res = await unlockTechNode(db, corp, corpNodeId("2019", 2), YEAR, TURN);
    expect(res).toMatchObject({ ok: false, status: 409, reason: "prereq-missing" });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("returns 409 when the guarded update matches nothing", async () => {
    const corp = makeCorp();
    const { db } = mockDb({ modifiedCount: 0 });
    const res = await unlockTechNode(db, corp, corpNodeId("2019", 1), YEAR, TURN);
    expect(res).toMatchObject({ ok: false, status: 409 });
  });
});

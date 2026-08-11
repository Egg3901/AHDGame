import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { abandonTechDecade } from "./abandonTechDecade";
import { sectorNodeId } from "@/lib/constants/techTree";

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
  return {
    _id: new ObjectId(),
    type: "energy",
    marketingStrength: 0,
    logisticsStrength: 0,
    unlockedTechNodeIds: [],
    techDecadeLane: {},
    name: "TestCorp",
    ...overrides,
  } as unknown as Corporation;
}

function mockDb({ modifiedCount = 1 } = {}) {
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount });
  const db = { collection: () => ({ updateOne }) } as unknown as Db;
  return { db, updateOne };
}

describe("abandonTechDecade", () => {
  const YEAR = 2020;

  it("clears the lane, pulls the decade's nodes, and reverses grants", async () => {
    // energy-2019-4 (EV Charging Networks) grants +40 marketing strength.
    const corp = makeCorp({
      unlockedTechNodeIds: [sectorNodeId("energy", "2019", 4), sectorNodeId("energy", "2019", 1)],
      techDecadeLane: { "2019": "sector" },
      marketingStrength: 100,
    });
    const { db, updateOne } = mockDb();

    const res = await abandonTechDecade(db, corp, "2019", YEAR);

    expect(res).toMatchObject({ ok: true, status: 200, decadeId: "2019" });
    const [, update] = updateOne.mock.calls[0];
    expect(update.$unset["techDecadeLane.2019"]).toBe("");
    expect(update.$pull.unlockedTechNodeIds.$in).toContain(sectorNodeId("energy", "2019", 4));
    expect(update.$inc.marketingStrength).toBe(-40); // reversed grant
  });

  it("refuses to abandon a passed (auto-granted) decade", async () => {
    const corp = makeCorp({ techDecadeLane: { "1999": "generic" } });
    const { db, updateOne } = mockDb();
    const res = await abandonTechDecade(db, corp, "1999", YEAR);
    expect(res).toMatchObject({ ok: false, status: 400 });
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("refuses when nothing is committed for the decade", async () => {
    const corp = makeCorp();
    const { db } = mockDb();
    const res = await abandonTechDecade(db, corp, "2019", YEAR);
    expect(res).toMatchObject({ ok: false, status: 400 });
  });
});

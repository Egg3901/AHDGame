import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { recordCorporationExit } from "./recordCorporationExit";
import type { CorporationExitSnapshot } from "./rules";

const corp = {
  _id: new ObjectId(),
  name: "Acme",
  countryId: "US",
  type: "retail",
  liquidCapital: 10,
  sharePrice: 1,
  totalShares: 10,
} as unknown as CorporationExitSnapshot;

describe("recordCorporationExit", () => {
  it("writes the row with the current turn and last history revenue", async () => {
    const memory = createInMemoryDb();
    memory.seed("gameState", [{ _id: "current", currentTurn: 61 }]);
    memory.seed("corporationHistory", [
      { corporationId: corp._id, turn: 59, revenue: 5 },
      { corporationId: corp._id, turn: 60, revenue: 8 },
    ]);
    await recordCorporationExit(memory as unknown as Db, corp, { reason: "acquired" });

    const rows = await memory.collection("corporationExits").find({}).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      corporationId: corp._id,
      turn: 61,
      reason: "acquired",
      finalRevenue: 8,
      finalMarketCap: 10,
    });
  });

  it("is idempotent: a second exit for the same corporation keeps the first row", async () => {
    const memory = createInMemoryDb();
    await recordCorporationExit(memory as unknown as Db, corp, {
      reason: "bond_default",
      turn: 5,
    });
    await recordCorporationExit(memory as unknown as Db, corp, {
      reason: "voluntary_closure",
      turn: 9,
    });

    const rows = await memory.collection("corporationExits").find({}).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "bond_default", turn: 5 });
  });

  it("starts a player's refounding cooldown at the corporation exit turn", async () => {
    const memory = createInMemoryDb();
    const userId = new ObjectId();
    memory.seed("users", [{ _id: userId, lastCorporationFoundedTurn: 4 }]);

    await recordCorporationExit(
      memory as unknown as Db,
      { ...corp, userId },
      {
        reason: "voluntary_closure",
        turn: 61,
      }
    );

    const user = await memory.collection("users").findOne({ _id: userId });
    expect(user?.lastCorporationFoundedTurn).toBe(61);
  });

  it("does not start a cooldown for admin cleanup or system-owned corporations", async () => {
    const memory = createInMemoryDb();
    const userId = new ObjectId();
    const stateOwnerUserId = new ObjectId();
    memory.seed("users", [{ _id: userId }, { _id: stateOwnerUserId }]);

    await recordCorporationExit(
      memory as unknown as Db,
      { ...corp, userId },
      {
        reason: "forced_liquidation",
        turn: 61,
        cooldownExempt: true,
      }
    );
    await recordCorporationExit(
      memory as unknown as Db,
      { ...corp, _id: new ObjectId(), userId: new ObjectId("000000000000000000000000") },
      { reason: "npp_insolvency", turn: 62 }
    );
    await recordCorporationExit(
      memory as unknown as Db,
      { ...corp, _id: new ObjectId(), userId: stateOwnerUserId, ownershipState: "stateOwned" },
      { reason: "nationalized", turn: 63 }
    );

    const user = await memory.collection("users").findOne({ _id: userId });
    expect(user?.lastCorporationFoundedTurn).toBeUndefined();
    const stateOwner = await memory.collection("users").findOne({ _id: stateOwnerUserId });
    expect(stateOwner?.lastCorporationFoundedTurn).toBeUndefined();
  });

  it("does not move the cooldown anchor backwards on a late duplicate exit", async () => {
    const memory = createInMemoryDb();
    const userId = new ObjectId();
    memory.seed("users", [{ _id: userId }]);
    const ownedCorp = { ...corp, userId };

    await recordCorporationExit(memory as unknown as Db, ownedCorp, {
      reason: "voluntary_closure",
      turn: 61,
    });
    await recordCorporationExit(memory as unknown as Db, ownedCorp, {
      reason: "voluntary_closure",
      turn: 59,
    });

    const user = await memory.collection("users").findOne({ _id: userId });
    expect(user?.lastCorporationFoundedTurn).toBe(61);
  });

  it("never throws into the exit path when the write fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      collection: () => {
        throw new Error("db down");
      },
    } as unknown as Db;
    await expect(
      recordCorporationExit(broken, corp, { reason: "acquired", turn: 1 })
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

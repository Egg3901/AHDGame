import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  isDefenceProcurementPaused,
  isProcurementBlocked,
  DEFENCE_PROCUREMENT_PAUSED_MESSAGE,
} from "@/lib/military/procurementGate";

function dbWithGameState(doc: unknown): Db {
  const db = createMockDb();
  db.collection("gameState");
  db.collectionMocks.gameState.findOne.mockResolvedValue(doc);
  return db as unknown as Db;
}

describe("isDefenceProcurementPaused", () => {
  it("is true only when the flag is explicitly set", async () => {
    expect(
      await isDefenceProcurementPaused(dbWithGameState({ defenceProcurementPaused: true }))
    ).toBe(true);
  });

  it("is false when the flag is false, absent, or the doc is missing", async () => {
    expect(
      await isDefenceProcurementPaused(dbWithGameState({ defenceProcurementPaused: false }))
    ).toBe(false);
    expect(await isDefenceProcurementPaused(dbWithGameState({}))).toBe(false);
    expect(await isDefenceProcurementPaused(dbWithGameState(null))).toBe(false);
  });

  it("reads the singleton current doc, projected to just the flag", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue(null);
    await isDefenceProcurementPaused(db as unknown as Db);
    const [filter, options] = db.collectionMocks.gameState.findOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: "current" });
    expect(options).toMatchObject({ projection: { defenceProcurementPaused: 1 } });
  });
});

describe("isProcurementBlocked", () => {
  function dbWith(opts: {
    globalPause?: boolean;
    restriction?: { expiresTurn: number } | null;
  }): Db {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      defenceProcurementPaused: opts.globalPause === true,
    });
    db.collection("procurementRestrictions");
    db.collectionMocks.procurementRestrictions.findOne.mockResolvedValue(opts.restriction ?? null);
    return db as unknown as Db;
  }

  it("passes when nothing bars the country", async () => {
    expect(await isProcurementBlocked(dbWith({}), "TR", 100)).toEqual({ blocked: false });
  });

  it("blocks on the global kill switch, with no expiry to report", async () => {
    const result = await isProcurementBlocked(dbWith({ globalPause: true }), "TR", 100);
    expect(result).toMatchObject({ blocked: true, until: null });
    if (result.blocked) expect(result.reason).toBe(DEFENCE_PROCUREMENT_PAUSED_MESSAGE);
  });

  it("blocks a country under a live restriction and names the lapse turn", async () => {
    // A bar a player can see beforehand beats one discovered by being refused,
    // which is the same argument listActiveTruces makes.
    const result = await isProcurementBlocked(
      dbWith({ restriction: { expiresTurn: 340 } }),
      "TR",
      100
    );
    expect(result).toMatchObject({ blocked: true, until: 340 });
    if (result.blocked) expect(result.reason).toContain("340");
  });

  it("lapses ON the expiry turn, matching the truce and offer convention", async () => {
    const db = dbWith({ restriction: { expiresTurn: 340 } });
    expect((await isProcurementBlocked(db, "TR", 339)).blocked).toBe(true);
    expect((await isProcurementBlocked(db, "TR", 340)).blocked).toBe(false);
  });

  it("reports the global switch ahead of a country restriction", async () => {
    // They are different things: one is a kill switch for an exploit, the other a
    // settlement term, and a minister told the wrong one would chase the wrong fix.
    const db = dbWith({ globalPause: true, restriction: { expiresTurn: 340 } });
    const result = await isProcurementBlocked(db, "TR", 100);
    expect(result).toMatchObject({ until: null });
  });

  it("uses no em dash or en dash in the reason it gives", async () => {
    const result = await isProcurementBlocked(
      dbWith({ restriction: { expiresTurn: 340 } }),
      "TR",
      100
    );
    if (result.blocked) expect(result.reason).not.toMatch(/[\u2014\u2013]/);
  });
});

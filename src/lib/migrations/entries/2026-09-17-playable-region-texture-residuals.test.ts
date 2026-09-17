import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { bulkOps, createMockDb } from "@/lib/test-utils/mockDb";
import { REGIONAL_TEXTURE_1953 } from "@/lib/politicalMetrics/seeds/regionalTexture1953";
import { migration } from "./2026-09-17-playable-region-texture-residuals";

const run = (db: Db, dryRun = false) => migration.execute(db, { dryRun });

function cursor<T>(docs: T[]) {
  return { toArray: async () => docs };
}

function game1953(db: ReturnType<typeof createMockDb>) {
  db.collection("gameState");
  db.collectionMocks.gameState!.findOne.mockResolvedValue({
    _id: "current",
    preset: "1953-default",
    startingYear: 1953,
  });
}

function metrics(db: ReturnType<typeof createMockDb>, docs: Array<Record<string, unknown>>) {
  db.collection("politicalMetrics");
  db.collectionMocks.politicalMetrics!.find.mockReturnValue(cursor(docs) as never);
  db.collectionMocks.politicalMetrics!.bulkWrite.mockResolvedValue({
    modifiedCount: 1,
  } as never);
}

describe(migration.id, () => {
  it("adds the texture delta via a whole-map residuals $set", async () => {
    const db = createMockDb();
    game1953(db);
    const family = "economy.competition";
    const delta = REGIONAL_TEXTURE_1953.US.AL?.[family];
    expect(typeof delta).toBe("number");
    metrics(db, [
      {
        _id: "AL",
        countryId: "US",
        residuals: { [family]: 3, "order.safety": 1 },
      },
    ]);

    const result = await run(db as unknown as Db);
    expect(result.documentsUpdated).toBe(1);

    const ops = bulkOps(db.collectionMocks.politicalMetrics!.bulkWrite);
    expect(ops).toHaveLength(1);
    const [filter, update] = ops[0];
    expect(filter).toEqual({ _id: "AL" });
    const set = (update as { $set: Record<string, unknown> }).$set;
    // Board maps are keyed by literal dotted strings, so the write must $set
    // the whole map: a dotted "residuals.<family>" path would nest instead of
    // landing. Never an $unset (which would fork the dynamics self-heal).
    expect(update).not.toHaveProperty("$unset");
    for (const key of Object.keys(set)) expect(key).not.toContain(".");
    const residuals = set.residuals as Record<string, number>;
    expect(residuals[family]).toBe(3 + delta!);
    // Siblings (including event-driven movement) survive the rewrite, with
    // their own texture delta folded in like every other family.
    const safetyDelta = REGIONAL_TEXTURE_1953.US.AL?.["order.safety"] ?? 0;
    expect(residuals["order.safety"]).toBe(1 + safetyDelta);
    expect(set.playableTexture1953MigrationId).toBe(migration.id);
  });

  it("is a read-only dry run when asked", async () => {
    const db = createMockDb();
    game1953(db);
    metrics(db, [{ _id: "AL", countryId: "US", residuals: { "economy.competition": 3 } }]);

    const result = await run(db as unknown as Db, true);
    expect(result.documentsUpdated).toBe(0);
    expect(db.collectionMocks.politicalMetrics!.bulkWrite).not.toHaveBeenCalled();
    expect((result.notes ?? []).join("\n")).toMatch(/dry run/i);
  });

  it("skips worlds whose preset is not 1953-default", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      startingYear: 2019,
    });

    const result = await run(db as unknown as Db);
    expect(result.documentsUpdated ?? 0).toBe(0);
    expect((result.notes ?? []).join("\n")).toMatch(/skipped: active preset/);
  });

  it("skips 1953-preset worlds whose starting year is not 1953", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
      startingYear: 2019,
    });

    const result = await run(db as unknown as Db);
    expect(result.documentsUpdated ?? 0).toBe(0);
    expect((result.notes ?? []).join("\n")).toMatch(/skipped: startingYear/);
  });

  it("does not double-apply: stamped docs are skipped on re-run", async () => {
    const db = createMockDb();
    game1953(db);
    metrics(db, [
      {
        _id: "AL",
        countryId: "US",
        residuals: { "economy.competition": 3 },
        playableTexture1953MigrationId: migration.id,
      },
    ]);

    const result = await run(db as unknown as Db);
    expect(result.documentsUpdated).toBe(0);
    expect(db.collectionMocks.politicalMetrics!.bulkWrite).not.toHaveBeenCalled();
    expect((result.notes ?? []).join("\n")).toMatch(/already stamped/);
  });

  it("leaves docs without a residuals map for the dynamics self-heal", async () => {
    const db = createMockDb();
    game1953(db);
    metrics(db, [{ _id: "AL", countryId: "US", values: {} }]);

    const result = await run(db as unknown as Db);
    expect(result.documentsUpdated).toBe(0);
    expect(db.collectionMocks.politicalMetrics!.bulkWrite).not.toHaveBeenCalled();
    expect((result.notes ?? []).join("\n")).toMatch(/no residuals map/);
  });

  it("skips regions carrying no texture without writing", async () => {
    const db = createMockDb();
    game1953(db);
    metrics(db, [{ _id: "XX", countryId: "US", residuals: { "economy.competition": 1 } }]);

    const result = await run(db as unknown as Db);
    expect(result.documentsUpdated).toBe(0);
    expect(db.collectionMocks.politicalMetrics!.bulkWrite).not.toHaveBeenCalled();
    expect((result.notes ?? []).join("\n")).toMatch(/no texture/);
  });
});

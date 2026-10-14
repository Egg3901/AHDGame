import type { Db } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "../registry";
import { REQUIRED_STARTUP_MIGRATIONS } from "../startupMigrations";
import { migration } from "./2026-10-15-live-world-npp-autonomy-v6";

function fakeDb(state: Record<string, unknown> | null) {
  const updateOne = vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
  const findOne = vi.fn(async () => state);
  const db = { collection: () => ({ findOne, updateOne }) } as unknown as Db;
  return { db, updateOne };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("2026-10-15-live-world-npp-autonomy-v6", () => {
  it("is an idempotent registry migration that runs at startup", () => {
    expect(migration.idempotent).toBe(true);
    expect(MIGRATIONS).toContain(migration);
    expect(REQUIRED_STARTUP_MIGRATIONS).toContain(migration);
  });

  it.each(["v4", "v5"])("raises a hosted %s world to v6", async (level) => {
    const { db, updateOne } = fakeDb({ _id: "current", nppAutonomyLevel: level, currentTurn: 199 });

    const result = await migration.execute(db, { dryRun: false });

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter).toMatchObject({
      _id: "current",
      nppAutonomyLevel: { $in: ["v4", "v5"] },
      singleplayerConfig: { $exists: false },
    });
    expect(update.$set).toMatchObject({ nppAutonomyLevel: "v6", nppAutonomyEnabled: true });
    expect(result.documentsUpdated).toBe(1);
  });

  it.each(["off", "v0", "v3", "v6", undefined])("keeps level %s", async (level) => {
    const { db, updateOne } = fakeDb({ _id: "current", nppAutonomyLevel: level });

    await migration.execute(db, { dryRun: false });

    expect(updateOne).not.toHaveBeenCalled();
  });

  it("keeps a singleplayer world's chosen level", async () => {
    const { db, updateOne } = fakeDb({
      _id: "current",
      nppAutonomyLevel: "v4",
      singleplayerConfig: { nppAutonomyLevel: "v4" },
    });

    await migration.execute(db, { dryRun: false });

    expect(updateOne).not.toHaveBeenCalled();
  });

  it("does nothing on a singleplayer process", async () => {
    vi.stubEnv("SINGLEPLAYER", "1");
    for (const key of [
      "RAILWAY_ENVIRONMENT_NAME",
      "RAILWAY_SERVICE_NAME",
      "RAILWAY_PROJECT_ID",
      "VERCEL_ENV",
      "KUBERNETES_SERVICE_HOST",
      "NEXT_PUBLIC_BASE_URL",
      "MONGODB_URI",
      "MONGO_URL",
    ]) {
      vi.stubEnv(key, "");
    }
    const { db, updateOne } = fakeDb({ _id: "current", nppAutonomyLevel: "v4" });

    await migration.execute(db, { dryRun: false });

    expect(updateOne).not.toHaveBeenCalled();
  });

  it("writes nothing on a dry run", async () => {
    const { db, updateOne } = fakeDb({ _id: "current", nppAutonomyLevel: "v4" });

    const result = await migration.execute(db, { dryRun: true });

    expect(updateOne).not.toHaveBeenCalled();
    expect(result.notes?.[0]).toContain("would raise v4 to v6");
  });
});

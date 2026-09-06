import { describe, expect, it, vi } from "vitest";
import { migration } from "./2026-09-06-client-statistics-ttl-index";

function fakeDb() {
  const collection = {
    indexes: vi.fn().mockResolvedValue([]),
    createIndex: vi.fn().mockResolvedValue("clientSimulationStatistics_expiresAt_ttl"),
  };
  return { db: { collection: vi.fn().mockReturnValue(collection) }, collection };
}

describe("client statistics TTL migration", () => {
  it("reports the index in dry-run and creates it only in execution mode", async () => {
    const dry = fakeDb();
    const dryResult = await migration.execute(dry.db as never, { dryRun: true });
    expect(dryResult.notes?.[0]).toContain("would create");
    expect(dry.collection.createIndex).not.toHaveBeenCalled();

    const live = fakeDb();
    await migration.execute(live.db as never, { dryRun: false });
    expect(live.collection.createIndex).toHaveBeenCalledWith(
      { expiresAt: 1 },
      { name: "clientSimulationStatistics_expiresAt_ttl", expireAfterSeconds: 0 }
    );
  });
});

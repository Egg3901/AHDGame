import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { seedIndexes } from "./seedIndexes";

/**
 * A Db whose `createIndex` yields to the microtask queue before resolving, so
 * concurrently-running modules genuinely interleave. Without the per-module log
 * buffering that interleaving would scramble the seed log.
 */
function makeInterleavingDb(): { db: Db; createIndex: ReturnType<typeof vi.fn> } {
  const createIndex = vi.fn().mockImplementation(async () => {
    // Several ticks — enough for every other in-flight module to advance.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    return "ok";
  });
  // seedCoreIndexes repairs duplicate corporateSectors before it can build the
  // unique identity index. Report that index as already present so this
  // ordering test does not drag the repair path in with it.
  const indexes = vi.fn().mockResolvedValue([
    {
      name: "corporateSectors_corporationId_stateId_sectorType",
      key: { corporationId: 1, stateId: 1, sectorType: 1 },
      unique: true,
    },
  ]);
  const cursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  };
  const db = {
    collection: vi.fn().mockReturnValue({
      createIndex,
      indexes,
      find: vi.fn().mockReturnValue(cursor),
      aggregate: vi.fn().mockReturnValue(cursor),
    }),
  } as unknown as Db;
  return { db, createIndex };
}

// Header lines, in the order the modules are declared in seedIndexes.
const HEADERS = [
  "Core indexes:",
  "Activity log indexes:",
  "Cabinet indexes:",
  "Performance indexes:",
  "Slow-query indexes:",
  "Search indexes:",
  "International organization indexes:",
  "Election write-guard indexes:",
  "Caucus indexes:",
  "Sovereign default indexes:",
  "Game health snapshot indexes:",
  "Financial transaction log indexes:",
  "Shadow ledger indexes:",
  "Commodity price indexes:",
  "Index fund indexes:",
  "API key indexes:",
  "Crisis interaction indexes:",
  "Crisis indexes:",
  "Action audit log indexes:",
  "Alt-detection indexes:",
  "Audit anomaly scan indexes:",
  "Watchlist indexes:",
  "Conflict indexes:",
  "Banking money-move indexes:",
];

describe("seedIndexes", () => {
  it("emits module logs in declaration order even though modules run concurrently", async () => {
    const { db } = makeInterleavingDb();
    const lines: string[] = [];
    await seedIndexes(db, (m) => lines.push(m));

    const seen = lines.filter((l) => HEADERS.includes(l));
    expect(seen).toEqual(HEADERS);
  });

  it("keeps each module's index lines contiguous with its own header", async () => {
    // The failure this guards: concurrent modules writing straight to the sink
    // interleave, so a line under "Cabinet indexes:" may actually belong to a
    // different module. The op-profiler parses this log for phase gaps and
    // repeated passes.
    const { db } = makeInterleavingDb();
    const lines: string[] = [];
    await seedIndexes(db, (m) => lines.push(m));

    const headerPositions = HEADERS.map((h) => lines.indexOf(h));
    expect(headerPositions.every((p) => p >= 0)).toBe(true);
    // Strictly increasing => no module's block was split across another's.
    for (let i = 1; i < headerPositions.length; i++) {
      expect(headerPositions[i]).toBeGreaterThan(headerPositions[i - 1]);
    }
    expect(lines[lines.length - 1]).toBe("All indexes ensured");
  });

  it("is a barrier — every index is created before it resolves", async () => {
    // Indexes must all exist before the seeders' upsert loops run, or those
    // loops fall back to collection scans.
    const { db, createIndex } = makeInterleavingDb();
    let settled = 0;
    createIndex.mockImplementation(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      settled++;
      return "ok";
    });

    const promise = seedIndexes(db, () => {});
    const callsAtStart = createIndex.mock.calls.length;
    await promise;

    expect(createIndex.mock.calls.length).toBeGreaterThan(callsAtStart);
    expect(settled).toBe(createIndex.mock.calls.length);
  });

  it("no longer double-declares the four slow-query indexes", async () => {
    // corporationHistory/commodityPriceHistory/actionLogs/statePartyElections
    // were declared identically in both performance.ts and slowQuery.ts; each
    // duplicate cost a no-op round trip on every seed.
    const { db, createIndex } = makeInterleavingDb();
    await seedIndexes(db, () => {});

    const names = createIndex.mock.calls
      .map((c) => (c[1] as { name?: string } | undefined)?.name)
      .filter((n): n is string => typeof n === "string");
    for (const dup of [
      "corporationHistory_corporationId_turn",
      "commodityPriceHistory_commodity_turn",
      "actionLogs_characterId_actionType",
      "statePartyElections_stateId_partyId_status",
    ]) {
      expect(names.filter((n) => n === dup)).toHaveLength(1);
    }
  });
});

/**
 * Contract tests for the election spawners' GameState snapshot.
 *
 * Every `ensure*` spawner opens with the same GameState read. The bootstrap
 * battery runs ~28 of them back to back, so it wraps them in
 * `withElectionGameStateSnapshot` and they share one read.
 *
 * The properties that matter are about SCOPE, not speed:
 *   1. inside the scope, one read serves every spawner;
 *   2. outside it, nothing is cached — the per-turn callers must observe their
 *      own turn's write;
 *   3. the scope does not outlive its callback, so a later turn can never be
 *      served a previous turn's snapshot.
 *
 * (3) is the one a module-level cache would fail, and it would fail silently:
 * elections would be scheduled against a stale `currentTurn` with no error and
 * no row-count change. It is also the shape that nearly shipped the A6 fix as a
 * no-op, where a cache filled before `stampInitialGameClock` served a pre-stamp
 * preset.
 */
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  ensureDEElections,
  ensureJPElections,
  ensurePerpetualElections,
  ensureUKElections,
  ngElectionsLive,
  withElectionGameStateSnapshot,
} from "./perpetualElections";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function dbWithTurn(currentTurn: number) {
  const db = createMockDb();
  db.collection("gameState").findOne.mockResolvedValue({
    _id: "current",
    currentTurn,
    currentYear: 1953,
    preset: "1953-default",
  });
  return db;
}

const reads = (db: ReturnType<typeof createMockDb>) =>
  db.collectionMocks.gameState!.findOne.mock.calls.length;

describe("withElectionGameStateSnapshot", () => {
  it("serves real spawners from the snapshot instead of re-reading", async () => {
    const db = dbWithTurn(7);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    await withElectionGameStateSnapshot(db as unknown as Db, async () => {
      // Drive actual spawners through the shared `getCurrentTurnAndCtx` funnel.
      // They run against a bare mock and may bail early; what is under test is
      // that they do not issue their own GameState read, so failures are
      // swallowed deliberately.
      await ensurePerpetualElections(new Date(), 7).catch(() => {});
      await ensureUKElections(new Date()).catch(() => {});
    });

    // A scope costs a FIXED number of gameState reads regardless of how many
    // spawners run inside it — that is the property, not the literal count.
    // (It is 2: one for the turn context, one for the country-access prefetch's
    // NPP-rank lookup, which buys 45 fewer countryGameStates reads.)
    const withTwoSpawners = reads(db);

    const db2 = dbWithTurn(7);
    vi.mocked(getDb).mockResolvedValue(db2 as unknown as Db);
    await withElectionGameStateSnapshot(db2 as unknown as Db, async () => {
      await ensurePerpetualElections(new Date(), 7).catch(() => {});
      await ensureUKElections(new Date()).catch(() => {});
      await ensureJPElections(new Date()).catch(() => {});
      await ensureDEElections(new Date()).catch(() => {});
    });
    expect(reads(db2), "reads must not grow with spawner count").toBe(withTwoSpawners);
  });

  it("does not leak the snapshot past its callback", async () => {
    const db = dbWithTurn(7);
    await withElectionGameStateSnapshot(db as unknown as Db, async () => {});
    const afterScope = reads(db);
    expect(afterScope).toBeGreaterThan(0);

    // A second scope must read again rather than reuse the first one's store.
    await withElectionGameStateSnapshot(db as unknown as Db, async () => {});
    expect(reads(db), "a second scope re-reads").toBe(afterScope * 2);
  });

  it("keeps concurrent scopes isolated from each other", async () => {
    // Two worlds at different turns, interleaved. A module-level cache would
    // let whichever ran last overwrite the other.
    const a = dbWithTurn(1);
    const b = dbWithTurn(99);
    let seenA = -1;
    let seenB = -1;
    await Promise.all([
      withElectionGameStateSnapshot(a as unknown as Db, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seenA = reads(a);
      }),
      withElectionGameStateSnapshot(b as unknown as Db, async () => {
        seenB = reads(b);
      }),
    ]);
    // Each scope did its own reads; neither served the other.
    expect(seenA).toBeGreaterThan(0);
    expect(seenB).toBe(seenA);
  });

  it("prefetches country access once, so callers stop probing per country", async () => {
    // Guards the OTHER half of the scope. The assertions above count gameState
    // reads and would pass with the country-access snapshot removed — dropping
    // it makes gameState reads go DOWN, not up.
    //
    // `ngElectionsLive` is used rather than a full spawner because it calls
    // `getCountryAccessFromDb` as its first act. A spawner bails against a bare
    // mock long before reaching its own access check, which made an earlier
    // version of this test pass whether or not the snapshot existed.
    const db = dbWithTurn(7);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    await withElectionGameStateSnapshot(db as unknown as Db, async () => {
      await ngElectionsLive(db as unknown as Db);
      await ngElectionsLive(db as unknown as Db);
      await ngElectionsLive(db as unknown as Db);
    });

    const probes = db.collectionMocks.countryGameStates?.findOne.mock.calls.length ?? 0;
    expect(probes, "callers must not probe countryGameStates one by one").toBe(0);
  });

  it("still reads per country when NO snapshot scope is open", async () => {
    // The fallback path: outside a scope the behaviour is unchanged, so the
    // per-turn callers keep seeing live data.
    const db = dbWithTurn(7);
    await ngElectionsLive(db as unknown as Db);
    await ngElectionsLive(db as unknown as Db);
    expect(db.collectionMocks.countryGameStates?.findOne.mock.calls.length).toBe(2);
  });

  it("propagates the callback's return value and errors", async () => {
    const db = dbWithTurn(3);
    await expect(
      withElectionGameStateSnapshot(db as unknown as Db, async () => "ok")
    ).resolves.toBe("ok");
    await expect(
      withElectionGameStateSnapshot(db as unknown as Db, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});

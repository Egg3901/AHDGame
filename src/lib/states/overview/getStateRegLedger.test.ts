import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, type MockCollection } from "@/lib/test-utils/mockDb";

function cursor(rows: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

/**
 * Cursor that actually HONOURS `.limit()`, so the over-fetch sizing is under
 * test rather than assumed. `cursor` above returns every row regardless, which
 * makes the row-budget invisible.
 */
function limitedCursor(rows: unknown[]) {
  let cap = rows.length;
  const c = {
    toArray: vi.fn(async () => rows.slice(0, cap)),
    sort: vi.fn(() => c),
    limit: vi.fn((n: number) => {
      cap = n;
      return c;
    }),
    skip: vi.fn(() => c),
    project: vi.fn(() => c),
  };
  return c;
}

describe("getStateRegLedger", () => {
  let db: MockDb;

  // Materialize a collection mock (collectionMocks only populate once
  // `db.collection(name)` is called) so we can configure return values.
  const coll = (name: string): MockCollection => db.collection(name) as unknown as MockCollection;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("returns unseeded when no statePartyOrg row has a registration value", async () => {
    coll("statePartyOrg").find.mockReturnValue(
      cursor([{ _id: "MO_3", partyId: "3", organization: 40 }]) // no registration
    );
    const { getStateRegLedger } = await import("./getStateRegLedger");
    const result = await getStateRegLedger(db as unknown as Db, { countryId: "US", stateId: "MO" });
    expect(result.seeded).toBe(false);
    expect(result.headline).toBeNull();
    expect(result.movement).toEqual([]);
  });

  it("returns headline top-Reg party and ascending movement series when seeded", async () => {
    coll("statePartyOrg").find.mockReturnValue(
      cursor([
        { _id: "MO_3", partyId: "3", organization: 40, registration: 49 },
        { _id: "MO_4", partyId: "4", organization: 30, registration: 27 },
      ])
    );
    coll("politicalParties").find.mockReturnValue(
      cursor([
        { sequentialId: 3, abbreviation: "DEM", color: "#3b82f6" },
        { sequentialId: 4, abbreviation: "GOP", color: "#ef4444" },
      ])
    );
    coll("orgRegLedger").find.mockReturnValue(
      cursor([
        { turn: 100, partyId: "3", metric: "reg", value: 49 },
        { turn: 98, partyId: "3", metric: "reg", value: 48.5 },
      ])
    );
    const { getStateRegLedger } = await import("./getStateRegLedger");
    const result = await getStateRegLedger(db as unknown as Db, { countryId: "US", stateId: "MO" });
    expect(result.seeded).toBe(true);
    expect(result.headline).toEqual({ partyId: "3", abbr: "DEM", color: "#3b82f6", regPct: 49 });
    expect(result.movement.map((m) => m.turn)).toEqual([98, 100]);
    expect(result.movement.map((m) => m.regPct)).toEqual([48.5, 49]);
  });

  it("collapses several same-turn rows to the last-written value per turn", async () => {
    // A party can get more than one `reg` row per turn (drift sourced from
    // its surplus, then decay). The sparkline is one point per turn, and the
    // point must be the running total after the LAST write of that turn,
    // which is the row with the greatest _id in the batch insert.
    coll("statePartyOrg").find.mockReturnValue(
      cursor([{ _id: "GA_1", partyId: "1", organization: 13.5, registration: 77.2 }])
    );
    coll("politicalParties").find.mockReturnValue(
      cursor([{ sequentialId: 1, abbreviation: "DEM", color: "#3b82f6" }])
    );
    coll("orgRegLedger").find.mockReturnValue(
      cursor([
        // Turn 100: decay row (later _id) then drift row (earlier _id), in
        // the arbitrary order a turn-only sort can return them.
        { _id: "66000000000000000000000b", turn: 100, partyId: "1", metric: "reg", value: 77.2 },
        { _id: "66000000000000000000000a", turn: 100, partyId: "1", metric: "reg", value: 77.3 },
        { _id: "660000000000000000000009", turn: 99, partyId: "1", metric: "reg", value: 77.4 },
        { _id: "660000000000000000000008", turn: 99, partyId: "1", metric: "reg", value: 77.5 },
      ])
    );
    const { getStateRegLedger } = await import("./getStateRegLedger");
    const result = await getStateRegLedger(db as unknown as Db, { countryId: "US", stateId: "GA" });
    expect(result.movement).toEqual([
      { turn: 99, regPct: 77.4 },
      { turn: 100, regPct: 77.2 },
    ]);
  });

  it("still honours the lookback window in turns, not rows, when turns carry two rows", async () => {
    coll("statePartyOrg").find.mockReturnValue(
      cursor([{ _id: "GA_1", partyId: "1", organization: 13.5, registration: 70 }])
    );
    coll("politicalParties").find.mockReturnValue(cursor([]));
    const rows: unknown[] = [];
    for (let turn = 120; turn >= 1; turn--) {
      const hex = (n: number) => n.toString(16).padStart(24, "0");
      rows.push({
        _id: hex(turn * 2 + 1),
        turn,
        partyId: "1",
        metric: "reg",
        value: 70 - 0.1 * (120 - turn),
      });
      rows.push({
        _id: hex(turn * 2),
        turn,
        partyId: "1",
        metric: "reg",
        value: 70.05 - 0.1 * (120 - turn),
      });
    }
    coll("orgRegLedger").find.mockReturnValue(cursor(rows));
    const { getStateRegLedger } = await import("./getStateRegLedger");
    const result = await getStateRegLedger(db as unknown as Db, {
      countryId: "US",
      stateId: "GA",
      lookbackTurns: 24,
    });
    expect(result.movement).toHaveLength(24);
    expect(result.movement[0].turn).toBe(97);
    expect(result.movement[23].turn).toBe(120);
    expect(result.movement[23].regPct).toBeCloseTo(70, 9);
  });

  it("fills the lookback window when a party carries a donor row per rival drive", async () => {
    // A party is not limited to renormalize + drift + decay + its own drive
    // row: it also takes one NEGATIVE drive row for every rival whose
    // registration drive sources its surplus. With six US parties funding
    // drives that is 8 reg rows in a single turn, and an over-fetch budgeted
    // for 4 silently returns half the requested window.
    const ROWS_PER_TURN = 8;
    coll("statePartyOrg").find.mockReturnValue(
      cursor([{ _id: "GA_1", partyId: "1", organization: 13.5, registration: 70 }])
    );
    coll("politicalParties").find.mockReturnValue(cursor([]));
    const rows: unknown[] = [];
    const hex = (n: number) => n.toString(16).padStart(24, "0");
    for (let turn = 120; turn >= 1; turn--) {
      for (let i = ROWS_PER_TURN - 1; i >= 0; i--) {
        rows.push({
          _id: hex(turn * ROWS_PER_TURN + i),
          turn,
          partyId: "1",
          metric: "reg",
          value: 70 - 0.1 * (120 - turn),
        });
      }
    }
    coll("orgRegLedger").find.mockReturnValue(limitedCursor(rows));
    const { getStateRegLedger } = await import("./getStateRegLedger");
    const result = await getStateRegLedger(db as unknown as Db, {
      countryId: "US",
      stateId: "GA",
      lookbackTurns: 24,
    });

    expect(result.movement).toHaveLength(24);
    expect(result.movement[0].turn).toBe(97);
    expect(result.movement[23].turn).toBe(120);
  });
});

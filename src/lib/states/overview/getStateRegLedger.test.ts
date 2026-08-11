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
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resolveRegionReferendumByCycle, listCountryReferendums } from "./referendumCycles";

function cursorOf<T>(docs: T[]) {
  const c = { sort: vi.fn(() => c), toArray: vi.fn().mockResolvedValue(docs) };
  return c;
}

const ref = (over: Record<string, unknown>) => ({
  countryId: "UK",
  regionId: "NIR",
  kind: "reunification",
  status: "settled",
  yesShare: 40,
  campaignCloseTurn: null,
  requestedTurn: 1,
  createdAt: new Date(1),
  ...over,
});

describe("resolveRegionReferendumByCycle", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("assigns cycles by requestedTurn and resolves the latest with no cycle arg", async () => {
    db.collection("referendums").find.mockReturnValue(
      cursorOf([
        ref({ _id: "a", requestedTurn: 10 }),
        ref({ _id: "b", requestedTurn: 50, status: "campaigning" }),
      ])
    );
    const r = await resolveRegionReferendumByCycle(db as unknown as Db, "UK", "NIR");
    expect(r?.cycle).toBe(2);
    expect(r?.totalCycles).toBe(2);
    expect(String(r?.referendum._id)).toBe("b");
    expect(r?.prevCycle).toBe(1);
    expect(r?.nextCycle).toBeNull();
  });

  it("resolves an explicit cycle and exposes prev/next", async () => {
    db.collection("referendums").find.mockReturnValue(
      cursorOf([ref({ _id: "a", requestedTurn: 10 }), ref({ _id: "b", requestedTurn: 50 })])
    );
    const r = await resolveRegionReferendumByCycle(db as unknown as Db, "UK", "NIR", 1);
    expect(String(r?.referendum._id)).toBe("a");
    expect(r?.prevCycle).toBeNull();
    expect(r?.nextCycle).toBe(2);
  });

  it("returns null for an out-of-range cycle or empty region", async () => {
    db.collection("referendums").find.mockReturnValue(cursorOf([]));
    expect(await resolveRegionReferendumByCycle(db as unknown as Db, "UK", "NIR")).toBeNull();
    db.collection("referendums").find.mockReturnValue(cursorOf([ref({ _id: "a" })]));
    expect(await resolveRegionReferendumByCycle(db as unknown as Db, "UK", "NIR", 9)).toBeNull();
  });
});

describe("listCountryReferendums", () => {
  it("splits active campaigns from past, each with its region cycle", async () => {
    const db = createMockDb();
    db.collection("referendums").find.mockReturnValue(
      cursorOf([
        ref({ _id: "a", regionId: "NIR", requestedTurn: 10, status: "settled" }),
        ref({ _id: "b", regionId: "NIR", requestedTurn: 50, status: "campaigning" }),
        ref({ _id: "c", regionId: "SCO", requestedTurn: 20, status: "declined" }),
      ])
    );
    db.collection("statePartyOrg").find.mockReturnValue(cursorOf([]));
    const { active, past } = await listCountryReferendums(db as unknown as Db, "UK");
    expect(active.map((r) => r.referendumId)).toEqual(["b"]);
    expect(active[0].cycle).toBe(2);
    expect(past.map((r) => r.referendumId).sort()).toEqual(["a", "c"]);
  });

  it("carries pollHistory on each row (empty array when absent)", async () => {
    const db = createMockDb();
    db.collection("referendums").find.mockReturnValue(
      cursorOf([
        ref({
          _id: "b",
          regionId: "NIR",
          requestedTurn: 50,
          status: "campaigning",
          pollHistory: [{ turn: 5, yesShare: 52 }],
        }),
        ref({ _id: "c", regionId: "SCO", requestedTurn: 20, status: "settled" }),
      ])
    );
    db.collection("statePartyOrg").find.mockReturnValue(cursorOf([]));
    const { active, past } = await listCountryReferendums(db as unknown as Db, "UK");
    expect(active[0].pollHistory).toEqual([{ turn: 5, yesShare: 52 }]);
    expect(past[0].pollHistory).toEqual([]);
  });

  it("reports position counts for active campaigns (undeclared = org parties − declared)", async () => {
    const db = createMockDb();
    db.collection("referendums").find.mockReturnValue(
      cursorOf([
        ref({
          _id: "b",
          regionId: "NIR",
          requestedTurn: 50,
          status: "campaigning",
          partyPositions: [
            { partyId: "8", side: "yes" },
            { partyId: "3", side: "no" },
          ],
        }),
      ])
    );
    // 4 org-present parties in NIR.
    db.collection("statePartyOrg").find.mockReturnValue(
      cursorOf([{ stateId: "NIR" }, { stateId: "NIR" }, { stateId: "NIR" }, { stateId: "NIR" }])
    );
    const { active } = await listCountryReferendums(db as unknown as Db, "UK");
    expect(active[0].positionCounts).toEqual({ for: 1, against: 1, undeclared: 2 });
  });
});

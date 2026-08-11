import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

/** The sweep reads each collection with a single projected `find`. */
function stubEmptyFind(db: MockDb, name: string) {
  db.collection(name).find.mockReturnValue({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  });
}

/**
 * Every row the sweep wrote, flattened out of its batched `insertMany`.
 *
 * Batched deliberately: this runs on every read of the world-org view, and one
 * `findOne` per member cost ~1s of round-trips per page load once the UN's 1953
 * roster reached 60 seats.
 */
function insertedFrom(db: MockDb, name: string): { organizationId: string; countryId: string }[] {
  return db.collectionMocks[name]!.insertMany.mock.calls.flatMap(
    (c) => c[0] as { organizationId: string; countryId: string }[]
  );
}

describe("ensureFoundingMembershipsAndLeadership — respects withdrawal tombstones", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    // No membership exists for anyone → the self-heal WOULD insert every founder
    // unless a tombstone suppresses it. The sweep discovers what exists with one
    // `find` rather than a `findOne` per member, so that is what is stubbed.
    emptyFind("organizationMemberships");
    emptyFind("organizationLeadership");
  });

  function tombstones(rows: { organizationId: string; countryId: string }[]) {
    db.collection("organizationWithdrawals").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(rows),
    });
  }

  const emptyFind = (name: string) => stubEmptyFind(db, name);
  const insertedMemberships = () => insertedFrom(db, "organizationMemberships");

  it("does NOT re-add a founding member that deliberately withdrew", async () => {
    tombstones([{ organizationId: "NATO", countryId: "DE" }]);

    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await ensureFoundingMembershipsAndLeadership(db as unknown as Db);

    const inserted = insertedMemberships();
    // DE is a NATO founding member but withdrew → must be skipped.
    expect(inserted).not.toContainEqual({ organizationId: "NATO", countryId: "DE" });
    // Other NATO founders are still backfilled.
    expect(inserted).toContainEqual(
      expect.objectContaining({ organizationId: "NATO", countryId: "US" })
    );
  });

  it("re-adds founding members when there are no tombstones", async () => {
    tombstones([]);

    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await ensureFoundingMembershipsAndLeadership(db as unknown as Db);

    const inserted = insertedMemberships();
    expect(inserted).toContainEqual(
      expect.objectContaining({ organizationId: "NATO", countryId: "DE" })
    );
  });
});

describe("ensureFoundingMembershipsAndLeadership — era + founding-year aware", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    emptyFind("organizationMemberships");
    emptyFind("organizationLeadership");
    emptyFind("organizationWithdrawals");
  });

  const emptyFind = (name: string) => stubEmptyFind(db, name);
  const insertedMemberships = () => insertedFrom(db, "organizationMemberships");

  it("heals the 1953 NATO roster (FR/GR/IT/TR), not the modern default (no DE)", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1955,
      preset: "1953-default",
    });
    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await ensureFoundingMembershipsAndLeadership(db as unknown as Db);

    const nato = insertedMemberships().filter((r) => r.organizationId === "NATO");
    expect(nato.map((r) => r.countryId).sort()).toEqual([
      "BE",
      "CA",
      "DK",
      "FR",
      "GR",
      "IS",
      "IT",
      "LU",
      "NL",
      "NO",
      "PT",
      "TR",
      "UK",
      "US",
    ]);
  });

  it("heals the Warsaw Pact bloc in a 1953 game but never touches it in a 1991 game", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1993, // even past dissolution — startingYear governs the heal
      preset: "1953-default",
    });
    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await ensureFoundingMembershipsAndLeadership(db as unknown as Db);
    const wp = insertedMemberships().filter((r) => r.organizationId === "WARSAW_PACT");
    expect(wp.map((r) => r.countryId).sort()).toEqual([
      "AL",
      "BG",
      "CS",
      "DD",
      "HU",
      "PL",
      "RO",
      "RU",
    ]);

    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("organizationMemberships").findOne.mockResolvedValue(null);
    db.collection("organizationLeadership").findOne.mockResolvedValue(null);
    db.collection("organizationWithdrawals").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1992,
      preset: "1991-default",
    });
    await ensureFoundingMembershipsAndLeadership(db as unknown as Db);
    expect(insertedMemberships().some((r) => r.organizationId === "WARSAW_PACT")).toBe(false);
  });

  it("never touches an org founded after the preset start (EU in a 1979 game), even past its founding year", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1994, // past 1993 — founding is the turn phase's job, and it founds EMPTY
      preset: "1979-default",
    });
    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await ensureFoundingMembershipsAndLeadership(db as unknown as Db);

    expect(insertedMemberships().some((r) => r.organizationId === "EU")).toBe(false);
    const leadershipInserts = db.collectionMocks.organizationLeadership!.insertOne.mock.calls.map(
      (c) => c[0] as { organizationId: string }
    );
    expect(leadershipInserts.some((r) => r.organizationId === "EU")).toBe(false);
  });
});

describe("ensureFoundingMembershipsAndLeadership — stays batched", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    stubEmptyFind(db, "organizationMemberships");
    stubEmptyFind(db, "organizationLeadership");
    stubEmptyFind(db, "organizationWithdrawals");
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1953,
      preset: "1953-default",
    });
  });

  it("discovers existing rows in one read, not one per member", async () => {
    // This sweep runs on EVERY read of the world-org view. Per-member `findOne`
    // cost ~1s of round-trips per page load once the UN's 1953 roster reached 60
    // seats — about a hundred sequential queries to discover, almost always,
    // that there was nothing to do.
    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await ensureFoundingMembershipsAndLeadership(db as unknown as Db);

    expect(db.collectionMocks.organizationMemberships!.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.organizationLeadership!.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.organizationMemberships!.find).toHaveBeenCalledTimes(1);
  });

  it("writes everything it is short of in one insert per collection", async () => {
    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await ensureFoundingMembershipsAndLeadership(db as unknown as Db);

    expect(db.collectionMocks.organizationMemberships!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.organizationMemberships!.insertMany).toHaveBeenCalledTimes(1);
    // The UN alone seats 60 in 1953, so a real sweep is worth batching.
    const rows = insertedFrom(db, "organizationMemberships");
    expect(rows.filter((r) => r.organizationId === "UN")).toHaveLength(60);
  });

  it("writes nothing when the world is already whole", async () => {
    // The ordinary case, and the one that used to cost a second: everything
    // exists, so the sweep must be two reads and no writes at all.
    const { INTERNATIONAL_ORGANIZATIONS, INTERNATIONAL_ORGANIZATION_ORDER } =
      await import("@/lib/constants/internationalOrganizations");
    const { resolveSeedRoster } = await import("./founding");
    const all = INTERNATIONAL_ORGANIZATION_ORDER.flatMap((id) =>
      resolveSeedRoster(INTERNATIONAL_ORGANIZATIONS[id], "1953-default").map((countryId) => ({
        organizationId: id,
        countryId,
      }))
    );
    db.collection("organizationMemberships").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(all),
    });
    db.collection("organizationLeadership").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue(INTERNATIONAL_ORGANIZATION_ORDER.map((id) => ({ organizationId: id }))),
    });

    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await ensureFoundingMembershipsAndLeadership(db as unknown as Db);

    expect(db.collectionMocks.organizationMemberships!.insertMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.organizationLeadership!.insertMany).not.toHaveBeenCalled();
  });
});

describe("ensureFoundingMembershipsAndLeadership — survives a concurrent sweep", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    stubEmptyFind(db, "organizationMemberships");
    stubEmptyFind(db, "organizationLeadership");
    stubEmptyFind(db, "organizationWithdrawals");
    db.collection("gameState").findOne.mockResolvedValue({
      currentYear: 1953,
      preset: "1953-default",
    });
  });

  it("treats a duplicate-key collision as success", async () => {
    // The sweep runs on EVERY read of the world-org view, and
    // (organizationId, countryId) is uniquely indexed. Two concurrent page loads
    // can both find a member missing and both write it — routine right after a
    // roster grows, when every visitor is short the same rows. The loser's
    // E11000 means the row now exists, which is the state this function exists
    // to reach; rethrowing would 500 the page for being correct.
    db.collection("organizationMemberships").insertMany.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await expect(
      ensureFoundingMembershipsAndLeadership(db as unknown as Db)
    ).resolves.toBeUndefined();
  });

  it("still surfaces a real write failure", async () => {
    // Swallowing everything would hide a genuinely broken write.
    db.collection("organizationMemberships").insertMany.mockRejectedValue(
      Object.assign(new Error("not primary"), { code: 10107 })
    );
    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await expect(ensureFoundingMembershipsAndLeadership(db as unknown as Db)).rejects.toThrow(
      "not primary"
    );
  });

  it("writes unordered, so one collision cannot abort the rows behind it", async () => {
    const { ensureFoundingMembershipsAndLeadership } = await import("./service");
    await ensureFoundingMembershipsAndLeadership(db as unknown as Db);
    const [, options] = db.collectionMocks.organizationMemberships!.insertMany.mock.calls[0]!;
    expect(options).toMatchObject({ ordered: false });
  });
});

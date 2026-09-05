import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/news", () => ({ createSystemNewsPost: vi.fn().mockResolvedValue(undefined) }));

import { createSystemNewsPost } from "@/lib/news";
import {
  pendingTerritories,
  runStatehoodAdmission,
  seedAdmittedStatePolitics,
  shouldEvaluateStatehood,
} from "./statehood";
import { TERRITORY_ADMISSIONS } from "@/lib/elections/statehoodAdmission";

const AK = TERRITORY_ADMISSIONS.find((t) => t.stateId === "AK")!;

function withWorld(
  db: MockDb,
  gameState: Record<string, unknown> | null,
  territoryDocs: unknown[] = []
) {
  db.collection("gameState");
  db.collection("states");
  db.collectionMocks.gameState!.findOne.mockResolvedValue(gameState);
  db.collectionMocks.states!.find.mockReturnValue({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(territoryDocs),
  } as never);
}

describe("shouldEvaluateStatehood", () => {
  it("runs once per year and not again", () => {
    expect(shouldEvaluateStatehood(1959, undefined)).toBe(true);
    expect(shouldEvaluateStatehood(1959, 1958)).toBe(true);
    expect(shouldEvaluateStatehood(1959, 1959)).toBe(false);
    expect(shouldEvaluateStatehood(1959, 1960)).toBe(false);
  });

  it("rejects a non-finite year", () => {
    expect(shouldEvaluateStatehood(NaN, undefined)).toBe(false);
  });
});

describe("pendingTerritories", () => {
  it("offers AK and HI in a 1953 world", () => {
    expect(pendingTerritories("1953-default", new Set()).map((t) => t.stateId)).toEqual([
      "AK",
      "HI",
    ]);
  });

  it("offers nothing once the preset's map already carries them", () => {
    expect(pendingTerritories("2019-default", new Set())).toEqual([]);
    expect(pendingTerritories("1991-default", new Set())).toEqual([]);
    expect(pendingTerritories(undefined, new Set())).toEqual([]);
  });

  it("excludes territories already admitted in this game", () => {
    expect(pendingTerritories("1953-default", new Set(["AK"])).map((t) => t.stateId)).toEqual([
      "HI",
    ]);
  });
});

describe("runStatehoodAdmission", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: async () => [
        { countryId: "US", abbreviation: "DEM", sequentialId: 1 },
        { countryId: "US", abbreviation: "REP", sequentialId: 2 },
      ],
    } as never);
  });

  it("does nothing when the year has already been evaluated", async () => {
    withWorld(db, { currentYear: 1959, lastStatehoodYear: 1959, preset: "1953-default" });

    const result = await runStatehoodAdmission(db as unknown as Db, 400);

    expect(result.ran).toBe(false);
    expect(db.collectionMocks.states!.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks.gameState!.updateOne).not.toHaveBeenCalled();
  });

  it("does nothing when there is no game state", async () => {
    withWorld(db, null);
    expect((await runStatehoodAdmission(db as unknown as Db, 1)).ran).toBe(false);
  });

  it("stamps the year but admits nothing in a modern world", async () => {
    withWorld(db, { currentYear: 2024, preset: "2019-default" });

    const result = await runStatehoodAdmission(db as unknown as Db, 900);

    expect(result).toMatchObject({ ran: true, year: 2024, admitted: [] });
    expect(db.collectionMocks.states!.bulkWrite).not.toHaveBeenCalled();
    expect(createSystemNewsPost).not.toHaveBeenCalled();
    // Stamped, so the candidate query is skipped for the rest of the year.
    const $set = db.collectionMocks.gameState!.updateOne.mock.calls[0]![1] as {
      $set: Record<string, unknown>;
    };
    expect($set.$set.lastStatehoodYear).toBe(2024);
  });

  it("admits pending territories at the end of the window and writes them into existence", async () => {
    withWorld(db, {
      currentYear: AK.windowEndYear,
      preset: "1953-default",
      iteration: { type: "Beta", number: 2 },
    });

    const result = await runStatehoodAdmission(db as unknown as Db, 1200);

    expect(result.admitted?.map((a) => a.stateId).sort()).toEqual(["AK", "HI"]);

    const ops = db.collectionMocks.states!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
    }>;
    expect(ops).toHaveLength(2);
    for (const op of ops) {
      // admittedYear is what loadApportionment reads; houseDistricts is the
      // constitutional one-seat floor the next census reapportions from.
      expect(op.updateOne.update.$set).toEqual({
        admittedYear: AK.windowEndYear,
        houseDistricts: 1,
      });
    }
    expect(createSystemNewsPost).toHaveBeenCalledTimes(1);
  });

  it("never re-admits a territory that already has an admittedYear", async () => {
    withWorld(db, { currentYear: AK.windowEndYear, preset: "1953-default" }, [
      { _id: "AK", admittedYear: 1957 },
    ]);

    const result = await runStatehoodAdmission(db as unknown as Db, 1200);

    expect(result.admitted?.map((a) => a.stateId)).toEqual(["HI"]);
  });

  it("admits nothing before the window opens", async () => {
    withWorld(db, { currentYear: AK.windowStartYear - 1, preset: "1953-default" });

    const result = await runStatehoodAdmission(db as unknown as Db, 10);

    expect(result.admitted).toEqual([]);
    expect(db.collectionMocks.states!.bulkWrite).not.toHaveBeenCalled();
    expect(createSystemNewsPost).not.toHaveBeenCalled();
  });

  it("still stamps the year when the roll admits nobody, so the turn is idempotent", async () => {
    withWorld(db, { currentYear: AK.windowStartYear, preset: "1953-default" });

    await runStatehoodAdmission(db as unknown as Db, 20);

    const $set = db.collectionMocks.gameState!.updateOne.mock.calls[0]![1] as {
      $set: Record<string, unknown>;
    };
    expect($set.$set.lastStatehoodYear).toBe(AK.windowStartYear);
  });
});

describe("seedAdmittedStatePolitics", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: async () => [
        { countryId: "US", abbreviation: "DEM", sequentialId: 1 },
        { countryId: "US", abbreviation: "REP", sequentialId: 2 },
      ],
    } as never);
  });

  const decision = { stateId: "AK", name: "Alaska", year: 1959, hazard: 0.2 };

  it("creates the full seat set a bootstrap would have given the state", async () => {
    await seedAdmittedStatePolitics(db as unknown as Db, [decision], new Date("2026-01-01"));

    const ops = db.collectionMocks.seats!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; upsert: boolean };
    }>;
    const ids = ops.map((o) => o.updateOne.filter._id);
    // House + both Senate classes + Governor + State Senate.
    expect(ids).toHaveLength(5);
    expect(ids.some((id) => id.includes("house"))).toBe(true);
    expect(ids.filter((id) => id.includes("senate") && !id.includes("stateSenate"))).toHaveLength(
      2
    );
    expect(ids.some((id) => id.includes("governor"))).toBe(true);
    expect(ids.some((id) => id.includes("stateSenate"))).toBe(true);
    // Deterministic ids + upsert is what makes a re-run safe.
    expect(ops.every((o) => o.updateOne.upsert)).toBe(true);
  });

  it("creates vacant senate and house offices", async () => {
    await seedAdmittedStatePolitics(db as unknown as Db, [decision], new Date("2026-01-01"));

    const inserted = db.collectionMocks.electedOfficials!.insertMany.mock.calls[0]![0] as Array<
      Record<string, unknown>
    >;
    expect(inserted.filter((o) => o.officeType === "senate")).toHaveLength(2);
    expect(inserted.filter((o) => o.officeType === "house")).toHaveLength(1);
    // Vacant — a new state elects its delegation, it is not handed one.
    expect(inserted.every((o) => o.characterId === null)).toBe(true);
    expect(inserted.every((o) => o.state === "AK")).toBe(true);
  });

  it("creates registration and organization rows only when the territory becomes a state", async () => {
    await seedAdmittedStatePolitics(
      db as unknown as Db,
      [decision],
      new Date("2026-01-01"),
      "1953-default"
    );

    const orgOps = db.collectionMocks.statePartyOrg!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; upsert: boolean };
    }>;
    expect(orgOps.map((op) => op.updateOne.filter._id).sort()).toEqual(["AK_1", "AK_2"]);
    expect(orgOps.every((op) => op.updateOne.upsert)).toBe(true);

    const orgWrites = db.collectionMocks.statePartyOrg!.updateOne.mock.calls;
    expect(orgWrites.some((call) => (call[0] as { _id: string })._id === "AK_1")).toBe(true);
    expect(orgWrites.some((call) => (call[0] as { _id: string })._id === "AK_2")).toBe(true);
    expect(db.collectionMocks.stateRegistrationPool!.updateOne).toHaveBeenCalledWith(
      { _id: "US_AK" },
      expect.objectContaining({
        $set: expect.objectContaining({
          countryId: "US",
          stateId: "AK",
          independent: 24,
          unregistered: 14,
        }),
      }),
      { upsert: true }
    );
  });

  it("does not duplicate officials when the state already has some", async () => {
    db.collection("electedOfficials");
    db.collectionMocks.electedOfficials!.countDocuments.mockResolvedValue(2);

    await seedAdmittedStatePolitics(db as unknown as Db, [decision], new Date("2026-01-01"));

    expect(db.collectionMocks.electedOfficials!.insertMany).not.toHaveBeenCalled();
    // Seats still upsert — they are keyed and idempotent.
    expect(db.collectionMocks.seats!.bulkWrite).toHaveBeenCalled();
    // Orgs still upsert even when officials already exist.
    expect(db.collectionMocks.statePartyOrg!.bulkWrite).toHaveBeenCalled();
  });

  it("creates no elections — the perpetual spawner owns that schedule", async () => {
    await seedAdmittedStatePolitics(db as unknown as Db, [decision], new Date("2026-01-01"));

    expect(db.collectionMocks.elections).toBeUndefined();
  });
});

// Live worlds drift away from the seed's party roster: on the production world
// the seeded "REP" was replaced and the Republican Party now carries the
// abbreviation "GOP". Admission used to throw on that unresolved abbreviation,
// aborting mid-way — after the org rows and DEM's shares were written but
// BEFORE the stateRegistrationPool upsert. AK (admitted in-game 1955) and HI
// (1965) both carry that exact signature live: DEM seeded, Republicans not,
// pool row absent, so drift and the registration drive are frozen there.
describe("seedAdmittedStatePolitics — party roster drifted from the seed", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collectionMocks.politicalParties!.find.mockReturnValue({
      toArray: async () => [
        { countryId: "US", abbreviation: "DEM", name: "Democratic Party", sequentialId: 1 },
        // Same party, renamed: the seed still says "REP".
        { countryId: "US", abbreviation: "GOP", name: "Republican Party", sequentialId: 6 },
      ],
    } as never);
  });

  const decision = { stateId: "AK", name: "Alaska", year: 1959, hazard: 0.2 };

  it("still creates the registration pool row when a seed party cannot be matched by abbreviation", async () => {
    await seedAdmittedStatePolitics(
      db as unknown as Db,
      [decision],
      new Date("2026-01-01"),
      "1953-default"
    );

    expect(db.collectionMocks.stateRegistrationPool!.updateOne).toHaveBeenCalledWith(
      { _id: "US_AK" },
      expect.objectContaining({
        $set: expect.objectContaining({ independent: 24, unregistered: 14 }),
      }),
      { upsert: true }
    );
  });

  it("falls back to the canonical seed name so the renamed party still gets its shares", async () => {
    await seedAdmittedStatePolitics(
      db as unknown as Db,
      [decision],
      new Date("2026-01-01"),
      "1953-default"
    );

    // AK's 1953 override gives REP org 22 / reg 30 — those must land on the
    // renamed GOP row (sequentialId 6), not be silently dropped.
    const orgWrites = db.collectionMocks.statePartyOrg!.updateOne.mock.calls;
    const gopWrite = orgWrites.find((call) => (call[0] as { _id: string })._id === "AK_6");
    expect(gopWrite).toBeDefined();
    expect(gopWrite![1]).toEqual(
      expect.objectContaining({
        $set: expect.objectContaining({ organization: 22, registration: 30 }),
      })
    );
  });
});

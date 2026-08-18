import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { CorporateSector, Union } from "@/lib/db/types";
import { adoptUnrepresentedSectors, processUnionsTurn } from "./index";
import { UNION_STRENGTH_DECAY_PER_TURN } from "@/lib/unions/unionEconomy";
import {
  approvalTarget,
  averageAnnualWage,
  duesIncomePerTurn,
  maxDuesForWage,
  servicesCostPerTurn,
  trendApproval,
  unionMembers,
} from "@/lib/unions/unionDues";
import { INACTIVE_CEO_TURN_THRESHOLD } from "@/lib/turn/corporation/inactiveCeoSectorShed";
import { seedUnions } from "@/lib/admin/seed/seedUnions";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";

let labourFullModeEnabled = true;
vi.mock("@/lib/labour/featureFlag", () => ({
  isLabourFullMode: vi.fn().mockImplementation(async () => labourFullModeEnabled),
}));

// Safety-net seeding (zero union docs at full mode) is asserted via this mock,
// the real seedUnions hits states/unions collections this mock db doesn't model.
vi.mock("@/lib/admin/seed/seedUnions", () => ({
  seedUnions: vi.fn().mockResolvedValue(0),
}));
vi.mock("./labourRelationsTurn", () => ({
  processLabourRelationsTurn: vi
    .fn()
    .mockResolvedValue({ campaignsMovedToDispute: 0, agreementsExpired: 0, mediationsExpired: 0 }),
}));

function makeUnion(overrides: Partial<Union> = {}): Union {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    name: "United Steelworkers",
    ownerId: new ObjectId(),
    treasury: 1000,
    duesPerWorkerAnnual: 0,
    activeServices: [],
    approval: 50,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Union;
}

function makeSector(unionId: ObjectId, overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    representingUnionId: unionId,
    workers: 100,
    unionization: 50, // 50 members
    wagePerWorker: 10,
    ...overrides,
  } as CorporateSector;
}

/**
 * Mock db: unions.find/bulkWrite/updateMany, characters.find/updateMany
 * (owner lookups), users.find (activity signal), corporateSectors.find
 * (represented-sector lookup for dues/services/approval). No characters/users
 * are "inactive" by default (their lastActivity is "now").
 */
function mockDb({
  unions,
  sectors = [],
  activeCharacterIds = [],
  totalUnionCount,
  seededCountryIds = ["US"],
}: {
  unions: Union[];
  sectors?: CorporateSector[];
  /** Character _ids (as strings) considered ACTIVE (lastActivity = now). Any owner not listed here has no user doc at all (skipped, not vacated) unless overridden via `inactiveCharacterIds`. */
  activeCharacterIds?: string[];
  /** countDocuments result for the safety-net check. Defaults to a COMPLETE roster (`seededCountryIds.length * CORPORATION_TYPES.length`) so the incomplete-roster backfill does not fire unless a test asks for it. */
  totalUnionCount?: number;
  /** Non-NATIONAL country ids `states.distinct` returns; drives the expected full-roster size (`× CORPORATION_TYPES.length`). */
  seededCountryIds?: string[];
}) {
  const now = new Date();
  const expectedFullRoster = seededCountryIds.length * CORPORATION_TYPES.length;
  const characterUserId = new Map(unions.map((u) => [u.ownerId!.toString(), new ObjectId()]));
  const unionsBulkWrite = vi.fn().mockResolvedValue({});
  const unionsUpdateMany = vi.fn().mockResolvedValue({});
  const unionsFind = vi.fn().mockReturnValue({ toArray: () => Promise.resolve(unions) });
  const unionsDistinct = vi
    .fn()
    .mockImplementation(async () => unions.filter((u) => u.suspended).map((u) => u._id));
  const organizersUpdateMany = vi.fn().mockResolvedValue({});
  const charactersUpdateMany = vi.fn().mockResolvedValue({});
  const sectorsFind = vi.fn().mockReturnValue({ toArray: () => Promise.resolve(sectors) });
  const db = {
    collection: (name: string) => {
      if (name === "unions") {
        return {
          find: unionsFind,
          countDocuments: vi.fn().mockResolvedValue(totalUnionCount ?? expectedFullRoster),
          bulkWrite: unionsBulkWrite,
          updateMany: unionsUpdateMany,
          distinct: unionsDistinct,
        };
      }
      if (name === "unionOrganizers") {
        return { updateMany: organizersUpdateMany };
      }
      if (name === "corporateSectors") {
        return { find: sectorsFind };
      }
      if (name === "states") {
        return { distinct: vi.fn().mockResolvedValue(seededCountryIds) };
      }
      if (name === "gameState") {
        return { findOne: vi.fn().mockResolvedValue({ preset: "2019-default" }) };
      }
      if (name === "characters") {
        return {
          find: () => ({
            toArray: () =>
              Promise.resolve(
                unions.map((u) => ({
                  _id: u.ownerId,
                  userId: characterUserId.get(u.ownerId!.toString()),
                }))
              ),
          }),
          updateMany: charactersUpdateMany,
        };
      }
      if (name === "users") {
        return {
          find: () => ({
            project: () => ({
              toArray: () =>
                Promise.resolve(
                  Array.from(characterUserId.entries()).map(([charId, userId]) => ({
                    _id: userId,
                    lastActivity: activeCharacterIds.includes(charId)
                      ? now
                      : new Date(now.getTime() - (INACTIVE_CEO_TURN_THRESHOLD + 1) * MS_PER_TURN),
                  }))
                ),
            }),
          }),
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  return {
    db,
    unionsBulkWrite,
    unionsUpdateMany,
    unionsFind,
    sectorsFind,
    charactersUpdateMany,
    unionsDistinct,
    organizersUpdateMany,
  };
}

describe("processUnionsTurn", () => {
  it("does nothing when there are no owned unions", async () => {
    labourFullModeEnabled = true;
    const { db, unionsBulkWrite } = mockDb({ unions: [] });
    const result = await processUnionsTurn(db);
    expect(result.unionsProcessed).toBe(0);
    expect(unionsBulkWrite).not.toHaveBeenCalled();
  });

  it("is a no-op (skips entirely) when labourSystemMode < 'full'", async () => {
    labourFullModeEnabled = false;
    const union = makeUnion();
    const { db, unionsBulkWrite } = mockDb({
      unions: [union],
      activeCharacterIds: [union.ownerId!.toString()],
    });

    const result = await processUnionsTurn(db);
    expect(result.unionsProcessed).toBe(0);
    expect(unionsBulkWrite).not.toHaveBeenCalled();
    labourFullModeEnabled = true; // reset for subsequent tests
  });

  it("credits dues income scaled by real represented-sector members, with no services running", async () => {
    // Rate within the wage ceiling (maxDuesForWage of a 10/day wage), so the
    // engine's re-clamp leaves it untouched.
    const sectorTemplate = { workers: 100, unionization: 50, wagePerWorker: 10 };
    const withinCeiling = maxDuesForWage(averageAnnualWage([sectorTemplate])) / 2;
    const union = makeUnion({
      treasury: 1000,
      duesPerWorkerAnnual: withinCeiling,
      activeServices: [],
    });
    const sector = makeSector(union._id, sectorTemplate);
    const { db, unionsBulkWrite } = mockDb({
      unions: [union],
      sectors: [sector],
      activeCharacterIds: [union.ownerId!.toString()],
    });

    const result = await processUnionsTurn(db);
    expect(result.unionsProcessed).toBe(1);
    expect(unionsBulkWrite).toHaveBeenCalledTimes(1);

    const ops = unionsBulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    const { filter, update } = ops[0].updateOne;
    expect(filter._id).toStrictEqual(union._id);

    const members = unionMembers([sector]);
    expect(members).toBe(50);
    const expectedDues = duesIncomePerTurn(members, withinCeiling);
    expect(update.$inc.treasury).toBeCloseTo(expectedDues, 6);
  });

  it("re-clamps a stored rate above today's wage ceiling before charging", async () => {
    // A rate legal when set can exceed 10% of wages after wages fall or a
    // high-wage shop is lost; the engine must charge the ceiling, not the rate.
    const sectorTemplate = { workers: 100, unionization: 50, wagePerWorker: 10 };
    const ceiling = maxDuesForWage(averageAnnualWage([sectorTemplate]));
    const union = makeUnion({
      treasury: 1000,
      duesPerWorkerAnnual: ceiling * 100,
      activeServices: [],
    });
    const sector = makeSector(union._id, sectorTemplate);
    const { db, unionsBulkWrite } = mockDb({
      unions: [union],
      sectors: [sector],
      activeCharacterIds: [union.ownerId!.toString()],
    });

    await processUnionsTurn(db);
    const ops = unionsBulkWrite.mock.calls[0][0];
    const { update } = ops[0].updateOne;
    expect(update.$inc.treasury).toBeCloseTo(duesIncomePerTurn(unionMembers([sector]), ceiling), 6);
  });

  it("dues income scales with member count: doubling represented workers doubles it", async () => {
    const smallUnion = makeUnion({ duesPerWorkerAnnual: 100 });
    const smallSector = makeSector(smallUnion._id, { workers: 100, unionization: 50 }); // 50 members
    const bigUnion = makeUnion({ duesPerWorkerAnnual: 100 });
    const bigSector = makeSector(bigUnion._id, { workers: 200, unionization: 50 }); // 100 members

    const { db: smallDb, unionsBulkWrite: smallBulk } = mockDb({
      unions: [smallUnion],
      sectors: [smallSector],
      activeCharacterIds: [smallUnion.ownerId!.toString()],
    });
    await processUnionsTurn(smallDb);
    const smallDues = smallBulk.mock.calls[0][0][0].updateOne.update.$inc.treasury;

    const { db: bigDb, unionsBulkWrite: bigBulk } = mockDb({
      unions: [bigUnion],
      sectors: [bigSector],
      activeCharacterIds: [bigUnion.ownerId!.toString()],
    });
    await processUnionsTurn(bigDb);
    const bigDues = bigBulk.mock.calls[0][0][0].updateOne.update.$inc.treasury;

    expect(bigDues).toBeCloseTo(smallDues * 2, 6);
  });

  it("lapses services (no charge, no approval bonus) when the treasury can't cover the bill", async () => {
    // A tiny treasury and zero dues means the full service slate is
    // unaffordable, services must lapse rather than drive treasury negative.
    const union = makeUnion({
      treasury: 1,
      duesPerWorkerAnnual: 0,
      activeServices: ["healthFund"],
      approval: 50,
    });
    const sector = makeSector(union._id, { workers: 10_000, unionization: 100, wagePerWorker: 50 });
    const { db, unionsBulkWrite } = mockDb({
      unions: [union],
      sectors: [sector],
      activeCharacterIds: [union.ownerId!.toString()],
    });

    await processUnionsTurn(db);
    const ops = unionsBulkWrite.mock.calls[0][0];
    const { update } = ops[0].updateOne;

    // No dues income and an unaffordable service bill ⇒ treasury is untouched
    // (not driven negative), and approval trends toward the LAPSED target
    // (no bonus from a service slate that didn't actually run this turn).
    expect(update.$inc.treasury).toBe(0);
    const members = unionMembers([sector]);
    const annualWage = averageAnnualWage([sector]);
    const lapsedTarget = approvalTarget({
      duesPerWorkerAnnual: 0,
      annualWage,
      activeServices: ["healthFund"],
      servicesLapsed: true,
    });
    const fundedTarget = approvalTarget({
      duesPerWorkerAnnual: 0,
      annualWage,
      activeServices: ["healthFund"],
      servicesLapsed: false,
    });
    expect(fundedTarget).toBeGreaterThan(lapsedTarget); // sanity: the bonus is real
    expect(update.$set.approval).toBeCloseTo(trendApproval(50, lapsedTarget), 6);
    // Confirms the bill really was unaffordable in this fixture.
    const fullCost = servicesCostPerTurn(members, annualWage, ["healthFund"]);
    expect(fullCost).toBeGreaterThan(union.treasury);
  });

  it("trends approval toward its target and stops exactly there once reached", async () => {
    const annualWage = averageAnnualWage([makeSector(new ObjectId(), { wagePerWorker: 10 })]);
    const target = approvalTarget({
      duesPerWorkerAnnual: 0,
      annualWage,
      activeServices: [],
      servicesLapsed: false,
    });

    // Not yet at target: approval should move toward it.
    const union = makeUnion({ treasury: 1_000_000, duesPerWorkerAnnual: 0, approval: target - 10 });
    const sector = makeSector(union._id, { workers: 100, unionization: 50, wagePerWorker: 10 });
    const { db, unionsBulkWrite } = mockDb({
      unions: [union],
      sectors: [sector],
      activeCharacterIds: [union.ownerId!.toString()],
    });
    await processUnionsTurn(db);
    const moved = unionsBulkWrite.mock.calls[0][0][0].updateOne.update.$set.approval;
    expect(moved).toBeCloseTo(trendApproval(target - 10, target), 6);
    expect(moved).toBeGreaterThan(target - 10);

    // Already at target: approval must not overshoot or drift once there.
    const settledUnion = makeUnion({
      treasury: 1_000_000,
      duesPerWorkerAnnual: 0,
      approval: target,
    });
    const settledSector = makeSector(settledUnion._id, {
      workers: 100,
      unionization: 50,
      wagePerWorker: 10,
    });
    const { db: settledDb, unionsBulkWrite: settledBulk } = mockDb({
      unions: [settledUnion],
      sectors: [settledSector],
      activeCharacterIds: [settledUnion.ownerId!.toString()],
    });
    await processUnionsTurn(settledDb);
    const settled = settledBulk.mock.calls[0][0][0].updateOne.update.$set.approval;
    expect(settled).toBeCloseTo(target, 6);
  });

  it("processes multiple active-leader unions independently", async () => {
    const a = makeUnion();
    const b = makeUnion();
    const { db, unionsBulkWrite } = mockDb({
      unions: [a, b],
      activeCharacterIds: [a.ownerId!.toString(), b.ownerId!.toString()],
    });

    const result = await processUnionsTurn(db);
    expect(result.unionsProcessed).toBe(2);
    const ops = unionsBulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(2);
  });

  it("decays union strength and every organizer's banked strength, led or not, skipping suspended unions", async () => {
    const led = makeUnion();
    const suspended = { ...makeUnion(), suspended: true };
    const { db, unionsUpdateMany, organizersUpdateMany } = mockDb({
      unions: [led, suspended],
      activeCharacterIds: [led.ownerId!.toString(), suspended.ownerId!.toString()],
    });

    await processUnionsTurn(db);

    const multiplier = 1 - UNION_STRENGTH_DECAY_PER_TURN;
    const [unionFilter, unionUpdate] = unionsUpdateMany.mock.calls[0];
    expect(unionUpdate.$mul.strength).toBeCloseTo(multiplier, 10);
    expect(unionFilter._id.$nin).toContainEqual(suspended._id);
    expect(unionFilter.strength).toEqual({ $gt: 0 });

    expect(organizersUpdateMany).toHaveBeenCalledTimes(1);
    const [organizerFilter, organizerUpdate] = organizersUpdateMany.mock.calls[0];
    expect(organizerUpdate.$mul.strength).toBeCloseTo(multiplier, 10);
    expect(organizerFilter.unionId.$nin).toContainEqual(suspended._id);
  });

  it("code-review fix #5: auto-vacates leadership for a leader inactive beyond INACTIVE_CEO_TURN_THRESHOLD, excludes it from dues/approval", async () => {
    const union = makeUnion();
    const { db, unionsBulkWrite, unionsUpdateMany, charactersUpdateMany } = mockDb({
      unions: [union],
      activeCharacterIds: [], // inactive
    });

    const result = await processUnionsTurn(db);
    expect(result.vacatedForInactivity).toBe(1);
    expect(result.unionsProcessed).toBe(0);
    expect(unionsBulkWrite).not.toHaveBeenCalled(); // no dues/approval write for the vacated union

    // Call 0 is the blanket strength decay, which runs for every union.
    const vacancyCall = unionsUpdateMany.mock.calls.find(
      (call) => "ownerId" in (call[1].$set ?? {})
    );
    expect(vacancyCall).toBeDefined();
    const [unionFilter, unionUpdate] = vacancyCall!;
    expect(unionFilter._id.$in).toContainEqual(union._id);
    expect(unionUpdate.$set.ownerId).toBeNull();

    expect(charactersUpdateMany).toHaveBeenCalledTimes(1);
    const [charFilter, charUpdate] = charactersUpdateMany.mock.calls[0];
    expect(charFilter._id.$in).toContainEqual(union.ownerId);
    expect(charUpdate.$set.unionLeaderOf).toBeNull();
  });
});

describe("processUnionsTurn, safety-net seeding + union-ban suspension", () => {
  it("backfills via seedUnions(reset:false) when full mode is on but ZERO union docs exist", async () => {
    labourFullModeEnabled = true;
    vi.mocked(seedUnions).mockClear();
    const { db } = mockDb({ unions: [], totalUnionCount: 0 });

    await processUnionsTurn(db);

    expect(seedUnions).toHaveBeenCalledTimes(1);
    const [, , preset, reset] = vi.mocked(seedUnions).mock.calls[0];
    expect(preset).toBe("2019-default");
    expect(reset).toBe(false);
  });

  it("backfills when the roster is INCOMPLETE, not just empty (regression: 1953 sandbox stuck at 1 of 391)", async () => {
    // A lone stray union (e.g. an early partial seed) must NOT block the
    // backfill, the old `=== 0` guard let exactly this state persist forever.
    labourFullModeEnabled = true;
    vi.mocked(seedUnions).mockClear();
    const { db } = mockDb({
      unions: [],
      totalUnionCount: 1,
      seededCountryIds: ["US", "UK", "RU"], // expected = 3 × CORPORATION_TYPES.length ≫ 1
    });

    await processUnionsTurn(db);

    expect(seedUnions).toHaveBeenCalledTimes(1);
    const [, , , reset] = vi.mocked(seedUnions).mock.calls[0];
    expect(reset).toBe(false);
  });

  it("does NOT seed when the roster is already complete", async () => {
    labourFullModeEnabled = true;
    vi.mocked(seedUnions).mockClear();
    const union = makeUnion();
    const { db } = mockDb({
      unions: [union],
      activeCharacterIds: [union.ownerId!.toString()],
      seededCountryIds: ["US"],
      totalUnionCount: CORPORATION_TYPES.length, // 1 country × all sectors = full roster
    });

    await processUnionsTurn(db);
    expect(seedUnions).not.toHaveBeenCalled();
  });

  it("does NOT count or seed at all below full mode", async () => {
    labourFullModeEnabled = false;
    vi.mocked(seedUnions).mockClear();
    const { db } = mockDb({ unions: [], totalUnionCount: 0 });

    await processUnionsTurn(db);
    expect(seedUnions).not.toHaveBeenCalled();
    labourFullModeEnabled = true; // reset for subsequent tests
  });

  it("union ban (player suggestion #93): the owned-unions query excludes suspended unions from dues/decay/vacancy", async () => {
    labourFullModeEnabled = true;
    const union = makeUnion();
    const { db, unionsFind } = mockDb({
      unions: [union],
      activeCharacterIds: [union.ownerId!.toString()],
    });

    await processUnionsTurn(db);

    expect(unionsFind).toHaveBeenCalledTimes(1);
    const [filter] = unionsFind.mock.calls[0];
    expect(filter).toMatchObject({ ownerId: { $ne: null }, suspended: { $ne: true } });
  });
});

describe("adoptUnrepresentedSectors", () => {
  /**
   * Mock db for the adoption step alone: corporateSectors.find returns the
   * unrepresented sectors, unions.find returns the candidate adopters.
   */
  function adoptionDb(
    sectors: { _id: ObjectId; countryId: string; sectorType: string }[],
    unions: {
      _id: ObjectId;
      countryId: string;
      sectorType: string;
      ownerId?: ObjectId | null;
      ownerType?: "character" | "npp";
      foundedByCharacterId?: ObjectId | null;
    }[]
  ) {
    const bulkWrite = vi.fn().mockImplementation(async (ops: unknown[]) => ({
      modifiedCount: ops.length,
    }));
    const sectorsFind = vi.fn().mockReturnValue({ toArray: async () => sectors });
    const unionsFind = vi.fn().mockImplementation(
      (filter: {
        foundedByCharacterId?: unknown;
        ownerId?: unknown;
        $or?: Array<{ ownerId?: unknown; ownerType?: unknown }>;
      }) => ({
        toArray: async () =>
          unions.filter((union) => {
            if (filter.foundedByCharacterId === null && union.foundedByCharacterId != null) {
              return false;
            }
            if (filter.ownerId === null && union.ownerId != null) return false;
            if (!filter.$or) return true;
            return filter.$or.some((clause) => {
              if (clause.ownerId === null) return union.ownerId == null;
              if (clause.ownerType === "npp") return union.ownerType === "npp";
              return false;
            });
          }),
      })
    );
    const db = {
      collection: (name: string) => {
        if (name === "corporateSectors") return { find: sectorsFind, bulkWrite };
        if (name === "unions") return { find: unionsFind };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;
    return { db, bulkWrite, sectorsFind, unionsFind };
  }

  it("hands an unrepresented sector to the seeded union for its country and industry", async () => {
    const seeded = { _id: new ObjectId(), countryId: "US", sectorType: "manufacturing" };
    const sectorId = new ObjectId();
    const { db, bulkWrite } = adoptionDb(
      [{ _id: sectorId, countryId: "US", sectorType: "manufacturing" }],
      [seeded]
    );

    const adopted = await adoptUnrepresentedSectors(db);

    expect(adopted).toBe(1);
    const [ops] = bulkWrite.mock.calls[0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update.$set.representingUnionId).toEqual(seeded._id);
    // Compare-and-swap on the same field, so a concurrent organize drive that
    // claimed the sector first is not overwritten.
    expect(ops[0].updateOne.filter).toMatchObject({
      _id: sectorId,
      representingUnionId: null,
    });
  });

  it("only queries sectors nobody represents, so a won shop is never reassigned", async () => {
    const { db, sectorsFind } = adoptionDb([], []);

    await adoptUnrepresentedSectors(db);

    expect(sectorsFind).toHaveBeenCalledWith({ representingUnionId: null }, expect.anything());
  });

  it("never lets a player-founded union adopt: only the seeded one per industry does", async () => {
    const { db, unionsFind } = adoptionDb(
      [{ _id: new ObjectId(), countryId: "US", sectorType: "manufacturing" }],
      []
    );

    await adoptUnrepresentedSectors(db);

    expect(unionsFind).toHaveBeenCalledWith(
      {
        foundedByCharacterId: null,
        $or: [{ ownerId: null }, { ownerType: "npp" }],
      },
      expect.anything()
    );
  });

  it("never lets a player-led seeded union adopt, so claiming the guild does not vacuum every new shop", async () => {
    const claimed = {
      _id: new ObjectId(),
      countryId: "US",
      sectorType: "media",
      ownerId: new ObjectId(),
      ownerType: "character" as const,
    };
    const { db, bulkWrite } = adoptionDb(
      [{ _id: new ObjectId(), countryId: "US", sectorType: "media" }],
      [claimed]
    );

    expect(await adoptUnrepresentedSectors(db)).toBe(0);
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("still lets an NPP-led seeded union adopt, so the world does not leak unrepresented shops", async () => {
    const nppLed = {
      _id: new ObjectId(),
      countryId: "US",
      sectorType: "media",
      ownerId: new ObjectId(),
      ownerType: "npp" as const,
    };
    const sectorId = new ObjectId();
    const { db, bulkWrite } = adoptionDb(
      [{ _id: sectorId, countryId: "US", sectorType: "media" }],
      [nppLed]
    );

    expect(await adoptUnrepresentedSectors(db)).toBe(1);
    const [ops] = bulkWrite.mock.calls[0];
    expect(ops[0].updateOne.update.$set.representingUnionId).toEqual(nppLed._id);
  });

  it("matches on country AND industry, never industry alone", async () => {
    const usUnion = { _id: new ObjectId(), countryId: "US", sectorType: "manufacturing" };
    const { db, bulkWrite } = adoptionDb(
      [
        { _id: new ObjectId(), countryId: "US", sectorType: "manufacturing" },
        // Same industry, different country: must NOT inherit the US union.
        { _id: new ObjectId(), countryId: "UK", sectorType: "manufacturing" },
        // Same country, different industry: no union seeded for it here.
        { _id: new ObjectId(), countryId: "US", sectorType: "agriculture" },
      ],
      [usUnion]
    );

    const adopted = await adoptUnrepresentedSectors(db);

    expect(adopted).toBe(1);
    const [ops] = bulkWrite.mock.calls[0];
    expect(ops).toHaveLength(1);
    expect(ops[0].updateOne.update.$set.representingUnionId).toEqual(usUnion._id);
  });

  it("writes nothing when there is no seeded union for any unrepresented sector", async () => {
    const { db, bulkWrite } = adoptionDb(
      [{ _id: new ObjectId(), countryId: "ZZ", sectorType: "manufacturing" }],
      [{ _id: new ObjectId(), countryId: "US", sectorType: "manufacturing" }]
    );

    expect(await adoptUnrepresentedSectors(db)).toBe(0);
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("writes nothing when every sector is already represented", async () => {
    const { db, bulkWrite } = adoptionDb([], []);

    expect(await adoptUnrepresentedSectors(db)).toBe(0);
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});

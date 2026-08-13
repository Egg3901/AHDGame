import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Union } from "@/lib/db/types";
import { processUnionsTurn } from "./index";
import {
  duesTrickle,
  decayMembershipPressure,
  MEMBERSHIP_PRESSURE_DECAY_PER_TURN,
  UNION_STRENGTH_DECAY_PER_TURN,
} from "@/lib/unions/unionEconomy";
import { INACTIVE_CEO_TURN_THRESHOLD } from "@/lib/turn/corporation/inactiveCeoSectorShed";
import { seedUnions } from "@/lib/admin/seed/seedUnions";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";

let labourFullModeEnabled = true;
vi.mock("@/lib/labour/featureFlag", () => ({
  isLabourFullMode: vi.fn().mockImplementation(async () => labourFullModeEnabled),
}));

// Safety-net seeding (zero union docs at full mode) is asserted via this mock —
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
    membershipPressure: 40,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Union;
}

/**
 * Mock db: unions.find/bulkWrite/updateMany, characters.find/updateMany
 * (owner lookups), users.find (activity signal). No characters/users are
 * "inactive" by default (their lastActivity is "now").
 */
function mockDb({
  unions,
  activeCharacterIds = [],
  totalUnionCount,
  seededCountryIds = ["US"],
}: {
  unions: Union[];
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

  it("accrues dues and decays membershipPressure for an active leader's union", async () => {
    const union = makeUnion({ treasury: 1000, membershipPressure: 40 });
    const { db, unionsBulkWrite } = mockDb({
      unions: [union],
      activeCharacterIds: [union.ownerId!.toString()],
    });

    const result = await processUnionsTurn(db);
    expect(result.unionsProcessed).toBe(1);
    expect(unionsBulkWrite).toHaveBeenCalledTimes(1);

    const ops = unionsBulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(1);
    const { filter, update } = ops[0].updateOne;
    expect(filter._id).toStrictEqual(union._id);
    expect(update.$inc.treasury).toBe(duesTrickle(40));
    expect(update.$set.membershipPressure).toBe(decayMembershipPressure(40));
  });

  it("decay never goes below 0", async () => {
    const union = makeUnion({ membershipPressure: MEMBERSHIP_PRESSURE_DECAY_PER_TURN / 2 });
    const { db, unionsBulkWrite } = mockDb({
      unions: [union],
      activeCharacterIds: [union.ownerId!.toString()],
    });

    await processUnionsTurn(db);
    const ops = unionsBulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.update.$set.membershipPressure).toBe(0);
  });

  it("processes multiple active-leader unions independently", async () => {
    const a = makeUnion({ membershipPressure: 10 });
    const b = makeUnion({ membershipPressure: 90 });
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
    const led = makeUnion({ membershipPressure: 50 });
    const suspended = { ...makeUnion({ membershipPressure: 50 }), suspended: true };
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

  it("code-review fix #5: auto-vacates leadership for a leader inactive beyond INACTIVE_CEO_TURN_THRESHOLD, excludes it from dues/decay", async () => {
    const union = makeUnion({ membershipPressure: 50 });
    const { db, unionsBulkWrite, unionsUpdateMany, charactersUpdateMany } = mockDb({
      unions: [union],
      activeCharacterIds: [], // inactive
    });

    const result = await processUnionsTurn(db);
    expect(result.vacatedForInactivity).toBe(1);
    expect(result.unionsProcessed).toBe(0);
    expect(unionsBulkWrite).not.toHaveBeenCalled(); // no dues/decay for the vacated union

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

describe("processUnionsTurn — safety-net seeding + union-ban suspension", () => {
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
    // backfill — the old `=== 0` guard let exactly this state persist forever.
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

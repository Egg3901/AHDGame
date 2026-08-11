import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { resignUnionLeadership } from "./resignUnionLeadership";

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_withSession: unknown, withoutSession: () => Promise<void>) => {
      return withoutSession();
    }),
}));

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return { _id: new ObjectId(), name: "TestChar", ...overrides } as unknown as Character;
}

function makeUnion(ownerId: ObjectId | null, overrides: Partial<Union> = {}): Union {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    name: "United Steelworkers",
    ownerId,
    treasury: 5000,
    membershipPressure: 40,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    ...overrides,
  } as unknown as Union;
}

describe("resignUnionLeadership", () => {
  it("rejects a character who does not lead this union", async () => {
    const character = makeCharacter();
    const union = makeUnion(new ObjectId());
    const db = {
      collection: () => ({ findOne: vi.fn().mockResolvedValue(union) }),
    } as unknown as Db;

    const result = await resignUnionLeadership(db, character, union._id.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("rejects an unowned union", async () => {
    const character = makeCharacter();
    const union = makeUnion(null);
    const db = {
      collection: () => ({ findOne: vi.fn().mockResolvedValue(union) }),
    } as unknown as Db;

    const result = await resignUnionLeadership(db, character, union._id.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("clears ownerId and unionLeaderOf, leaves treasury/membershipPressure untouched", async () => {
    const character = makeCharacter({ unionLeaderOf: new ObjectId() });
    const union = makeUnion(character._id, { treasury: 5000, membershipPressure: 40 });
    const unionUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const charUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const votesDelete = vi.fn().mockResolvedValue({ deletedCount: 0 });
    const db = {
      collection: (name: string) => {
        if (name === "unions")
          return {
            findOne: vi.fn().mockResolvedValue(union),
            updateOne: unionUpdateOne,
          };
        if (name === "characters") return { updateOne: charUpdateOne };
        // Union-ban gate (player suggestion #93): no ban in this scenario.
        if (name === "federalBudget")
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
        if (name === "unionLeaderVotes") return { deleteMany: votesDelete };
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;

    const result = await resignUnionLeadership(db, character, union._id.toString());
    expect(result.ok).toBe(true);

    const [unionFilter, unionUpdate] = unionUpdateOne.mock.calls[0];
    expect(unionFilter).toMatchObject({ _id: union._id });
    expect(unionUpdate.$set.ownerId).toBeNull();
    expect(unionUpdate.$set).not.toHaveProperty("treasury");
    expect(unionUpdate.$set).not.toHaveProperty("membershipPressure");

    const [charFilter, charUpdate] = charUpdateOne.mock.calls[0];
    expect(charFilter).toMatchObject({ _id: character._id });
    expect(charUpdate.$set.unionLeaderOf).toBeNull();
    expect(votesDelete).toHaveBeenCalled();
  });
});

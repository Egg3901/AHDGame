import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { acceptUnionLeadership } from "./acceptUnionLeadership";

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_withSession: unknown, withoutSession: () => Promise<void>) => {
      return withoutSession();
    }),
}));

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    name: "Candidate",
    countryId: "US",
    unionLeaderOf: null,
    ...overrides,
  } as unknown as Character;
}

function makeUnion(overrides: Partial<Union> = {}): Union {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    name: "United Steelworkers",
    ownerId: null,
    pendingLeaderCharacterId: new ObjectId(),
    treasury: 0,
    membershipPressure: 30,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Union;
}

describe("acceptUnionLeadership", () => {
  it("rejects when no offer is pending", async () => {
    const character = makeCharacter();
    const union = makeUnion({ pendingLeaderCharacterId: null });
    const db = {} as Db;
    const result = await acceptUnionLeadership(db, character, union);
    expect(result.ok).toBe(false);
  });

  it("accepts when the character matches the pending offer", async () => {
    const character = makeCharacter();
    const union = makeUnion({ pendingLeaderCharacterId: character._id });
    const unionUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const charUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = {
      collection: (name: string) => {
        if (name === "unions") return { updateOne: unionUpdate };
        if (name === "characters") return { updateOne: charUpdate };
        // Union-ban gate (player suggestion #93): no ban in this scenario.
        if (name === "federalBudget")
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
        throw new Error(name);
      },
    } as unknown as Db;

    const result = await acceptUnionLeadership(db, character, union);
    expect(result.ok).toBe(true);
    expect(unionUpdate).toHaveBeenCalled();
    expect(charUpdate).toHaveBeenCalled();
  });
});

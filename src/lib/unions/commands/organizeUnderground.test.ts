import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { organizeUnderground } from "./organizeUnderground";
import {
  UNDERGROUND_ACTION_COST,
  UNDERGROUND_MASS_STRENGTH_GAIN,
  UNDERGROUND_QUIET_STRENGTH_GAIN,
} from "@/lib/unions/underground";

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    name: "TestChar",
    countryId: "US",
    actions: 100,
    ...overrides,
  } as unknown as Character;
}

function makeUnion(overrides: Partial<Union> = {}): Union {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    name: "Suspended Union",
    ownerId: null,
    treasury: 50_000,
    approval: 70,
    strength: 200,
    suspended: true,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Union;
}

interface Stub {
  db: Db;
  characterUpdate: ReturnType<typeof vi.fn>;
  unionUpdate: ReturnType<typeof vi.fn>;
  organizerUpdate: ReturnType<typeof vi.fn>;
}

function stubDb(opts: {
  union: Union;
  banned?: boolean;
  turn?: number;
  organizer?: Record<string, unknown> | null;
  unionAfter?: Union | null;
}): Stub {
  const characterUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const unionUpdate = vi.fn().mockResolvedValue(opts.unionAfter ?? { ...opts.union });
  const organizerUpdate = vi.fn().mockResolvedValue({});
  const db = {
    collection: (name: string) => {
      if (name === "characters") return { updateOne: characterUpdate };
      if (name === "unions") return { findOneAndUpdate: unionUpdate };
      if (name === "unionOrganizers") {
        return {
          findOne: vi.fn().mockResolvedValue(opts.organizer ?? null),
          findOneAndUpdate: organizerUpdate,
        };
      }
      if (name === "federalBudget") {
        return { findOne: vi.fn().mockResolvedValue({ unionsBanned: opts.banned ?? true }) };
      }
      if (name === "gameState") {
        return { findOne: vi.fn().mockResolvedValue({ currentTurn: opts.turn ?? 42 }) };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  return { db, characterUpdate, unionUpdate, organizerUpdate };
}

describe("organizeUnderground (command)", () => {
  it("refuses when the union is not under a ban", async () => {
    const character = makeCharacter();
    const union = makeUnion({ suspended: false });
    const { db, characterUpdate } = stubDb({ union, banned: false });
    const result = await organizeUnderground(db, character, union, "quiet");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/only possible while unions are banned/i);
    }
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("refuses organizers outside the union's country", async () => {
    const character = makeCharacter({ countryId: "UK" });
    const union = makeUnion();
    const { db, characterUpdate } = stubDb({ union });
    const result = await organizeUnderground(db, character, union, "quiet");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("refuses without spending when the action bar cannot cover 2x cost", async () => {
    const character = makeCharacter({ actions: UNDERGROUND_ACTION_COST - 1 });
    const union = makeUnion();
    const { db, characterUpdate } = stubDb({ union });
    const result = await organizeUnderground(db, character, union, "quiet");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(new RegExp(`${UNDERGROUND_ACTION_COST} action points`));
    }
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("rate-limits to one underground drive per character per turn", async () => {
    const character = makeCharacter();
    const union = makeUnion();
    const { db, characterUpdate } = stubDb({
      union,
      turn: 42,
      organizer: { lastUndergroundDriveTurn: 42 },
    });
    const result = await organizeUnderground(db, character, union, "quiet");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/already ran an underground drive/i);
    }
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("a quiet drive spends actions and builds the shadow pool, never the treasury", async () => {
    const character = makeCharacter();
    const union = makeUnion({ undergroundStrength: 10, heat: 0 });
    const { db, characterUpdate, unionUpdate, organizerUpdate } = stubDb({
      union,
      unionAfter: { ...union, undergroundStrength: 10 + UNDERGROUND_QUIET_STRENGTH_GAIN, heat: 4 },
    });
    const result = await organizeUnderground(db, character, union, "quiet");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.undergroundStrength).toBe(10 + UNDERGROUND_QUIET_STRENGTH_GAIN);
    expect(result.strengthGain).toBe(UNDERGROUND_QUIET_STRENGTH_GAIN);
    expect(result.actionsSpent).toBe(UNDERGROUND_ACTION_COST);
    expect(result.statusLabel).toBe("dark");
    expect(result.heatText).toBe("cold");
    // Actions spent via conditional update; treasury untouched.
    expect(characterUpdate).toHaveBeenCalled();
    const [, unionWrite] = unionUpdate.mock.calls[0] as unknown as [
      unknown,
      { $inc: Record<string, number> },
    ];
    expect(unionWrite.$inc.undergroundStrength).toBe(UNDERGROUND_QUIET_STRENGTH_GAIN);
    expect(unionWrite.$inc).not.toHaveProperty("treasury");
    expect(unionWrite.$inc).not.toHaveProperty("strength");
    expect(organizerUpdate).toHaveBeenCalled();
  });

  it("a mass drive while exposed builds at half efficiency", async () => {
    const character = makeCharacter();
    const union = makeUnion({ exposedUntilTurn: 50 });
    const { db } = stubDb({
      union,
      turn: 42,
      unionAfter: { ...union, exposedUntilTurn: 50 },
    });
    const result = await organizeUnderground(db, character, union, "mass");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.strengthGain).toBe(UNDERGROUND_MASS_STRENGTH_GAIN / 2);
    expect(result.statusLabel).toBe("exposed");
  });

  it("refunds actions when the union vanishes between read and write", async () => {
    const character = makeCharacter();
    const union = makeUnion();
    const characterUpdate = vi
      .fn()
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 1 });
    const db = {
      collection: (name: string) => {
        if (name === "characters") {
          return { updateOne: characterUpdate };
        }
        if (name === "unions") return { findOneAndUpdate: vi.fn().mockResolvedValue(null) };
        if (name === "unionOrganizers") {
          return { findOne: vi.fn().mockResolvedValue(null) };
        }
        if (name === "federalBudget") {
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: true }) };
        }
        if (name === "gameState") {
          return { findOne: vi.fn().mockResolvedValue({ currentTurn: 42 }) };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;
    const result = await organizeUnderground(db, character, union, "quiet");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    // First call spends, second call refunds.
    expect(characterUpdate).toHaveBeenCalledTimes(2);
    expect(characterUpdate.mock.calls[1][1]).toMatchObject({
      $inc: { actions: UNDERGROUND_ACTION_COST },
    });
  });
});

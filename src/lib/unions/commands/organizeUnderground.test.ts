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
  crisisUpdate: ReturnType<typeof vi.fn>;
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
  const crisisUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const db = {
    collection: (name: string) => {
      if (name === "characters") return { updateOne: characterUpdate };
      if (name === "unions") return { findOneAndUpdate: unionUpdate };
      if (name === "unionOrganizers") {
        return {
          findOne: vi.fn().mockImplementation((query: Record<string, unknown>) => {
            if ("barredUntilTurn" in query) {
              const bar = opts.organizer?.barredUntilTurn;
              return Promise.resolve(
                typeof bar === "number" && bar >= (opts.turn ?? 42) ? opts.organizer : null
              );
            }
            return Promise.resolve(opts.organizer ?? null);
          }),
          findOneAndUpdate: organizerUpdate,
        };
      }
      if (name === "federalBudget") {
        return { findOne: vi.fn().mockResolvedValue({ unionsBanned: opts.banned ?? true }) };
      }
      if (name === "gameState") {
        return { findOne: vi.fn().mockResolvedValue({ currentTurn: opts.turn ?? 42 }) };
      }
      if (name === "crises") return { updateOne: crisisUpdate };
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  return { db, characterUpdate, unionUpdate, organizerUpdate, crisisUpdate };
}

describe("organizeUnderground (command)", () => {
  it("applies an organizer prosecution bar across unions before spending", async () => {
    const character = makeCharacter();
    const union = makeUnion();
    const state = stubDb({ union, organizer: { barredUntilTurn: 45 }, turn: 42 });
    expect(await organizeUnderground(state.db, character, union, "quiet")).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(state.characterUpdate).not.toHaveBeenCalled();
  });

  it("limits a character to one drive globally across unions", async () => {
    const character = makeCharacter();
    const firstUnion = makeUnion();
    const secondUnion = makeUnion({ _id: new ObjectId() });
    const state = stubDb({ union: firstUnion });
    state.characterUpdate
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 0 });

    expect((await organizeUnderground(state.db, character, firstUnion, "quiet")).ok).toBe(true);
    const second = await organizeUnderground(state.db, character, secondUnion, "quiet");
    expect(second).toMatchObject({ ok: false, status: 409 });
    expect(state.unionUpdate).toHaveBeenCalledTimes(1);
    expect(state.characterUpdate.mock.calls[1][0]).toMatchObject({
      lastUndergroundDriveTurn: { $ne: 42 },
    });
  });

  it("bars prosecuted organizers through the stated turn and lets the bar expire", async () => {
    const character = makeCharacter();
    const union = makeUnion();
    const barred = stubDb({ union, organizer: { barredUntilTurn: 42 }, turn: 42 });
    const refused = await organizeUnderground(barred.db, character, union, "quiet");
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.status).toBe(403);
    expect(barred.characterUpdate).not.toHaveBeenCalled();

    const expired = stubDb({ union, organizer: { barredUntilTurn: 42 }, turn: 43 });
    const allowed = await organizeUnderground(expired.db, character, union, "quiet");
    expect(allowed.ok).toBe(true);
    expect(expired.organizerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ barredUntilTurn: { $not: { $gte: 43 } } }),
      expect.anything(),
      expect.anything()
    );
  });
  it("refuses a stale suspended flag when the budget is no longer banned", async () => {
    const character = makeCharacter();
    const union = makeUnion({ suspended: true });
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

  it("rejects a concurrent second drive without changing the union", async () => {
    const character = makeCharacter();
    const union = makeUnion();
    const characterUpdate = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const unionUpdate = vi.fn().mockResolvedValue({ ...union });
    const organizerUpdate = vi
      .fn()
      .mockResolvedValueOnce({ _id: new ObjectId() })
      .mockResolvedValueOnce(null);
    const db = {
      collection: (name: string) => {
        if (name === "characters") return { updateOne: characterUpdate };
        if (name === "unions") return { findOneAndUpdate: unionUpdate };
        if (name === "unionOrganizers") {
          return {
            findOne: vi.fn().mockResolvedValue(null),
            findOneAndUpdate: organizerUpdate,
          };
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

    const results = await Promise.all([
      organizeUnderground(db, character, union, "quiet"),
      organizeUnderground(db, character, union, "quiet"),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)[0]).toMatchObject({ status: 409 });
    expect(unionUpdate).toHaveBeenCalledTimes(1);
    expect(characterUpdate.mock.calls[0][0]).toMatchObject({
      lastUndergroundDriveTurn: { $ne: 42 },
    });
    // Two spends and one refund for the losing request.
    expect(characterUpdate).toHaveBeenCalledTimes(3);
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

  it("a strong mass drive extends an active ban-strike crisis without a legal strike", async () => {
    const character = makeCharacter();
    const union = makeUnion({ undergroundStrength: 12 });
    const { db, crisisUpdate } = stubDb({
      union,
      unionAfter: { ...union, undergroundStrength: 21 },
    });
    const result = await organizeUnderground(db, character, union, "mass");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crisisExtended).toBe(true);
    expect(crisisUpdate).toHaveBeenCalledTimes(1);
    expect(crisisUpdate.mock.calls[0][0]).toMatchObject({
      countryIds: "US",
      status: "active",
      lastUndergroundExtensionTurn: { $ne: 42 },
    });
  });

  it("a quiet drive never touches the wildcat crisis", async () => {
    const character = makeCharacter();
    const union = makeUnion({ undergroundStrength: 20 });
    const { db, crisisUpdate } = stubDb({ union });
    const result = await organizeUnderground(db, character, union, "quiet");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crisisExtended).toBe(false);
    expect(crisisUpdate).not.toHaveBeenCalled();
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
          return {
            findOne: vi.fn().mockResolvedValue(null),
            findOneAndUpdate: vi.fn().mockResolvedValue({ _id: new ObjectId() }),
            deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
          };
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

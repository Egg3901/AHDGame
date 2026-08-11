import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { seedImfInstitution, SeedImfInstitutionError } from "./seedImfInstitution";
import { CEO_INITIAL_SHARES } from "@/lib/constants/corporations";

function makeDb(overrides: {
  imfCorp?: Record<string, unknown> | null;
  /** Per character id hex — null = not found; omit key = default playable character */
  characters?: Record<string, { _id: ObjectId; userId?: ObjectId | null } | null>;
  insertId?: ObjectId;
  updateModified?: number;
}) {
  const insertOne = vi.fn(async () => ({
    insertedId: overrides.insertId ?? new ObjectId(),
  }));

  const updateOne = vi.fn(async () => ({
    matchedCount: 1,
    modifiedCount: overrides.updateModified ?? 1,
  }));

  const corpsFindOne = vi.fn(async () => overrides.imfCorp ?? null);

  const charactersFindOne = vi.fn(async (query: { _id?: ObjectId }) => {
    if (!query._id) return null;
    const key = query._id.toString();
    const map = overrides.characters;
    if (map && Object.prototype.hasOwnProperty.call(map, key)) {
      return map[key] ?? null;
    }
    return {
      _id: query._id,
      userId: new ObjectId(),
    };
  });

  const countersFindOneAndUpdate = vi.fn(async () => ({ seq: 900001 }));

  return {
    db: {
      collection: (name: string) => {
        if (name === "characters") return { findOne: charactersFindOne };
        if (name === "corporations") return { findOne: corpsFindOne, insertOne, updateOne };
        if (name === "counters") return { findOneAndUpdate: countersFindOneAndUpdate };
        // The share base is era-scaled, so seeding reads the world preset.
        // No preset here ⇒ the default (modern) base, which is what these
        // assertions are written against.
        if (name === "gameState") return { findOne: async () => null };
        throw new Error(`unexpected ${name}`);
      },
    },
    insertOne,
    updateOne,
  };
}

describe("seedImfInstitution", () => {
  const sh1 = new ObjectId();
  const sh2 = new ObjectId();
  const other = new ObjectId();

  const input = (ceo: ObjectId, a: ObjectId, b: ObjectId) => ({
    ceoCharacterId: ceo,
    shareholderCharacterIds: [a, b] as [ObjectId, ObjectId],
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when shareholders are identical", async () => {
    const { db } = makeDb({});
    await expect(
      seedImfInstitution(db as never, {
        ceoCharacterId: sh1,
        shareholderCharacterIds: [sh1, sh1],
      })
    ).rejects.toThrow(SeedImfInstitutionError);
  });

  it("throws when CEO is not one of the shareholders", async () => {
    const { db } = makeDb({});
    await expect(seedImfInstitution(db as never, input(other, sh1, sh2))).rejects.toThrow(
      SeedImfInstitutionError
    );
  });

  it("inserts IMF with chosen CEO and split ownership", async () => {
    const { db, insertOne } = makeDb({});
    const result = await seedImfInstitution(db as never, input(sh1, sh1, sh2));
    expect(result.created).toBe(true);
    expect(insertOne).toHaveBeenCalledTimes(1);
    const insertArgs = insertOne.mock.calls as unknown as [unknown[]];
    expect(insertArgs[0]).toBeDefined();
    const doc = insertArgs[0][0] as {
      ceoId: ObjectId;
      userId: ObjectId;
      shareholders: { characterId: ObjectId; shares: number }[];
    };
    expect(doc.ceoId.equals(sh1)).toBe(true);
    expect(doc.shareholders).toHaveLength(2);
    expect(doc.shareholders[0].shares).toBe(CEO_INITIAL_SHARES / 2);
    expect(doc.shareholders[1].shares).toBe(CEO_INITIAL_SHARES / 2);
  });

  it("uses second character as CEO when selected", async () => {
    const { db, insertOne } = makeDb({});
    await seedImfInstitution(db as never, input(sh2, sh1, sh2));
    const insertArgs = insertOne.mock.calls as unknown as [unknown[]];
    const doc = insertArgs[0][0] as { ceoId: ObjectId };
    expect(doc.ceoId.equals(sh2)).toBe(true);
  });

  it("repairs existing IMF when repairExisting is true", async () => {
    const imfId = new ObjectId();
    const { db, updateOne } = makeDb({
      imfCorp: {
        _id: imfId,
        sequentialId: 42,
        imfInstitution: true,
      },
    });
    const result = await seedImfInstitution(db as never, {
      ...input(sh1, sh1, sh2),
      repairExisting: true,
    });
    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);
    const updateArgs = updateOne.mock.calls as unknown as [unknown[]];
    expect(updateArgs[0]).toBeDefined();
    const set = (updateArgs[0][1] as { $set: Record<string, unknown> }).$set as {
      ceoId: ObjectId;
    };
    expect(set.ceoId.equals(sh1)).toBe(true);
  });

  it("skips repair when repairExisting is false and IMF exists", async () => {
    const imfId = new ObjectId();
    const { db, updateOne } = makeDb({
      imfCorp: {
        _id: imfId,
        sequentialId: 42,
        imfInstitution: true,
      },
    });
    const result = await seedImfInstitution(db as never, {
      ...input(sh1, sh1, sh2),
      repairExisting: false,
    });
    expect(result.created).toBe(false);
    expect(result.updated).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("throws when character has no userId", async () => {
    const { db } = makeDb({
      characters: {
        [sh2.toString()]: { _id: sh2 },
      },
    });
    await expect(seedImfInstitution(db as never, input(sh1, sh1, sh2))).rejects.toThrow(
      SeedImfInstitutionError
    );
  });
});

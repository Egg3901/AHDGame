import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { resolveUnionOwner, resolveUnionOwners } from "./unionOwnerDisplay";

function mockDb(collections: Record<string, { find: ReturnType<typeof vi.fn> }>) {
  return {
    collection: (name: string) => collections[name] ?? { find: vi.fn() },
  } as never;
}

describe("resolveUnionOwners", () => {
  it("looks up player presidents in characters and NPP presidents in npps", async () => {
    const playerId = new ObjectId();
    const nppId = new ObjectId();
    const charactersFind = vi.fn().mockReturnValue({
      toArray: async () => [{ _id: playerId, name: "Ada Prentice", sequentialId: 12 }],
    });
    const nppsFind = vi.fn().mockReturnValue({
      toArray: async () => [{ _id: nppId, name: "Klaus Weber", sequentialId: 88, avatarUrl: "a.png" }],
    });
    const db = mockDb({
      characters: { find: charactersFind },
      npps: { find: nppsFind },
    });

    const map = await resolveUnionOwners(
      db,
      [
        { ownerId: playerId, ownerType: "character" },
        { ownerId: nppId, ownerType: "npp" },
        { ownerId: null },
      ],
      { includeAvatar: true }
    );

    expect(map.get(playerId.toString())).toEqual({
      id: playerId.toString(),
      name: "Ada Prentice",
      sequentialId: 12,
      avatarUrl: null,
      isNPP: false,
    });
    expect(map.get(nppId.toString())).toEqual({
      id: nppId.toString(),
      name: "Klaus Weber",
      sequentialId: 88,
      avatarUrl: "a.png",
      isNPP: true,
    });
    expect(charactersFind).toHaveBeenCalledWith(
      { _id: { $in: [playerId] } },
      expect.objectContaining({ projection: expect.objectContaining({ name: 1 }) })
    );
    expect(nppsFind).toHaveBeenCalledWith(
      { _id: { $in: [nppId] } },
      expect.objectContaining({ projection: expect.objectContaining({ name: 1 }) })
    );
  });

  it("treats absent ownerType as a character (legacy docs)", async () => {
    const playerId = new ObjectId();
    const charactersFind = vi.fn().mockReturnValue({
      toArray: async () => [{ _id: playerId, name: "Bo Marsh", sequentialId: 3 }],
    });
    const nppsFind = vi.fn().mockReturnValue({ toArray: async () => [] });
    const db = mockDb({
      characters: { find: charactersFind },
      npps: { find: nppsFind },
    });

    const map = await resolveUnionOwners(db, [{ ownerId: playerId }]);
    expect(map.get(playerId.toString())?.isNPP).toBe(false);
    expect(nppsFind).not.toHaveBeenCalled();
  });
});

describe("resolveUnionOwner", () => {
  it("returns null for a vacant seat", async () => {
    const db = mockDb({});
    expect(await resolveUnionOwner(db, { ownerId: null })).toBeNull();
  });
});

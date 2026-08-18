import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { resolveMyUnionNav } from "./resolveMyUnionNav";

function mockDb(handlers: Record<string, object>): Db {
  return {
    collection: vi.fn(
      (name: string) => handlers[name] ?? { findOne: vi.fn().mockResolvedValue(null) }
    ),
  } as unknown as Db;
}

describe("resolveMyUnionNav", () => {
  const characterId = new ObjectId();
  const ledUnionId = new ObjectId();
  const organizedUnionId = new ObjectId();

  it("returns the led union when unionLeaderOf points at a real union", async () => {
    const db = mockDb({
      unions: { findOne: vi.fn().mockResolvedValue({ _id: ledUnionId }) },
    });
    const result = await resolveMyUnionNav(db, { _id: characterId, unionLeaderOf: ledUnionId });
    expect(result).toEqual({ id: ledUnionId.toString() });
  });

  it("prefers leadership over organizer membership", async () => {
    const organizerFindOne = vi.fn();
    const db = mockDb({
      unions: { findOne: vi.fn().mockResolvedValue({ _id: ledUnionId }) },
      unionOrganizers: { findOne: organizerFindOne },
    });
    await resolveMyUnionNav(db, { _id: characterId, unionLeaderOf: ledUnionId });
    expect(organizerFindOne).not.toHaveBeenCalled();
  });

  it("falls back to the highest-strength organizer union when not a head", async () => {
    const unionsFindOne = vi.fn().mockResolvedValue({ _id: organizedUnionId });
    const db = mockDb({
      unions: { findOne: unionsFindOne },
      unionOrganizers: {
        findOne: vi.fn().mockResolvedValue({ unionId: organizedUnionId }),
      },
    });
    const result = await resolveMyUnionNav(db, { _id: characterId, unionLeaderOf: null });
    expect(result).toEqual({ id: organizedUnionId.toString() });
    expect(unionsFindOne).toHaveBeenCalledWith(
      { _id: organizedUnionId },
      { projection: { _id: 1 } }
    );
  });

  it("falls through to organizer membership when the led union is missing", async () => {
    const unionsFindOne = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: organizedUnionId });
    const db = mockDb({
      unions: { findOne: unionsFindOne },
      unionOrganizers: {
        findOne: vi.fn().mockResolvedValue({ unionId: organizedUnionId }),
      },
    });
    const result = await resolveMyUnionNav(db, { _id: characterId, unionLeaderOf: ledUnionId });
    expect(result).toEqual({ id: organizedUnionId.toString() });
  });

  it("returns null when the character leads nothing and organizes nothing", async () => {
    const db = mockDb({
      unions: { findOne: vi.fn().mockResolvedValue(null) },
      unionOrganizers: { findOne: vi.fn().mockResolvedValue(null) },
    });
    const result = await resolveMyUnionNav(db, { _id: characterId });
    expect(result).toBeNull();
  });
});

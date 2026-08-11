import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/military/conscriptionLaw", () => ({
  resolveConscriptionStanceFor: vi.fn(),
}));

const { resolveConscriptionStanceFor } = await import("@/lib/military/conscriptionLaw");
const { ensureManpowerPool, drawManpower, returnManpower } = await import("./manpowerPool");

describe("manpowerPool", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("nationalManpower");
    db.collection("states");
    db.collectionMocks.states.find.mockReturnValue({
      // 100M population x 0.02 cap fraction x 1.0 poolMult = 2,000,000 ceiling.
      toArray: async () => [{ population: 100_000_000 }],
    });
    vi.mocked(resolveConscriptionStanceFor).mockResolvedValue({
      id: "selective",
      label: "Selective Service",
      poolMult: 1,
      conscriptAllowed: true,
    });
    db.collectionMocks.nationalManpower.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  describe("ensureManpowerPool", () => {
    it("heals a missing document to the same 25% seedNationalManpower writes", async () => {
      db.collectionMocks.nationalManpower.findOne.mockResolvedValue(null);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await ensureManpowerPool(db as unknown as Db, "PL");

      // 25% of the 2,000,000 ceiling. NOT the ceiling: a healed legacy world and
      // a freshly seeded world must start at the same number.
      expect(result).toEqual({ pool: 500_000, ceiling: 2_000_000 });
      // `mode` must be written explicitly — NationalManpower requires it, and a
      // doc upserted without it makes applyReinforcement skip its "off" branch.
      expect(db.collectionMocks.nationalManpower.updateOne).toHaveBeenCalledWith(
        { countryId: "PL" },
        { $set: { pool: 500_000, mode: "trained" } },
        { upsert: true }
      );
      warn.mockRestore();
    });

    it("heals a legacy document that has a pool but no mode", async () => {
      // applyReinforcement upserts `{ pool }` alone, so live docs exist without
      // `mode`. This fixes them in place rather than merely tolerating them.
      db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
        countryId: "PL",
        pool: 500,
      });

      const result = await ensureManpowerPool(db as unknown as Db, "PL");

      expect(result).toEqual({ pool: 500, ceiling: null });
      expect(db.collectionMocks.nationalManpower.updateOne).toHaveBeenCalledWith(
        { countryId: "PL" },
        { $set: { mode: "trained" } },
        { upsert: true }
      );
    });

    it("leaves a healthy document alone and skips the expensive ceiling read", async () => {
      db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
        countryId: "PL",
        pool: 500,
        mode: "conscript",
      });

      const result = await ensureManpowerPool(db as unknown as Db, "PL");

      expect(result).toEqual({ pool: 500, ceiling: null });
      expect(db.collectionMocks.nationalManpower.updateOne).not.toHaveBeenCalled();
      // Ceiling is lazy: no legislation read and no full states scan.
      expect(resolveConscriptionStanceFor).not.toHaveBeenCalled();
      expect(db.collectionMocks.states.find).not.toHaveBeenCalled();
    });
  });

  describe("drawManpower", () => {
    it("guards the decrement on the pool actually being sufficient", async () => {
      const ok = await drawManpower(db as unknown as Db, "PL", 12_000);
      expect(ok).toBe(true);
      expect(db.collectionMocks.nationalManpower.updateOne).toHaveBeenCalledWith(
        { countryId: "PL", pool: { $gte: 12_000 } },
        { $inc: { pool: -12_000 } }
      );
    });

    it("reports failure when the guard matches nothing", async () => {
      db.collectionMocks.nationalManpower.updateOne.mockResolvedValue({
        matchedCount: 0,
        modifiedCount: 0,
      });
      expect(await drawManpower(db as unknown as Db, "PL", 12_000)).toBe(false);
    });
  });

  describe("returnManpower", () => {
    beforeEach(() => {
      db.collectionMocks.nationalManpower.findOne.mockResolvedValue({
        countryId: "PL",
        pool: 500_000,
        mode: "trained",
      });
    });

    it("does nothing for a non-positive amount", async () => {
      await returnManpower(db as unknown as Db, "PL", 0);
      expect(db.collectionMocks.nationalManpower.updateOne).not.toHaveBeenCalled();
    });

    it("increments atomically when the full amount fits under the ceiling", async () => {
      await returnManpower(db as unknown as Db, "PL", 12_000);
      expect(db.collectionMocks.nationalManpower.updateOne).toHaveBeenCalledWith(
        { countryId: "PL", pool: { $lte: 2_000_000 - 12_000 } },
        { $inc: { pool: 12_000 } }
      );
    });

    // The branch the route tests never reach: the increment would breach the
    // ceiling, so it clamps instead.
    it("clamps to the ceiling when the increment would breach it", async () => {
      db.collectionMocks.nationalManpower.updateOne.mockResolvedValueOnce({
        matchedCount: 0,
        modifiedCount: 0,
      });
      await returnManpower(db as unknown as Db, "PL", 12_000);

      const calls = db.collectionMocks.nationalManpower.updateOne.mock.calls;
      expect(calls).toHaveLength(2);
      // `$lt: ceiling`, NOT an unconditional $set. A pool sitting ABOVE its
      // ceiling is legitimate (a stance downgrade or population fall lowers the
      // ceiling), and an unconditional set would silently destroy that excess.
      expect(calls[1]).toEqual([
        { countryId: "PL", pool: { $lt: 2_000_000 } },
        { $set: { pool: 2_000_000 } },
      ]);
    });

    it("never upserts — ensureManpowerPool guarantees the document exists", async () => {
      await returnManpower(db as unknown as Db, "PL", 12_000);
      for (const call of db.collectionMocks.nationalManpower.updateOne.mock.calls) {
        // An upsert here would insert a doc with no `mode`, violating the type.
        expect(call[2]?.upsert).toBeUndefined();
      }
    });
  });
});

import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { applyCountryBondRestructure } from "../restructure";
import { RESTRUCTURE_BOND_MARKET_PRICE, RESTRUCTURE_HAIRCUT } from "../../constants";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Bond } from "@/lib/db/types/bond";
import { sumOutstandingSovereignPrincipal } from "@/lib/bonds/sovereignPrincipal";

interface FakeBond {
  _id: ObjectId;
  maturityTurn: number;
  totalIssued: number;
  originalMaturityTurn?: number | null;
  originalTotalIssued?: number | null;
}

function makeDb(bonds: FakeBond[]) {
  const bulkWriteOps: Array<Record<string, unknown>> = [];
  const db = {
    collection: vi.fn().mockReturnValue({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(bonds),
      }),
      bulkWrite: vi.fn().mockImplementation(async (ops: Array<Record<string, unknown>>) => {
        bulkWriteOps.push(...ops);
        return { modifiedCount: ops.length };
      }),
    }),
  } as unknown as Db;
  return { db, bulkWriteOps };
}

describe("applyCountryBondRestructure", () => {
  it("stamps haircut, extended maturity, and market price per bond", async () => {
    const id = new ObjectId();
    const { db, bulkWriteOps } = makeDb([{ _id: id, maturityTurn: 800, totalIssued: 1_000_000 }]);
    await applyCountryBondRestructure(db, "US", 0.4, 60);
    expect(bulkWriteOps).toHaveLength(1);
    const op = bulkWriteOps[0] as {
      updateOne: { filter: unknown; update: { $set: Record<string, unknown> } };
    };
    expect(op.updateOne.filter).toEqual({ _id: id });
    expect(op.updateOne.update.$set.restructureHaircutPercent).toBe(0.4);
    expect(op.updateOne.update.$set.restructureExtendedMaturityTurn).toBe(860);
    expect(op.updateOne.update.$set.marketPrice).toBe(RESTRUCTURE_BOND_MARKET_PRICE);
    expect(op.updateOne.update.$set.originalMaturityTurn).toBe(800);
    expect(op.updateOne.update.$set.originalTotalIssued).toBe(1_000_000);
  });

  it("preserves existing originalMaturityTurn / originalTotalIssued (idempotent on second restructure)", async () => {
    const id = new ObjectId();
    const { db, bulkWriteOps } = makeDb([
      {
        _id: id,
        maturityTurn: 860,
        totalIssued: 600_000,
        originalMaturityTurn: 800,
        originalTotalIssued: 1_000_000,
      },
    ]);
    await applyCountryBondRestructure(db, "US", 0.4, 60);
    const op = bulkWriteOps[0] as {
      updateOne: { update: { $set: Record<string, unknown> } };
    };
    expect(op.updateOne.update.$set.originalMaturityTurn).toBeUndefined();
    expect(op.updateOne.update.$set.originalTotalIssued).toBeUndefined();
    expect(op.updateOne.update.$set.restructureExtendedMaturityTurn).toBe(920);
  });

  it("returns 0 affected when no bonds match", async () => {
    const { db } = makeDb([]);
    const r = await applyCountryBondRestructure(db, "US", 0.4, 60);
    expect(r).toEqual({ bondsAffected: 0 });
  });

  it("re-entry changes no face and preserves the first run's originals (#1975)", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    memory.seed("bonds", [
      {
        _id: "b1",
        issuerType: "sovereign",
        countryId: "US",
        totalIssued: 10_000_000_000,
        maturityTurn: 800,
        matured: false,
        defaulted: false,
        originalMaturityTurn: null,
        originalTotalIssued: null,
      },
    ]);
    const first = await applyCountryBondRestructure(db, "US", RESTRUCTURE_HAIRCUT, 60);
    expect(first).toEqual({ bondsAffected: 1 });
    const second = await applyCountryBondRestructure(db, "US", RESTRUCTURE_HAIRCUT, 60);
    // Still matches (restructure does not flip defaulted), but face is
    // untouched and the first run's originals survive the second stamp.
    expect(second).toEqual({ bondsAffected: 1 });
    const bonds = await db.collection<Bond>("bonds").find({ countryId: "US" }).toArray();
    expect(bonds).toHaveLength(1);
    expect(bonds[0]?.totalIssued).toBe(10_000_000_000);
    expect(bonds[0]?.originalTotalIssued).toBe(10_000_000_000);
    expect(bonds[0]?.originalMaturityTurn).toBe(800);
    expect(bonds[0]?.restructureHaircutPercent).toBe(RESTRUCTURE_HAIRCUT);
    expect(sumOutstandingSovereignPrincipal(bonds)).toBe(6_000_000_000);
  });
});

import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { markCountryBondsRepudiated } from "../repudiate";
import { REPUDIATE_BOND_MARKET_PRICE } from "../../constants";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { Bond } from "@/lib/db/types/bond";
import { sumOutstandingSovereignPrincipal } from "@/lib/bonds/sovereignPrincipal";

function makeDb() {
  const updateMany = vi.fn().mockResolvedValue({ matchedCount: 7, modifiedCount: 7 });
  const db = {
    collection: vi.fn().mockReturnValue({ updateMany }),
  } as unknown as Db;
  return { db, updateMany };
}

describe("markCountryBondsRepudiated", () => {
  it("filters active sovereign bonds without a frozen maturity claim", async () => {
    const { db, updateMany } = makeDb();
    await markCountryBondsRepudiated(db, "US", 600);
    const filter = updateMany.mock.calls[0][0];
    expect(filter).toEqual({
      issuerType: "sovereign",
      countryId: "US",
      matured: false,
      defaulted: false,
      sovereignMaturityClaim: { $exists: false },
    });
  });

  it("$sets defaulted=true, defaultedAtTurn, and marketPrice = REPUDIATE constant", async () => {
    const { db, updateMany } = makeDb();
    await markCountryBondsRepudiated(db, "US", 600);
    const update = updateMany.mock.calls[0][1];
    expect(update.$set.defaulted).toBe(true);
    expect(update.$set.defaultedAtTurn).toBe(600);
    expect(update.$set.marketPrice).toBe(REPUDIATE_BOND_MARKET_PRICE);
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
  });

  it("returns the affected count", async () => {
    const { db } = makeDb();
    const r = await markCountryBondsRepudiated(db, "US", 600);
    expect(r).toEqual({ bondsAffected: 7 });
  });

  it("re-entry is a no-op: second run affects nothing and changes no face (#1975)", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    memory.seed("bonds", [
      {
        _id: "b1",
        issuerType: "sovereign",
        countryId: "US",
        totalIssued: 6_000_000_000,
        matured: false,
        defaulted: false,
      },
      {
        _id: "b2",
        issuerType: "sovereign",
        countryId: "US",
        totalIssued: 4_000_000_000,
        matured: false,
        defaulted: false,
      },
    ]);
    const first = await markCountryBondsRepudiated(db, "US", 600);
    expect(first).toEqual({ bondsAffected: 2 });
    const second = await markCountryBondsRepudiated(db, "US", 600);
    expect(second).toEqual({ bondsAffected: 0 });
    const bonds = await db.collection<Bond>("bonds").find({ countryId: "US" }).toArray();
    // Face is never rewritten by a default flip; the emptied ledger is the write-down.
    expect(bonds.map((b) => b.totalIssued).sort((a, b) => a - b)).toEqual([
      4_000_000_000, 6_000_000_000,
    ]);
    expect(bonds.every((b) => b.defaulted)).toBe(true);
    expect(sumOutstandingSovereignPrincipal(bonds)).toBe(0);
  });

  it("leaves a bond with a frozen sovereign maturity claim untouched", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    memory.seed("bonds", [
      {
        _id: "claimed-bond",
        issuerType: "sovereign",
        countryId: "US",
        totalIssued: 6_000_000_000,
        matured: false,
        defaulted: false,
        sovereignMaturityClaim: {
          id: "sovereign-maturity:claimed-bond:600",
          dueTurn: 600,
          currencyCode: "USD",
          treasuryLocalPerAnchor: 1,
          amountLocal: 6_000_000_000,
          escrowLocal: 6_000_000_000,
          sourceHolders: [],
          sourcePublicFloat: 0,
          holderLegs: [],
        },
      },
    ]);

    const result = await markCountryBondsRepudiated(db, "US", 600);
    const bonds = await db.collection<Bond>("bonds").find({ countryId: "US" }).toArray();

    expect(result).toEqual({ bondsAffected: 0 });
    expect(bonds[0]).toMatchObject({ defaulted: false, totalIssued: 6_000_000_000 });
  });
});

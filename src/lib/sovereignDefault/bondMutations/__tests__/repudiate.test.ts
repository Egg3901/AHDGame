import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { markCountryBondsRepudiated } from "../repudiate";
import { REPUDIATE_BOND_MARKET_PRICE } from "../../constants";

function makeDb() {
  const updateMany = vi.fn().mockResolvedValue({ matchedCount: 7, modifiedCount: 7 });
  const db = {
    collection: vi.fn().mockReturnValue({ updateMany }),
  } as unknown as Db;
  return { db, updateMany };
}

describe("markCountryBondsRepudiated", () => {
  it("filters by issuerType=sovereign, countryId, !matured, !defaulted", async () => {
    const { db, updateMany } = makeDb();
    await markCountryBondsRepudiated(db, "US", 600);
    const filter = updateMany.mock.calls[0][0];
    expect(filter).toEqual({
      issuerType: "sovereign",
      countryId: "US",
      matured: false,
      defaulted: false,
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
});

import { describe, expect, it, vi } from "vitest";
import { type Db, ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { makeCorporation } from "@/lib/test-utils/factories";
import { loadPortfolioHoldings } from "./portfolioHoldings";

vi.mock("@/lib/corporations/imfPortfolioReceivables", () => ({
  findImfFacilityReceivablesForLender: vi
    .fn()
    .mockResolvedValue({ receivables: [], totalPrincipal: 0 }),
}));

describe("loadPortfolioHoldings legacy bond rows (#2349)", () => {
  it("does not throw on a bond document without a holders array", async () => {
    const db = createMockDb();
    const corpId = new ObjectId();
    const corporation = makeCorporation({ _id: corpId, countryId: "US" });

    // Legacy row: `holders` is required by the Bond type, but old documents
    // can arrive without it. An unguarded `.find` 500s the whole page.
    const holderlessBond = {
      _id: new ObjectId(),
      couponRate: 5,
      marketPrice: 1,
      maturityTurn: 100,
      currencyCode: "USD",
      totalIssued: 1000,
      matured: false,
    };
    const heldBond = {
      _id: new ObjectId(),
      couponRate: 5,
      marketPrice: 1,
      maturityTurn: 100,
      currencyCode: "USD",
      totalIssued: 1000,
      matured: false,
      holders: [{ corporationId: corpId, units: 10 }],
    };
    const bonds = db.collection("bonds");
    (bonds.find as ReturnType<typeof vi.fn>).mockReturnValue({
      toArray: () => Promise.resolve([holderlessBond, heldBond]),
    });

    const result = await loadPortfolioHoldings(
      db as unknown as Db,
      corporation,
      10,
      new Map([["USD", 1]])
    );

    expect(result.heldBondsSummary).toHaveLength(2);
    expect(result.heldBondsSummary[0]!.units).toBe(0);
    expect(result.heldBondsSummary[0]!.currentValue).toBe(0);
    expect(result.heldBondsSummary[1]!.units).toBe(10);
  });
});

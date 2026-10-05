import { describe, expect, it, vi } from "vitest";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getBankId } from "@/lib/centralBank/helpers";
import { getSovereignCouponRate } from "@/lib/bonds/sovereign";
import { seedSovereignBondInstruments } from "./seedSovereignBondInstruments";

function makeCursor<T>(rows: T[]) {
  // `project` is chained by the corporation preload, so the fake cursor has to
  // return itself for it the way a real FindCursor does.
  const cursor = {
    toArray: async () => rows,
    project: () => cursor,
    sort: () => cursor,
  };
  return cursor;
}

describe("seedSovereignBondInstruments", () => {
  it.each([1953, 2019])(
    "preserves %i policy-priced coupons and par instruments",
    async (fiscalYear) => {
      const db = createMockDb();
      const inserted: Array<{
        maturityTurns: BondMaturityTurns;
        couponRate: number;
        marketPrice: number;
      }> = [];
      db.collection("federalBudget").find.mockReturnValue(
        makeCursor([
          {
            _id: "UK",
            countryId: "UK",
            fiscalYear,
            creditRating: "AAA",
            debt: { principal: 20_000_000, interestRate: 0.105 },
          },
        ])
      );
      db.collection("centralBanks").find.mockReturnValue(
        makeCursor([{ _id: getBankId("UK"), primeRate: 2.5 }])
      );
      db.collection("corporations").find.mockReturnValue(makeCursor([]));
      db.collectionMocks.corporations.findOne.mockResolvedValue(null);
      db.collection("bonds").find.mockReturnValue(makeCursor([]));
      db.collectionMocks.bonds.insertMany.mockImplementation(async (docs: typeof inserted) => {
        inserted.push(...docs);
        return { insertedCount: docs.length };
      });
      await seedSovereignBondInstruments(db as unknown as Db, () => {});
      expect(inserted).toHaveLength(32);
      for (const bond of inserted) {
        expect(bond.couponRate).toBe(getSovereignCouponRate(2.5, bond.maturityTurns, 0, 0));
        expect(bond.marketPrice).toBe(1);
      }
    }
  );
  it("instruments historic debt at its average coupon independently of the opening policy rate", async () => {
    const db = createMockDb();
    const inserted: Array<{ couponRate: number; totalIssued: number; marketPrice: number }> = [];
    db.collectionMocks.federalBudget = db.collection("federalBudget");
    db.collectionMocks.federalBudget.find.mockReturnValue(
      makeCursor([
        {
          _id: "UK",
          countryId: "UK",
          creditRating: "AAA",
          fiscalYear: 1991,
          debt: { principal: 194_118_000_000, interestRate: 0.105 },
        },
      ])
    );
    db.collectionMocks.centralBanks = db.collection("centralBanks");
    db.collectionMocks.centralBanks.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.corporations = db.collection("corporations");
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    db.collectionMocks.bonds = db.collection("bonds");
    db.collectionMocks.bonds.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.bonds.insertMany.mockImplementation(async (docs: typeof inserted) => {
      inserted.push(...docs);
      return { insertedCount: docs.length };
    });
    await seedSovereignBondInstruments(db as unknown as Db, () => {});
    expect(inserted.length).toBeGreaterThan(3);
    expect(inserted.every((bond) => bond.couponRate === 10.5)).toBe(true);
    expect(
      inserted.every((bond) => Number.isFinite(bond.marketPrice) && bond.marketPrice > 1)
    ).toBe(true);
    const covered = inserted.reduce((sum, bond) => sum + bond.totalIssued, 0);
    expect(covered).toBe(194_118_000_000);
    const annualCoupon = inserted.reduce(
      (sum, bond) => sum + (bond.totalIssued * bond.couponRate) / 100,
      0
    );
    expect(annualCoupon + (194_118_000_000 - covered) * 0.105).toBeCloseTo(
      194_118_000_000 * 0.105,
      0
    );
  });
  it("materializes US/UK scalar debt into staggered sovereign bond tranches without mutating the budget", async () => {
    const db = createMockDb();
    const inserted: unknown[] = [];

    // Only US + UK budgets present — mirrors the #3370 audit gap (WWII-era
    // principal with zero bond instruments). Other COUNTRY_ORDER entries simply
    // find no budget and skip. All budgets are read in one find, so the rows
    // carry the `_id` the seeder keys them by.
    db.collectionMocks.federalBudget = db.collection("federalBudget");
    db.collectionMocks.federalBudget.find.mockReturnValue(
      makeCursor([
        { _id: "federal", debt: { principal: 275_000_000_000 }, countryId: "US" }, // FY1953 gross federal debt
        { _id: "UK", debt: { principal: 26_000_000_000 }, countryId: "UK" }, // ~£26B WWII debt
      ])
    );

    db.collectionMocks.centralBanks = db.collection("centralBanks");
    db.collectionMocks.centralBanks.find.mockReturnValue(
      makeCursor([
        { _id: getBankId("US"), primeRate: 2.5 },
        { _id: getBankId("UK"), primeRate: 2.5 },
      ])
    );

    // US resolves through the batched primary-corporation preload; UK has no
    // primary and must fall through to the per-country findOne, which is the
    // branch that deliberately was NOT batched.
    db.collectionMocks.corporations = db.collection("corporations");
    db.collectionMocks.corporations.find.mockReturnValue(
      makeCursor([
        { _id: { toString: () => "us-primary" }, name: "USPrimary", countryOwnerId: "US" },
      ])
    );
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: { toString: () => "natcorp" },
      name: "NatCorp",
    });

    db.collectionMocks.bonds = db.collection("bonds");
    db.collectionMocks.bonds.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.bonds.insertMany.mockImplementation(async (docs: unknown[]) => {
      inserted.push(...docs);
      return { insertedCount: docs.length };
    });

    const result = await seedSovereignBondInstruments(db as unknown as Db, () => {}, 0, new Date());

    expect(result.countriesSeeded).toBe(2);
    expect(result.bondsInserted).toBe(64); // 32 quarterly opening cohorts × 2 countries
    expect(result.totalFaceIssued).toBeGreaterThan(0);

    // Budget must not be rewritten — principal stays the scalar SSOT; bonds are
    // instruments layered on top (matches reconcile-sovereign route docs).
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.federalBudget.updateMany).not.toHaveBeenCalled();

    const usBonds = inserted.filter((b) => (b as { countryId: string }).countryId === "US");
    const ukBonds = inserted.filter((b) => (b as { countryId: string }).countryId === "UK");
    expect(usBonds).toHaveLength(32);
    expect(ukBonds).toHaveLength(32);

    // The batched preload supplies the US issuer; the un-batched findOne
    // fallback supplies the UK one. If the fallback were dropped in favour of a
    // single $in read, every UK bond here would silently carry USPrimary.
    expect([...new Set(usBonds.map((b) => (b as { issuerName: string }).issuerName))]).toEqual([
      "USPrimary",
    ]);
    expect([...new Set(ukBonds.map((b) => (b as { issuerName: string }).issuerName))]).toEqual([
      "NatCorp",
    ]);

    const usFace = usBonds.reduce(
      (s: number, b) => s + (b as { totalIssued: number }).totalIssued,
      0
    );
    expect(usFace).toBe(275_000_000_000);

    for (const bond of inserted) {
      const b = bond as {
        issuerType: string;
        reconcile: boolean;
        matured: boolean;
        holders: unknown[];
        maturityTurns: BondMaturityTurns;
      };
      expect(b.issuerType).toBe("sovereign");
      expect(b.reconcile).toBe(true);
      expect(b.matured).toBe(false);
      expect(b.holders).toEqual([]);
    }
    expect([
      ...new Set(usBonds.map((b) => (b as { maturityTurns: number }).maturityTurns)),
    ]).toEqual([48, 96, 240]);
    expect(
      [...new Set(usBonds.map((b) => (b as { maturityTurn: number }).maturityTurn))].sort(
        (a, b) => a - b
      )
    ).toEqual(Array.from({ length: 20 }, (_, index) => (index + 1) * 12));
    expect(
      usBonds.every((bond) => {
        const row = bond as {
          issuedAtTurn: number;
          maturityTurns: number;
          maturityTurn: number;
        };
        return row.issuedAtTurn + row.maturityTurns === row.maturityTurn;
      })
    ).toBe(true);
  });

  it("is idempotent when bonds already cover principal", async () => {
    const db = createMockDb();

    db.collectionMocks.federalBudget = db.collection("federalBudget");
    db.collectionMocks.federalBudget.find.mockReturnValue(
      makeCursor([{ _id: "federal", debt: { principal: 10_000_000 }, countryId: "US" }])
    );

    db.collectionMocks.centralBanks = db.collection("centralBanks");
    db.collectionMocks.centralBanks.find.mockReturnValue(
      makeCursor([{ _id: getBankId("US"), primeRate: 3 }])
    );

    db.collectionMocks.corporations = db.collection("corporations");
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);

    db.collectionMocks.bonds = db.collection("bonds");
    db.collectionMocks.bonds.find.mockReturnValue(
      makeCursor([{ totalIssued: 10_000_000, issuerType: "sovereign", countryId: "US" }])
    );
    db.collectionMocks.bonds.insertMany = vi.fn();

    const result = await seedSovereignBondInstruments(db as unknown as Db, () => {});
    expect(result.countriesSeeded).toBe(0);
    expect(result.bondsInserted).toBe(0);
    expect(db.collectionMocks.bonds.insertMany).not.toHaveBeenCalled();
  });

  it("uses the budget credit tier for newly seeded instruments", async () => {
    const db = createMockDb();
    const inserted: Array<{ countryId: string; maturityTurns: number; couponRate: number }> = [];

    db.collectionMocks.federalBudget = db.collection("federalBudget");
    db.collectionMocks.federalBudget.find.mockReturnValue(
      makeCursor([
        {
          _id: "federal",
          debt: { principal: 10_000_000 },
          countryId: "US",
          creditRating: "BBB",
        },
      ])
    );
    db.collectionMocks.centralBanks = db.collection("centralBanks");
    db.collectionMocks.centralBanks.find.mockReturnValue(
      makeCursor([{ _id: getBankId("US"), primeRate: 5 }])
    );
    db.collectionMocks.corporations = db.collection("corporations");
    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.corporations.findOne.mockResolvedValue(null);
    db.collectionMocks.bonds = db.collection("bonds");
    db.collectionMocks.bonds.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.bonds.insertMany.mockImplementation(async (docs: unknown[]) => {
      inserted.push(
        ...docs.map((doc) => {
          const { countryId, maturityTurns, couponRate } = doc as (typeof inserted)[number];
          return { countryId, maturityTurns, couponRate };
        })
      );
      return { insertedCount: docs.length };
    });

    await seedSovereignBondInstruments(db as unknown as Db, () => {}, 0, new Date());

    // Opening debt is spread over quarterly cohorts per tenor, so assert the
    // credit-tier coupon per tenor rather than one tranche per tenor.
    const couponByTenor = new Map<number, Set<number>>();
    for (const bond of inserted) {
      const set = couponByTenor.get(bond.maturityTurns) ?? new Set<number>();
      set.add(bond.couponRate);
      couponByTenor.set(bond.maturityTurns, set);
    }
    expect(
      [...couponByTenor.entries()].sort((a, b) => a[0] - b[0]).map(([t, c]) => [t, [...c]])
    ).toEqual([
      [48, [8]],
      [96, [8.25]],
      [240, [8.75]],
    ]);
  });
});

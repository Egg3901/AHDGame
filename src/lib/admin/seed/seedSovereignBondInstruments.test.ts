import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { getBankId } from "@/lib/centralBank/helpers";
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
    expect(result.bondsInserted).toBe(6); // 3 tranches × 2 countries
    expect(result.totalFaceIssued).toBeGreaterThan(0);

    // Budget must not be rewritten — principal stays the scalar SSOT; bonds are
    // instruments layered on top (matches reconcile-sovereign route docs).
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.federalBudget.updateMany).not.toHaveBeenCalled();

    const usBonds = inserted.filter((b) => (b as { countryId: string }).countryId === "US");
    const ukBonds = inserted.filter((b) => (b as { countryId: string }).countryId === "UK");
    expect(usBonds).toHaveLength(3);
    expect(ukBonds).toHaveLength(3);

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
    // Floor to bond units; distribution leave a small remainder unissued.
    expect(usFace).toBeLessThanOrEqual(275_000_000_000);
    expect(usFace).toBeGreaterThan(275_000_000_000 - BOND_UNIT_FACE_VALUE * 3);

    for (const bond of inserted) {
      const b = bond as {
        issuerType: string;
        reconcile: boolean;
        matured: boolean;
        holders: unknown[];
        maturityTurns: number;
      };
      expect(b.issuerType).toBe("sovereign");
      expect(b.reconcile).toBe(true);
      expect(b.matured).toBe(false);
      expect(b.holders).toEqual([]);
    }
    expect(
      usBonds.map((b) => (b as { maturityTurns: number }).maturityTurns).sort((a, b) => a - b)
    ).toEqual([48, 96, 240]);
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
});

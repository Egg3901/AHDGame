import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types/indexFund";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { resolveFundMandate } from "./mandate";
import { legacyIndexMandate, type IndexMandate } from "./rules/mandate";
import { getAllFundDefinitions } from "./fundDefinitions";
import { buildIndexFundTargetConstituents, type IndexFundCandidate } from "./constituents";
import { insertFund } from "./fundQueries";
import { migration } from "@/lib/migrations/entries/2026-10-12-fund-mandates";

const fund: IndexFund = {
  _id: new ObjectId(),
  slug: "sponsored-test",
  name: "Test fund",
  tickerSymbol: "TEST",
  scope: "country",
  kind: "broad",
  countryId: "US",
  anchorCurrencyCode: "USD",
  status: "active",
  cashAnchor: 10_000,
  quotedNav: 100,
  unitSupply: 100,
  reserveUnits: 0,
  holdings: [],
  targetConstituents: [],
  sponsorCorporationId: new ObjectId(),
  createdAt: new Date(),
  updatedAt: new Date(),
};
function candidate(countryId: "US" | "UK", type: "technology" | "financial"): IndexFundCandidate {
  return {
    _id: new ObjectId(),
    countryId,
    type,
    sharePrice: 100,
    totalShares: 100,
    publicFloat: 30,
    liquidCapital: 100,
    liquidCurrencyCode: "USD",
  } as IndexFundCandidate;
}
const candidates = [
  candidate("US", "technology"),
  candidate("US", "financial"),
  candidate("UK", "technology"),
];
function select(book: IndexFund) {
  return buildIndexFundTargetConstituents({
    corporations: candidates,
    definition: resolveFundMandate(book),
    exchangeRates: { USD: 1, GBP: 1 },
  }).constituents;
}

describe("stored fund mandates", () => {
  it("repairs custom broad and sector slugs from stored country and industry", () => {
    expect(select(fund).map((target) => String(target.corporationId))).toEqual(
      candidates.slice(0, 2).map((corp) => String(corp._id))
    );
    const sector = select({
      ...fund,
      scope: "global",
      countryId: undefined,
      kind: "sector",
      sectorType: "technology",
    });
    expect(sector.map((target) => String(target.corporationId))).toEqual(
      [candidates[0], candidates[2]].map((corp) => String(corp._id))
    );
    expect(sector.some((target) => target.corporationId.equals(candidates[1]._id))).toBe(false);
  });

  it("honors the stored policy independently of a predefined slug", () => {
    const mandate: IndexMandate = {
      ...legacyIndexMandate(fund),
      scope: "global",
      countryId: undefined,
      topN: 1,
    };
    const selected = select({ ...fund, slug: "us_top_25", mandate });
    expect(selected).toHaveLength(1);
    expect(resolveFundMandate({ ...fund, mandate })).toBe(mandate);
  });

  it("preserves every predefined Top N and bond universe at migration", () => {
    for (const definition of getAllFundDefinitions()) {
      const policy = resolveFundMandate({ ...fund, ...definition });
      expect(policy.topN).toBe(definition.topN);
      expect(policy.bondUniverse).toEqual(definition.bondUniverse);
      expect(policy.scope).toBe(definition.scope);
      expect(policy.kind).toBe(definition.kind);
    }
    expect(
      resolveFundMandate({ ...fund, slug: "new-sovereign-fund", kind: "bond" }).bondUniverse
    ).toEqual({ issuerType: "sovereign", homeOnly: true });
  });

  it("persists new policies at insertion and migrates legacy books without changing economic claims", async () => {
    const memory = createInMemoryDb();
    const legacy = { ...fund, legacyMarker: "keep" };
    memory.seed("indexFunds", [legacy]);
    memory.seed("indexFundPositions", [
      { _id: new ObjectId(), fundId: fund._id, units: 7.5, legacyUnits: 2.5 },
    ]);
    memory.seed("indexFundRedemptionQueue", [
      { _id: new ObjectId(), fundId: fund._id, units: 3, redeemFxRate: 2.3 },
    ]);
    const economicClaims = BSONSnapshot(
      memory.collection("indexFundPositions").docs,
      memory.collection("indexFundRedemptionQueue").docs
    );
    const db = memory as unknown as Db;
    await migration.execute(db, { dryRun: true });
    expect(memory.collection("indexFunds").docs[0]).toEqual(legacy);
    expect((await migration.execute(db, { dryRun: false })).documentsUpdated).toBe(1);
    const book = memory.collection("indexFunds").docs[0];
    expect(book).toEqual({
      ...legacy,
      mandate: resolveFundMandate(fund),
      seedAccounting: "legacy_residual",
    });
    expect((await migration.execute(db, { dryRun: false })).documentsUpdated).toBe(0);
    expect(
      BSONSnapshot(
        memory.collection("indexFundPositions").docs,
        memory.collection("indexFundRedemptionQueue").docs
      )
    ).toBe(economicClaims);
    const { _id: unused, ...newFund } = {
      ...fund,
      slug: "another-fund",
      sponsorCorporationId: undefined,
    };
    void unused;
    await insertFund(db, newFund);
    expect(memory.collection("indexFunds").docs[1].mandate).toEqual(resolveFundMandate(newFund));
  });
});
function BSONSnapshot(...values: unknown[]) {
  return JSON.stringify(values);
}

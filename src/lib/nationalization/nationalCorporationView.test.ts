import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Corporation } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("./investorConfidence", () => ({ readInvestorConfidence: vi.fn().mockResolvedValue(70) }));
vi.mock("./authority", () => ({ assertTreasuryAuthority: vi.fn().mockResolvedValue(true) }));
vi.mock("./ledger", () => ({
  getNationalizationLedger: vi.fn().mockResolvedValue([]),
  getCountryNationalizationLedger: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/governorOffice/isSittingLeader", () => ({
  isSittingLeader: vi.fn().mockResolvedValue(false),
}));
vi.mock("./strategicSectors", () => ({
  getDesignatedSectorTypes: vi.fn().mockResolvedValue(new Set<string>(["energy"])),
}));

/**
 * `infrastructure.utilities` is the family `infrastructure.powerGridReliability`
 * maps onto, so it is what the energy sector's mandate-metric bar reads.
 */
const CA_BOARD = {
  "governance.integrity": 80,
  "governance.openness": 80,
  "infrastructure.utilities": 72,
};

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("buildNationalCorporationView", () => {
  let db: MockDb;
  const corpId = new ObjectId();

  const corp = {
    _id: corpId,
    name: "United States National Corporation",
    countryId: "US",
    countryOwnerId: "US",
    ownershipState: "stateOwned",
    isPrimaryNationalCorporation: true,
    assignedSectorTypes: [],
    ceoVacant: true,
    liquidCurrencyCode: "USD",
  } as unknown as Corporation;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of [
      "corporateSectors",
      "macroMetrics",
      "politicalMetrics",
      "bonds",
      "federalBudget",
      "characters",
    ])
      db.collection(n);
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: corpId,
          stateId: "US-CA",
          sectorType: "energy",
          revenue: 1_000_000,
          workers: 500,
          profitMargin: 30,
          soeMandate: { priceControlled: true, employmentGuaranteed: true },
        },
        {
          _id: new ObjectId(),
          corporationId: corpId,
          stateId: "US-TX",
          sectorType: "healthcare",
          revenue: 500_000,
          workers: 300,
          profitMargin: 20,
        },
      ])
    );
    // Both halves of the view's region read. The macro docs make the merged
    // legacy doc exist; the boards carry everything this test asserts on —
    // efficiency inputs (corruption = 100 - integrity, transparency = openness)
    // and the mandate-metric LEVEL, which is the board projected back to legacy
    // shape rather than a stored legacy value.
    db.collectionMocks.macroMetrics.find.mockReturnValue(
      cursor([{ _id: "US-CA" }, { _id: "US-TX" }])
    );
    db.collectionMocks.politicalMetrics.find.mockReturnValue(
      cursor([
        { _id: "US-CA", values: CA_BOARD },
        {
          _id: "US-TX",
          values: { "governance.integrity": 60, "governance.openness": 60 },
        },
      ])
    );
    db.collectionMocks.bonds.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: corpId,
          totalIssued: 250_000,
          couponRate: 5,
          currencyCode: "USD",
          matured: false,
        },
      ])
    );
  });

  it("aggregates holdings by region with efficiency breakdown + headline stats", async () => {
    const { buildNationalCorporationView } = await import("./nationalCorporationView");
    const vm = await buildNationalCorporationView(db as unknown as Db, corp, new ObjectId());

    expect(vm.countryId).toBe("US");
    expect(vm.isPrimary).toBe(true);
    expect(vm.currency).toBe("USD");
    expect(vm.viewerIsOfficial).toBe(true);
    expect(vm.viewerHasTreasuryAuthority).toBe(true);
    expect(vm.viewerIsHeadOfGovernment).toBe(false);
    expect(vm.designatedStrategicSectorTypes).toContain("energy");
    expect(vm.holdingsByRegion).toHaveLength(2);

    const ca = vm.holdingsByRegion.find((r) => r.stateId === "US-CA")!;
    expect(ca.sectors[0].priceControlled).toBe(true);
    // Efficiency breakdown present + total within the clamp.
    expect(ca.sectors[0].efficiency.base).toBeLessThan(0);
    expect(ca.sectors[0].efficiency.total).toBeLessThanOrEqual(-5);
    expect(ca.sectors[0].efficiency.total).toBeGreaterThanOrEqual(-25);

    // Holdings-card data: metric bar level, public value, mapped label, acquisition.
    // The bar shows the board projected back into legacy units, so the expected
    // number comes from the projection rather than being written by hand — but
    // it must be a real number, which is the regression this guards: reading the
    // retired legacy store here rendered every mandate metric as no-data.
    const { legacyPoliticalHalfFromBoard } =
      await import("@/lib/politicalLegislation/legacyProjection");
    const expectedLevel = (
      legacyPoliticalHalfFromBoard(CA_BOARD as never)!.infrastructure as Record<
        string,
        { value: number }
      >
    ).powerGridReliability.value;
    expect(expectedLevel).toBeTypeOf("number");
    // The bar rounds to a whole number for display.
    expect(ca.sectors[0].sectorMetricLevel).toBe(Math.round(expectedLevel));
    expect(ca.sectors[0].mappedMetricLabels).toEqual(["Power Grid Reliability"]);
    expect(ca.sectors[0].publicValuePerTurn).toBeGreaterThan(0);
    expect(typeof ca.sectors[0].marketSharePercent).toBe("number");
    // No ledger entry for the seeded/founding fixture → founding charter.
    expect(ca.sectors[0].acquisitionTrigger).toBe("Founding charter");

    expect(vm.stats.citizensServed).toBe(800);
    expect(vm.stats.jobsGuaranteed).toBe(500); // only the employment-guaranteed energy sector
    expect(vm.stats.investorConfidence).toBe(70);
    expect(vm.stats.publicValueIndex).toBeGreaterThanOrEqual(1);
    expect(vm.stats.treasuryRemittancePerTurn).toBeGreaterThan(0);
    expect(vm.stats.regionsCovered).toBe(2); // US-CA + US-TX
    expect(vm.stats.confidenceBaseline).toBe(70);
    expect(vm.stats.confidenceTrendPerTurn).toBe(0); // confidence (70) == baseline → no heal

    expect(vm.assumedBonds).toHaveLength(1);
    expect(vm.assumedBonds[0].principal).toBe(250_000);
    expect(vm.mandates).toHaveLength(2);
  });

  it("operatingProfit follows effectiveProfitMargin, not the stale seeded margin (ticket #1072)", async () => {
    // A low seeded profitMargin that, minus the SOE efficiency penalty, floors to
    // 0 under the old code — but the sector actually operated at 25% last turn.
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          corporationId: corpId,
          stateId: "US-CA",
          sectorType: "energy",
          revenue: 1_000_000,
          workers: 500,
          profitMargin: 5,
          effectiveProfitMargin: 25,
          soeMandate: { priceControlled: true, employmentGuaranteed: true },
        },
      ])
    );

    const { buildNationalCorporationView } = await import("./nationalCorporationView");
    const vm = await buildNationalCorporationView(db as unknown as Db, corp, new ObjectId());

    const sector = vm.holdingsByRegion.find((r) => r.stateId === "US-CA")!.sectors[0];
    // 1,000,000 × 25% = 250,000 — the operated margin, NOT max(0, 5 + penalty) = 0.
    expect(sector.operatingProfit).toBe(250_000);
    expect(vm.stats.treasuryRemittancePerTurn).toBeGreaterThan(0);
  });

  it("exposes all country regions (alphabetical) for the IPO HQ selector", async () => {
    db.collection("states");
    // The states.find mock also serves the view-model's market-share path, so the
    // docs carry countryId + gdp (not just _id/name) to keep that branch happy.
    db.collectionMocks.states.find.mockReturnValue(
      cursor([
        { _id: "US-TX", name: "Texas", countryId: "US", gdp: 1_000_000 },
        { _id: "US-CA", name: "California", countryId: "US", gdp: 1_000_000 },
      ])
    );
    const { buildNationalCorporationView } = await import("./nationalCorporationView");
    const vm = await buildNationalCorporationView(db as unknown as Db, corp, new ObjectId());
    expect(vm.countryRegions).toEqual([
      { stateId: "US-CA", stateName: "California" },
      { stateId: "US-TX", stateName: "Texas" },
    ]);
  });

  it("exposes corp-default mandate, per-sector override flags, and CEO info", async () => {
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: new ObjectId(),
      name: "Jane Director",
    });
    const corpWithDefault = {
      ...corp,
      ceoVacant: false,
      ceoId: new ObjectId(),
      soeMandate: { priceControlled: true, employmentGuaranteed: false },
    } as unknown as Corporation;

    const { buildNationalCorporationView } = await import("./nationalCorporationView");
    const vm = await buildNationalCorporationView(
      db as unknown as Db,
      corpWithDefault,
      new ObjectId()
    );

    expect(vm.corpMandate).toEqual({ priceControlled: true, employmentGuaranteed: false });
    expect(vm.ceo.vacant).toBe(false);
    expect(vm.ceo.name).toBe("Jane Director");

    // CA sector has its own soeMandate (override); TX has none (inherits).
    const ca = vm.mandates.find((m) => m.stateId === "US-CA")!;
    const tx = vm.mandates.find((m) => m.stateId === "US-TX")!;
    expect(ca.isOverride).toBe(true);
    expect(ca.sectorId).toBeTruthy();
    expect(tx.isOverride).toBe(false);

    // Design-card data: mapped metric (human label), public value, efficiency, profit/turn.
    expect(ca.mappedMetrics).toEqual(["Power Grid Reliability"]); // energy
    expect(tx.mappedMetrics).toEqual(["Physicians Per Capita"]); // healthcare
    // CA is price-controlled (×1.5 boost) at full state-sector share → > 0.
    expect(ca.publicValuePerTurn).toBeGreaterThan(0);
    // CA's price-control boost makes its uplift exceed the un-boosted base it would
    // have at the same share without price control.
    expect(ca.efficiencyPct).toBeLessThan(0); // SOE margin drag is negative
    expect(typeof ca.profitPerTurn).toBe("number");
  });

  it("derives gross revenue, mandate subsidy, employment counts, mandate metrics, and a founding-charter acquisition fallback", async () => {
    const { buildNationalCorporationView } = await import("./nationalCorporationView");
    const vm = await buildNationalCorporationView(db as unknown as Db, corp, new ObjectId());

    expect(vm.stats.grossRevenuePerTurn).toBe(1_500_000); // 1M energy + 500k healthcare
    expect(vm.stats.sectorCount).toBe(2);
    expect(vm.stats.priceControlledSectorCount).toBe(1); // only the energy sector
    // Energy is price-controlled → a non-zero treasury subsidy for the margin drag.
    expect(vm.stats.mandateSubsidyPerTurn).toBeGreaterThan(0);

    // energy → power-grid reliability, healthcare → physician rate (one sector each).
    expect(vm.mandateMetrics).toHaveLength(2);
    for (const m of vm.mandateMetrics) expect(m.sectorCount).toBe(1);

    // No ledger rows → all held sectors attributed to the founding charter.
    expect(vm.acquisitions).toEqual([
      { trigger: "founding", label: "Founding charter", sectorCount: 2 },
    ]);
  });

  it("groups the acquisition register by trigger", async () => {
    const { getNationalizationLedger } = await import("./ledger");
    vi.mocked(getNationalizationLedger).mockResolvedValueOnce([
      { triggers: ["distress"], sectorTypes: ["energy"] },
      { triggers: ["strategic"], sectorTypes: ["healthcare", "technology"] },
    ] as never);

    const { buildNationalCorporationView } = await import("./nationalCorporationView");
    const vm = await buildNationalCorporationView(db as unknown as Db, corp, new ObjectId());

    const byLabel = Object.fromEntries(vm.acquisitions.map((a) => [a.label, a.sectorCount]));
    expect(byLabel["Financial distress"]).toBe(1);
    expect(byLabel["Strategic sector"]).toBe(2);
    // Ledger sector total (3) ≥ held sectors (2) → no founding-charter remainder row.
    expect(byLabel["Founding charter"]).toBeUndefined();
  });

  it("exposes the country-wide register (across all NatCorps), not just this corp's ledger", async () => {
    const { getCountryNationalizationLedger } = await import("./ledger");
    // A row routed into a SIBLING split-off NatCorp (different id) must still appear.
    vi.mocked(getCountryNationalizationLedger).mockResolvedValueOnce([
      { nationalCorporationId: new ObjectId(), countryId: "US", turn: 30, kind: "privatize" },
      { nationalCorporationId: corpId, countryId: "US", turn: 12, kind: "nationalize_sector" },
    ] as never);

    const { buildNationalCorporationView } = await import("./nationalCorporationView");
    const vm = await buildNationalCorporationView(db as unknown as Db, corp, new ObjectId());

    expect(vi.mocked(getCountryNationalizationLedger)).toHaveBeenCalledWith(db, "US");
    expect(vm.countryLedger).toHaveLength(2);
    expect(vm.countryLedger[0].turn).toBe(30);

    // Display-ready register + confidence feeds are derived from the country ledger.
    expect(vm.register.rows).toHaveLength(2);
    expect(vm.register.totals.firmsAbsorbed).toBe(0); // neither fixture is a whole-corp taking
    expect(vm.confidenceFeeds).toHaveLength(3);
    expect(vm.register.standing).toHaveProperty("ideologyStance");
  });

  it("viewerIsOfficial is false for an anonymous viewer", async () => {
    const { buildNationalCorporationView } = await import("./nationalCorporationView");
    const { assertTreasuryAuthority } = await import("./authority");
    const vm = await buildNationalCorporationView(db as unknown as Db, corp, null);
    expect(vm.viewerIsOfficial).toBe(false);
    expect(vm.viewerHasTreasuryAuthority).toBe(false);
    expect(vm.viewerIsHeadOfGovernment).toBe(false);
    expect(vi.mocked(assertTreasuryAuthority)).not.toHaveBeenCalled();
  });

  it("exposes viewerIsCeo + CEO/ministry finance config", async () => {
    const ceoId = new ObjectId();
    const corpWithCeo = {
      ...corp,
      ceoVacant: false,
      ceoId,
      profitRetentionPercent: 40,
      treasuryDrawCap: 5_000_000,
    } as unknown as Corporation;
    db.collectionMocks.characters.findOne.mockResolvedValue({ _id: ceoId, name: "Danica" });

    const { buildNationalCorporationView } = await import("./nationalCorporationView");
    const asCeo = await buildNationalCorporationView(db as unknown as Db, corpWithCeo, ceoId);
    const asOther = await buildNationalCorporationView(
      db as unknown as Db,
      corpWithCeo,
      new ObjectId()
    );

    expect(asCeo.viewerIsCeo).toBe(true);
    expect(asOther.viewerIsCeo).toBe(false);
    expect(asCeo.finance.profitRetentionPercent).toBe(40);
    expect(asCeo.finance.treasuryDrawCap).toBe(5_000_000);
  });
});

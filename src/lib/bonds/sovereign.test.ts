import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types/budget";
import type { Bond } from "@/lib/db/types/bond";
import { generateCountryOwnedSeedData } from "@/lib/seeds/reference/budgets";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  applySovereignDebtAdjustment,
  calculateQuarterlyIssuanceAmount,
  calculateSovereignRolloverAmount,
  getSovereignCouponRate,
  getNationalBudgetId,
  getSovereignIssuerName,
  issueScheduledSovereignBondSeries,
  reconcileSovereignDebt,
  SOVEREIGN_BOND_TERM_PREMIUMS,
  shouldIssueQuarterlySovereignBondSeries,
  SOVEREIGN_ISSUANCE_INTERVAL_TURNS,
} from "./sovereign";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";

describe("shouldIssueQuarterlySovereignBondSeries", () => {
  it("issues every 12 turns", () => {
    expect(shouldIssueQuarterlySovereignBondSeries(12)).toBe(true);
    expect(shouldIssueQuarterlySovereignBondSeries(24)).toBe(true);
    expect(shouldIssueQuarterlySovereignBondSeries(11)).toBe(false);
    expect(shouldIssueQuarterlySovereignBondSeries(13)).toBe(false);
  });
});

describe("applySovereignDebtAdjustment", () => {
  const baseBudget: FederalBudget = {
    _id: "federal",
    countryId: COUNTRY_CONFIGS.US.id,
    fiscalYear: 2024,
    revenue: {
      incomeTax: 2_100_000_000_000,
      domesticCorporateTax: 337_500_000_000,
      foreignCorporateTax: 112_500_000_000,
      payrollTax: 1_300_000_000_000,
      tariffs: 150_000_000_000,
      salesTax: 0,
      healthcareIncome: 0,
      other: 200_000_000_000,
      total: 4_200_000_000_000,
    },
    taxRates: {
      incomeTax: 22,
      domesticCorporateTax: 21,
      foreignCorporateTax: 21,
      payrollTax: 15.3,
      tariffs: 3,
      salesTax: 0,
    },
    taxBases: {
      taxableIncome: 9_550_000_000_000,
      domesticCorporateProfits: 1_612_500_000_000,
      foreignCorporateProfits: 537_500_000_000,
      wagesAndSalaries: 8_500_000_000_000,
      importValue: 5_000_000_000_000,
      taxableSales: 15_000_000_000_000,
    },
    economicFactors: {
      gdpGrowth: 2.5,
      wageGrowth: 3,
      inflationRate: 2.5,
      tradeGrowth: 2,
      lastUpdated: new Date(),
    },
    spending: {
      byCategory: {
        healthcare: 1_200_000_000_000,
      },
      stateGrants: 600_000_000_000,
      debtInterest: 600_000_000_000,
      total: 5_100_000_000_000,
    },
    debt: {
      principal: 28_500_000_000_000,
      interestRate: 0.025,
      ceiling: 31_400_000_000_000,
      ceilingLastRaisedYear: 2023,
    },
    treasuryBalance: -28_500_000_000_000,
    surplus: -900_000_000_000,
    gdp: 27_000_000_000_000,
    debtToGdpRatio: 1.05,
    creditRating: "AA",
    currencyCode: "USD",
    updatedAt: new Date(),
  };

  it("raises principal and annual debt service when sovereign debt is issued", () => {
    const updated = applySovereignDebtAdjustment(baseBudget, 125_000_000_000, 6_250_000_000);

    expect(updated.debt.principal).toBe(28_625_000_000_000);
    expect(updated.spending.debtInterest).toBe(606_250_000_000);
    expect(updated.spending.total).toBe(5_106_250_000_000);
    expect(updated.surplus).toBe(-906_250_000_000);
    expect(updated.debtToGdpRatio).toBeCloseTo(28_625_000_000_000 / 27_000_000_000_000, 10);
  });

  it("uses the SMOOTHED national GDP for the debt ratio so a one-year swing can't trip a default (§6.1)", () => {
    // raw gdp dips to 20e12 (transient regional noise) while smoothed holds at 27e12
    const spiked = { ...baseBudget, gdp: 20_000_000_000_000, gdpSmoothed: 27_000_000_000_000 };
    const updated = applySovereignDebtAdjustment(spiked, 0, 0);
    // ratio reads the smoothed 27e12, not the raw 20e12 — the dip doesn't inflate debt-to-GDP
    expect(updated.debtToGdpRatio).toBeCloseTo(28_500_000_000_000 / 27_000_000_000_000, 10);
  });

  it("falls back to raw gdp when no smoothed value is present (cutover safety)", () => {
    const updated = applySovereignDebtAdjustment(baseBudget, 0, 0); // no gdpSmoothed on baseBudget
    expect(updated.debtToGdpRatio).toBeCloseTo(28_500_000_000_000 / 27_000_000_000_000, 10);
  });

  it("reduces principal and annual debt service when sovereign debt matures", () => {
    const updated = applySovereignDebtAdjustment(baseBudget, -125_000_000_000, -6_250_000_000);

    expect(updated.debt.principal).toBe(28_375_000_000_000);
    expect(updated.spending.debtInterest).toBe(593_750_000_000);
    expect(updated.spending.total).toBe(5_093_750_000_000);
    expect(updated.surplus).toBe(-893_750_000_000);
  });
});

describe("calculateQuarterlyIssuanceAmount", () => {
  it("returns one quarter of the annual deficit rounded to bond units", () => {
    expect(calculateQuarterlyIssuanceAmount(500_000_000_000)).toBe(125_000_000_000);
  });

  it("returns zero for surpluses or zero deficits", () => {
    expect(calculateQuarterlyIssuanceAmount(0)).toBe(0);
    expect(calculateQuarterlyIssuanceAmount(-100_000_000)).toBe(0);
  });
});

describe("calculateSovereignRolloverAmount", () => {
  const ISSUANCE_TURN = 216;
  const WINDOW_END = ISSUANCE_TURN + SOVEREIGN_ISSUANCE_INTERVAL_TURNS; // 228

  function makeBond(overrides: Partial<Bond>): Bond {
    return {
      _id: "x" as unknown as Bond["_id"],
      issuerType: "sovereign",
      corporationId: "c" as unknown as Bond["corporationId"],
      countryId: COUNTRY_CONFIGS.US.id,
      issuerName: "United States",
      faceValue: 1000,
      couponRate: 3.5,
      maturityTurns: 48,
      issuedAtTurn: 168,
      maturityTurn: 216,
      marketPrice: 1,
      totalIssued: 0,
      publicFloat: 0,
      holders: [],
      defaulted: false,
      defaultedAtTurn: null,
      matured: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function setBondsForQuery(bonds: Bond[]) {
    const db = createMockDb();
    db.collectionMocks["bonds"] = db.collection("bonds") as ReturnType<typeof db.collection>;
    db.collectionMocks["bonds"]!.find.mockImplementation((query: Record<string, unknown>) => {
      const maturityTurn = query.maturityTurn as { $gte: number; $lt: number } | undefined;
      const matched = bonds.filter((bond) => {
        if (query.issuerType && bond.issuerType !== query.issuerType) return false;
        if (query.countryId && bond.countryId !== query.countryId) return false;
        if (query.matured !== undefined && bond.matured !== query.matured) return false;
        if (query.defaulted !== undefined && bond.defaulted !== query.defaulted) return false;
        if (maturityTurn) {
          if (bond.maturityTurn < maturityTurn.$gte) return false;
          if (bond.maturityTurn >= maturityTurn.$lt) return false;
        }
        return true;
      });
      return { toArray: async () => matched };
    });
    return db;
  }

  it("returns 0 when no matching bonds exist", async () => {
    const db = setBondsForQuery([]);
    const total = await calculateSovereignRolloverAmount(
      db as unknown as Db,
      COUNTRY_CONFIGS.US.id,
      ISSUANCE_TURN
    );
    expect(total).toBe(0);
  });

  it("sums totalIssued of bonds maturing in [turn, turn + interval)", async () => {
    const db = setBondsForQuery([
      makeBond({ maturityTurn: ISSUANCE_TURN, totalIssued: 10_000_000_000 }),
      makeBond({ maturityTurn: ISSUANCE_TURN + 5, totalIssued: 5_000_000_000 }),
      makeBond({ maturityTurn: WINDOW_END - 1, totalIssued: 3_000_000_000 }),
    ]);
    const total = await calculateSovereignRolloverAmount(
      db as unknown as Db,
      COUNTRY_CONFIGS.US.id,
      ISSUANCE_TURN
    );
    expect(total).toBe(18_000_000_000);
  });

  it("excludes bonds maturing at or after turn + interval", async () => {
    const db = setBondsForQuery([
      makeBond({ maturityTurn: WINDOW_END, totalIssued: 10_000_000_000 }),
      makeBond({ maturityTurn: WINDOW_END + 12, totalIssued: 10_000_000_000 }),
    ]);
    const total = await calculateSovereignRolloverAmount(
      db as unknown as Db,
      COUNTRY_CONFIGS.US.id,
      ISSUANCE_TURN
    );
    expect(total).toBe(0);
  });

  it("excludes already-matured and defaulted bonds", async () => {
    const db = setBondsForQuery([
      makeBond({ maturityTurn: ISSUANCE_TURN, totalIssued: 10_000_000_000, matured: true }),
      makeBond({ maturityTurn: ISSUANCE_TURN, totalIssued: 10_000_000_000, defaulted: true }),
    ]);
    const total = await calculateSovereignRolloverAmount(
      db as unknown as Db,
      COUNTRY_CONFIGS.US.id,
      ISSUANCE_TURN
    );
    expect(total).toBe(0);
  });

  it("rounds the rollover total down to whole bond units ($1,000 each)", async () => {
    const db = setBondsForQuery([
      makeBond({ maturityTurn: ISSUANCE_TURN, totalIssued: 1_234_567 }),
    ]);
    const total = await calculateSovereignRolloverAmount(
      db as unknown as Db,
      COUNTRY_CONFIGS.US.id,
      ISSUANCE_TURN
    );
    expect(total).toBe(1_234_000);
  });
});

describe("getSovereignCouponRate", () => {
  it("returns prime rate for 1yr (48t) with no term premium", () => {
    expect(getSovereignCouponRate(5.5, 48)).toBe(5.5);
    expect(SOVEREIGN_BOND_TERM_PREMIUMS[48]).toBe(0);
  });

  it("adds 0.25pp term premium for 2yr (96t) notes", () => {
    expect(getSovereignCouponRate(5.5, 96)).toBe(5.75);
  });

  it("adds 0.75pp term premium for 5yr (240t) bonds", () => {
    expect(getSovereignCouponRate(5.5, 240)).toBe(6.25);
  });

  it("rounds to 2 decimal places", () => {
    // 3.1 + 0.25 = 3.35 — exact, but guard against floating-point drift
    expect(getSovereignCouponRate(3.1, 96)).toBe(3.35);
  });

  it("prices an unchanged coupon when no credibility spread is supplied", () => {
    expect(getSovereignCouponRate(5.5, 96, 0)).toBe(getSovereignCouponRate(5.5, 96));
  });

  it("adds the B4 credibility spread on top of the term premium", () => {
    expect(getSovereignCouponRate(5.5, 96, 1.5)).toBe(7.25);
  });

  it("ignores a negative or non-finite spread rather than discounting the coupon", () => {
    expect(getSovereignCouponRate(5.5, 48, -2)).toBe(5.5);
    expect(getSovereignCouponRate(5.5, 48, NaN)).toBe(5.5);
  });
});

describe("reconcileSovereignDebt", () => {
  const baseBudget: FederalBudget = {
    _id: "federal",
    countryId: COUNTRY_CONFIGS.US.id,
    fiscalYear: 2024,
    revenue: {
      incomeTax: 2_100_000_000_000,
      domesticCorporateTax: 337_500_000_000,
      foreignCorporateTax: 112_500_000_000,
      payrollTax: 1_300_000_000_000,
      tariffs: 150_000_000_000,
      salesTax: 0,
      healthcareIncome: 0,
      other: 200_000_000_000,
      total: 4_200_000_000_000,
    },
    taxRates: {
      incomeTax: 22,
      domesticCorporateTax: 21,
      foreignCorporateTax: 21,
      payrollTax: 15.3,
      tariffs: 3,
      salesTax: 0,
    },
    taxBases: {
      taxableIncome: 9_550_000_000_000,
      domesticCorporateProfits: 1_612_500_000_000,
      foreignCorporateProfits: 537_500_000_000,
      wagesAndSalaries: 8_500_000_000_000,
      importValue: 5_000_000_000_000,
      taxableSales: 15_000_000_000_000,
    },
    economicFactors: {
      gdpGrowth: 2.5,
      wageGrowth: 3,
      inflationRate: 2.5,
      tradeGrowth: 2,
      lastUpdated: new Date(),
    },
    spending: {
      byCategory: { healthcare: 1_200_000_000_000 },
      stateGrants: 600_000_000_000,
      debtInterest: 600_000_000_000,
      total: 5_100_000_000_000,
    },
    debt: {
      principal: 10_000_000_000, // $10B total principal
      interestRate: 0.025,
      ceiling: 20_000_000_000,
      ceilingLastRaisedYear: 2023,
    },
    treasuryBalance: -10_000_000_000,
    surplus: -900_000_000_000,
    gdp: 27_000_000_000_000,
    debtToGdpRatio: 1.05,
    creditRating: "AA",
    currencyCode: "USD",
    updatedAt: new Date(),
  };

  function buildMockDb(existingBondTotal: number, budgetOverride?: Partial<FederalBudget>) {
    const db = createMockDb();
    const budget = { ...baseBudget, ...budgetOverride };

    db.collectionMocks["federalBudget"] = db.collection("federalBudget") as ReturnType<
      typeof db.collection
    >;
    db.collectionMocks["federalBudget"]!.findOne.mockResolvedValue(budget);
    db.collectionMocks["federalBudget"]!.updateOne.mockResolvedValue({ modifiedCount: 1 });

    db.collectionMocks["centralBanks"] = db.collection("centralBanks") as ReturnType<
      typeof db.collection
    >;
    db.collectionMocks["centralBanks"]!.findOne.mockResolvedValue({ primeRate: 5.0 });

    db.collectionMocks["corporations"] = db.collection("corporations") as ReturnType<
      typeof db.collection
    >;
    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(null);

    db.collectionMocks["bonds"] = db.collection("bonds") as ReturnType<typeof db.collection>;
    // find returns existing bonds covering existingBondTotal
    const existingBond =
      existingBondTotal > 0
        ? [{ issuerType: "sovereign", countryId: "US", totalIssued: existingBondTotal }]
        : [];
    db.collectionMocks["bonds"]!.find.mockReturnValue({ toArray: async () => existingBond });
    db.collectionMocks["bonds"]!.insertOne.mockImplementation(async () => ({
      insertedId: { toString: () => "mock-id" },
    }));

    return db;
  }

  it("returns null when no budget is found", async () => {
    const db = buildMockDb(0);
    db.collectionMocks["federalBudget"]!.findOne.mockResolvedValue(null);
    const result = await reconcileSovereignDebt(db as unknown as Db, {
      countryId: COUNTRY_CONFIGS.US.id,
      turn: 240,
      now: new Date(),
    });
    expect(result).toBeNull();
  });

  it("returns zero-issued result when existing bonds already cover full principal", async () => {
    const db = buildMockDb(10_000_000_000); // covers full $10B
    const result = await reconcileSovereignDebt(db as unknown as Db, {
      countryId: COUNTRY_CONFIGS.US.id,
      turn: 240,
      now: new Date(),
    });
    expect(result).not.toBeNull();
    expect(result!.gap).toBe(0);
    expect(result!.tranches).toHaveLength(0);
    expect(result!.totalIssued).toBe(0);
    expect(result!.budgetInterestDelta).toBe(0);
  });

  it("issues staggered tranches for the uncovered gap", async () => {
    // $4B covered by existing bonds, $6B gap to fill
    const db = buildMockDb(4_000_000_000);
    const result = await reconcileSovereignDebt(db as unknown as Db, {
      countryId: COUNTRY_CONFIGS.US.id,
      turn: 240,
      now: new Date(),
    });
    expect(result).not.toBeNull();
    expect(result!.gap).toBe(6_000_000_000);
    // default distribution: 25% 1yr / 35% 2yr / 40% 5yr
    expect(result!.tranches).toHaveLength(3);
    const maturities = result!.tranches.map((t) => t.maturityTurns).sort((a, b) => a - b);
    expect(maturities).toEqual([48, 96, 240]);
  });

  it("applies term premiums to each tranche yield", async () => {
    const db = buildMockDb(0); // $10B gap
    const result = await reconcileSovereignDebt(db as unknown as Db, {
      countryId: COUNTRY_CONFIGS.US.id,
      turn: 240,
      now: new Date(),
    });
    const t48 = result!.tranches.find((t) => t.maturityTurns === 48)!;
    const t96 = result!.tranches.find((t) => t.maturityTurns === 96)!;
    const t240 = result!.tranches.find((t) => t.maturityTurns === 240)!;
    expect(t48.couponRate).toBe(5.0); // prime 5.0 + 0pp
    expect(t96.couponRate).toBe(5.25); // prime 5.0 + 0.25pp
    expect(t240.couponRate).toBe(5.75); // prime 5.0 + 0.75pp
  });

  it("budgetInterestDelta equals sum of all tranche annual coupon costs", async () => {
    const db = buildMockDb(0);
    const result = await reconcileSovereignDebt(db as unknown as Db, {
      countryId: COUNTRY_CONFIGS.US.id,
      turn: 240,
      now: new Date(),
    });
    const expectedDelta = result!.tranches.reduce((s, t) => s + t.annualCouponCost, 0);
    expect(result!.budgetInterestDelta).toBeCloseTo(expectedDelta, 2);
  });

  it("updates principal, interest service, debtToGdpRatio and creditRating", async () => {
    const db = buildMockDb(0);
    const result = await reconcileSovereignDebt(db as unknown as Db, {
      countryId: COUNTRY_CONFIGS.US.id,
      turn: 240,
      now: new Date(),
    });
    // Budget updateOne is called with the full set including debt and debtToGdpRatio
    const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
    const setPayload = (
      updateCall as unknown[] as unknown as { $set: Record<string, unknown> }[]
    )[1];
    expect(setPayload.$set).toHaveProperty("debt");
    expect(setPayload.$set).toHaveProperty("spending");
    expect(setPayload.$set).toHaveProperty("surplus");
    expect(setPayload.$set).toHaveProperty("debtToGdpRatio");
    expect(setPayload.$set).toHaveProperty("creditRating");
    // Principal = original $10B + all tranches issued
    expect(result!.newPrincipal).toBeGreaterThan(10_000_000_000);
    expect(result!.newDebtInterest).toBeGreaterThan(600_000_000_000);
  });
});

describe("sovereign bond helpers", () => {
  it("uses 'federal' only for US and the country code for all other countries", () => {
    expect(getNationalBudgetId(COUNTRY_CONFIGS.US.id)).toBe("federal");
    expect(getNationalBudgetId(COUNTRY_CONFIGS.UK.id)).toBe(COUNTRY_CONFIGS.UK.id);
    expect(getNationalBudgetId(COUNTRY_CONFIGS.BR.id)).toBe(COUNTRY_CONFIGS.BR.id);
    expect(getNationalBudgetId(COUNTRY_CONFIGS.NG.id)).toBe(COUNTRY_CONFIGS.NG.id);
  });

  it("returns display labels for sovereign issuers", () => {
    expect(getSovereignIssuerName(COUNTRY_CONFIGS.US.id)).toBe("United States");
    expect(getSovereignIssuerName(COUNTRY_CONFIGS.UK.id)).toBe("United Kingdom");
    expect(getSovereignIssuerName(COUNTRY_CONFIGS.IE.id)).toBe("Ireland");
  });

  it("resolves IE to a non-US national budget id (matches every non-US country)", () => {
    expect(getNationalBudgetId(COUNTRY_CONFIGS.IE.id)).toBe(COUNTRY_CONFIGS.IE.id);
  });

  it("seeds sovereign issuer corporations for every supported country, with only UK nationalized", () => {
    const entries = generateCountryOwnedSeedData(
      [
        { id: "DC", population: 700_000, gdp: 200_000_000_000, countryId: "US" },
        { id: "LON", population: 9_000_000, gdp: 600_000_000_000, countryId: "UK" },
      ],
      "2019-default"
    );

    // US + UK + JP + DE + IE + BR + CN + NG + DD — every supported budget country
    // has a sovereign issuer corp seeded so sovereign-default flows can reference
    // one. DD was added because seedSovereignBondInstruments falls back to
    // `new ObjectId()` when it cannot resolve a country-owned corporation, which
    // left East Germany's seeded DDM 3B of debt pointing at a corporation that
    // did not exist. DD is issuer-only (sectors: []) — it is a command economy
    // and deliberately has no producing corporations.
    expect(entries).toHaveLength(9);
    const us = entries.find((entry) => entry.corporation.countryOwnerId === COUNTRY_CONFIGS.US.id);
    const uk = entries.find((entry) => entry.corporation.countryOwnerId === COUNTRY_CONFIGS.UK.id);
    const jp = entries.find((entry) => entry.corporation.countryOwnerId === COUNTRY_CONFIGS.JP.id);
    expect(us?.corporation.isNationalized).toBe(false);
    expect(us?.sectors).toHaveLength(0);
    expect(uk?.corporation.isNationalized).toBe(true);
    expect((uk?.sectors.length ?? 0) > 0).toBe(true);
    expect(jp?.corporation.isNationalized).toBe(false);
    expect(jp?.sectors).toHaveLength(0);
    // IE has its own IEP currency + Central Bank of Ireland — non-nationalized
    // issuer corp seeded so sovereign-default flows have an issuer identity.
    const ie = entries.find((entry) => entry.corporation.countryOwnerId === COUNTRY_CONFIGS.IE.id);
    expect(ie).toBeDefined();
    expect(ie?.corporation.isNationalized).toBe(false);
    expect(ie?.corporation.name).toBe("Ireland");
    expect(ie?.corporation.liquidCurrencyCode).toBe("IEP");
    expect(ie?.sectors).toHaveLength(0);
    const ng = entries.find((entry) => entry.corporation.countryOwnerId === COUNTRY_CONFIGS.NG.id);
    expect(ng).toBeDefined();
    expect(ng?.corporation.isNationalized).toBe(false);
    expect(ng?.corporation.name).toBe("Nigeria");
    expect(ng?.corporation.liquidCurrencyCode).toBe("NGN");
    expect(ng?.sectors).toHaveLength(0);
    // Every sovereign corp carries the modern public-corporation defaults
    // (isPrivate, legalStructure, liquidCurrencyCode) — folded into the seed
    // in Phase 3 of the reset/seed cleanup so a fresh game doesn't depend on
    // the 2026-05-07 backfill migrations running.
    for (const entry of entries) {
      expect(entry.corporation.isPrivate).toBe(false);
      expect(entry.corporation.legalStructure).toBeTruthy();
      expect(entry.corporation.liquidCurrencyCode).toBeTruthy();
    }
  });
});

describe("issueScheduledSovereignBondSeries", () => {
  const TURN = 240;

  function makeBudget(overrides?: Partial<FederalBudget>): FederalBudget {
    return {
      _id: "federal",
      countryId: COUNTRY_CONFIGS.US.id,
      fiscalYear: 2024,
      revenue: {
        incomeTax: 2_100_000_000_000,
        domesticCorporateTax: 337_500_000_000,
        foreignCorporateTax: 112_500_000_000,
        payrollTax: 1_300_000_000_000,
        tariffs: 150_000_000_000,
        salesTax: 0,
        healthcareIncome: 0,
        other: 200_000_000_000,
        total: 4_200_000_000_000,
      },
      taxRates: {
        incomeTax: 22,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15.3,
        tariffs: 3,
        salesTax: 0,
      },
      taxBases: {
        taxableIncome: 9_550_000_000_000,
        domesticCorporateProfits: 1_612_500_000_000,
        foreignCorporateProfits: 537_500_000_000,
        wagesAndSalaries: 8_500_000_000_000,
        importValue: 5_000_000_000_000,
        taxableSales: 15_000_000_000_000,
      },
      economicFactors: {
        gdpGrowth: 2.5,
        wageGrowth: 3,
        inflationRate: 2.5,
        tradeGrowth: 2,
        lastUpdated: new Date(),
      },
      spending: {
        byCategory: { healthcare: 1_200_000_000_000 },
        stateGrants: 600_000_000_000,
        debtInterest: 600_000_000_000,
        total: 5_100_000_000_000,
      },
      debt: {
        principal: 28_500_000_000_000,
        interestRate: 0.025,
        ceiling: 31_400_000_000_000,
        ceilingLastRaisedYear: 2023,
      },
      treasuryBalance: -28_500_000_000_000,
      surplus: -900_000_000_000,
      gdp: 27_000_000_000_000,
      debtToGdpRatio: 1.05,
      creditRating: "AA",
      currencyCode: "USD",
      updatedAt: new Date(),
      ...overrides,
    };
  }

  function setupScheduledMocks(opts: {
    budget?: FederalBudget;
    budgets?: FederalBudget[];
    rolloverBonds?: Bond[];
    existingBondThisTurn?: Bond | null;
    primeRate?: number;
  }) {
    const db = createMockDb();
    const budget = opts.budget ?? makeBudget();
    const budgets = opts.budgets ?? [budget];

    // Initialize the mock collection via db.collection() so it exists in collectionMocks
    db.collectionMocks["federalBudget"] = db.collection("federalBudget") as ReturnType<
      typeof db.collection
    >;

    // find() for bulk budget fetch
    db.collectionMocks["federalBudget"]!.find.mockReturnValue({
      toArray: async () => budgets,
    });

    // findOne() for per-country budget
    db.collectionMocks["federalBudget"]!.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        return budgets.find((candidate) => query._id === candidate._id) ?? null;
      }
    );

    db.collectionMocks["federalBudget"]!.updateOne.mockResolvedValue({ modifiedCount: 1 });

    db.collectionMocks["centralBanks"] = db.collection("centralBanks") as ReturnType<
      typeof db.collection
    >;
    db.collectionMocks["centralBanks"]!.findOne.mockResolvedValue({
      primeRate: opts.primeRate ?? 5.0,
    });

    db.collectionMocks["corporations"] = db.collection("corporations") as ReturnType<
      typeof db.collection
    >;
    db.collectionMocks["corporations"]!.findOne.mockImplementation(async (query) => {
      const countryId = String(query.countryOwnerId ?? COUNTRY_CONFIGS.US.id);
      return {
        _id: `corp-${countryId.toLowerCase()}`,
        name: `${countryId} Corp`,
      };
    });

    // rollover query
    db.collectionMocks["bonds"] = db.collection("bonds") as ReturnType<typeof db.collection>;
    db.collectionMocks["bonds"]!.find.mockImplementation((query: Record<string, unknown>) => {
      const maturityTurn = query.maturityTurn as Record<string, unknown> | undefined;
      if (maturityTurn?.$gte !== undefined) {
        return { toArray: async () => opts.rolloverBonds ?? [] };
      }
      return { toArray: async () => [] };
    });

    db.collectionMocks["bonds"]!.findOne.mockImplementation(
      async (query: Record<string, unknown>) => {
        if (query.issuedAtTurn !== undefined) {
          return opts.existingBondThisTurn ?? null;
        }
        return null;
      }
    );

    db.collectionMocks["bonds"]!.insertMany.mockResolvedValue({ insertedIds: {} });

    return { db, budget };
  }

  it("returns 0 on non-quarterly turns", async () => {
    const { db } = setupScheduledMocks({});
    const count = await issueScheduledSovereignBondSeries(db as unknown as Db, 11, new Date());
    expect(count).toBe(0);
    expect(db.collectionMocks["federalBudget"]!.find).not.toHaveBeenCalled();
  });

  it("issues staggered tranches matching the default distribution", async () => {
    const { db, budget } = setupScheduledMocks({});
    // Deficit = $900B annual = $225B quarterly. No rollover.
    const count = await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, new Date());
    expect(count).toBe(3); // three tranches

    const insertCalls = db.collectionMocks["bonds"]!.insertMany.mock.calls;
    expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    const bondDocs = insertCalls[0][0] as Omit<Bond, "_id">[];
    expect(bondDocs).toHaveLength(3);

    const byMaturity = Object.fromEntries(bondDocs.map((b) => [b.maturityTurns, b]));
    expect(byMaturity[48]).toBeDefined();
    expect(byMaturity[96]).toBeDefined();
    expect(byMaturity[240]).toBeDefined();

    // Default split: 25% / 35% / 40% of $225B = $56.25B / $78.75B / $90B
    // Rounded down to $1,000 units.
    expect(byMaturity[48].totalIssued).toBe(
      Math.floor((225_000_000_000 * 0.25) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE
    );
    expect(byMaturity[96].totalIssued).toBe(
      Math.floor((225_000_000_000 * 0.35) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE
    );
    expect(byMaturity[240].totalIssued).toBe(
      Math.floor((225_000_000_000 * 0.4) / BOND_UNIT_FACE_VALUE) * BOND_UNIT_FACE_VALUE
    );

    // Single budget update despite 3 tranches
    expect(db.collectionMocks["federalBudget"]!.updateOne).toHaveBeenCalledTimes(1);
    const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({ _id: budget._id });
    expect(updateCall[1]).toHaveProperty("$set.debt");
    expect(updateCall[1]).toHaveProperty("$set.spending");
  });

  it("issues scheduled tranches for every configured country with a national budget", async () => {
    const usBudget = makeBudget();
    const deBudget = makeBudget({
      _id: getNationalBudgetId(COUNTRY_CONFIGS.DE.id),
      countryId: COUNTRY_CONFIGS.DE.id,
      surplus: -400_000_000_000,
      currencyCode: "EUR",
    });
    const { db } = setupScheduledMocks({ budgets: [usBudget, deBudget] });

    const count = await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, new Date());

    expect(count).toBe(6);
    const findQuery = db.collectionMocks["federalBudget"]!.find.mock.calls[0][0] as {
      _id: { $in: string[] };
    };
    expect(findQuery._id.$in).toContain(getNationalBudgetId(COUNTRY_CONFIGS.DE.id));

    const bondDocs = db.collectionMocks["bonds"]!.insertMany.mock.calls.flatMap(
      ([docs]) => docs as Omit<Bond, "_id">[]
    );
    expect(bondDocs.filter((bond) => bond.countryId === COUNTRY_CONFIGS.US.id)).toHaveLength(3);
    const deBondDocs = bondDocs.filter((bond) => bond.countryId === COUNTRY_CONFIGS.DE.id);
    expect(deBondDocs).toHaveLength(3);
    expect(deBondDocs.every((bond) => bond.currencyCode === "EUR")).toBe(true);

    const updatedBudgetIds = db.collectionMocks["federalBudget"]!.updateOne.mock.calls.map(
      ([filter]) => (filter as { _id: string })._id
    );
    expect(updatedBudgetIds).toEqual([
      getNationalBudgetId(COUNTRY_CONFIGS.US.id),
      getNationalBudgetId(COUNTRY_CONFIGS.DE.id),
    ]);
  });

  it("uses term premiums per maturity", async () => {
    const { db } = setupScheduledMocks({ primeRate: 5.0 });
    await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, new Date());

    const bondDocs = db.collectionMocks["bonds"]!.insertMany.mock.calls[0][0] as Omit<
      Bond,
      "_id"
    >[];
    const byMaturity = Object.fromEntries(bondDocs.map((b) => [b.maturityTurns, b]));

    expect(byMaturity[48].couponRate).toBe(5.0); // +0pp
    expect(byMaturity[96].couponRate).toBe(5.25); // +0.25pp
    expect(byMaturity[240].couponRate).toBe(5.75); // +0.75pp
  });

  it("skips issuance when a non-reconcile sovereign bond already exists for this turn (dedup)", async () => {
    const { db } = setupScheduledMocks({
      existingBondThisTurn: {
        _id: "existing",
        issuerType: "sovereign",
        countryId: COUNTRY_CONFIGS.US.id,
        issuedAtTurn: TURN,
      } as unknown as Bond,
    });
    const count = await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, new Date());
    expect(count).toBe(0);
    expect(db.collectionMocks["bonds"]!.insertMany).not.toHaveBeenCalled();
    expect(db.collectionMocks["federalBudget"]!.updateOne).not.toHaveBeenCalled();
  });

  it("skips when total issue amount is below bond unit face value", async () => {
    const budget = makeBudget({ surplus: 0 }); // no deficit
    const { db } = setupScheduledMocks({ budget });
    const count = await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, new Date());
    expect(count).toBe(0);
    expect(db.collectionMocks["bonds"]!.insertMany).not.toHaveBeenCalled();
  });

  it("respects a custom sovereignBondProfile when set on the budget", async () => {
    const budget = makeBudget({
      sovereignBondProfile: { 48: 0.5, 96: 0.5, 240: 0 },
    });
    const { db } = setupScheduledMocks({ budget });
    const count = await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, new Date());
    expect(count).toBe(2); // only 48 and 96 tranches

    const bondDocs = db.collectionMocks["bonds"]!.insertMany.mock.calls[0][0] as Omit<
      Bond,
      "_id"
    >[];
    expect(bondDocs).toHaveLength(2);
    const maturities = bondDocs.map((b) => b.maturityTurns).sort((a, b) => a - b);
    expect(maturities).toEqual([48, 96]);
  });

  it("never issues for a dissolved country, even with its budget doc present", async () => {
    // A merged country keeps its budget as a stamped husk; the scheduler must
    // not keep rolling a dead state's debt over into fresh paper.
    const dd = makeBudget({ _id: "DD" as never, countryId: "DD" });
    const { db } = setupScheduledMocks({ budgets: [makeBudget(), dd] });
    db.collectionMocks["countryGameStates"] = db.collection("countryGameStates") as ReturnType<
      typeof db.collection
    >;
    db.collectionMocks["countryGameStates"]!.find.mockReturnValue({
      toArray: async () => [{ _id: "DD", dissolvedTurn: 500 }],
    });

    await issueScheduledSovereignBondSeries(db as unknown as Db, TURN, new Date());

    const insertCalls = db.collectionMocks["bonds"]!.insertMany.mock.calls;
    const issuedCountries = insertCalls.flatMap((c) =>
      (c[0] as Array<{ countryId?: string }>).map((b) => b.countryId)
    );
    expect(issuedCountries).toContain("US");
    expect(issuedCountries).not.toContain("DD");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tariff } from "@/lib/db/types";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import {
  getEffectiveTariffRate,
  computeCountryTariffPressure,
  getTariffBlendWeights,
  getForeignTariffMarginModifier,
  getDomesticTariffMalus,
  getSplitCaptureMultiplier,
  applyTariffProvision,
  fireTariffProvisionSentiment,
  fireFtaRescissionSentiment,
  tariffRulesNeedSectorPresenceKeys,
  buildSectorPresenceKeys,
} from "./tariffEffects";
import { buildFtaCoverageLookup } from "./ftaOverrides";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/budget/revenue", () => ({
  calculateFederalRevenue: vi.fn().mockResolvedValue({
    incomeTax: 100,
    domesticCorporateTax: 50,
    foreignCorporateTax: 25,
    payrollTax: 75,
    tariffs: 200,
    salesTax: 0,
    healthcareIncome: 0,
    other: 50,
    total: 500,
  }),
  normalizeFederalTaxRates: vi.fn((taxRates) => taxRates ?? null),
}));

const billId = new ObjectId();
const baseFields = { sourceBillId: billId, createdAt: new Date(), updatedAt: new Date() };

function makeTariff(overrides: Partial<Tariff>): Tariff {
  return {
    _id: new ObjectId(),
    countryId: "US",
    scopeType: "economy_wide",
    rate: 0,
    ...baseFields,
    ...overrides,
  } as Tariff;
}

describe("getEffectiveTariffRate", () => {
  it("returns 0 when no tariffs", () => {
    expect(getEffectiveTariffRate([], "US", "technology", "UK", undefined)).toBe(0);
  });

  it("applies economy-wide tariff to all foreign corps", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 20 })];
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "UK", undefined)).toBe(20);
  });

  it("does not apply tariff to domestic corps", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 20 })];
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "US", undefined)).toBe(0);
  });

  it("applies sector tariff only to matching sector", () => {
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "sector",
        targetSectorType: "technology",
        rate: 30,
      }),
    ];
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "UK", undefined)).toBe(30);
    expect(getEffectiveTariffRate(tariffs, "US", "retail", "UK", undefined)).toBe(0);
  });

  it("applies origin-country tariff only to matching HQ country", () => {
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "origin_country",
        targetOriginCountryId: "UK",
        rate: 15,
      }),
    ];
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "UK", undefined)).toBe(15);
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "DE", undefined)).toBe(0);
  });

  it("applies corporation tariff only to matching corp", () => {
    const corpId = new ObjectId();
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "corporation",
        targetCorporationId: corpId,
        rate: 10,
      }),
    ];
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "UK", corpId)).toBe(10);
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "UK", new ObjectId())).toBe(0);
  });

  it("stacks all four scope layers", () => {
    const corpId = new ObjectId();
    const tariffs = [
      makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 20 }),
      makeTariff({
        countryId: "US",
        scopeType: "sector",
        targetSectorType: "technology",
        rate: 30,
      }),
      makeTariff({
        countryId: "US",
        scopeType: "origin_country",
        targetOriginCountryId: "UK",
        rate: 15,
      }),
      makeTariff({
        countryId: "US",
        scopeType: "corporation",
        targetCorporationId: corpId,
        rate: 10,
      }),
    ];
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "UK", corpId)).toBe(75);
  });

  it("caps effective rate at 100", () => {
    const tariffs = [
      makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 60 }),
      makeTariff({
        countryId: "US",
        scopeType: "sector",
        targetSectorType: "technology",
        rate: 60,
      }),
    ];
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "UK", undefined)).toBe(100);
  });

  it("only uses tariffs where countryId matches sector country (territorial invariant)", () => {
    const tariffs = [makeTariff({ countryId: "UK", scopeType: "economy_wide", rate: 50 })];
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "UK", undefined)).toBe(0);
  });

  it("treats rate 0 as nullified (contributes nothing)", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 0 })];
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "UK", undefined)).toBe(0);
  });

  it("ignores non-finite tariff rates instead of propagating NaN", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: Number.NaN })];
    expect(getEffectiveTariffRate(tariffs, "US", "technology", "UK", undefined)).toBe(0);
  });
});

describe("computeCountryTariffPressure", () => {
  it("weights targeted tariffs by the share of domestic sector revenue they touch", () => {
    const ukCorpId = new ObjectId();
    const jpCorpId = new ObjectId();
    const corpSpecificId = new ObjectId();

    const tariffs = [
      makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 10 }),
      makeTariff({
        countryId: "US",
        scopeType: "sector",
        targetSectorType: "technology",
        rate: 20,
      }),
      makeTariff({
        countryId: "US",
        scopeType: "origin_country",
        targetOriginCountryId: "JP",
        rate: 40,
      }),
      makeTariff({
        countryId: "US",
        scopeType: "corporation",
        targetCorporationId: corpSpecificId,
        rate: 50,
      }),
    ];

    const sectors = [
      {
        corporationId: ukCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 300,
      },
      {
        corporationId: jpCorpId,
        countryId: "US" as const,
        sectorType: "agriculture" as const,
        revenue: 200,
      },
      {
        corporationId: corpSpecificId,
        countryId: "US" as const,
        sectorType: "retail" as const,
        revenue: 100,
      },
      {
        corporationId: new ObjectId(),
        countryId: "US" as const,
        sectorType: "retail" as const,
        revenue: 400,
      },
    ];

    const corpById = new Map([
      [ukCorpId.toString(), { _id: ukCorpId, countryId: "UK" as const }],
      [jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }],
      [corpSpecificId.toString(), { _id: corpSpecificId, countryId: "UK" as const }],
    ]);

    // Total domestic revenue = 1000
    // economy-wide: 10
    // technology sector: 20 * 0.3 = 6
    // JP origin: 40 * 0.2 = 8
    // targeted corp: 50 * 0.1 = 5
    expect(computeCountryTariffPressure(tariffs, "US", sectors, corpById)).toBeCloseTo(29);
  });

  it("falls back to economy-wide pressure when no domestic sector revenue exists", () => {
    expect(
      computeCountryTariffPressure(
        [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 12 })],
        "US",
        [],
        new Map()
      )
    ).toBe(12);
  });

  it("ignores non-finite tariff and revenue inputs instead of returning NaN", () => {
    const corpId = new ObjectId();
    const weirdTariff = makeTariff({
      countryId: "US",
      scopeType: "economy_wide",
      rate: Number.NaN,
    });
    const sectors = [
      {
        corporationId: corpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: Number.NaN,
      },
    ];
    const corpById = new Map([[corpId.toString(), { _id: corpId, countryId: "UK" as const }]]);

    expect(computeCountryTariffPressure([weirdTariff], "US", sectors, corpById)).toBe(0);
  });

  it("ignores origin-country and corporation tariff exposure when an FTA nullifies that trade lane", () => {
    const jpCorpId = new ObjectId();

    const tariffs = [
      makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 5 }),
      makeTariff({
        countryId: "US",
        scopeType: "origin_country",
        targetOriginCountryId: "JP",
        rate: 40,
      }),
      makeTariff({
        countryId: "US",
        scopeType: "corporation",
        targetCorporationId: jpCorpId,
        rate: 30,
      }),
    ];

    const sectors = [
      {
        corporationId: jpCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 500,
      },
      {
        corporationId: new ObjectId(),
        countryId: "US" as const,
        sectorType: "retail" as const,
        revenue: 500,
      },
    ];

    const corpById = new Map([[jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }]]);
    // 100% of US foreign sector revenue is JP-HQ'd, so byCountryEconomyWide["US"] = 1.0;
    // the economy_wide 5% tariff therefore contributes 5 * (1 − 1.0) = 0.
    // Origin and corporation tariffs targeting JP also short-circuit on the FTA pair set.
    const ftaCoverage = buildFtaCoverageLookup(sectors, corpById, new Set(["JP|US"]));

    expect(computeCountryTariffPressure(tariffs, "US", sectors, corpById, ftaCoverage)).toBe(0);
  });

  it("scales an economy_wide tariff by (1 − FTA share of foreign exposure)", () => {
    const ftaCorpId = new ObjectId();
    const nonFtaCorpId = new ObjectId();
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 20 })];

    // 1000 US-domestic revenue: 200 from a JP-HQ FTA partner, 200 from a CN-HQ
    // non-partner, 600 domestic. Foreign-only revenue is 400, half of which is
    // FTA-protected → byCountryEconomyWide["US"] = 0.5.
    const sectors = [
      {
        corporationId: ftaCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 200,
      },
      {
        corporationId: nonFtaCorpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 200,
      },
      {
        corporationId: new ObjectId(),
        countryId: "US" as const,
        sectorType: "retail" as const,
        revenue: 600,
      },
    ];
    const corpById = new Map([
      [ftaCorpId.toString(), { _id: ftaCorpId, countryId: "JP" as const }],
      [nonFtaCorpId.toString(), { _id: nonFtaCorpId, countryId: "CN" as const }],
    ]);
    const ftaCoverage = buildFtaCoverageLookup(sectors, corpById, new Set(["JP|US"]));

    // 20% rate × (1 − 0.5) = 10
    expect(computeCountryTariffPressure(tariffs, "US", sectors, corpById, ftaCoverage)).toBeCloseTo(
      10
    );
  });

  it("scales a sector tariff by (1 − FTA share of that sector's foreign exposure)", () => {
    const jpEnergyId = new ObjectId();
    const cnEnergyId = new ObjectId();
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "sector",
        targetSectorType: "energy",
        rate: 40,
      }),
    ];

    // US:energy has 200 JP (FTA) + 200 CN (non-FTA) = 400. US:retail has 600 domestic.
    // bySectorType["US:energy"] = 200/400 = 0.5. exposureShare = 400/1000 = 0.4.
    // → 40 × 0.4 × (1 − 0.5) = 8.
    const sectors = [
      {
        corporationId: jpEnergyId,
        countryId: "US" as const,
        sectorType: "energy" as const,
        revenue: 200,
      },
      {
        corporationId: cnEnergyId,
        countryId: "US" as const,
        sectorType: "energy" as const,
        revenue: 200,
      },
      {
        corporationId: new ObjectId(),
        countryId: "US" as const,
        sectorType: "retail" as const,
        revenue: 600,
      },
    ];
    const corpById = new Map([
      [jpEnergyId.toString(), { _id: jpEnergyId, countryId: "JP" as const }],
      [cnEnergyId.toString(), { _id: cnEnergyId, countryId: "CN" as const }],
    ]);
    const ftaCoverage = buildFtaCoverageLookup(sectors, corpById, new Set(["JP|US"]));

    expect(computeCountryTariffPressure(tariffs, "US", sectors, corpById, ftaCoverage)).toBeCloseTo(
      8
    );
  });

  it("zeroes a sector tariff when 100% of that sector's foreign exposure is FTA-covered", () => {
    const jpEnergyId = new ObjectId();
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "sector",
        targetSectorType: "energy",
        rate: 45,
      }),
    ];
    // US:energy entirely from a JP-HQ FTA partner → bySectorType["US:energy"] = 1.0
    const sectors = [
      {
        corporationId: jpEnergyId,
        countryId: "US" as const,
        sectorType: "energy" as const,
        revenue: 500,
      },
      {
        corporationId: new ObjectId(),
        countryId: "US" as const,
        sectorType: "retail" as const,
        revenue: 500,
      },
    ];
    const corpById = new Map([
      [jpEnergyId.toString(), { _id: jpEnergyId, countryId: "JP" as const }],
    ]);
    const ftaCoverage = buildFtaCoverageLookup(sectors, corpById, new Set(["JP|US"]));

    expect(computeCountryTariffPressure(tariffs, "US", sectors, corpById, ftaCoverage)).toBe(0);
  });

  it("falls back to FTA-blind behaviour when no ftaCoverage is supplied (back-compat)", () => {
    const corpId = new ObjectId();
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 12 })];
    const sectors = [
      {
        corporationId: corpId,
        countryId: "US" as const,
        sectorType: "technology" as const,
        revenue: 100,
      },
    ];
    const corpById = new Map([[corpId.toString(), { _id: corpId, countryId: "UK" as const }]]);

    expect(computeCountryTariffPressure(tariffs, "US", sectors, corpById)).toBe(12);
  });
});

describe("tariffRulesNeedSectorPresenceKeys", () => {
  it("returns false when only economy_wide / sector tariffs exist", () => {
    expect(
      tariffRulesNeedSectorPresenceKeys([
        makeTariff({ scopeType: "economy_wide", rate: 10 }),
        makeTariff({ scopeType: "sector", targetSectorType: "technology", rate: 5 }),
      ])
    ).toBe(false);
  });

  it("returns true when origin_country or corporation tariffs exist", () => {
    expect(
      tariffRulesNeedSectorPresenceKeys([
        makeTariff({
          scopeType: "origin_country",
          targetOriginCountryId: "UK",
          rate: 10,
        }),
      ])
    ).toBe(true);
    expect(
      tariffRulesNeedSectorPresenceKeys([
        makeTariff({
          scopeType: "corporation",
          targetCorporationId: new ObjectId(),
          rate: 10,
        }),
      ])
    ).toBe(true);
  });
});

describe("buildSectorPresenceKeys", () => {
  it("adds keys only for cross-border sectors", () => {
    const domesticCorpId = new ObjectId();
    const foreignCorpId = new ObjectId();
    const keys = buildSectorPresenceKeys(
      [
        {
          corporationId: domesticCorpId,
          countryId: "US",
          sectorType: "technology",
        },
        {
          corporationId: foreignCorpId,
          countryId: "US",
          sectorType: "technology",
        },
      ],
      new Map([
        [domesticCorpId.toString(), { _id: domesticCorpId, countryId: "US" }],
        [foreignCorpId.toString(), { _id: foreignCorpId, countryId: "UK" }],
      ])
    );
    expect(keys.has("US:UK:technology")).toBe(true);
    expect(keys.has(`US:corp:${foreignCorpId.toString()}:technology`)).toBe(true);
    expect(keys.size).toBe(2);
  });
});

describe("getTariffBlendWeights", () => {
  it("returns 50/25/25 with no tariffs", () => {
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      [],
      "US",
      "technology",
      new Set()
    );
    expect(globalWeight).toBeCloseTo(0.5);
    expect(nationalWeight).toBeCloseTo(0.25);
    expect(localWeight).toBeCloseTo(0.25);
  });

  it("shifts to 25/50/25 at 100% economy-wide tariff", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 100 })];
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      tariffs,
      "US",
      "technology",
      new Set()
    );
    expect(globalWeight).toBeCloseTo(0.25);
    expect(nationalWeight).toBeCloseTo(0.5);
    expect(localWeight).toBeCloseTo(0.25);
  });

  it("shifts proportionally at 50% tariff", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 50 })];
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      tariffs,
      "US",
      "technology",
      new Set()
    );
    expect(globalWeight).toBeCloseTo(0.375);
    expect(nationalWeight).toBeCloseTo(0.375);
    expect(localWeight).toBeCloseTo(0.25);
  });

  it("scales linearly at 38% tariff", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 38 })];
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      tariffs,
      "US",
      "technology",
      new Set()
    );
    expect(globalWeight).toBeCloseTo(0.405);
    expect(nationalWeight).toBeCloseTo(0.345);
    expect(localWeight).toBeCloseTo(0.25);
  });

  it("includes corporation-scope tariff when key is present in allSectorKeys", () => {
    const corpId = new ObjectId();
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "corporation",
        targetCorporationId: corpId,
        rate: 40,
      }),
    ];
    const key = `US:corp:${corpId.toString()}:technology`;
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      tariffs,
      "US",
      "technology",
      new Set([key])
    );
    // 40% tariff → global 0.40, national 0.35, local 0.25
    expect(globalWeight).toBeCloseTo(0.4);
    expect(nationalWeight).toBeCloseTo(0.35);
    expect(localWeight).toBeCloseTo(0.25);
  });

  it("skips corporation-scope tariff when targetCorporationId is absent (null guard)", () => {
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "corporation",
        targetCorporationId: undefined,
        rate: 40,
      }),
    ];
    // Even if a key with "undefined" were present, the guard should prevent any match
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      tariffs,
      "US",
      "technology",
      new Set(["US:corp:undefined:technology"])
    );
    expect(globalWeight).toBeCloseTo(0.5);
    expect(nationalWeight).toBeCloseTo(0.25);
    expect(localWeight).toBeCloseTo(0.25);
  });

  it("scales economy-wide tariff effect by FTA coverage", () => {
    const jpCorpId = new ObjectId();
    const ukCorpId = new ObjectId();
    const coverage = buildFtaCoverageLookup(
      [
        {
          corporationId: jpCorpId,
          countryId: "US",
          sectorType: "technology",
          revenue: 500,
        },
        {
          corporationId: ukCorpId,
          countryId: "US",
          sectorType: "technology",
          revenue: 500,
        },
      ],
      new Map([
        [jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }],
        [ukCorpId.toString(), { _id: ukCorpId, countryId: "UK" as const }],
      ]),
      new Set(["JP|US"])
    );
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 100 })];
    // 100% × (1 - 0.5) = 50% effective → halfway tilt (0.375 / 0.375 / 0.25)
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      tariffs,
      "US",
      "technology",
      new Set(),
      coverage
    );
    expect(globalWeight).toBeCloseTo(0.375);
    expect(nationalWeight).toBeCloseTo(0.375);
    expect(localWeight).toBeCloseTo(0.25);
  });

  it("zeroes out origin_country tariff aimed at an FTA partner", () => {
    const jpCorpId = new ObjectId();
    const coverage = buildFtaCoverageLookup(
      [
        {
          corporationId: jpCorpId,
          countryId: "US",
          sectorType: "technology",
          revenue: 100,
        },
      ],
      new Map([[jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }]]),
      new Set(["JP|US"])
    );
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "origin_country",
        targetOriginCountryId: "JP",
        rate: 50,
      }),
    ];
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      tariffs,
      "US",
      "technology",
      new Set(["US:JP:technology"]),
      coverage
    );
    // FTA-partnered origin → contributes 0; blend stays at default 50/25/25
    expect(globalWeight).toBeCloseTo(0.5);
    expect(nationalWeight).toBeCloseTo(0.25);
    expect(localWeight).toBeCloseTo(0.25);
  });

  it("preserves origin_country contribution when target is NOT an FTA partner", () => {
    const ukCorpId = new ObjectId();
    const coverage = buildFtaCoverageLookup(
      [
        {
          corporationId: ukCorpId,
          countryId: "US",
          sectorType: "technology",
          revenue: 100,
        },
      ],
      new Map([[ukCorpId.toString(), { _id: ukCorpId, countryId: "UK" as const }]]),
      new Set() // no active FTAs
    );
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "origin_country",
        targetOriginCountryId: "UK",
        rate: 40,
      }),
    ];
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      tariffs,
      "US",
      "technology",
      new Set(["US:UK:technology"]),
      coverage
    );
    // 40% tariff → global 0.40, national 0.35, local 0.25
    expect(globalWeight).toBeCloseTo(0.4);
    expect(nationalWeight).toBeCloseTo(0.35);
    expect(localWeight).toBeCloseTo(0.25);
  });

  it("zeroes out corporation-scope tariff when target corp is HQ'd in an FTA partner", () => {
    const jpCorpId = new ObjectId();
    const coverage = buildFtaCoverageLookup(
      [
        {
          corporationId: jpCorpId,
          countryId: "US",
          sectorType: "technology",
          revenue: 100,
        },
      ],
      new Map([[jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }]]),
      new Set(["JP|US"])
    );
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "corporation",
        targetCorporationId: jpCorpId,
        rate: 60,
      }),
    ];
    const presenceKey = `US:corp:${jpCorpId.toString()}:technology`;
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      tariffs,
      "US",
      "technology",
      new Set([presenceKey]),
      coverage
    );
    // FTA-partnered corp HQ → contributes 0
    expect(globalWeight).toBeCloseTo(0.5);
    expect(nationalWeight).toBeCloseTo(0.25);
    expect(localWeight).toBeCloseTo(0.25);
  });

  it("preserves legacy behavior when ftaCoverage is omitted", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 100 })];
    const { globalWeight } = getTariffBlendWeights(tariffs, "US", "technology", new Set());
    expect(globalWeight).toBeCloseTo(0.25);
  });
});

describe("getForeignTariffMarginModifier", () => {
  it("returns 0 for domestic corps", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 50 })];
    expect(getForeignTariffMarginModifier(tariffs, "US", "technology", "US", undefined)).toBe(0);
  });

  it("returns negative rate for foreign corps", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 25 })];
    expect(getForeignTariffMarginModifier(tariffs, "US", "technology", "UK", undefined)).toBe(
      -12.5
    );
  });
});

describe("getDomesticTariffMalus", () => {
  it("returns 0 for foreign corps", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 100 })];
    expect(getDomesticTariffMalus(tariffs, "US", "technology", "UK")).toBe(0);
  });

  it("returns -10 at 100% effective tariff for domestic corp", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 100 })];
    expect(getDomesticTariffMalus(tariffs, "US", "technology", "US")).toBeCloseTo(-10);
  });

  it("returns -5 at 50% effective tariff for domestic corp", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 50 })];
    expect(getDomesticTariffMalus(tariffs, "US", "technology", "US")).toBeCloseTo(-5);
  });

  it("zeroes out the malus when economy-wide FTA coverage is full", () => {
    const jpCorpId = new ObjectId();
    const coverage = buildFtaCoverageLookup(
      [
        {
          corporationId: jpCorpId,
          countryId: "US",
          sectorType: "technology",
          revenue: 1000,
        },
      ],
      new Map([[jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }]]),
      new Set(["JP|US"])
    );
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 100 })];
    expect(getDomesticTariffMalus(tariffs, "US", "technology", "US", coverage)).toBeCloseTo(0);
  });

  it("scales the malus proportionally to FTA coverage (50% partner exposure)", () => {
    const jpCorpId = new ObjectId();
    const ukCorpId = new ObjectId();
    const coverage = buildFtaCoverageLookup(
      [
        {
          corporationId: jpCorpId,
          countryId: "US",
          sectorType: "technology",
          revenue: 500,
        },
        {
          corporationId: ukCorpId,
          countryId: "US",
          sectorType: "technology",
          revenue: 500,
        },
      ],
      new Map([
        [jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }],
        [ukCorpId.toString(), { _id: ukCorpId, countryId: "UK" as const }],
      ]),
      new Set(["JP|US"])
    );
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 100 })];
    // 100% rate × (1 - 0.5) = 50% effective → -5pp malus
    expect(getDomesticTariffMalus(tariffs, "US", "technology", "US", coverage)).toBeCloseTo(-5);
  });

  it("scales sector-tariff malus by sector-specific FTA coverage", () => {
    const jpCorpId = new ObjectId();
    const ukCorpId = new ObjectId();
    const coverage = buildFtaCoverageLookup(
      [
        {
          corporationId: jpCorpId,
          countryId: "US",
          sectorType: "technology",
          revenue: 800,
        },
        {
          corporationId: ukCorpId,
          countryId: "US",
          sectorType: "retail",
          revenue: 800,
        },
      ],
      new Map([
        [jpCorpId.toString(), { _id: jpCorpId, countryId: "JP" as const }],
        [ukCorpId.toString(), { _id: ukCorpId, countryId: "UK" as const }],
      ]),
      new Set(["JP|US"])
    );
    const tariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "sector",
        targetSectorType: "technology",
        rate: 100,
      }),
    ];
    // Tech sector is 100% FTA-covered → 0 malus
    expect(getDomesticTariffMalus(tariffs, "US", "technology", "US", coverage)).toBeCloseTo(0);
    const retailTariffs = [
      makeTariff({
        countryId: "US",
        scopeType: "sector",
        targetSectorType: "retail",
        rate: 100,
      }),
    ];
    // Retail share is 0% covered (UK is not partner) → full -10
    expect(getDomesticTariffMalus(retailTariffs, "US", "retail", "US", coverage)).toBeCloseTo(-10);
  });

  it("preserves legacy behavior when ftaCoverage is omitted", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: 100 })];
    expect(getDomesticTariffMalus(tariffs, "US", "technology", "US")).toBeCloseTo(-10);
  });

  it("returns 0 instead of NaN when tariff rates are malformed", () => {
    const tariffs = [makeTariff({ countryId: "US", scopeType: "economy_wide", rate: Number.NaN })];
    expect(getDomesticTariffMalus(tariffs, "US", "technology", "US")).toBe(0);
  });
});

describe("getSplitCaptureMultiplier", () => {
  it("returns 1.0 with no tariff", () => {
    expect(getSplitCaptureMultiplier(0, true)).toBe(1.0);
    expect(getSplitCaptureMultiplier(0, false)).toBe(1.0);
  });

  it("domestic corp gets 1.5x at 100% tariff", () => {
    expect(getSplitCaptureMultiplier(100, true)).toBeCloseTo(1.5);
  });

  it("foreign corp gets 0.5x at 100% tariff", () => {
    expect(getSplitCaptureMultiplier(100, false)).toBeCloseTo(0.5);
  });

  it("scales linearly: domestic 1.25x at 50% tariff", () => {
    expect(getSplitCaptureMultiplier(50, true)).toBeCloseTo(1.25);
  });

  it("scales linearly: foreign 0.75x at 50% tariff", () => {
    expect(getSplitCaptureMultiplier(50, false)).toBeCloseTo(0.75);
  });
});

describe("applyTariffProvision", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("insert: calls updateOne with upsert on a new economy_wide provision", async () => {
    const sourceBillId = new ObjectId();
    await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "economy_wide", rate: 25 },
      sourceBillId
    );
    const tariffsMock = db.collectionMocks["tariffs"];
    expect(tariffsMock).toBeDefined();
    expect(tariffsMock!.updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = tariffsMock!.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(filter.countryId).toBe("US");
    expect(filter.scopeType).toBe("economy_wide");
    expect(filter.targetSectorType).toBeNull();
    expect((update as { $set: Record<string, unknown> }).$set.rate).toBe(25);
    expect(options.upsert).toBe(true);
  });

  it("upsert (replace): second call with same scope updates rate and sourceBillId", async () => {
    const bill1 = new ObjectId();
    const bill2 = new ObjectId();
    await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "sector", targetSectorType: "technology", rate: 30 },
      bill1
    );
    await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "sector", targetSectorType: "technology", rate: 45 },
      bill2
    );
    const tariffsMock = db.collectionMocks["tariffs"];
    expect(tariffsMock!.updateOne).toHaveBeenCalledTimes(2);
    // Second call should carry the updated rate and new sourceBillId
    const [, update2] = tariffsMock!.updateOne.mock.calls[1] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update2.$set.rate).toBe(45);
    expect(update2.$set.sourceBillId).toStrictEqual(bill2);
  });

  it("does not fire sentiment pulses itself — pulses are emitted by the bill-enactment path", async () => {
    // applyTariffProvision is called from both real enactment (legislationEffects)
    // and idempotent reconcile (reconcileSignedTariffBills). Pulses are a side
    // effect of the former only, so they must NOT live inside this function.
    db.collection("sentimentPulses");

    await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "sector", targetSectorType: "technology", rate: 30 },
      new ObjectId()
    );

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock.insertOne).not.toHaveBeenCalled();
  });

  it("rateChanged = true on first apply (no existing tariff doc)", async () => {
    db.collection("tariffs");
    const tariffsMock = db.collectionMocks["tariffs"]!;
    // Explicit null — don't rely on MockDb defaults so the contract stays clear.
    tariffsMock.findOne.mockResolvedValueOnce(null);

    const result = await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "sector", targetSectorType: "technology", rate: 30 },
      new ObjectId()
    );

    expect(result).toEqual({ rateChanged: true });
  });

  it("rateChanged = false on idempotent replay (same scope, same rate)", async () => {
    db.collection("tariffs");
    const tariffsMock = db.collectionMocks["tariffs"]!;
    tariffsMock.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      countryId: "US",
      scopeType: "sector",
      targetSectorType: "technology",
      rate: 30,
      sourceBillId: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "sector", targetSectorType: "technology", rate: 30 },
      new ObjectId()
    );

    expect(result).toEqual({ rateChanged: false });
  });

  it("rateChanged = true when the provision rate differs from the existing doc", async () => {
    db.collection("tariffs");
    const tariffsMock = db.collectionMocks["tariffs"]!;
    tariffsMock.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      countryId: "US",
      scopeType: "sector",
      targetSectorType: "technology",
      rate: 30,
      sourceBillId: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "sector", targetSectorType: "technology", rate: 45 },
      new ObjectId()
    );

    expect(result).toEqual({ rateChanged: true });
  });

  it("rateChanged = true even after multiple reconcile passes that oscillate the rate", async () => {
    // Regression guard for the bug where two bills target the same scope at
    // different rates: the older bill's provision differs from the existing
    // doc (which holds the newer bill's rate), so each reconcile pass would
    // see rateChanged=true. The fix here is structural — pulses don't fire
    // from this function at all (covered above) — but the rateChanged signal
    // itself remains accurate so callers can act on it.
    db.collection("tariffs");
    const tariffsMock = db.collectionMocks["tariffs"]!;
    tariffsMock.findOne.mockResolvedValueOnce({
      _id: new ObjectId(),
      countryId: "US",
      scopeType: "sector",
      targetSectorType: "technology",
      rate: 45, // newer bill landed here
      sourceBillId: new ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Reconcile replays the older bill (rate=30) over the newer state (rate=45)
    const result = await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "sector", targetSectorType: "technology", rate: 30 },
      new ObjectId()
    );

    expect(result).toEqual({ rateChanged: true });
  });

  it("rate 0 retained: upserts (does not skip) when rate is 0", async () => {
    const sourceBillId = new ObjectId();
    await applyTariffProvision(
      db as unknown as Db,
      "UK",
      { type: "tariff", scopeType: "economy_wide", rate: 0 },
      sourceBillId
    );
    const tariffsMock = db.collectionMocks["tariffs"];
    expect(tariffsMock!.updateOne).toHaveBeenCalledTimes(1);
    const [, update] = tariffsMock!.updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    // Rate 0 is written, not skipped — retained for audit trail
    expect(update.$set.rate).toBe(0);
  });

  it("economy_wide: updates federalBudget.taxRates.tariffs and recomputes revenue/surplus", async () => {
    const existingBudget = {
      _id: "federal",
      taxRates: {
        incomeTax: 22,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15,
        tariffs: 0,
        salesTax: 0,
      },
      spending: { total: 400 },
    };
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(existingBudget);

    await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "economy_wide", rate: 25 },
      new ObjectId()
    );

    const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({ _id: "federal" });
    expect(updateCall[1].$set.taxRates).toMatchObject({
      tariffs: 25,
      // Other rates preserved
      incomeTax: 22,
      domesticCorporateTax: 21,
    });
    // Revenue recomputed via mock (total: 500), surplus = 500 - 400 = 100.
    expect(updateCall[1].$set.surplus).toBe(100);
  });

  it("economy_wide: routes UK tariffs to the UK budget document (not 'federal')", async () => {
    const existingBudget = {
      _id: "UK",
      taxRates: {
        incomeTax: 20,
        domesticCorporateTax: 19,
        foreignCorporateTax: 19,
        payrollTax: 12,
        tariffs: 5,
        salesTax: 20,
      },
      spending: { total: 300 },
    };
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(existingBudget);

    await applyTariffProvision(
      db as unknown as Db,
      "UK",
      { type: "tariff", scopeType: "economy_wide", rate: 15 },
      new ObjectId()
    );

    const findOneCall = db.collectionMocks["federalBudget"]!.findOne.mock.calls[0];
    expect(findOneCall[0]).toEqual({ _id: "UK" });
    const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({ _id: "UK" });
    expect(updateCall[1].$set.taxRates.tariffs).toBe(15);
  });

  it("non-economy-wide tariffs leave federalBudget.taxRates untouched", async () => {
    db.collection("federalBudget");
    // Sector tariffs aren't representable as a single aggregate rate, so we never
    // touch the budget — even if a budget doc exists.
    db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue({
      _id: "federal",
      taxRates: { tariffs: 0 },
      spending: { total: 0 },
    });

    await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "sector", targetSectorType: "technology", rate: 30 },
      new ObjectId()
    );

    expect(db.collectionMocks["federalBudget"]!.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["federalBudget"]!.updateOne).not.toHaveBeenCalled();
  });

  it("economy_wide replay with budget already in sync skips the expensive recompute", async () => {
    // A second reconcile call after the budget is already at the right rate
    // should not re-run calculateFederalRevenue — recomputing on every GET
    // /api/tariffs hit would be wasteful and was a real perf regression
    // before the rate-mismatch gate.
    const inSyncBudget = {
      _id: "federal",
      taxRates: {
        incomeTax: 22,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15,
        tariffs: 25, // already matches the provision below
        salesTax: 0,
      },
      spending: { total: 400 },
    };
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockResolvedValue(inSyncBudget);

    await applyTariffProvision(
      db as unknown as Db,
      "US",
      { type: "tariff", scopeType: "economy_wide", rate: 25 },
      new ObjectId()
    );

    expect(db.collectionMocks["federalBudget"]!.updateOne).not.toHaveBeenCalled();
  });
});

describe("fireTariffProvisionSentiment", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("emits paired domestic / foreign pulses for sector tariffs", async () => {
    db.collection("sentimentPulses");
    await fireTariffProvisionSentiment(db as unknown as Db, "US", {
      type: "tariff",
      scopeType: "sector",
      targetSectorType: "technology",
      rate: 30,
    });

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock.insertOne).toHaveBeenCalledTimes(2);
    const inserted = sentimentMock.insertOne.mock.calls.map(
      (call) =>
        call[0] as {
          initialImpact: number;
          countryId: string;
          sectorType: string;
          hqRelation?: string;
        }
    );
    expect(inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          countryId: "US",
          sectorType: "technology",
          initialImpact: 0.07,
          hqRelation: "domestic",
        }),
        expect.objectContaining({
          countryId: "US",
          sectorType: "technology",
          initialImpact: -0.07,
          hqRelation: "foreign",
        }),
      ])
    );
  });

  it("emits no pulses for non-sector tariffs", async () => {
    db.collection("sentimentPulses");
    await fireTariffProvisionSentiment(db as unknown as Db, "US", {
      type: "tariff",
      scopeType: "economy_wide",
      rate: 25,
    });
    await fireTariffProvisionSentiment(db as unknown as Db, "US", {
      type: "tariff",
      scopeType: "origin_country",
      targetOriginCountryId: "JP",
      rate: 40,
    });
    await fireTariffProvisionSentiment(db as unknown as Db, "US", {
      type: "tariff",
      scopeType: "corporation",
      targetCorporationId: new ObjectId(),
      rate: 50,
    });

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock.insertOne).not.toHaveBeenCalled();
  });

  it("emits no pulses when targetSectorType is missing on a sector-scoped provision", async () => {
    db.collection("sentimentPulses");
    await fireTariffProvisionSentiment(db as unknown as Db, "US", {
      type: "tariff",
      scopeType: "sector",
      // targetSectorType intentionally missing — guards against malformed bill
      // provisions slipping through validation
      rate: 30,
    } as never);

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock.insertOne).not.toHaveBeenCalled();
  });
});

describe("fireFtaRescissionSentiment", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  function mockSignedBills(bills: Array<{ provisions: Array<Record<string, unknown>> }>) {
    db.collection("bills");
    db.collection("sentimentPulses");
    db.collectionMocks["bills"]!.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(bills),
      }),
    });
  }

  it("fires one foreign-side pulse per unique sector with a signed tariff", async () => {
    mockSignedBills([
      {
        provisions: [
          { type: "tariff", scopeType: "sector", targetSectorType: "energy", rate: 30 },
          { type: "tariff", scopeType: "sector", targetSectorType: "media", rate: 15 },
        ],
      },
    ]);

    await fireFtaRescissionSentiment(db as unknown as Db, "UK");

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock.insertOne).toHaveBeenCalledTimes(2);
    const inserted = sentimentMock.insertOne.mock.calls.map(
      (call) =>
        call[0] as {
          countryId: string;
          sectorType: string;
          initialImpact: number;
          hqRelation?: string;
        }
    );
    expect(inserted.every((p) => p.countryId === "UK")).toBe(true);
    expect(inserted.every((p) => p.hqRelation === "foreign")).toBe(true);
    expect(inserted.every((p) => p.initialImpact === -0.07)).toBe(true);
    expect(new Set(inserted.map((p) => p.sectorType))).toEqual(new Set(["energy", "media"]));
  });

  it("dedupes when multiple bills target the same sector", async () => {
    mockSignedBills([
      {
        provisions: [{ type: "tariff", scopeType: "sector", targetSectorType: "energy", rate: 30 }],
      },
      {
        provisions: [{ type: "tariff", scopeType: "sector", targetSectorType: "energy", rate: 45 }],
      },
    ]);

    await fireFtaRescissionSentiment(db as unknown as Db, "UK");

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock.insertOne).toHaveBeenCalledTimes(1);
  });

  it("emits no pulses when there are no signed sector tariffs", async () => {
    mockSignedBills([]);

    await fireFtaRescissionSentiment(db as unknown as Db, "UK");

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock.insertOne).not.toHaveBeenCalled();
  });

  it("ignores non-sector tariff scopes (economy_wide / origin_country / corporation)", async () => {
    // Mirrors the enactment-side asymmetry: only sector tariffs emit pulses,
    // because economy-wide / origin / corp scopes are too broad or too narrow
    // to map cleanly onto the sector-keyed sentiment pulse model.
    mockSignedBills([
      {
        provisions: [
          { type: "tariff", scopeType: "economy_wide", rate: 5 },
          { type: "tariff", scopeType: "origin_country", targetOriginCountryId: "JP", rate: 25 },
          {
            type: "tariff",
            scopeType: "corporation",
            targetCorporationId: new ObjectId(),
            rate: 50,
          },
        ],
      },
    ]);

    await fireFtaRescissionSentiment(db as unknown as Db, "UK");

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock.insertOne).not.toHaveBeenCalled();
  });

  it("does not fire a domestic-side pulse — domestic corps' situation is unchanged on rescission", async () => {
    // Enactment fires +0.07 domestic + −0.07 foreign because BOTH sides have a
    // shock. Rescission only flips the foreign side: domestic corps were fine
    // before and are fine after, so no domestic pulse.
    mockSignedBills([
      {
        provisions: [{ type: "tariff", scopeType: "sector", targetSectorType: "energy", rate: 30 }],
      },
    ]);

    await fireFtaRescissionSentiment(db as unknown as Db, "UK");

    const sentimentMock = db.collectionMocks["sentimentPulses"];
    expect(sentimentMock.insertOne).toHaveBeenCalledTimes(1);
    const pulse = sentimentMock.insertOne.mock.calls[0]![0] as { hqRelation?: string };
    expect(pulse.hqRelation).toBe("foreign");
  });
});

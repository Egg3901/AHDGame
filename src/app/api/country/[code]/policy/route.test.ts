import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const { getDb } = await import("@/lib/mongodb");

describe("GET /api/country/[code]/policy", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("bills");
    db.collection("tariffs");
    db.collection("subsidies");
    db.collectionMocks.subsidies.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
  });

  it("normalizes legacy national tax policy ids and backfills missing federal tax laws", async () => {
    const statePolicies = [
      {
        scope: "national",
        stateId: "uk_national",
        legislationTypeId: "uk_corporation_tax",
        economic: 0,
        social: 0,
        updatedAt: new Date("2026-04-23T12:00:00Z"),
      },
      {
        scope: "national",
        stateId: "uk_national",
        legislationTypeId: "uk_income_tax_rate",
        economic: 0,
        social: 0,
        updatedAt: new Date("2026-04-23T12:00:00Z"),
      },
    ];

    const legislationTypes = [
      {
        _id: "uk_income_tax_rate",
        countryScope: "uk",
        name: "Income Tax Rate Act",
        policyDomain: "tax",
        nationalOnly: true,
        policyOptions: [
          {
            id: "uk_income_tax_rate_opt_0",
            name: "20%",
            stance: "center",
            effectDirection: 0,
            economic: 0,
            social: 0,
            rate: 20,
          },
        ],
        taxRateChange: { scope: "federal", taxType: "incomeTax" },
      },
      {
        _id: "uk_domestic_corporation_tax",
        countryScope: "uk",
        name: "Domestic Corporation Tax Rate Act",
        policyDomain: "tax",
        nationalOnly: true,
        policyOptions: [
          {
            id: "uk_domestic_corporation_tax_opt_0",
            name: "25%",
            stance: "center",
            effectDirection: 0,
            economic: 0,
            social: 0,
            rate: 25,
          },
        ],
        taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
      },
      {
        _id: "uk_foreign_corporation_tax",
        countryScope: "uk",
        name: "Foreign Corporation Tax Rate Act",
        policyDomain: "tax",
        nationalOnly: true,
        policyOptions: [
          {
            id: "uk_foreign_corporation_tax_opt_0",
            name: "19%",
            stance: "center",
            effectDirection: 0,
            economic: 0,
            social: 0,
            rate: 19,
          },
        ],
        taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
      },
    ];

    db.collection("statePolicies");
    db.collection("legislationTypes");
    db.collection("federalBudget");
    db.collectionMocks.tariffs.findOne.mockResolvedValue({
      _id: "baselineTariff",
      countryId: "UK",
      scopeType: "economy_wide",
      rate: 0,
      sourceBillId: "baselineBill",
      createdAt: new Date("2026-04-23T12:00:00Z"),
      updatedAt: new Date("2026-04-23T12:00:00Z"),
    });
    db.collectionMocks.bills.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
    db.collectionMocks.tariffs.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });

    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(statePolicies),
    });
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(legislationTypes),
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "UK",
      updatedAt: new Date("2026-04-23T12:00:00Z"),
      taxRates: {
        incomeTax: 20,
        domesticCorporateTax: 25,
        foreignCorporateTax: 19,
        payrollTax: 12,
        tariffs: 0,
        salesTax: 20,
      },
    });

    const { GET } = await import("@/app/api/country/[code]/policy/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/policy?scope=national"),
      { params: Promise.resolve({ code: "uk" }) }
    );

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(db.collectionMocks.legislationTypes.find).toHaveBeenCalledWith({ countryScope: "uk" });
    expect(db.collectionMocks.statePolicies.find).toHaveBeenCalledWith({
      scope: "national",
      $or: [
        { stateId: "uk_national" },
        {
          stateId: { $exists: false },
          legislationTypeId: {
            $in: expect.arrayContaining([
              "uk_income_tax_rate",
              "uk_corporation_tax",
              "uk_domestic_corporation_tax",
              "uk_foreign_corporation_tax",
            ]),
          },
        },
      ],
    });

    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legislationTypeId: "uk_domestic_corporation_tax",
          name: "Domestic Corporation Tax Rate Act",
          policyOptionName: "25%",
        }),
        expect.objectContaining({
          legislationTypeId: "uk_foreign_corporation_tax",
          name: "Foreign Corporation Tax Rate Act",
          policyOptionName: "19%",
        }),
      ])
    );

    expect(
      data.find(
        (record: { legislationTypeId: string }) => record.legislationTypeId === "uk_corporation_tax"
      )
    ).toBeUndefined();
  });

  it("backfills split corporate tax laws from legacy corporateTax budget fields", async () => {
    db.collection("statePolicies");
    db.collection("legislationTypes");
    db.collection("federalBudget");
    db.collectionMocks.tariffs.findOne.mockResolvedValue({
      _id: "baselineTariff",
      countryId: "UK",
      scopeType: "economy_wide",
      rate: 0,
      sourceBillId: "baselineBill",
      createdAt: new Date("2026-04-23T12:00:00Z"),
      updatedAt: new Date("2026-04-23T12:00:00Z"),
    });
    db.collectionMocks.bills.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
    db.collectionMocks.tariffs.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });

    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "uk_domestic_corporation_tax",
          countryScope: "uk",
          name: "Domestic Corporation Tax Rate Act",
          policyDomain: "tax",
          nationalOnly: true,
          policyOptions: [
            {
              id: "uk_domestic_corporation_tax_opt_0",
              name: "19%",
              stance: "center",
              effectDirection: 0,
              economic: 0,
              social: 0,
              rate: 19,
            },
          ],
          taxRateChange: { scope: "federal", taxType: "domesticCorporateTax" },
        },
        {
          _id: "uk_foreign_corporation_tax",
          countryScope: "uk",
          name: "Foreign Corporation Tax Rate Act",
          policyDomain: "tax",
          nationalOnly: true,
          policyOptions: [
            {
              id: "uk_foreign_corporation_tax_opt_0",
              name: "19%",
              stance: "center",
              effectDirection: 0,
              economic: 0,
              social: 0,
              rate: 19,
            },
          ],
          taxRateChange: { scope: "federal", taxType: "foreignCorporateTax" },
        },
      ]),
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "UK",
      updatedAt: new Date("2026-04-23T12:00:00Z"),
      taxRates: {
        incomeTax: 20,
        corporateTax: 19,
        payrollTax: 12,
        tariffs: 0,
        salesTax: 20,
      },
    });

    const { GET } = await import("@/app/api/country/[code]/policy/route");
    const response = await GET(
      new Request("http://localhost/api/country/uk/policy?scope=national"),
      { params: Promise.resolve({ code: "uk" }) }
    );

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          legislationTypeId: "uk_domestic_corporation_tax",
          policyOptionName: "19%",
        }),
        expect.objectContaining({
          legislationTypeId: "uk_foreign_corporation_tax",
          policyOptionName: "19%",
        }),
      ])
    );
  });

  it("includes active tariff records in the national policy response", async () => {
    db.collection("statePolicies");
    db.collection("legislationTypes");
    db.collection("federalBudget");
    db.collection("bills");
    db.collection("tariffs");

    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      updatedAt: new Date("2026-04-25T12:00:00Z"),
      taxRates: {
        incomeTax: 20,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15,
        tariffs: 0,
        salesTax: 0,
      },
    });
    db.collectionMocks.bills.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
    db.collectionMocks.tariffs.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "tariff1",
            countryId: "US",
            scopeType: "origin_country",
            targetOriginCountryId: "JP",
            rate: 40,
            sourceBillId: "bill1",
            createdAt: new Date("2026-04-25T05:22:05Z"),
            updatedAt: new Date("2026-04-25T05:22:05Z"),
          },
          {
            _id: "tariff2",
            countryId: "US",
            scopeType: "sector",
            targetSectorType: "steel",
            rate: 15,
            sourceBillId: "bill2",
            createdAt: new Date("2026-04-25T05:22:06Z"),
            updatedAt: new Date("2026-04-25T05:22:06Z"),
          },
        ]),
      }),
    });

    const { GET } = await import("@/app/api/country/[code]/policy/route");
    const response = await GET(
      new Request("http://localhost/api/country/us/policy?scope=national"),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: "tariff",
          policyDomain: "trade",
          policyOptionName: "40% tariff",
          detailText: "Imports from Japan",
          tariffScopeType: "origin_country",
        }),
        expect.objectContaining({
          recordType: "tariff",
          policyDomain: "trade",
          policyOptionName: "15% tariff",
          detailText: "Steel sector imports",
          tariffScopeType: "sector",
        }),
      ])
    );
  });

  it("includes active subsidy records in the national policy response", async () => {
    db.collection("statePolicies");
    db.collection("legislationTypes");
    db.collection("federalBudget");

    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      updatedAt: new Date("2026-04-25T12:00:00Z"),
      taxRates: {
        incomeTax: 20,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15,
        tariffs: 0,
        salesTax: 0,
      },
    });
    db.collectionMocks.bills.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
    db.collectionMocks.tariffs.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
    db.collectionMocks.subsidies.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "subsidy1",
            countryId: "US",
            scope: "national",
            scopeType: "economy_wide",
            domesticOnly: true,
            active: true,
            sourceBillId: "bill1",
            createdAt: new Date("2026-04-25T05:22:05Z"),
            updatedAt: new Date("2026-04-25T05:22:05Z"),
          },
          {
            _id: "subsidy2",
            countryId: "US",
            scope: "national",
            scopeType: "sector",
            targetSectorType: "construction",
            targetStrategyId: "premium",
            domesticOnly: false,
            active: true,
            sourceBillId: "bill2",
            createdAt: new Date("2026-04-25T05:22:06Z"),
            updatedAt: new Date("2026-04-25T05:22:06Z"),
          },
        ]),
      }),
    });

    const { GET } = await import("@/app/api/country/[code]/policy/route");
    const response = await GET(
      new Request("http://localhost/api/country/us/policy?scope=national"),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: "subsidy",
          policyDomain: "economic",
          policyOptionName: "+7.5% margin subsidy",
          detailText: "National | Economy-wide | Domestic only",
          subsidyScope: "national",
          subsidyScopeType: "economy_wide",
        }),
        expect.objectContaining({
          recordType: "subsidy",
          policyDomain: "economic",
          policyOptionName: "+7.5% margin subsidy",
          detailText: "National | Construction sector | Strategy: premium",
          subsidyScope: "national",
          subsidyScopeType: "sector",
          subsidyTargetSectorType: "construction",
          subsidyTargetStrategyId: "premium",
        }),
      ])
    );
  });

  it("shows baseline economy-wide tariffs after reset when no tariff bills have passed yet", async () => {
    db.collection("statePolicies");
    db.collection("legislationTypes");
    db.collection("federalBudget");
    db.collection("bills");
    db.collection("tariffs");

    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      updatedAt: new Date("2026-04-25T12:00:00Z"),
      taxRates: {
        incomeTax: 20,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15,
        tariffs: 0,
        salesTax: 0,
      },
    });
    db.collectionMocks.tariffs.findOne.mockResolvedValue(null);
    db.collectionMocks.bills.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
    db.collectionMocks.tariffs.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "baselineTariff",
            countryId: "US",
            scopeType: "economy_wide",
            rate: 0,
            sourceBillId: "baselineBill",
            createdAt: new Date("2026-04-25T05:22:05Z"),
            updatedAt: new Date("2026-04-25T05:22:05Z"),
          },
        ]),
      }),
    });

    const { GET } = await import("@/app/api/country/[code]/policy/route");
    const response = await GET(
      new Request("http://localhost/api/country/us/policy?scope=national"),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: "tariff",
          policyDomain: "trade",
          policyOptionName: "0% tariff",
          detailText: "All imports",
          tariffScopeType: "economy_wide",
        }),
      ])
    );
  });

  it("labels a zero-percent economy-wide tariff as all other imports when specific tariffs exist", async () => {
    db.collection("statePolicies");
    db.collection("legislationTypes");
    db.collection("federalBudget");
    db.collection("bills");
    db.collection("tariffs");

    db.collectionMocks.statePolicies.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.legislationTypes.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      _id: "federal",
      taxRates: {
        incomeTax: 25,
        domesticCorporateTax: 21,
        foreignCorporateTax: 21,
        payrollTax: 15,
        tariffs: 0,
        salesTax: 0,
      },
    });
    db.collectionMocks.bills.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
    });
    db.collectionMocks.tariffs.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: "baselineTariff",
            countryId: "US",
            scopeType: "economy_wide",
            rate: 0,
            sourceBillId: "baselineBill",
            createdAt: new Date("2026-04-25T05:22:05Z"),
            updatedAt: new Date("2026-04-25T05:22:05Z"),
          },
          {
            _id: "countryTariff",
            countryId: "US",
            scopeType: "origin_country",
            targetOriginCountryId: "JP",
            rate: 27,
            sourceBillId: "bill1",
            createdAt: new Date("2026-04-25T05:22:06Z"),
            updatedAt: new Date("2026-04-25T05:22:06Z"),
          },
        ]),
      }),
    });

    const { GET } = await import("@/app/api/country/[code]/policy/route");
    const response = await GET(
      new Request("http://localhost/api/country/US/policy?scope=national"),
      { params: Promise.resolve({ code: "US" }) }
    );
    const body = await response.json();

    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordType: "tariff",
          policyDomain: "trade",
          policyOptionName: "0% tariff",
          detailText: "All other imports",
          tariffScopeType: "economy_wide",
        }),
        expect.objectContaining({
          recordType: "tariff",
          policyDomain: "trade",
          policyOptionName: "27% tariff",
          detailText: "Imports from Japan",
          tariffScopeType: "origin_country",
        }),
      ])
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/metricHistory", () => ({ getMetricHistory: vi.fn() }));
vi.mock("@/lib/api/stateTickRates", () => ({
  computeStateTickRates: vi.fn(),
  computeNationalMetricTickRate: vi.fn(),
}));

describe("GET /api/country/[code]/region/[id]/metrics/[category]/[metricId]", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { getMetricHistory } = await import("@/lib/metricHistory");
    vi.mocked(getMetricHistory).mockResolvedValue([{ turn: 11, value: 9.25 }]);

    const { computeNationalMetricTickRate, computeStateTickRates } =
      await import("@/lib/api/stateTickRates");
    vi.mocked(computeNationalMetricTickRate).mockResolvedValue(0.15);
    vi.mocked(computeStateTickRates).mockResolvedValue({});

    db.collection("macroMetrics");
    db.collectionMocks["macroMetrics"].findOne.mockImplementation(({ _id }: { _id: string }) => {
      if (_id === "federal") {
        return Promise.resolve({
          _id: "federal",
          economic: { unemploymentRate: { value: 9.5 }, gdpGrowth: { value: 1.4 } },
        });
      }
      if (_id === "jp_national") {
        return Promise.resolve({
          _id: "jp_national",
          economic: { unemploymentRate: { value: 5.04 } },
        });
      }
      return Promise.resolve(null);
    });
    db.collectionMocks["macroMetrics"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "TX", economic: { unemploymentRate: { value: 5 }, gdpGrowth: { value: 2 } } },
        { _id: "NY", economic: { unemploymentRate: { value: 3 }, gdpGrowth: { value: 1 } } },
        {
          _id: "federal",
          economic: { unemploymentRate: { value: 9.5 }, gdpGrowth: { value: 1.4 } },
        },
        { _id: "jp_national", economic: { unemploymentRate: { value: 5.04 } } },
      ]),
    });

    db.collection("statePolicies");
    db.collectionMocks["statePolicies"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    db.collection("legislationTypes");
    db.collectionMocks["legislationTypes"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
  });

  it("returns stored national values with history for the federal scope", async () => {
    const { GET } =
      await import("@/app/api/country/[code]/region/[id]/metrics/[category]/[metricId]/route");

    const response = await GET(
      new Request(
        "http://localhost/api/country/us/region/federal/metrics/economic/unemploymentRate"
      ),
      {
        params: Promise.resolve({
          code: "us",
          id: "federal",
          category: "economic",
          metricId: "unemploymentRate",
        }),
      }
    );

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.value).toBe(9.5);
    expect(body.history).toEqual([{ turn: 11, value: 9.25 }]);
    expect(body.tickRate).toBe(0.15);
    expect(body.globalAverage).toBe(4);
  });

  it("resolves national-scope jp_national (regression: duplicate NATIONAL_COUNTRY map was missing JP)", async () => {
    const { GET } =
      await import("@/app/api/country/[code]/region/[id]/metrics/[category]/[metricId]/route");

    const response = await GET(
      new Request(
        "http://localhost/api/country/jp/region/jp_national/metrics/economic/unemploymentRate"
      ),
      {
        params: Promise.resolve({
          code: "jp",
          id: "jp_national",
          category: "economic",
          metricId: "unemploymentRate",
        }),
      }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stateId).toBe("jp_national");
    expect(body.value).toBe(5.04);
  });

  it("shows enacted federal sales tax as GDP-growth drag even before legislation metadata is reseeded", async () => {
    db.collectionMocks["statePolicies"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          stateId: "federal",
          legislationTypeId: "us_federal_sales_tax_rate",
          policyOptionId: "federal_sales_tax_rate_opt_5",
          effectDirection: 0,
          economic: 2,
          social: 0,
        },
      ]),
    });
    db.collectionMocks["legislationTypes"].find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "us_federal_sales_tax_rate",
          name: "Federal Sales Tax Rate",
          taxRateChange: { scope: "federal", taxType: "salesTax" },
          policyOptions: [
            {
              id: "federal_sales_tax_rate_opt_5",
              name: "10%",
              rate: 10,
              economic: 2,
              social: 0,
              effectDirection: 0,
            },
          ],
        },
      ]),
    });

    const { GET } =
      await import("@/app/api/country/[code]/region/[id]/metrics/[category]/[metricId]/route");

    const response = await GET(
      new Request("http://localhost/api/country/us/region/federal/metrics/economic/gdpGrowth"),
      {
        params: Promise.resolve({
          code: "us",
          id: "federal",
          category: "economic",
          metricId: "gdpGrowth",
        }),
      }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.affectingPolicies).toContainEqual({
      name: "Federal Sales Tax Rate",
      policyOptionName: "10%",
      pushesMetricUp: false,
      weight: 10,
      scope: "national",
    });
  });
});

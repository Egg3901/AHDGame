import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/indexFunds/featureFlag", () => ({ getIndexFundsMode: vi.fn() }));
vi.mock("@/lib/indexFunds/fundDefinitions", () => ({ getAllFundDefinitions: vi.fn() }));
vi.mock("@/lib/indexFunds/fundQueries", () => ({ listFunds: vi.fn() }));

describe("GET /api/admin/investment-funds/diagnostics", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getIndexFundsMode } = await import("@/lib/indexFunds/featureFlag");
    const { getAllFundDefinitions } = await import("@/lib/indexFunds/fundDefinitions");
    const { listFunds } = await import("@/lib/indexFunds/fundQueries");

    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: "admin1", username: "admin", role: "admin", isAdmin: true },
    } as any);
    vi.mocked(getIndexFundsMode).mockResolvedValue("partial");
    vi.mocked(getAllFundDefinitions).mockReturnValue([
      {
        slug: "global_top_50",
        name: "Global Top 50 Index",
        ticker: "GLB50",
        scope: "global",
        kind: "broad",
        anchorCurrencyCode: "USD",
        topN: 50,
      },
      {
        slug: "us_top_25",
        name: "US Large-Cap 25 Index",
        ticker: "US25",
        scope: "country",
        kind: "broad",
        countryId: "US",
        anchorCurrencyCode: "USD",
        topN: 25,
      },
      {
        slug: "uk_top_25",
        name: "FTSE 25 Index",
        ticker: "UK25",
        scope: "country",
        kind: "broad",
        countryId: "UK",
        anchorCurrencyCode: "GBP",
        topN: 25,
      },
      {
        slug: "global_sector_financial",
        name: "Global Financials Index",
        ticker: "GLBFIN",
        scope: "global",
        kind: "sector",
        sectorType: "financial",
        anchorCurrencyCode: "USD",
      },
    ] as any);
    vi.mocked(listFunds).mockResolvedValue([]);

    db.collectionMocks.migrationsRun = {
      findOne: vi.fn().mockResolvedValue(null),
    } as any;
  });

  it("returns diagnostics when all expected funds are missing", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.featureFlag).toEqual({ mode: "partial", enabled: true });
    expect(json.migration.markerPresent).toBe(false);
    expect(json.summary).toEqual({
      totalExpected: 4,
      totalInDb: 0,
      missing: 4,
      paused: 0,
      delisted: 0,
      active: 0,
    });
    expect(json.expectedFunds.every((f: any) => f.actual === null)).toBe(true);
    expect(json.expectedFunds.every((f: any) => f.issues.length > 0)).toBe(true);
  });

  it("flags paused and scope-mismatched funds", async () => {
    const { listFunds } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(listFunds).mockResolvedValue([
      {
        _id: "global_top_50_id",
        slug: "global_top_50",
        name: "Global Top 50 Index",
        tickerSymbol: "GLB50",
        scope: "global",
        kind: "broad",
        anchorCurrencyCode: "USD",
        status: "paused",
        pauseReason: "backing_ratio",
        targetConstituents: [],
        holdings: [],
      },
      {
        _id: "uk_top_25_id",
        slug: "uk_top_25",
        name: "FTSE 25 Index",
        tickerSymbol: "UK25",
        scope: "global", // wrong scope
        kind: "broad",
        anchorCurrencyCode: "GBP",
        status: "active",
        targetConstituents: [],
        holdings: [],
      },
    ] as any);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    const globalTop = json.expectedFunds.find((f: any) => f.slug === "global_top_50");
    expect(globalTop.issues.some((i: string) => i.includes("paused"))).toBe(true);
    expect(globalTop.visibleOnGlobal).toBe(true);

    const ukTop = json.expectedFunds.find((f: any) => f.slug === "uk_top_25");
    expect(ukTop.issues.some((i: string) => i.includes("scope mismatch"))).toBe(true);
    expect(ukTop.visibleOnOwnCountry).toBe(false);
  });

  it("reports active funds as visible on correct exchanges", async () => {
    const { listFunds } = await import("@/lib/indexFunds/fundQueries");
    vi.mocked(listFunds).mockResolvedValue([
      {
        _id: "global_top_50_id",
        slug: "global_top_50",
        status: "active",
        scope: "global",
        kind: "broad",
        anchorCurrencyCode: "USD",
        targetConstituents: [],
        holdings: [],
      },
      {
        _id: "uk_top_25_id",
        slug: "uk_top_25",
        status: "active",
        scope: "country",
        kind: "broad",
        countryId: "UK",
        anchorCurrencyCode: "GBP",
        targetConstituents: [],
        holdings: [],
      },
    ] as any);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    const globalTop = json.expectedFunds.find((f: any) => f.slug === "global_top_50");
    expect(globalTop.issues).toHaveLength(0);
    expect(globalTop.visibleOnGlobal).toBe(true);

    const ukTop = json.expectedFunds.find((f: any) => f.slug === "uk_top_25");
    expect(ukTop.issues).toHaveLength(0);
    expect(ukTop.visibleOnOwnCountry).toBe(true);
  });

  it("returns 401 when admin auth fails", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

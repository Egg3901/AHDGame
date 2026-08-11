import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import {
  classifyMetricDrift,
  classifyUsdGdpPerCapita,
  trajectoryExpected,
  DEFAULT_GDP_GROWTH_PCT,
  DEFAULT_POP_GROWTH_PCT,
  USD_GDP_PER_CAPITA_BANDS,
  runDriftChecks,
} from "./drift";
import { compoundAnnual, yearsFromCalendarTurn, warnTol, criticalTol } from "./tolerance";
import { getBankId } from "@/lib/centralBank/helpers";

type CollMock = {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
};

function cursorOf(rows: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function makeDriftDb(opts: {
  gameState?: Record<string, unknown> | null;
  gameConfig?: Record<string, unknown> | null;
  budgets?: unknown[];
  exchangeRates?: unknown[];
  centralBanks?: unknown[];
  unownedSectors?: unknown[];
  corporations?: unknown[];
  commodityPrices?: unknown[];
  baseline?: Record<string, unknown> | null;
  ledger?: Record<string, unknown> | null;
}): Db {
  const collections: Record<string, CollMock> = {};
  const getColl = (name: string): CollMock => {
    if (collections[name]) return collections[name]!;
    const coll: CollMock = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue(cursorOf([])),
    };
    collections[name] = coll;
    return coll;
  };

  getColl("gameState").findOne.mockResolvedValue(opts.gameState ?? null);
  getColl("gameConfig").findOne.mockResolvedValue(opts.gameConfig ?? { _id: "default" });
  getColl("federalBudget").find.mockReturnValue(cursorOf(opts.budgets ?? []));
  getColl("exchangeRates").find.mockReturnValue(cursorOf(opts.exchangeRates ?? []));
  getColl("centralBanks").find.mockReturnValue(cursorOf(opts.centralBanks ?? []));
  getColl("unownedSectors").find.mockReturnValue(cursorOf(opts.unownedSectors ?? []));
  getColl("corporations").find.mockReturnValue(cursorOf(opts.corporations ?? []));
  getColl("commodityPrices").find.mockReturnValue(cursorOf(opts.commodityPrices ?? []));
  getColl("seedDiagnosticBaselines").findOne.mockResolvedValue(opts.baseline ?? null);
  getColl("ledgerReconciliations").findOne.mockResolvedValue(opts.ledger ?? null);

  return {
    collection: vi.fn().mockImplementation((name: string) => getColl(name)),
  } as unknown as Db;
}

describe("trajectoryExpected", () => {
  it("compounds GDP by era trend (or default) over calendar years", () => {
    const years = yearsFromCalendarTurn(96); // 2 years
    const baseline = 1000;
    const expected = trajectoryExpected({
      baseline,
      metricId: "budget.US.gdp",
      calendarTurn: 96,
      countryId: "US",
      startingYear: 2019,
      currentYear: 2021,
    });
    // US has no era trendGdpGrowth at modern years → DEFAULT_GDP_GROWTH_PCT
    expect(expected).toBeCloseTo(compoundAnnual(baseline, DEFAULT_GDP_GROWTH_PCT, years), 10);
  });

  it("compounds population at DEFAULT_POP_GROWTH_PCT", () => {
    const years = yearsFromCalendarTurn(48);
    const expected = trajectoryExpected({
      baseline: 100,
      metricId: "budget.US.population",
      calendarTurn: 48,
      countryId: "US",
      startingYear: 2019,
      currentYear: 2020,
    });
    expect(expected).toBeCloseTo(compoundAnnual(100, DEFAULT_POP_GROWTH_PCT, years), 10);
  });

  it("compounds a sub-1% GDP trend as percent, not a fraction", () => {
    // Direct compoundAnnual contract used by trajectory (era trends are percent).
    const years = yearsFromCalendarTurn(48);
    const expected = compoundAnnual(1000, 0.8, years);
    expect(expected).toBeCloseTo(1000 * Math.pow(1 + 0.8 / 100, 1), 10);
    expect(expected).toBeLessThan(1010);
  });

  it("leaves rates and forex flat", () => {
    expect(
      trajectoryExpected({
        baseline: 106,
        metricId: "forex.JP.rate",
        calendarTurn: 480,
        countryId: "JP",
        startingYear: 2019,
        currentYear: 2029,
      })
    ).toBe(106);

    expect(
      trajectoryExpected({
        baseline: 5.25,
        metricId: "centralBank.US.primeRate",
        calendarTurn: 240,
        countryId: "US",
        startingYear: 2019,
        currentYear: 2024,
      })
    ).toBe(5.25);
  });

  it("compounds nominal stocks by era inflation", () => {
    const years = yearsFromCalendarTurn(48);
    const expected = trajectoryExpected({
      baseline: 1000,
      metricId: "budget.US.debt.principal",
      calendarTurn: 48,
      countryId: "US",
      startingYear: 2019,
      currentYear: 2020,
    });
    // Modern US falls through to currencies table targetInflation (typically 2).
    expect(expected).toBeGreaterThan(1000);
    expect(expected).toBeCloseTo(compoundAnnual(1000, 2.0, years), 5);
  });
});

describe("classifyMetricDrift tolerance escalation", () => {
  it("widens tolerance with turns and still flags magnitude breaks", () => {
    const early = classifyMetricDrift({
      metricId: "budget.US.gdp",
      baseline: 100,
      actual: 120, // 20% over flat; at t=1 warnTol≈15% so this may warn once trajectory applied
      calendarTurn: 1,
      countryId: "US",
      startingYear: 2019,
      currentYear: 2019,
    });
    const late = classifyMetricDrift({
      metricId: "budget.US.gdp",
      baseline: 100,
      actual: 120,
      calendarTurn: 480,
      countryId: "US",
      startingYear: 2019,
      currentYear: 2029,
    });

    expect(early.tolerancePct).toBeDefined();
    expect(late.tolerancePct).toBeDefined();
    expect(late.tolerancePct!).toBeGreaterThan(early.tolerancePct!);
    expect(warnTol(480, "gdp")).toBeCloseTo(0.4, 10);
    expect(criticalTol(480, "gdp")).toBeCloseTo(0.8, 10);

    const mag = classifyMetricDrift({
      metricId: "forex.JP.rate",
      baseline: 100,
      actual: 10_000, // 100×
      calendarTurn: 1,
      countryId: "JP",
      startingYear: 2019,
      currentYear: 2019,
    });
    expect(mag.severity).toBe("critical");
    expect(mag.note).toBe("magnitude break");
  });
});

describe("classifyUsdGdpPerCapita", () => {
  it("accepts in-band values and flags extreme mis-scaling", () => {
    const ok = classifyUsdGdpPerCapita({
      countryId: "US",
      gdpLocal: 27_000_000_000_000,
      population: 333_000_000,
      forexRate: 1,
      era: "2019",
    });
    expect(ok.severity).toBe("ok");
    expect(ok.actual).toBeCloseTo(27e12 / 333e6, 0);

    const broken = classifyUsdGdpPerCapita({
      countryId: "JP",
      gdpLocal: 550_000_000_000_000,
      population: 126_000_000,
      forexRate: 1, // forgot forex → treats yen as dollars → ~$4.4M/capita
      era: "2019",
    });
    expect(broken.severity).toBe("critical");
    expect(String(broken.expected)).toContain(String(USD_GDP_PER_CAPITA_BANDS["2019"].max));
  });

  it("uses era-specific bands (1953 ceiling below modern US)", () => {
    const modernIn1953 = classifyUsdGdpPerCapita({
      countryId: "US",
      gdpLocal: 27_000_000_000_000,
      population: 158_000_000,
      forexRate: 1,
      era: "1953",
    });
    expect(modernIn1953.severity).toBe("critical");
  });
});

describe("runDriftChecks", () => {
  it("reconstructs baseline from expectations when snapshot missing", async () => {
    const db = makeDriftDb({
      gameState: {
        _id: "current",
        preset: "2019-default",
        startingYear: 2019,
        currentYear: 2019,
        currentTurn: 10,
      },
      baseline: null,
      budgets: [
        {
          countryId: "US",
          gdp: 27_000_000_000_000,
          population: 333_000_000,
          treasuryBalance: -30e12,
          debt: { principal: 30e12, interestRate: 0.03 },
        },
      ],
      exchangeRates: [{ countryId: "US", rate: 1, baseRate: 1 }],
      centralBanks: [
        {
          _id: getBankId("US"),
          countryId: "US",
          primeRate: 5.25,
          inflationHistory: [{ turn: 1, rate: 2 }],
        },
      ],
    });

    const result = await runDriftChecks(db, { preset: "2019-default", calendarTurn: 10 });
    expect(result.reconstructed).toBe(true);
    expect(result.note).toMatch(/reconstructed baseline/);
    const source = result.checks.find((c) => c.id === "baseline.source");
    expect(source?.severity).toBe("warn");
    expect(result.checks.some((c) => c.id === "budget.US.usdGdpPerCapita")).toBe(true);
  });

  it("uses stored baseline metrics when present", async () => {
    const db = makeDriftDb({
      gameState: {
        _id: "current",
        preset: "2019-default",
        startingYear: 2019,
        currentYear: 2019,
        currentTurn: 50,
      },
      baseline: {
        _id: "current",
        preset: "2019-default",
        capturedAt: new Date(),
        turn: 1,
        calendarTurn: 1,
        metrics: {
          "budget.US.gdp": 27_000_000_000_000,
          "budget.US.population": 333_000_000,
          "forex.US.rate": 1,
        },
      },
      budgets: [
        {
          countryId: "US",
          gdp: 27_000_000_000_000,
          population: 333_000_000,
          treasuryBalance: -30e12,
          debt: { principal: 30e12, interestRate: 0.03 },
        },
      ],
      exchangeRates: [{ countryId: "US", rate: 1, baseRate: 1 }],
    });

    const result = await runDriftChecks(db, { preset: "2019-default", calendarTurn: 50 });
    expect(result.reconstructed).toBe(false);
    const source = result.checks.find((c) => c.id === "baseline.source");
    expect(source?.severity).toBe("ok");
    const gdp = result.checks.find((c) => c.id === "budget.US.gdp");
    expect(gdp).toBeDefined();
    expect(gdp?.severity).toBe("ok");
  });

  it("flags magnitude-break forex against baseline", async () => {
    const db = makeDriftDb({
      gameState: {
        _id: "current",
        preset: "2019-default",
        startingYear: 2019,
        currentYear: 2019,
        currentTurn: 20,
      },
      baseline: {
        _id: "current",
        preset: "2019-default",
        capturedAt: new Date(),
        turn: 1,
        calendarTurn: 1,
        metrics: { "forex.JP.rate": 106 },
      },
      budgets: [],
      exchangeRates: [{ countryId: "JP", rate: 10600, baseRate: 106 }],
      centralBanks: [],
    });

    const result = await runDriftChecks(db, { preset: "2019-default", calendarTurn: 20 });
    const forex = result.checks.find((c) => c.id === "forex.JP.rate");
    expect(forex?.severity).toBe("critical");
    expect(forex?.note).toBe("magnitude break");
  });

  it("does not magnitude-break a treasury sign flip over many turns", async () => {
    // Running cash balance going from deep debt to surplus is normal; only
    // checkTreasurySign applies (warn at most), never classifyMetricDrift.
    const db = makeDriftDb({
      gameState: {
        _id: "current",
        preset: "1953-default",
        startingYear: 1953,
        currentYear: 1957,
        currentTurn: 200,
      },
      baseline: {
        _id: "current",
        preset: "1953-default",
        capturedAt: new Date(),
        turn: 1,
        calendarTurn: 1,
        metrics: {
          "budget.US.treasuryBalance": -275_000_000_000,
          "budget.US.gdp": 387_000_000_000,
          "budget.US.population": 158_000_000,
          "forex.US.rate": 1,
        },
      },
      budgets: [
        {
          countryId: "US",
          gdp: 387_000_000_000,
          population: 158_000_000,
          treasuryBalance: 50_000_000_000,
          debt: { principal: 0, interestRate: 0.025 },
        },
      ],
      exchangeRates: [{ countryId: "US", rate: 1, baseRate: 1 }],
    });

    const result = await runDriftChecks(db, { preset: "1953-default", calendarTurn: 200 });
    const treasuryDrift = result.checks.filter((c) => c.id === "budget.US.treasuryBalance");
    expect(treasuryDrift).toHaveLength(0);
    const criticals = result.checks.filter((c) => c.severity === "critical");
    expect(criticals.every((c) => !c.id.endsWith(".treasuryBalance"))).toBe(true);
    expect(result.checks.some((c) => c.id === "budget.US.treasurySign")).toBe(true);
  });

  it("exempts command-economy forex when the flag is on", async () => {
    const db = makeDriftDb({
      gameState: {
        _id: "current",
        preset: "1953-default",
        startingYear: 1953,
        currentYear: 1953,
        currentTurn: 50,
      },
      gameConfig: { _id: "default", commandEconomyEnabled: true },
      baseline: {
        _id: "current",
        preset: "1953-default",
        capturedAt: new Date(),
        turn: 1,
        calendarTurn: 1,
        metrics: { "forex.RU.rate": 4 },
      },
      budgets: [],
      exchangeRates: [{ countryId: "RU", rate: 40, baseRate: 4 }],
    });

    const result = await runDriftChecks(db, { preset: "1953-default", calendarTurn: 50 });
    const forex = result.checks.find((c) => c.id === "forex.RU.rate");
    expect(forex?.severity).toBe("ok");
    expect(forex?.note).toMatch(/command-economy exempt/);
  });
});

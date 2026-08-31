/**
 * Tests for recalculateInflationPerTurn — the DB orchestrator that collects
 * central bank + budget data and persists updated inflation rates each turn.
 *
 * The pure math is tested in budget/inflation.test.ts; these tests focus on:
 *   - Presidential vs. parliamentary budget ID resolution
 *   - Early-exit when there are no banks
 *   - Skipping banks with no matching COUNTRY_CONFIGS entry
 *   - Self-healing banks whose budget document is missing (ensureFederalBudget)
 *   - Correct persistence ($set fields and upsert behaviour)
 *   - Multi-country processing and returned count
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// Mock calculateCountryInflation so tests isolate the orchestrator, not the
// economic formula (which has its own test suite in budget/inflation.test.ts).
const mockCalculateCountryInflation = vi.fn().mockResolvedValue(3.5);
vi.mock("@/lib/budget/inflation", () => ({
  calculateCountryInflation: (...args: unknown[]) => mockCalculateCountryInflation(...args),
}));

// Minimal COUNTRY_CONFIGS with one presidential entry, one parliamentary entry,
// DE on the ECB shared bank, and IE on its own Central Bank of Ireland.
// COUNTRY_ORDER is required by getCentralBankScope / helpers.ts.
vi.mock("@/lib/constants/countries", () => {
  // The mock replaces the whole module, so an export it omits is a hard failure
  // rather than a fallback to the real one. COUNTRY_CONFIGS is shared so
  // getCountryConfig resolves against the same table.
  const COUNTRY_CONFIGS: Record<string, unknown> = {
    US: { id: "US", governmentType: "presidential", centralBank: {}, officeTypes: [] },
    UK: { id: "UK", governmentType: "parliamentaryMonarchy", centralBank: {}, officeTypes: [] },
    DE: {
      id: "DE",
      governmentType: "parliamentary",
      centralBank: { sharedBankId: "ECB", centralBankIntorgId: "EU" },
      officeTypes: [],
    },
    IE: {
      id: "IE",
      governmentType: "parliamentary",
      centralBank: {},
      officeTypes: [],
    },
  };
  return {
    COUNTRY_ORDER: ["US", "UK", "DE", "IE"],
    getCountryDisplayName: (id: string) => id,
    COUNTRY_CONFIGS,
    // #901's budget path now resolves country config through getCountryConfig;
    // mirror the real accessor (COUNTRY_CONFIGS[id], preset overrides unused here).
    getCountryConfig: (id: string) => COUNTRY_CONFIGS[id],
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCentralBank(countryId: string, primeRate = 3.0) {
  return {
    _id: countryId,
    countryId,
    primeRate,
    interestRateHistory: [] as { turn: number; rate: number }[],
  };
}

function makeBudget(id: string, inflationRate = 2.5) {
  return {
    _id: id,
    countryId: id === "federal" ? "US" : id,
    surplus: 0,
    gdp: 20_000_000_000_000,
    taxRates: { tariffs: 3.0 },
    economicFactors: { inflationRate, wageGrowth: 2.5 },
  };
}

function setupBanks(db: MockDb, banks: ReturnType<typeof makeCentralBank>[]) {
  const cursor = {
    toArray: vi.fn().mockResolvedValue(banks),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
  db.collection("centralBanks");
  db.collectionMocks["centralBanks"]!.find = vi.fn().mockReturnValue(cursor);
}

function setupBudget(db: MockDb, budget: ReturnType<typeof makeBudget> | null, budgetId: string) {
  db.collection("federalBudget");
  db.collectionMocks["federalBudget"]!.findOne = vi
    .fn()
    .mockImplementation((filter: { _id: string }) =>
      filter._id === budgetId ? Promise.resolve(budget) : Promise.resolve(null)
    );
}

function setupCommodityPrices(
  db: MockDb,
  docs: { commodity: string; basePrice: number; nationalPrices: Record<string, number> }[]
) {
  const cursor = {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
  db.collection("commodityPrices");
  db.collectionMocks["commodityPrices"]!.find = vi.fn().mockReturnValue(cursor);
}

function setupCommodityPriceHistory(
  db: MockDb,
  docs: { commodity: string; turn: number; nationalPrices: Record<string, number> }[]
) {
  // The recalc reads this collection at three different turns (current, one game
  // year back, one quarter back), so the mock has to honour the filter's `turn`
  // rather than handing every query the same rows.
  db.collection("commodityPriceHistory");
  db.collectionMocks["commodityPriceHistory"]!.find = vi
    .fn()
    .mockImplementation((filter?: { turn?: number }) => {
      const matched = filter?.turn == null ? docs : docs.filter((d) => d.turn === filter.turn);
      return {
        toArray: vi.fn().mockResolvedValue(matched),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
    });
}

function setupExchangeRates(
  db: MockDb,
  docs: {
    _id: string;
    countryId: string;
    rate: number;
    baseRate: number;
    rateHistory?: { turn: number; rate: number }[];
  }[]
) {
  const cursor = {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
  db.collection("exchangeRates");
  db.collectionMocks["exchangeRates"]!.find = vi.fn().mockReturnValue(cursor);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  mockCalculateCountryInflation.mockResolvedValue(3.5);
});

describe("recalculateInflationPerTurn", () => {
  // ── Early exit ─────────────────────────────────────────────────────────────

  it("returns 0 immediately when no central banks exist", async () => {
    setupBanks(db, []);

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(result).toBe(0);
    // No budget or update queries should fire
    expect(db.collectionMocks["federalBudget"]).toBeUndefined();
  });

  it("forwards the bank's policyInflationPressure into calculateCountryInflation", async () => {
    const bank = { ...makeCentralBank("US"), policyInflationPressure: -0.4 };
    setupBanks(db, [bank]);
    setupBudget(db, makeBudget("federal"), "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(mockCalculateCountryInflation).toHaveBeenCalled();
    const call = mockCalculateCountryInflation.mock.calls[0]!;
    // Signature: (db, countryId, budget, commodity, forex, savings, policyStancePressure)
    expect(call[6]).toBeCloseTo(-0.4, 10);
  });

  // ── Budget ID resolution ──────────────────────────────────────────────────

  it("uses 'federal' as budget ID for presidential systems (US)", async () => {
    const bank = makeCentralBank("US");
    const budget = makeBudget("federal");

    setupBanks(db, [bank]);
    setupBudget(db, budget, "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(result).toBe(1);

    // findOne must have been called with { _id: "federal" }
    expect(db.collectionMocks["federalBudget"]!.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "federal" })
    );
  });

  it("uses countryId as budget ID for parliamentary systems (UK)", async () => {
    const bank = makeCentralBank("UK");
    const budget = makeBudget("UK");

    setupBanks(db, [bank]);
    setupBudget(db, budget, "UK");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(result).toBe(1);

    expect(db.collectionMocks["federalBudget"]!.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "UK" })
    );
  });

  // ── Skipping ──────────────────────────────────────────────────────────────

  it("skips banks whose countryId has no COUNTRY_CONFIGS entry", async () => {
    // "ZZ" is not in our mocked COUNTRY_CONFIGS
    const bank = makeCentralBank("ZZ");
    setupBanks(db, [bank]);

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(result).toBe(0);
    expect(mockCalculateCountryInflation).not.toHaveBeenCalled();
  });

  it("self-heals a missing budget document instead of silently skipping the country", async () => {
    // Regression test for the sandbox-seed-audit-t101 bug: a country with a
    // live central bank but no federalBudget doc (e.g. bootstrapped via a
    // partial seed path) used to be skipped forever with no persisted trace.
    // ensureFederalBudget() should now seed a preset default on first
    // encounter so the country starts accruing fiscal history immediately.
    const bank = makeCentralBank("US");
    setupBanks(db, [bank]);
    const seeded = makeBudget("federal", 2.5);
    let findOneCalls = 0;
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.findOne = vi.fn().mockImplementation(() => {
      findOneCalls += 1;
      // 1st call: ensureFederalBudget's existence check (not seeded yet).
      // 2nd call: ensureFederalBudget's re-fetch after the upsert below.
      return Promise.resolve(findOneCalls === 1 ? null : seeded);
    });

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(db.collectionMocks["federalBudget"]!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "federal" }),
      expect.objectContaining({ $setOnInsert: expect.anything() }),
      expect.objectContaining({ upsert: true })
    );
    expect(result).toBe(1);
  });

  // ── Persistence ───────────────────────────────────────────────────────────

  it("persists the new inflation rate to the budget document", async () => {
    mockCalculateCountryInflation.mockResolvedValue(4.2);

    const bank = makeCentralBank("US");
    const budget = makeBudget("federal", 2.0);
    setupBanks(db, [bank]);
    setupBudget(db, budget, "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(db.collectionMocks["federalBudget"]!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "federal" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          "economicFactors.inflationRate": 4.2,
          "economicFactors.householdPriceIndex": expect.closeTo(1.00065625, 12),
        }),
      })
    );
  });

  it("sets lastUpdated timestamp on the persisted document", async () => {
    const beforeCall = new Date();

    const bank = makeCentralBank("US");
    const budget = makeBudget("federal");
    setupBanks(db, [bank]);
    setupBudget(db, budget, "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    const updateCall = db.collectionMocks["federalBudget"]!.updateOne.mock.calls[0];
    const setOp = (updateCall[1] as { $set: Record<string, unknown> }).$set;
    const lastUpdated = setOp["economicFactors.lastUpdated"] as Date;

    expect(lastUpdated).toBeInstanceOf(Date);
    expect(lastUpdated.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());
  });

  it("passes the budget document through to calculateCountryInflation", async () => {
    const bank = makeCentralBank("US", 5.0);
    const budget = makeBudget("federal", 3.0);
    setupBanks(db, [bank]);
    setupBudget(db, budget, "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    // Includes lagged annualized M2 growth as the final monetary-transmission input.
    expect(mockCalculateCountryInflation).toHaveBeenCalledWith(
      db,
      "US",
      expect.objectContaining({ _id: "federal" }),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
  });

  // ── Multi-country ─────────────────────────────────────────────────────────

  it("processes multiple countries and returns the correct count", async () => {
    mockCalculateCountryInflation.mockResolvedValue(2.8);

    const usBudget = makeBudget("federal");
    const ukBudget = makeBudget("UK");

    setupBanks(db, [makeCentralBank("US"), makeCentralBank("UK")]);

    // Respond to both budget queries
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.findOne = vi
      .fn()
      .mockImplementation((filter: { _id: string }) => {
        if (filter._id === "federal") return Promise.resolve(usBudget);
        if (filter._id === "UK") return Promise.resolve(ukBudget);
        return Promise.resolve(null);
      });

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(result).toBe(2);
    expect(mockCalculateCountryInflation).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks["federalBudget"]!.updateOne).toHaveBeenCalledTimes(2);
  });

  it("partial multi-country: still counts only countries that succeed", async () => {
    // US succeeds, UK has no budget
    setupBanks(db, [makeCentralBank("US"), makeCentralBank("UK")]);

    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.findOne = vi
      .fn()
      .mockImplementation((filter: { _id: string }) => {
        if (filter._id === "federal") return Promise.resolve(makeBudget("federal"));
        return Promise.resolve(null); // UK budget missing
      });

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(result).toBe(1);
    expect(mockCalculateCountryInflation).toHaveBeenCalledTimes(1);
  });

  it("advances household prices for countries without a central bank", async () => {
    mockCalculateCountryInflation.mockResolvedValue(4.2);
    setupBanks(db, [makeCentralBank("US")]);
    setupBudget(db, makeBudget("federal"), "federal");

    const ukBudget = makeBudget("UK", 2.5);
    db.collection("federalBudget");
    db.collectionMocks["federalBudget"]!.find = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([ukBudget]),
    });

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(result).toBe(2);
    expect(db.collectionMocks["federalBudget"]!.updateOne).toHaveBeenCalledWith(
      { _id: "UK" },
      expect.objectContaining({
        $set: expect.objectContaining({
          "economicFactors.inflationRate": 4.2,
          "economicFactors.householdPriceIndex": expect.closeTo(1.00065625, 12),
        }),
      })
    );
  });

  // ── Commodity pressure signal (annualized change, median) ─────────────────

  it("reports the median annualized change in national prices, not the level vs basePrice", async () => {
    // basePrice is deliberately far from both snapshots: it must not enter the
    // signal at all. Both commodities rise 10% over the 24-turn window, which
    // annualizes (squared) to +21%/yr.
    setupCommodityPrices(db, [
      { commodity: "steel", basePrice: 5, nationalPrices: { US: 999 } },
      { commodity: "oil", basePrice: 5, nationalPrices: { US: 999 } },
    ]);
    setupCommodityPriceHistory(db, [
      { commodity: "steel", turn: 100, nationalPrices: { US: 110 } },
      { commodity: "oil", turn: 100, nationalPrices: { US: 110 } },
      { commodity: "steel", turn: 76, nationalPrices: { US: 100 } },
      { commodity: "oil", turn: 76, nationalPrices: { US: 100 } },
    ]);

    setupBanks(db, [makeCentralBank("US")]);
    setupBudget(db, makeBudget("federal"), "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    // 4th positional arg to calculateCountryInflation is commodityPressure.
    const commodityPressure = mockCalculateCountryInflation.mock.calls[0][3] as number;
    expect(commodityPressure).toBeCloseTo(0.21, 4);
  });

  it("is flat when prices are flat, however far above basePrice they sit", async () => {
    // The regression this whole change exists for: prices 40x base but unchanged
    // over the year must read as ZERO cost-push, not a permanent +100pp.
    setupCommodityPrices(db, [
      { commodity: "steel", basePrice: 5, nationalPrices: { US: 200 } },
      { commodity: "oil", basePrice: 5, nationalPrices: { US: 200 } },
    ]);
    setupCommodityPriceHistory(db, [
      { commodity: "steel", turn: 100, nationalPrices: { US: 200 } },
      { commodity: "oil", turn: 100, nationalPrices: { US: 200 } },
      { commodity: "steel", turn: 76, nationalPrices: { US: 200 } },
      { commodity: "oil", turn: 76, nationalPrices: { US: 200 } },
    ]);

    setupBanks(db, [makeCentralBank("US")]);
    setupBudget(db, makeBudget("federal"), "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(mockCalculateCountryInflation.mock.calls[0][3] as number).toBeCloseTo(0, 6);
  });

  it("takes the median so one runaway commodity cannot detonate the basket", async () => {
    setupCommodityPrices(db, [
      { commodity: "steel", basePrice: 5, nationalPrices: { US: 150 } },
      { commodity: "oil", basePrice: 5, nationalPrices: { US: 110 } },
      { commodity: "rare_earth", basePrice: 5, nationalPrices: { US: 40000 } },
    ]);
    setupCommodityPriceHistory(db, [
      { commodity: "steel", turn: 100, nationalPrices: { US: 150 } },
      { commodity: "oil", turn: 100, nationalPrices: { US: 110 } },
      { commodity: "rare_earth", turn: 100, nationalPrices: { US: 40000 } },
      { commodity: "steel", turn: 76, nationalPrices: { US: 100 } },
      { commodity: "oil", turn: 76, nationalPrices: { US: 100 } },
      { commodity: "rare_earth", turn: 76, nationalPrices: { US: 100 } },
    ]);

    setupBanks(db, [makeCentralBank("US")]);
    setupBudget(db, makeBudget("federal"), "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    // Over the 24-turn window the rows are +50%, +10% and +39900%, which
    // annualize (squared) to +125%, +21% and a value clamped at the +200% row
    // ceiling. The median is the middle row, so the runaway never reaches the
    // output — under the old mean it would have dragged the whole basket.
    expect(mockCalculateCountryInflation.mock.calls[0][3] as number).toBeCloseTo(1.25, 3);
  });

  it("annualizes a short window when the world is younger than a game year", async () => {
    // No row at turn 52; the 12-turn window is scaled up by ^4.
    setupCommodityPrices(db, [{ commodity: "steel", basePrice: 5, nationalPrices: { US: 110 } }]);
    setupCommodityPriceHistory(db, [
      { commodity: "steel", turn: 100, nationalPrices: { US: 110 } },
      { commodity: "steel", turn: 88, nationalPrices: { US: 100 } },
    ]);

    setupBanks(db, [makeCentralBank("US")]);
    setupBudget(db, makeBudget("federal"), "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    // 1.1 ^ (48/12) - 1 = 0.4641
    expect(mockCalculateCountryInflation.mock.calls[0][3] as number).toBeCloseTo(0.4641, 4);
  });

  it("reports zero pressure when no lookback window exists at all", async () => {
    setupCommodityPrices(db, [{ commodity: "steel", basePrice: 5, nationalPrices: { US: 200 } }]);
    setupCommodityPriceHistory(db, [
      { commodity: "steel", turn: 100, nationalPrices: { US: 200 } },
    ]);

    setupBanks(db, [makeCentralBank("US")]);
    setupBudget(db, makeBudget("federal"), "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(mockCalculateCountryInflation.mock.calls[0][3] as number).toBe(0);
  });

  it("prefers current-turn commodity history snapshots over mutable live commodity docs", async () => {
    setupCommodityPrices(db, [
      { commodity: "steel", basePrice: 100, nationalPrices: { US: 10 } },
      { commodity: "oil", basePrice: 100, nationalPrices: { US: 10 } },
    ]);
    setupCommodityPriceHistory(db, [
      { commodity: "steel", turn: 100, nationalPrices: { US: 110 } },
      { commodity: "oil", turn: 100, nationalPrices: { US: 110 } },
      { commodity: "steel", turn: 76, nationalPrices: { US: 100 } },
      { commodity: "oil", turn: 76, nationalPrices: { US: 100 } },
    ]);

    setupBanks(db, [makeCentralBank("US")]);
    setupBudget(db, makeBudget("federal"), "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    // History (110) over the prior window (100) annualizes to +21%. Reading the
    // mutable live doc (10) instead would give a deep negative.
    expect(mockCalculateCountryInflation.mock.calls[0][3] as number).toBeCloseTo(0.21, 4);
  });

  // ── Interest rate history pass-through ────────────────────────────────────

  it("uses the last settled FX history point rather than a mutable current rate field", async () => {
    setupExchangeRates(db, [
      {
        _id: "US",
        countryId: "US",
        rate: 0.5,
        baseRate: 1,
        rateHistory: [{ turn: 99, rate: 0.98 }],
      },
    ]);

    const bank = makeCentralBank("US");
    const budget = makeBudget("federal");
    setupBanks(db, [bank]);
    setupBudget(db, budget, "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    await recalculateInflationPerTurn(db as unknown as Db, 100);

    const call = mockCalculateCountryInflation.mock.calls[0];
    const forexPressure = call[4] as number;

    expect(forexPressure).toBeCloseTo(-0.02, 6);
  });

  // ── Shared central bank (ECB) ──────────────────────────────────────────────

  describe("shared central bank members", () => {
    function makeEcbBank() {
      return {
        _id: "ECB",
        countryId: "DE",
        intorgId: "EU",
        primeRate: 5.0,
        interestRateHistory: [] as { turn: number; rate: number }[],
        nationalSavingsBalance: 1_000_000,
      };
    }

    function setupDeBudget(db: MockDb) {
      const deBudget = makeBudget("DE");
      db.collection("federalBudget");
      db.collectionMocks["federalBudget"]!.findOne = vi
        .fn()
        .mockImplementation((filter: { _id: string }) => {
          if (filter._id === "DE") return Promise.resolve(deBudget);
          return Promise.resolve(null);
        });
    }

    it("recalculates inflation for the shared-bank anchor country via the ECB doc", async () => {
      setupBanks(db, [makeEcbBank()]);
      setupDeBudget(db);

      const { recalculateInflationPerTurn } = await import("./inflationRecalc");
      const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

      expect(result).toBe(1);
      const countriesCalled = mockCalculateCountryInflation.mock.calls.map((c) => c[1]);
      expect(countriesCalled).toEqual(["DE"]);

      const updatedIds = db.collectionMocks["federalBudget"]!.updateOne.mock.calls.map(
        (c: unknown[]) => (c[0] as { _id: string })._id
      );
      expect(updatedIds).toEqual(["DE"]);
    });

    it("uses DE's own exchange-rate doc for forex pressure", async () => {
      setupBanks(db, [makeEcbBank()]);
      setupDeBudget(db);
      setupExchangeRates(db, [
        {
          _id: "DE",
          countryId: "DE",
          rate: 1.05,
          baseRate: 1,
          rateHistory: [{ turn: 99, rate: 1.1 }],
        },
      ]);

      const { recalculateInflationPerTurn } = await import("./inflationRecalc");
      await recalculateInflationPerTurn(db as unknown as Db, 100);

      const deCall = mockCalculateCountryInflation.mock.calls.find((c) => c[1] === "DE")!;
      expect(deCall[4]).toBeCloseTo(0.1, 6);
    });

    it("persists currentSavingsPressure to the shared bank _id, not the member countryId", async () => {
      // The old write targeted { _id: countryId } — a silent no-op for the ECB
      // doc whose _id is "ECB".
      setupBanks(db, [makeEcbBank()]);
      setupDeBudget(db);

      const { recalculateInflationPerTurn } = await import("./inflationRecalc");
      await recalculateInflationPerTurn(db as unknown as Db, 100);

      const bankUpdateIds = db.collectionMocks["centralBanks"]!.updateOne.mock.calls.map(
        (c: unknown[]) => (c[0] as { _id: string })._id
      );
      expect(bankUpdateIds).toContain("ECB");
      expect(bankUpdateIds).not.toContain("DE");
    });
  });

  describe("IE own central bank + IEP forex", () => {
    it("recalculates IE inflation from its own bank and IEP rate doc", async () => {
      setupBanks(db, [makeCentralBank("IE", 4.0)]);
      const ieBudget = makeBudget("IE");
      db.collection("federalBudget");
      db.collectionMocks["federalBudget"]!.findOne = vi
        .fn()
        .mockImplementation((filter: { _id: string }) =>
          filter._id === "IE" ? Promise.resolve(ieBudget) : Promise.resolve(null)
        );
      setupExchangeRates(db, [
        {
          _id: "IE",
          countryId: "IE",
          rate: 0.357,
          baseRate: 0.357,
          rateHistory: [{ turn: 99, rate: 0.36 }],
        },
      ]);

      const { recalculateInflationPerTurn } = await import("./inflationRecalc");
      const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

      expect(result).toBe(1);
      const ieCall = mockCalculateCountryInflation.mock.calls.find((c) => c[1] === "IE")!;
      expect(ieCall).toBeDefined();
      // forexPressure = 0.36/0.357 - 1
      expect(ieCall[4]).toBeCloseTo(0.36 / 0.357 - 1, 6);
    });
  });

  it("passes interestRateHistory from the bank to the inflation calculator via budget wrapper", async () => {
    // The orchestrator reads the bank then hands db + countryId + budget to
    // calculateCountryInflation, which internally reads the bank again.
    // What we verify here: the call happens once per country (no batching bug).
    const bank = {
      ...makeCentralBank("US", 2.0),
      interestRateHistory: [
        { turn: 1, rate: 3.0 },
        { turn: 2, rate: 2.0 },
      ],
    };
    const budget = makeBudget("federal");
    setupBanks(db, [bank]);
    setupBudget(db, budget, "federal");

    const { recalculateInflationPerTurn } = await import("./inflationRecalc");
    const result = await recalculateInflationPerTurn(db as unknown as Db, 100);

    expect(result).toBe(1);
    expect(mockCalculateCountryInflation).toHaveBeenCalledTimes(1);
  });
});

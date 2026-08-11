import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import {
  wouldSilentlyFallback,
  buildSeedExpectations,
  expectedPrimeRate,
  expectedRegionCount,
  seededCountryIdsForPreset,
  readinessCountryIds,
} from "./expectations";
import { runConformanceChecks } from "./conformance";
import { runSeedDiagnostic, diagnosticErrorReport, formatDiagnosticSummary } from "./index";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

type CollMock = {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  countDocuments: ReturnType<typeof vi.fn>;
  insertOne: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  /**
   * Needed by the region-derived coverage checks, which ask each collection for
   * its distinct `countryId` rather than probing per country. Added to the FAKE
   * rather than working around it in the checks — a fake that silently lacks an
   * operation turns "the check ran and passed" into "the check threw", and this
   * one threw for 14 unrelated tests before it was implemented.
   */
  distinct: ReturnType<typeof vi.fn>;
};

function cursorOf(rows: unknown[]) {
  const cursor = {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  };
  return cursor;
}

function makeDb(opts: {
  gameState?: Record<string, unknown> | null;
  gameConfig?: Record<string, unknown> | null;
  budgets?: unknown[];
  states?: unknown[];
  exchangeRates?: unknown[];
  centralBanks?: unknown[];
  enactedLaws?: unknown[];
  unownedSectors?: unknown[];
  counts?: Record<string, number>;
  countByFilter?: Array<{ name: string; match: (filter: unknown) => boolean; count: number }>;
  failCollections?: string[];
  /** Per-collection distinct() results, keyed by collection name. */
  distinct?: Record<string, unknown[]>;
}): { db: Db; collections: Record<string, CollMock> } {
  const counts = opts.counts ?? {};
  const collections: Record<string, CollMock> = {};

  const getColl = (name: string): CollMock => {
    if (collections[name]) return collections[name]!;
    const coll: CollMock = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue(cursorOf([])),
      countDocuments: vi.fn().mockImplementation((filter: unknown) => {
        if (opts.failCollections?.includes(name)) {
          return Promise.reject(new Error(`boom:${name}`));
        }
        for (const rule of opts.countByFilter ?? []) {
          if (rule.name === name && rule.match(filter)) return Promise.resolve(rule.count);
        }
        return Promise.resolve(counts[name] ?? 0);
      }),
      insertOne: vi.fn().mockResolvedValue({ insertedId: "x" }),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
      distinct: vi.fn().mockResolvedValue(opts.distinct?.[name] ?? []),
    };
    collections[name] = coll;
    return coll;
  };

  getColl("gameState").findOne.mockResolvedValue(opts.gameState ?? null);
  getColl("gameConfig").findOne.mockResolvedValue(opts.gameConfig ?? null);
  getColl("federalBudget").find.mockReturnValue(cursorOf(opts.budgets ?? []));
  getColl("states").find.mockReturnValue(cursorOf(opts.states ?? []));
  getColl("exchangeRates").find.mockReturnValue(cursorOf(opts.exchangeRates ?? []));
  getColl("centralBanks").find.mockReturnValue(cursorOf(opts.centralBanks ?? []));
  getColl("enactedLaws").find.mockReturnValue(cursorOf(opts.enactedLaws ?? []));
  getColl("unownedSectors").find.mockReturnValue(cursorOf(opts.unownedSectors ?? []));
  getColl("seedDiagnostics").find.mockReturnValue(cursorOf([]));

  const db = {
    collection: vi.fn().mockImplementation((name: string) => getColl(name)),
  } as unknown as Db;

  return { db, collections };
}

describe("wouldSilentlyFallback", () => {
  it("detects missing preset keys that would fall back to 2019", () => {
    expect(
      wouldSilentlyFallback("1953-default", {
        "2019-default": { ok: true },
      })
    ).toBe(true);
    expect(
      wouldSilentlyFallback("1953-default", {
        "1953-default": { ok: true },
        "2019-default": { ok: true },
      })
    ).toBe(false);
  });

  it("treats empty / 2019-no-parties as intentional aliases", () => {
    expect(
      wouldSilentlyFallback("empty", {
        "2019-default": { ok: true },
      })
    ).toBe(false);
  });
});

describe("era-derived expectations", () => {
  it("excludes latent BLR/BAL from 1953 seeded countries and budgets", () => {
    const seeded = seededCountryIdsForPreset("1953-default");
    expect(seeded).not.toContain("BLR");
    expect(seeded).not.toContain("BAL");
    expect(seeded).toContain("US");
    expect(seeded).toContain("DD");
    expect(seeded).toContain("HU");

    const e = buildSeedExpectations("1953-default");
    expect(e.nationalBudgets.map((b) => b.countryId)).not.toContain("BLR");
    expect(e.nationalBudgets.map((b) => b.countryId)).not.toContain("BAL");
    expect(e.bundleFallbacks).toEqual([]);
  });

  it("includes player and economy-preview countries in 1953 readiness checks", () => {
    const readinessCountries = readinessCountryIds("1953-default");
    expect(readinessCountries).toContain("US");
    expect(readinessCountries).toContain("UK");
    // NG and IE are Tier-1 economy-preview countries, not player countries.
    expect(readinessCountries).toContain("NG");
    expect(readinessCountries).toContain("IE");
    // DD (East Germany) is player-enabled in 1953/1979 and also receives checks.
    expect(readinessCountries).toContain("DD");
  });

  it("derives DE/JP/BR region counts from 1953 seed bundles, not modern readiness", () => {
    expect(expectedRegionCount("DE", "1953-default")).toBe(11);
    expect(expectedRegionCount("JP", "1953-default")).toBe(8);
    expect(expectedRegionCount("BR", "1953-default")).toBe(5);
    expect(expectedRegionCount("DE", "2019-default")).toBe(16);
  });

  it("uses seeder defaultPrimeRate, not era monetary baseline", () => {
    expect(expectedPrimeRate("JP")).toBe(COUNTRY_CONFIGS.JP.centralBank.defaultPrimeRate);
    expect(expectedPrimeRate("JP")).toBe(1);
    expect(expectedPrimeRate("TR")).toBe(COUNTRY_CONFIGS.TR.centralBank.defaultPrimeRate);
  });
});

describe("classifyPopulationSumCheck", () => {
  it("returns ok within 3%, warn for 5–16% dual-source drift, critical above 25% or empty", async () => {
    const { classifyPopulationSumCheck } = await import("./conformance");

    expect(classifyPopulationSumCheck("US", 100, 50, 102).severity).toBe("ok");
    expect(classifyPopulationSumCheck("US", 100, 50, 105).severity).toBe("warn"); // 5%
    expect(classifyPopulationSumCheck("RU", 188, 20, 200.1).severity).toBe("warn"); // ~6.4%
    expect(classifyPopulationSumCheck("FR", 100, 20, 115.9).severity).toBe("warn"); // 15.9%
    expect(classifyPopulationSumCheck("JP", 100, 8, 130).severity).toBe("critical"); // 30%
    expect(classifyPopulationSumCheck("US", 100, 0, 0).severity).toBe("critical");
    expect(classifyPopulationSumCheck("US", 100, 10, 0).severity).toBe("critical");
  });
});

describe("runConformanceChecks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flags missing gameState as critical", async () => {
    const { db } = makeDb({ gameState: null });
    const { checks } = await runConformanceChecks(db, { preset: "2019-default" });
    const exists = checks.find((c) => c.id === "gameState.exists");
    expect(exists?.severity).toBe("critical");
  });

  it("passes gameState clock checks on a clean turn-1 world", async () => {
    const { db } = makeDb({
      gameState: {
        _id: "current",
        preset: "2019-default",
        startingYear: 2019,
        currentTurn: 1,
        currentYear: 2019,
        iteration: { type: "Alpha", number: 1 },
      },
      gameConfig: { _id: "default", maintenanceMode: true },
    });
    const { checks } = await runConformanceChecks(db, { preset: "2019-default" });
    expect(checks.find((c) => c.id === "gameState.preset")?.severity).toBe("ok");
    expect(checks.find((c) => c.id === "gameState.currentTurn")?.severity).toBe("ok");
    expect(checks.find((c) => c.id === "gameState.startingYear")?.severity).toBe("ok");
  });

  it("flags wrong GDP on a national budget as critical", async () => {
    const seedExpect = buildSeedExpectations("2019-default");
    const us = seedExpect.nationalBudgets.find((b) => b.countryId === "US");
    expect(us).toBeDefined();

    const { db } = makeDb({
      gameState: {
        _id: "current",
        preset: "2019-default",
        startingYear: 2019,
        currentTurn: 1,
        currentYear: 2019,
        iteration: { type: "Alpha", number: 1 },
      },
      gameConfig: { _id: "default", maintenanceMode: true },
      budgets: [
        {
          _id: "federal",
          countryId: "US",
          gdp: (us!.gdp ?? 1) * 10,
          debt: { principal: us!.debtPrincipal, interestRate: us!.debtInterestRate },
          economicFactors: {
            gdpGrowth: us!.gdpGrowth,
            wageGrowth: us!.wageGrowth,
            inflationRate: us!.inflationRate,
          },
        },
      ],
    });

    const { checks } = await runConformanceChecks(db, { preset: "2019-default" });
    const gdp = checks.find((c) => c.id === "budget.US.gdp");
    expect(gdp?.severity).toBe("critical");
  });

  it("does not emit budget.exists for latent BLR/BAL on 1953", async () => {
    const { db } = makeDb({
      gameState: {
        _id: "current",
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        currentYear: 1953,
        iteration: { type: "Alpha", number: 1 },
      },
      gameConfig: { _id: "default", maintenanceMode: true },
      budgets: [],
    });
    const { checks } = await runConformanceChecks(db, { preset: "1953-default" });
    expect(checks.find((c) => c.id === "budget.BLR.exists")).toBeUndefined();
    expect(checks.find((c) => c.id === "budget.BAL.exists")).toBeUndefined();
    expect(checks.find((c) => c.id === "sectors.BLR.unowned")).toBeUndefined();
  });

  // Regression guard for #3875: FR spawns founding elections under
  // 1991-default (it is in COUNTRY_ELECTION_PHASES and seeded for that
  // preset) but had zero seeded parties, so every one of its chambers
  // resolved empty forever. This pins the conformance assertion that
  // catches that class of bug going forward.
  it("flags a country with founding elections but zero seeded parties as critical (#3875)", async () => {
    const { db } = makeDb({
      gameState: {
        _id: "current",
        preset: "1991-default",
        startingYear: 1991,
        currentTurn: 1,
        currentYear: 1991,
        iteration: { type: "Alpha", number: 1 },
      },
      gameConfig: { _id: "default", maintenanceMode: true },
      countByFilter: [
        {
          name: "politicalParties",
          match: (filter) => (filter as { countryId?: string })?.countryId === "FR",
          count: 0,
        },
      ],
    });
    const { checks } = await runConformanceChecks(db, { preset: "1991-default" });
    const fr = checks.find((c) => c.id === "parties.FR.roster");
    expect(fr).toBeDefined();
    expect(fr?.severity).toBe("critical");
    expect(fr?.note).toContain("#3875");
  });

  it("does not flag a country whose founding-election roster is non-empty", async () => {
    const { db } = makeDb({
      gameState: {
        _id: "current",
        preset: "1991-default",
        startingYear: 1991,
        currentTurn: 1,
        currentYear: 1991,
        iteration: { type: "Alpha", number: 1 },
      },
      gameConfig: { _id: "default", maintenanceMode: true },
      countByFilter: [
        {
          name: "politicalParties",
          match: (filter) => (filter as { countryId?: string })?.countryId === "FR",
          count: 5,
        },
      ],
    });
    const { checks } = await runConformanceChecks(db, { preset: "1991-default" });
    const fr = checks.find((c) => c.id === "parties.FR.roster");
    expect(fr?.severity).toBe("ok");
  });

  it("marks weightDist ok when shares sum to 1 and max ≤ 0.6", async () => {
    const { db, collections } = makeDb({
      gameState: {
        _id: "current",
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        currentYear: 1953,
        iteration: { type: "Alpha", number: 1 },
      },
      gameConfig: { _id: "default", maintenanceMode: true },
      unownedSectors: [
        { sectorType: "manufacturing", revenue: 400 },
        { sectorType: "agriculture", revenue: 600 },
      ],
    });
    collections.unownedSectors!.countDocuments.mockResolvedValue(2);
    collections.strategicSectorDesignations = collections.unownedSectors!;
    // strategic countDocuments also needs a collection — ensure lazy create returns 1
    const strat = {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockReturnValue(cursorOf([])),
      countDocuments: vi.fn().mockResolvedValue(1),
      insertOne: vi.fn(),
      deleteMany: vi.fn(),
      distinct: vi.fn().mockResolvedValue([]),
    };
    (db.collection as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      if (name === "unownedSectors") return collections.unownedSectors!;
      if (name === "strategicSectorDesignations") return strat;
      if (name === "gameState") return collections.gameState!;
      if (name === "gameConfig") return collections.gameConfig!;
      if (name === "federalBudget") return collections.federalBudget!;
      if (name === "states") return collections.states!;
      if (name === "exchangeRates") return collections.exchangeRates!;
      if (name === "centralBanks") return collections.centralBanks!;
      if (name === "enactedLaws") return collections.enactedLaws!;
      if (name === "seedDiagnostics") return collections.seedDiagnostics!;
      return {
        findOne: vi.fn().mockResolvedValue(null),
        find: vi.fn().mockReturnValue(cursorOf([])),
        countDocuments: vi.fn().mockResolvedValue(0),
        insertOne: vi.fn(),
        deleteMany: vi.fn(),
        distinct: vi.fn().mockResolvedValue([]),
      };
    });

    const { checks } = await runConformanceChecks(db, { preset: "1953-default" });
    const weight = checks.find((c) => c.id === "sectors.US.weightDist");
    expect(weight?.severity).toBe("ok");
    expect(String(weight?.expected)).toMatch(/sum≈1/);
  });

  it("detects stale gdpCostFraction when seed law does not define it", async () => {
    const { generateDefaultEnactedLaws } = await import("@/lib/seeds/reference/budgets");
    const laws = generateDefaultEnactedLaws("2019-default");
    const candidate = laws.find(
      (l) =>
        l.countryId === "US" && (l as { gdpCostFraction?: number }).gdpCostFraction === undefined
    );
    expect(candidate).toBeDefined();

    const { db } = makeDb({
      gameState: {
        _id: "current",
        preset: "2019-default",
        startingYear: 2019,
        currentTurn: 1,
        currentYear: 2019,
        iteration: { type: "Alpha", number: 1 },
      },
      gameConfig: { _id: "default", maintenanceMode: true },
      enactedLaws: [
        {
          countryId: candidate!.countryId,
          legislationTypeId: candidate!.legislationTypeId,
          gdpCostFraction: 0.99,
        },
      ],
    });

    const { checks } = await runConformanceChecks(db, { preset: "2019-default" });
    const stale = checks.find(
      (c) =>
        c.id.includes(candidate!.legislationTypeId) &&
        c.id.includes("gdpCostFraction") &&
        c.severity === "critical"
    );
    expect(stale).toBeDefined();
  });

  it("warns (not ok) when a runtime cleanliness query fails", async () => {
    const { db } = makeDb({
      gameState: {
        _id: "current",
        preset: "2019-default",
        startingYear: 2019,
        currentTurn: 1,
        currentYear: 2019,
        iteration: { type: "Alpha", number: 1 },
      },
      gameConfig: { _id: "default", maintenanceMode: true },
      failCollections: ["turnLogs"],
    });
    const { checks } = await runConformanceChecks(db, { preset: "2019-default" });
    const turnLogs = checks.find((c) => c.id === "runtime.turnLogs");
    expect(turnLogs?.severity).toBe("warn");
    expect(turnLogs?.note).toMatch(/query failed/);
  });
});

describe("runSeedDiagnostic", () => {
  it("persists a conformance report via insertOne", async () => {
    const { db, collections } = makeDb({
      gameState: {
        _id: "current",
        preset: "2019-default",
        startingYear: 2019,
        currentTurn: 1,
        currentYear: 2019,
        iteration: { type: "Alpha", number: 1 },
      },
      gameConfig: { _id: "default", maintenanceMode: true },
    });
    const report = await runSeedDiagnostic(db, {
      mode: "conformance",
      trigger: "manual",
      persist: true,
    });
    expect(report.mode).toBe("conformance");
    expect(report.summary.ok + report.summary.warn + report.summary.critical).toBe(
      report.checks.length
    );
    expect(formatDiagnosticSummary(report)).toMatch(/Seed diagnostic \(conformance\)/);
    expect(collections.seedDiagnostics!.insertOne).toHaveBeenCalledTimes(1);
  });

  it("runs Mode B drift checks (no stub)", async () => {
    const { db } = makeDb({
      gameState: {
        _id: "current",
        preset: "2019-default",
        currentTurn: 10,
        startingYear: 2019,
        currentYear: 2019,
      },
      gameConfig: { _id: "default" },
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
    const report = await runSeedDiagnostic(db, {
      mode: "drift",
      trigger: "manual",
      persist: false,
    });
    expect(report.mode).toBe("drift");
    expect(report.checks.some((c) => c.id === "drift.unimplemented")).toBe(false);
    expect(report.checks.some((c) => c.id === "baseline.source")).toBe(true);
    expect(report.note).toMatch(/reconstructed baseline/);
  });
});

describe("runConformanceChecks — config.maintenanceMode (tri-state)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is ok when the tri-state mode is 'full'", async () => {
    const { db } = makeDb({ gameConfig: { _id: "default", maintenanceMode: "full" } });
    const { checks } = await runConformanceChecks(db, { preset: "2019-default" });
    const check = checks.find((c) => c.id === "config.maintenanceMode");
    expect(check?.severity).toBe("ok");
  });

  it("is ok for the legacy boolean true (normalized to full)", async () => {
    const { db } = makeDb({ gameConfig: { _id: "default", maintenanceMode: true } });
    const { checks } = await runConformanceChecks(db, { preset: "2019-default" });
    const check = checks.find((c) => c.id === "config.maintenanceMode");
    expect(check?.severity).toBe("ok");
  });

  it("warns when the tri-state mode is 'partial' — reset expects a hard seal", async () => {
    const { db } = makeDb({ gameConfig: { _id: "default", maintenanceMode: "partial" } });
    const { checks } = await runConformanceChecks(db, { preset: "2019-default" });
    const check = checks.find((c) => c.id === "config.maintenanceMode");
    expect(check?.severity).toBe("warn");
    expect(check?.actual).toBe("partial");
  });

  it("warns when maintenance is off/absent post-reset", async () => {
    const { db } = makeDb({ gameConfig: { _id: "default" } });
    const { checks } = await runConformanceChecks(db, { preset: "2019-default" });
    const check = checks.find((c) => c.id === "config.maintenanceMode");
    expect(check?.severity).toBe("warn");
    expect(check?.actual).toBe("off");
  });
});

describe("diagnosticErrorReport", () => {
  it("produces a single critical diagnostic_error check", () => {
    const report = diagnosticErrorReport("boom", { preset: "1953-default" });
    expect(report.summary.critical).toBe(1);
    expect(report.checks[0]?.id).toBe("diagnostic_error");
    expect(report.checks[0]?.note).toBe("boom");
  });
});

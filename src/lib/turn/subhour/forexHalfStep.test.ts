import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import * as rateCalculation from "@/lib/currency/rateCalculation";
import { CYCLE_PRESSURE_BY_REGIME } from "@/lib/constants/currencies";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import type { EuroMonetaryUnion } from "@/lib/currency/euro/rules";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { processForexTurn } from "@/lib/turn/forexTurn";
import { planForexHalfStep, runForexHalfStep, type ForexHalfStepRow } from "./forexHalfStep";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const GBP_VOLUMES = { buyVolume24: 1_500_000, sellVolume24: 200_000, effectiveTraders: 12 };

vi.mock("@/lib/currency/volumeTracker", () => ({
  computeCurrencyVolumes: vi.fn(async () => ({
    USD: { buyVolume24: 0, sellVolume24: 0 },
    GBP: { buyVolume24: 1_500_000, sellVolume24: 200_000, effectiveTraders: 12 },
    JPY: { buyVolume24: 100_000, sellVolume24: 900_000 },
    EUR: { buyVolume24: 0, sellVolume24: 0 },
  })),
}));

// Pass-through spies: the real math runs, the calls are recorded.
vi.mock("@/lib/currency/rateCalculation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/currency/rateCalculation")>();
  return {
    ...actual,
    computeRateUpdate: vi.fn(actual.computeRateUpdate),
    computeFractionalRateUpdate: vi.fn(actual.computeFractionalRateUpdate),
  };
});

const TURN = 50;
const YEAR = 2019;

function bank(countryId: string, overrides: Partial<CentralBank> = {}): CentralBank {
  return {
    _id: countryId,
    countryId,
    primeRate: 4.5,
    inflationHistory: [{ turn: 49, rate: 3.4 }],
    gdpGrowthHistory: [{ turn: 49, rate: 0.6 }],
    tradeGrowth: 1,
    ...overrides,
  } as unknown as CentralBank;
}

function row(
  countryId: string,
  currencyCode: string,
  rate: number,
  baseRate: number,
  extra: Record<string, unknown> = {}
) {
  return {
    _id: countryId,
    countryId,
    currencyCode,
    rate,
    baseRate,
    macroTarget: rate,
    rateHistory: [{ turn: 49, rate }],
    buyVolume24: 0,
    sellVolume24: 0,
    // Active regime that does not roll this turn, so the RNG only drives noise.
    cyclePressureRegime: "moderate_weaken",
    cyclePressureUntilTurn: 9999,
    updatedAt: new Date(0),
    ...extra,
  };
}

const BANKS = [bank("US", { primeRate: 3 }), bank("UK"), bank("JP", { primeRate: 0.2 })];

function baseRows(overrides: Record<string, Record<string, unknown>> = {}) {
  return [
    row("US", "USD", 1, 1, overrides.US),
    row("UK", "GBP", 0.82, 0.75, overrides.UK),
    row("JP", "JPY", 111, 106, overrides.JP),
  ];
}

let db: MockDb;

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function seed(rows: unknown[], banks: CentralBank[] = BANKS) {
  db.collectionMocks.exchangeRates.find.mockImplementation(() => cursor(rows));
  db.collectionMocks.centralBanks.find.mockImplementation(() => cursor(banks));
}

function turnSet(countryId: string) {
  const call = db.collectionMocks.exchangeRates.updateOne.mock.calls.find(
    (call: unknown[]) => (call[0] as { _id: string })._id === countryId
  );
  return call![1].$set as Record<string, unknown>;
}

function planRows(rows: ReturnType<typeof row>[]): ForexHalfStepRow[] {
  return rows as unknown as ForexHalfStepRow[];
}

beforeEach(() => {
  db = createMockDb();
  for (const name of [
    "centralBanks",
    "exchangeRates",
    "currencyOrders",
    "tradeHistory",
    "characters",
    "gameState",
    "gameConfig",
  ]) {
    db.collection(name);
  }
  db.collectionMocks.currencyOrders.find.mockImplementation(() => ({
    ...cursor([]),
    sort: vi.fn().mockReturnValue(cursor([])),
  }));
  vi.mocked(rateCalculation.computeRateUpdate).mockClear();
  vi.mocked(rateCalculation.computeFractionalRateUpdate).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function runTurn(rows: unknown[]) {
  db.collectionMocks.exchangeRates.updateOne.mockClear();
  seed(rows);
  await processForexTurn(db as unknown as Db, TURN, undefined, YEAR);
}

describe("forex half step: turn path without a half tick", () => {
  it("makes the same calls, with the same arguments and the same writes, as an unstamped turn", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.83);
    await runTurn(baseRows());
    const fresh = db.collectionMocks.exchangeRates.updateOne.mock.calls.map(([f, u]) => [
      f,
      { ...u, $set: { ...u.$set, updatedAt: null } },
    ]);
    const freshCalls = vi.mocked(rateCalculation.computeRateUpdate).mock.calls.slice();

    vi.mocked(rateCalculation.computeRateUpdate).mockClear();
    // A stamp left by the previous hour's tick does not apply to this turn.
    const stale = { subhourStep: { turn: TURN - 1, fraction: 0.5 } };
    await runTurn(baseRows({ US: stale, UK: stale, JP: stale }));
    const staleWrites = db.collectionMocks.exchangeRates.updateOne.mock.calls.map(([f, u]) => [
      f,
      { ...u, $set: { ...u.$set, updatedAt: null } },
    ]);

    expect(rateCalculation.computeFractionalRateUpdate).not.toHaveBeenCalled();
    expect(vi.mocked(rateCalculation.computeRateUpdate).mock.calls).toEqual(freshCalls);
    expect(staleWrites).toEqual(fresh);
    // The hourly call keeps its historical shape: no injected noise, unit
    // volatility, the active cycle pressure, the year, the pegged band and
    // unit drift.
    const uk = freshCalls.find((call) => call[2] === "UK")!;
    expect(uk.slice(5)).toEqual([
      undefined,
      1,
      CYCLE_PRESSURE_BY_REGIME.moderate_weaken,
      YEAR,
      0.5,
      1,
    ]);
    // Same set of fields as before: no subhourStep write on the turn.
    expect(Object.keys(turnSet("UK")).sort()).toEqual(
      [
        "rate",
        "macroTarget",
        "rateHistory",
        "buyVolume24",
        "sellVolume24",
        "cyclePressureRegime",
        "cyclePressureUntilTurn",
        "updatedAt",
      ].sort()
    );
    random.mockRestore();
  });
});

describe("forex half step: composition with the turn", () => {
  it("half at :30 plus the remainder at the turn equals one full turn step (noise off)", async () => {
    // Math.random() = 0.5 gives zero noise in generateNoise.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await runTurn(baseRows());
    const full = { UK: turnSet("UK").rate, JP: turnSet("JP").rate, US: turnSet("US").rate };

    const plan = planForexHalfStep({
      turn: TURN,
      fraction: 0.5,
      preset: DEFAULT_SEED_PRESET,
      currentYear: YEAR,
      commandEconomyEnabled: false,
      rows: planRows(baseRows()),
      banks: BANKS,
      volumes: {
        USD: { buyVolume24: 0, sellVolume24: 0 },
        GBP: GBP_VOLUMES,
        JPY: { buyVolume24: 100_000, sellVolume24: 900_000 },
      },
      noise: () => 0,
    });
    const half = Object.fromEntries(plan.writes.map((w) => [w.countryId, w.rate]));
    expect(Object.keys(half).sort()).toEqual(["JP", "UK", "US"]);
    // The half moved the rate part of the way.
    expect(half.UK).not.toBe(0.82);

    vi.mocked(rateCalculation.computeFractionalRateUpdate).mockClear();
    const stamp = { subhourStep: { turn: TURN, fraction: 0.5 } };
    await runTurn(
      baseRows({
        US: { ...stamp, rate: half.US },
        UK: { ...stamp, rate: half.UK },
        JP: { ...stamp, rate: half.JP },
      })
    );
    expect(rateCalculation.computeFractionalRateUpdate).toHaveBeenCalledTimes(3);
    for (const id of ["US", "UK", "JP"] as const) {
      expect(turnSet(id).rate as number).toBeCloseTo(full[id] as number, 12);
    }
    // Hourly bookkeeping is untouched by the split: one history point per turn.
    expect(turnSet("UK").rateHistory).toEqual([
      { turn: 49, rate: 0.82 },
      { turn: TURN, rate: turnSet("UK").rate },
    ]);
  });

  it("holds hard pegs and command pegs: no :30 write", () => {
    const plan = planForexHalfStep({
      turn: TURN,
      fraction: 0.5,
      preset: DEFAULT_SEED_PRESET,
      currentYear: YEAR,
      commandEconomyEnabled: false,
      rows: planRows(baseRows({ UK: { hardPeg: 0.8 } })),
      banks: BANKS,
      volumes: {},
      noise: () => 0,
    });
    expect(plan.writes.map((w) => w.countryId).sort()).toEqual(["JP", "US"]);
    expect(plan.pegged).toBe(1);
  });

  it("skips rows already stepped for this turn", () => {
    const plan = planForexHalfStep({
      turn: TURN,
      fraction: 0.5,
      preset: DEFAULT_SEED_PRESET,
      currentYear: YEAR,
      commandEconomyEnabled: false,
      rows: planRows(baseRows({ JP: { subhourStep: { turn: TURN, fraction: 0.5 } } })),
      banks: BANKS,
      volumes: {},
      noise: () => 0,
    });
    expect(plan.writes.map((w) => w.countryId).sort()).toEqual(["UK", "US"]);
    expect(plan.alreadyStepped).toBe(1);
  });

  it("takes no cycle pressure when the regime rolls at the coming turn", () => {
    const input = {
      turn: TURN,
      fraction: 0.5,
      preset: DEFAULT_SEED_PRESET,
      currentYear: YEAR,
      commandEconomyEnabled: false,
      banks: BANKS,
      volumes: {},
      noise: () => 0,
    };
    planForexHalfStep({
      ...input,
      rows: planRows(baseRows({ UK: { cyclePressureUntilTurn: TURN } })),
    });
    const ukCall = vi
      .mocked(rateCalculation.computeFractionalRateUpdate)
      .mock.calls.find((call) => call[2] === "UK")!;
    expect(ukCall[8]).toBe(0);
  });
});

const UNION: EuroMonetaryUnion = {
  authorityId: "ECB",
  anchorCountryId: "DE",
  anchorCurrency: "EUR",
  anchorUnitsPerEuro: 1,
  establishedTurn: 1,
  revision: 1,
  members: {
    DE: {
      countryId: "DE",
      ledgerCurrency: "EUR",
      ledgerUnitsPerAnchorUnit: 1,
      joinedTurn: 1,
      source: "legacy-settlement",
    },
    BG: {
      countryId: "BG",
      ledgerCurrency: "BGN" as never,
      ledgerUnitsPerAnchorUnit: 1.95583,
      joinedTurn: 1,
      source: "enacted-law",
    },
  },
} as unknown as EuroMonetaryUnion;

describe("runForexHalfStep", () => {
  function state(extra: Record<string, unknown> = {}) {
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: TURN - 1,
      forexEnabled: true,
      preset: "2027-default",
      startingYear: 2027,
      ...extra,
    });
  }

  function euroRows() {
    return [...baseRows(), row("DE", "EUR", 0.95, 0.92), row("BG", "BGN", 0.95 * 1.95583, 1.8)];
  }

  it("does nothing when forex is disabled", async () => {
    state({ forexEnabled: false });
    expect(await runForexHalfStep(db as unknown as Db, TURN, new Date())).toEqual({
      skipped: "forexDisabled",
    });
    expect(db.collectionMocks.exchangeRates.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.exchangeRates.bulkWrite).not.toHaveBeenCalled();
  });

  it("does nothing when the coming turn already started", async () => {
    state({ currentTurn: TURN });
    expect(await runForexHalfStep(db as unknown as Db, TURN, new Date())).toEqual({
      skipped: "turnAdvanced",
    });
    expect(db.collectionMocks.exchangeRates.bulkWrite).not.toHaveBeenCalled();
  });

  it("writes rate, macroTarget and the stamp under CAS, and nothing hourly", async () => {
    state();
    seed(baseRows());
    db.collectionMocks.exchangeRates.bulkWrite.mockResolvedValue({ matchedCount: 3 });
    const now = new Date("2026-10-09T10:30:00Z");
    const stats = await runForexHalfStep(db as unknown as Db, TURN, now);

    expect(db.collectionMocks.exchangeRates.bulkWrite).toHaveBeenCalledTimes(1);
    const [ops, options] = db.collectionMocks.exchangeRates.bulkWrite.mock.calls[0];
    expect(options).toEqual({ ordered: false });
    const uk = ops.find(
      (op: { updateOne: { filter: { _id: string } } }) => op.updateOne.filter._id === "UK"
    ).updateOne;
    expect(uk.filter).toEqual({
      _id: "UK",
      rate: 0.82,
      hardPeg: null,
      "subhourStep.turn": { $ne: TURN },
    });
    expect(Object.keys(uk.update.$set).sort()).toEqual(
      ["macroTarget", "rate", "subhourStep", "updatedAt"].sort()
    );
    expect(uk.update.$set.subhourStep).toEqual({ turn: TURN, fraction: 0.5 });
    expect(stats).toMatchObject({ written: 3, casSkipped: 0 });

    // No intervention spend, no limit-order work, one projected read each.
    expect(db.collectionMocks.centralBanks.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.currencyOrders.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.exchangeRates.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.exchangeRates.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.exchangeRates.find.mock.calls[0][1].projection).not.toHaveProperty(
      "rateHistory"
    );
  });

  it("counts a row changed since the read as skipped until the turn", async () => {
    state();
    seed(baseRows());
    db.collectionMocks.exchangeRates.bulkWrite.mockResolvedValue({ matchedCount: 2 });
    const stats = await runForexHalfStep(db as unknown as Db, TURN, new Date());
    expect(stats).toMatchObject({ written: 2, casSkipped: 1 });
  });

  it("moves the euro anchor first and members copy its new quote exactly", async () => {
    state({ euroMonetaryUnion: UNION });
    seed(euroRows(), [...BANKS, bank("DE"), bank("BG")]);
    db.collectionMocks.exchangeRates.bulkWrite.mockImplementation(async (ops: unknown[]) => ({
      matchedCount: ops.length,
    }));
    await runForexHalfStep(db as unknown as Db, TURN, new Date());

    const calls = db.collectionMocks.exchangeRates.bulkWrite.mock.calls;
    expect(calls).toHaveLength(2);
    const [anchorOps] = calls[0];
    expect(anchorOps).toHaveLength(1);
    const de = anchorOps[0].updateOne;
    expect(de.filter._id).toBe("DE");
    const bg = calls[1][0].find(
      (op: { updateOne: { filter: { _id: string } } }) => op.updateOne.filter._id === "BG"
    ).updateOne;
    expect(bg.update.$set.rate).toBe(de.update.$set.rate * 1.95583);
    expect(bg.update.$set.subhourStep).toEqual({ turn: TURN, fraction: 0.5 });
  });

  it("leaves members on the old quote when the anchor's CAS fails", async () => {
    state({ euroMonetaryUnion: UNION });
    seed(euroRows(), [...BANKS, bank("DE"), bank("BG")]);
    db.collectionMocks.exchangeRates.bulkWrite
      .mockResolvedValueOnce({ matchedCount: 0 })
      .mockImplementation(async (ops: unknown[]) => ({ matchedCount: ops.length }));
    const stats = await runForexHalfStep(db as unknown as Db, TURN, new Date());

    const rest = db.collectionMocks.exchangeRates.bulkWrite.mock.calls[1][0] as Array<{
      updateOne: { filter: { _id: string } };
    }>;
    expect(rest.map((op) => op.updateOne.filter._id)).not.toContain("BG");
    expect(stats).toMatchObject({ casSkipped: 2 });
  });
});

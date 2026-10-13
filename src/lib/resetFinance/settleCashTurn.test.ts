import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { BondTurnResult } from "@/lib/turn/bondTurn";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import {
  openingNationalTreasurySnapshots,
  type ResetNationalTreasurySnapshot,
} from "./rules/treasurySnapshot";
import { settleResetTreasuryCashTurn } from "./settleCashTurn";
import type { ResetDepartmentAccountSnapshot } from "./rules/liveDepartmentAccount";

const countries = ["US", "UK", "JP"] as const;
type CashWrite<T> = {
  updateOne: {
    filter: {
      _id: string;
      worldId: string;
      settledThroughTurn?: number;
      accruedThroughTurn?: number;
    };
    update: { $set: Partial<T> };
  };
};
const ready = { metrics: true, legislation: true, cabinet: true };
const state = {
  currentTurn: 1,
  resetWorldId: "world",
  metricsSystemVersion: "v2",
  cabinetSystemVersion: "v2",
  resetVersionSeeds: Object.fromEntries(
    Object.entries(RESET_V2_SEED_REVISION).map(([system, revision]) => [
      system,
      {
        worldId: "world",
        revision,
        sourceTurn: 1,
        completedAt: "done",
        verificationHash: "verified",
      },
    ])
  ),
} as GameState;
const flow = {
  sovereignCashProceedsByCountry: {},
  sovereignDebtFaceIssuedByCountry: {},
  sovereignCouponPaidByCountry: {},
  sovereignMaturityCashPaidByCountry: {},
  sovereignDebtFaceRetiredByCountry: {},
} as BondTurnResult;

const strayUsProgram = {
  country: "US",
  scope: "national",
  familyId: "L18",
  choice: "leave_to_states",
  fundingAccountId: null,
};

function expectOnlyUsHeld(
  treasuries: ResetNationalTreasurySnapshot[],
  accounts: ResetDepartmentAccountSnapshot[]
) {
  expect(treasuries[0]!.settledThroughTurn).toBe(1);
  expect(accounts[0]!.accruedThroughTurn).toBe(1);
  expect(accounts[0]!.lastAuthorityPaid).toBe(0);
  expect(treasuries.slice(1).every((treasury) => treasury.settledThroughTurn === 2)).toBe(true);
  expect(
    accounts
      .slice(1)
      .every((account) => account.accruedThroughTurn === 2 && account.lastAuthorityPaid === 10)
  ).toBe(true);
}

function fixture() {
  const mock = createMockDb();
  const treasuries = openingNationalTreasurySnapshots("world", 1, {
    US: { debt: 100, debtCeiling: 200 },
    UK: { debt: 100, debtCeiling: 200 },
    JP: { debt: 100, debtCeiling: 200 },
  });
  const accounts = countries.map((countryId) => ({
    _id: `${countryId}:health`,
    worldId: "world",
    countryId,
    departmentId: "health",
    sourceTurn: 1,
    accruedThroughTurn: 1,
    lastAuthorityPaid: 0,
    annualAuthority: 480,
    grantReservation: 0,
    controllingSeatId: "health",
    openingAgencyNames: ["Health"],
    grossAnnualClaim: 480,
    familyGrossAnnualDemand: { L18: 480 },
    familyGrantReservation: {},
    balance: 0,
    encumbered: 0,
    arrears: 0,
    externallySettled: false,
    familyAnnualDemand: { L18: 480 },
    programAllocationPercents: {},
    lastProgramDelivery: {},
  })) as ResetDepartmentAccountSnapshot[];
  for (const treasury of treasuries)
    treasury.departmentAccountIds = [`${treasury.countryId}:health`];
  const continuity = countries.map((countryId) => ({
    _id: countryId,
    countryId,
    worldId: "world",
    sourceTurn: 1,
    annualAuthority: 0,
    grantReservation: 0,
  }));
  const budgets = countries.map((countryId) => ({
    countryId,
    revenue: { total: 480 },
    debt: { ceiling: 200 },
  }));
  for (const [name, rows] of [
    ["resetNationalTreasuries", treasuries],
    ["resetDepartmentAccounts", accounts],
    ["resetDepartmentContinuity", continuity],
    ["federalBudget", budgets],
    ["resetLawPrograms", []],
  ] as const) {
    mock
      .collection(name)
      .find.mockReturnValue({ toArray: vi.fn(async () => structuredClone(rows)) });
  }
  // Emulate the compare-and-swap and persistent readback, not just write success.
  mock
    .collection("resetNationalTreasuries")
    .bulkWrite.mockImplementation(async (ops: CashWrite<ResetNationalTreasurySnapshot>[]) => {
      let matchedCount = 0;
      for (const op of ops) {
        const { filter, update } = op.updateOne;
        const row = treasuries.find(
          (candidate) =>
            candidate._id === filter._id &&
            candidate.worldId === filter.worldId &&
            candidate.settledThroughTurn === filter.settledThroughTurn
        );
        if (row) {
          Object.assign(row, update.$set);
          matchedCount++;
        }
      }
      return { matchedCount };
    });
  mock
    .collection("resetDepartmentAccounts")
    .bulkWrite.mockImplementation(async (ops: CashWrite<ResetDepartmentAccountSnapshot>[]) => {
      let matchedCount = 0;
      for (const op of ops) {
        const { filter, update } = op.updateOne;
        const row = accounts.find(
          (candidate) =>
            candidate._id === filter._id &&
            candidate.worldId === filter.worldId &&
            candidate.accruedThroughTurn === filter.accruedThroughTurn
        );
        if (row) {
          Object.assign(row, update.$set);
          matchedCount++;
        }
      }
      return { matchedCount };
    });
  const run = (overrides = {}) =>
    settleResetTreasuryCashTurn({
      db: mock as unknown as Db,
      gameState: state,
      turn: 2,
      bondFlows: flow,
      ready,
      ...overrides,
    });
  return { mock, accounts, treasuries, run };
}

describe("v2 treasury and paid Cabinet turn integration", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does no reads or writes for v1", async () => {
    const { mock, run } = fixture();
    expect(await run({ ready: { metrics: false, legislation: false, cabinet: false } })).toEqual({
      countries: 0,
      accounts: 0,
      advanced: 0,
      replayed: 0,
    });
    expect(mock.collectionMocks.resetNationalTreasuries!.find).not.toHaveBeenCalled();
  });
  it("pays actual authority once and replays without a second cash credit", async () => {
    const { accounts, treasuries, mock, run } = fixture();
    expect(await run()).toEqual({ countries: 3, accounts: 3, advanced: 3, replayed: 0 });
    expect(
      accounts.every((account) => account.lastAuthorityPaid === 10 && account.balance === 0)
    ).toBe(true);
    expect(treasuries.every((treasury) => treasury.cash === 0)).toBe(true);
    expect(
      await run({ bondFlows: { ...flow, sovereignCashProceedsByCountry: { US: 900 } } })
    ).toEqual({ countries: 3, accounts: 3, advanced: 0, replayed: 3 });
    expect(mock.collectionMocks.resetNationalTreasuries!.bulkWrite).toHaveBeenCalledTimes(1);
    expect(mock.collectionMocks.resetDepartmentAccounts!.bulkWrite).toHaveBeenCalledTimes(1);
  });
  it("recovers a cash receipt committed before departmental persistence failed", async () => {
    const { mock, run, accounts } = fixture();
    mock.collectionMocks.resetDepartmentAccounts!.bulkWrite.mockRejectedValueOnce(
      new Error("connection lost")
    );
    await expect(run()).rejects.toThrow("connection lost");
    expect(await run()).toMatchObject({ advanced: 3 });
    expect(accounts.every((account) => account.lastAuthorityPaid === 10)).toBe(true);
    expect(mock.collectionMocks.resetNationalTreasuries!.bulkWrite).toHaveBeenCalledTimes(1);
  });
  it("preflights malformed bond flows before any cash or account mutation", async () => {
    const { mock, run } = fixture();
    await expect(run({ bondFlows: {} })).rejects.toThrow("capture");
    expect(mock.collectionMocks.resetNationalTreasuries!.bulkWrite).not.toHaveBeenCalled();
    expect(mock.collectionMocks.resetDepartmentAccounts!.bulkWrite).not.toHaveBeenCalled();
  });
  it("holds a wrong-world account's country and settles the others", async () => {
    const { accounts, treasuries, run } = fixture();
    accounts[0]!.worldId = "old-world";
    await expect(run()).rejects.toThrow(/held US \(2 of 3 settled\): US: .*identity/);
    expectOnlyUsHeld(treasuries, accounts);
  });
  it("cannot silently drop a seeded account even when it has no arrears", async () => {
    const { accounts, treasuries, run } = fixture();
    treasuries[0]!.departmentAccountIds!.push("US:education");
    await expect(run()).rejects.toThrow(/held US .*Missing seeded/);
    expectOnlyUsHeld(treasuries, accounts);
  });
  it("names the lagging country and turns when a cash receipt skips a turn", async () => {
    const { accounts, treasuries, run } = fixture();
    treasuries[0]!.settledThroughTurn = treasuries[0]!.settledThroughTurn - 1;
    await expect(run()).rejects.toThrow(
      /skipped a turn: US settled through \d+, settling \d+ \(opened at \d+\)/
    );
    expect(treasuries[0]!.settledThroughTurn).toBe(0);
    expect(accounts[0]!.accruedThroughTurn).toBe(1);
    expect(treasuries.slice(1).every((treasury) => treasury.settledThroughTurn === 2)).toBe(true);
  });
  it("rejects unpaid department authority that does not match the sovereign receipt", async () => {
    const { accounts, treasuries, run } = fixture();
    accounts[0]!.unpaidAuthority = 1;
    await expect(run()).rejects.toThrow(/held US .*reconcile/);
    expectOnlyUsHeld(treasuries, accounts);
  });
  // Turn 126 in production: a law left a stray education line in one country
  // and the single throw froze cash for every v2 country for 28 turns.
  it("holds only the country with a stray inactive Cabinet line", async () => {
    const { mock, accounts, treasuries, run } = fixture();
    mock.collection("resetLawPrograms").find.mockReturnValue({
      toArray: vi.fn(async () => [strayUsProgram]),
    });
    await expect(run()).rejects.toThrow(
      "V2 cash settlement held US (2 of 3 settled): US: Inactive Cabinet family retains authority L18"
    );
    expectOnlyUsHeld(treasuries, accounts);
  });
  it("settles a repaired country on retry without paying the others twice", async () => {
    const { mock, accounts, treasuries, run } = fixture();
    const programs = mock.collection("resetLawPrograms");
    programs.find.mockReturnValue({ toArray: vi.fn(async () => [strayUsProgram]) });
    await expect(run()).rejects.toThrow("held US");
    const settled = structuredClone(treasuries.slice(1));
    programs.find.mockReturnValue({ toArray: vi.fn(async () => []) });
    expect(await run()).toEqual({ countries: 3, accounts: 3, advanced: 1, replayed: 2 });
    expect(treasuries.slice(1)).toEqual(settled);
    expect(treasuries[0]!.settledThroughTurn).toBe(2);
    expect(accounts.every((account) => account.lastAuthorityPaid === 10)).toBe(true);
    const writes = mock.collectionMocks.resetNationalTreasuries!.bulkWrite.mock.calls;
    expect(writes).toHaveLength(2);
    expect(writes[1]![0]).toHaveLength(1);
  });
  it("keeps settling healthy countries on later turns while one stays held", async () => {
    const { mock, accounts, treasuries, run } = fixture();
    mock.collection("resetLawPrograms").find.mockReturnValue({
      toArray: vi.fn(async () => [strayUsProgram]),
    });
    await expect(run()).rejects.toThrow("held US");
    mock.collection("resetLawPrograms").find.mockReturnValue({ toArray: vi.fn(async () => []) });
    await expect(run({ gameState: { ...state, currentTurn: 2 }, turn: 3 })).rejects.toThrow(
      /held US \(2 of 3 settled\): US: V2 cash receipt skipped a turn: US settled through 1, settling 3/
    );
    expect(treasuries.map((treasury) => treasury.settledThroughTurn)).toEqual([1, 3, 3]);
    expect(accounts.map((account) => account.accruedThroughTurn)).toEqual([1, 3, 3]);
  });
  it("writes nothing when every country is behind, as in a world already frozen", async () => {
    const { mock, treasuries, run } = fixture();
    for (const treasury of treasuries) treasury.settledThroughTurn -= 1;
    await expect(run()).rejects.toThrow("held US, UK, JP (0 of 3 settled)");
    expect(mock.collectionMocks.resetNationalTreasuries!.bulkWrite).not.toHaveBeenCalled();
    expect(mock.collectionMocks.resetDepartmentAccounts!.bulkWrite).not.toHaveBeenCalled();
  });
  it("records a bond emergency while still paying enacted authority", async () => {
    const { accounts, treasuries, run } = fixture();
    await run({ bondFlows: { ...flow, sovereignCouponPaidByCountry: { US: 13 } } });
    expect(treasuries[0]!.emergencyAdvance).toBe(3);
    expect(treasuries[0]!.fiscalCrisis?.reason).toBe("emergency_advance");
    expect(treasuries[0]!.lastAppropriationFinancing).toBe(10);
    expect(accounts[0]!.lastAuthorityPaid).toBe(10);
    expect(accounts[0]!.unpaidAuthority).toBe(0);
    expect(accounts[1]!.lastAuthorityPaid).toBe(10);
  });
});

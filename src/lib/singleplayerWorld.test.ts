import { describe, expect, it, vi } from "vitest";
import {
  advanceWorldsim,
  headlineFromBalanceReport,
  MAX_WORLD_SIM_TURNS,
} from "./singleplayerWorld";
import type { BalanceReport } from "@/lib/sim/metrics";

function report(): BalanceReport {
  return {
    turn: 12,
    wealth: {
      nppCount: 40,
      totalWealth: 1234,
      meanWealth: 0,
      medianWealth: 0,
      gini: 0,
      top1PctShare: 0,
    },
    electoral: {
      totalElections: 2,
      resolvedElections: 1,
      contestedPct: 0,
      effectivePartyCount: 3.5,
      medianMarginPct: 0,
    },
    officeTurnover: { officeCount: 10, nppHeldPct: 0.7, meanTenureDays: 0 },
    crises: { totalSpawned: 4, active: 2, resolved: 2, meanResolutionHours: 0 },
    economy: { commodityCount: 3, inflationIndex: 1.2, priceVolatility: 0 },
    capacity: {
      sectorCount: 0,
      totalCapitalStock: 0,
      meanCapitalStock: 0,
      meanCapitalUtilization: 0,
      totalProducedUnits: 0,
      totalSoldUnits: 0,
      plantsMigratedSectors: 0,
    },
    marketAccess: {} as BalanceReport["marketAccess"],
    banking: {
      gateOpen: true,
      gateReasons: [],
      activeBanks: 0,
      stages: {},
      unfinishedSettlements: 0,
      resolvingEstates: 0,
      savingsMode: "off",
      savingsDiscrepancies: 0,
      counters: {},
    },
  };
}

describe("singleplayer worldsim contract", () => {
  it("advances exactly the requested number of real turns", async () => {
    let turn = 20;
    const advance = vi.fn(async () => ({
      success: true,
      turn: ++turn,
      message: "ok",
      warnings: [],
    }));
    await expect(advanceWorldsim(3, advance)).resolves.toMatchObject({
      completed: 3,
      finalTurn: 23,
    });
    expect(advance).toHaveBeenCalledTimes(3);
  });

  it("stops when the authoritative engine fails", async () => {
    const advance = vi
      .fn()
      .mockResolvedValueOnce({ success: true, turn: 2, message: "ok", warnings: [] })
      .mockResolvedValueOnce({ success: false, turn: 0, message: "locked", warnings: ["busy"] });
    await expect(advanceWorldsim(3, advance)).rejects.toThrow("locked");
    expect(advance).toHaveBeenCalledTimes(2);
  });

  it("rejects unbounded or empty requests", async () => {
    await expect(advanceWorldsim(0, vi.fn())).rejects.toThrow("1 to");
    await expect(advanceWorldsim(MAX_WORLD_SIM_TURNS + 1, vi.fn())).rejects.toThrow("1 to");
  });

  it("projects stable spectator headline fields", () => {
    expect(headlineFromBalanceReport(report())).toEqual({
      turn: 12,
      nppCount: 40,
      nppHeldPct: 0.7,
      activeCrises: 2,
      inflationIndex: 1.2,
      totalWealth: 1234,
      effectivePartyCount: 3.5,
      nppOfficeSharePct: 70,
    });
  });
});

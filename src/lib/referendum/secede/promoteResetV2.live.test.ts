import { describe, expect, it } from "vitest";
import { type Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { BondTurnResult } from "@/lib/turn/bondTurn";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { promoteResetV2ForIndependence } from "./promoteResetV2";
import { buildOpeningMetricSnapshots1991 } from "@/lib/resetMetrics/seedOpening1991";
import { buildOpeningDepartmentBoards1991 } from "@/lib/resetFinance/openingDepartmentBoards1991";
import { buildOpeningDepartmentFundingPartition } from "@/lib/resetFinance/rules/liveDepartmentAccount";
import { openingNationalTreasurySnapshots } from "@/lib/resetFinance/rules/treasurySnapshot";
import { DEPARTMENT_DEFINITIONS } from "@/lib/governmentFinance/departmentCatalog";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";
import { settleResetTreasuryCashTurn } from "@/lib/resetFinance/settleCashTurn";

describe("live successor cash settlement", () => {
  it.each(["SCO", "WAL"] as const)(
    "promotes %s with Cabinet v2 and legislation v1 then settles the next turn",
    async (countryId) => {
      const memory = createInMemoryDb(),
        db = memory as unknown as Db;
      const worldId = "synthetic-conversion",
        currentTurn = 100;
      memory.seed("gameState", [
        {
          _id: "current",
          currentTurn,
          resetWorldId: worldId,
          metricsSystemVersion: "v2",
          cabinetSystemVersion: "v2",
          legislationSystemVersion: "v1",
          demographicsSystemVersion: "v1",
          resetVersionSeeds: Object.fromEntries(
            ["metrics", "cabinet"].map((system) => [
              system,
              {
                worldId,
                revision: RESET_V2_SEED_REVISION[system as "metrics" | "cabinet"],
                sourceTurn: 1,
                completedAt: "synthetic",
                verificationHash: "synthetic",
                countries: ["US", "UK", "JP"],
              },
            ])
          ),
        },
      ]);
      memory.seed("states", [
        { _id: countryId === "SCO" ? "LOT" : "CDF", countryId, population: 1000000, gdp: 100 },
        { _id: "LON", countryId: "UK", gdp: 900, population: 9000000 },
      ]);
      memory.seed(
        "resetMetricSnapshots",
        buildOpeningMetricSnapshots1991(worldId, 1).map((row) => ({ ...row }))
      );
      const boards = buildOpeningDepartmentBoards1991(worldId, 1).filter(
        (board) => board.countryId !== "IE"
      );
      const partition = buildOpeningDepartmentFundingPartition(
        boards,
        DEPARTMENT_DEFINITIONS,
        {},
        {}
      );
      for (const account of partition.accounts) {
        account.accruedThroughTurn = currentTurn;
        account.balance = 100000;
      }
      memory.seed(
        "resetDepartmentAccounts",
        partition.accounts.map((row) => ({ ...row }))
      );
      memory.seed(
        "resetDepartmentContinuity",
        partition.continuity.map((row) => ({ ...row }))
      );
      const treasuries = openingNationalTreasurySnapshots(
        worldId,
        1,
        {
          US: { debt: 0, debtCeiling: 1e15 },
          UK: { debt: 0, debtCeiling: 1e15 },
          JP: { debt: 0, debtCeiling: 1e15 },
        },
        partition.accounts
      );
      for (const treasury of treasuries) {
        treasury.settledThroughTurn = currentTurn;
        treasury.cash = 1e12;
      }
      memory.seed(
        "resetNationalTreasuries",
        treasuries.map((row) => ({ ...row }))
      );
      memory.seed(
        "federalBudget",
        ["US", "UK", "JP", countryId].map((country) => ({
          _id: country,
          countryId: country,
          spending: { total: 1e10, debtInterest: 0, stateGrants: 0 },
          revenue: { total: 1e10 },
          debt: { principal: 0, ceiling: 1e15 },
        }))
      );
      const beforeCash = treasuries.reduce((sum, row) => sum + row.cash, 0);
      await promoteResetV2ForIndependence(db, countryId, currentTurn);
      const successor = memory
        .collection("resetNationalTreasuries")
        .docs.find((row) => row.countryId === countryId)!;
      expect(successor).toMatchObject({ sourceTurn: currentTurn, settledThroughTurn: currentTurn });
      expect(
        memory
          .collection("resetNationalTreasuries")
          .docs.reduce((sum, row) => sum + Number(row.cash), 0)
      ).toBe(beforeCash);
      expect(
        memory.collection("resetDepartmentAccounts").docs.some((row) => row.countryId === countryId)
      ).toBe(true);
      const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
      const result = await settleResetTreasuryCashTurn({
        db,
        gameState: gameState!,
        turn: currentTurn + 1,
        bondFlows: {
          sovereignCashProceedsByCountry: {},
          sovereignDebtFaceIssuedByCountry: {},
          sovereignCouponPaidByCountry: {},
          sovereignMaturityCashPaidByCountry: {},
          sovereignDebtFaceRetiredByCountry: {},
        } as BondTurnResult,
      });
      expect(result.countries).toBe(4);
      expect(result.advanced).toBeGreaterThan(0);
      expect(
        memory
          .collection("resetNationalTreasuries")
          .docs.every((row) => row.settledThroughTurn === currentTurn + 1)
      ).toBe(true);
    }
  );
});

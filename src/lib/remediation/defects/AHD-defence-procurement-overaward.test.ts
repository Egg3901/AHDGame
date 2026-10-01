import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import type { DefenceContract } from "@/lib/db/types/defenceContract";
import type { HealPlan } from "../types";
import {
  defect,
  findProcurementClawbacks,
  procurementClawbackMoveKey,
} from "./AHD-defence-procurement-overaward";

function contract(input: {
  lots: number;
  turn: number;
  corporationId: ObjectId;
  clawedBack?: number;
}): DefenceContract {
  return {
    _id: new ObjectId(),
    countryId: "US",
    corporationId: input.corporationId,
    sectorId: new ObjectId(),
    component: "ground",
    lotsOrdered: input.lots,
    lotsDelivered: input.lots,
    pricePerLot: 372_025_176,
    status: "complete",
    awardedTurn: input.turn,
    administrativeClawbackLots: input.clawedBack,
  };
}

describe("findProcurementClawbacks", () => {
  it("pins the deployed code fix used by the heal gate", () => {
    expect(defect.codeFix?.requiredCommit).toBe("2e526743207c61bcbf82d88771f79869a3a702d7");
  });

  it("recognizes only one supplier tranche in each contracting window", () => {
    const supplier = new ObjectId();
    const contracts = [
      contract({ lots: 6, turn: 96, corporationId: supplier }),
      contract({ lots: 6, turn: 96, corporationId: supplier }),
      contract({ lots: 5, turn: 96, corporationId: supplier }),
      contract({ lots: 5, turn: 96, corporationId: supplier }),
      contract({ lots: 20, turn: 96, corporationId: supplier }),
      contract({ lots: 11, turn: 116, corporationId: supplier }),
    ];

    const rows = findProcurementClawbacks(contracts, new Map([["US", 65_081_000_000]]));

    expect(rows.reduce((sum, row) => sum + row.excessLots, 0)).toBe(41);
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(15_253_032_216);
  });

  it("is a no-op after the excess lots have already been recovered", () => {
    const supplier = new ObjectId();
    const rows = findProcurementClawbacks(
      [contract({ lots: 10, turn: 96, corporationId: supplier, clawedBack: 4 })],
      new Map([["US", 65_081_000_000]])
    );
    expect(rows).toEqual([]);
  });
});

type Doc = Record<string, unknown>;

function memoryDb(seed: Record<string, Doc[]>) {
  const memory = createInMemoryDb();
  for (const [name, docs] of Object.entries(seed)) memory.seed(name, docs);
  const store = new Proxy({} as Record<string, Doc[]>, {
    get: (_target, name: string) => memory.collection(name).docs,
  });
  return { db: memory as unknown as Db, store };
}

describe("procurement clawback settlement", () => {
  const CORP = new ObjectId();
  const CONTRACT = new ObjectId();

  function world(corpCash = 5_000) {
    return memoryDb({
      corporations: [{ _id: CORP, liquidCapital: corpCash }],
      federalBudget: [{ _id: "b1", countryId: "US", defenseAppropriation: { balance: 1_000 } }],
      defenceContracts: [{ _id: CONTRACT, countryId: "US", corporationId: CORP }],
    });
  }

  const healPlan = {
    affected: 1,
    touched: [],
    moneyDelta: 0,
    summary: "",
    payload: {
      clawbacks: [
        {
          contractId: CONTRACT.toString(),
          corporationId: CORP.toString(),
          countryId: "US",
          excessLots: 2,
          amount: 4_000,
          recoverableAmount: 4_000,
          unrecoveredAmount: 0,
        },
      ],
      corporationIds: [CORP.toString()],
      budgetIds: ["b1"],
      totalAmount: 4_000,
      recoverableAmount: 4_000,
      unrecoveredAmount: 0,
      missing: [],
    },
  } as unknown as HealPlan;

  it("recovers as one keyed, net-zero move and conserves money", async () => {
    const { db, store } = world();

    await defect.apply(db, healPlan, {
      env: "sandbox" as const,
      dryRun: false,
      now: new Date(),
      runId: "run_a",
    });

    expect(store.corporations[0].liquidCapital).toBe(1_000);
    expect((store.federalBudget[0].defenseAppropriation as Doc).balance).toBe(5_000);
    expect(store.bankMoneyMoves).toHaveLength(1);
    expect(store.bankMoneyMoves[0]._id).toBe(
      procurementClawbackMoveKey("run_a", CONTRACT.toString())
    );
    expect(store.bankMoneyMoves[0].status).toBe("applied");
    expect(store.defenceContracts[0].administrativeClawbackLots).toBe(2);
  });

  it("replays instead of debiting the supplier twice", async () => {
    const { db, store } = world();
    const ctx = { env: "sandbox" as const, dryRun: false, now: new Date(), runId: "run_a" };

    await defect.apply(db, healPlan, ctx);
    await defect.apply(db, healPlan, ctx);

    expect(store.corporations[0].liquidCapital).toBe(1_000);
    expect((store.federalBudget[0].defenseAppropriation as Doc).balance).toBe(5_000);
    expect(store.defenceContracts[0].administrativeClawbackLots).toBe(2);
  });

  it("moves nothing when the supplier cannot fund the approved recovery", async () => {
    const { db, store } = world(10);

    await expect(
      defect.apply(db, healPlan, {
        env: "sandbox" as const,
        dryRun: false,
        now: new Date(),
        runId: "run_a",
      })
    ).rejects.toThrow(/did not settle/);

    expect(store.corporations[0].liquidCapital).toBe(10);
    expect((store.federalBudget[0].defenseAppropriation as Doc).balance).toBe(1_000);
    expect(store.defenceContracts[0].administrativeClawbackLots).toBeUndefined();
  });

  it("refuses to move unkeyed money when there is no run id", async () => {
    const { db, store } = world();

    await expect(
      defect.apply(db, healPlan, { env: "sandbox" as const, dryRun: false, now: new Date() })
    ).rejects.toThrow(/run id/);

    expect(store.corporations[0].liquidCapital).toBe(5_000);
  });
});

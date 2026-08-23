import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { DEFECT_ID } from "@/lib/remediation/defects/AHD-defence-supplier-windfall";

const { applyMoneyMove, emitTxBulk } = vi.hoisted(() => ({
  applyMoneyMove: vi.fn(),
  emitTxBulk: vi.fn(),
}));

vi.mock("@/lib/banking/moneyMove", () => ({ applyMoneyMove }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTxBulk,
  loadTxThresholds: vi.fn().mockResolvedValue({}),
}));

import { processDefenceWindfallRecoveryTurn } from "./defenceWindfallRecoveryTurn";

function database(corporations: unknown[]) {
  return {
    collection: vi.fn((name: string) => {
      if (name !== "corporations") throw new Error(`unexpected collection ${name}`);
      return { find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue(corporations) })) };
    }),
  };
}

function corporation(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId("6a7ccd0052c9a66f8edfa485"),
    name: "Audited supplier",
    liquidCapital: 800_000_000,
    remediation: {
      [DEFECT_ID]: {
        runId: "initial-run",
        appliedAt: new Date("2026-08-23T00:00:00Z"),
        countryId: "US",
        currencyCode: "USD",
        sourceContractIds: [],
        legacyContractGross: 1_000_000_000,
        recordedProductionCost: 0,
        retainedMarginRate: 0.2,
        retainedLegacyProfit: 200_000_000,
        assessedAmount: 800_000_000,
        recoveredAmount: 100_000_000,
        outstandingAmount: 700_000_000,
        operatingReserve: 500_000_000,
        ...overrides,
      },
    },
  };
}

describe("defence windfall recovery turn", () => {
  beforeEach(() => {
    applyMoneyMove.mockReset().mockResolvedValue({ status: "applied", applied: [0, 1] });
    emitTxBulk.mockReset().mockResolvedValue(undefined);
  });

  it("collects only cash above reserve and writes the next liability state in the debit leg", async () => {
    const db = database([corporation()]);
    const result = await processDefenceWindfallRecoveryTurn(db as never, 330);

    expect(result).toEqual({ corporationsAssessed: 1, amountRecovered: 300_000_000 });
    expect(applyMoneyMove).toHaveBeenCalledOnce();
    const move = applyMoneyMove.mock.calls[0][1];
    expect(move.key).toBe(`${DEFECT_ID}:sweep:6a7ccd0052c9a66f8edfa485:330`);
    expect(move.legs[0].amount).toBe(300_000_000);
    expect(move.legs[0].set[`remediation.${DEFECT_ID}`]).toMatchObject({
      recoveredAmount: 400_000_000,
      outstandingAmount: 400_000_000,
      lastSweepTurn: 330,
    });
    expect(emitTxBulk).toHaveBeenCalledOnce();
    expect(emitTxBulk.mock.calls[0][1]).toHaveLength(2);
  });

  it("does nothing when the operating reserve is all the cash available", async () => {
    const db = database([corporation({ operatingReserve: 800_000_000 })]);
    const result = await processDefenceWindfallRecoveryTurn(db as never, 330);

    expect(result).toEqual({ corporationsAssessed: 1, amountRecovered: 0 });
    expect(applyMoneyMove).not.toHaveBeenCalled();
    expect(emitTxBulk).not.toHaveBeenCalled();
  });

  it("does not collect twice in the same turn", async () => {
    const db = database([corporation({ lastSweepTurn: 330 })]);
    await processDefenceWindfallRecoveryTurn(db as never, 330);
    expect(applyMoneyMove).not.toHaveBeenCalled();
  });
});

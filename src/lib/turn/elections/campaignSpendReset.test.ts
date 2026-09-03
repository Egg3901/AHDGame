import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import {
  SPEND_STOCK_DUST_CUTOFF,
  SPEND_STOCK_RETENTION,
  rollSpendStock,
} from "@/lib/electionEngine/electionFormulaFactors";
import { processCampaignSpendReset } from "./campaignSpendReset";

describe("rollSpendStock", () => {
  it("banks fresh spend at full weight with no prior stock", () => {
    expect(rollSpendStock(undefined, 1_000)).toBe(1_000);
    expect(rollSpendStock(0, 250)).toBe(250);
  });

  it("fades idle stock gradually instead of cliffing to zero (ticket #1261)", () => {
    // Old behavior: an idler's spend read as exactly 0 next turn. Now one
    // idle turn keeps 80%, not 0%.
    expect(rollSpendStock(100, 0)).toBe(80);
    expect(rollSpendStock(100, undefined)).toBe(80);
  });

  it("hoarded treasuries score zero: no spend ever means no stock", () => {
    expect(rollSpendStock(undefined, undefined)).toBeUndefined();
    expect(rollSpendStock(0, 0)).toBeUndefined();
  });

  it("converges a steady spender to spend / (1 - retention)", () => {
    let stock: number | undefined;
    for (let turn = 0; turn < 100; turn++) stock = rollSpendStock(stock, 10);
    // Steady state for 10/turn at 0.8 retention is 50.
    expect(stock).toBeCloseTo(50, 4);
  });

  it("lets a one-time splurge lead briefly, then lose to steady spending", () => {
    // Splurger banks 100 once, then idles; grinder spends 1 every turn
    // (steady state 5). Crossover solves at ~14 turns for these stakes:
    // ahead at 4, behind at 15.
    let splurge: number | undefined = 100;
    let steady: number | undefined;
    for (let turn = 0; turn < 4; turn++) {
      splurge = rollSpendStock(splurge, 0);
      steady = rollSpendStock(steady, 1);
    }
    expect(splurge!).toBeGreaterThan(steady!);
    for (let turn = 0; turn < 11; turn++) {
      splurge = rollSpendStock(splurge, 0);
      steady = rollSpendStock(steady, 1);
    }
    expect(splurge ?? 0).toBeLessThan(steady!);
  });

  it("drops sub-dollar dust so idle rows go quiet", () => {
    expect(rollSpendStock(0.5, 0)).toBeUndefined();
    expect(SPEND_STOCK_DUST_CUTOFF).toBe(1);
    expect(SPEND_STOCK_RETENTION).toBe(0.8);
  });
});

describe("processCampaignSpendReset", () => {
  it("rolls stock with retention, clears the accumulator, and reports touched rows", async () => {
    const mockUpdateMany = vi.fn().mockResolvedValue({ modifiedCount: 3 });
    const mockDb = {
      collection: vi.fn().mockReturnValue({ updateMany: mockUpdateMany }),
    } as unknown as Db;

    const result = await processCampaignSpendReset(mockDb);

    expect(result).toEqual({ campaignsReset: 3 });
    expect(mockUpdateMany).toHaveBeenCalledOnce();
    const [filter, pipeline] = mockUpdateMany.mock.calls[0];
    // Only rows carrying fresh spend or a live stock are touched.
    expect(filter).toEqual({
      $or: [{ spendThisTurn: { $gt: 0 } }, { spendStock: { $gte: SPEND_STOCK_DUST_CUTOFF } }],
    });
    // Pipeline: fold accumulator into faded stock (dropping dust), then
    // clear the accumulator. Shape mirrors rollSpendStock exactly.
    expect(Array.isArray(pipeline)).toBe(true);
    const [setStage, unsetStage] = pipeline as Array<Record<string, unknown>>;
    expect(unsetStage).toEqual({ $unset: "spendThisTurn" });
    expect(JSON.stringify(setStage)).toContain("$spendStock");
    expect(JSON.stringify(setStage)).toContain("$spendThisTurn");
    expect(JSON.stringify(setStage)).toContain(String(SPEND_STOCK_RETENTION));
  });
});

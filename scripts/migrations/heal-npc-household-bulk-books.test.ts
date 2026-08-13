import { describe, expect, it } from "vitest";
import type { BankCharter } from "@/lib/db/types/bank";
import { buildReactivatedCharter } from "./heal-npc-household-bulk-books";

function archivedCharter(overrides: Partial<BankCharter> = {}): BankCharter {
  return {
    type: "retail",
    status: "failed",
    currency: "USD",
    charteredTurn: 66,
    postedCapital: 100_000,
    depositOffset: 0,
    lendingOffset: 1,
    totalDeposits: 4_000_000,
    totalLoans: 29_450_000_000,
    npcDeposits: 3_000_000,
    reserves: 1,
    confidence: 0,
    warningBand: "red",
    panicTurns: 4,
    failedTurn: 69,
    depositorsResolvedTurn: 70,
    capitalStanding: "undercapitalized",
    undercapitalizedSinceTurn: 68,
    ...overrides,
  };
}

describe("NPC household bulk-book repair", () => {
  it("reactivates a failed charter as an empty, clean bank", () => {
    const restored = buildReactivatedCharter(archivedCharter(), 200_000);

    expect(restored).toMatchObject({
      status: "active",
      postedCapital: 100_000,
      totalDeposits: 0,
      totalLoans: 0,
      npcDeposits: 0,
      reserves: 200_000,
      confidence: 1,
      warningBand: "green",
      panicTurns: 0,
    });
    expect(restored).not.toHaveProperty("failedTurn");
    expect(restored).not.toHaveProperty("depositorsResolvedTurn");
    expect(restored).not.toHaveProperty("undercapitalizedSinceTurn");
  });
});

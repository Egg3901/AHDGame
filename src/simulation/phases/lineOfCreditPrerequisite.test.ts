import { describe, expect, it, vi } from "vitest";

const processLineOfCreditTurn = vi.fn(async () => ({
  charactersProcessed: 1,
  paymentsInternal: 1,
}));
vi.mock("@/lib/turn/lineOfCreditTurn", () => ({
  processLineOfCreditTurn: (...args: unknown[]) => processLineOfCreditTurn(...(args as [])),
}));
vi.mock("@/lib/extraction/featureFlag", () => ({
  isProspectingEnabled: async () => false,
  isContractIssuanceEnabled: async () => false,
}));

import { getTurnPhaseRegistry } from "@/simulation/phases/turnPhaseRegistry";

/** Runs only lineOfCreditTurn; every other phase yields no result, as a resume skip does. */
async function runLineOfCredit(gameState: Record<string, unknown>) {
  const adapter = getTurnPhaseRegistry().find((entry) => entry.key === "resourceAndFinanceStart")!;
  let outcome: { ok: true } | { ok: false; error: unknown } | null = null;
  const runtime = {
    runPhase: vi.fn(async (name: string, fn: () => Promise<unknown>) => {
      if (name !== "lineOfCreditTurn") return null;
      try {
        const result = await fn();
        outcome = { ok: true };
        return result;
      } catch (error) {
        outcome = { ok: false, error };
        return null;
      }
    }),
    markPhaseSkipped: vi.fn(async () => {}),
    requirePhaseResult: vi.fn(),
    resumeResultOutcome: vi.fn(() => null),
  };
  const context = {
    db: {},
    characters: [],
    config: null,
    gameNow: new Date(),
    stateMap: new Map(),
    gameState: { currentTurn: 11, ...gameState },
    newTurn: 12,
    currentYear: 1991,
    phaseResults: {},
    warnings: [],
  } as never;
  await adapter.execute(context, runtime as never);
  return outcome as { ok: true } | { ok: false; error: unknown } | null;
}

describe("lineOfCreditTurn prerequisite (#3429)", () => {
  it("fails closed when forex is on and the corporation result is missing", async () => {
    processLineOfCreditTurn.mockClear();
    const outcome = await runLineOfCredit({ forexEnabled: true });
    expect(outcome).toMatchObject({ ok: false });
    expect(String((outcome as { error: unknown }).error)).toMatch(
      /needs this turn's corporationTurn currency income/
    );
    expect(processLineOfCreditTurn).not.toHaveBeenCalled();
  });

  it("still runs when corporation actions are paused, since nothing was earned", async () => {
    processLineOfCreditTurn.mockClear();
    await expect(
      runLineOfCredit({ forexEnabled: true, corporationActionsPaused: true })
    ).resolves.toEqual({ ok: true });
    expect(processLineOfCreditTurn).toHaveBeenCalledTimes(1);
  });

  it("still runs without forex, where currency income is unused", async () => {
    processLineOfCreditTurn.mockClear();
    await expect(runLineOfCredit({ forexEnabled: false })).resolves.toEqual({ ok: true });
    expect(processLineOfCreditTurn).toHaveBeenCalledTimes(1);
  });
});

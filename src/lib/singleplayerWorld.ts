import type { BalanceReport } from "@/lib/sim/metrics";
import type { processTurn } from "@/lib/turnSystem";

/** Keep a browser request from monopolising the local server indefinitely. */
export const MAX_WORLD_SIM_TURNS = 1_000;
/** Maximum turns in one cancellable HTTP request; clients can repeat it. */
export const MAX_WORLD_SIM_BATCH_TURNS = 12;

export interface WorldsimTurnResult {
  completed: number;
  finalTurn: number;
  results: Array<{ turn: number; message: string; warnings: string[] }>;
}

export interface WorldsimHeadline {
  turn: number;
  nppCount: number;
  nppHeldPct: number;
  activeCrises: number;
  inflationIndex: number;
  totalWealth: number;
  effectivePartyCount: number;
  nppOfficeSharePct: number;
}

export type TurnProcessor = typeof processTurn;

/**
 * Advance a local world through the same turn engine used by the live game.
 * The processor is injectable so the contract can be tested without a DB and
 * callers cannot accidentally replace it with a second simulation formula.
 */
export async function advanceWorldsim(
  turns: number,
  advanceTurn?: TurnProcessor
): Promise<WorldsimTurnResult> {
  if (!Number.isInteger(turns) || turns < 1 || turns > MAX_WORLD_SIM_TURNS) {
    throw new Error(`turns must be an integer from 1 to ${MAX_WORLD_SIM_TURNS}`);
  }

  const advance = advanceTurn ?? (await import("@/lib/turnSystem")).processTurn;
  const results: WorldsimTurnResult["results"] = [];
  for (let index = 0; index < turns; index++) {
    const result = await advance();
    if (!result.success || result.turn <= 0) {
      throw new Error(
        `Worldsim stopped after ${index} turn${index === 1 ? "" : "s"}: ${result.message}`
      );
    }
    results.push({ turn: result.turn, message: result.message, warnings: result.warnings });
  }

  return {
    completed: results.length,
    finalTurn: results[results.length - 1]!.turn,
    results,
  };
}

/** Select the stable, headline figures a spectator view needs from the full report. */
export function headlineFromBalanceReport(report: BalanceReport): WorldsimHeadline {
  const officeCount = report.officeTurnover.officeCount;
  return {
    turn: report.turn,
    nppCount: report.wealth.nppCount,
    nppHeldPct: report.officeTurnover.nppHeldPct,
    activeCrises: report.crises.active,
    inflationIndex: report.economy.inflationIndex,
    totalWealth: report.wealth.totalWealth,
    effectivePartyCount: report.electoral.effectivePartyCount,
    nppOfficeSharePct: officeCount > 0 ? report.officeTurnover.nppHeldPct * 100 : 0,
  };
}

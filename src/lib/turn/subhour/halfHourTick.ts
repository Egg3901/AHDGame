import type { Db } from "mongodb";
import * as Sentry from "@sentry/nextjs";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { runInAuditContext } from "@/lib/observability/context";
import { runElectionHalfTick } from "@/lib/turn/elections/electionHalfTick";
import { runGrowthHalfStep } from "./growthHalfStep";
import { runInflationHalfStep } from "./inflationHalfStep";
import { runForexHalfStep } from "./forexHalfStep";
import { runMarketTick, type MarketTickResult } from "./marketTick";

export interface HalfHourTickResult {
  turn: number;
  electionTurn: number | null;
  steps: Record<string, Record<string, unknown> | { error: string }>;
  market: MarketTickResult | null;
  ms: number;
}

/**
 * The :30 tick, run when the hour's turn already happened.
 *
 * Order mirrors the turn: election results, then growth, inflation and
 * exchange rates (each reads the one before), then the market tick so share
 * prices see the new rates. Each macro step applies half of the coming turn's
 * step under the stepFraction.ts contract, so a failed or skipped step is
 * absorbed by the turn. One step failing does not stop the others.
 *
 * Returns null when the world is inactive, in fast mode (turns already run
 * every 30 minutes) or a turn holds the lock.
 */
export async function runHalfHourTick(
  now: Date = new Date(),
  db?: Db
): Promise<HalfHourTickResult | null> {
  const database = db ?? (await getDb());
  const started = Date.now();
  const state = await database
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentTurn: 1, isActive: 1, isProcessing: 1, fastMode: 1 } }
    );
  if (!state?.isActive || state.isProcessing || state.fastMode) return null;
  const turn = state.currentTurn + 1;

  const steps: HalfHourTickResult["steps"] = {};
  let electionTurn: number | null = null;
  try {
    electionTurn = await runElectionHalfTick(now);
  } catch (error) {
    steps.elections = { error: error instanceof Error ? error.message : String(error) };
    Sentry.captureException(error, { tags: { component: "cron", job: "halfTick:elections" } });
  }
  const macro: [string, (db: Db, turn: number, now: Date) => Promise<Record<string, unknown>>][] = [
    ["growth", runGrowthHalfStep],
    ["inflation", runInflationHalfStep],
    ["forex", runForexHalfStep],
  ];
  for (const [name, step] of macro) {
    try {
      steps[name] = await runInAuditContext(`half-tick:${name}:${turn}`, () =>
        step(database, turn, now)
      );
    } catch (error) {
      steps[name] = { error: error instanceof Error ? error.message : String(error) };
      Sentry.captureException(error, { tags: { component: "cron", job: `halfTick:${name}` } });
    }
  }
  const market = await runMarketTick(now, database);
  return { turn, electionTurn, steps, market, ms: Date.now() - started };
}

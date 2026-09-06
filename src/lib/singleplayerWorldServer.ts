import type { Db } from "mongodb";
import { collectBalanceMetrics } from "@/lib/sim/metrics";
import { headlineFromBalanceReport, type WorldsimHeadline } from "@/lib/singleplayerWorld";

export interface WorldsimStats {
  headline: WorldsimHeadline;
  metrics: Awaited<ReturnType<typeof collectBalanceMetrics>>;
}

/** Read the existing worldsim aggregates without mutating the game world. */
export async function readWorldsimStats(db: Db): Promise<WorldsimStats> {
  const metrics = await collectBalanceMetrics(db);
  return { headline: headlineFromBalanceReport(metrics), metrics };
}

/**
 * European institutional state is initialized once, preserving existing unions
 * and member choices. Seed replay never resets a ratification or settlement.
 */
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { getStartingYearForPreset } from "@/lib/constants/turnTime";
import { initialEuropeanIntegration, type EuropeanIntegrationState } from "./rules";

export async function ensureEuropeanIntegrationState(
  db: Db,
  preset: string,
  hasEuropeanMembers: boolean
): Promise<EuropeanIntegrationState> {
  const states = db.collection<GameState>("gameState");
  const state = await states.findOne(
    { _id: "current" },
    { projection: { currentTurn: 1, europeanIntegration: 1 } }
  );
  if (state?.europeanIntegration) return state.europeanIntegration;
  const initial = initialEuropeanIntegration({
    startingYear: getStartingYearForPreset(preset),
    currentTurn: state ? (state.currentTurn ?? 2) : 0,
    hasEuropeanMembers,
  });
  if (!state) return initial;
  const result = await states.updateOne(
    { _id: "current", europeanIntegration: { $exists: false } },
    { $set: { europeanIntegration: initial } }
  );
  if (result.matchedCount === 1) return initial;
  const latest = await states.findOne(
    { _id: "current" },
    { projection: { europeanIntegration: 1 } }
  );
  if (!latest?.europeanIntegration)
    throw new Error("European institutional state changed concurrently; retry");
  return latest.europeanIntegration;
}

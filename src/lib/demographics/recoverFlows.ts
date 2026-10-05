/**
 * Interrupted population updates finish before resumed turns read their state.
 * recoverDemographicFlowsBeforeContext resumes frozen receipts and only retries
 * an uncommitted phase when its durable attempt proves it used the journal.
 */
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import { loadDemographicFlowReceipt, resumePendingDemographicFlowReceipts } from "./flowJournal";
import { demographicRecoveryDecision } from "./rules/flowReceipt";
import { ensureDemographicWorldEpoch } from "./worldEpoch";

export async function recoverDemographicFlowsBeforeContext(
  db: Db,
  gameState: GameState,
  interruptedPhases?: Set<string>
): Promise<void> {
  const worldEpochId = await ensureDemographicWorldEpoch(db, gameState);
  gameState.worldEpochId = worldEpochId;
  const targetTurn = gameState.currentTurn + 1;
  await resumePendingDemographicFlowReceipts(db, worldEpochId, targetTurn);
  if (!interruptedPhases?.has("demographicFlows")) return;
  const receipt = await loadDemographicFlowReceipt(db, worldEpochId, targetTurn);
  const journalAttemptStarted =
    gameState.demographicFlowAttempt?.worldEpochId === worldEpochId &&
    gameState.demographicFlowAttempt.turn === targetTurn;
  const decision = demographicRecoveryDecision(receipt?.status ?? "missing", journalAttemptStarted);
  if (decision === "rerun") interruptedPhases.delete("demographicFlows");
}

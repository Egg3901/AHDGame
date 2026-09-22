/**
 * Turn progress polls share a small public snapshot for at most half a second.
 * Gameplay writes and lock acquisition always read authoritative state directly.
 */
import { getGameStateCollection } from "@/lib/db/collections";
import type { GameState } from "@/lib/db/types";
import { isSingleplayer } from "@/lib/singleplayer";

export const TURN_STATUS_PROJECTION = {
  currentTurn: 1,
  currentYear: 1,
  startingYear: 1,
  preIterationTurns: 1,
  "preIteration.active": 1,
  preset: 1,
  isActive: 1,
  isProcessing: 1,
  lastTurnProcessed: 1,
  pausedAt: 1,
  pauseReason: 1,
  pauseKind: 1,
  processingPhase: 1,
  processingPhaseStatuses: 1,
  processingTargetTurn: 1,
  processingHeartbeatAt: 1,
  processingStartedAt: 1,
  processingAbandonedAt: 1,
  updatedAt: 1,
  corporationActionsPaused: 1,
  playerTransfersPaused: 1,
  freePartyMovesOpen: 1,
  forexEnabled: 1,
  playerRandomEventsEnabled: 1,
  fastMode: 1,
} as const;

type TurnStatusSnapshot = Pick<
  GameState,
  Exclude<keyof typeof TURN_STATUS_PROJECTION, "preIteration.active"> | "preIteration"
>;

let cached: TurnStatusSnapshot | null = null;
let expiresAt = 0;
let pending: Promise<TurnStatusSnapshot | null> | null = null;

async function readSnapshot(): Promise<TurnStatusSnapshot | null> {
  const collection = await getGameStateCollection();
  return collection.findOne<TurnStatusSnapshot>(
    { _id: "current" },
    { projection: TURN_STATUS_PROJECTION }
  );
}

export async function getTurnStatusSnapshot(): Promise<TurnStatusSnapshot | null> {
  // Local turns can complete between consecutive clicks and need immediate reads.
  if (isSingleplayer()) return readSnapshot();
  if (cached && Date.now() < expiresAt) return cached;
  if (pending) return pending;
  const request = readSnapshot();
  pending = request;
  try {
    const snapshot = await request;
    cached = snapshot;
    expiresAt = Date.now() + 500;
    return snapshot;
  } finally {
    pending = null;
  }
}

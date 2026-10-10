/**
 * Approval conditions read verified owner boards in Metrics v2 worlds.
 * loadResetApprovalModifiers batches a country's boards and rejects missing,
 * mismatched or stale inputs instead of substituting retired metric stores.
 */
import { primaryMetrics } from "./catalog";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { isResetV2Country, resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";
import { resolveGameYear } from "@/lib/era/era";
import { buildResetMetricSnapshot, type ResetMetricSnapshot } from "./rules/snapshot";
import type { StateMetrics } from "@/lib/db/types/stateMetrics";
import { evaluateResetApprovalModifiers, resetApprovalBaseMetrics } from "./rules/approval";

/** Approval needs current observations, never their notes or retained history. */
export const RESET_APPROVAL_BOARD_PROJECTION = {
  _id: 1,
  worldId: 1,
  countryId: 1,
  scope: 1,
  regionId: 1,
  sourceTurn: 1,
  asOfTurn: 1,
  lastRefreshFromTurn: 1,
  ...Object.fromEntries(
    primaryMetrics.flatMap((metric) =>
      ["metricId", "path", "value", "status", "source", "owner"].map((field) => [
        `observations.${metric.id}.${field}`,
        1,
      ])
    )
  ),
};

export async function loadResetApprovalModifiers(
  db: Db,
  countryId: string,
  stateIds: readonly string[],
  gameState: GameState | null,
  turn?: number,
  prefetchedBoards?: readonly ResetMetricSnapshot[]
): Promise<{ modifiersByRegion: Map<string, ActiveModifier[]>; metrics: StateMetrics[] } | null> {
  if (
    !isResetV2Country(countryId) ||
    resetSystemVersionsForCountry(gameState, RESET_V2_READY, countryId).metrics !== "v2"
  )
    return null;
  const boards =
    prefetchedBoards ??
    (await db
      .collection<ResetMetricSnapshot>("resetMetricSnapshots")
      .find(
        { worldId: gameState!.resetWorldId, countryId },
        {
          projection: RESET_APPROVAL_BOARD_PROJECTION,
        }
      )
      .toArray());
  const byId = new Map(boards.map((board) => [board._id, board]));
  const expectedTurn = turn ?? gameState!.currentTurn;
  const read = (regionId?: string) => {
    const board = byId.get(`${countryId}:${regionId ?? "national"}`);
    if (
      !board ||
      board.worldId !== gameState!.resetWorldId ||
      board.countryId !== countryId ||
      board.regionId !== regionId ||
      board.scope !== (regionId === undefined ? "national" : "regional") ||
      !(
        board.asOfTurn === expectedTurn ||
        (turn === undefined &&
          gameState!.isProcessing === true &&
          gameState!.processingKind === "turn" &&
          gameState!.processingTargetTurn === expectedTurn + 1 &&
          board.asOfTurn === expectedTurn + 1 &&
          Number.isSafeInteger(board.lastRefreshFromTurn) &&
          board.lastRefreshFromTurn! >= board.sourceTurn &&
          board.lastRefreshFromTurn! <= expectedTurn)
      ) ||
      board.sourceTurn < gameState!.resetVersionSeeds!.metrics!.sourceTurn ||
      board.sourceTurn > board.asOfTurn
    ) {
      throw new Error(
        `Approval needs a current Metrics v2 board for ${countryId}/${regionId ?? "national"}`
      );
    }
    return buildResetMetricSnapshot({
      worldId: board.worldId,
      countryId: board.countryId,
      regionId,
      sourceTurn: board.sourceTurn,
      observations: board.observations,
    }).observations;
  };
  const national = read();
  const context = {
    countryId,
    preset: gameState?.preset,
    year: gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null,
  };
  const modifiersByRegion = new Map<string, ActiveModifier[]>();
  const metrics = stateIds.map((id) => {
    const observations = { ...read(id), ...national };
    modifiersByRegion.set(id, evaluateResetApprovalModifiers(observations, context));
    return {
      ...resetApprovalBaseMetrics(observations),
      _id: id,
      countryId,
    } as unknown as StateMetrics;
  });
  return { modifiersByRegion, metrics };
}

import type { RegionalOpeningClaim } from "./regionalOpeningAllocation";
import type { ResetCountry } from "@/lib/resetLegislation/fundingOwner";

/** Regional opening claims are seed allocations, not ministerial treasuries. */
export interface ResetRegionalOpeningBoard {
  _id: string;
  worldId: string;
  countryId: ResetCountry;
  regionId: string;
  sourceTurn: number;
  annualSpending: number;
  familyOwned: number;
  otherExistingServices: number;
  allocatedClaims: RegionalOpeningClaim[];
  estimateKind: "proportional-source-pool";
}

export function regionalOpeningBoardPayload(boards: readonly ResetRegionalOpeningBoard[]): string {
  const ids = new Set<string>();
  for (const board of boards) {
    if (
      board._id !== `${board.countryId}:${board.regionId}` ||
      ids.has(board._id) ||
      !board.worldId ||
      !Number.isSafeInteger(board.sourceTurn) ||
      board.sourceTurn < 1 ||
      board.estimateKind !== "proportional-source-pool" ||
      !Number.isFinite(board.annualSpending) ||
      board.annualSpending < 0 ||
      !Number.isFinite(board.familyOwned) ||
      board.familyOwned < 0 ||
      !Number.isFinite(board.otherExistingServices) ||
      board.otherExistingServices < 0
    ) {
      throw new Error(`Invalid regional opening board ${board._id}`);
    }
    ids.add(board._id);
    const sourceIds = new Set<string>();
    let owned = 0;
    for (const claim of board.allocatedClaims) {
      if (
        !claim.sourceId ||
        sourceIds.has(claim.sourceId) ||
        !claim.familyId ||
        !Number.isFinite(claim.annualBooked) ||
        claim.annualBooked < 0
      ) {
        throw new Error(`Invalid source claim in ${board._id}`);
      }
      sourceIds.add(claim.sourceId);
      owned += claim.annualBooked;
    }
    if (
      Math.abs(owned - board.familyOwned) > 0.01 ||
      Math.abs(board.familyOwned + board.otherExistingServices - board.annualSpending) > 0.01
    ) {
      throw new Error(`Regional opening claims do not reconcile in ${board._id}`);
    }
  }
  if (boards.length === 0) throw new Error("Regional opening must contain regions");
  return JSON.stringify(
    [...boards]
      .sort((a, b) => a._id.localeCompare(b._id))
      .map((board) => [
        board._id,
        board.worldId,
        board.countryId,
        board.regionId,
        board.sourceTurn,
        board.annualSpending,
        board.familyOwned,
        board.otherExistingServices,
        board.estimateKind,
        [...board.allocatedClaims]
          .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
          .map((claim) => [claim.sourceId, claim.familyId, claim.annualBooked]),
      ])
  );
}

import { openingDepartmentClaims1991 } from "./openingDepartmentClaims1991";
import { openingFiscalOwnership1991 } from "./openingOwnership1991";
import {
  departmentOpeningBoardPayload,
  type ResetDepartmentOpeningBoard,
} from "./rules/departmentBoard";

/** Reconciled 1991 operating claims, separate from the existing v1 treasury. */
export function buildOpeningDepartmentBoards1991(
  worldId: string,
  sourceTurn: number
): ResetDepartmentOpeningBoard[] {
  const claims = openingDepartmentClaims1991();
  const fiscal = openingFiscalOwnership1991();
  const boards = (["US", "UK", "JP"] as const).map((countryId) => ({
    _id: countryId,
    worldId,
    countryId,
    sourceTurn,
    operating: fiscal[countryId].operating,
    continuityAmount: claims[countryId].continuityAmount,
    accounts: claims[countryId].accounts,
  }));
  departmentOpeningBoardPayload(boards);
  return boards;
}

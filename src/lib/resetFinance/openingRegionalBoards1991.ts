import { openingRegionalFiscalOwnership1991 } from "./openingRegionalOwnership1991";
import {
  regionalOpeningBoardPayload,
  type ResetRegionalOpeningBoard,
} from "./rules/regionalOpeningBoard";

/** Proportional source-pool allocation, never a claim of observed local spending. */
export function buildOpeningRegionalBoards1991(
  worldId: string,
  sourceTurn: number
): ResetRegionalOpeningBoard[] {
  const ownership = openingRegionalFiscalOwnership1991();
  const boards = (["US", "UK", "JP", "IE"] as const).flatMap((countryId) =>
    ownership[countryId].regions.map((region) => ({
      _id: `${countryId}:${region.regionId}`,
      worldId,
      countryId,
      regionId: region.regionId,
      sourceTurn,
      annualSpending: region.annualSpending,
      familyOwned: region.familyOwned,
      otherExistingServices: region.otherExistingServices,
      allocatedClaims: region.allocatedClaims,
      estimateKind: "proportional-source-pool" as const,
    }))
  );
  regionalOpeningBoardPayload(boards);
  return boards;
}

/** Full 1991 current-law boards, independent of the selectable v2 law levels. */
import { states1991 } from "@/lib/countries/us/data/usStates1991";
import { ukRegions1991 } from "@/lib/countries/uk/data/ukRegions1991";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";
import { openingLawReferences } from "./openingLaw";
import { buildResetLawOpeningBoard, type ResetLawOpeningBoard } from "./rules/openingBoard";
import { buildUkTerritorialTaxOpenings1991 } from "@/lib/countries/uk/resetLegislation/openingUkTerritorialTax1991";
import { buildOpeningRegionalBoards1991 } from "@/lib/resetFinance/openingRegionalBoards1991";
import { regionalizeOpeningReferences } from "./rules/regionalizeOpeningReferences";

export function buildOpeningLawBoards1991(
  worldId: string,
  sourceTurn: number
): ResetLawOpeningBoard[] {
  const regions = { US: states1991, UK: ukRegions1991, JP: jpRegions1991 } as const;
  const boards: ResetLawOpeningBoard[] = [];
  const fiscalByRegion = new Map(
    buildOpeningRegionalBoards1991(worldId, sourceTurn).map((board) => [board._id, board])
  );
  const ukTax = new Map(buildUkTerritorialTaxOpenings1991().map((row) => [row.regionId, row]));
  const ukCountryId = ukRegions1991[0]!.countryId;
  for (const countryId of ["US", "UK", "JP"] as const) {
    for (const scope of ["national", "regional"] as const) {
      const references = openingLawReferences.filter(
        (reference) => reference.country === countryId && reference.scope === scope
      );
      if (scope === "national") {
        boards.push(buildResetLawOpeningBoard({ worldId, countryId, sourceTurn, references }));
      } else {
        for (const region of regions[countryId]) {
          const fiscal = fiscalByRegion.get(`${countryId}:${region._id}`);
          if (!fiscal) throw new Error(`Missing 1991 fiscal shares for ${countryId}:${region._id}`);
          boards.push(
            buildResetLawOpeningBoard({
              worldId,
              countryId,
              regionId: region._id,
              sourceTurn,
              references: regionalizeOpeningReferences(references, fiscal.allocatedClaims),
              ...(countryId === ukCountryId ? { ukTerritorialTax: ukTax.get(region._id) } : {}),
            })
          );
        }
      }
    }
  }
  if (boards.length !== 74 || new Set(boards.map((board) => board._id)).size !== boards.length) {
    throw new Error("1991 law opening must contain three national and 71 regional boards");
  }
  return boards;
}

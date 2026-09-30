import type { CorporateSector } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  buildCorporationNationalRevenueShareByMarket,
  corporationNationalSectorShareKey,
} from "@/lib/corporations/marketShare";
import type { NppPlantsContext } from "@/lib/turn/npp/corpDecisionTypes";

/** Build a zero-query national-share resolver from the NPP phase snapshot. */
export function buildNppNationalShareResolver(
  sectors: CorporateSector[]
): NonNullable<NppPlantsContext["nationalShareOf"]> {
  const shares = buildCorporationNationalRevenueShareByMarket(sectors);
  return (corporationId, countryId, sectorType) =>
    shares.get(
      corporationNationalSectorShareKey(corporationId, countryId as CountryId, sectorType)
    ) ?? 0;
}

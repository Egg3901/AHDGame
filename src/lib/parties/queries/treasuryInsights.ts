import type { CountryId } from "@/lib/constants/countries";
import { buildNationalTreasuryInsights } from "@/lib/treasury/partyTreasuryInsights";
import type { Db } from "mongodb";

export async function getPartyTreasuryInsights(
  db: Db,
  {
    countryId,
    partyId,
    partyName,
  }: {
    countryId: CountryId;
    partyId: string;
    partyName: string;
  }
) {
  return buildNationalTreasuryInsights(db, countryId, partyId, partyName);
}

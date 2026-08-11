import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { getSubNationalLegislatureKey } from "@/lib/constants/countries";
import { getCurrentOfficeHolder } from "@/lib/governorOffice/queries";
import type { ElectedOfficial } from "@/lib/db/types";

/** Party (sequentialId string) holding > 50% of seats, or null. */
export function chamberMajorityParty(
  officials: { party?: string | null; seatsHeld?: number }[]
): string | null {
  const seats: Record<string, number> = {};
  for (const o of officials) {
    if (!o.party) continue;
    seats[o.party] = (seats[o.party] ?? 0) + (o.seatsHeld ?? 1);
  }
  const total = Object.values(seats).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const threshold = total / 2;
  for (const [party, count] of Object.entries(seats)) {
    if (count > threshold) return party;
  }
  return null;
}

export async function checkStateTrifecta(
  db: Db,
  countryId: string,
  stateId: string
): Promise<{
  hasTrifecta: boolean;
  partyId: string | null;
  governorParty: string | null;
  chamberParty: string | null;
}> {
  const governor = await getCurrentOfficeHolder(db, countryId as CountryId, stateId);
  const governorParty = governor?.party ?? null;

  const chamberKey = getSubNationalLegislatureKey(countryId as CountryId);
  const officials = (await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      officeType: chamberKey,
      state: stateId.toUpperCase(),
      countryId,
    } as Partial<ElectedOfficial>)
    .toArray()) as ElectedOfficial[];
  const chamberParty = chamberMajorityParty(officials);

  const hasTrifecta = !!governorParty && !!chamberParty && governorParty === chamberParty;
  return { hasTrifecta, partyId: hasTrifecta ? governorParty : null, governorParty, chamberParty };
}

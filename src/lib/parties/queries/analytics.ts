import type { CountryId } from "@/lib/constants/countries";
import {
  buildPartyDisciplineAnalytics,
  buildPartyOrgAnalytics,
  buildPartySlateAnalytics,
} from "@/lib/partyAnalytics";
import { buildPartyCaucusHealthSnapshot } from "@/lib/caucus/caucusHealth";
import { partyUrl } from "@/lib/urls";
import type { PartyAnalyticsPayload } from "@/lib/partyAnalytics/types";
import type { Db } from "mongodb";

export async function getPartyAnalytics(
  db: Db,
  {
    countryId,
    partyId,
  }: {
    countryId: CountryId;
    partyId: string;
  }
): Promise<PartyAnalyticsPayload> {
  const [org, discipline, caucuses, slate] = await Promise.all([
    buildPartyOrgAnalytics(db, countryId, partyId),
    buildPartyDisciplineAnalytics(db, countryId, partyId),
    buildPartyCaucusHealthSnapshot(db, countryId, partyId),
    buildPartySlateAnalytics(db, countryId, partyId),
  ]);

  const partyHref = partyUrl(countryId, partyId);
  return {
    links: {
      slate: { label: "Open Slate", href: `${partyHref}?tab=slate` },
      whipRoom: { label: "Open Whip Room", href: `${partyHref}?tab=whip-room` },
      caucuses: { label: "Open Caucuses", href: `${partyHref}?tab=caucuses` },
      npps: { label: "Open NPPs", href: `${partyHref}?tab=actions&sub=management` },
      elections: { label: "Open Elections", href: `${partyHref}?tab=elections` },
      stateParties: { label: "Open State Parties", href: `${partyHref}?tab=elections&sub=state` },
    },
    org,
    discipline,
    caucuses,
    slate,
  };
}

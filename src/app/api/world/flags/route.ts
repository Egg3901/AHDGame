import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import {
  euroAdoptionRefusal,
  euroConsentedCountries,
  euroMemberCurrencies,
} from "@/lib/currency/euro/rules";
import { resolveGameYear } from "@/lib/era/era";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export async function GET() {
  const db = await getDb();
  const gs = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        preset: 1,
        eurozoneEnabled: 1,
        euroAdoptedCountries: 1,
        euroMonetaryUnion: 1,
        currentTurn: 1,
        eraSystemEnabled: 1,
        currentYear: 1,
        currentEraId: 1,
        startingYear: 1,
        incomeBandIndexByCountry: 1,
        liveElectionResultsEnabled: 1,
      },
    }
  );
  const members = await db
    .collection<OrganizationMembership>("organizationMemberships")
    .find({ organizationId: "EU" }, { projection: { countryId: 1 } })
    .toArray();
  const euroState = { ...gs, eurozoneEnabled: gs?.eurozoneEnabled ?? true };
  const euroAdoptionEligibleCountries = COUNTRY_ORDER.filter(
    (countryId) =>
      !euroAdoptionRefusal({
        countryId,
        year: gs ? resolveGameYear(gs) : 0,
        europeanMembers: members.map((member) => member.countryId),
        consentedCountries: euroConsentedCountries(euroState),
        union: gs?.euroMonetaryUnion,
      })
  );
  const eraOn = gs?.eraSystemEnabled ?? false;
  return NextResponse.json(
    {
      preset: gs?.preset ?? DEFAULT_SEED_PRESET,
      eurozoneEnabled: euroState.eurozoneEnabled,
      euroMemberCurrencies: euroMemberCurrencies(euroState),
      euroAdoptionEligibleCountries,
      eraSystemEnabled: eraOn,
      currentYear: gs?.currentYear ?? null,
      currentEraId: gs?.currentEraId ?? null,
      // Era income-band inputs (metric era catalog); null while the flag is off
      // so client scoring falls back to the full legacy band.
      startingYear: eraOn ? (gs?.startingYear ?? null) : null,
      incomeBandIndexByCountry: eraOn ? (gs?.incomeBandIndexByCountry ?? null) : null,
      liveElectionResultsEnabled: gs?.liveElectionResultsEnabled === true,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

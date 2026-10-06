import { loadEuropeanTreatyContext } from "@/lib/internationalOrganizations/europeanIntegration/service";
import { canRatifyMaastricht } from "@/lib/internationalOrganizations/europeanIntegration/rules";
import { loadCampaignPriceLevel } from "@/lib/campaigns/campaignCurrency";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import {
  euroAdoptionRefusal,
  euroConsentedCountries,
  euroMemberCurrencies,
} from "@/lib/currency/euro/rules";
import { resolveGameYear } from "@/lib/era/era";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import {
  RESET_V2_COUNTRIES,
  resetSystemVersionsForCountry,
  resetSystemVersionsFrom,
} from "@/lib/resetVersions/rules";
import { FOUNDING_GENERAL_HOURS, FOUNDING_PRIMARY_HOURS } from "@/lib/elections/canonicalCycle";

/**
 * Turns the founding round's races close on, while it runs. Every founding race
 * is spawned on the round's first turn with the same fixed windows (see
 * canonicalCycle's pre-iteration branch), so the dates follow from that turn.
 */
function foundingRound(gs: Pick<GameState, "preIteration"> | null) {
  const round = gs?.preIteration;
  if (!round?.active || !Number.isInteger(round.startedTurn)) return null;
  const primaryEndTurn = round.startedTurn + FOUNDING_PRIMARY_HOURS;
  return { primaryEndTurn, generalEndTurn: primaryEndTurn + FOUNDING_GENERAL_HOURS };
}

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
        metricsSystemVersion: 1,
        legislationSystemVersion: 1,
        cabinetSystemVersion: 1,
        resetWorldId: 1,
        resetVersionSeeds: 1,
        startingPartiesMode: 1,
        preIteration: 1,
      },
    }
  );
  const treaty = await loadEuropeanTreatyContext(db);
  const maastrichtEligibleCountries =
    treaty && canRatifyMaastricht(treaty.date, treaty.state.stage) ? treaty.members : [];
  const euroState = { ...gs, eurozoneEnabled: gs?.eurozoneEnabled ?? true };
  const euroAdoptionEligibleCountries = COUNTRY_ORDER.filter(
    (countryId) =>
      !euroAdoptionRefusal({
        countryId,
        year: gs ? (resolveGameYear(gs) ?? 0) : 0,
        europeanMembers: treaty?.members ?? [],
        europeanStage: treaty?.state.stage,
        consentedCountries: euroConsentedCountries(euroState),
        union: gs?.euroMonetaryUnion,
      })
  );
  const eraOn = gs?.eraSystemEnabled ?? false;
  const resetSystemVersions = resetSystemVersionsFrom(gs, RESET_V2_READY);
  const resetV2Countries = RESET_V2_COUNTRIES.filter(
    (countryId) => resetSystemVersionsForCountry(gs, RESET_V2_READY, countryId).metrics === "v2"
  );
  return NextResponse.json(
    {
      preset: gs?.preset ?? DEFAULT_SEED_PRESET,
      campaignPriceLevel: await loadCampaignPriceLevel(db),
      eurozoneEnabled: euroState.eurozoneEnabled,
      euroMemberCurrencies: euroMemberCurrencies(euroState),
      euroMonetaryUnion: gs?.euroMonetaryUnion,
      euroAdoptionEligibleCountries,
      maastrichtEligibleCountries,
      eraSystemEnabled: eraOn,
      currentYear: gs?.currentYear ?? null,
      currentEraId: gs?.currentEraId ?? null,
      // Era income-band inputs (metric era catalog); null while the flag is off
      // so client scoring falls back to the full legacy band.
      startingYear: eraOn ? (gs?.startingYear ?? null) : null,
      incomeBandIndexByCountry: eraOn ? (gs?.incomeBandIndexByCountry ?? null) : null,
      liveElectionResultsEnabled: gs?.liveElectionResultsEnabled === true,
      resetV2Countries,
      resetSystemVersions,
      startingPartiesMode: gs?.startingPartiesMode ?? "default",
      foundingRound: foundingRound(gs),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

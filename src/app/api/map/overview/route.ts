import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { computePartyOrgMap } from "@/lib/map/partyOrgService";
import { computeSenateMap } from "@/lib/map/senateService";
import { computeHouseMap } from "@/lib/map/houseService";
import { computeGovernorMap } from "@/lib/map/governorService";
import { computeApprovalMap, type MapApprovalState } from "@/lib/map/approvalService";
import { computeLeanMap } from "@/lib/map/leanService";
import { computePresidentialMap } from "@/lib/map/presidentialService";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { buildRegionRoster, filterPoliticalUsRoster } from "@/lib/map/rosterService";
import { loadUsPoliticalStateIds } from "@/lib/elections/usPoliticalHome";
import type { State } from "@/lib/db/types";

import type { MapSectorSpecializationState, MapOverviewResponse } from "@/lib/map/overviewTypes";

// Re-export for any consumer that still imports types from the route file.
// New consumers should import from "@/lib/map/overviewTypes".
export type { MapSectorSpecializationState, MapOverviewResponse } from "@/lib/map/overviewTypes";

async function computeSectorSpecializationMap(
  db: Awaited<ReturnType<typeof getDb>>,
  countryId: CountryId
): Promise<Record<string, MapSectorSpecializationState>> {
  const states = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, name: 1, sectorSpecializations: 1 } })
    .toArray();

  const result: Record<string, MapSectorSpecializationState> = {};
  for (const state of states) {
    const spec = state.sectorSpecializations;
    if (!spec) continue;
    result[state._id] = {
      primary: spec.primary,
      primaryLabel: CORPORATION_TYPE_LABELS[spec.primary],
      secondary: spec.secondary,
      secondaryLabel: CORPORATION_TYPE_LABELS[spec.secondary],
      tooltip: [
        state.name,
        `Primary: ${CORPORATION_TYPE_LABELS[spec.primary]} (+10pp)`,
        `Secondary: ${CORPORATION_TYPE_LABELS[spec.secondary]} (+5pp)`,
      ],
    };
  }
  return result;
}

// GET /api/map/overview — Returns map overlay data (party org, senate, house, governor, approval, lean, presidential) for a given country.
// Auth: public
// Errors: 400
export async function GET(request: Request) {
  try {
    const db = await getDb();
    const { searchParams } = new URL(request.url);
    const rawCountryId = (searchParams.get("countryId") || "US").toUpperCase();
    if (!(rawCountryId in COUNTRY_CONFIGS)) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const countryId = rawCountryId as CountryId;

    // Live region roster (drives the nation map's list / names / seat counts) —
    // read straight from the country's owned states so it follows ownership and
    // future cross-country transfers.
    const rosterStates = await db
      .collection<State>("states")
      .find(
        { countryId },
        { projection: { _id: 1, name: 1, houseDistricts: 1, region: 1, population: 1 } }
      )
      .toArray();
    let regions = buildRegionRoster(rosterStates);

    if (countryId === COUNTRY_CONFIGS.US.id) {
      // Era gate: Alaska/Hawaii under 1953-default are owned territories with
      // zero House seats. Leaving them on the roster paints vacant "states" on
      // the nation map; keep only political states (48 until admission).
      const { politicalIds } = await loadUsPoliticalStateIds(db);
      regions = filterPoliticalUsRoster(regions, politicalIds);

      const [
        partyOrg,
        senate,
        house,
        governor,
        approval,
        lean,
        presidentialData,
        sectorSpecializations,
      ] = await Promise.all([
        computePartyOrgMap(db, "US"),
        computeSenateMap(db, "US"),
        computeHouseMap(db, "US"),
        computeGovernorMap(db, "US"),
        computeApprovalMap(db, "US"),
        computeLeanMap(db, "US"),
        computePresidentialMap(db, "US"),
        computeSectorSpecializationMap(db, "US"),
      ]);

      const {
        presidential,
        presidentialElectoralVotes,
        presidentialCandidateNames,
        presidentialCandidateParties,
        presidentialCandidateColors,
        totalElectoralVotes,
      } = presidentialData;

      return NextResponse.json({
        partyOrg,
        senate,
        house,
        governor,
        approval,
        lean,
        presidential,
        ...(presidentialElectoralVotes && presidentialCandidateNames && presidentialCandidateParties
          ? {
              presidentialElectoralVotes,
              presidentialCandidateNames,
              presidentialCandidateParties,
              presidentialCandidateColors,
            }
          : {}),
        sectorSpecializations,
        totalElectoralVotes,
        regions,
      } satisfies MapOverviewResponse);
    }

    if (countryId === COUNTRY_CONFIGS.UK.id) {
      const [partyOrg, commons, approvalRaw, lean, sectorSpecializations] = await Promise.all([
        computePartyOrgMap(db, "UK"),
        computeHouseMap(db, "UK"),
        computeApprovalMap(db, "UK"),
        computeLeanMap(db, "UK"),
        computeSectorSpecializationMap(db, "UK"),
      ]);

      // UK approval needs region ID remapping
      const approval: Record<string, MapApprovalState> = {};
      for (const [stateId, v] of Object.entries(approvalRaw)) {
        approval[stateId] = v;
      }

      return NextResponse.json({
        partyOrg,
        senate: {},
        house: {},
        governor: {},
        approval,
        lean,
        presidential: {},
        commons,
        sectorSpecializations,
        regions,
      } satisfies MapOverviewResponse);
    }

    if (countryId === COUNTRY_CONFIGS.DE.id) {
      const [partyOrg, house, approval, lean, sectorSpecializations] = await Promise.all([
        computePartyOrgMap(db, "DE"),
        computeHouseMap(db, "DE"),
        computeApprovalMap(db, "DE"),
        computeLeanMap(db, "DE"),
        computeSectorSpecializationMap(db, "DE"),
      ]);

      return NextResponse.json({
        partyOrg,
        senate: {},
        house,
        governor: {},
        approval,
        lean,
        presidential: {},
        sectorSpecializations,
        regions,
      } satisfies MapOverviewResponse);
    }

    if (countryId === COUNTRY_CONFIGS.JP.id) {
      const [partyOrg, house, senate, governor, approval, lean, sectorSpecializations] =
        await Promise.all([
          computePartyOrgMap(db, "JP"),
          computeHouseMap(db, "JP"),
          computeSenateMap(db, "JP"),
          computeGovernorMap(db, "JP"),
          computeApprovalMap(db, "JP"),
          computeLeanMap(db, "JP"),
          computeSectorSpecializationMap(db, "JP"),
        ]);

      return NextResponse.json({
        partyOrg,
        senate,
        house,
        governor,
        approval,
        lean,
        presidential: {},
        sectorSpecializations,
        regions,
      } satisfies MapOverviewResponse);
    }

    if (countryId === COUNTRY_CONFIGS.BR.id) {
      const [partyOrg, house, senate, approval, lean, sectorSpecializations] = await Promise.all([
        computePartyOrgMap(db, "BR"),
        computeHouseMap(db, "BR"),
        computeSenateMap(db, "BR"),
        computeApprovalMap(db, "BR"),
        computeLeanMap(db, "BR"),
        computeSectorSpecializationMap(db, "BR"),
      ]);

      return NextResponse.json({
        partyOrg,
        senate,
        house,
        governor: {},
        approval,
        lean,
        presidential: {},
        sectorSpecializations,
        regions,
      } satisfies MapOverviewResponse);
    }

    if (countryId === COUNTRY_CONFIGS.CN.id) {
      const [partyOrg, house, approval, lean, sectorSpecializations] = await Promise.all([
        computePartyOrgMap(db, "CN"),
        computeHouseMap(db, "CN"),
        computeApprovalMap(db, "CN"),
        computeLeanMap(db, "CN"),
        computeSectorSpecializationMap(db, "CN"),
      ]);

      return NextResponse.json({
        partyOrg,
        senate: {},
        house,
        governor: {},
        approval,
        lean,
        presidential: {},
        sectorSpecializations,
        regions,
      } satisfies MapOverviewResponse);
    }

    if (countryId === COUNTRY_CONFIGS.NG.id) {
      const [partyOrg, house, senate, governor, approval, lean, sectorSpecializations] =
        await Promise.all([
          computePartyOrgMap(db, "NG"),
          computeHouseMap(db, "NG"),
          computeSenateMap(db, "NG"),
          computeGovernorMap(db, "NG"),
          computeApprovalMap(db, "NG"),
          computeLeanMap(db, "NG"),
          computeSectorSpecializationMap(db, "NG"),
        ]);

      return NextResponse.json({
        partyOrg,
        senate,
        house,
        governor,
        approval,
        lean,
        presidential: {},
        sectorSpecializations,
        regions,
      } satisfies MapOverviewResponse);
    }

    const sectorSpecializations = COUNTRY_CONFIGS[countryId]
      ? await computeSectorSpecializationMap(db, countryId)
      : {};

    return NextResponse.json({
      partyOrg: {},
      senate: {},
      house: {},
      governor: {},
      approval: {},
      lean: {},
      presidential: {},
      sectorSpecializations,
      regions,
    } satisfies MapOverviewResponse);
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/map/overview" });
  }
}

/**
 * GET /api/country/[code]/map/overview — Map overview data by country.
 *
 * Currently only UK is supported. Returns lean and approval data per region.
 * Moved from /api/uk/map/overview.
 */
import { NextResponse } from "next/server";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { State, StateDemographics, DemographicCategory, GameState } from "@/lib/db/types";
import type { StatePartyOrg } from "@/lib/db/types/statePartyOrg";
import { resolveGameYear } from "@/lib/era/era";
import { calculateStateLean } from "@/lib/utils/demographics";
import { getUkEconomicLeanLabelHex, getSocialLeanLabelHex } from "@/lib/utils/politics";
import {
  BASE_APPROVAL,
  calculateStateApproval,
  computeNationalAveragesFromMetrics,
  weightingFor,
} from "@/lib/utils/governmentApproval";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";

export interface MapRegionLean {
  regionId: string;
  name: string;
  economicLean: number;
  socialLean: number;
  economicColor: string;
  economicLabel: string;
  socialColor: string;
  socialLabel: string;
}

export interface MapOverviewResponse {
  lean: Record<string, MapRegionLean>;
  approval: Record<string, { approval: number }>;
  partyOrg?: Record<string, Record<string, number>>;
  npcSeats?: Record<string, number>;
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    const config = COUNTRY_CONFIGS[countryId];
    if (!config) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    // Currently only UK, CN, DE, and NG have map overview support
    if (countryId !== "UK" && countryId !== "CN" && countryId !== "DE" && countryId !== "NG") {
      return NextResponse.json(
        { error: `Map overview not yet supported for ${config.name}` },
        { status: 404 }
      );
    }

    const db = await getDb();

    const VOTER_GROUP_CATEGORY: Partial<Record<CountryId, string>> = {
      UK: "uk_voterGroups",
      DE: "de_voterGroups",
    };
    const voterGroupCategoryId = VOTER_GROUP_CATEGORY[countryId] ?? "cn_voterGroups";

    const [allStates, allDemographics, demographicCategories] = await Promise.all([
      db.collection<State>("states").find({ countryId }).toArray(),
      db.collection<StateDemographics>("stateDemographics").find({ countryId }).toArray(),
      db
        .collection<DemographicCategory>("demographicCategories")
        .find({ _id: voterGroupCategoryId })
        .toArray(),
    ]);

    const stateIds = allStates.map((s) => s._id);
    const [allMetrics, presetDoc] = await Promise.all([
      // SP5: merged two-store view.
      findMergedRegionMetricsMany(db, { _id: { $in: stateIds } }),
      db.collection<GameState>("gameState").findOne(
        { _id: "current" },
        {
          projection: {
            preset: 1,
            currentYear: 1,
            currentTurn: 1,
            startingYear: 1,
            eraSystemEnabled: 1,
          },
        }
      ),
    ]);
    // Era ruleset — keeps the map heatmap approval consistent with the region
    // hero / stored snapshot under non-2019 presets.
    const preset = (presetDoc?.preset as string | undefined) ?? null;
    // Live year for era-aware scoring; null while the flag is off (legacy path).
    const year = presetDoc?.eraSystemEnabled ? resolveGameYear(presetDoc) : null;

    const demoByState = new Map(allDemographics.map((d) => [d._id, d]));

    const leanResult: Record<string, MapRegionLean> = {};

    for (const state of allStates) {
      const stateId = state._id;
      const demographics = demoByState.get(stateId);
      let economicLean: number;
      let socialLean: number;

      if (state.cachedEconomicLean != null && state.cachedSocialLean != null) {
        economicLean = state.cachedEconomicLean;
        socialLean = state.cachedSocialLean;
      } else if (demographics && demographicCategories.length > 0) {
        const calculated = calculateStateLean(demographics, demographicCategories);
        economicLean = calculated.economicLean;
        socialLean = calculated.socialLean;
      } else {
        economicLean = 0;
        socialLean = 0;
      }

      const regionId = stateId;
      const useUkLean = voterGroupCategoryId !== "cn_voterGroups";
      const econ = useUkLean
        ? getUkEconomicLeanLabelHex(economicLean)
        : { color: "#888888", label: "Neutral" };
      const socialMeta = useUkLean
        ? getSocialLeanLabelHex(socialLean)
        : { color: "#888888", label: "Neutral" };

      leanResult[regionId] = {
        regionId,
        name: state.name ?? stateId,
        economicLean,
        socialLean,
        economicColor: econ.color,
        economicLabel: econ.label,
        socialColor: socialMeta.color,
        socialLabel: socialMeta.label,
      };
    }

    // Compute approval per region — electorate-weighted (P6d), reusing the
    // already-loaded demographics (composite key matches weightingFor).
    const nationalAverages = computeNationalAveragesFromMetrics(allMetrics);
    const groupsByState = new Map(
      allDemographics.map((d) => [`${d.countryId}:${d._id}`, Object.values(d.groups ?? {})])
    );
    // SP4: playable countries score from the hybrid political base.
    const politicalBases = isPoliticalApprovalCountry(countryId)
      ? await loadPoliticalApprovalBases(db, countryId)
      : null;
    const approvalResult: Record<string, { approval: number }> = {};
    for (const metrics of allMetrics) {
      const regionId = metrics._id;
      const approval = calculateStateApproval(
        metrics,
        nationalAverages,
        [],
        weightingFor(groupsByState, countryId, String(regionId)),
        preset,
        year,
        isPoliticalApprovalCountry(countryId)
          ? (politicalBases?.byRegion.get(String(regionId)) ?? BASE_APPROVAL)
          : undefined
      );
      approvalResult[regionId] = { approval };
    }

    // Optional partyOrg overlay (config-driven): countries that opt in via
    // mapOverlay === "partyOrg" get per-region party organization and lower
    // chamber seat counts in the response. CN is the current consumer.
    let partyOrgResult: Record<string, Record<string, number>> | undefined;
    let npcSeatsResult: Record<string, number> | undefined;

    if (config.mapOverlay === "partyOrg") {
      const lowerChamberOfficeType = config.officeTypes.find(
        (o) => o.chamberKey === config.legislature.lowerChamber.key
      )?.key;

      const [partyOrgDocs, seatDocs] = await Promise.all([
        db.collection<StatePartyOrg>("statePartyOrg").find({ countryId }).toArray(),
        lowerChamberOfficeType
          ? db.collection("seats").find({ countryId, officeType: lowerChamberOfficeType }).toArray()
          : Promise.resolve([]),
      ]);

      partyOrgResult = {};
      for (const doc of partyOrgDocs) {
        const [stateId, partySeqId] = doc._id.split("_");
        if (!stateId || !partySeqId) continue;
        if (!partyOrgResult[stateId]) partyOrgResult[stateId] = {};
        partyOrgResult[stateId][partySeqId] = doc.organization ?? 0;
      }

      npcSeatsResult = {};
      for (const doc of seatDocs) {
        const stateId = doc.state;
        npcSeatsResult[stateId] = (npcSeatsResult[stateId] ?? 0) + (doc.totalSeats ?? 0);
      }
    }

    return NextResponse.json({
      lean: leanResult,
      approval: approvalResult,
      partyOrg: partyOrgResult,
      npcSeats: npcSeatsResult,
    } satisfies MapOverviewResponse);
  } catch (error) {
    return handleRouteError(error);
  }
}

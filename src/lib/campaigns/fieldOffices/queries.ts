import type { Db, ObjectId } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { notFound } from "@/lib/api/errors";
import { isCampaignManagerUser, isCampaignNomineeUser } from "@/lib/campaigns/access";
import {
  campaignAnchorToLocal,
  getCampaignCurrency,
  loadCampaignCurrencyRates,
  loadCampaignPriceLevel,
} from "@/lib/campaigns/campaignCurrency";
import { getCurrentTurn } from "@/lib/campaigns/commands/campaignManagementCommands";
import { getGameStatePresetOrDefault } from "@/lib/db/collections/gameState";
import type { Campaign, CampaignFieldOffice, Election } from "@/lib/db/types";
import {
  FIELD_OFFICES_COLLECTION,
  loadCampaignOrientation,
  loadFieldOfficeRegions,
} from "./commands";
import { fieldOfficeRamp, fieldOfficeRegionEffect, fieldOfficeYield } from "./effects";
import { loadLiveStateLean } from "./liveLean";
import {
  FIELD_OFFICE_RAMP_TURNS,
  getFieldOfficeCap,
  getFieldOfficeCostAnchor,
  getFieldOfficeRules,
  type FieldOfficeScope,
} from "./rules";
import { loadFieldOfficeRegionMap } from "./subdivisions";
import { countyLeanSourceLabel } from "@/lib/maps/countyLeans";

export interface FieldOfficeDto {
  id: string;
  regionId: string;
  subdivisionId: string | null;
  label: string;
  openedTurn: number;
  /** 0..1 ramp toward full strength. */
  strength: number;
}

export interface FieldOfficeSubdivisionDto {
  id: string;
  name: string;
  path: string;
  electorateShare: number;
  basePvi: number;
  livePvi: number;
  /** Your yield there (1 = region average). Manager view only. */
  yieldFactor?: number;
  /** Turnout points one new office here would add at full strength. Manager view only. */
  marginalPct?: number;
  officeId: string | null;
}

export interface FieldOfficeRegionDto {
  id: string;
  name: string;
  officeCount: number;
  /** Current turnout boost in the region, points. */
  effectPct: number;
}

export interface FieldOfficeView {
  enabled: boolean;
  scope: FieldOfficeScope | null;
  canManage: boolean;
  raceActive: boolean;
  currentTurn: number;
  rampTurns: number;
  cap: number;
  maxPerRegion: number | null;
  /** Manager view only. Local currency. */
  costs: { open: number; upkeep: number; actions: number; currency: string } | null;
  funds: number | null;
  actions: number | null;
  regions: FieldOfficeRegionDto[];
  offices: FieldOfficeDto[];
  selectedRegionId: string | null;
  map: {
    regionId: string;
    viewBox: string;
    regionBasePvi: number;
    regionLivePvi: number;
    subdivisions: FieldOfficeSubdivisionDto[];
  } | null;
  /** Year of the in-world presidential race the live leans follow, if any. */
  liveLeanYear: number | null;
  liveLeanActive: boolean;
  /** Elections the county baseline comes from for this world's era. */
  leanSourceLabel: string | null;
}

export async function getFieldOfficeView(
  db: Db,
  campaignId: ObjectId,
  user: AuthUserWithCharacter | null,
  requestedRegion: string | null
): Promise<FieldOfficeView> {
  const campaign = await db.collection<Campaign>("campaigns").findOne(
    { _id: campaignId },
    {
      projection: {
        electionId: 1,
        candidateId: 1,
        candidateIsNPP: 1,
        party: 1,
        funds: 1,
        actions: 1,
        managerId: 1,
        managers: 1,
        status: 1,
      },
    }
  );
  if (!campaign) throw notFound("Campaign not found");
  const election = await db
    .collection<Election>("elections")
    .findOne(
      { _id: campaign.electionId },
      { projection: { countryId: 1, electionType: 1, state: 1, status: 1 } }
    );
  if (!election) throw notFound("Election not found");

  const rules = getFieldOfficeRules(election.countryId);
  const currentTurn = await getCurrentTurn(db);
  const canManage =
    !!user?.userId &&
    campaign.status !== "archived" &&
    (user.isAdmin === true ||
      isCampaignManagerUser(campaign as Campaign, user.userId) ||
      (await isCampaignNomineeUser(
        db,
        campaign as Campaign,
        user.userId,
        user.character?._id ?? null
      )));

  const base: FieldOfficeView = {
    enabled: !!rules,
    scope: rules?.scope ?? null,
    canManage,
    raceActive: election.status === "active",
    currentTurn,
    rampTurns: FIELD_OFFICE_RAMP_TURNS,
    cap: getFieldOfficeCap(election.electionType),
    maxPerRegion: rules && Number.isFinite(rules.maxPerRegion) ? rules.maxPerRegion : null,
    costs: null,
    funds: canManage ? campaign.funds : null,
    actions: canManage ? campaign.actions : null,
    regions: [],
    offices: [],
    selectedRegionId: null,
    map: null,
    liveLeanYear: null,
    liveLeanActive: false,
    leanSourceLabel: null,
  };
  if (!rules) return base;

  const [regions, officeRows] = await Promise.all([
    loadFieldOfficeRegions(db, election),
    db
      .collection<CampaignFieldOffice>(FIELD_OFFICES_COLLECTION)
      .find({ campaignId })
      .sort({ openedTurn: 1, createdAt: 1 })
      .toArray(),
  ]);

  if (canManage) {
    const cost = getFieldOfficeCostAnchor(rules, election.electionType);
    const [rates, priceLevel, preset] = await Promise.all([
      loadCampaignCurrencyRates(db),
      loadCampaignPriceLevel(db),
      getGameStatePresetOrDefault(db),
    ]);
    const toLocal = (anchor: number) =>
      campaignAnchorToLocal(anchor * priceLevel, election.countryId, rates, preset);
    base.costs = {
      open: toLocal(cost.open),
      upkeep: toLocal(cost.upkeep),
      actions: cost.actions,
      currency: getCampaignCurrency(election.countryId, preset),
    };
  }

  const officesByRegion = new Map<string, CampaignFieldOffice[]>();
  for (const o of officeRows) {
    const list = officesByRegion.get(o.regionId);
    if (list) list.push(o);
    else officesByRegion.set(o.regionId, [o]);
  }
  base.offices = officeRows.map((o) => ({
    id: o._id.toString(),
    regionId: o.regionId,
    subdivisionId: o.subdivisionId,
    label: o.label,
    openedTurn: o.openedTurn,
    strength: fieldOfficeRamp(o.openedTurn, currentTurn),
  }));
  base.regions = regions.map((r) => {
    const list = officesByRegion.get(r._id) ?? [];
    return {
      id: r._id,
      name: r.name,
      officeCount: list.length,
      effectPct: round2((fieldOfficeRegionEffect(list, rules, currentTurn).multiplier - 1) * 100),
    };
  });

  const requested = requestedRegion?.toUpperCase() ?? null;
  const selected =
    regions.find((r) => r._id === requested) ??
    regions.find((r) => r._id === officeRows[0]?.regionId) ??
    regions.find((r) => r._id === election.state) ??
    regions[0];
  base.selectedRegionId = selected?._id ?? null;

  if (selected && rules.scope === "county") {
    const [live, preset] = await Promise.all([
      loadLiveStateLean(db, election.countryId),
      getGameStatePresetOrDefault(db),
    ]);
    base.liveLeanActive = !!live;
    base.leanSourceLabel = countyLeanSourceLabel(preset);
    base.liveLeanYear = live?.sourceYear ?? null;
    const map = await loadFieldOfficeRegionMap(rules.scope, selected._id, live, preset);
    if (map) {
      const orientation = canManage
        ? await loadCampaignOrientation(db, campaign as Campaign, election.countryId)
        : 0;
      const inRegion = officesByRegion.get(selected._id) ?? [];
      const officeBySub = new Map(inRegion.map((o) => [o.subdivisionId, o._id.toString()]));
      // Marginal value at full strength: compare the region with and without
      // a new mature office here, holding existing offices at full strength.
      const matured = inRegion.map((o) => ({ ...o, openedTurn: -1e9 }));
      const before = fieldOfficeRegionEffect(matured, rules, currentTurn).multiplier;
      base.map = {
        regionId: map.regionId,
        viewBox: map.viewBox,
        regionBasePvi: map.regionBasePvi,
        regionLivePvi: map.regionLivePvi,
        subdivisions: map.subdivisions.map((s) => {
          const dto: FieldOfficeSubdivisionDto = {
            id: s.id,
            name: s.name,
            path: s.path,
            electorateShare: s.electorateShare,
            basePvi: s.basePvi,
            livePvi: s.livePvi,
            officeId: officeBySub.get(s.id) ?? null,
          };
          if (canManage) {
            const yieldFactor = fieldOfficeYield(orientation, s.livePvi - map.regionLivePvi);
            const after = fieldOfficeRegionEffect(
              [...matured, { openedTurn: -1e9, electorateShare: s.electorateShare, yieldFactor }],
              rules,
              currentTurn
            ).multiplier;
            dto.yieldFactor = round2(yieldFactor);
            dto.marginalPct = round2((after - before) * 100);
          }
          return dto;
        }),
      };
    }
  }
  return base;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * POST /api/admin/seed
 *
 * Universal seeder endpoint. Admin-only (no SEED_SECRET needed).
 *
 * Body (JSON):
 *   targets: string[]   - which datasets to seed. Valid values:
 *       "states", "policies", "demographics", "gameConfig",
 *       "parties", "statePartyOrg", "regionMetrics",
 *       "legislationTypes", "achievements", "statePolicies",
 *       "politicalLegislation", "indexes"
 *   reset: boolean       - drop target collections first (default false)
 *   scope: CountryId|"both" - which country's targets a full seed covers (default "US")
 *   preset: string       - era baseline for preset-aware seeders, e.g.
 *                          "2019-default" (default) or "1991-default"
 *
 * If targets is empty or omitted, seeds everything (full seed).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { countryIdSchema } from "@/lib/api/schemas/country";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";

import {
  seedStates,
  seedPolicies,
  seedDemographics,
  seedGameConfig,
  seedParties,
  seedStatePartyOrg,
  seedRegionMetrics,
  seedLegislationTypes,
  seedAchievements,
  seedStatePolicies,
  seedBudgets,
  seedUkBudgets,
  seedSeats,
  seedPartyBudgets,
  seedUnownedSectors,
  seedUnions,
  seedStateResourceCapacity,
  seedStateSectorSpecializations,
  seedCoreIndexes,
  seedActivityIndexes,
  seedCabinetIndexes,
  seedPerfIndexes,
  seedSlowQueryIndexes,
  seedSearchIndexes,
  seedInternationalOrganizationIndexes,
  seedWriteGuardIndexes,
  seedPartyNppReworkIndexes,
  seedSovereignDefaultIndexes,
  seedObservabilityIndexes,
  seedFinancialTxLogIndexes,
  seedCommodityPriceIndexes,
  seedIndexFundIndexes,
  seedApiAccessIndexes,
  seedCountyMapData,
  seedUKRegions,
  seedUKParties,
  seedUKDemographics,
  seedUKStatePartyOrg,
  seedUKStateMetrics,
  seedUKBaselines,
  seedUKElections,
  seedUKRegionalCouncil,
  seedUKGovernors2020,
  seedUKGovernors1992,
  seedUkLegislation,
  seedJPRegions,
  seedJPParties,
  seedJPDemographics,
  seedJPStatePartyOrg,
  seedJPStateMetrics,
  seedJPBaselines,
  seedJPGovernmentFormation,
  seedJPGovernors2020,
  seedJPGovernors1991,
  seedJpBudgets,
  seedDERegions,
  seedDEParties,
  seedDEDemographics,
  seedDEStatePartyOrg,
  seedDEStateMetrics,
  seedDEBaselines,
  seedDEGovernmentFormation,
  seedDELegislation,
  seedDEElections,
  seedDEBundestag2021,
  seedDEMinisterPresidents2020,
  seedDeBudgets,
  seedIERegions,
  seedIEParties,
  seedIEDemographics,
  seedIEStatePartyOrg,
  seedIEStateMetrics,
  seedIEBaselines,
  seedIEGovernmentFormation,
  seedIeBudgets,
  seedBRRegions,
  seedBRParties,
  seedBRDemographics,
  seedBRStateMetrics,
  seedBRBaselines,
  seedBRGovernmentFormation,
  seedBrBudgets,
  seedCNRegions,
  seedCNParties,
  seedCNDemographics,
  seedCNStateMetrics,
  seedCNBaselines,
  seedCNGovernmentFormation,
  seedRUGovernmentFormation,
  seedCnBudgets,
  seedForex,
  seedCommodityPrices,
  seedCnStatePartyOrg,
  seedRuStatePartyOrg,
  seedCNWiki,
  seedNGRegions,
  seedNGParties,
  seedNGDemographics,
  seedNGStatePartyOrg,
  seedNGStateMetrics,
  seedNGBaselines,
  seedNGGovernmentFormation,
  seedNgBudgets,
} from "@/lib/admin/seed";

const US_TARGETS = [
  "states",
  "policies",
  "demographics",
  "gameConfig",
  "parties",
  "statePartyOrg",
  "regionMetrics",
  "legislationTypes",
  "achievements",
  "statePolicies",
  // Cross-country by nature (US/UK/RU/DD) but listed here because the seeder UI
  // groups it with statePolicies, whose exclusions make it necessary.
  "politicalLegislation",
  "budgets",
  "countyMapData",
  "indexesCore",
  "indexesActivity",
  "indexesCabinet",
  "indexesPerf",
  "indexesSlowQuery",
  "indexesSearch",
  "indexesInternationalOrganizations",
  "indexesWriteGuards",
  "indexesPartyNppRework",
  "indexesSovereignDefault",
  "indexesObservability",
  "indexesFinancialTxLog",
  "indexesCommodityPrices",
  "indexesIndexFunds",
  "indexesApiAccess",
  "seats",
  "unownedSectors",
  "unions",
  "partyBudgets",
  "stateResourceCapacity",
  "stateSectorSpecializations",
  "forex",
  "commodityPrices",
] as const;

const UK_TARGETS = [
  "ukRegions",
  "ukParties",
  "ukDemographics",
  "ukStatePartyOrg",
  "ukStateMetrics",
  "ukBaselines",
  "ukElections",
  "ukLegislation",
  "ukBudgets",
  "ukGovernors2020",
  "ukGovernors1992",
] as const;

const JP_TARGETS = [
  "jpRegions",
  "jpParties",
  "jpDemographics",
  "jpStatePartyOrg",
  "jpStateMetrics",
  "jpBaselines",
  "jpGovernmentFormation",
  "jpBudgets",
  "jpGovernors2020",
  "jpGovernors1991",
] as const;

const DE_TARGETS = [
  "deRegions",
  "deParties",
  "deDemographics",
  "deStatePartyOrg",
  "deStateMetrics",
  "deBaselines",
  "deGovernmentFormation",
  "deLegislation",
  "deElections",
  "deBudgets",
  "deBundestag2021",
  "deMinisterPresidents2020",
] as const;

const IE_TARGETS = [
  "ieRegions",
  "ieParties",
  "ieDemographics",
  "ieStatePartyOrg",
  "ieStateMetrics",
  "ieBaselines",
  "ieGovernmentFormation",
  "ieBudgets",
] as const;

const BR_TARGETS = [
  "brRegions",
  "brParties",
  "brDemographics",
  "brStateMetrics",
  "brBaselines",
  "brGovernmentFormation",
  "brBudgets",
] as const;

const NG_TARGETS = [
  "ngRegions",
  "ngParties",
  "ngDemographics",
  "ngStatePartyOrg",
  "ngStateMetrics",
  "ngBaselines",
  "ngGovernmentFormation",
  "ngBudgets",
  "seats",
  "unownedSectors",
  "unions",
  "partyBudgets",
  "stateResourceCapacity",
  "stateSectorSpecializations",
] as const;

const CN_TARGETS = [
  "cnRegions",
  "cnParties",
  "cnDemographics",
  "cnStateMetrics",
  "cnBaselines",
  "cnGovernmentFormation",
  "ruGovernmentFormation",
  "cnBudgets",
  "cnStatePartyOrg",
  "ruStatePartyOrg",
  "cnWiki",
] as const;

const ALL_TARGETS = [
  ...US_TARGETS,
  ...UK_TARGETS,
  ...JP_TARGETS,
  ...DE_TARGETS,
  ...IE_TARGETS,
  ...BR_TARGETS,
  ...CN_TARGETS,
  ...NG_TARGETS,
] as const;

type SeedTarget = (typeof ALL_TARGETS)[number];

/**
 * Targets renamed after the collection they were named for was retired. Mapped
 * on the way in so a saved admin selection or an external caller keeps working
 * instead of silently seeding nothing.
 */
const LEGACY_TARGET_ALIASES: Record<string, SeedTarget> = {
  stateMetrics: "regionMetrics",
};

function canonicalTarget(t: string): string {
  return LEGACY_TARGET_ALIASES[t] ?? t;
}

function isValidTarget(t: string): t is SeedTarget {
  return (ALL_TARGETS as readonly string[]).includes(canonicalTarget(t));
}

import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

type SeedScope = CountryId | "both";

const seedSchema = z.object({
  targets: z.array(z.string()).optional(),
  reset: z.boolean().optional(),
  scope: z.union([countryIdSchema, z.literal("both")]).optional(),
  // Era/preset baseline. Selects which year's reference data each preset-aware
  // seeder writes. Unknown values fall back to "2019-default" inside the
  // seeders (see presetSelector), so a free string is safe here.
  preset: z.string().optional(),
});

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    return NextResponse.json({
      availableTargets: ALL_TARGETS,
      scope: [...COUNTRY_ORDER, "both"],
      description: {
        states: "50 US states + DC",
        policies: "Base policy definitions",
        demographics: "Demographic categories and state demographics",
        gameConfig: "Game configuration (starting resources, turn settings)",
        parties: "Political parties",
        statePartyOrg: "State-level party organization records",
        stateMetrics: "State economic/social metrics",
        legislationTypes: "Legislation type definitions",
        achievements: "Achievement definitions",
        statePolicies: "Per-state and national policy records",
        budgets: "US federal budget, US state budgets, and formula grant definitions",
        countyMapData: "County and congressional district SVG map data",
        indexesCore:
          "Core identity/lookup indexes (users, characters, states, parties, corporations)",
        indexesActivity:
          "Activity log TTL + query indexes and suspicious character detection indexes",
        indexesCabinet:
          "Cabinet collection indexes (unified cabinetMembers + UK cooldowns/members)",
        indexesPerf: "Compound indexes on hot read paths (bills, notifications, elections, mail)",
        indexesSlowQuery:
          "Indexes for COLLSCAN offenders (corporationHistory, commodityPriceHistory, actionLogs, statePartyElections)",
        indexesInternationalOrganizations:
          "Indexes for international organization tables (UN, IMF, etc.) - leadership, legislation, memberships",
        indexesWriteGuards:
          "Partial-unique indexes blocking double-submit on election entry, endorsements, governance votes, share offers, cabinet nominations, leadership ballots, corp votes (absorbs add-election/add-governance-write-guard-indexes.ts)",
        indexesPartyNppRework:
          "Caucus, recruitment slate, NPP cross-pressure / endorsement, political capital, and treasury indexes (absorbs add-party-npp-rework-indexes.ts)",
        indexesSovereignDefault:
          "Sovereign-crisis state-machine sweep indexes on federalBudget + sovereignCrisisDecisions (absorbs sovereignDefaultPhase1Indexes.ts)",
        indexesObservability:
          "Indexes + TTLs for gameHealthSnapshots, codeQualitySnapshots, siteTrafficPageviews (absorbs add-health-quality-indexes.ts + add-site-traffic-indexes.ts)",
        indexesFinancialTxLog:
          "Indexes + TTL for financialTxLog (absorbs createFinancialTxLogIndexes.ts)",
        indexesCommodityPrices:
          "Unique index on commodityPrices.commodity (absorbs add-commodity-prices-unique-index.ts)",
        indexesIndexFunds:
          "Indexes for indexFunds, indexFundPositions, indexFundTransactions, indexFundRedemptionQueue, indexFundSnapshots",
        indexesApiAccess:
          "Unique tokenHash + per-user/scope indexes on userApiKeys, and TTL + query indexes on apiAccessLog",
        seats: "Permanent seat documents for all races (US + UK)",
        unownedSectors:
          "Unowned sector revenue docs (10% of GDP-derived market per state x type, insert-only)",
        unions:
          "Vacant-head player unions (one per country × sector type) with era-appropriate names",
        partyBudgets:
          "Party budget/settings documents for default parties across all seeded states and countries",
        stateResourceCapacity:
          "Per-state extraction ceilings (oil/coal/iron/copper/natural_gas/timber/rare_earth). Required for commodity margin math; unseeded states get empty-default so extraction is capped at 0.",
        stateSectorSpecializations:
          "Per-state/region primary (+10pp) and secondary (+5pp) corporation sector profit margin specializations.",
        forex:
          "Forex layer: exchange rates, central banks for every forex-active country, forex indexes, and the gameState.forexEnabled flag",
        commodityPrices:
          "Baseline commodityPrices rows (one per CommodityType at base price) - needed so admin dashboards and pre-turn-1 readers don't see an empty collection",
        ukRegions: "12 UK electoral regions (NUTS1) in states collection",
        ukParties: "UK political parties (Labour, Conservative, Lib Dems, SNP, etc.)",
        ukDemographics: "UK voter archetypes, region demographics, and turnout modifiers",
        ukStatePartyOrg: "Party organization records for each UK region x party",
        ukStateMetrics: "Government approval metrics for each UK region",
        ukBaselines: "Metric decay baselines for each UK region",
        ukElections:
          "Spawn missing UK Commons and Regional Council elections, update RC seat counts, and populate NPP officials",
        ukLegislation: "UK-scoped legislation types only (59 types, countryScope: uk)",
        ukBudgets: "UK national budget, regional budgets, enacted laws, and NHS corporation",
        ukGovernors2020:
          "UK devolved-executive seats (Feb 2020): 3 First Ministers (SCO/WAL/NIR) + Mayor of London, using the recycled `governor` officeType",
        ukGovernors1992:
          "UK devolved-executive seats (1992 preset, anachronistic): 3 First Ministers + Mayor of London, party-stamped to 1992 regional majorities",
        jpBudgets: "JP national budget, regional budgets, enacted laws, and sovereign issuer corp",
        jpGovernors2020:
          "JP regional governors (Feb 2020): 8 LDP-aligned governors, one per JP game-region",
        jpGovernors1991:
          "JP regional governors (1991-default preset): 8 LDP-aligned governors at the 1990 historical anchor",
        deRegions: "16 German Länder in states collection",
        deParties: "German political parties (SPD, CDU, Greens, AfD, etc.)",
        deDemographics: "German voter archetypes, Land demographics, and turnout modifiers",
        deStatePartyOrg: "Party organization records for each Land x party",
        deStateMetrics: "Land-level economic and social metrics for Germany",
        deBaselines: "Metric decay baselines for each German Land",
        deGovernmentFormation: "Germany government formation document for Chancellor appointment",
        deLegislation: "DE-scoped legislation types (tax, labor, energy, immigration)",
        deElections: "Spawn missing Bundestag elections for every Land",
        deBudgets: "DE national budget, regional budgets, and enacted laws",
        deBundestag2021:
          "DE Bundestag historical seats (Feb 2021): 79 NPP officials with party-proportional Land distribution",
        deMinisterPresidents2020:
          "DE Minister-Presidents (Feb 2020): 16 historical heads of Land government across all Bundesländer",
        ieRegions: "8 Ireland NUTS III regions in states collection",
        ieParties: "Ireland political parties (Fine Gael, Fianna Fáil, Sinn Féin, etc.)",
        ieDemographics: "Ireland voter archetypes, region demographics, and turnout modifiers",
        ieStatePartyOrg:
          "Per-region party organization levels for Ireland (8 regions × 5 default parties)",
        ieStateMetrics: "Region-level economic and social metrics for Ireland",
        ieBaselines: "Metric decay baselines for each Ireland region",
        ieGovernmentFormation: "Ireland government formation document for Taoiseach appointment",
        ieBudgets: "IE national budget, regional budgets, enacted laws, and sovereign issuer corp",
        brRegions: "5 Brazil macro-regions in states collection",
        brParties: "Brazil political parties (PT, PL, MDB, UNIÃO, PSD)",
        brDemographics: "Brazil voter archetypes, region demographics, and turnout modifiers",
        brStateMetrics: "Region-level economic and social metrics for Brazil",
        brBaselines: "Metric decay baselines for each Brazil region",
        brGovernmentFormation: "Brazil government formation document for President appointment",
        brBudgets: "BR national budget, regional budgets, enacted laws, and sovereign issuer corp",
        ngRegions: "6 Nigeria geopolitical zones in states collection",
        ngParties: "Nigeria political parties (APC, PDP, LP, NNPP, APGA)",
        ngDemographics: "Nigeria voter archetypes, region demographics, and turnout modifiers",
        ngStatePartyOrg: "Party organization records for each NG zone x party",
        ngStateMetrics: "Zone-level economic and social metrics for Nigeria",
        ngBaselines: "Metric decay baselines for each Nigeria zone",
        ngGovernmentFormation:
          "Nigeria government formation document for President/House appointment",
        ngBudgets: "NG national budget, regional budgets, enacted laws, and sovereign issuer corp",
        cnRegions: "7 China geographic regions in states collection",
        cnParties: "China political parties (CCP, CDL, CNDCA)",
        cnDemographics: "China voter archetypes, region demographics, and turnout modifiers",
        cnStateMetrics: "Region-level economic and social metrics for China",
        cnBaselines: "Metric decay baselines for each China region",
        cnGovernmentFormation: "China government formation document for President appointment",
        ruGovernmentFormation:
          "Soviet Union government formation document (formed, NPC Premier linked)",
        ruStatePartyOrg: "CPSU regional organization + registration across the 17 RU regions",
        cnBudgets: "CN national budget, regional budgets, enacted laws, and sovereign issuer corp",
        cnStatePartyOrg:
          "CPC party organization across all 7 CN macro-regions (minor parties advisory)",
        cnWiki: "China wiki pages (overview, CPC confidence, State Council guide)",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, seedSchema);
    const body = parsed.success ? parsed.data : {};
    const rawTargets: string[] = Array.isArray(body.targets) ? body.targets : [];
    const reset: boolean = body.reset === true;
    const scope: SeedScope = body.scope ?? "US";
    const preset: string = body.preset ?? DEFAULT_SEED_PRESET;

    const invalid = rawTargets.filter((t) => !isValidTarget(t));
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: `Invalid targets: ${invalid.join(", ")}`, availableTargets: ALL_TARGETS },
        { status: 400 }
      );
    }

    const TARGETS_BY_SCOPE: Record<string, readonly string[]> = {
      US: US_TARGETS,
      UK: UK_TARGETS,
      JP: JP_TARGETS,
      DE: DE_TARGETS,
      IE: IE_TARGETS,
      BR: BR_TARGETS,
      CN: CN_TARGETS,
      NG: NG_TARGETS,
    };
    const targets: SeedTarget[] =
      rawTargets.length === 0
        ? scope in TARGETS_BY_SCOPE
          ? ([...TARGETS_BY_SCOPE[scope]] as SeedTarget[])
          : ([
              ...US_TARGETS,
              ...UK_TARGETS,
              ...JP_TARGETS,
              ...DE_TARGETS,
              ...IE_TARGETS,
              ...BR_TARGETS,
              ...CN_TARGETS,
              ...NG_TARGETS,
            ] as SeedTarget[])
        : (rawTargets.map(canonicalTarget) as SeedTarget[]);

    const db = await getDb();
    const logs: string[] = [];
    const log = (msg: string) => logs.push(msg);

    if (targets.includes("states")) await seedStates(db, reset, log, preset);
    if (targets.includes("policies")) await seedPolicies(db, reset, log);
    if (targets.includes("demographics")) await seedDemographics(db, reset, log);
    if (targets.includes("gameConfig")) await seedGameConfig(db, reset, log, preset);
    if (targets.includes("parties")) await seedParties(db, log);
    if (targets.includes("statePartyOrg")) await seedStatePartyOrg(db, log, preset);
    if (targets.includes("regionMetrics")) await seedRegionMetrics(db, reset, log, preset);
    if (targets.includes("legislationTypes")) await seedLegislationTypes(db, reset, log, preset);
    if (targets.includes("achievements")) await seedAchievements(db, reset, log);
    if (targets.includes("statePolicies")) await seedStatePolicies(db, reset, log, preset);
    // Must be offerable alongside statePolicies: seedStatePolicies EXCLUDES the
    // old US/UK/RU/DD catalogs (they are superseded), so a targeted reseed
    // without this would leave the playable countries with no national policy
    // records at all. Ordering mirrors bootstrapGameWorld.
    if (targets.includes("politicalLegislation")) {
      const { seedPoliticalLegislationBaseline } =
        await import("@/lib/admin/seed/seedPoliticalLegislation");
      const { resolveWorldSeedYear } = await import("@/lib/era/context");
      await seedPoliticalLegislationBaseline(db, log, await resolveWorldSeedYear(db, preset));
    }
    if (targets.includes("budgets")) await seedBudgets(db, reset, log, preset);
    if (targets.includes("countyMapData")) await seedCountyMapData(log);
    if (targets.includes("indexesCore")) await seedCoreIndexes(db, log);
    if (targets.includes("indexesActivity")) await seedActivityIndexes(db, log);
    if (targets.includes("indexesCabinet")) await seedCabinetIndexes(db, log);
    if (targets.includes("indexesPerf")) await seedPerfIndexes(db, log);
    if (targets.includes("indexesSlowQuery")) await seedSlowQueryIndexes(db, log);
    if (targets.includes("indexesSearch")) await seedSearchIndexes(db, log);
    if (targets.includes("indexesInternationalOrganizations"))
      await seedInternationalOrganizationIndexes(db, log);
    if (targets.includes("indexesWriteGuards")) await seedWriteGuardIndexes(db, log);
    if (targets.includes("indexesPartyNppRework")) await seedPartyNppReworkIndexes(db, log);
    if (targets.includes("indexesSovereignDefault")) await seedSovereignDefaultIndexes(db, log);
    if (targets.includes("indexesObservability")) await seedObservabilityIndexes(db, log);
    if (targets.includes("indexesFinancialTxLog")) await seedFinancialTxLogIndexes(db, log);
    if (targets.includes("indexesCommodityPrices")) await seedCommodityPriceIndexes(db, log);
    if (targets.includes("indexesIndexFunds")) await seedIndexFundIndexes(db, log);
    if (targets.includes("indexesApiAccess")) await seedApiAccessIndexes(db, log);
    if (targets.includes("seats")) await seedSeats(db, reset, log, preset);
    // `reset` (hard re-seed) refreshes existing market docs so they track the
    // current preset's GDP; a soft fill stays insert-only to preserve live pools.
    if (targets.includes("unownedSectors")) await seedUnownedSectors(db, log, 1, preset, reset);
    if (targets.includes("unions")) await seedUnions(db, log, preset, reset);
    if (targets.includes("partyBudgets")) await seedPartyBudgets(db, reset, log);
    if (targets.includes("stateResourceCapacity"))
      await seedStateResourceCapacity(db, reset, log, preset);
    if (targets.includes("stateSectorSpecializations")) {
      await seedStateSectorSpecializations(db, reset, log);
    }
    if (targets.includes("forex")) await seedForex(db, log, preset);
    if (targets.includes("commodityPrices")) await seedCommodityPrices(db, reset, log, preset);
    if (targets.includes("ukRegions")) await seedUKRegions(db, reset, log, preset);
    if (targets.includes("ukParties")) await seedUKParties(db, log, preset);
    if (targets.includes("ukDemographics")) await seedUKDemographics(db, reset, log, preset);
    if (targets.includes("ukStatePartyOrg")) await seedUKStatePartyOrg(db, reset, log, preset);
    if (targets.includes("ukStateMetrics")) await seedUKStateMetrics(db, reset, log, preset);
    if (targets.includes("ukBaselines")) await seedUKBaselines(db, reset, log, preset);
    if (targets.includes("ukElections")) {
      await seedUKElections(log);
      await seedUKRegionalCouncil(db, reset, log);
    }
    if (targets.includes("ukLegislation")) await seedUkLegislation(db, log);
    if (targets.includes("ukBudgets")) await seedUkBudgets(db, reset, log, preset);
    if (targets.includes("ukGovernors2020")) await seedUKGovernors2020(db, reset, log);
    if (targets.includes("ukGovernors1992")) await seedUKGovernors1992(db, reset, log);
    // JP targets
    if (targets.includes("jpRegions")) await seedJPRegions(db, reset, log, preset);
    if (targets.includes("jpParties")) await seedJPParties(db, log, preset);
    if (targets.includes("jpDemographics")) await seedJPDemographics(db, reset, log, preset);
    if (targets.includes("jpStatePartyOrg")) await seedJPStatePartyOrg(db, reset, log, preset);
    if (targets.includes("jpStateMetrics")) await seedJPStateMetrics(db, reset, log, preset);
    if (targets.includes("jpBaselines")) await seedJPBaselines(db, reset, log, preset);
    if (targets.includes("jpGovernmentFormation")) await seedJPGovernmentFormation(db, log);
    if (targets.includes("jpBudgets")) await seedJpBudgets(db, reset, log, preset);
    if (targets.includes("jpGovernors2020")) await seedJPGovernors2020(db, reset, log);
    if (targets.includes("jpGovernors1991")) await seedJPGovernors1991(db, reset, log);
    // DE targets
    if (targets.includes("deRegions")) await seedDERegions(db, reset, log, preset);
    if (targets.includes("deParties")) await seedDEParties(db, log, preset);
    if (targets.includes("deDemographics")) await seedDEDemographics(db, reset, log, preset);
    if (targets.includes("deStatePartyOrg")) await seedDEStatePartyOrg(db, reset, log, preset);
    if (targets.includes("deStateMetrics")) await seedDEStateMetrics(db, reset, log, preset);
    if (targets.includes("deBaselines")) await seedDEBaselines(db, reset, log, preset);
    if (targets.includes("deGovernmentFormation")) await seedDEGovernmentFormation(db, log, preset);
    if (targets.includes("deLegislation")) await seedDELegislation(db, log);
    if (targets.includes("deElections")) await seedDEElections(log);
    if (targets.includes("deBudgets")) await seedDeBudgets(db, reset, log, preset);
    if (targets.includes("deBundestag2021")) await seedDEBundestag2021(db, reset, log);
    if (targets.includes("deMinisterPresidents2020"))
      await seedDEMinisterPresidents2020(db, reset, log);
    // IE targets
    if (targets.includes("ieRegions")) await seedIERegions(db, reset, log, preset);
    if (targets.includes("ieParties")) await seedIEParties(db, log, preset);
    if (targets.includes("ieDemographics")) await seedIEDemographics(db, reset, log, preset);
    if (targets.includes("ieStatePartyOrg")) await seedIEStatePartyOrg(db, reset, log, preset);
    if (targets.includes("ieStateMetrics")) await seedIEStateMetrics(db, reset, log, preset);
    if (targets.includes("ieBaselines")) await seedIEBaselines(db, reset, log, preset);
    if (targets.includes("ieGovernmentFormation")) await seedIEGovernmentFormation(db, log, preset);
    if (targets.includes("ieBudgets")) await seedIeBudgets(db, reset, log, preset);
    // BR targets
    if (targets.includes("brRegions")) await seedBRRegions(db, reset, log, preset);
    if (targets.includes("brParties")) await seedBRParties(db, log, preset);
    if (targets.includes("brDemographics")) await seedBRDemographics(db, reset, log, preset);
    if (targets.includes("brStateMetrics")) await seedBRStateMetrics(db, reset, log, preset);
    if (targets.includes("brBaselines")) await seedBRBaselines(db, reset, log, preset);
    if (targets.includes("brGovernmentFormation")) await seedBRGovernmentFormation(db, log);
    if (targets.includes("brBudgets")) await seedBrBudgets(db, reset, log, preset);
    // NG targets
    if (targets.includes("ngRegions")) await seedNGRegions(db, reset, log, preset);
    if (targets.includes("ngParties")) await seedNGParties(db, log, preset);
    if (targets.includes("ngDemographics")) await seedNGDemographics(db, reset, log, preset);
    if (targets.includes("ngStatePartyOrg")) await seedNGStatePartyOrg(db, reset, log, preset);
    if (targets.includes("ngStateMetrics")) await seedNGStateMetrics(db, reset, log, preset);
    if (targets.includes("ngBaselines")) await seedNGBaselines(db, reset, log, preset);
    if (targets.includes("ngGovernmentFormation")) await seedNGGovernmentFormation(db, log);
    if (targets.includes("ngBudgets")) await seedNgBudgets(db, reset, log, preset);
    // CN targets
    if (targets.includes("cnRegions")) await seedCNRegions(db, reset, log, preset);
    if (targets.includes("cnParties")) await seedCNParties(db, log);
    if (targets.includes("cnDemographics")) await seedCNDemographics(db, reset, log, preset);
    if (targets.includes("cnStateMetrics")) await seedCNStateMetrics(db, reset, log, preset);
    if (targets.includes("cnBaselines")) await seedCNBaselines(db, reset, log, preset);
    if (targets.includes("cnGovernmentFormation")) await seedCNGovernmentFormation(db, log);
    if (targets.includes("ruGovernmentFormation")) await seedRUGovernmentFormation(db, log);
    if (targets.includes("cnBudgets")) await seedCnBudgets(db, reset, log, preset);
    if (targets.includes("cnStatePartyOrg")) await seedCnStatePartyOrg(db, reset, log, preset);
    if (targets.includes("ruStatePartyOrg")) await seedRuStatePartyOrg(db, reset, log, preset);
    if (targets.includes("cnWiki")) {
      const result = await seedCNWiki(db);
      log(`seedCNWiki: upserted ${result.inserted} pages`);
    }

    const isFullSeed = rawTargets.length === 0;
    return NextResponse.json({
      success: true,
      message: isFullSeed
        ? `Full seed completed (${logs.length} operations)`
        : `Partial seed completed for: ${targets.join(", ")}`,
      targets,
      reset,
      logs,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

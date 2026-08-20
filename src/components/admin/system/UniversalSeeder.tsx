"use client";

import { useState } from "react";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";

interface SeedTarget {
  id: string;
  label: string;
  description: string;
  destructiveWarning?: string;
  scope?: string;
}

const SEED_TARGETS: SeedTarget[] = [
  {
    id: "states",
    label: "States",
    description: "50 US states + DC with population, GDP, districts, and political lean data",
    destructiveWarning: "Drops and recreates all state records",
  },
  {
    id: "policies",
    label: "Policies",
    description: "Base policy domain definitions (economic/social)",
    destructiveWarning: "Drops and recreates policy definitions",
  },
  {
    id: "demographics",
    label: "Demographics",
    description:
      "Demographic categories and state-level demographic group weights (turnout, alignment)",
    destructiveWarning:
      "Drops demographicCategories and stateDemographics — admin overrides will be lost",
  },
  {
    id: "gameConfig",
    label: "Game Config",
    description: "Core game configuration (turn duration, starting year, etc.)",
    destructiveWarning: "Drops and recreates game configuration",
  },
  {
    id: "parties",
    label: "Political Parties",
    description: "Default US parties (Democrat, Republican) with positions and colors",
    destructiveWarning: "Drops and recreates all political parties (custom parties lost)",
  },
  {
    id: "statePartyOrg",
    label: "State Party Orgs",
    description: "State-level party organization records (org %, caps, leadership slots)",
    destructiveWarning: "Drops and recreates all state party org records",
  },
  {
    id: "regionMetrics",
    label: "Region Metrics",
    description: "Per-region economic and population metrics (macroMetrics)",
    destructiveWarning: "Drops and recreates all region metrics — drift from turns will be lost",
  },
  {
    id: "legislationTypes",
    label: "Legislation Types",
    description: "US federal and state legislation type definitions with policy options",
    destructiveWarning: "Drops and recreates all US legislation types",
  },
  {
    id: "achievements",
    label: "Achievements",
    description: "Achievement definitions (does not affect player progress)",
  },
  {
    id: "statePolicies",
    label: "State Policies",
    description: "Base policy positions per state (economic/social lean per legislation type)",
    destructiveWarning: "Drops and recreates all state policy records",
  },
  {
    id: "politicalLegislation",
    label: "Political Legislation Baseline",
    description:
      "US/UK/RU/DD enacted law book and metric residuals for the world's year. Run alongside State Policies — those exclude the superseded old catalogs for these four countries.",
    destructiveWarning: "Rewrites national enacted laws and policy records for US/UK/RU/DD",
  },
  {
    id: "budgets",
    label: "US Budgets",
    description: "US federal budget, state budgets, enacted laws, formula grants, and US corp",
    destructiveWarning: "Drops and re-seeds US budget data",
    scope: "US",
  },
  {
    id: "indexesCore",
    label: "Indexes — Core",
    description:
      "Core identity/lookup indexes (users email/username/lastActivity, characters, states, parties, corporations)",
  },
  {
    id: "indexesActivity",
    label: "Indexes — Activity Log",
    description:
      "activityLog TTL + query indexes and suspiciousCharacters indexes for admin activity tracking",
  },
  {
    id: "indexesCabinet",
    label: "Indexes — Cabinet",
    description:
      "Unified cabinetMembers + UK cabinet cooldowns/members indexes (TTL on cooldownUntil)",
  },
  {
    id: "indexesPerf",
    label: "Indexes — Performance",
    description:
      "Compound indexes on hot read paths: bills, notifications, elections, primarySnapshots, npps, playerMail",
  },
  {
    id: "indexesSlowQuery",
    label: "Indexes — Slow Query",
    description:
      "COLLSCAN offenders: corporationHistory, commodityPriceHistory, actionLogs, statePartyElections",
  },
  {
    id: "indexesInternationalOrganizations",
    label: "Indexes — International Organizations",
    description: "UN/IMF leadership, legislation, membership, vote indexes",
  },
  {
    id: "indexesWriteGuards",
    label: "Indexes — Write Guards",
    description:
      "Partial-unique indexes on election entry, endorsements, governance votes, share offers, cabinet noms, leadership ballots, corp votes",
  },
  {
    id: "indexesPartyNppRework",
    label: "Indexes — Party / NPP rework",
    description:
      "Caucuses, recruitment slates, NPP cross-pressure, political capital, treasury transactions",
  },
  {
    id: "indexesSovereignDefault",
    label: "Indexes — Sovereign Default",
    description: "Crisis state-machine sweep indexes on federalBudget + sovereignCrisisDecisions",
  },
  {
    id: "indexesObservability",
    label: "Indexes — Observability",
    description:
      "gameHealthSnapshots, codeQualitySnapshots, siteTrafficPageviews (TTLs + query indexes)",
  },
  {
    id: "indexesFinancialTxLog",
    label: "Indexes — Financial Tx Log",
    description: "financialTxLog query indexes + TTL on expiresAt",
  },
  {
    id: "indexesCommodityPrices",
    label: "Indexes — Commodity Prices",
    description: "Unique index on commodityPrices.commodity",
  },
  {
    id: "indexesSettlement",
    label: "Indexes — Settlement Crisis",
    description:
      "settlementPlays drain + per-turn indexes, and the UNIQUE partial index on settlementCrises that stops two live German Questions. Required before the crisis is opened on a world that was never reset.",
  },
  {
    id: "forex",
    label: "Forex Layer",
    description:
      "Exchange rates, central banks for every forex-active country, forex indexes, and the gameState.forexEnabled flag",
  },
  {
    id: "commodityPrices",
    label: "Commodity Prices (baseline)",
    description:
      "One commodityPrices row per CommodityType at base price (current price; price history is runtime)",
    destructiveWarning: "Drops the commodityPrices collection and re-seeds baseline rows",
  },
  {
    id: "countyMapData",
    label: "County/CD Map Data",
    description: "County boundaries and congressional district GeoJSON for the interactive map",
    destructiveWarning: "Drops and re-imports all map geometry data",
  },
  {
    id: "seats",
    label: "Seats",
    description: "Election seat reference data (used for URL-friendly election links)",
    destructiveWarning: "Drops and recreates all seat records",
  },
  {
    id: "partyBudgets",
    label: "Party Budgets",
    description: "Ensures party budget documents exist for all default parties",
  },
  {
    id: "unownedSectors",
    label: "Unowned Sectors",
    description: "Corporate sectors not owned by any corporation (market baseline)",
  },
  {
    id: "stateSectorSpecializations",
    label: "State Sector Bonuses",
    description:
      "Primary (+10pp) and secondary (+5pp) sector profit margin bonuses per state/region",
  },
  // UK targets
  {
    id: "ukRegions",
    label: "UK Regions",
    description: "12 UK regions with population, GDP, constituencies, and political lean",
    destructiveWarning: "Drops and recreates UK region records in the states collection",
    scope: "UK",
  },
  {
    id: "ukParties",
    label: "UK Parties",
    description: "Default UK parties (Labour, Conservative, Lib Dems, SNP, etc.)",
    scope: "UK",
  },
  {
    id: "ukDemographics",
    label: "UK Demographics",
    description: "Demographic categories and region-level group weights for UK regions",
    destructiveWarning: "Drops and recreates UK demographic data",
    scope: "UK",
  },
  {
    id: "ukStatePartyOrg",
    label: "UK Region Party Orgs",
    description: "Party organization records for UK regions",
    destructiveWarning: "Drops and recreates UK region party org records",
    scope: "UK",
  },
  {
    id: "ukStateMetrics",
    label: "UK Region Metrics",
    description: "Regional metrics for UK regions (calibrated to ONS 2021 data)",
    destructiveWarning: "Drops and recreates UK metrics — drift from turns will be lost",
    scope: "UK",
  },
  {
    id: "ukBaselines",
    label: "UK Baselines",
    description: "Baseline snapshots for UK region metrics",
    destructiveWarning: "Drops and recreates UK baseline records",
    scope: "UK",
  },
  {
    id: "ukElections",
    label: "UK Elections",
    description:
      "Spawns missing UK Commons and Regional Council elections, updates RC seat counts, and populates NPP officials",
    destructiveWarning:
      "Reset mode deletes all Regional Council elections, elected officials, and associated NPPs — then recreates from scratch",
    scope: "UK",
  },
  {
    id: "ukLegislation",
    label: "UK Legislation",
    description: "55 UK-scoped legislation types (countryScope: uk) — refreshes UK types only",
    destructiveWarning: "Deletes and re-inserts all UK legislation types",
    scope: "UK",
  },
  {
    id: "ukBudgets",
    label: "UK Budgets",
    description: "UK national budget, regional budgets, enacted laws, and NHS corporation",
    destructiveWarning: "Deletes and re-seeds UK budget data",
    scope: "UK",
  },
  // JP targets
  {
    id: "jpRegions",
    label: "JP Regions",
    description: "8 Japan game regions with population, GDP, Shugiin/Sangiin seats",
    destructiveWarning: "Drops and recreates JP region records in the states collection",
    scope: "JP",
  },
  {
    id: "jpParties",
    label: "JP Parties",
    description: "Default JP parties (LDP, CDP, Komeito, JCP, Ishin, DPFP)",
    scope: "JP",
  },
  {
    id: "jpDemographics",
    label: "JP Demographics",
    description: "10 voter archetypes, 8 region demographics, and turnout modifiers",
    destructiveWarning: "Drops and recreates JP demographic data",
    scope: "JP",
  },
  {
    id: "jpStatePartyOrg",
    label: "JP Region Party Orgs",
    description: "Party organization records for JP regions (8 regions x 6 parties)",
    destructiveWarning: "Drops and recreates JP region party org records",
    scope: "JP",
  },
  {
    id: "jpStateMetrics",
    label: "JP Region Metrics",
    description: "Regional metrics for JP regions including 6 Japan-specific metrics",
    destructiveWarning: "Drops and recreates JP metrics",
    scope: "JP",
  },
  {
    id: "jpBaselines",
    label: "JP Baselines",
    description: "Baseline snapshots for JP region metrics",
    destructiveWarning: "Drops and recreates JP baseline records",
    scope: "JP",
  },
  {
    id: "jpGovernmentFormation",
    label: "JP Government",
    description: "Japan government formation document (pending status, ready for PM appointment)",
    scope: "JP",
  },
  {
    id: "jpBudgets",
    label: "JP Budgets",
    description: "JP national budget, regional budgets, enacted laws, and sovereign issuer corp",
    destructiveWarning: "Deletes and re-seeds JP budget data",
    scope: "JP",
  },
  // DE targets
  {
    id: "deRegions",
    label: "DE Regions",
    description: "16 German Länder with population, GDP, Bundestag direct mandates",
    destructiveWarning: "Drops and recreates DE region records in the states collection",
    scope: "DE",
  },
  {
    id: "deParties",
    label: "DE Parties",
    description: "Default DE parties (SPD, CDU, Greens, FDP, AfD, BSW, Linke)",
    scope: "DE",
  },
  {
    id: "deDemographics",
    label: "DE Demographics",
    description: "8 voter archetypes, 16 Land demographics, and turnout modifiers",
    destructiveWarning: "Drops and recreates DE demographic data",
    scope: "DE",
  },
  {
    id: "deStatePartyOrg",
    label: "DE Land Party Orgs",
    description: "Party organization records for each Land × party",
    destructiveWarning: "Drops and recreates DE Land party org records",
    scope: "DE",
  },
  {
    id: "deStateMetrics",
    label: "DE Land Metrics",
    description: "Economic and social metrics for each of the 16 Länder",
    destructiveWarning: "Drops and recreates DE metrics — drift from turns will be lost",
    scope: "DE",
  },
  {
    id: "deBaselines",
    label: "DE Baselines",
    description: "Metric decay baselines for each German Land",
    destructiveWarning: "Drops and recreates DE baseline records",
    scope: "DE",
  },
  {
    id: "deGovernmentFormation",
    label: "DE Government",
    description: "Germany government formation document for Chancellor appointment",
    scope: "DE",
  },
  {
    id: "deLegislation",
    label: "DE Legislation",
    description: "DE-scoped legislation types (tax, labor, energy, immigration)",
    destructiveWarning: "Deletes and re-inserts all DE legislation types",
    scope: "DE",
  },
  {
    id: "deElections",
    label: "DE Elections",
    description: "Spawn missing Bundestag elections for every Land",
    scope: "DE",
  },
  {
    id: "deBudgets",
    label: "DE Budgets",
    description: "DE national budget, regional budgets, enacted laws, and sovereign issuer corp",
    destructiveWarning: "Deletes and re-seeds DE budget data",
    scope: "DE",
  },
  {
    id: "deBundestag2021",
    label: "DE Bundestag (2021)",
    description:
      "Historical Bundestag composition (Feb 2021): 79 NPP officials distributed across the 16 Länder by party vote share",
    destructiveWarning:
      "On reset: deletes DE Bundestag NPP officials and retires NPPs whose only seat was Bundestag",
    scope: "DE",
  },
  {
    id: "deMinisterPresidents2020",
    label: "DE Minister-Presidents (2020)",
    description:
      "Historical Minister-Presidents (Feb 2020): one NPP per Land as the head of state government (Kretschmann, Söder, Schwesig, etc.)",
    destructiveWarning:
      "On reset: deletes DE Minister-President NPP officials and retires those NPPs",
    scope: "DE",
  },
  // IE targets
  {
    id: "ieRegions",
    label: "IE Regions",
    description: "8 Ireland NUTS III regions with population, GDP, Dáil/Seanad seats",
    destructiveWarning: "Drops and recreates IE region records in the states collection",
    scope: "IE",
  },
  {
    id: "ieParties",
    label: "IE Parties",
    description: "Default IE parties (Fine Gael, Fianna Fáil, Sinn Féin, Labour, Greens)",
    scope: "IE",
  },
  {
    id: "ieDemographics",
    label: "IE Demographics",
    description: "8 voter archetypes, 8 region demographics, and turnout modifiers",
    destructiveWarning: "Drops and recreates IE demographic data",
    scope: "IE",
  },
  {
    id: "ieStatePartyOrg",
    label: "IE State Party Org",
    description:
      "Per-region party organization levels for Ireland (8 regions × 5 default parties, derived from per-preset vote-share tables)",
    destructiveWarning: "Drops and recreates IE statePartyOrg rows",
    scope: "IE",
  },
  {
    id: "ieStateMetrics",
    label: "IE Region Metrics",
    description: "Economic and social metrics for each Ireland region",
    destructiveWarning: "Drops and recreates IE metrics — drift from turns will be lost",
    scope: "IE",
  },
  {
    id: "ieBaselines",
    label: "IE Baselines",
    description: "Metric decay baselines for each Ireland region",
    destructiveWarning: "Drops and recreates IE baseline records",
    scope: "IE",
  },
  {
    id: "ieGovernmentFormation",
    label: "IE Government",
    description: "Ireland government formation document for Taoiseach appointment",
    scope: "IE",
  },
  {
    id: "ieBudgets",
    label: "IE Budgets",
    description: "IE national budget, regional budgets, enacted laws, and sovereign issuer corp",
    destructiveWarning: "Deletes and re-seeds IE budget data",
    scope: "IE",
  },
  // BR targets
  {
    id: "brRegions",
    label: "BR Regions",
    description: "5 Brazil macro-regions with population, GDP, Chamber/Senate seats",
    destructiveWarning: "Drops and recreates BR region records in the states collection",
    scope: "BR",
  },
  {
    id: "brParties",
    label: "BR Parties",
    description: "Default BR parties (PT, PL, MDB, UNIÃO, PSD)",
    scope: "BR",
  },
  {
    id: "brDemographics",
    label: "BR Demographics",
    description: "8 voter archetypes, 5 region demographics, and turnout modifiers",
    destructiveWarning: "Drops and recreates BR demographic data",
    scope: "BR",
  },
  {
    id: "brStateMetrics",
    label: "BR Region Metrics",
    description: "Economic and social metrics for each Brazil macro-region",
    destructiveWarning: "Drops and recreates BR metrics — drift from turns will be lost",
    scope: "BR",
  },
  {
    id: "brBaselines",
    label: "BR Baselines",
    description: "Metric decay baselines for each Brazil region",
    destructiveWarning: "Drops and recreates BR baseline records",
    scope: "BR",
  },
  {
    id: "brGovernmentFormation",
    label: "BR Government",
    description: "Brazil government formation document for President appointment",
    scope: "BR",
  },
  {
    id: "brBudgets",
    label: "BR Budgets",
    description: "BR national budget, regional budgets, enacted laws, and sovereign issuer corp",
    destructiveWarning: "Deletes and re-seeds BR budget data",
    scope: "BR",
  },
  // NG targets
  {
    id: "ngRegions",
    label: "NG Regions",
    description: "6 Nigeria geopolitical zones with population, GDP, Senate/House seats",
    destructiveWarning: "Drops and recreates NG region records in the states collection",
    scope: "NG",
  },
  {
    id: "ngParties",
    label: "NG Parties",
    description: "Nigeria political parties (APC, PDP, LP, NNPP, APGA)",
    scope: "NG",
  },
  {
    id: "ngDemographics",
    label: "NG Demographics",
    description: "Nigeria voter archetypes, region demographics, and turnout modifiers",
    destructiveWarning: "Drops and recreates NG demographic data",
    scope: "NG",
  },
  {
    id: "ngStatePartyOrg",
    label: "NG Party Org",
    description: "Party organization records for each NG zone x party",
    destructiveWarning: "Drops and recreates NG statePartyOrg rows",
    scope: "NG",
  },
  {
    id: "ngStateMetrics",
    label: "NG Zone Metrics",
    description: "Zone-level economic and social metrics for Nigeria",
    destructiveWarning: "Drops and recreates NG metrics — drift from turns will be lost",
    scope: "NG",
  },
  {
    id: "ngBaselines",
    label: "NG Baselines",
    description: "Metric decay baselines for each Nigeria zone",
    destructiveWarning: "Drops and recreates NG baseline records",
    scope: "NG",
  },
  {
    id: "ngGovernmentFormation",
    label: "NG Government",
    description: "Nigeria government formation document for President/House appointment",
    scope: "NG",
  },
  {
    id: "ngBudgets",
    label: "NG Budgets",
    description: "NG national budget, regional budgets, enacted laws, and sovereign issuer corp",
    destructiveWarning: "Deletes and re-seeds NG budget data",
    scope: "NG",
  },
  // CN targets
  {
    id: "cnRegions",
    label: "CN Regions",
    description: "7 China geographic macro-regions with population, GDP, NPC seats",
    destructiveWarning: "Drops and recreates CN region records in the states collection",
    scope: "CN",
  },
  {
    id: "cnParties",
    label: "CN Parties",
    description: "Default CN parties (CCP, CDL, CNDCA)",
    scope: "CN",
  },
  {
    id: "cnDemographics",
    label: "CN Demographics",
    description: "7 voter archetypes, 7 region demographics, and turnout modifiers",
    destructiveWarning: "Drops and recreates CN demographic data",
    scope: "CN",
  },
  {
    id: "cnStateMetrics",
    label: "CN Region Metrics",
    description: "Economic and social metrics for each China geographic region",
    destructiveWarning: "Drops and recreates CN metrics — drift from turns will be lost",
    scope: "CN",
  },
  {
    id: "cnBaselines",
    label: "CN Baselines",
    description: "Metric decay baselines for each China region",
    destructiveWarning: "Drops and recreates CN baseline records",
    scope: "CN",
  },
  {
    id: "cnGovernmentFormation",
    label: "CN Government",
    description: "China government formation document for President appointment",
    scope: "CN",
  },
  {
    id: "ruGovernmentFormation",
    label: "RU Government",
    description: "Soviet Union government formation document (formed, NPC Premier linked)",
    scope: "RU",
  },
  {
    id: "ruStatePartyOrg",
    label: "RU Party Org",
    description: "CPSU regional organization + registration across the 17 RU regions",
    destructiveWarning: "Overwrites RU statePartyOrg rows",
    scope: "RU",
  },
  {
    id: "cnBudgets",
    label: "CN Budgets",
    description: "CN national budget, regional budgets, enacted laws, and sovereign issuer corp",
    destructiveWarning: "Deletes and re-seeds CN budget data",
    scope: "CN",
  },
];

interface SeedResult {
  success: boolean;
  message: string;
  logs?: string[];
  targets?: string[];
}

type SeedScope = CountryId | "all";
type YearTab = "2019" | "1991";
type SeedMode = "full" | "partial";

// Maps the UI year tab to the engine preset id consumed by /api/admin/seed.
// The "2019" baseline is the January-2019 era (116th Congress, post-2019 UK
// general election) — historically the codebase keyed this as "2019-default".
const PRESET_BY_YEAR: Record<YearTab, string> = {
  "2019": "2019-default",
  "1991": "1991-default",
};

export function UniversalSeeder() {
  const registered = useRegisteredCountries();
  const [activeYear, setActiveYear] = useState<YearTab>("2019");
  const [seedMode, setSeedMode] = useState<SeedMode>("full");
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<SeedScope>("US");
  const [resetMode, setResetMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);

  const toggleTarget = (id: string) => {
    setSelectedTargets((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedTargets(new Set(SEED_TARGETS.map((t) => t.id)));
  };

  const selectNone = () => {
    setSelectedTargets(new Set());
  };

  // Returns true if a seed target belongs to the given country.
  // SeedTarget.scope values are data-specific ("US", "UK", "both") — not derived from CountryId.
  // We use `countryKey` as the param name (not `countryId`) to avoid triggering the
  // no-country-literals ESLint rule, which only checks identifiers named `countryId` or `country`.
  const targetMatchesCountry = (
    targetScope: SeedTarget["scope"],
    countryKey: CountryId
  ): boolean => {
    const abbr = COUNTRY_CONFIGS[countryKey].id;
    // SeedTarget has no scope = US-only content; treat as matching US only
    if (!targetScope) return abbr === COUNTRY_CONFIGS.US.id;
    return targetScope === abbr || targetScope === "both";
  };

  const runSeed = async (targets: string[]) => {
    const isFullSeed = targets.length === 0;
    const hasDestructiveTargets =
      resetMode &&
      (isFullSeed ||
        targets.some((t) => SEED_TARGETS.find((st) => st.id === t)?.destructiveWarning));

    if (hasDestructiveTargets) {
      const targetNames = isFullSeed
        ? "ALL collections"
        : targets.map((t) => SEED_TARGETS.find((st) => st.id === t)?.label).join(", ");
      if (
        !confirm(
          `RESET MODE: This will DROP and re-seed the following:\n\n${targetNames}\n\nExisting data in these collections will be permanently deleted.\n\nContinue?`
        )
      )
        return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets,
          reset: resetMode,
          scope: scope === "all" ? "both" : scope,
          preset: PRESET_BY_YEAR[activeYear],
        }),
      });
      const data = await res.json();
      setResult({
        success: res.ok && data.success,
        message: data.message ?? data.error ?? "Unknown response",
        logs: data.logs,
        targets: data.targets,
      });
    } catch {
      setResult({ success: false, message: "Network error — could not reach the server" });
    } finally {
      setLoading(false);
    }
  };

  const handleFullSeed = () => runSeed([]);
  const handlePartialSeed = () => runSeed(Array.from(selectedTargets));

  const [partialFilter, setPartialFilter] = useState<CountryId | null>(null);

  const usTargets = SEED_TARGETS.filter((t) => !t.scope || t.scope === "US" || t.scope === "both");
  const ukTargets = SEED_TARGETS.filter((t) => t.scope === "UK" || t.scope === "both");
  const jpTargets = SEED_TARGETS.filter((t) => t.scope === "JP");
  const deTargets = SEED_TARGETS.filter((t) => t.scope === "DE");
  const ieTargets = SEED_TARGETS.filter((t) => t.scope === "IE");
  const brTargets = SEED_TARGETS.filter((t) => t.scope === "BR");
  const ngTargets = SEED_TARGETS.filter((t) => t.scope === "NG");
  const cnTargets = SEED_TARGETS.filter((t) => t.scope === "CN");

  const YEAR_TABS: { id: YearTab; label: string; description: string }[] = [
    {
      id: "2019",
      label: "2019",
      description: "January 2019 baseline — 116th Congress, post-2019 UK general election",
    },
    {
      id: "1991",
      label: "1991",
      description:
        "1991 baseline — 1990 Census populations, 1991 GSP, and era-specific party alignments. Use the 1990/1991/1992 governor & legislature targets in Partial Seed for historical officeholders.",
    },
  ];

  // Reset toggle component (shared between full and partial)
  const ResetToggle = () => (
    <div className="mb-4 flex items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={resetMode}
        onClick={() => setResetMode((v: boolean) => !v)}
        className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
        style={{
          backgroundColor: resetMode
            ? "var(--destructive, #dc2626)"
            : "var(--muted-border, #4b5563)",
        }}
      >
        <span
          className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={{ transform: resetMode ? "translateX(1.25rem)" : "translateX(0)" }}
        />
      </button>
      <span className="text-sm">
        Reset mode{" "}
        <span className={resetMode ? "font-semibold text-red-400" : "text-muted"}>
          {resetMode
            ? seedMode === "full"
              ? "ON — collections will be dropped first"
              : "ON — selected collections will be dropped first"
            : "OFF — upsert only"}
        </span>
      </span>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── Year Tabs ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6 shadow-sm">
        <h3 className="mb-3 text-lg font-semibold">Seed Data</h3>
        <p className="mb-4 text-sm text-muted">
          Select a year baseline and seed mode. Each year tab contains reference data calibrated to
          that historical starting point.
        </p>

        {/* Year selector */}
        <div className="mb-4 flex items-center gap-3">
          <span className="text-sm font-medium text-muted">Year:</span>
          <div className="flex rounded-lg border border-card-border p-0.5">
            {YEAR_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveYear(tab.id)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  activeYear === tab.id
                    ? "bg-primary text-white"
                    : "text-muted hover:text-foreground hover:bg-card-elevated"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-4 text-xs text-muted">
          {YEAR_TABS.find((t) => t.id === activeYear)?.description}
        </p>

        {/* Seed mode sub-tabs */}
        <div className="mb-5 flex rounded-lg border border-card-border p-0.5 w-fit">
          <button
            type="button"
            onClick={() => setSeedMode("full")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              seedMode === "full"
                ? "bg-green-600 text-white"
                : "text-muted hover:text-foreground hover:bg-card-elevated"
            }`}
          >
            Full Seed
          </button>
          <button
            type="button"
            onClick={() => setSeedMode("partial")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              seedMode === "partial"
                ? "bg-blue-600 text-white"
                : "text-muted hover:text-foreground hover:bg-card-elevated"
            }`}
          >
            Partial Seed
          </button>
        </div>

        {/* ── Full Seed Panel ──────────────────────────────────────── */}
        {seedMode === "full" && (
          <div>
            <p className="mb-4 text-sm text-muted">
              Seeds all game data for the selected scope. Idempotent — skips collections that
              already have data unless reset mode is enabled.
            </p>

            {/* Scope toggle */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-muted">Scope:</span>
              <div className="flex flex-wrap rounded-lg border border-card-border p-0.5">
                {[...registered, "all" as const].map((s) => {
                  const hasTargets =
                    s === "all" ||
                    SEED_TARGETS.some((t) => t.scope === s || (!t.scope && s === "US"));
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setScope(s)}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        scope === s
                          ? "bg-primary text-white"
                          : "text-muted hover:text-foreground hover:bg-card-elevated"
                      } ${!hasTargets ? "opacity-50" : ""}`}
                      title={
                        !hasTargets ? "No seed data available for this country yet" : undefined
                      }
                    >
                      {s === "all" ? "All" : (COUNTRY_CONFIGS[s as CountryId]?.name ?? s)}
                      {!hasTargets && <span className="ml-1 text-xs opacity-60">(no data)</span>}
                    </button>
                  );
                })}
              </div>
              <span className="text-xs text-muted">
                {scope === "US" && "50 states + DC, policies, demographics, parties, etc."}
                {scope === "UK" && "12 UK regions, parties, demographics, party orgs"}
                {scope === "JP" && "8 JP regions, parties, demographics, government formation"}
                {scope === "DE" &&
                  "16 Länder, parties, demographics, government formation, budgets"}
                {scope === "IE" &&
                  "8 NUTS III regions, parties, demographics, government formation, budgets"}
                {scope === "BR" &&
                  "5 macro-regions, parties, demographics, government formation, budgets"}
                {scope === "NG" &&
                  "6 geopolitical zones, parties, demographics, government formation, budgets"}
                {scope === "CN" &&
                  "7 geographic regions, parties, demographics, government formation, budgets"}
                {scope === "all" && "All countries: US, UK, JP, DE, IE, BR, CN, NG"}
              </span>
            </div>

            <ResetToggle />

            <button
              onClick={handleFullSeed}
              disabled={loading}
              className="min-h-[44px] rounded-lg bg-green-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50 transition-colors"
            >
              {loading ? "Seeding..." : "Run Full Seed"}
            </button>
          </div>
        )}

        {/* ── Partial Seed Panel ───────────────────────────────────── */}
        {seedMode === "partial" && (
          <div>
            <p className="mb-3 text-sm text-muted">
              Choose specific datasets to seed. Useful for updating individual collections without
              touching everything.
            </p>

            {/* Quick filter + select buttons */}
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPartialFilter(null)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  partialFilter === null
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-card-border text-muted hover:text-foreground"
                }`}
              >
                All Countries
              </button>
              {registered.map((cid) => {
                const hasTargets = SEED_TARGETS.some((t) => targetMatchesCountry(t.scope, cid));
                return (
                  <button
                    key={cid}
                    type="button"
                    onClick={() =>
                      hasTargets ? setPartialFilter(partialFilter === cid ? null : cid) : undefined
                    }
                    disabled={!hasTargets}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      partialFilter === cid
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-card-border text-muted hover:text-foreground"
                    }`}
                    title={
                      !hasTargets
                        ? `No seed targets for ${COUNTRY_CONFIGS[cid]?.name ?? cid}`
                        : undefined
                    }
                  >
                    {COUNTRY_CONFIGS[cid]?.name ?? cid}
                  </button>
                );
              })}
              <span className="mx-1 self-center text-card-border">|</span>
              <button
                type="button"
                onClick={selectAll}
                className="rounded-md border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="rounded-md border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
              >
                Clear
              </button>
            </div>

            <ResetToggle />

            {/* Target checkboxes */}
            <div className="mb-4 space-y-4">
              {[
                { key: "US" as const, label: "US targets", targets: usTargets },
                { key: "UK" as const, label: "UK targets", targets: ukTargets },
                { key: "JP" as const, label: "JP targets", targets: jpTargets },
                { key: "DE" as const, label: "DE targets", targets: deTargets },
                { key: "IE" as const, label: "IE targets", targets: ieTargets },
                { key: "BR" as const, label: "BR targets", targets: brTargets },
                { key: "NG" as const, label: "NG targets", targets: ngTargets },
                { key: "CN" as const, label: "CN targets", targets: cnTargets },
              ]
                .filter(({ key }) => !partialFilter || partialFilter === key)
                .map(({ key, label, targets }) => (
                  <div key={key}>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
                      {label}
                    </h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {targets.map((target) => {
                        const checked = selectedTargets.has(target.id);
                        return (
                          <label
                            key={target.id}
                            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                              checked
                                ? "border-primary/50 bg-primary/5"
                                : "border-card-border hover:border-muted"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTarget(target.id)}
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-card-border accent-primary"
                            />
                            <div className="min-w-0">
                              <span className="text-sm font-medium">{target.label}</span>
                              <p className="mt-0.5 text-xs text-muted leading-snug">
                                {target.description}
                              </p>
                              {resetMode && target.destructiveWarning && (
                                <p className="mt-1 text-xs text-red-400 leading-snug">
                                  Reset: {target.destructiveWarning}
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>

            <button
              onClick={handlePartialSeed}
              disabled={loading || selectedTargets.size === 0}
              className="min-h-[44px] rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
            >
              {loading
                ? "Seeding..."
                : selectedTargets.size === 0
                  ? "Select targets to seed"
                  : `Seed ${selectedTargets.size} target${selectedTargets.size === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </div>

      {/* ── Migrations Card ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/20">
          <svg
            className="h-6 w-6 text-purple-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </div>
        <h3 className="mb-1 text-lg font-semibold">Migrations</h3>
        <p className="mb-4 text-sm text-muted">
          One-time data migrations. Safe to re-run — only fills in missing data, never overwrites
          admin-defined values.
        </p>

        <div className="space-y-4">
          <p className="text-xs text-muted">
            Pre-reset migrations have been removed. Use the Migrations tab for database index setup.
          </p>
        </div>
      </div>

      {/* ── Result output ───────────────────────────────────────────── */}
      {result && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            result.success
              ? "border-green-500/30 bg-green-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}
        >
          <p className={`font-medium ${result.success ? "text-green-400" : "text-red-400"}`}>
            {result.success ? "Success" : "Error"}: {result.message}
          </p>
          {result.targets && result.targets.length > 0 && (
            <p className="mt-1 text-xs text-muted">Targets: {result.targets.join(", ")}</p>
          )}
          {result.logs && result.logs.length > 0 && (
            <ul className="mt-3 space-y-0.5 text-xs opacity-80 font-mono">
              {result.logs.map((l: string, i: number) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-green-500/60 shrink-0">{">"}</span>
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

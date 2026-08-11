import type { CountryId } from "./countries";
import type { InfraProject, BuildFundingLevel } from "@/lib/db/types/infraProject";

export interface InfraArchetype {
  id: string;
  label: string;
  description: string; // player-facing one-liner: what this asset does mechanically
  icon: string;
  buildDuration: number; // progress units (turns at standard funding)
  outputBase: number;
  upkeepBase: number; // M/turn operational
  constructionCostBase: number; // M/turn while building (× costMult)
  effects: Record<string, number>; // metricPath → standing per-turn delta (operational)
  /**
   * Calendar year this asset class first becomes buildable. Absent = timeless
   * (roads, bridges, rail, airports predate every playable era). Gates
   * anachronistic archetypes out of historical worlds (e.g. broadband rollouts
   * must not seed in 1953/1979). Matches the metric era window that backs the
   * asset (broadbandAccess windows 1998 in the Metric Era Catalog).
   */
  availableFrom?: number;
}

export const INFRA_ARCHETYPES: InfraArchetype[] = [
  {
    id: "highway",
    label: "Highway Expansion",
    description:
      "Improves road condition and closes the infrastructure investment gap in its region.",
    icon: "road",
    buildDuration: 6,
    outputBase: 500,
    upkeepBase: 40,
    constructionCostBase: 120,
    effects: {
      "infrastructure.roadCondition": 0.02,
      "infrastructure.infrastructureInvestmentGap": -0.015,
    },
  },
  {
    id: "transit",
    label: "Transit Line",
    description:
      "Expands public transit coverage and closes part of the infrastructure investment gap in its region.",
    icon: "train",
    buildDuration: 8,
    outputBase: 200,
    upkeepBase: 60,
    constructionCostBase: 180,
    effects: {
      "infrastructure.publicTransit": 0.025,
      "infrastructure.infrastructureInvestmentGap": -0.01,
    },
  },
  {
    id: "bridge",
    label: "Bridge Renewal",
    description: "A quick build that improves road condition in its region for modest upkeep.",
    icon: "bridge",
    buildDuration: 4,
    outputBase: 20,
    upkeepBase: 25,
    constructionCostBase: 80,
    effects: { "infrastructure.roadCondition": 0.02 },
  },
  {
    id: "broadband",
    label: "Broadband Rollout",
    description: "Extends broadband access across its region.",
    icon: "wifi",
    buildDuration: 5,
    outputBase: 100,
    upkeepBase: 30,
    constructionCostBase: 90,
    effects: { "infrastructure.broadbandAccess": 0.025 },
    availableFrom: 1998, // commercial broadband era; matches broadbandAccess metric window
  },
  {
    id: "railway",
    label: "Railway Line",
    description:
      "A long build that raises transport efficiency and closes part of the infrastructure investment gap in its region.",
    icon: "train",
    buildDuration: 9,
    outputBase: 400,
    upkeepBase: 55,
    constructionCostBase: 190,
    effects: {
      "infrastructure.transportEfficiency": 0.025,
      "infrastructure.infrastructureInvestmentGap": -0.015,
    },
    // No availableFrom: mainline rail predates every playable era. Deliberately
    // era-agnostic so the command-economy transport seats (RU "Minister of
    // Railways", DD "Minister of Transport") can build the mode their ministry
    // is named for, rather than only the road-and-airport set.
  },
  {
    id: "freight",
    label: "Freight Corridor",
    description:
      "Improves road condition and lifts GDP growth by speeding goods movement through its region.",
    icon: "truck",
    buildDuration: 7,
    outputBase: 300,
    upkeepBase: 50,
    constructionCostBase: 150,
    effects: { "infrastructure.roadCondition": 0.015, "economic.gdpGrowth": 0.01 },
  },
  {
    id: "airport",
    label: "Airport Upgrade",
    description: "Boosts public transit standing and lifts GDP growth in its region.",
    icon: "plane",
    buildDuration: 7,
    outputBase: 500,
    upkeepBase: 70,
    constructionCostBase: 200,
    effects: { "infrastructure.publicTransit": 0.015, "economic.gdpGrowth": 0.01 },
  },
];

/** Transportation seat per country (clean — never an Estates or Energy seat). */
export const INFRA_POSITION_BY_COUNTRY: Partial<Record<CountryId, string>> = {
  US: "secretary_of_transportation",
  UK: "transport_secretary",
  DE: "transport_minister",
  CN: "minister_of_transport",
  JP: "land_minister",
  IE: "minister_for_transport",
  RU: "minister_of_railways",
  DD: "minister_of_railways",
};

export interface BuildFundingDef {
  id: BuildFundingLevel;
  label: string;
  speedMult: number; // progress units added per turn
  costMult: number; // construction spend multiplier
}
export const BUILD_FUNDING: BuildFundingDef[] = [
  { id: "slowed", label: "Slowed", speedMult: 0.5, costMult: 0.6 },
  { id: "standard", label: "Standard", speedMult: 1.0, costMult: 1.0 },
  { id: "crashed", label: "Crashed", speedMult: 1.8, costMult: 1.6 },
];
export function buildFundingDef(level: BuildFundingLevel): BuildFundingDef {
  return BUILD_FUNDING.find((f) => f.id === level) ?? BUILD_FUNDING[1];
}

export const INFRA_EFFECT = { budgetWeight: 0.05 };
export const INFRA_UPKEEP_UNIT = 1_000_000;
export const INFRA_ENVELOPE_FALLBACK_GDP_FRACTION = 0.02;

/** Discretionary slice of the transportation appropriation for the project pipeline. Tunable. */
export const INFRA_DISCRETIONARY_FRACTION = 0.012;

/** Baseline discretionary allowance (millions of local currency); envelope = max(slice, baseline). Tunable. */
export const INFRA_DISCRETIONARY_BASELINE = 3_000;

/** Absolute cap (millions) on the pipeline discretionary budget; envelope = clamp(slice, baseline, cap). */
export const INFRA_DISCRETIONARY_CAP = 5_000;

export function getInfraArchetype(id: string): InfraArchetype | undefined {
  return INFRA_ARCHETYPES.find((a) => a.id === id);
}

/**
 * Archetypes buildable in a given calendar year. An archetype with an
 * `availableFrom` later than `year` is anachronistic and excluded (e.g.
 * broadband in a 1953 world). A null/undefined/non-finite year means legacy /
 * era-agnostic seeding — every archetype is available, so flag-off behavior is
 * unchanged.
 */
export function availableInfraArchetypes(year?: number | null): InfraArchetype[] {
  if (year == null || !Number.isFinite(year)) return INFRA_ARCHETYPES;
  return INFRA_ARCHETYPES.filter((a) => a.availableFrom == null || year >= a.availableFrom);
}
export function resolveInfraPosition(countryId: string, positionId: string): string | null {
  return INFRA_POSITION_BY_COUNTRY[countryId as CountryId] === positionId ? positionId : null;
}
export function effectiveOutput(project: Pick<InfraProject, "outputBase">): number {
  return project.outputBase;
}
export function turnsRemaining(
  project: Pick<InfraProject, "progress" | "buildDuration" | "fundingLevel">
): number {
  const speed = buildFundingDef(project.fundingLevel).speedMult;
  return Math.max(0, Math.ceil((project.buildDuration - project.progress) / speed));
}
export function progressPct(project: Pick<InfraProject, "progress" | "buildDuration">): number {
  if (project.buildDuration <= 0) return 100;
  return Math.min(100, Math.round((project.progress / project.buildDuration) * 100));
}

export interface InfraAggregate {
  building: number;
  operational: number;
  constructionSpend: number; // millions/turn (× costMult)
  operationalUpkeep: number; // millions/turn
  committedSpend: number;
  byRegion: Record<string, { building: number; operational: number }>;
}
export function aggregateInfra(projects: InfraProject[]): InfraAggregate {
  const byRegion: Record<string, { building: number; operational: number }> = {};
  let building = 0;
  let operational = 0;
  let constructionSpend = 0;
  let operationalUpkeep = 0;
  for (const p of projects) {
    const site = (byRegion[p.regionId] ??= { building: 0, operational: 0 });
    if (p.status === "operational") {
      operational++;
      operationalUpkeep += p.upkeepBase;
      site.operational++;
    } else {
      building++;
      constructionSpend += +(
        p.constructionCostBase * buildFundingDef(p.fundingLevel).costMult
      ).toFixed(4);
      site.building++;
    }
  }
  return {
    building,
    operational,
    constructionSpend: +constructionSpend.toFixed(4),
    operationalUpkeep,
    committedSpend: +(constructionSpend + operationalUpkeep).toFixed(4),
    byRegion,
  };
}

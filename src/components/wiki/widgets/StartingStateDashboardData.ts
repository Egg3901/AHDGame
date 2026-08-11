import type { CSSProperties } from "react";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { COMMODITY_UNITS, EXTRACTABLE_RESOURCES } from "@/lib/constants/commodities";
import { COUNTRY_CONFIGS, isParliamentarySystem, type CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { State } from "@/lib/db/types";
import type { PartySeed } from "@/lib/seeds/reference/politicalParties";
import { politicalParties } from "@/lib/seeds/reference/politicalParties";
import { STATE_RESOURCE_CAPACITY } from "@/lib/seeds/reference/stateResourceCapacity";
import { states } from "@/lib/seeds/reference/states";
import { ukParties } from "@/lib/seeds/uk/ukParties";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { deParties } from "@/lib/seeds/de/deParties";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { jpParties } from "@/lib/seeds/jp/jpParties";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { brParties } from "@/lib/seeds/br/brParties";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { cnParties } from "@/lib/seeds/cn/cnParties";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { ieParties } from "@/lib/seeds/ie/ieParties";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";

export type StartingCountryId = Exclude<
  CountryId,
  | "NG"
  | "HU"
  | "PL"
  | "RO"
  | "YU"
  | "BG"
  | "UKR"
  | "BLR"
  | "CS"
  | "BAL"
  | "RU"
  | "RU"
  | "FR"
  | "IT"
  | "ES"
  | "SE"
  | "TR"
  | "GR"
  | "AT"
  | "FI"
  | "DD"
  | "SCO"
  | "WAL"
>;

interface StartingEconomyFacts {
  countryId: StartingCountryId;
  fiscalYear: number;
  currencyCode: CurrencyCode;
  population: number;
  gdp: number;
  gdpGrowth: number;
  wageGrowth: number;
  inflationRate: number;
  tradeGrowth: number;
  debtPrincipal: number;
  debtInterestRate: number;
  debtCeiling: number;
  creditRating: string;
}

export interface CountryStartingStateCopy {
  id: StartingCountryId;
  shortName: string;
  system: string;
  legislature: string;
  posture: string;
  nppSummary: string;
  highlights: string[];
  nppDetails?: { label: string; value: string }[];
}

export const COUNTRY_ORDER: StartingCountryId[] = ["US", "UK", "DE", "JP", "BR", "CN", "IE"];

// 2019-scenario party rosters. Filters out 1991-only defaults (UUP, PDS,
// JSP, DSP) that wouldn't be seeded under the 2019-default preset — keeps
// the "default parties" count and treasury totals honest about what a
// 2019 new world actually creates.
function filterFor2019(seeds: readonly PartySeed[]): readonly PartySeed[] {
  return seeds.filter((s) => !s.validForPresets || s.validForPresets.includes("2019-default"));
}

export const PARTY_SEEDS_BY_COUNTRY: Record<StartingCountryId, readonly PartySeed[]> = {
  US: filterFor2019(politicalParties),
  UK: filterFor2019(ukParties),
  DE: filterFor2019(deParties),
  JP: filterFor2019(jpParties),
  BR: filterFor2019(brParties),
  CN: filterFor2019(cnParties),
  IE: filterFor2019(ieParties),
};

export const REGIONS_BY_COUNTRY: Record<StartingCountryId, readonly State[]> = {
  US: states.filter((state) => state.countryId === "US"),
  UK: ukRegions,
  DE: deRegions,
  JP: jpRegions,
  BR: brRegions,
  CN: cnRegions,
  IE: ieRegions,
};

// Mirrors the national budget seed configs in src/lib/seeds/reference/budgets.ts.
export const STARTING_ECONOMY_BY_COUNTRY: Record<StartingCountryId, StartingEconomyFacts> = {
  US: {
    countryId: "US",
    fiscalYear: 2019,
    currencyCode: "USD",
    population: 333_000_000,
    gdp: 27_000_000_000_000,
    gdpGrowth: 2.5,
    wageGrowth: 3.0,
    inflationRate: 2.5,
    tradeGrowth: 2.0,
    debtPrincipal: 28_500_000_000_000,
    debtInterestRate: 0.021,
    debtCeiling: 31_400_000_000_000,
    creditRating: "AA",
  },
  UK: {
    countryId: "UK",
    fiscalYear: 2019,
    currencyCode: "GBP",
    population: 68_000_000,
    gdp: 2_900_000_000_000,
    gdpGrowth: 1.2,
    wageGrowth: 3.1,
    inflationRate: 3.2,
    tradeGrowth: 1.0,
    debtPrincipal: 2_820_000_000_000,
    debtInterestRate: 0.046,
    debtCeiling: 3_300_000_000_000,
    creditRating: "A",
  },
  DE: {
    countryId: "DE",
    fiscalYear: 2019,
    currencyCode: "EUR",
    population: 84_400_000,
    gdp: 4_500_000_000_000,
    gdpGrowth: 1.1,
    wageGrowth: 2.3,
    inflationRate: 1.8,
    tradeGrowth: 1.4,
    debtPrincipal: 2_450_000_000_000,
    debtInterestRate: 0.028,
    debtCeiling: 3_000_000_000_000,
    creditRating: "AAA",
  },
  JP: {
    countryId: "JP",
    fiscalYear: 2019,
    currencyCode: "JPY",
    population: 126_000_000,
    gdp: 550_000_000_000_000,
    gdpGrowth: 0.6,
    wageGrowth: 1.0,
    inflationRate: 0.5,
    tradeGrowth: 0.3,
    debtPrincipal: 1_200_000_000_000_000,
    debtInterestRate: 0.01,
    debtCeiling: 1_500_000_000_000_000,
    creditRating: "A",
  },
  BR: {
    countryId: "BR",
    fiscalYear: 2023,
    currencyCode: "BRL",
    population: 215_000_000,
    gdp: 10_900_000_000_000,
    gdpGrowth: 2.9,
    wageGrowth: 4.5,
    inflationRate: 4.6,
    tradeGrowth: 3.2,
    debtPrincipal: 6_800_000_000_000,
    debtInterestRate: 0.105,
    debtCeiling: 9_000_000_000_000,
    creditRating: "BB",
  },
  CN: {
    countryId: "CN",
    fiscalYear: 2023,
    currencyCode: "CNY",
    population: 1_412_000_000,
    gdp: 126_000_000_000_000,
    gdpGrowth: 5.2,
    wageGrowth: 5.0,
    inflationRate: 0.2,
    tradeGrowth: 4.5,
    debtPrincipal: 32_000_000_000_000,
    debtInterestRate: 0.035,
    debtCeiling: 40_000_000_000_000,
    creditRating: "A",
  },
  IE: {
    countryId: "IE",
    fiscalYear: 2023,
    currencyCode: "EUR",
    population: 5_100_000,
    gdp: 500_000_000_000,
    gdpGrowth: 3.5,
    wageGrowth: 4.0,
    inflationRate: 3.2,
    tradeGrowth: 2.5,
    debtPrincipal: 235_000_000_000,
    debtInterestRate: 0.025,
    debtCeiling: 300_000_000_000,
    creditRating: "AA",
  },
};

export const COUNTRY_COPY: Record<StartingCountryId, CountryStartingStateCopy> = {
  US: {
    id: "US",
    shortName: "US",
    system: "Federal presidential republic with fixed executive terms",
    legislature: "U.S. House, 435 seats; U.S. Senate, 100 seats",
    posture:
      "The cleanest two-party opening. Both default parties are equally funded and sit near the center of their side of the map.",
    nppSummary:
      "Generated dynamically at world creation. Counts are weighted by state organization strength and state lean.",
    highlights: [
      "Two default parties, both protected from deletion.",
      "Third-party entry requires 5 state footprints and 10 seeded NPPs.",
      "No coalition or confidence-vote layer at turn 0.",
    ],
  },
  UK: {
    id: "UK",
    shortName: "UK",
    system: "Westminster parliamentary democracy with snap elections",
    legislature: "House of Commons, 650 seats; majority threshold 326",
    posture:
      "The widest starting party menu. Major national parties, regional parties, and smaller ideological parties all exist before players join.",
    nppSummary: "Generated dynamically by region and party organization.",
    highlights: [
      "Nine default parties, the broadest starting field.",
      "Labour, Conservatives, and Liberal Democrats open with full treasuries.",
      "Commons confidence makes government formation a day-one strategic layer.",
    ],
    nppDetails: [{ label: "Historical identities", value: "None seeded" }],
  },
  DE: {
    id: "DE",
    shortName: "DE",
    system: "Federal parliamentary republic with constructive no-confidence rules",
    legislature: "Bundestag, 630 seats; majority threshold 316",
    posture:
      "Germany opens with a mature parliamentary party system and the largest pre-seeded named NPP pool.",
    nppSummary:
      "About 201 named NPPs are pre-seeded from 2021 Bundestag vote shares, then distributed across all 16 Lander.",
    highlights: [
      "CDU and CSU act as a sister-party bloc but remain separate parties.",
      "CSU is restricted to Bavaria.",
      "Pre-seeded NPPs make the opening field feel populated immediately.",
    ],
    nppDetails: [
      { label: "SPD", value: "57" },
      { label: "CDU", value: "40" },
      { label: "Grune", value: "33" },
      { label: "AfD", value: "23" },
      { label: "FDP", value: "25" },
      { label: "CSU", value: "12" },
      { label: "Die Linke", value: "11" },
    ],
  },
  JP: {
    id: "JP",
    shortName: "JP",
    system: "Parliamentary constitutional monarchy with snap elections",
    legislature: "House of Representatives, 465 seats; majority threshold 233",
    posture:
      "A dominant-party parliamentary opening where coalition support and cabinet-origin bills matter early.",
    nppSummary: "Generated dynamically at world creation.",
    highlights: [
      "LDP and CDP are the dominant opening poles.",
      "Komeito begins as the natural LDP coalition partner.",
      "Cabinet Bills give the executive a distinct policy route.",
    ],
    nppDetails: [{ label: "Historical identities", value: "None seeded" }],
  },
  BR: {
    id: "BR",
    shortName: "BR",
    system: "Federal presidential republic with fragmented congressional politics",
    legislature: "Chamber of Deputies, 513 seats; Federal Senate, 81 seats",
    posture:
      "A presidential system with coalition pressure baked in. PT and PL anchor the poles, while broker parties start with meaningful funds.",
    nppSummary: "Generated dynamically at world creation. No named NPPs are pre-seeded.",
    highlights: [
      "PT and PL define the opening ideological poles.",
      "MDB starts as the centrist big-tent broker.",
      "Congressional fragmentation keeps coalition-building relevant.",
    ],
  },
  CN: {
    id: "CN",
    shortName: "CN",
    system: "One-party dominant state under the CPPCC framework",
    legislature: "National People's Congress, 2,980 seats; majority threshold 1,491",
    posture:
      "The most asymmetric treasury opening. The CCP dominates the field while minor parties exist inside CCP-defined limits.",
    nppSummary: "Generated dynamically at world creation. No named NPPs are pre-seeded.",
    highlights: [
      "CCP starts with by far the largest treasury.",
      "Minor parties represent intellectual and business-aligned blocs.",
      "There is no normal coalition confidence collapse.",
    ],
  },
  IE: {
    id: "IE",
    shortName: "IE",
    system: "Parliamentary republic where coalition governments are the norm",
    legislature: "Dail Eireann, 160 seats; majority threshold 81",
    posture:
      "A compact but coalition-heavy opening. The traditional centrist rivals begin well funded, with left and green partners close enough to matter.",
    nppSummary: "Generated dynamically at world creation. No named NPPs are pre-seeded.",
    highlights: [
      "Fine Gael and Fianna Fail open as centrist rivals.",
      "Sinn Fein is the strongest left-wing force.",
      "Taoiseach confidence makes coalition arithmetic immediate.",
    ],
  },
};

export function formatMoney(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `$${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}M`;
  }
  return `$${Math.round(value / 1_000)}K`;
}

export function formatCompactCurrency(value: number, currencyCode: CurrencyCode): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: "narrowSymbol",
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000_000_000 ? 1 : 0,
  }).format(value);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  }).format(value);
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatPointPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatResourceCapacity(resource: ExtractableResource, value: number): string {
  const unit = COMMODITY_UNITS[resource] ?? "units";
  return `${formatCompactNumber(value)} ${unit}/turn`;
}

export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

export function ideologyLabel(axis: "economic" | "social", value: number): string {
  if (axis === "economic") {
    if (value <= -4) return "Far left";
    if (value < 0) return "Center-left";
    if (value === 0) return "Center";
    if (value < 4) return "Center-right";
    return "Far right";
  }

  if (value <= -4) return "Very progressive";
  if (value < 0) return "Progressive";
  if (value === 0) return "Mixed";
  if (value < 4) return "Conservative";
  return "Traditionalist";
}

export function formatPartyCreationRule(countryId: StartingCountryId): string {
  const rule = COUNTRY_CONFIGS[countryId].partyCreationNPPs;
  const regionCount = rule.statesRequired + (rule.lockHomeState ? 1 : 0);
  const totalNpps = regionCount * rule.nppsPerState;
  return `${regionCount} regions, ${totalNpps} NPPs`;
}

export function getGovernmentOpening(countryId: StartingCountryId): string {
  const config = COUNTRY_CONFIGS[countryId];
  if (config.governmentType === "onePartyState") return "One-party dominance";
  if (isParliamentarySystem(config)) return "Pending formation";
  return "Fixed executive cycle";
}

export function getDebtToGdp(countryId: StartingCountryId): number {
  const economy = STARTING_ECONOMY_BY_COUNTRY[countryId];
  return economy.debtPrincipal / economy.gdp;
}

export function getDebtHeadroom(countryId: StartingCountryId): number {
  const economy = STARTING_ECONOMY_BY_COUNTRY[countryId];
  return Math.max(0, economy.debtCeiling - economy.debtPrincipal);
}

export function getTopRegion(countryId: StartingCountryId): State | undefined {
  return [...REGIONS_BY_COUNTRY[countryId]].sort((a, b) => b.gdp - a.gdp)[0];
}

export function getResourceSummary(countryId: StartingCountryId) {
  const totals: Partial<Record<ExtractableResource, number>> = {};
  let activeRegionCount = 0;

  for (const capacity of Object.values(STATE_RESOURCE_CAPACITY)) {
    if (capacity.countryId !== countryId) continue;
    const activeResources = Object.entries(capacity.resources).filter(
      ([, value]) => (value ?? 0) > 0
    );
    if (activeResources.length > 0) activeRegionCount += 1;

    for (const [resource, value] of activeResources) {
      const key = resource as ExtractableResource;
      totals[key] = (totals[key] ?? 0) + (value ?? 0);
    }
  }

  const resources = EXTRACTABLE_RESOURCES.map((resource) => ({
    resource,
    value: totals[resource] ?? 0,
  }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);

  return {
    activeRegionCount,
    resourceTypeCount: resources.length,
    topResources: resources.slice(0, 4),
    resources,
  };
}

export function getPartyPositionStyle(
  party: PartySeed,
  parties: readonly PartySeed[]
): CSSProperties {
  const samePosition = parties.filter(
    (p) =>
      p.economicPosition === party.economicPosition && p.socialPosition === party.socialPosition
  );
  const duplicateIndex = samePosition.findIndex((p) => p.abbreviation === party.abbreviation);
  const duplicateCount = samePosition.length;
  const radius = duplicateCount > 1 ? 10 : 0;
  const angle = duplicateCount > 1 ? (Math.PI * 2 * duplicateIndex) / duplicateCount : 0;
  const x = ((party.economicPosition + 5) / 10) * 100;
  const y = ((party.socialPosition + 5) / 10) * 100;

  return {
    backgroundColor: party.color,
    left: `calc(${x}% + ${Math.cos(angle) * radius}px)`,
    top: `calc(${y}% + ${Math.sin(angle) * radius}px)`,
  };
}

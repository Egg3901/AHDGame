// src/lib/wiki/learningPaths.ts
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { CountryId } from "@/lib/constants/countries";

export interface LearningPathPage {
  slug: string;
  title: string;
  description: string;
  estimatedMinutes: number;
}

export interface LearningPath {
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  icon: string;
  estimatedTime: string;
  pages: LearningPathPage[];
}

/**
 * Map country-specific wiki page slugs to their CountryId.
 *
 * When a learning-path page references content that is only available in
 * certain countries, add the slug here so it is filtered out for players who
 * don't have that country enabled.
 *
 * Global pages (slugs not in this map) are always visible.
 */
const COUNTRY_PAGE_SLUGS: Record<string, CountryId> = {
  "uk-overview": "UK",
  "us-overview": "US",
  "jp-overview": "JP",
  "de-overview": "DE",
  "ie-overview": "IE",
  "br-overview": "BR",
  "cn-overview": "CN",
  "ng-overview": "NG",
  "ru-overview": "RU",
  "dd-overview": "DD",
};

export const LEARNING_PATHS: LearningPath[] = [
  {
    id: "new-player",
    slug: "new-player",
    title: "New Player Journey",
    description:
      "Essential guide for getting started in A House Divided. Learn the basics and run your first campaign.",
    difficulty: "beginner",
    icon: "🌟",
    estimatedTime: "63 minutes",
    pages: [
      {
        slug: "getting-started",
        title: "Getting Started",
        description: "Learn the basics and create your character",
        estimatedMinutes: 10,
      },
      {
        slug: "core-systems",
        title: "Core Systems",
        description: "Understand turns, actions, and game flow",
        estimatedMinutes: 10,
      },
      {
        slug: "stats-actions",
        title: "Stats & Actions",
        description: "Master your character stats and available actions",
        estimatedMinutes: 10,
      },
      {
        slug: "rpg-stats",
        title: "RPG Stats and Debates",
        description: "Learn what each character stat changes in play",
        estimatedMinutes: 5,
      },
      {
        slug: "relocation",
        title: "Relocation",
        description: "Changing home state, cooldown, and CEO rules",
        estimatedMinutes: 4,
      },
      {
        slug: "campaign-strategy",
        title: "Your First Campaign",
        description: "Build influence and prepare for elections",
        estimatedMinutes: 8,
      },
      {
        slug: "election-mechanics",
        title: "Winning Your First Election",
        description: "Navigate primaries and general elections",
        estimatedMinutes: 7,
      },
      {
        slug: "multi-country-play",
        title: "Choose Your Country",
        description: "Compare political systems and cross-border play",
        estimatedMinutes: 8,
      },
    ],
  },
  {
    id: "running-for-office",
    slug: "running-for-office",
    title: "Running for Office",
    description:
      "Advanced campaign tactics, demographics, and winning strategies for competitive elections.",
    difficulty: "intermediate",
    icon: "🏆",
    estimatedTime: "97 minutes",
    pages: [
      {
        slug: "election-mechanics",
        title: "Election Mechanics",
        description: "Deep dive into election systems",
        estimatedMinutes: 12,
      },
      {
        slug: "campaign-strategy",
        title: "Campaign Strategy Guide",
        description: "Master campaign action allocation",
        estimatedMinutes: 15,
      },
      {
        slug: "demographics-targeting",
        title: "Demographics & Targeting",
        description: "Understand voter demographics and targeting",
        estimatedMinutes: 15,
      },
      {
        slug: "fundraising-ads",
        title: "Fundraising & Ads Guide",
        description: "Optimize your campaign budget",
        estimatedMinutes: 15,
      },
      {
        slug: "political-operations",
        title: "Political Operations",
        description: "Build presidential Campaign Presence by state",
        estimatedMinutes: 7,
      },
      {
        slug: "primary-general-tactics",
        title: "Primary vs General Tactics",
        description: "Different strategies for each phase",
        estimatedMinutes: 18,
      },
      {
        slug: "npp-elections",
        title: "NPP Opponents Guide",
        description: "Compete against NPP politicians",
        estimatedMinutes: 15,
      },
    ],
  },
  {
    id: "advanced-strategy",
    slug: "advanced-strategy",
    title: "Advanced Strategy",
    description: "Master Congress, party building, and min-maxing for experienced players.",
    difficulty: "advanced",
    icon: "🎯",
    estimatedTime: "2 hours 22 minutes",
    pages: [
      {
        slug: "congress-leadership",
        title: "Congress Leadership",
        description: "Navigate congressional leadership roles",
        estimatedMinutes: 15,
      },
      {
        slug: "chamber-leadership",
        title: "Chamber Leadership",
        description: "Compare leadership roles across national legislatures",
        estimatedMinutes: 10,
      },
      {
        slug: "bills-legislation",
        title: "Bills & Legislation",
        description: "Master the legislative process",
        estimatedMinutes: 15,
      },
      {
        slug: "national-budget",
        title: "National Budget & Treasury",
        description: "National treasury panels, spending, and debt context",
        estimatedMinutes: 12,
      },
      {
        slug: "reference-offices",
        title: "Reference: Offices",
        description: "Compare offices, terms, action bonuses, and party strength",
        estimatedMinutes: 18,
      },
      {
        slug: "party-organization",
        title: "Party Organization",
        description: "Grow organization and strengthen your party",
        estimatedMinutes: 20,
      },
      {
        slug: "reference-formulas",
        title: "Reference: Formulas",
        description: "Understand game mechanics formulas",
        estimatedMinutes: 20,
      },
      {
        slug: "power-player-guide",
        title: "Power Player Guide",
        description: "Coordinate party, office, corporate, and NPP power",
        estimatedMinutes: 18,
      },
      {
        slug: "advanced-strategy",
        title: "Advanced Strategy",
        description: "Plan career arcs and coordinate multiple systems",
        estimatedMinutes: 14,
      },
    ],
  },
  {
    id: "economy-operator",
    slug: "economy-operator",
    title: "Economy Operator",
    description:
      "Learn the plants economy from corporate operations and commodity clearing through household demand, finance, and macro policy.",
    difficulty: "intermediate",
    icon: "🏭",
    estimatedTime: "96 minutes",
    pages: [
      {
        slug: "plants-corp-guide",
        title: "Running a Corporation under the Plants System",
        description: "Build capacity and read the physical-economy P&L",
        estimatedMinutes: 12,
      },
      {
        slug: "commodities",
        title: "Commodities",
        description: "Understand supply, demand, prices, and margin effects",
        estimatedMinutes: 10,
      },
      {
        slug: "resources-overview",
        title: "Natural Resources & Extraction",
        description: "Capacity, depletion, prospecting, and contracts",
        estimatedMinutes: 8,
      },
      {
        slug: "household-economy",
        title: "Household Demand & Price Level",
        description: "Consumer demand, price elasticity, and real income",
        estimatedMinutes: 7,
      },
      {
        slug: "stock-market",
        title: "Stock Market",
        description: "Valuation, voting control, dividends, and takeovers",
        estimatedMinutes: 9,
      },
      {
        slug: "sovereign-bonds",
        title: "Sovereign Bonds",
        description: "Debt issuance, auctions, coupons, and fiscal risk",
        estimatedMinutes: 7,
      },
      {
        slug: "central-banks",
        title: "Central Banks",
        description: "Rates, reserves, savings, credit, and forex defense",
        estimatedMinutes: 12,
      },
      {
        slug: "interbank-lending",
        title: "Interbank Lending",
        description: "Follow liquidity support and private-bank distress",
        estimatedMinutes: 5,
      },
      {
        slug: "pensions",
        title: "Pensions",
        description: "Understand retirement funds and institutional capital",
        estimatedMinutes: 5,
      },
      {
        slug: "imf-sovereign-facility",
        title: "IMF Sovereign Facility",
        description: "Resolve sovereign crises with income-capped support",
        estimatedMinutes: 6,
      },
      {
        slug: "market-safeguards",
        title: "Market Safeguards",
        description: "Know the controls that limit unstable market behavior",
        estimatedMinutes: 5,
      },
      {
        slug: "national-budget",
        title: "National Budget & Treasury",
        description: "Revenue, spending, deficits, and debt",
        estimatedMinutes: 10,
      },
    ],
  },
  {
    id: "war-college",
    slug: "war-college",
    title: "War College",
    description:
      "Everything you need to raise an army, command it, and fight a war, from the chain of command to a full worked campaign.",
    difficulty: "intermediate",
    icon: "⚔️",
    estimatedTime: "93 minutes",
    pages: [
      {
        slug: "conflicts-overview",
        title: "Conflicts & the Military System",
        description: "The chain of command, who may act, and how a war is structured",
        estimatedMinutes: 8,
      },
      {
        slug: "declaring-war",
        title: "Declaring War",
        description: "Authorize conflict and understand the war mandate",
        estimatedMinutes: 7,
      },
      {
        slug: "military-units",
        title: "Units, Recruitment & Procurement",
        description: "Raise, price, and modernise an army",
        estimatedMinutes: 10,
      },
      {
        slug: "manpower-conscription",
        title: "Manpower and Conscription",
        description: "Understand the recruitable pool and service policy",
        estimatedMinutes: 5,
      },
      {
        slug: "generals",
        title: "Generals & the Officer Corps",
        description: "Commission officers and develop them",
        estimatedMinutes: 10,
      },
      {
        slug: "national-doctrine",
        title: "National Doctrine",
        description: "Set the strategic posture that shapes combat",
        estimatedMinutes: 6,
      },
      {
        slug: "military-commands",
        title: "Military Commands",
        description: "Organize units and commanders before battle",
        estimatedMinutes: 5,
      },
      {
        slug: "fighting-a-battle",
        title: "Fighting a Battle",
        description: "Deploy, read the odds, and declare an offensive",
        estimatedMinutes: 11,
      },
      {
        slug: "defence-procurement",
        title: "Defence Procurement",
        description: "Buy equipment through the military supply system",
        estimatedMinutes: 8,
      },
      {
        slug: "occupation-and-victory",
        title: "Occupation and Victory",
        description: "Track control, occupation, and war objectives",
        estimatedMinutes: 6,
      },
      {
        slug: "peace-and-truces",
        title: "Peace and Truces",
        description: "End conflicts and understand postwar restrictions",
        estimatedMinutes: 5,
      },
      {
        slug: "a-war-start-to-finish",
        title: "A War, Start to Finish",
        description: "A complete worked campaign from declaration to peace",
        estimatedMinutes: 12,
      },
    ],
  },
  {
    id: "cold-war-operations",
    slug: "cold-war-operations",
    title: "Cold War Operations",
    description:
      "Use blocs, international organizations, trade restrictions, and military power in historical worlds.",
    difficulty: "advanced",
    icon: "🌐",
    estimatedTime: "40 minutes",
    pages: [
      {
        slug: "bloc-spheres",
        title: "Bloc Alignment and Spheres",
        description: "Read alignment shares, membership gates, drift, and bloc stress",
        estimatedMinutes: 7,
      },
      {
        slug: "international-organizations",
        title: "International Organizations",
        description: "Membership, leadership, legislation, and diplomatic actions",
        estimatedMinutes: 6,
      },
      {
        slug: "trade-system",
        title: "International Trade",
        description: "Follow blocs, agreements, tariffs, and bilateral clearing",
        estimatedMinutes: 7,
      },
      {
        slug: "embargo-and-trade-exposure",
        title: "Embargo and Trade Exposure",
        description: "Use restrictions and understand their economic reach",
        estimatedMinutes: 5,
      },
      {
        slug: "conflicts-overview",
        title: "Conflicts and the Military System",
        description: "Connect geopolitical competition to the war system",
        estimatedMinutes: 8,
      },
      {
        slug: "central-banks",
        title: "Central Banks",
        description: "Manage rates, reserves, currency defense, and financial pressure",
        estimatedMinutes: 7,
      },
    ],
  },
];

export function getLearningPathBySlug(slug: string): LearningPath | undefined {
  return LEARNING_PATHS.find((p) => p.slug === slug);
}

export function getAllLearningPaths(): LearningPath[] {
  return LEARNING_PATHS;
}

/**
 * Return all learning paths with country-specific pages filtered out for
 * players who don't have those countries enabled.
 *
 * Only page slugs listed in `COUNTRY_PAGE_SLUGS` are checked — global pages
 * are always visible. Paths that end up with zero visible pages are still
 * returned (the consumer can decide whether to hide them).
 */
export async function getVisibleLearningPaths(): Promise<LearningPath[]> {
  const enabledCountries = await getEnabledCountryIds();
  return LEARNING_PATHS.map((path) => ({
    ...path,
    pages: path.pages.filter((page) => {
      const countryId = COUNTRY_PAGE_SLUGS[page.slug];
      if (!countryId) return true; // Global pages always visible
      return enabledCountries.includes(countryId);
    }),
  }));
}

/**
 * Return a single learning path by slug with country-specific pages filtered
 * out for players who don't have those countries enabled.
 *
 * Returns `undefined` if no path matches the slug. Pages are filtered — a
 * path with all its pages removed by country filtering still returns the
 * path object (with an empty `pages` array) so the consumer can show the
 * path header and handle the empty state.
 */
export async function getVisibleLearningPathBySlug(
  slug: string
): Promise<LearningPath | undefined> {
  const enabledCountries = await getEnabledCountryIds();
  const path = LEARNING_PATHS.find((p) => p.slug === slug);
  if (!path) return undefined;
  return {
    ...path,
    pages: path.pages.filter((page) => {
      const countryId = COUNTRY_PAGE_SLUGS[page.slug];
      if (!countryId) return true;
      return enabledCountries.includes(countryId);
    }),
  };
}

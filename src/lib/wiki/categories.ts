// src/lib/wiki/categories.ts
export interface WikiCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
}

export const WIKI_CATEGORIES: WikiCategory[] = [
  {
    id: "getting-started",
    slug: "getting-started",
    name: "Getting Started",
    description: "New player onboarding and first steps",
  },
  {
    id: "elections",
    slug: "elections",
    name: "Elections",
    description: "Primary/general mechanics, campaign tactics",
  },
  {
    id: "legislatures",
    slug: "legislatures",
    name: "Legislatures",
    description: "Bills, voting, leadership, committees",
  },
  {
    id: "parties",
    slug: "parties",
    name: "Parties",
    description: "Party system, endorsements, coalitions, NPPs",
  },
  {
    id: "countries",
    slug: "countries",
    name: "Countries",
    description: "Country hubs: US, UK, DE, JP, IE, BR, CN, NG, RU, DD",
  },
  {
    id: "military",
    slug: "military",
    name: "Conflicts & Military",
    description: "Declaring war, armies, generals, battles, occupation, and peace",
  },
  {
    id: "economy",
    slug: "economy",
    name: "Economy & Finance",
    description: "GDP, budgets, currency, bonds, corporations",
  },
  {
    id: "commodities",
    slug: "commodities",
    name: "Commodities",
    description: "Per-commodity market pages with live distribution",
  },
  {
    id: "resources",
    slug: "resources",
    name: "Resources",
    description: "Extractable resources, contracts, subsidies, tariffs",
  },
  {
    id: "advanced",
    slug: "advanced",
    name: "Advanced & Reference",
    description: "Formulas, technical details, strategy guides",
  },
  {
    id: "iterations",
    slug: "iterations",
    name: "Iterations",
    description: "Historical recaps of each numbered iteration of the live game",
  },
  {
    id: "reference",
    slug: "reference",
    name: "Reference",
    description: "Uncategorized and miscellaneous reference material",
  },
  {
    id: "custom-pages",
    slug: "custom-pages",
    name: "Custom Pages",
    description: "Player-written wiki pages created from scratch",
  },
  {
    id: "characters",
    slug: "characters",
    name: "Characters",
    description: "Player-authored biographies and profiles",
  },
  {
    id: "corporations",
    slug: "corporations",
    name: "Corporations",
    description: "Company pages written by CEOs",
  },
  {
    id: "player-parties",
    slug: "player-parties",
    name: "Party profiles",
    description: "Party-owned pages written by party leadership",
  },
  {
    id: "events",
    slug: "events",
    name: "Events",
    description: "Historical events, crises, and major in-game moments",
  },
];

/** Categories eligible for player-authored submissions. System-only
 * categories (e.g. auto-generated country/party/commodity reference pages)
 * are omitted so users can't file a biography under "Elections". */
export const PLAYER_SUBMITTABLE_CATEGORY_IDS = [
  "characters",
  "corporations",
  "player-parties",
  "events",
  "reference",
] as const;
export type PlayerSubmittableCategoryId = (typeof PLAYER_SUBMITTABLE_CATEGORY_IDS)[number];

export function isPlayerSubmittableCategory(id: string): id is PlayerSubmittableCategoryId {
  return (PLAYER_SUBMITTABLE_CATEGORY_IDS as readonly string[]).includes(id);
}

export function getCategoryById(id: string): WikiCategory | undefined {
  return WIKI_CATEGORIES.find((c) => c.id === id);
}

export function getCategoryBySlug(slug: string): WikiCategory | undefined {
  return WIKI_CATEGORIES.find((c) => c.slug === slug);
}

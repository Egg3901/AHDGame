// src/lib/wiki/categories.ts
export interface WikiCategory {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string; // Tailwind color class
}

export const WIKI_CATEGORIES: WikiCategory[] = [
  {
    id: "getting-started",
    slug: "getting-started",
    name: "Getting Started",
    description: "New player onboarding and first steps",
    icon: "🎮",
    color: "text-blue-400",
  },
  {
    id: "elections",
    slug: "elections",
    name: "Elections",
    description: "Primary/general mechanics, campaign tactics",
    icon: "🗳️",
    color: "text-purple-400",
  },
  {
    id: "legislatures",
    slug: "legislatures",
    name: "Legislatures",
    description: "Bills, voting, leadership, committees",
    icon: "🏛️",
    color: "text-red-400",
  },
  {
    id: "parties",
    slug: "parties",
    name: "Parties",
    description: "Party system, endorsements, coalitions, NPPs",
    icon: "🎯",
    color: "text-yellow-400",
  },
  {
    id: "countries",
    slug: "countries",
    name: "Countries",
    description: "Country hubs: US, UK, DE, JP, IE, BR, CN, NG, RU, DD",
    icon: "🗺️",
    color: "text-green-400",
  },
  {
    id: "military",
    slug: "military",
    name: "Conflicts & Military",
    description: "Declaring war, armies, generals, battles, occupation, and peace",
    icon: "⚔️",
    color: "text-red-300",
  },
  {
    id: "economy",
    slug: "economy",
    name: "Economy & Finance",
    description: "GDP, budgets, currency, bonds, corporations",
    icon: "💹",
    color: "text-emerald-400",
  },
  {
    id: "commodities",
    slug: "commodities",
    name: "Commodities",
    description: "Per-commodity market pages with live distribution",
    icon: "📦",
    color: "text-amber-400",
  },
  {
    id: "resources",
    slug: "resources",
    name: "Resources",
    description: "Extractable resources, contracts, subsidies, tariffs",
    icon: "⛏️",
    color: "text-orange-400",
  },
  {
    id: "advanced",
    slug: "advanced",
    name: "Advanced & Reference",
    description: "Formulas, technical details, strategy guides",
    icon: "📚",
    color: "text-pink-400",
  },
  {
    id: "iterations",
    slug: "iterations",
    name: "Iterations",
    description: "Historical recaps of each numbered iteration of the live game",
    icon: "🕰️",
    color: "text-violet-400",
  },
  {
    id: "reference",
    slug: "reference",
    name: "Reference",
    description: "Uncategorized and miscellaneous reference material",
    icon: "📄",
    color: "text-slate-400",
  },
  {
    id: "custom-pages",
    slug: "custom-pages",
    name: "Custom Pages",
    description: "Player-written wiki pages created from scratch",
    icon: "✍️",
    color: "text-fuchsia-400",
  },
  {
    id: "characters",
    slug: "characters",
    name: "Characters",
    description: "Player-authored biographies and profiles",
    icon: "👤",
    color: "text-indigo-400",
  },
  {
    id: "corporations",
    slug: "corporations",
    name: "Corporations",
    description: "Company pages written by CEOs",
    icon: "🏢",
    color: "text-cyan-400",
  },
  {
    id: "player-parties",
    slug: "player-parties",
    name: "Party profiles",
    description: "Party-owned pages written by party leadership",
    icon: "🏳️",
    color: "text-yellow-300",
  },
  {
    id: "events",
    slug: "events",
    name: "Events",
    description: "Historical events, crises, and major in-game moments",
    icon: "📰",
    color: "text-rose-400",
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

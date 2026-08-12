import { getCountryConfig, type CountryId } from "@/lib/constants/countries";

export type WorldNavSection = "corporate" | "leaderboard" | "main";

export interface WorldNavItem {
  id: string;
  label: string;
  /** Message id under the "nav" namespace; renderers resolve via t(labelKey). */
  labelKey: string;
  href: string;
  section: WorldNavSection;
  show: boolean;
  /** Highlight as primary/corporate link */
  primary?: boolean;
}

export interface WorldNavOpts {
  countryId?: string;
  myCorporationId?: number | null;
  conflictsEnabled?: boolean;
  unionsEnabled?: boolean;
}

/**
 * Pure builder for World navigation links. Consumed by WorldDropdown, classic
 * mobile World section, and ExperimentalNavbar.
 */
export function buildWorldNavItems({
  countryId = "US",
  myCorporationId = null,
  conflictsEnabled = false,
  unionsEnabled = false,
}: WorldNavOpts): WorldNavItem[] {
  const country = countryId.toLowerCase();

  return [
    {
      id: "myCorporation",
      label: "My Corporation",
      labelKey: "menus.world.myCorporation",
      href: `/corporation/${myCorporationId}`,
      section: "corporate",
      show: myCorporationId != null,
      primary: true,
    },
    {
      id: "legacyLeaderboard",
      label: "Hall of Fame",
      labelKey: "menus.world.hallOfFame",
      href: "/world/legacy",
      section: "leaderboard",
      show: true,
    },
    {
      id: "nations",
      label: "Nations",
      labelKey: "menus.world.nations",
      href: "/world",
      section: "main",
      show: true,
    },
    {
      id: "map",
      label: "Map",
      labelKey: "menus.world.map",
      href: getCountryConfig(countryId as CountryId).mapPath,
      section: "main",
      show: true,
    },
    {
      id: "crises",
      label: "Crises",
      labelKey: "menus.world.crises",
      href: "/world/crises",
      section: "main",
      show: true,
    },
    {
      id: "conflicts",
      label: "Conflicts",
      labelKey: "menus.world.conflicts",
      href: "/world/conflicts",
      section: "main",
      show: conflictsEnabled,
    },
    {
      id: "internationalOrgs",
      label: "International Orgs",
      labelKey: "menus.world.internationalOrgs",
      href: "/world/international-organizations",
      section: "main",
      show: true,
    },
    {
      id: "sectors",
      label: "Sectors",
      labelKey: "menus.world.sectors",
      href: "/sectors",
      section: "main",
      show: true,
    },
    {
      id: "unions",
      label: "Unions",
      labelKey: "menus.world.unions",
      href: "/unions",
      section: "main",
      show: unionsEnabled,
    },
    {
      id: "stockMarket",
      label: "Stock Market",
      labelKey: "menus.world.stockMarket",
      href: "/stockmarket/global",
      section: "main",
      show: true,
    },
    {
      id: "forex",
      label: "Currency Exchange",
      labelKey: "menus.world.forex",
      href: "/forex/global",
      section: "main",
      show: true,
    },
    {
      id: "trade",
      label: "Trade",
      labelKey: "menus.world.trade",
      href: "/world/trade",
      section: "main",
      show: true,
    },
    {
      id: "news",
      label: "News",
      labelKey: "menus.world.news",
      href: `/news?country=${country}`,
      section: "main",
      show: true,
    },
    {
      id: "imf",
      label: "IMF",
      labelKey: "menus.world.imf",
      href: "/international/imf",
      section: "main",
      show: true,
    },
    {
      id: "banking",
      label: "Banking",
      labelKey: "menus.world.banking",
      href: "/banking",
      section: "main",
      show: true,
    },
  ];
}

export function visibleWorldNavItems(opts: WorldNavOpts): WorldNavItem[] {
  return buildWorldNavItems(opts).filter((i) => i.show);
}

// ── Mobile category grouping ────────────────────────────────────────────────
//
// The desktop World dropdown (WorldDropdown.tsx / ExperimentalNavbar's inline
// worldMenu) renders `worldSubItems` as a mostly-flat list with a couple of
// cosmetic position-based headers (see ExperimentalNavbar's `showLeaderboardHeader`
// / `showMarketsHeader`). That rendering is untouched by this grouping — it's
// consumed only by the mobile drawer, which needed real collapsible categories
// (parity with the National Details Government/Politics/Economy/Other groups)
// rather than one long flat list.
//
// `WORLD_NAV_GROUPS` is the ordered, data-driven source of both group order
// and in-group item order for the mobile World section — this is where a
// future traffic-informed reorder should edit (reorder the group entries,
// or the `itemIds` arrays within a group).
export type WorldNavGroupId = "leaderboards" | "diplomacy" | "economy" | "other";

export interface WorldNavGroup {
  id: WorldNavGroupId;
  title: "Leaderboards" | "Diplomacy" | "Economy" | "Other";
  /** Message id under the "nav" namespace for the group header. */
  titleKey: string;
  items: WorldNavItem[];
}

interface WorldNavGroupDef {
  id: WorldNavGroupId;
  title: WorldNavGroup["title"];
  titleKey: string;
  /** `WorldNavItem.id`s belonging to this group, in display order. */
  itemIds: string[];
}

// Group and item order is set by measured traffic (Umami, 24 days to
// 2026-07-23, 318k pageviews), quoted as % of all site pageviews. Economy
// leads on Stock Market alone (2.82%, plus 0.82% for the country-scoped
// route); everything in Diplomacy is under 0.4%; Hall of Fame did not appear
// in the top-30 routes at all, so Leaderboards sits last despite being first
// in the original taxonomy-ordered list.
const WORLD_NAV_GROUPS: WorldNavGroupDef[] = [
  {
    id: "economy",
    title: "Economy",
    titleKey: "menus.world.groups.economy",
    // IMF sits here rather than Diplomacy — it's the world's central-bank
    // equivalent, mirroring how the Nation section's Economy group carries
    // the country's own central bank.
    // Stock Market 2.82% > Sectors 0.40% > Currency Exchange 0.35% >
    // Trade 0.10%; Banking, IMF and Unions are below the measurement floor.
    // Banking replaces the nation-details central-bank link as the world entry.
    itemIds: ["stockMarket", "sectors", "forex", "trade", "banking", "imf", "unions"],
  },
  {
    id: "diplomacy",
    title: "Diplomacy",
    titleKey: "menus.world.groups.diplomacy",
    // Nations 0.32% > International Orgs 0.08% > Crises 0.06%. Map keeps
    // second place because it is the entry point to the region cluster.
    itemIds: ["nations", "map", "internationalOrgs", "crises", "conflicts"],
  },
  { id: "other", title: "Other", titleKey: "menus.world.groups.other", itemIds: ["news"] },
  {
    id: "leaderboards",
    title: "Leaderboards",
    titleKey: "menus.world.groups.leaderboards",
    itemIds: ["legacyLeaderboard"],
  },
];

/**
 * Groups visible World nav items into the mobile drawer's four collapsible
 * categories (Leaderboards / Diplomacy / Economy / Other). `myCorporation` is
 * intentionally excluded — it's a personal/pinned link, surfaced separately
 * via {@link looseWorldNavItems} above the grouped categories (mirrors the
 * Nation section's loose Home Nation / My Party links above its groups).
 * Empty groups (e.g. Diplomacy with `conflicts` hidden) are dropped.
 */
export function buildWorldNavSections(items: WorldNavItem[]): WorldNavGroup[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return WORLD_NAV_GROUPS.map(({ id, title, titleKey, itemIds }) => ({
    id,
    title,
    titleKey,
    items: itemIds
      .map((itemId) => byId.get(itemId))
      .filter((item): item is WorldNavItem => item != null),
  })).filter((group) => group.items.length > 0);
}

/** Ungrouped, pinned World items shown above the collapsible categories. */
export function looseWorldNavItems(items: WorldNavItem[]): WorldNavItem[] {
  return items.filter((item) => item.id === "myCorporation");
}

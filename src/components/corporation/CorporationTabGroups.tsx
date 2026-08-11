import type { NavSuperTabDef, LegacyTabMap, ResolvedTabs } from "@/components/nav/SuperTabNav";
import type { CorpTabId } from "./CorporationPageTypes";
import {
  CORP_TABS,
  CEO_TAB,
  DEALS_TAB,
  STRUCTURE_TAB,
  type CorpTab,
} from "./CorporationPageConstants";

/**
 * Corporation page tab grouping.
 *
 * The corporation page used to render every destination as one top-level tab
 * (12 for a CEO, plus the CEO Office's own inner sub-tabs), which overflowed
 * into a horizontally scrolling row — players had to scroll sideways to reach
 * the tabs on the right. This groups them the same way the state/region page
 * was grouped: a handful of super-tabs, each with its own sub-tab row, driven
 * by the shared `SuperTabNav`.
 *
 * Every previous destination still exists; only its address changed, and the
 * old `?tab=<id>` deep links keep working through `CORP_LEGACY_TAB_MAP`.
 */

export type CorpGroupId = "overview" | "finance" | "operations" | "ownership" | "ceo";

export interface CorpGroupDef {
  id: CorpGroupId;
  label: string;
  tooltip: string;
  icon: React.ReactNode;
  /** Tabs in display order. A group with no visible tabs is not rendered. */
  tabIds: CorpTabId[];
  /** Super-tab accent (CEO Office keeps its warning colour). */
  accent?: "primary" | "warning";
}

const ICONS = {
  overview: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
      />
    </svg>
  ),
  finance: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 7h6m0 10v-3m-3 3v-6m-3 6v-1m9-9h.01M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"
      />
    </svg>
  ),
  operations: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
      />
    </svg>
  ),
  ownership: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
      />
    </svg>
  ),
  ceo: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  ),
};

export const CORP_GROUPS: CorpGroupDef[] = [
  {
    id: "overview",
    label: "Overview",
    tooltip: "High-level summary of the corporation's performance and key metrics",
    icon: ICONS.overview,
    tabIds: ["overview"],
  },
  {
    id: "finance",
    label: "Finance",
    tooltip: "Statements, debt, and performance history",
    icon: ICONS.finance,
    tabIds: ["financials", "credit", "charts", "snapshot"],
  },
  {
    id: "operations",
    label: "Operations",
    tooltip: "What the corporation runs and produces — sectors, goods, R&D, and contracts",
    icon: ICONS.operations,
    tabIds: ["sectors", "commodities", "tech", "contracts", "defence"],
  },
  {
    id: "ownership",
    label: "Ownership",
    tooltip: "Equity, acquisitions, and corporate structure",
    icon: ICONS.ownership,
    tabIds: ["shares", "deals", "structure"],
  },
  {
    id: "ceo",
    label: "CEO Office",
    tooltip: "CEO-only controls: strategy, dividends, salaries, and corporate actions",
    icon: ICONS.ceo,
    tabIds: ["ceo"],
    accent: "warning",
  },
];

/** Every tab id, mapped to the group that now holds it. */
export const CORP_TAB_GROUP: Record<CorpTabId, CorpGroupId> = CORP_GROUPS.reduce(
  (acc, group) => {
    for (const tabId of group.tabIds) acc[tabId] = group.id;
    return acc;
  },
  {} as Record<CorpTabId, CorpGroupId>
);

/**
 * Where a tab id lives in the new nav. Groups whose only member is the tab
 * itself (Overview, CEO Office) render no sub-tab bar, so their sub id is "".
 */
export function corpTabLocation(tabId: CorpTabId): ResolvedTabs {
  const group = CORP_GROUPS.find((g) => g.id === CORP_TAB_GROUP[tabId]);
  if (!group) return { superTab: "overview", subTab: "" };
  return { superTab: group.id, subTab: group.tabIds.length > 1 ? tabId : "" };
}

/**
 * Old flat `?tab=<id>` links (bookmarks, in-game links, recommendation cards)
 * resolved onto the new (super, sub) pair. Includes the pre-merge ids that the
 * page already redirected (`credit-rating`, `bonds`) and `settings`, which used
 * to be a CEO Office alias.
 */
export const CORP_LEGACY_TAB_MAP: LegacyTabMap = {
  ...(Object.keys(CORP_TAB_GROUP) as CorpTabId[]).reduce((acc, tabId) => {
    acc[tabId] = corpTabLocation(tabId);
    return acc;
  }, {} as LegacyTabMap),
  "credit-rating": corpTabLocation("credit"),
  bonds: corpTabLocation("credit"),
  settings: corpTabLocation("ceo"),
};

/**
 * Every tab that can exist, ignoring gating. Used for viewer-independent work
 * (deriving the active tab for data prefetching before the corporation payload
 * has told us what this viewer may see).
 */
export const ALL_CORP_TABS: CorpTab[] = [...CORP_TABS, DEALS_TAB, STRUCTURE_TAB, CEO_TAB];

function visibleMembers(visibleTabs: CorpTab[], groupId: CorpGroupId): CorpTabId[] {
  const group = CORP_GROUPS.find((g) => g.id === groupId);
  if (!group) return [];
  const ids = new Set(visibleTabs.map((t) => t.id));
  return group.tabIds.filter((id) => ids.has(id));
}

/**
 * Which tab a rendered (super, sub) pair means for THIS viewer. A group with a
 * single visible member renders no sub-tab bar, so its sub id is "" and the
 * member is implied.
 */
export function corpTabIdFor(
  visibleTabs: CorpTab[],
  superId: string,
  subId: string
): CorpTabId | null {
  const members = visibleMembers(visibleTabs, superId as CorpGroupId);
  if (members.length === 0) return null;
  if (members.length === 1) return members[0];
  return members.includes(subId as CorpTabId) ? (subId as CorpTabId) : members[0];
}

/** Where to navigate for a tab id, given what this viewer can see. */
export function corpNavLocation(visibleTabs: CorpTab[], tabId: CorpTabId): ResolvedTabs {
  const groupId = CORP_TAB_GROUP[tabId];
  const members = visibleMembers(visibleTabs, groupId);
  return { superTab: groupId, subTab: members.length > 1 ? tabId : "" };
}

/**
 * Build the nav definitions from the tabs this viewer may actually see.
 *
 * `visibleTabs` is the existing gated tab list (CEO-only, private-corp,
 * feature-flag rules are unchanged and stay in the page); this only decides
 * how the survivors are arranged. Groups that end up empty are dropped.
 */
export function buildCorpNavTabs(
  visibleTabs: CorpTab[],
  extras?: { badges?: Partial<Record<CorpTabId, React.ReactNode>> }
): NavSuperTabDef[] {
  const byId = new Map(visibleTabs.map((t) => [t.id, t]));
  const nav: NavSuperTabDef[] = [];

  for (const group of CORP_GROUPS) {
    const members = group.tabIds.filter((id) => byId.has(id));
    if (members.length === 0) continue;
    nav.push({
      id: group.id,
      label: group.label,
      icon: group.icon,
      tooltip: group.tooltip,
      accent: group.accent,
      subTabs:
        members.length > 1
          ? members.map((id) => {
              const tab = byId.get(id)!;
              return {
                id,
                label: tab.label,
                tooltip: tab.tooltip,
                badge: extras?.badges?.[id],
              };
            })
          : undefined,
    });
  }

  return nav;
}

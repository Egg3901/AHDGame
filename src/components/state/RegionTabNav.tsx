"use client";

import { SuperTabNav, type NavSuperTabDef } from "@/components/nav/SuperTabNav";

// ── Types ──

export type SuperTabId = "overview" | "politics" | "economy" | "demographics" | "governance";

export type LegacyTabId =
  | "overview"
  | "elections"
  | "politics"
  | "parties"
  | "demographics"
  | "metrics"
  | "budget"
  | "laws"
  | "economy"
  | "resources"
  | "admin";

interface SubTabDef {
  id: string;
  label: string;
  /** When true, only visible to admins */
  adminOnly?: boolean;
}

interface SuperTabDef {
  id: SuperTabId;
  label: string;
  icon: React.ReactNode;
  /** Sub-tabs; if omitted, this super-tab is a single-panel dashboard (Overview) */
  subTabs?: SubTabDef[];
}

// ── Backward-compat mapping: old ?tab=X → new (super, sub) ──

const LEGACY_MAP: Record<string, { super: SuperTabId; sub: string }> = {
  overview: { super: "overview", sub: "" },
  elections: { super: "politics", sub: "elections" },
  politics: { super: "politics", sub: "officials" },
  parties: { super: "politics", sub: "parties" },
  demographics: { super: "demographics", sub: "demographics" },
  metrics: { super: "demographics", sub: "metrics" },
  budget: { super: "economy", sub: "budget" },
  laws: { super: "governance", sub: "laws" },
  economy: { super: "economy", sub: "sectors" },
  resources: { super: "economy", sub: "resources" },
  admin: { super: "governance", sub: "admin" },
};

// ── Icon components (shared between US and UK variants) ──

const ICONS = {
  overview: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h6v6H4V6zm0 8h6v4H4v-4zm10-8h6v4h-6V6zm0 6h6v6h-6v-6z"
      />
    </svg>
  ),
  politics: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
      />
    </svg>
  ),
  economy: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 3v18h18M7 14l4-4 3 3 5-6"
      />
    </svg>
  ),
  demographics: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  ),
  governance: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  ),
};

// ── Super-tab definitions ──

const SUPER_TABS: SuperTabDef[] = [
  {
    id: "overview",
    label: "Overview",
    icon: ICONS.overview,
    // No sub-tabs — dashboard
  },
  {
    id: "politics",
    label: "Politics",
    icon: ICONS.politics,
    subTabs: [
      { id: "officials", label: "Officials" },
      { id: "parties", label: "Parties" },
      { id: "elections", label: "Elections" },
    ],
  },
  {
    id: "economy",
    label: "Economy",
    icon: ICONS.economy,
    subTabs: [
      { id: "sectors", label: "Sectors" },
      { id: "budget", label: "Budget" },
      { id: "resources", label: "Resources" },
    ],
  },
  {
    id: "demographics",
    label: "Demographics",
    icon: ICONS.demographics,
    subTabs: [
      { id: "demographics", label: "Demographics & Turnout" },
      { id: "metrics", label: "Metrics" },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    icon: ICONS.governance,
    subTabs: [
      { id: "laws", label: "Laws & Policy" },
      { id: "admin", label: "Admin", adminOnly: true },
    ],
  },
];

// ── Helpers ──

function getSuperTab(id: SuperTabId): SuperTabDef | undefined {
  return SUPER_TABS.find((t) => t.id === id);
}

function getVisibleSubTabs(superTab: SuperTabDef, isAdmin: boolean): SubTabDef[] {
  if (!superTab.subTabs) return [];
  return superTab.subTabs.filter((s) => !s.adminOnly || isAdmin);
}

function isValidSuperTab(id: string, isAdmin: boolean): id is SuperTabId {
  const tab = getSuperTab(id as SuperTabId);
  if (!tab) return false;
  // Governance with only the admin sub-tab — non-admins have no visible subs,
  // but the super-tab itself is still valid (shows Laws)
  return true;
}

/**
 * Resolve a URL search-params state into (superTab, subTab).
 * Handles backward-compat: if `?tab=` contains a legacy tab ID, map it.
 * Also handles the case where `?tab=` is a super-tab ID and `?sub=` is the sub-tab.
 */
function resolveTabs(
  tabParam: string | null,
  subParam: string | null,
  isAdmin: boolean
): { superTab: SuperTabId; subTab: string } {
  // Default
  const DEFAULT = { superTab: "overview" as SuperTabId, subTab: "" };

  if (!tabParam) return DEFAULT;

  // Try new format first: ?tab=politics&sub=officials. This must run before
  // the legacy check below — "politics", "economy", and "demographics" are
  // current super-tab IDs AND legacy single-param keys (left over from before
  // sub-tabs existed). If the legacy check ran first it would match those
  // three unconditionally and hardcode their legacy-mapped sub-tab, silently
  // ignoring whatever `sub=` the player actually clicked — locking Politics,
  // Economy, and Demographics onto their first sub-tab no matter what.
  if (isValidSuperTab(tabParam, isAdmin)) {
    const superTab = getSuperTab(tabParam as SuperTabId)!;
    const visibleSubs = getVisibleSubTabs(superTab, isAdmin);

    if (subParam && visibleSubs.some((s) => s.id === subParam)) {
      return { superTab: tabParam as SuperTabId, subTab: subParam };
    }

    // No valid sub — default to first sub-tab (or empty for Overview)
    if (visibleSubs.length > 0) {
      return { superTab: tabParam as SuperTabId, subTab: visibleSubs[0].id };
    }
    return { superTab: tabParam as SuperTabId, subTab: "" };
  }

  // Legacy single-param format (old ?tab=elections, ?tab=parties, ?tab=budget,
  // etc.) — only reached for keys that aren't current super-tab IDs.
  const legacy = LEGACY_MAP[tabParam];
  if (legacy) {
    // Check admin gate
    if (legacy.sub === "admin" && !isAdmin) return DEFAULT;
    return { superTab: legacy.super, subTab: legacy.sub };
  }

  return DEFAULT;
}

// ── Component ──

export interface RegionTabNavProps {
  isAdmin: boolean;
  /**
   * Render the content for a given (superTabId, subTabId) pair.
   * For super-tabs with no sub-tabs (Overview), subTabId is "".
   */
  renderContent: (superTabId: SuperTabId, subTabId: string) => React.ReactNode;
  /** Optional element to render above the tab bar (e.g. referendum campaign banner) */
  preTabContent?: React.ReactNode;
}

export function RegionTabNav({ isAdmin, renderContent, preTabContent }: RegionTabNavProps) {
  // Hide admin-only sub-tabs before handing the definitions to the shared nav —
  // the shared component renders exactly what it is given.
  const tabs: NavSuperTabDef[] = SUPER_TABS.map((tab) => ({
    id: tab.id,
    label: tab.label,
    icon: tab.icon,
    subTabs: tab.subTabs
      ? getVisibleSubTabs(tab, isAdmin).map((sub) => ({
          id: sub.id,
          label: sub.label,
          accent: sub.id === "admin" ? ("error" as const) : undefined,
        }))
      : undefined,
  }));

  return (
    <SuperTabNav
      tabs={tabs}
      defaultSuperId="overview"
      preTabContent={preTabContent}
      resolve={(tabParam, subParam) => resolveTabs(tabParam, subParam, isAdmin)}
      renderContent={(superId, subId) => renderContent(superId as SuperTabId, subId)}
    />
  );
}

// ── Re-export types for consumers ──

export type { SuperTabDef, SubTabDef };
export { SUPER_TABS, LEGACY_MAP, resolveTabs };

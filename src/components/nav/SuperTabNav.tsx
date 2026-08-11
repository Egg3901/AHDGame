"use client";

import { Fragment, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Tooltip } from "@/components/Tooltip";

/**
 * Shared two-level tab navigation (super-tabs + sub-tabs).
 *
 * Extracted from the state/region page rework so other dense hub pages (the
 * corporation page) can reuse the exact same grouping pattern instead of a
 * long horizontally-scrolling single tab row.
 *
 * Conventions kept from the region rework:
 *  - state lives in the URL (`?tab=<super>&sub=<sub>`), never in useState, so
 *    back/forward and deep links stay correct;
 *  - both bars use flex-wrap (design system: no horizontal scroll);
 *  - a super-tab with 0 or 1 visible sub-tabs renders no sub-tab bar.
 *
 * Visibility gating is the caller's job: pass an already-filtered `tabs` list.
 */

export type TabAccent = "primary" | "warning" | "error";

export interface NavSubTabDef {
  id: string;
  label: string;
  tooltip?: string;
  /** Optional trailing element (e.g. a "New" badge). */
  badge?: React.ReactNode;
  accent?: TabAccent;
}

export interface NavSuperTabDef {
  id: string;
  label: string;
  icon?: React.ReactNode;
  tooltip?: string;
  accent?: TabAccent;
  /** Sub-tabs; omit for a single-panel super-tab (e.g. Overview). */
  subTabs?: NavSubTabDef[];
}

export interface ResolvedTabs {
  superTab: string;
  subTab: string;
}

/** Legacy `?tab=<id>` values mapped onto their current (super, sub) home. */
export type LegacyTabMap = Record<string, ResolvedTabs>;

const ACCENT_ACTIVE: Record<TabAccent, string> = {
  primary: "border-primary text-primary",
  warning: "border-warning text-warning",
  error: "border-error text-error",
};

const ACCENT_IDLE: Record<TabAccent, string> = {
  primary: "border-transparent text-muted hover:border-muted hover:text-foreground",
  warning: "border-transparent text-warning/70 hover:border-warning/50 hover:text-warning",
  error: "border-transparent text-error/70 hover:border-error/50 hover:text-error",
};

function findTab(tabs: NavSuperTabDef[], id: string): NavSuperTabDef | undefined {
  return tabs.find((t) => t.id === id);
}

function subTabsOf(tab: NavSuperTabDef | undefined): NavSubTabDef[] {
  return tab?.subTabs ?? [];
}

/**
 * Resolve URL search-param state into a (superTab, subTab) pair.
 *
 * The new format (`?tab=<super>&sub=<sub>`) is checked BEFORE the legacy map,
 * because some legacy single-param ids are also current super-tab ids — running
 * the legacy check first would pin those groups to one sub-tab forever.
 */
export function resolveSuperTabs(
  tabs: NavSuperTabDef[],
  tabParam: string | null,
  subParam: string | null,
  legacyMap: LegacyTabMap = {},
  defaultSuperId?: string
): ResolvedTabs {
  const fallbackSuper = defaultSuperId ?? tabs[0]?.id ?? "";
  const fallbackTab = findTab(tabs, fallbackSuper);
  const fallbackSubs = subTabsOf(fallbackTab);
  const DEFAULT: ResolvedTabs = {
    superTab: fallbackSuper,
    subTab: fallbackSubs.length > 0 ? fallbackSubs[0].id : "",
  };

  if (!tabParam) return DEFAULT;

  const direct = findTab(tabs, tabParam);
  if (direct) {
    const subs = subTabsOf(direct);
    if (subParam && subs.some((s) => s.id === subParam)) {
      return { superTab: direct.id, subTab: subParam };
    }
    return { superTab: direct.id, subTab: subs.length > 0 ? subs[0].id : "" };
  }

  const legacy = legacyMap[tabParam];
  if (legacy) {
    const target = findTab(tabs, legacy.superTab);
    // The legacy destination may be hidden for this viewer (gated tab, missing
    // privileges) — fall back rather than showing an empty pane.
    if (!target) return DEFAULT;
    const subs = subTabsOf(target);
    if (legacy.subTab && !subs.some((s) => s.id === legacy.subTab)) {
      return { superTab: target.id, subTab: subs.length > 0 ? subs[0].id : "" };
    }
    return { superTab: target.id, subTab: legacy.subTab };
  }

  return DEFAULT;
}

export interface SuperTabNavProps {
  /** Already filtered for this viewer's privileges / feature gates. */
  tabs: NavSuperTabDef[];
  legacyMap?: LegacyTabMap;
  defaultSuperId?: string;
  /** For super-tabs with no sub-tabs, `subId` is "". */
  renderContent: (superId: string, subId: string) => React.ReactNode;
  /** Rendered above the super-tab bar (e.g. a campaign banner). */
  preTabContent?: React.ReactNode;
  /** Fired after a tab click, before the URL update lands. */
  onNavigate?: (superId: string, subId: string) => void;
  /**
   * Override the URL → (super, sub) resolution. Use when a page needs extra
   * rules the generic resolver has no way to know (e.g. the region page sends
   * a non-admin who deep-links `?tab=admin` back to Overview rather than to
   * Governance's first visible sub-tab).
   */
  resolve?: (tabParam: string | null, subParam: string | null) => ResolvedTabs;
}

export function SuperTabNav({
  tabs,
  legacyMap = {},
  defaultSuperId,
  renderContent,
  preTabContent,
  onNavigate,
  resolve,
}: SuperTabNavProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Derive the active pair straight from the URL — a parallel useState can
  // desync from the URL after router.replace and swallow sub-tab clicks.
  const tabParam = searchParams.get("tab");
  const subParam = searchParams.get("sub");
  const resolved = resolve
    ? resolve(tabParam, subParam)
    : resolveSuperTabs(tabs, tabParam, subParam, legacyMap, defaultSuperId);
  const activeSuper = resolved.superTab;
  const activeSub = resolved.subTab;

  const navigate = useCallback(
    (superId: string, subId: string) => {
      onNavigate?.(superId, subId);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", superId);
      if (subId) {
        params.set("sub", subId);
      } else {
        params.delete("sub");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname, onNavigate]
  );

  const setSuperTab = (id: string) => {
    const subs = subTabsOf(findTab(tabs, id));
    navigate(id, subs.length > 0 ? subs[0].id : "");
  };

  const currentSuperTab = findTab(tabs, activeSuper);
  const visibleSubTabs = subTabsOf(currentSuperTab);

  return (
    <div className="min-w-0 overflow-x-hidden">
      {preTabContent}

      {/* Super-tab bar — flex-wrap per design system (no horizontal scroll) */}
      <div className="border-b border-card-border">
        <nav className="flex flex-wrap items-center gap-x-1">
          {tabs.map((tab) => {
            const accent = tab.accent ?? "primary";
            const isActive = activeSuper === tab.id;
            const button = (
              <button
                type="button"
                onClick={() => setSuperTab(tab.id)}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-2 px-3 py-3 text-[13px] font-semibold transition-colors border-b-2 ${
                  isActive
                    ? accent === "primary"
                      ? "border-primary text-foreground"
                      : ACCENT_ACTIVE[accent]
                    : ACCENT_IDLE[accent]
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
            return (
              <Fragment key={tab.id}>
                {tab.tooltip ? <Tooltip content={tab.tooltip}>{button}</Tooltip> : button}
              </Fragment>
            );
          })}
        </nav>
      </div>

      {/* Sub-tab bar — only when the super-tab has more than one sub-tab */}
      {visibleSubTabs.length > 1 && (
        <div className="border-b border-card-border">
          <nav className="flex flex-wrap items-center gap-x-1">
            {visibleSubTabs.map((sub) => {
              const accent = sub.accent ?? "primary";
              const isActive = activeSub === sub.id;
              const button = (
                <button
                  type="button"
                  onClick={() => navigate(activeSuper, sub.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                    isActive ? ACCENT_ACTIVE[accent] : ACCENT_IDLE[accent]
                  }`}
                >
                  {sub.label}
                  {sub.badge}
                </button>
              );
              return (
                <Fragment key={sub.id}>
                  {sub.tooltip ? <Tooltip content={sub.tooltip}>{button}</Tooltip> : button}
                </Fragment>
              );
            })}
          </nav>
        </div>
      )}

      {/* Content */}
      <div className={visibleSubTabs.length > 1 ? "mt-6" : "mt-8"}>
        {renderContent(activeSuper, activeSub)}
      </div>
    </div>
  );
}

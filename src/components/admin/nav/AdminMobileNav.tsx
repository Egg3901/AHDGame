"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  ADMIN_NAV_GROUPS,
  HEAL_CATEGORIES_NAV,
  MAIN_TABS,
  MAIN_TAB_IDS,
  SUB_TABS_BY_TAB,
  getSubTabLabel,
  type MainTabId,
} from "@/components/admin/tabs/AdminTabsConfig";
import { formatBadge, type TabCounts } from "@/components/admin/nav/useAdminBadgeCounts";

interface AdminMobileNavProps {
  activeTab: MainTabId;
  activeSub: string;
  counts: TabCounts;
  onTabSelect: (tab: MainTabId) => void;
  onSubSelect: (sub: string) => void;
}

const TAB_BY_ID = new Map(MAIN_TABS.map((t) => [t.id, t]));

/** Compact mobile navigation for the admin panel (< lg).
 *
 * A sticky breadcrumb bar shows the current location ("Economy / Labour") and
 * doubles as the trigger for a grouped selector panel: main tabs as a touch
 * grid, then the active tab's sub-tabs, then heal categories when on
 * System → Heal. Selecting a main tab keeps the panel open when that tab has
 * sub-tabs so deep destinations are reachable in one gesture chain.
 */
export function AdminMobileNav({
  activeTab,
  activeSub,
  counts,
  onTabSelect,
  onSubSelect,
}: AdminMobileNavProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeTabConfig = TAB_BY_ID.get(activeTab);
  const subTabs = SUB_TABS_BY_TAB[activeTab];
  const showHeal = activeTab === "system" && activeSub === "heal";
  const healParam = searchParams.get("heal");
  const activeHeal =
    healParam && HEAL_CATEGORIES_NAV.some((c) => c.id === healParam) ? healParam : "elections";

  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  // Escape closes the panel from anywhere inside it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const selectTab = (tab: MainTabId) => {
    onTabSelect(tab);
    // Tabs without sub-tabs are a final destination; tabs with sub-tabs keep
    // the panel open so the user can drill straight into a section.
    if (SUB_TABS_BY_TAB[tab].length === 0) close();
  };

  const selectSub = (sub: string) => {
    onSubSelect(sub);
    if (!(activeTab === "system" && sub === "heal")) close();
  };

  const selectHeal = (category: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("heal", category);
    router.replace(`${pathname}?${params.toString()}`);
    close();
  };

  // Roving arrow-key navigation across the main tab grid (mirrors the desktop
  // sidebar: arrows cycle, Home/End jump).
  const handleTabKeyDown = (e: React.KeyboardEvent, tabId: MainTabId) => {
    const idx = MAIN_TAB_IDS.indexOf(tabId);
    if (idx < 0) return;
    const go = (target: MainTabId) => {
      e.preventDefault();
      onTabSelect(target);
      document.getElementById(`admin-tab-mobile-${target}`)?.focus();
    };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      go(MAIN_TAB_IDS[(idx + 1) % MAIN_TAB_IDS.length]);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      go(MAIN_TAB_IDS[(idx - 1 + MAIN_TAB_IDS.length) % MAIN_TAB_IDS.length]);
    } else if (e.key === "Home") {
      go(MAIN_TAB_IDS[0]);
    } else if (e.key === "End") {
      go(MAIN_TAB_IDS[MAIN_TAB_IDS.length - 1]);
    }
  };

  const hasAnyBadge = Object.values(counts).some((n) => typeof n === "number" && n > 0);
  const subLabel = activeSub ? getSubTabLabel(activeTab, activeSub) : "";
  const healLabel = showHeal
    ? HEAL_CATEGORIES_NAV.find((c) => c.id === activeHeal)?.label
    : undefined;

  return (
    <div className="sticky top-14 z-30 lg:hidden">
      {/* Breadcrumb bar / panel trigger — kept above the backdrop so it stays
          crisp and toggleable while the panel is open */}
      <div className="relative z-40 border-b border-card-border bg-card shadow-sm">
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-controls="admin-mobile-nav-panel"
          aria-label={`Admin navigation — current section: ${activeTabConfig?.label}${subLabel ? ` / ${subLabel}` : ""}`}
          onClick={() => setOpen((v) => !v)}
          className="mx-auto flex w-full max-w-7xl cursor-pointer items-center gap-3 px-3 py-2 text-left sm:px-6"
          style={{ minHeight: "48px" }}
        >
          <span className="h-8 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] leading-tight font-semibold tracking-widest text-muted uppercase">
              Admin Panel
            </span>
            {/* Breadcrumb: Tab / Sub / (Heal category) */}
            <span className="flex min-w-0 items-center gap-1.5 text-sm">
              <span className="shrink-0 text-primary" aria-hidden>
                {activeTabConfig?.icon}
              </span>
              <span
                className={`truncate font-semibold ${subLabel ? "text-muted" : "text-foreground"}`}
              >
                {activeTabConfig?.label}
              </span>
              {subLabel && (
                <>
                  <BreadcrumbSep />
                  <span
                    className={`truncate font-semibold ${healLabel ? "text-muted" : "text-foreground"}`}
                  >
                    {subLabel}
                  </span>
                </>
              )}
              {healLabel && (
                <>
                  <BreadcrumbSep />
                  <span className="truncate font-semibold text-foreground">{healLabel}</span>
                </>
              )}
            </span>
          </span>
          {hasAnyBadge && !open && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-error" aria-label="Pending items" />
          )}
          <svg
            className={`h-4 w-4 shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-30 bg-black/40" aria-hidden onClick={() => close()} />
      )}

      {/* Selector panel */}
      {open && (
        <div
          id="admin-mobile-nav-panel"
          ref={panelRef}
          className="absolute inset-x-0 top-full z-40 max-h-[70vh] overflow-y-auto border-b border-card-border bg-card shadow-lg"
        >
          <div className="mx-auto max-w-7xl space-y-4 px-3 py-3 sm:px-6">
            {/* Main tabs, grouped */}
            {ADMIN_NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <div className="px-1 pb-1.5 text-[10px] font-semibold tracking-widest text-muted uppercase">
                  {group.label}
                </div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {group.ids.map((id) => {
                    const tab = TAB_BY_ID.get(id);
                    if (!tab) return null;
                    const isActive = activeTab === id;
                    const badge = counts[id];
                    const hasBadge = typeof badge === "number" && badge > 0;
                    return (
                      <button
                        key={id}
                        type="button"
                        id={`admin-tab-mobile-${id}`}
                        aria-current={isActive ? "true" : undefined}
                        onClick={() => selectTab(id)}
                        onKeyDown={(e) => handleTabKeyDown(e, id)}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2.5 text-left transition-colors ${
                          isActive
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-transparent text-muted hover:bg-white/5 hover:text-foreground"
                        }`}
                        style={{ minHeight: "44px" }}
                      >
                        <span className={isActive ? "opacity-100" : "opacity-70"} aria-hidden>
                          {tab.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {tab.label}
                        </span>
                        {hasBadge && (
                          <span
                            className={`shrink-0 rounded px-1.5 py-px text-[10px] font-bold ${
                              isActive
                                ? "bg-primary text-primary-foreground"
                                : "bg-error/15 text-error"
                            }`}
                            aria-label={`${badge} pending`}
                          >
                            {formatBadge(badge)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Sub-tabs of the active tab */}
            {subTabs.length > 0 && (
              <div className="border-t border-card-border pt-3">
                <div className="px-1 pb-1.5 text-[10px] font-semibold tracking-widest text-muted uppercase">
                  {activeTabConfig?.label} sections
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {subTabs.map((sub) => {
                    const isActive = activeSub === sub.id;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        onClick={() => selectSub(sub.id)}
                        className={`cursor-pointer rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "bg-white/5 text-muted hover:text-foreground"
                        }`}
                        style={{ minHeight: "38px" }}
                      >
                        {sub.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Heal categories (System → Heal third level) */}
            {showHeal && (
              <div className="border-t border-card-border pt-3">
                <div className="px-1 pb-1.5 text-[10px] font-semibold tracking-widest text-muted uppercase">
                  Heal category
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {HEAL_CATEGORIES_NAV.map((cat) => {
                    const isActive = activeHeal === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        onClick={() => selectHeal(cat.id)}
                        className={`cursor-pointer rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "bg-white/5 text-muted hover:text-foreground"
                        }`}
                        style={{ minHeight: "38px" }}
                      >
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BreadcrumbSep() {
  return (
    <svg
      className="h-3 w-3 shrink-0 text-muted/60"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

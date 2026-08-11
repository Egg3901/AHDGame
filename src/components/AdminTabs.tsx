"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  DEFAULT_SUBS,
  MAIN_TABS,
  MAIN_TAB_IDS,
  SUB_TABS_BY_TAB,
  type MainTabId,
  resolveLegacyTab,
} from "@/components/admin/tabs/AdminTabsConfig";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AdminMobileNav } from "@/components/admin/nav/AdminMobileNav";
import { AdminStatusBar } from "@/components/admin/nav/AdminStatusBar";
import { AdminAlertsStrip } from "@/components/admin/nav/AdminAlertsStrip";
import { AdminCommandPalette } from "@/components/admin/nav/AdminCommandPalette";
import { useAdminBadgeCounts } from "@/components/admin/nav/useAdminBadgeCounts";
import { AdminDashboardTab } from "@/components/admin/tabs/AdminDashboardTab";
import { AdminTrafficTab } from "@/components/admin/tabs/AdminTrafficTab";
import { AdminPoliticsTab } from "@/components/admin/tabs/AdminPoliticsTab";
import type { PoliticsSubTab } from "@/components/admin/tabs/AdminPoliticsTab";
import { AdminWorldTab } from "@/components/admin/tabs/AdminWorldTab";
import type { WorldSubTab } from "@/components/admin/tabs/AdminWorldTab";
import { AdminContentTab } from "@/components/admin/tabs/AdminContentTab";
import type { ContentSubTab } from "@/components/admin/tabs/AdminContentTab";
import { AdminPlayersTab } from "@/components/admin/tabs/AdminPlayersTab";
import type { PlayersSubTab } from "@/components/admin/tabs/AdminPlayersTab";
import { AdminSupportTab } from "@/components/admin/tabs/AdminSupportTab";
import type { SupportSubTab } from "@/components/admin/tabs/AdminSupportTab";
import { AdminSystemTab } from "@/components/admin/tabs/AdminSystemTab";
import type { SystemSubTab } from "@/components/admin/tabs/AdminSystemTab";
import { AdminEconomyTab } from "@/components/admin/tabs/AdminEconomyTab";
import type { EconomySubTab } from "@/components/admin/tabs/AdminEconomyTab";

/** Valid sub ids per tab, derived from the shared nav config. */
const VALID_SUBS: Record<MainTabId, readonly string[]> = MAIN_TAB_IDS.reduce(
  (acc, id) => {
    acc[id] = SUB_TABS_BY_TAB[id].map((s) => s.id);
    return acc;
  },
  {} as Record<MainTabId, readonly string[]>
);

function getValidSub(tab: MainTabId, subParam: string | null): string {
  const valid = VALID_SUBS[tab];
  if (!valid.length) return "";
  const sub = subParam ?? DEFAULT_SUBS[tab];
  return valid.includes(sub) ? sub : (valid[0] as string);
}

export function AdminTabs() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = searchParams.get("tab");
  const subParam = searchParams.get("sub");
  const issueParam = searchParams.get("issue");

  const legacy = resolveLegacyTab(tabParam);
  useEffect(() => {
    if (legacy) {
      const params = new URLSearchParams(searchParams);
      params.set("tab", legacy.tab);
      if (legacy.sub) params.set("sub", legacy.sub);
      router.replace(`${pathname}?${params.toString()}`);
    }
  }, [legacy, pathname, router, searchParams]);

  const activeTab: MainTabId = legacy
    ? legacy.tab
    : tabParam && MAIN_TAB_IDS.includes(tabParam as MainTabId)
      ? (tabParam as MainTabId)
      : "dashboard";

  const activeSub = getValidSub(activeTab, legacy?.sub ?? subParam);

  const deepLinkIssue = (() => {
    const n = parseInt(issueParam ?? "", 10);
    return !isNaN(n) && n >= 1 ? n : null;
  })();

  const setTab = (tab: MainTabId, sub?: string, extraParams?: Record<string, string>) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", tab);
    if (sub !== undefined && sub !== "") {
      params.set("sub", sub);
    } else {
      params.delete("sub");
    }
    // The dossier subject deep-link is set explicitly (Users table shortcut);
    // navigating anywhere else drops it so Dossier doesn't keep re-opening
    // the same player.
    params.delete("user");
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) params.set(k, v);
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  const setSub = (sub: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("sub", sub);
    params.delete("user");
    router.replace(`${pathname}?${params.toString()}`);
  };

  const goToTab = (tab: MainTabId) => setTab(tab, DEFAULT_SUBS[tab] || undefined);
  const goToDestination = (tab: MainTabId, sub?: string, extraParams?: Record<string, string>) =>
    setTab(tab, sub ?? (DEFAULT_SUBS[tab] || undefined), extraParams);

  const counts = useAdminBadgeCounts();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Global ⌘K / Ctrl-K toggle for the command palette; Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeTabLabel = MAIN_TABS.find((t) => t.id === activeTab)?.label ?? activeTab;

  return (
    <>
      <AdminStatusBar
        pendingTotal={counts.pendingTotal}
        onOpenPalette={() => setPaletteOpen(true)}
        onGoDashboard={() => goToTab("dashboard")}
      />
      <AdminAlertsStrip onNavigate={(tab, sub) => goToDestination(tab as MainTabId, sub)} />
      <AdminCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={goToDestination}
      />
      <div className="lg:flex lg:items-start">
        {/* Desktop sidebar nav (lg+). 101px = status bar bottom: navbar tuck
            point (top-14 = 56px) + strip h-11 (44px) + its 1px border. */}
        <aside
          className="sticky top-[101px] hidden h-[calc(100vh-101px)] w-60 shrink-0 self-start border-r border-card-border bg-card lg:block"
          aria-label="Admin navigation"
        >
          <AdminSidebar
            activeTab={activeTab}
            onTabSelect={goToTab}
            onDestinationSelect={goToDestination}
            counts={counts}
          />
        </aside>

        <div className="min-w-0 flex-1">
          {/* Mobile / tablet nav: sticky breadcrumb bar + grouped selector panel */}
          <AdminMobileNav
            activeTab={activeTab}
            activeSub={activeSub}
            counts={counts.tabs}
            onTabSelect={goToTab}
            onSubSelect={setSub}
          />

          {/* Tab content. Left-aligned and full-width next to the sidebar —
              mx-auto centering here strands a huge gutter between the sidebar
              and the sub-nav panel on wide screens. Dense admin surfaces use
              the whole row; only ultrawides get a sanity cap. */}
          <main
            className="max-w-[110rem] px-3 py-4 sm:px-6 sm:py-6 lg:py-8"
            role="tabpanel"
            id={`admin-tabpanel-${activeTab}`}
            aria-label={`${activeTabLabel} panel`}
          >
            {activeTab === "dashboard" && (
              <AdminDashboardTab counts={counts} onNavigate={goToDestination} />
            )}
            {activeTab === "traffic" && <AdminTrafficTab />}
            {activeTab === "politics" && (
              <AdminPoliticsTab
                activeSub={activeSub as PoliticsSubTab}
                onSubChange={(s) => setSub(s)}
              />
            )}
            {activeTab === "economy" && (
              <AdminEconomyTab
                activeSub={activeSub as EconomySubTab}
                onSubChange={(s) => setSub(s)}
              />
            )}
            {activeTab === "world" && (
              <AdminWorldTab activeSub={activeSub as WorldSubTab} onSubChange={(s) => setSub(s)} />
            )}
            {activeTab === "content" && (
              <AdminContentTab
                activeSub={activeSub as ContentSubTab}
                onSubChange={(s) => setSub(s)}
              />
            )}
            {activeTab === "players" && (
              <AdminPlayersTab
                activeSub={activeSub as PlayersSubTab}
                onSubChange={(s) => setSub(s)}
              />
            )}
            {activeTab === "support" && (
              <AdminSupportTab
                activeSub={activeSub as SupportSubTab}
                onSubChange={(s) => setSub(s)}
                initialFeedbackIssue={
                  activeSub === "feedback" ? (deepLinkIssue ?? undefined) : undefined
                }
                initialSuggestionIssue={
                  activeSub === "suggestions" ? (deepLinkIssue ?? undefined) : undefined
                }
              />
            )}
            {activeTab === "system" && (
              <AdminSystemTab
                activeSub={activeSub as SystemSubTab}
                onSubChange={(s) => setSub(s)}
              />
            )}
          </main>
        </div>
      </div>
    </>
  );
}

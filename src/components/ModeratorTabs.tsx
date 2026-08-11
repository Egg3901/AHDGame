"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  MOD_TABS,
  MOD_TAB_IDS,
  VALID_MOD_SUBS,
  DEFAULT_MOD_SUBS,
  type ModTabId,
  type ModPlayersSubTab,
  type ModContentSubTab,
} from "@/components/moderator/tabs/ModeratorTabsConfig";
import { ModeratorContentTab } from "@/components/moderator/tabs/ModeratorContentTab";
import { ModeratorPlayersTab } from "@/components/moderator/tabs/ModeratorPlayersTab";
import { ModeratorPriorityTab } from "@/components/moderator/tabs/ModeratorPriorityTab";
import { ModeratorSiteTab } from "@/components/moderator/tabs/ModeratorSiteTab";
import { ModeratorTransactionsTab } from "@/components/moderator/tabs/ModeratorTransactionsTab";

function getValidSub(tab: ModTabId, sub: string | null): string {
  const valid = VALID_MOD_SUBS[tab];
  if (sub && valid?.includes(sub)) return sub;
  return DEFAULT_MOD_SUBS[tab] ?? valid?.[0] ?? "";
}

export function ModeratorTabs() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = searchParams.get("tab");
  const subParam = searchParams.get("sub");

  const activeTab: ModTabId = MOD_TAB_IDS.includes(tabParam as ModTabId)
    ? (tabParam as ModTabId)
    : "priority";
  const activeSub = getValidSub(activeTab, subParam);

  const setSub = (sub: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sub", sub);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div>
      {/* Tab navigation — only shown if there are multiple tabs */}
      {MOD_TABS.length > 1 && (
        <div className="sticky top-0 z-10 border-b border-card-border bg-background">
          <div className="mx-auto max-w-7xl px-3 sm:px-6">
            <nav className="flex gap-1 overflow-x-auto py-1" role="tablist">
              {MOD_TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => {
                    const params = new URLSearchParams();
                    params.set("tab", tab.id);
                    const s = DEFAULT_MOD_SUBS[tab.id] ?? "";
                    if (s) params.set("sub", s);
                    router.push(`${pathname}?${params.toString()}`);
                  }}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? "bg-info/10 text-info"
                      : "text-muted hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6" role="tabpanel">
        {activeTab === "priority" && (
          <ModeratorPriorityTab
            onJump={(tab, sub) => {
              const params = new URLSearchParams();
              params.set("tab", tab);
              if (sub) params.set("sub", sub);
              router.push(`${pathname}?${params.toString()}`);
            }}
          />
        )}
        {activeTab === "players" && (
          <ModeratorPlayersTab
            activeSub={activeSub as ModPlayersSubTab}
            onSubChange={(s) => setSub(s)}
          />
        )}
        {activeTab === "transactions" && <ModeratorTransactionsTab />}
        {activeTab === "content" && (
          <ModeratorContentTab
            activeSub={activeSub as ModContentSubTab}
            onSubChange={(s) => setSub(s)}
          />
        )}
        {activeTab === "site" && <ModeratorSiteTab />}
      </div>
    </div>
  );
}

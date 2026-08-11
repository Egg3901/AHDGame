"use client";

import { useRef } from "react";
import {
  ADMIN_NAV_GROUPS,
  MAIN_TABS,
  MAIN_TAB_IDS,
  type MainTabId,
} from "@/components/admin/tabs/AdminTabsConfig";
import {
  QUEUE_TAB_SUBS,
  formatBadge,
  type AdminBadgeCounts,
} from "@/components/admin/nav/useAdminBadgeCounts";
import { useAdminPins, type AdminPin } from "@/components/admin/nav/useAdminPins";

interface AdminSidebarProps {
  activeTab: MainTabId;
  onTabSelect: (tab: MainTabId) => void;
  /** Navigate to a pinned tab+sub destination. */
  onDestinationSelect: (tab: MainTabId, sub?: string) => void;
  /** Live badge counts, fetched once by AdminTabs and shared with the mobile nav. */
  counts: AdminBadgeCounts;
}

const TAB_BY_ID = new Map(MAIN_TABS.map((t) => [t.id, t]));

export function AdminSidebar({
  activeTab,
  onTabSelect,
  onDestinationSelect,
  counts,
}: AdminSidebarProps) {
  const buttonsRef = useRef<Map<MainTabId, HTMLButtonElement | null>>(new Map());
  const { pins, isPinned, togglePin } = useAdminPins();

  const focusTab = (id: MainTabId) => {
    const btn = buttonsRef.current.get(id);
    btn?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent, tabId: MainTabId) => {
    const idx = MAIN_TAB_IDS.indexOf(tabId);
    if (idx < 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = MAIN_TAB_IDS[(idx + 1) % MAIN_TAB_IDS.length];
      onTabSelect(next);
      focusTab(next);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = MAIN_TAB_IDS[(idx - 1 + MAIN_TAB_IDS.length) % MAIN_TAB_IDS.length];
      onTabSelect(prev);
      focusTab(prev);
    } else if (e.key === "Home") {
      e.preventDefault();
      const first = MAIN_TAB_IDS[0];
      onTabSelect(first);
      focusTab(first);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = MAIN_TAB_IDS[MAIN_TAB_IDS.length - 1];
      onTabSelect(last);
      focusTab(last);
    }
  };

  /** Badge for a pinned destination: queue count when the pin targets a queue
   * sub-tab, else the main-tab badge for whole-tab pins. */
  const pinBadge = (pin: AdminPin): number | undefined => {
    const queue = QUEUE_TAB_SUBS[`${pin.tab}/${pin.sub}`];
    if (queue) return counts.queues[queue];
    if (!pin.sub) return counts.tabs[pin.tab];
    return undefined;
  };

  return (
    <nav
      className="flex h-full flex-col gap-3 px-3 py-4 text-sm"
      aria-label="Admin sections"
      role="tablist"
    >
      <div className="flex items-center gap-2 px-2 pb-2">
        <span className="inline-block h-6 w-1 rounded-full bg-primary" />
        <div className="min-w-0">
          <div className="truncate text-xs font-bold tracking-wide uppercase">Admin Panel</div>
          <div className="truncate text-[10px] text-muted">
            Game ops &middot; Users &middot; System
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto pb-2">
        {pins.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <div className="px-2 pt-1 pb-1 text-[10px] font-semibold tracking-widest text-muted uppercase">
              Pinned
            </div>
            {pins.map((pin) => {
              const badge = pinBadge(pin);
              const hasBadge = typeof badge === "number" && badge > 0;
              return (
                <div key={`${pin.tab}/${pin.sub}`} className="group relative">
                  <button
                    type="button"
                    onClick={() => onDestinationSelect(pin.tab, pin.sub || undefined)}
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-muted transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    <StarIcon className="h-3 w-3 shrink-0 text-warning" filled />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{pin.label}</span>
                    {hasBadge && (
                      <span
                        className="shrink-0 rounded bg-error/15 px-1.5 py-px font-mono text-[10px] font-bold text-error"
                        aria-label={`${badge} pending`}
                      >
                        {formatBadge(badge)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePin(pin)}
                    className="absolute top-1/2 right-1 hidden -translate-y-1/2 cursor-pointer rounded p-1 text-muted hover:text-foreground group-hover:block group-focus-within:block"
                    aria-label={`Unpin ${pin.label}`}
                    title="Unpin"
                  >
                    <UnpinIcon />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {ADMIN_NAV_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <div className="px-2 pt-1 pb-1 text-[10px] font-semibold tracking-widest text-muted uppercase">
              {group.label}
            </div>
            {group.ids.map((id) => {
              const tab = TAB_BY_ID.get(id);
              if (!tab) return null;
              const isActive = activeTab === id;
              const badge = counts.tabs[id];
              const hasBadge = typeof badge === "number" && badge > 0;
              const pinned = isPinned(id, "");
              return (
                <div key={id} className="group relative">
                  <button
                    ref={(el) => {
                      buttonsRef.current.set(id, el);
                    }}
                    role="tab"
                    type="button"
                    aria-selected={isActive}
                    aria-controls={`admin-tabpanel-${id}`}
                    id={`admin-tab-${id}`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => onTabSelect(id)}
                    onKeyDown={(e) => handleKeyDown(e, id)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary shadow-[inset_2px_0_0_var(--primary)]"
                        : "text-muted hover:bg-white/5 hover:text-foreground"
                    }`}
                  >
                    <span
                      className={isActive ? "opacity-100" : "opacity-70 group-hover:opacity-100"}
                      aria-hidden
                    >
                      {tab.icon}
                    </span>
                    <span className="flex-1 text-xs font-medium tracking-wide sm:text-sm">
                      {tab.label}
                    </span>
                    {hasBadge && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-px text-[10px] font-bold transition-opacity group-hover:opacity-0 ${
                          isActive ? "bg-primary text-primary-foreground" : "bg-error/15 text-error"
                        }`}
                        aria-label={`${badge} pending`}
                      >
                        {formatBadge(badge)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePin({ tab: id, sub: "", label: tab.label })}
                    className={`absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-1 transition-colors ${
                      pinned
                        ? "text-warning hover:text-muted"
                        : "hidden text-muted hover:text-warning group-hover:block group-focus-within:block"
                    }`}
                    aria-label={pinned ? `Unpin ${tab.label}` : `Pin ${tab.label}`}
                    title={pinned ? "Unpin from top" : "Pin to top"}
                  >
                    <StarIcon className="h-3 w-3" filled={pinned} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-card-border px-2 pt-2 text-[10px] text-muted">
        v{process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"} &middot; A House Divided
      </div>
    </nav>
  );
}

function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11.48 3.5c.16-.5.88-.5 1.04 0l1.9 5.85h6.15c.53 0 .75.67.32.98l-4.97 3.61 1.9 5.85c.16.5-.41.92-.84.6L12 16.79l-4.98 3.6c-.43.32-1-.1-.84-.6l1.9-5.85-4.97-3.6c-.43-.32-.21-.99.32-.99h6.15l1.9-5.85z"
      />
    </svg>
  );
}

function UnpinIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

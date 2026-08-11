"use client";

import type { ReactNode } from "react";
import {
  MAIN_TABS,
  SUB_GROUPS_BY_TAB,
  SUB_TABS_BY_TAB,
  type MainTabId,
} from "@/components/admin/tabs/AdminTabsConfig";
import { SubTabBar } from "./SubTabBar";
import { useAdminPins } from "@/components/admin/nav/useAdminPins";

interface SubNavLayoutProps<T extends string> {
  tab: MainTabId;
  active: T;
  onChange: (id: T) => void;
  children: ReactNode;
}

/** Section navigation for a main tab: grouped left side panel on lg+ (per
 * SUB_GROUPS_BY_TAB), the classic SubTabBar chips below lg. Side-panel rows
 * can be pinned to the sidebar's Pinned group. */
export function SubNavLayout<T extends string>({
  tab,
  active,
  onChange,
  children,
}: SubNavLayoutProps<T>) {
  const groups = SUB_GROUPS_BY_TAB[tab];
  const subTabs = SUB_TABS_BY_TAB[tab];
  const { isPinned, togglePin } = useAdminPins();
  const tabLabel = MAIN_TABS.find((t) => t.id === tab)?.label ?? tab;

  if (!groups || subTabs.length === 0) {
    return <>{children}</>;
  }

  const labelOf = (id: string) => subTabs.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-5">
      {/* Below lg: the classic chip bar */}
      <div className="mb-6 lg:hidden">
        <SubTabBar
          options={subTabs.map((s) => ({ id: s.id as T, label: s.label }))}
          active={active}
          onChange={onChange}
        />
      </div>

      {/* lg+: grouped side panel */}
      <aside
        className="hidden lg:sticky lg:top-[113px] lg:flex lg:flex-col lg:gap-3 lg:rounded-lg lg:border lg:border-card-border lg:bg-card lg:px-2 lg:py-3 lg:shadow-card"
        aria-label={`${tabLabel} sections`}
      >
        <div className="px-2.5 text-[10px] font-bold tracking-widest text-muted uppercase">
          {tabLabel} · {subTabs.length} sections
        </div>
        {groups.map((group, gi) => (
          <div key={group.label ?? gi} className="flex flex-col gap-0.5">
            {group.label && (
              <div className="px-2.5 pb-1 text-[10px] font-semibold tracking-widest text-muted/80 uppercase">
                {group.label}
              </div>
            )}
            {group.ids.map((id) => {
              const isActive = active === id;
              const pinned = isPinned(tab, id);
              const label = labelOf(id);
              return (
                <div key={id} className="group relative">
                  <button
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => onChange(id as T)}
                    className={`flex w-full cursor-pointer items-center rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted hover:bg-white/5 hover:text-foreground"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePin({ tab, sub: id, label: `${label} · ${tabLabel}` })}
                    className={`absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-0.5 transition-colors ${
                      pinned
                        ? "text-warning hover:text-muted"
                        : "hidden text-muted hover:text-warning group-focus-within:block group-hover:block"
                    }`}
                    aria-label={pinned ? `Unpin ${label}` : `Pin ${label} to sidebar`}
                    title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
                  >
                    <svg
                      className="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill={pinned ? "currentColor" : "none"}
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
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}

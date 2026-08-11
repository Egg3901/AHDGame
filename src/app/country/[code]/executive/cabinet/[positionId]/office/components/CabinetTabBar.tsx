"use client";

import type { CabinetTab, CabinetTabId } from "../cabinetTabs";

export function CabinetTabBar({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: CabinetTab[];
  activeTab: CabinetTabId;
  onSelect: (id: CabinetTabId) => void;
}) {
  return (
    <div className="relative -mb-px flex gap-5 overflow-x-auto">
      {tabs.map((t) => {
        const active = t.id === activeTab;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-3 pt-1 text-[13px] font-semibold ${
              active
                ? "border-[var(--gov)] text-white"
                : "border-transparent text-white/50 hover:text-white/80"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

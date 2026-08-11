"use client";

import { useMemo, useState } from "react";

interface ResourceAvailabilityPanelProps {
  unit: string;
  capacityByState: Record<string, number>;
  totalCapacity: number;
  currentSupply: number;
  capacityLabel?: string;
  stateCountryMap: Record<string, string>;
  stateNames?: Record<string, string>;
}

/**
 * Renders per-state extraction ceilings grouped by country.
 * Capacity = max units/turn a state can produce; actual output is capped
 * to this ceiling by the turn processor.
 */
export default function ResourceAvailabilityPanel({
  unit,
  capacityByState,
  totalCapacity,
  currentSupply,
  capacityLabel = "Global Capacity",
  stateCountryMap,
  stateNames,
}: ResourceAvailabilityPanelProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const byCountry = useMemo(() => {
    const map: Record<
      string,
      { stateId: string; name: string; capacity: number; share: number }[]
    > = {};
    for (const [stateId, capacity] of Object.entries(capacityByState)) {
      if (capacity <= 0) continue;
      const countryId = stateCountryMap[stateId] ?? "—";
      if (!map[countryId]) map[countryId] = [];
      map[countryId].push({
        stateId,
        name: stateNames?.[stateId] ?? stateId,
        capacity,
        share: totalCapacity > 0 ? capacity / totalCapacity : 0,
      });
    }
    for (const rows of Object.values(map)) {
      rows.sort((a, b) => b.capacity - a.capacity);
    }
    return Object.entries(map).sort((a, b) => {
      const totalA = a[1].reduce((s, r) => s + r.capacity, 0);
      const totalB = b[1].reduce((s, r) => s + r.capacity, 0);
      return totalB - totalA;
    });
  }, [capacityByState, stateCountryMap, stateNames, totalCapacity]);

  const utilization = totalCapacity > 0 ? currentSupply / totalCapacity : 0;

  if (byCountry.length === 0) {
    return (
      <section className="mb-6 rounded-xl border border-warning/30 bg-warning/10 p-4">
        <h3 className="text-heading-sm font-semibold text-warning mb-1">Resource Availability</h3>
        <p className="text-body-sm text-muted">
          No state extraction capacity configured for this commodity. Current supply is uncapped,
          which skews margin math. An admin can seed capacity from{" "}
          <strong>Admin → Economy → Resource Capacity</strong>.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-xl border border-card-border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-heading-sm font-semibold">Resource Availability</h3>
          <p className="text-body-sm text-muted">
            Per-state extraction ceilings (units/turn). Supply cannot exceed these caps.
          </p>
        </div>
        <div className="text-right">
          <div className="text-body-xs uppercase tracking-widest text-muted">{capacityLabel}</div>
          <div className="text-body-lg font-bold tabular-nums">
            {totalCapacity.toLocaleString("en-US")}
          </div>
          <div className="text-body-xs text-muted">{unit}/turn</div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-background">
          <div
            className="h-full rounded-full transition-all duration-500 bg-primary"
            style={{ width: `${Math.min(100, Math.max(0, utilization * 100))}%` }}
          />
        </div>
        <span className="text-body-sm tabular-nums whitespace-nowrap">
          {(utilization * 100).toFixed(1)}% utilized
        </span>
      </div>

      <div className="space-y-1">
        {byCountry.map(([countryId, rows]) => {
          const countryTotal = rows.reduce((s, r) => s + r.capacity, 0);
          const countryShare = totalCapacity > 0 ? (countryTotal / totalCapacity) * 100 : 0;
          const isCollapsed = collapsed[countryId] ?? true;

          return (
            <div key={countryId} className="border border-card-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [countryId]: !prev[countryId] }))}
                className="w-full flex items-center justify-between px-3 py-2 bg-card-elevated hover:bg-card-border/20 transition-colors text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                    {countryId}
                  </span>
                  <span className="text-[10px] text-muted">
                    {rows.length} state{rows.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-foreground font-medium">
                    {countryTotal.toLocaleString("en-US")} {unit}
                  </span>
                  <span className="text-[10px] text-muted tabular-nums">
                    {countryShare.toFixed(1)}%
                  </span>
                  <span className="text-muted text-xs">{isCollapsed ? "▶" : "▼"}</span>
                </div>
              </button>

              {!isCollapsed && (
                <table className="w-full text-body-sm">
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.stateId} className="border-t border-card-border/50">
                        <td className="py-1.5 pl-4 font-medium text-xs">{row.name}</td>
                        <td className="py-1.5 pr-4 text-right tabular-nums text-xs">
                          {row.capacity.toLocaleString("en-US")}{" "}
                          <span className="text-muted">{unit}</span>
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums text-[10px] text-muted w-14">
                          {(row.share * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

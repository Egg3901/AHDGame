"use client";

/**
 * Operating strategies for one sector type.
 *
 * The strategy a site runs is the single biggest lever a CEO has over what it
 * consumes and produces, and until now it was a bare dropdown on each table
 * row: you could change it without ever being shown what it did. This panel
 * puts every strategy the type offers on a tab strip, marks the ones nothing
 * is running, and for the selected one shows the commodity chain, the sites on
 * it, and the controls that steer them.
 *
 * The strategy list, descriptions and commodity rates come from
 * `SECTOR_STRATEGIES`, the same constant the row dropdown and the turn
 * processor read. Counts and site chips come from the sectors themselves.
 */

import { useWorldFlags } from "@/hooks/useWorldFlags";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { CorporationType } from "@/lib/constants/corporations";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { COMMODITY_LABELS, type CommodityType } from "@/lib/constants/commodities";
import {
  getOperatingSectorLabel,
  getSectorStrategies,
  getStrategy,
  type SectorStrategy,
} from "@/lib/constants/sectorStrategies";
import { facilityPlural, facilitySingular } from "@/lib/constants/facilityVocabulary";
import { PROPOSED_ACTION_NOTE, proposedSectorActions } from "@/lib/constants/sectorTypeDossier";
import type { SectorDetail } from "./CorporationPageTypes";
import { StateFlag } from "./SectorRowComponents";
import { resolveSectorStrategy, typeFacilityCount } from "./sectorTypeMetrics";
import { SmallButton } from "./dense/DenseKit";

/** The design shows the five heaviest inputs; past that the list stops scanning. */
const MAX_DEMAND_ROWS = 5;

interface SectorStrategyPanelProps {
  sectorType: CorporationType;
  /** Every sector of this type the corporation owns. */
  sectors: SectorDetail[];
  isCeo: boolean;
  corpId: string;
  mediaOperatingModelsEnabled: boolean;
}

/** Commodity rates for one side of the chain. Rates are shares of output, never above 1. */
function CommodityChain({
  title,
  rates,
  limit,
}: {
  title: string;
  rates: Partial<Record<CommodityType, number>>;
  limit?: number;
}) {
  const rows = Object.entries(rates)
    .filter(([, rate]) => !!rate)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, limit ?? Infinity);

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th
            scope="col"
            className="border-b border-card-border py-1 text-left text-[11px] font-medium text-muted"
          >
            {title}
          </th>
          <th
            scope="col"
            className="border-b border-card-border py-1 text-right text-[11px] font-medium text-muted"
            title="Units per 100 units of output"
          >
            per 100
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={2} className="py-1 text-xs text-muted">
              Nothing
            </td>
          </tr>
        )}
        {rows.map(([commodity, rate]) => (
          <tr key={commodity}>
            <td className="truncate border-b border-card-border/60 py-1 text-xs text-foreground">
              {COMMODITY_LABELS[commodity as CommodityType] ?? commodity}
            </td>
            <td className="border-b border-card-border/60 py-1 text-right font-mono text-xs tabular-nums text-foreground">
              {Math.round((rate ?? 0) * 100)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SectorStrategyPanel({
  sectorType,
  sectors,
  isCeo,
  corpId,
  mediaOperatingModelsEnabled,
}: SectorStrategyPanelProps) {
  const { preset } = useWorldFlags();
  // sectorType is already the operating type resolved by SectorsTab.
  const strategyType = sectorType;
  const label =
    getOperatingSectorLabel(sectorType) ?? CORPORATION_TYPE_LABELS[sectorType] ?? sectorType;
  const strategies: SectorStrategy[] = getSectorStrategies(
    strategyType,
    mediaOperatingModelsEnabled,
    null,
    preset
  );

  const [open, setOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const byStrategy = useMemo(() => {
    const map = new Map<string, SectorDetail[]>();
    for (const sector of sectors) {
      // Bucket by the RESOLVED strategy, not the raw stored id. A row carrying
      // a strategy this type no longer has would otherwise land in a bucket no
      // tab ever reads: the site would vanish from the panel entirely and the
      // tab counts would not sum to the division's site count.
      const id = resolveSectorStrategy(sector)?.id;
      if (!id) continue;
      const bucket = map.get(id);
      if (bucket) bucket.push(sector);
      else map.set(id, [sector]);
    }
    return map;
  }, [sectors]);

  // Keep active persisted models visible as read-only status when the selector
  // flag is off. They never enter the row's selectable strategy options.
  const activePersistedModels = [...byStrategy.keys()].flatMap((id) => {
    if (strategies.some((strategy) => strategy.id === id)) return [];
    const strategy = getStrategy(sectorType, id);
    return strategy.mediaOperatingModelId ? [strategy] : [];
  });
  const visibleStrategies = [...strategies, ...activePersistedModels];

  // The selection is remembered per session but never allowed to point at a
  // strategy this type does not have — switching type would otherwise land on
  // an empty pane.
  const active =
    visibleStrategies.find((s) => s.id === selectedId) ??
    visibleStrategies.find((s) => (byStrategy.get(s.id)?.length ?? 0) > 0) ??
    visibleStrategies[0];

  if (!strategies.length || !active) return null;

  const sites = byStrategy.get(active.id) ?? [];
  const plural = facilityPlural(sectorType);
  const singular = facilitySingular(sectorType);
  const actions = proposedSectorActions(sectorType);

  // The tab counts SITES, not facilities: the badge selects the group of
  // locations listed as chips below it, and in an early-era world a site holds
  // hundreds of facilities, so a facility count there reads as noise rather
  // than as "how many of my places run this". The facility total earns its own
  // segment of the count line, where it is unambiguous.
  const facilities = typeFacilityCount(sites);
  const siteWord = facilities === 1 ? singular : plural;
  const stateSummary = sites
    .slice(0, 4)
    .map((s) => s.stateName)
    .join(", ");
  const facilitySegment =
    facilities !== sites.length ? `${facilities.toLocaleString("en-US")} ${siteWord} · ` : "";
  const countLine = sites.length
    ? `${sites.length} ${sites.length === 1 ? "site" : "sites"} · ${facilitySegment}${stateSummary}${
        sites.length > 4 ? ` +${sites.length - 4}` : ""
      }`
    : `No active ${plural}`;

  return (
    <section className="min-w-0">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-card-border pb-1.5">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold text-foreground">Operating strategies</h2>
          <span className="text-xs text-muted">
            available strategies and active methods for {label}; the count is sites running it
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="text-xs text-muted hover:text-foreground"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open && (
        <>
          <div
            className="flex flex-wrap items-center gap-1 py-2"
            role="tablist"
            aria-label="Operating strategy"
          >
            {visibleStrategies.map((strategy) => {
              const running = byStrategy.get(strategy.id) ?? [];
              const count = running.length;
              const isActive = count > 0;
              const on = strategy.id === active.id;
              return (
                <button
                  key={strategy.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setSelectedId(strategy.id)}
                  title={
                    isActive
                      ? `${count} ${count === 1 ? "site" : "sites"} running ${strategy.name}, holding ${typeFacilityCount(running).toLocaleString("en-US")} ${plural}`
                      : `No active ${plural} are using the ${strategy.name} strategy. Switch one to it, or build one with this strategy.`
                  }
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs transition-colors ${
                    on
                      ? "bg-card-elevated font-medium text-foreground"
                      : isActive
                        ? "text-foreground hover:bg-card-elevated/60"
                        : "text-muted hover:bg-card-elevated/60"
                  }`}
                >
                  {strategy.name}
                  <span className="font-mono text-[11px] tabular-nums text-muted">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span
                    className={`block text-[13px] font-medium ${sites.length ? "text-foreground" : "text-muted"}`}
                  >
                    {active.name}
                  </span>
                  <span className="block text-[11px] text-muted">{countLine}</span>
                </div>
                {isCeo && (
                  <SmallButton
                    disabled
                    title={`Switch every ${singular} on this strategy at once. ${PROPOSED_ACTION_NOTE} Change strategy one site at a time in the table below.`}
                  >
                    Switch ▾
                  </SmallButton>
                )}
              </div>

              <p className="m-0 text-xs text-muted">{active.description}</p>

              {sites.length === 0 && (
                <p className="m-0 text-xs text-muted">
                  None of your {plural} currently run {active.name}. Pick a {singular} below and use
                  its strategy dropdown, or build a new one and switch it over.
                </p>
              )}

              {sites.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {sites.map((site) => (
                    <Link
                      key={site._id}
                      href={`/corporation/${corpId}/sector/${site._id}`}
                      className="inline-flex items-center gap-1.5 text-xs text-foreground hover:underline"
                    >
                      <StateFlag stateId={site.stateId} stateName={site.stateName} />
                      {site.displayName || site.stateName}
                    </Link>
                  ))}
                </div>
              )}

              {/* No build button here on purpose. The toolbar above already
                  carries one, and a second that only differs by pre-selecting a
                  strategy is a build affordance the expand flow does not have. */}
              {isCeo && actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {actions.map((action) => (
                    <SmallButton
                      key={action.label}
                      disabled
                      title={`${action.help} ${PROPOSED_ACTION_NOTE}`}
                    >
                      {action.label}
                    </SmallButton>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 items-start gap-x-6">
              <CommodityChain title="Consumes" rates={active.demand} limit={MAX_DEMAND_ROWS} />
              <CommodityChain title="Produces" rates={active.supply} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

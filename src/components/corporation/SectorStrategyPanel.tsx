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

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CorporationType } from "@/lib/constants/corporations";
import { CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import { COMMODITY_LABELS, type CommodityType } from "@/lib/constants/commodities";
import { SECTOR_STRATEGIES, type SectorStrategy } from "@/lib/constants/sectorStrategies";
import { facilityPlural, facilitySingular } from "@/lib/constants/facilityVocabulary";
import {
  PROPOSED_ACTION_NOTE,
  hexAlpha,
  proposedSectorActions,
  sectorTypePalette,
} from "@/lib/constants/sectorTypeDossier";
import type { SectorDetail } from "./CorporationPageTypes";
import { StateFlag } from "./SectorRowComponents";
import { resolveSectorStrategy, typeFacilityCount } from "./sectorTypeMetrics";

/** Longest commodity bar, in px. Rates are shares of output, never above 1. */
const BAR_MAX_PX = 90;

/** The design shows the five heaviest inputs; past that the list stops scanning. */
const MAX_DEMAND_ROWS = 5;

interface SectorStrategyPanelProps {
  sectorType: CorporationType;
  /** Every sector of this type the corporation owns. */
  sectors: SectorDetail[];
  isCeo: boolean;
  corpId: string;
}

function CommodityChain({
  title,
  rates,
  color,
  limit,
}: {
  title: string;
  rates: Partial<Record<CommodityType, number>>;
  color: string;
  limit?: number;
}) {
  const rows = Object.entries(rates)
    .filter(([, rate]) => !!rate)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, limit ?? Infinity);

  return (
    <div>
      <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-muted">
        {title}
      </span>
      <div className="flex flex-col gap-1">
        {rows.length === 0 && <span className="text-[11px] text-muted/70">Nothing</span>}
        {rows.map(([commodity, rate]) => (
          <div key={commodity} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="inline-block h-1.5 shrink-0 rounded-full"
              style={{
                width: `${Math.max(6, Math.round((rate ?? 0) * BAR_MAX_PX))}px`,
                maxWidth: "40%",
                background: color,
              }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {COMMODITY_LABELS[commodity as CommodityType] ?? commodity}
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-muted">
              {Math.round((rate ?? 0) * 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SectorStrategyPanel({
  sectorType,
  sectors,
  isCeo,
  corpId,
}: SectorStrategyPanelProps) {
  const palette = sectorTypePalette(sectorType);
  const label = CORPORATION_TYPE_LABELS[sectorType] ?? sectorType;
  const strategies: SectorStrategy[] = SECTOR_STRATEGIES[sectorType] ?? [];

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

  // The selection is remembered per session but never allowed to point at a
  // strategy this type does not have — switching type would otherwise land on
  // an empty pane.
  const active =
    strategies.find((s) => s.id === selectedId) ??
    strategies.find((s) => (byStrategy.get(s.id)?.length ?? 0) > 0) ??
    strategies[0];

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
    <section className="overflow-hidden rounded-xl border border-card-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 border-0 bg-transparent px-5 py-3 text-left text-foreground"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-2.5">
          <span className="whitespace-nowrap text-sm font-bold">Operating strategies</span>
          <span className="text-pretty text-[11px] text-muted">
            all strategies available to {label}; greyed tabs have no active sites
          </span>
        </span>
        <span
          className="inline-block shrink-0 transition-transform"
          style={{ transform: `rotate(${open ? 180 : 0}deg)` }}
          aria-hidden
        >
          ▾
        </span>
      </button>

      {open && (
        <>
          <div className="border-y border-card-border px-3">
            <div
              className="flex flex-wrap items-center gap-0.5"
              role="tablist"
              aria-label="Operating strategy"
            >
              {strategies.map((strategy) => {
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
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap border-0 border-b-2 bg-transparent px-3 py-2 text-xs font-semibold ${
                      isActive ? "" : "italic"
                    }`}
                    style={{
                      borderBottomColor: on ? palette.c500 : "transparent",
                      color: on ? palette.c400 : isActive ? "var(--foreground)" : "var(--muted)",
                      opacity: on || isActive ? 1 : 0.65,
                    }}
                  >
                    {strategy.name}
                    <span
                      className="rounded-full px-1.5 text-[10px] font-medium tabular-nums"
                      style={{
                        background: isActive
                          ? on
                            ? hexAlpha(palette.c500, 0.25)
                            : "var(--card-elevated)"
                          : "transparent",
                        border: isActive ? "1px solid transparent" : "1px solid var(--card-border)",
                      }}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-x-6">
            <div className="flex min-w-0 flex-col gap-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span
                    className={`block text-[15px] font-bold ${sites.length ? "text-foreground" : "text-muted"}`}
                  >
                    {active.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">{countLine}</span>
                </div>
                {isCeo && (
                  <button
                    type="button"
                    disabled
                    title={`Switch every ${singular} on this strategy at once. ${PROPOSED_ACTION_NOTE} Change strategy one site at a time in the table below.`}
                    className="shrink-0 cursor-not-allowed rounded border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary opacity-60"
                  >
                    Switch ▾
                  </button>
                )}
              </div>

              <p className="m-0 text-pretty text-xs leading-relaxed text-muted">
                {active.description}
              </p>

              {sites.length === 0 && (
                <p className="m-0 rounded-lg border border-dashed border-card-border bg-card-muted/30 px-2.5 py-2 text-[11px] leading-relaxed text-muted">
                  None of your {plural} currently run {active.name}. Pick a {singular} below and use
                  its strategy dropdown, or build a new one and switch it over.
                </p>
              )}

              {sites.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sites.map((site) => (
                    <Link
                      key={site._id}
                      href={`/corporation/${corpId}/sector/${site._id}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card-muted/30 py-0.5 pl-1 pr-2 text-[11px] text-foreground transition-colors hover:border-primary/40"
                    >
                      <StateFlag stateId={site.stateId} stateName={site.stateName} />
                      {site.displayName || site.stateName}
                    </Link>
                  ))}
                </div>
              )}

              {/* No build button here on purpose. The dossier above and the
                  table below both already carry one, and a third that only
                  differs by pre-selecting a strategy is a build affordance the
                  expand flow does not have. */}
              {isCeo && actions.length > 0 && (
                <div className="mt-auto flex flex-wrap gap-1.5 border-t border-card-border/50 pt-2">
                  {actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      disabled
                      title={`${action.help} ${PROPOSED_ACTION_NOTE}`}
                      className="cursor-not-allowed whitespace-nowrap rounded-md border px-2.5 py-1 text-[11px] font-semibold opacity-60"
                      style={{
                        borderColor: hexAlpha(palette.c500, 0.35),
                        background: hexAlpha(palette.c500, 0.1),
                        color: palette.c400,
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 items-start gap-2.5 lg:grid-cols-[1fr_18px_1fr] lg:gap-2">
              <CommodityChain
                title="Consumes"
                rates={active.demand}
                color="var(--muted)"
                limit={MAX_DEMAND_ROWS}
              />
              <div
                className="hidden h-full items-center justify-center pt-[22px] text-sm text-muted lg:flex"
                aria-hidden
              >
                →
              </div>
              <CommodityChain title="Produces" rates={active.supply} color={palette.c500} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

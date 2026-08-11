"use client";

import { useEffect, useRef, type Dispatch } from "react";
import type {
  MilitaryState,
  StrategicRegion,
  CoverageStatus,
  ThreatLevel,
} from "@/lib/military/types";
import type { MilitaryAction } from "@/lib/military/reducer";
import { STRATEGIC_REGIONS, groupRegionsByTheater, getRegion } from "@/lib/military/regions";
import { MAP_FILTERS } from "@/lib/military/config";
import { coverageStatus, commandsOfRegion } from "@/lib/military/calc";
import { SectionCard, Badge } from "../../dossier";

type Tone = "muted" | "gov" | "up" | "down" | "warning" | "info" | "success";

const COVERAGE: Record<CoverageStatus, { chip: string; tone: Tone }> = {
  ASSIGNED: { chip: "ASSIGNED", tone: "up" },
  UNASSIGNED: { chip: "UNASSIGNED", tone: "muted" },
  OVERLAPPING: { chip: "OVERLAP", tone: "warning" },
  ACTIVE_CONFLICT: { chip: "CONFLICT", tone: "down" },
};
const THREAT_TONE: Record<StrategicRegion["threat"], Tone> = {
  Severe: "down",
  High: "warning",
  Rising: "warning",
  Medium: "info",
  Low: "up",
};

/** Per-filter chip + tone for a region row (cabinet mapping of the cw rowDescriptor). */
function rowChip(
  r: StrategicRegion,
  filter: string,
  cov: CoverageStatus,
  threat: ThreatLevel
): { chip: string; tone: Tone; dim: boolean } {
  switch (filter) {
    case "threat":
      return { chip: threat.toUpperCase(), tone: THREAT_TONE[threat], dim: false };
    case "logi":
      return { chip: `LOGI ${r.logi.toUpperCase()}`, tone: "gov", dim: false };
    case "naval":
      return { chip: `PORT ${r.port}`, tone: "info", dim: r.type === "land" };
    case "air":
      return { chip: `AIR ${r.air}`, tone: "info", dim: false };
    case "ops":
      return cov === "ACTIVE_CONFLICT"
        ? { chip: "ACTIVE OP", tone: "down", dim: false }
        : { chip: "—", tone: "muted", dim: true };
    case "unassigned":
      return cov === "UNASSIGNED"
        ? { chip: "UNASSIGNED", tone: "warning", dim: false }
        : { chip: "COVERED", tone: "muted", dim: true };
    case "coverage":
    default:
      return { ...COVERAGE[cov], dim: false };
  }
}

export function RegionAssignment({
  state,
  dispatch,
  canWrite,
  regionThreats,
}: {
  state: MilitaryState;
  dispatch: Dispatch<MilitaryAction>;
  canWrite: boolean;
  regionThreats: Record<string, ThreatLevel>;
}) {
  const threatOf = (id: string): ThreatLevel => regionThreats[id] ?? "Low";
  const groups = groupRegionsByTheater(STRATEGIC_REGIONS);
  const globalCmds = state.commands.filter((c) => c.regionIds.length === 0);
  const detail = state.selectedRegionId ? getRegion(state.selectedRegionId) : null;
  const selected = state.selectedId ? state.commands.find((c) => c.id === state.selectedId) : null;

  // The inspect detail renders below the full region list; when a region is picked,
  // pull it into view so the tap gives immediate feedback (the list can be long on mobile).
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.selectedRegionId)
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [state.selectedRegionId]);

  return (
    <SectionCard
      title="Strategic regions"
      sub="Assign world regions to theater commands"
      right={
        state.assignMode ? (
          <Badge tone="gov">◉ Assign mode · click to toggle</Badge>
        ) : (
          <span className="text-[11px] text-muted">Click a region to inspect</span>
        )
      }
    >
      {/* filters */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {MAP_FILTERS.map((f) => {
          const active = state.filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => dispatch({ type: "SET_FILTER", filter: f.id })}
              aria-pressed={active}
              className={`rounded-md border px-2 py-1 text-[10px] font-semibold tracking-wide ${
                active
                  ? "border-[var(--gov)] bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] text-gov-soft"
                  : "border-card-border text-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* region list by theater (the host modal provides the single scroll) */}
      <div className="pr-1">
        {groups.map((grp) => (
          <div key={grp.theater} className="mb-2">
            <div className="dossier-label mb-1 mt-2 flex items-center gap-2 text-muted">
              <span className="whitespace-nowrap">{grp.theater.toUpperCase()}</span>
              <span className="h-px flex-1 bg-card-border" />
              <span className="tabular shrink-0">{grp.regions.length}</span>
            </div>
            <div className="flex flex-col gap-1">
              {grp.regions.map((r) => {
                const cov = coverageStatus(state, r.id, []);
                const d = rowChip(r, state.filter, cov, threatOf(r.id));
                const star = r.value === "High" || r.value === "Very High";
                const selectedRow = state.selectedRegionId === r.id;
                const inSel =
                  state.selectedId != null &&
                  commandsOfRegion(state, r.id).some((c) => c.id === state.selectedId);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => dispatch({ type: "CLICK_REGION", regionId: r.id })}
                    className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left ${
                      selectedRow
                        ? "border-[var(--gov)] bg-card-elevated"
                        : "border-card-border bg-card"
                    } ${d.dim ? "opacity-50" : ""}`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                      {star && <span className="mr-1 text-gov-soft">★</span>}
                      {r.name}
                    </span>
                    <Badge tone={d.tone}>{d.chip}</Badge>
                    {state.assignMode && (
                      <Badge tone={inSel ? "gov" : "muted"}>{inSel ? "IN" : "OUT"}</Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* global-scope commands */}
        <div className="mt-3 rounded-lg border border-dashed border-card-border p-2.5">
          <div className="dossier-label mb-1.5 text-muted">Global scope · no map region</div>
          <div className="flex flex-wrap gap-1.5">
            {globalCmds.length === 0 ? (
              <span className="text-[11px] text-muted">None</span>
            ) : (
              globalCmds.map((c) => (
                <Badge key={c.id} tone="muted">
                  {c.name}
                </Badge>
              ))
            )}
          </div>
        </div>
      </div>

      {/* selected-region detail (replaces the cw popover) */}
      {detail && (
        <div
          ref={detailRef}
          className="mt-3 rounded-lg border border-card-border bg-card-elevated p-3"
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">{detail.name}</div>
              <div className="dossier-label text-muted">
                {detail.macro} · {detail.terrain}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dispatch({ type: "CLOSE_REGION" })}
              aria-label="Close region details"
              className="rounded-md border border-card-border px-2 text-muted hover:text-foreground"
            >
              ✕
            </button>
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
            {(
              [
                ["Infra", String(detail.infra)],
                ["Port", String(detail.port)],
                ["Airbase", String(detail.air)],
                ["Threat", threatOf(detail.id)],
                ["Value", detail.value],
                ["Logistics", detail.logi],
                ["Instability", detail.instab],
                ["Resource", detail.resource],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className="dossier-label text-muted">{k}</span>
                <span className="tabular font-semibold text-foreground">{v}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-muted">
            Assigned to:{" "}
            {commandsOfRegion(state, detail.id).length
              ? commandsOfRegion(state, detail.id)
                  .map((c) => c.name)
                  .join(", ")
              : "Unassigned"}
          </div>
          {canWrite && selected ? (
            <button
              type="button"
              onClick={() =>
                dispatch({ type: "TOGGLE_REGION", commandId: selected.id, regionId: detail.id })
              }
              className={`mt-2 w-full rounded-lg border px-3 py-2 text-[12px] font-semibold ${
                selected.regionIds.includes(detail.id)
                  ? "border-warning/50 text-warning"
                  : "border-[var(--gov)] bg-[var(--gov)] text-[#1a1200]"
              }`}
            >
              {selected.regionIds.includes(detail.id)
                ? `Remove from ${selected.name}`
                : `Assign to ${selected.name}`}
            </button>
          ) : canWrite ? (
            <div className="mt-2 text-[11px] text-muted">
              Select a command to assign this region.
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
